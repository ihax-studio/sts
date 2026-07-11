/* worker/s2s-push.js — Shake to Shake のスケジュール通知（Cloudflare Worker / cron）
 * ------------------------------------------------------------------------------
 * 役割: 「シェイクタイム」が開いた瞬間に、s2s対応(通知ON)ユーザーへ Web Push を一斉送信する。
 *   ・index-s2s.js のクライアントと“同じ”スケジュール式を使う（日付シード＝全員同時刻）。
 *   ・送信本体は既存の shake-push Worker(PUSH_URL) を再利用する想定（VAPID実装を二重持ちしない）。
 *
 * デプロイ前にやる事（あなた）:
 *   1. wrangler.toml に cron を設定（例: 15分毎）:  [triggers] crons = ["*\/15 * * * *"]   ← * と / の間のバックスラッシュは消す
 *   2. 環境変数(secret)を設定:
 *        FIREBASE_DB_URL  = https://ichat-pwa-default-rtdb.asia-southeast1.firebasedatabase.app
 *        FIREBASE_SECRET  = （RTDBの「データベースシークレット」= レガシートークン。push/$uid を読むため）
 *        PUSH_URL         = https://shake-push.s-users15.workers.dev/push   （既存の送信Worker）
 *   3. `wrangler deploy`
 *
 * 軽量設計: cronは15分毎だが「ウィンドウが今開いたか」だけ判定し、開いた回(1日3-5回)だけ送信。
 *           送信先は push/$uid（購読がある＝通知ONのユーザー）のみ。会話/画像は触らない。
 */

// ---- index-s2s.js と同じスケジュール（平日3-4回 7-19時 / 休日4-5h 5am〜1am・日付シード） ----
var JST = 9 * 3600000;   // クライアント(index-s2s.js)は端末ローカル時刻=JST。Workerもクライアント=Asia/Tokyo に合わせる（UTCのままだと通知が約9hズレる）
function dayTimes(d) {
  var dj = new Date(d.getTime() + JST);   // JSTの壁時計で 日付/シード を判定（クライアントの getFullYear/getMonth/getDate と一致）
  var seed = dj.getUTCFullYear() * 10000 + (dj.getUTCMonth() + 1) * 100 + dj.getUTCDate();
  function rnd(k) { var x = Math.sin(seed * 97.13 + k * 131.7) * 10000; return x - Math.floor(x); }
  // JST壁時計 h時 → 実UTC epoch: Date.UTC(JSTの年月日, h) − 9h（クライアントの setHours(h)=JST と一致）
  function at(h) { var hh = Math.floor(((h % 24) + 24) % 24), mm = Math.floor((h - Math.floor(h)) * 60); var base = Date.UTC(dj.getUTCFullYear(), dj.getUTCMonth(), dj.getUTCDate(), hh, mm, 0) - JST; if (h >= 24) base += Math.floor(h / 24) * 86400000; return base; }
  // S8: 毎日3〜5回・04:00〜23:30。index-s2s.js の dayTimes と式を完全一致させること(seed/rnd/n/frac)。
  var n = 3 + Math.floor(rnd(0) * 3), t = [], START = 4, END = 23.5;   // 3,4,5回
  for (var i = 0; i < n; i++) { var frac = (i + 0.18 + rnd(i + 1) * 0.64) / n; t.push(at(START + (END - START) * frac)); }
  return t.sort(function (a, b) { return a - b; });
}

// このcron実行で「直近INTERVAL分の間にウィンドウが開いたか」
function windowJustOpened(now, intervalMin) {
  var d = new Date(now); var times = dayTimes(d);
  var span = intervalMin * 60000;
  for (var i = 0; i < times.length; i++) { if (times[i] <= now && now - times[i] < span) return true; }
  return false;
}

async function fbGet(env, path) {
  var u = env.FIREBASE_DB_URL.replace(/\/+$/, '') + '/' + path + '.json?auth=' + encodeURIComponent(env.FIREBASE_SECRET);
  var r = await fetch(u); if (!r.ok) return null; return r.json();
}

// push/ 配下を再帰回収: flat(push/$uid=sub) と nested(管理者 push/and_admin/$uid=sub) の両方を endpoint 重複排除で集める
function collectAllSubs(root) {
  const out = [], seen = {};
  function add(s) { if (s && s.endpoint && !seen[s.endpoint]) { seen[s.endpoint] = 1; out.push(s); } }
  function walk(v, depth) {
    if (!v || typeof v !== 'object') return;
    if (v.endpoint) { add(v); return; }
    if (v.sub && v.sub.endpoint) { add(v.sub); return; }
    if (depth < 3) { for (const k in v) walk(v[k], depth + 1); }
  }
  walk(root, 0);
  return out;
}

async function sendOne(env, sub) {
  // 既存の shake-push Worker に投げる。★sub と subscription の両キーを送る＝動作中のメッセージ通知(sendPushTo)と同形式。
  //   shake-push は sub キーを期待しており、subscription だけだと「s2s通知が実際に届かない」原因になっていた。
  try {
    await fetch(env.PUSH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sub: sub, subscription: sub, title: 'Shake to Shake', body: '🫨シェイクをしよう👀', tag: 's2s', url: '/?s2s=1', s2s: 1 })   // S8: タップ→gc-sw.js が ?s2s=1 を検知→openShakePrompt(振って撮影)
    });
  } catch (e) {}
}

export default {
  async scheduled(event, env, ctx) {
    return;   // ★シェイクでシェアは全廃止(2026-07-04 ユーザ指示)＝毎日の「🫨シェイクをしよう」通知は送らない。?force=1の手動APIはfetchに残置。
  },

  // 管理者の手動ブロードキャスト API: GET ?force=1&key=<ADMIN_KEY> で全員へ「シェイクタイム」通知を即送信。
  // key は ADMIN_KEY シークレットと一致が必須（未設定/不一致は 403）＝管理者以外は叩けない。
  async fetch(req, env) {
    const url = new URL(req.url);
    const force = url.searchParams.get('force') === '1';
    if (force) {   // 手動送信は管理者キー必須（無認証の乱用を防ぐ）
      if (!env.ADMIN_KEY || url.searchParams.get('key') !== env.ADMIN_KEY) return new Response('forbidden', { status: 403 });
    }
    if (force || windowJustOpened(Date.now(), 15)) {
      const subs = await fbGet(env, 'push'); let n = 0;
      if (subs) { const all = collectAllSubs(subs); for (const sub of all) { await sendOne(env, sub); n++; } }
      return new Response('sent ' + n);
    }
    return new Response('not a window now');
  }
};
