/* ============================================================================
   Telegram ストレージ中継 Worker  (Cloudflare Workers / 無料・カード不要)
   ----------------------------------------------------------------------------
   ・PWA からファイルを受け取り Telegram に保存（実質無制限・無料）
   ・Bot トークンは Worker の環境変数に隠す（PWA には出さない）
   ・CORS を付けてブラウザから直接呼べるようにする
   ----------------------------------------------------------------------------
   必要な環境変数（Cloudflare ダッシュボード → Worker → Settings → Variables）:
     TG_TOKEN  … @BotFather でもらった Bot トークン
     TG_CHAT   … 保存先チャンネルの chat_id（例: -1001234567890）
     ALLOW     … 許可するオリジン（例: https://shake-to-shake.netlify.app）※省略可=*
   ---- 1日1回のバックアップ Cron 用（無くても /up /dl は動く）----
     FB_URL    … Firebase RTDB の databaseURL（例: https://ichat-pwa-default-rtdb.asia-southeast1.firebasedatabase.app）
     FB_SECRET … RTDB の REST 用シークレット（コンソール → プロジェクト設定 → サービスアカウント → データベースシークレット）
                 ※レガシーだが REST の ?auth= で使えてルールを越えて読める。最小権限の専用シークレット推奨。バックアップ取得のみに使用。
   ----------------------------------------------------------------------------
   エンドポイント:
     POST /up?name=foo.jpg&type=image/jpeg   body=ファイルのバイト列  → { ok:true, id:"<file_id>", mid:<message_id> }
     GET  /dl?id=<file_id>                    → ファイル本体（画像など）を返す
   Cron（wrangler.toml の [triggers] crons）:
     scheduled() は backupRtdb のみ実行（1日1回 RTDB を JSON で Telegram/R2 へ退避）。
     ★empty mode（会話の自動削除）は完全廃止＝送ったメッセージは二度と勝手に消えない。
   注意: Bot API の制限で アップロード50MB / ダウンロード(getFile)20MB まで。
   ========================================================================== */

