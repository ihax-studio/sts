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

    // ---- iTunes検索プロキシ（Netlifyの /itunes-api リダイレクトをCloudflareへ移設=Netlifyリクエスト削減。エッジ10分キャッシュ=同じ検索語は上流にも行かない）----
    if (req.method === 'GET' && url.pathname === '/itunes') {
      try {
        const target = 'https://itunes.apple.com/search' + (url.search || '');
        const cache = caches.default, cacheKey = new Request(target);
        let r = await cache.match(cacheKey);
        if (!r) {
          const up = await fetch(target);
          const body = await up.text();
          r = new Response(body, { status: up.status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=600' } });
          if (up.ok) { try { await cache.put(cacheKey, r.clone()); } catch (e) {} }
        }
        const out = new Response(r.body, r);
        Object.keys(cors).forEach(k => out.headers.set(k, cors[k]));
        return out;
      } catch (e) { return json({ ok: false, err: String(e && e.message || e) }, 502, cors); }
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
