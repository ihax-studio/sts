/* ============================================================================
   media-r2.js — Shake to Shake メディア配信 Worker（Cloudflare R2／最大100GB級）
   ----------------------------------------------------------------------------
   役割: PWA から画像/動画を受け取り R2 に保存し、公開URLを返す。
     ・画像/動画の本体は R2（最大100GB）に置く＝Firebase(無料枠)を太らせない
     ・Firebase には短いURLだけ保存＝送信が軽い・会話が重くならない・動画も送れる
     ・URLは消えない＝写真/動画ごと会話が永続（勝手に消えない）
   ----------------------------------------------------------------------------
   セットアップ（あなた）:
     1. R2 バケットを作成:           wrangler r2 bucket create s2s-media
     2. wrangler-media.toml を使う:  ↓のbindingを確認（MEDIA = そのバケット）
     3. デプロイ:                    wrangler deploy -c worker/wrangler-media.toml
     4. 出てきたURL（例 https://s2s-media.<account>.workers.dev）を
        index.html の  var MEDIA_URL="..."  に貼る → 全クライアントがR2配信へ
   ----------------------------------------------------------------------------
   エンドポイント:
     POST /up?name=foo.jpg&type=image/jpeg   body=バイト列  → { ok:true, url:"https://.../m/<key>" }
     GET  /m/<key>                           → メディア本体（長期キャッシュ）
     GET  /  /health                         → { ok:true }
   制限: 1ファイル最大 ALLOW_MB（既定 60MB）。CORS は env.ALLOW（既定 *）。
   ========================================================================== */

const DEFAULT_MAX_MB = 60;

export default {
  // ===== S6: ライフサイクル cron。s2s 投稿で参照されていない孤児オブジェクトを掃除し、
  //   合計が CAP_MB(既定700MB)を超えたら古い順に削除。fav(お気に入り)＝保護。 =====
  //   ・wrangler-media.toml の [triggers] crons と、secret FB_URL / FB_SECRET が必要。
  //   ・このバケット(MEDIA)は s2s 専用前提（チャット画像は別Worker=Telegram）。混在させないこと。
  async scheduled(event, env, ctx) {
    ctx.waitUntil(s2sLifecycle(env).catch(() => {}));
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

    if (!env.MEDIA) return json({ ok: false, err: 'R2 binding (MEDIA) not configured' }, 500, cors);

    try {
      // ---- アップロード ----
      if (req.method === 'POST' && url.pathname === '/up') {
        const name = (url.searchParams.get('name') || 'file').replace(/[^\w.\-]/g, '_').slice(0, 80);
        const type = (url.searchParams.get('type') || req.headers.get('content-type') || 'application/octet-stream').slice(0, 120);
        const maxMB = env.ALLOW_MB ? parseInt(env.ALLOW_MB, 10) : DEFAULT_MAX_MB;
        const bytes = await req.arrayBuffer();
        if (!bytes || bytes.byteLength === 0) return json({ ok: false, err: 'empty' }, 400, cors);
        if (bytes.byteLength > maxMB * 1024 * 1024) return json({ ok: false, err: 'too big (>' + maxMB + 'MB)' }, 413, cors);

        // 衝突しないキー（日付プレフィックス + ランダム + 拡張子）
        const ext = (name.match(/\.[A-Za-z0-9]{1,5}$/) || [''])[0];
        const key = new Date().toISOString().slice(0, 10) + '/' + rand(20) + ext;
        await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: type, cacheControl: 'public, max-age=31536000, immutable' } });

        const origin = (env.PUBLIC_BASE && env.PUBLIC_BASE.replace(/\/+$/, '')) || (url.origin);
        return json({ ok: true, key, url: origin + '/m/' + key }, 200, cors);
      }

      // ---- ダウンロード/配信 ----
      if (req.method === 'GET' && url.pathname.startsWith('/m/')) {
        const key = decodeURIComponent(url.pathname.slice(3));
        if (!key) return json({ ok: false, err: 'no key' }, 400, cors);
        const obj = await env.MEDIA.get(key);
        if (!obj) return new Response('not found', { status: 404, headers: cors });
        const h = new Headers(cors);
        obj.writeHttpMetadata(h);
        h.set('Cache-Control', 'public, max-age=31536000, immutable');
        h.set('Accept-Ranges', 'bytes');
        h.set('etag', obj.httpEtag);
        return new Response(obj.body, { headers: h });
      }

      // ---- 取消時の実体削除（任意・URL末尾のkeyで）----
      if (req.method === 'POST' && url.pathname === '/rm') {
        const key = url.searchParams.get('key');
        if (key) { try { await env.MEDIA.delete(key); } catch (e) {} }
        return json({ ok: true }, 200, cors);
      }

      if (url.pathname === '/' || url.pathname === '/health') return json({ ok: true, service: 's2s-media-r2' }, 200, cors);
      return json({ ok: false, err: 'not found' }, 404, cors);
    } catch (e) {
      return json({ ok: false, err: String((e && e.message) || e) }, 500, cors);
    }
  },
};