export default {
  // ===== Cron: empty mode（自動削除）は完全廃止＝会話は二度と勝手に消えない。1日1回のバックアップだけ実行 =====
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      // 1日1回(UTC18時=JST3時)だけ RTDB を Telegram/R2 へ JSON バックアップ。BACKUP_HOUR(env, UTC) で変更可。OFF=BACKUP_OFF=1
      const h = new Date(event.scheduledTime || Date.now()).getUTCHours();
      const bh = (env.BACKUP_HOUR != null) ? parseInt(env.BACKUP_HOUR, 10) : 18;
      if (env.BACKUP_OFF !== '1' && h === bh) { try { await backupRtdb(env); } catch (e) {} }
    })());
  },

  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOW || '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

    // ---- 診断(画像/動画ブラックアウトの主因=TG_TOKEN欠落を確認): 値は出さず有無/長さのみ ----
    //   デプロイ済みworkerと同じ出力に合わせる(hasMEDIA=R2バインドの有無 / keys=文字列env名のみ)。
    if (url.pathname === '/envcheck') {
      return json({
        hasTOKEN: !!env.TG_TOKEN, tokenLen: (env.TG_TOKEN || '').length,
        hasCHAT: !!env.TG_CHAT, chatLen: (env.TG_CHAT || '').length,
        hasMEDIA: !!env.MEDIA,
        keys: Object.keys(env).filter(function (k) { return typeof env[k] === 'string'; }).sort(),
      }, 200, cors);
    }

    // ---- SkyWay Auth Token (通話): secretはWorkerのシークレット環境変数=リポジトリ/クライアントに一切置かない ----
    //   必要な環境変数: SKYWAY_APP_ID(平文var可) / SKYWAY_SECRET(必ず `wrangler secret put SKYWAY_SECRET`)
    //   返却: { ok:true, token:<JWT v3/HS256>, exp } — クライアントはこのトークンでSkyWayContext.Create
    if (req.method === 'GET' && url.pathname === '/swtoken') {
      try {
        const appId = env.SKYWAY_APP_ID, sec = env.SKYWAY_SECRET;
        if (!appId || !sec) return json({ ok: false, err: 'skyway not configured' }, 500, cors);
        const now = Math.floor(Date.now() / 1000) - 30;   // 端末/エッジの時計ズレ対策
        const exp = now + 6 * 3600;
        const enc = new TextEncoder();
        const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const head = b64u(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
        const pay = b64u(enc.encode(JSON.stringify({ jti: crypto.randomUUID(), iat: now, exp: exp, version: 3,
          scope: { appId: appId, turn: { enabled: true },
            rooms: [{ id: '*', name: '*', methods: ['create', 'close', 'updateMetadata'],
              member: { id: '*', name: '*', methods: ['publish', 'subscribe', 'updateMetadata'] } }] } })));
        const key = await crypto.subtle.importKey('raw', enc.encode(sec), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const sig = await crypto.subtle.sign('HMAC', key, enc.encode(head + '.' + pay));
        return json({ ok: true, token: head + '.' + pay + '.' + b64u(sig), exp: exp }, 200, cors);
      } catch (e) { return json({ ok: false, err: String(e && e.message || e) }, 500, cors); }
    }

    // ---- 翻訳（Telegram設定不要・無料）----
    if (req.method === 'GET' && url.pathname === '/tr') {
      try {
        const q = url.searchParams.get('q') || '', tl = (url.searchParams.get('tl') || 'en').slice(0, 5);
        if (!q) return json({ ok: false, err: 'no q' }, 400, cors);
        const r = await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' + encodeURIComponent(tl) + '&dt=t&q=' + encodeURIComponent(q.slice(0, 800)));
        const d = await r.json();
        const text = (d && d[0]) ? d[0].map(x => x[0]).join('') : '';
        return json({ ok: true, text: text, src: (d && d[2]) || '' }, 200, cors);
      } catch (e) { return json({ ok: false, err: String(e && e.message || e) }, 500, cors); }
    }

    // ---- LINEログインは廃止(2026-07): /line・/line/poll エンドポイント削除。GitHub Device Flow + パスキーに一本化 ----

    // ---- GitHubログイン(Device Flow・シークレット不要): OAuth Appで「Device Flow」を有効にするだけで全環境で動く。
    //      github.comはCORSを返さないのでWorkerで中継。/ghd/start=コード発行 / /ghd/poll=トークン→ユーザーID(sub)返却 ----
    if (req.method === 'POST' && url.pathname === '/ghd/start') {
      try {
        const b = await req.json(); const cid = String(b.client_id || '');
        if (!/^[A-Za-z0-9._-]{8,80}$/.test(cid)) return json({ ok: false, err: 'bad-client' }, 400, cors);
        const r = await fetch('https://github.com/login/device/code', { method: 'POST', headers: { 'accept': 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ client_id: cid, scope: 'read:user' }) });
        const j = await r.json();
        if (!j || !j.device_code) return json({ ok: false, err: (j && (j.error || j.error_description)) || 'start-failed' }, 400, cors);
        return json({ ok: true, device_code: j.device_code, user_code: j.user_code, verification_uri: j.verification_uri, interval: j.interval || 5, expires_in: j.expires_in || 900 }, 200, cors);
      } catch (e) { return json({ ok: false, err: String(e && e.message || e) }, 500, cors); }
    }
    if (req.method === 'POST' && url.pathname === '/ghd/poll') {
      try {
        const b = await req.json(); const cid = String(b.client_id || ''), dc = String(b.device_code || '');
        if (!cid || !dc) return json({ ok: false, err: 'bad-request' }, 400, cors);
        const r = await fetch('https://github.com/login/oauth/access_token', { method: 'POST', headers: { 'accept': 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ client_id: cid, device_code: dc, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) });
        const j = await r.json();
        if (j && j.error) return json({ ok: false, err: j.error }, 200, cors);   // authorization_pending / slow_down / expired_token / access_denied
        if (!j || !j.access_token) return json({ ok: false, err: 'no-token' }, 200, cors);
        const u = await fetch('https://api.github.com/user', { headers: { 'authorization': 'Bearer ' + j.access_token, 'accept': 'application/vnd.github+json', 'user-agent': 'sts-login' } });
        const uj = await u.json();
        if (!uj || !uj.id) return json({ ok: false, err: 'no-user' }, 200, cors);
        return json({ ok: true, sub: String(uj.id), name: String(uj.login || '') }, 200, cors);
      } catch (e) { return json({ ok: false, err: String(e && e.message || e) }, 500, cors); }
    }

    // ---- iTunes検索プロキシ ----
    // ★iPhone根治(2026-07-13): AppleはCloudflareのegress IP(=iCloudプライベートリレー経由のiPhoneも同じ)を429で弾く。
    //   だが実測でitunesは「X-Forwarded-ForヘッダのIP」でレート制限しており、NetlifyのリライトプロキシはクライアントのXFFを
    //   そのまま転送する。ブラウザはXFFを設定できない(禁止ヘッダ)がWorkerなら送れる→Netlify経由でクリーンなランダムIPを
    //   XForwardedForに載せれば、プライベートリレーのiPhoneでも確実に結果が返る。エッジ10分キャッシュで上流負荷も最小。
    if (req.method === 'GET' && url.pathname === '/itunes') {
      try {
        const dbg = url.searchParams.get('_dbg');
        const nfBase = 'https://shake-to-shake.netlify.app/itunes-api/search' + (url.search || '').replace(/&?_dbg=[^&]*/, '');
        const directBase = 'https://itunes.apple.com/search' + (url.search || '').replace(/&?_dbg=[^&]*/, '');
        const cache = caches.default, cacheKey = new Request(directBase);
        let r = await cache.match(cacheKey);
        if (!r) {
          // レート制限を避けるためリクエスト毎に別のクリーンな公開IPを名乗る(予約帯を除外)
          const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
          const fakeIp = () => { let a = rnd(11, 223); while (a === 127 || a === 10 || a === 169 || a === 172 || a === 192 || a === 100) a = rnd(11, 223); return a + '.' + rnd(1, 254) + '.' + rnd(1, 254) + '.' + rnd(1, 254); };
          let body = '', ok = false, tries = 0;
          // Netlify経由(クリーンXFF)を最大3回、別IPで試す
          while (!ok && tries < 3) {
            tries++;
            try {
              const ip = fakeIp();
              const nf = await fetch(nfBase, { headers: { 'X-Forwarded-For': ip, 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json,text/javascript,*/*' } });
              let nb = await nf.text();
              const m = nb.match(/^[^({]*\(([\s\S]*)\);?\s*$/); if (m) nb = m[1];   // JSONP(cb(...))なら裸JSONに剥がす
              if (/"resultCount"/.test(nb)) { body = nb; ok = true; }
              else if (dbg) return json({ dbg: 'nf', try: tries, ip, nfStatus: nf.status, len: nb.length, head: nb.slice(0, 80) }, 200, cors);
            } catch (e) { if (dbg) return json({ dbg: 'nf-throw', try: tries, err: String(e && e.message || e) }, 200, cors); }
          }
          if (!ok) {
            // 最後の保険: itunes直(CFのIPが弾かれてなければ通る)
            try { const up = await fetch(directBase); const t = await up.text(); if (/"resultCount"/.test(t)) { body = t; ok = true; } } catch (e) {}
          }
          r = new Response(body || '{"resultCount":0,"results":[]}', { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=600' } });
          if (ok) { try { await cache.put(cacheKey, r.clone()); } catch (e) {} }   // 成功(非空)のみ10分キャッシュ
        }
        const out = new Response(r.body, r);
        Object.keys(cors).forEach(k => out.headers.set(k, cors[k]));
        return out;
      } catch (e) { return json({ resultCount: 0, results: [], err: String(e && e.message || e) }, 200, cors); }
    }

    // ---- R2 優先: MEDIA バインディングがあれば Telegram 不要でR2に保存/配信（軽量・無料枠）----
    if (env.MEDIA) {
      if (req.method === 'POST' && url.pathname === '/up') {
        try {
          const name = (url.searchParams.get('name') || 'file').replace(/[^\w.\-]/g, '_').slice(0, 80);
          const type = (url.searchParams.get('type') || req.headers.get('content-type') || 'application/octet-stream').slice(0, 120);
          const bytes = await req.arrayBuffer();
          if (!bytes || bytes.byteLength === 0) return json({ ok: false, err: 'empty' }, 400, cors);
          if (bytes.byteLength > 60 * 1024 * 1024) return json({ ok: false, err: 'too big (>60MB)' }, 413, cors);
          const ext = (name.match(/\.[A-Za-z0-9]{1,5}$/) || [''])[0];
          const a = new Uint8Array(16); crypto.getRandomValues(a);
          const key = new Date().toISOString().slice(0, 10) + '/' + Array.from(a, b => (b % 36).toString(36)).join('') + ext;
          await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: type, cacheControl: 'public, max-age=31536000, immutable' } });
          return json({ ok: true, id: key, mid: 0 }, 200, cors);   // id=R2キー → アプリは cximg:<id>, /dl?id=<id> で使える
        } catch (e) { return json({ ok: false, err: String(e && e.message || e) }, 500, cors); }
      }
      if (req.method === 'GET' && url.pathname === '/dl') {
        const id = url.searchParams.get('id');
        if (id) {
          const obj = await env.MEDIA.get(id);
          if (obj) { const h = new Headers(cors); obj.writeHttpMetadata(h); h.set('Cache-Control', 'public, max-age=31536000, immutable'); h.set('Accept-Ranges', 'bytes'); h.set('etag', obj.httpEtag); return new Response(obj.body, { headers: h }); }
        }
        return new Response('not found', { status: 404, headers: cors });
      }
    }

    const TOKEN = env.TG_TOKEN, CHAT = env.TG_CHAT;
    if (!TOKEN || !CHAT) return json({ ok: false, err: 'worker not configured' }, 500, cors);
    const api = 'https://api.telegram.org/bot' + TOKEN;

    try {
      // ---- アップロード ----
      if (req.method === 'POST' && url.pathname === '/up') {
        const name = (url.searchParams.get('name') || 'file').slice(0, 80);
        const type = url.searchParams.get('type') || 'application/octet-stream';
        const bytes = await req.arrayBuffer();
        if (bytes.byteLength === 0) return json({ ok: false, err: 'empty' }, 400, cors);
        if (bytes.byteLength > 50 * 1024 * 1024) return json({ ok: false, err: 'too big (>50MB)' }, 413, cors);

        const fd = new FormData();
        fd.append('chat_id', CHAT);
        fd.append('document', new Blob([bytes], { type }), name);
        const r = await fetch(api + '/sendDocument', { method: 'POST', body: fd });
        const d = await r.json();
        if (!d.ok) return json({ ok: false, err: d.description || 'telegram error' }, 502, cors);
        const doc = d.result.document || (d.result.photo && d.result.photo.pop()) || {};
        // mid = Telegram message_id（クライアントが画像メッセージ取消時に実体を消すための参照）
        return json({ ok: true, id: doc.file_id, mid: d.result.message_id }, 200, cors);
      }

      // ---- ダウンロード ----
      if (req.method === 'GET' && url.pathname === '/dl') {
        const id = url.searchParams.get('id');
        if (!id) return json({ ok: false, err: 'no id' }, 400, cors);
        const gf = await (await fetch(api + '/getFile?file_id=' + encodeURIComponent(id))).json();
        if (!gf.ok) return json({ ok: false, err: gf.description || 'getFile failed' }, 404, cors);
        const fileResp = await fetch('https://api.telegram.org/file/bot' + TOKEN + '/' + gf.result.file_path);
        const h = new Headers(cors);
        h.set('Content-Type', fileResp.headers.get('Content-Type') || 'application/octet-stream');
        h.set('Cache-Control', 'public, max-age=31536000, immutable');
        return new Response(fileResp.body, { status: fileResp.status, headers: h });
      }

      // ---- chat_id 調べ（チャンネルにbotを入れて投稿→ここを開くと出る）----
      if (url.pathname === '/ids') {
        const u = await (await fetch(api + '/getUpdates')).json();
        const chats = [];
        (u.result || []).forEach(x => {
          const c = (x.channel_post && x.channel_post.chat) || (x.message && x.message.chat) || (x.my_chat_member && x.my_chat_member.chat);
          if (c && !chats.some(z => z.id === c.id)) chats.push({ id: c.id, title: c.title || c.username || c.first_name, type: c.type });
        });
        return json({ ok: true, hint: 'この id を TG_CHAT に設定', chats }, 200, cors);
      }

      // ---- P13: 最新のR2バックアップ(rtdb-*.json)を返す（災害復旧用・BACKUP_BUCKET binding時のみ） ----
      if (req.method === 'GET' && url.pathname === '/backup-latest') {
        if (!env.BACKUP_BUCKET) return json({ ok: false, err: 'no backup bucket' }, 404, cors);
        const list = await env.BACKUP_BUCKET.list({ prefix: 'rtdb-' });
        const objs = (list.objects || []).slice().sort((a, b) => (a.key < b.key ? 1 : -1));   // 新しい日付が先頭
        if (!objs.length) return json({ ok: false, err: 'no backup yet' }, 404, cors);
        const obj = await env.BACKUP_BUCKET.get(objs[0].key);
        if (!obj) return json({ ok: false, err: 'read failed' }, 500, cors);
        const h = new Headers(cors); h.set('Content-Type', 'application/json; charset=utf-8'); h.set('Cache-Control', 'no-store'); h.set('X-Backup-Key', objs[0].key);
        return new Response(obj.body, { status: 200, headers: h });
      }

      // ---- ヘルス ----
      if (url.pathname === '/' || url.pathname === '/health') return json({ ok: true, service: 'tg-storage' }, 200, cors);

      return json({ ok: false, err: 'not found' }, 404, cors);
    } catch (e) {
      return json({ ok: false, err: String(e && e.message || e) }, 500, cors);
    }
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
}

/* RTDB の主要ノードを JSON で Telegram にバックアップ（再発防止・誤削除からの復旧用）。
   画像のinline dataURLは容量が大きいので除去（テキスト/構造のみ）。R2 binding(env.BACKUP_BUCKET)があればそちらにも保存。 */
async function backupRtdb(env) {
  const FB = (env.FB_URL || '').replace(/\/+$/, '');
  if (!FB || !env.FB_SECRET) return;
  const A = '?auth=' + encodeURIComponent(env.FB_SECRET);
  const data = {};
  for (const node of ['chats', 'convos', 'users', 'friends', 's2s', 'groups', 'userGroups', 'admin']) {
    try { data[node] = await (await fetch(FB + '/' + node + '.json' + A)).json(); } catch (e) {}
  }
  // P13: 直近2年のテキストのみ退避（~10MB維持・Firebaseは正のまま縮小せず）。
  //   ・2年より古いメッセージはバックアップ対象外（Firebase本体は削除しない＝purgeは検証後まで無効）。
  //   ・画像inline(dataURL)は除外（テキストのみ）。本文 t は暗号文のまま温存。
  const TWO_YR = 730 * 24 * 3600 * 1000, _now = Date.now();
  try { if (data.chats) for (const cid in data.chats) { const c = data.chats[cid]; if (c && c.msgs) for (const k in c.msgs) { const mm = c.msgs[k]; if (!mm) continue;
    if (mm.ts && (_now - mm.ts) > TWO_YR) { delete c.msgs[k]; continue; }   // 2年より古い=退避しない
    if (mm.img) mm.img = '[img]';                                            // 画像inlineは除外
  } } } catch (e) {}
  const json = JSON.stringify({ at: Date.now(), iso: new Date().toISOString(), data: data });
  // R2 があれば保存（任意）
  if (env.BACKUP_BUCKET) { try { await env.BACKUP_BUCKET.put('rtdb-' + new Date().toISOString().slice(0, 10) + '.json', json, { httpMetadata: { contentType: 'application/json' } }); } catch (e) {} }
  // Telegram に document として送信（既定のバックアップ先）
  if (env.TG_TOKEN && env.TG_CHAT) {
    try {
      const fd = new FormData();
      fd.append('chat_id', String(env.TG_CHAT));
      fd.append('caption', 'RTDB backup ' + new Date().toISOString());
      fd.append('document', new Blob([json], { type: 'application/json' }), 'rtdb-backup-' + new Date().toISOString().slice(0, 10) + '.json');
      await fetch('https://api.telegram.org/bot' + env.TG_TOKEN + '/sendDocument', { method: 'POST', body: fd });
    } catch (e) {}
  }
}