function rand(n) {
  const a = new Uint8Array(n); crypto.getRandomValues(a);
  let s = ''; const c = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < n; i++) s += c[a[i] % c.length];
  return s;
}

// ---- S6: ライフサイクル本体 ----
// 仕様対応:
//  ・700MB上限(env.CAP_MB)で eviction。fav投稿のキーは保護。
//  ・「現行投稿が参照していない孤児」を最優先で削除（s2s/<uid> は最新1件で上書き＝旧画像は即孤児になる）。
//  ・現スキーマは1ユーザー最新1件のため「recent5 / first / dedup」は対象が無い(将来 履歴スキーマで対応)。
//  ・古い投稿の 500x500/1024色 への再圧縮は Workers 単体では画像処理不可のため非対応（Cloudflare Images等が必要）。
//    クライアントが既に ≈800px/≈33k色(≤77KB) で上げるため通常は700MBに到達しにくい。
// 成功時は parse 結果(null=空ツリー)を返す。認証/権限エラーは throw（呼び出し側で中止＝誤削除防止）。
async function fbGet(env, path) {
  const FB = (env.FB_URL || '').replace(/\/+$/, '');
  const r = await fetch(FB + '/' + path + '.json?auth=' + encodeURIComponent(env.FB_SECRET));
  if (!r.ok) throw new Error('fb ' + r.status);
  return await r.json();
}
function keyFromRef(x) { const m = String(x || '').match(/\/m\/(.+)$/); return m ? decodeURIComponent(m[1]) : null; }
async function s2sLifecycle(env) {
  if (!env.MEDIA) return;
  if (!env.FB_URL || !env.FB_SECRET) return;   // ★参照判定が出来ない＝安全側で何もしない（全消し事故の防止）
  const CAP = (env.CAP_MB ? parseInt(env.CAP_MB, 10) : 700) * 1024 * 1024;

  // 1) Firebase の現行 s2s 投稿から「参照中キー」と「fav 保護キー」を収集
  const referenced = new Set(), favKeys = new Set();
  let s2s;
  try { s2s = await fbGet(env, 's2s'); } catch (e) { return; }   // ★Firebaseが読めない時は中止（孤児判定が誤って全件削除になるのを防ぐ）
  if (s2s) for (const uid in s2s) {
    const p = s2s[uid]; if (!p) continue;
    const ks = [];
    if (Array.isArray(p.keys)) for (const k of p.keys) { if (k) ks.push(String(k)); }            // 投稿が保存した R2 キー
    if (Array.isArray(p.imgs)) for (const u of p.imgs) { const k = keyFromRef(u); if (k) ks.push(k); } // imgs が R2 URL の場合はキー抽出
    for (const k of ks) { referenced.add(k); if (p.fav) favKeys.add(k); }
  }

  // 2) R2 全オブジェクト列挙（key/size/uploaded）
  let cursor = undefined, objs = [];
  do { const list = await env.MEDIA.list({ limit: 1000, cursor }); objs = objs.concat(list.objects || []); cursor = list.truncated ? list.cursor : undefined; } while (cursor);
  let total = objs.reduce((a, o) => a + (o.size || 0), 0);
  const now = Date.now(), GRACE = 24 * 3600000;   // 直近24hの新規は猶予（投稿直前のアップロードを誤削除しない）

  // 3) 孤児(未参照)を古い順に削除
  const orphans = objs.filter(o => !referenced.has(o.key) && (now - new Date(o.uploaded).getTime()) > GRACE)
                      .sort((a, b) => new Date(a.uploaded) - new Date(b.uploaded));
  for (const o of orphans) { try { await env.MEDIA.delete(o.key); total -= (o.size || 0); } catch (e) {} }

  // 4) まだ CAP 超過なら、参照中かつ非fav を古い順に削除（通常はここに来ない安全弁）
  if (total > CAP) {
    const evictable = objs.filter(o => referenced.has(o.key) && !favKeys.has(o.key))
                          .sort((a, b) => new Date(a.uploaded) - new Date(b.uploaded));
    for (const o of evictable) { if (total <= CAP) break; try { await env.MEDIA.delete(o.key); total -= (o.size || 0); } catch (e) {} }
  }
}
function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
}
