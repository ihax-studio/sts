/* =========================================================================
   Chat — Instagram-DM風の非同期チャット。
   裏側: 通信規格 Realtime Database 無料枠(Spark)。
   ・匿名認証 / 友達追加=QR(uid) or ユーザー名(name-1234)
   ・メッセージはサーバーに保存→相手がオフラインでも後で届く
   ・超軽量設計: limitToLast(50), 履歴ローカル100件キャップ, typing/presenceは揮発ノード
   ========================================================================= */
(function () {
'use strict';

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const el = (t, c) => { const e = document.createElement(t); if (c) e.className = c; return e; };
const now = () => Date.now();
const tag4 = () => String((Math.random() * 9000 + 1000) | 0);

/* ---------- storage (描画は常にtextContent → XSS不能) ---------- */
const LS = window.localStorage;
const K = { me: 'cx_me', friends: 'cx_friends', chats: 'cx_chats', set: 'cx_set' };
const load = (k, d) => { try { const v = JSON.parse(LS.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
const save = (k, v) => { try { LS.setItem(k, JSON.stringify(v)); } catch (e) {} };
let me = load(K.me, null);              // {name,icon,color,tag,handle}
let friends = load(K.friends, {});      // {peerUid:{name,icon,color,handle}}
let chats = load(K.chats, {});          // {peerUid:{msgs:[{id,t,ts,mine,read}],unread,last,peerRead}}
let groups = load('cx_groups', {});     // {gid:{name,members:[],owner,last,unread}}  グループチャット
const saveGroups = () => save('cx_groups', groups);
function isGroup(t) { return !!(groups && groups[t]); }
function cidOf(t) { return isGroup(t) ? t : pairId(uid, t); }   // 会話ID: グループはgid / 1:1はpairId
function _ghash(s) { let h = 0x811c9dc5 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); }
function groupId(members) { return 'g_' + _ghash([...new Set(members)].sort().join('|')); }   // メンバー集合で決定的=同一メンツは同一gid=重複不可
let settings = load(K.set, { notif: false, seen: true });
const saveFriends = () => save(K.friends, friends);
function trimLocalCache() {
  try {
    let size = JSON.stringify(chats).length;
    if (size <= 5 * 1024 * 1024) return;                                  // 5MB超で古い会話のキャッシュから消去（サーバから再取得可）
    const ids = Object.keys(chats).sort((a, b) => ((chats[a].last || {}).ts || 0) - ((chats[b].last || {}).ts || 0));
    for (const id of ids) { if (size <= 5 * 1024 * 1024) break; if (chats[id].msgs && chats[id].msgs.length) { chats[id].msgs = []; size = JSON.stringify(chats).length; } }
  } catch (e) {}
}
const saveChats = () => { trimLocalCache(); save(K.chats, chats); };
const chat = p => (chats[p] = chats[p] || { msgs: [], unread: 0, last: null, peerRead: 0 });
const HIST_CAP = 100;
const COLORS = ['#ff7ad9', '#0a84ff', '#34c759', '#ff9f0a', '#bf5af2', '#ff453a', '#64d2ff'];
const isStandalone = () => window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
const isIPad = () => /Macintosh/.test(navigator.userAgent) && (navigator.maxTouchPoints || 0) > 1;   // iPadOSはMacを名乗る
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || isIPad();
function iosMajor() { const ua = navigator.userAgent; let m = ua.match(/OS (\d+)_/); if (m) return parseInt(m[1]); if (isIPad()) { m = ua.match(/Version\/(\d+)/); if (m) return parseInt(m[1]); } return 0; }
const needsPWA = () => isIOS() && !isStandalone();   // iOS/iPadOSはPWAでのみチャット開始可

function tint(hex, a) { const n = parseInt((hex || '#0a84ff').slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }
function paintAvatar(node, c) { node.style.background = tint(c, .16); node.style.boxShadow = `inset 0 0 0 2px ${tint(c, .4)}, inset 0 1px 0 rgba(255,255,255,.5)`; }
function username() { return me ? me.name + ' ' + me.tag : ''; }
function handleKey(s) { return String(s || '').trim().toLowerCase().replace(/[.#$\/\[\]\s]/g, ''); }
function deep(hex) { const n = parseInt((hex || '#0a84ff').slice(1), 16); const r = ((n >> 16 & 255) * .82) | 0, g = ((n >> 8 & 255) * .82) | 0, b = ((n & 255) * .82) | 0; return '#' + (1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1); }
function invertColor(hex) { const n = parseInt((hex || '#000000').slice(1), 16); const r = 255 - ((n >> 16) & 255), g = 255 - ((n >> 8) & 255), b = 255 - (n & 255); return '#' + (1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1); }
function setIcon(node, icon, color) {
  if (!node) return;
  const prev = node.querySelector('.avatar-img'); if (prev) prev.remove();
  const imgUrl = (typeof icon === 'string' && icon.indexOf('img:') === 0) ? icon.slice(4) : null;
  if (imgUrl && /^(data:image\/|https:)/i.test(imgUrl)) {   // 任意ホストのhttp:/javascript:等を弾く＝ピア制御アバターURLによるゼロクリック追跡(IP/UA漏洩)防止
    node.textContent = '';
    const img = document.createElement('img'); img.className = 'avatar-img'; img.src = imgUrl;
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block;pointer-events:none';
    node.style.background = 'transparent'; node.style.boxShadow = 'none'; node.style.borderRadius = '';
    node.appendChild(img);
  } else {
    node.style.background = tint(color, .18); node.style.boxShadow = ''; node.style.borderRadius = '';
    node.textContent = imgUrl ? '🙂' : (icon || '🙂');   // 不正なimg:URLは生文字列を出さず既定絵文字に
  }
}

/* =========================================================================
   SOUND — Web Audio (Safari/iOS確実再生・初回タップでunlock)
   ========================================================================= */
const Snd = (() => {
  let ctx = null, unlocked = false; const buf = {};
  const files = { tap: 'sounds/spatial-exit.wav', on: 'sounds/Join.wav', off: 'sounds/Off.wav', fail: 'sounds/fail.wav', friend: 'sounds/friend.wav', taprr: 'sounds/taprr.m4a', open: 'sounds/openx.m4a', close: 'sounds/close.m4a', ex: 'sounds/ex.m4a', warn: 'sounds/warn.wav', sent: 'sounds/acknowledgment_sent.caf', received: 'sounds/acknowledgment_received.caf', arrow: 'sounds/FMR1Arrow-Build-B389.caf', scatter: 'sounds/FMR1Arrow-Scatter-B389.caf', msg: 'apps/announce-messages-tone-carplay.wav', pConn: 'sounds/enrollment-hands-fill.m4a', pEnter: 'sounds/Audio_Focus_Enter_Mode.m4a', pExit: 'sounds/Audio_Focus_Exit_Mode.m4a', pBack: 'sounds/Respring_Offhead.m4a', pErr: 'sounds/Text-Message-Acknowledgement-Exclamation.m4a', pDone: 'sounds/hello-first-writeon.m4a' };   // 近接ペアリング効果音
  function ensure() { if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } return ctx; }
  async function loadAll() { if (!ensure()) return; for (const k in files) { if (buf[k]) continue; try { const r = await fetch(files[k]); const ab = await r.arrayBuffer(); buf[k] = await new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej)); } catch (e) {} } }
  function unlock() { if (unlocked || !ensure()) return; if (ctx.state === 'suspended') ctx.resume(); try { const b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0); } catch (e) {} unlocked = true; loadAll(); }
  function play(name, vol) { if (!ensure() || !buf[name]) return; try { if (ctx.state === 'suspended') ctx.resume(); const s = ctx.createBufferSource(); s.buffer = buf[name]; const g = ctx.createGain(); g.gain.value = vol == null ? .6 : vol; s.connect(g); g.connect(ctx.destination); s.start(0); } catch (e) {} }
  return { unlock, play };
})();

/* =========================================================================
   HAPTICS — iOS input[switch]トリック + vibrateフォールバック
   ========================================================================= */
let hapEl = null;
function hapticInit() { const l = el('label'); l.setAttribute('aria-hidden', 'true'); l.style.cssText = 'position:absolute;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0'; const i = document.createElement('input'); i.type = 'checkbox'; i.setAttribute('switch', ''); l.appendChild(i); document.body.appendChild(l); hapEl = l; }
let _hapT = 0;   // 直近に触覚を鳴らした時刻（③b 全ボタンtap haptic の二重発火回避用）
function hpulse(n, gap) { _hapT = Date.now(); for (let i = 0; i < n; i++) setTimeout(() => { try { hapEl && hapEl.click(); } catch (e) {} }, i * (gap || 65)); }
const haptic = {
  tap() { hpulse(1); if (navigator.vibrate) navigator.vibrate(6); },
  confirm() { hpulse(2, 70); if (navigator.vibrate) navigator.vibrate([8, 36, 8]); },
  error() { hpulse(3, 70); if (navigator.vibrate) navigator.vibrate([10, 40, 10, 40, 10]); },
  errorBurst() { hpulse(9, 45); if (navigator.vibrate) navigator.vibrate([10, 40, 10, 40, 10, 40, 10, 40, 10]); },
  sel() { hpulse(1); if (navigator.vibrate) navigator.vibrate(4); }
};

/* Dynamic Island風通知（白地・黒字・radius77）。errorは左右シェイク+9連haptic+fail音。使用は最小限。 */
function toast(m, type) { const t = $('#toast'); t.textContent = m; t.classList.remove('err'); t.classList.add('show'); if (type === 'error') { void t.offsetWidth; t.classList.add('err'); haptic.errorBurst(); Snd.play('fail', .85); } clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), type === 'error' ? 2600 : 1700); }
function closeSnd() { Snd.play('tap', .5); }   // spatial-exit は「閉じる時」だけ
function shakeToggle(node) { if (!node) return; node.classList.remove('shake'); void node.offsetWidth; node.classList.add('shake'); setTimeout(() => node.classList.remove('shake'), 520); }
let loaderCT = null;
function loaderShow() { const l = $('#loader'); if (!l) return; l.classList.add('show'); l.classList.remove('cancelable'); clearTimeout(loaderCT); loaderCT = setTimeout(() => l.classList.add('cancelable'), 5000); }   // 5秒回ってもダメ→キャンセル出現
function loaderHide() { const l = $('#loader'); if (!l) return; clearTimeout(loaderCT); l.classList.remove('show', 'cancelable'); }

/* =========================================================================
   screens
   ========================================================================= */
const screens = ['scrReg', 'scrHome', 'scrChat', 'scrAdd', 'scrHandoff', 'scrPass'];
function show(id) { screens.forEach(s => { const n = $('#' + s); n.classList.toggle('active', s === id); n.classList.toggle('behind', screens.indexOf(s) < screens.indexOf(id)); }); document.getElementById('app').classList.toggle('on-home', id === 'scrHome'); if (id !== 'scrAdd') stopScan(); }

/* =========================================================================
   FIREBASE
   ========================================================================= */
let db = null, auth = null, uid = null, watching = false;
function fbConfigured() { const c = window.FIREBASE_CONFIG; return !!(window.firebase && c && c.apiKey && !/PASTE/.test(c.apiKey)); }
async function ensureAuth() {
  if (!fbConfigured()) { showSetup(); return false; }
  if (!firebase.apps.length) {
    firebase.initializeApp(window.FIREBASE_CONFIG);
    try { if (firebase.appCheck && window.RECAPTCHA_SITE_KEY) firebase.appCheck().activate(window.RECAPTCHA_SITE_KEY, true); } catch (e) {}   // App Check(ボット対策)。強制ONはConsoleで後から
  }
  if (!auth) { auth = firebase.auth(); db = firebase.database(); await new Promise(res => { const un = auth.onAuthStateChanged(() => { un(); res(); }); }); }
  if (!auth.currentUser) { try { await auth.signInAnonymously(); } catch (e) { return false; } }
  uid = auth.currentUser && auth.currentUser.uid; return !!uid;
}
function pairId(a, b) { return a < b ? a + '__' + b : b + '__' + a; }
const TS = () => firebase.database.ServerValue.TIMESTAMP;

/* ---------- 暗号化（保存時暗号化 / 会話ごとの導出鍵）----------
   ・鍵 = PBKDF2(window.CHAT_PEPPER, salt = "mtm|" + cid)  →  AES-GCM-256
   ・cid（=2人のuidをソートした文字列）を知っていれば誰でも同じ鍵を導けるので、
     当事者2人＋管理者「と」(convosでcidを読める)が復号できる＝中継/プレビュー/empty modeが従来どおり動く。
   ・通信規格 には常に "e1:" + base64(iv12 ‖ 暗号文) を保存。平文は一切載せない。
   ・追加のネットワークリクエストは0（端末内CPUのみ）。鍵はcid単位でキャッシュ＝導出は会話ごと1回だけ。
   ・旧データ/平文(e1:なし)はそのまま素通し（後方互換）。復号失敗は🔒表示。 */
const _ck = {};                                  // cid → CryptoKey キャッシュ
const _subtle = (window.crypto && window.crypto.subtle) ? window.crypto.subtle : null;
function _b64e(buf) { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
function _b64d(str) { const s = atob(str); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; }
async function cidKey(cid) {
  if (_ck[cid]) return _ck[cid];
  const enc = new TextEncoder();
  const base = await _subtle.importKey('raw', enc.encode(window.CHAT_PEPPER || 'mtm-fallback'), 'PBKDF2', false, ['deriveKey']);
  const key = await _subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('mtm|' + cid), iterations: 100000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return (_ck[cid] = key);
}
async function encWith(cid, plain) {                                  // 平文 → "e1:..."（subtle不可/失敗時は平文フォールバックで送信不能を回避）
  if (plain == null) return plain;
  plain = String(plain);
  if (!_subtle || !cid) return plain;
  try {
    const key = await cidKey(cid);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const ct = await _subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
    const out = new Uint8Array(12 + ct.byteLength); out.set(iv, 0); out.set(new Uint8Array(ct), 12);
    return 'e1:' + _b64e(out);
  } catch (e) { return plain; }
}
async function decWith(cid, val) {                                   // "e1:..." → 平文（平文/旧データは素通し・失敗は🔒）
  if (typeof val !== 'string' || val.indexOf('e1:') !== 0) return val;
  if (!_subtle || !cid) return '🔒';
  try {
    const key = await cidKey(cid);
    const raw = _b64d(val.slice(3));
    const pt = await _subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, key, raw.slice(12));
    return new TextDecoder().decode(pt);
  } catch (e) { return '🔒'; }
}
let discT = null;   // 通信規格切断のデバウンス用
let fbConnected = false;   // 通信規格サーバー接続中か（オフライン送信判定用）

function watchAll() {
  if (watching || !db || !uid) return; watching = true;
  db.ref('admin/uid').on('value', s => { const a = s.val(); if (!me) return; if (me.admin) { if (a !== uid) db.ref().update(a ? { 'admin/uid': uid, 'admin/secretTry': ADMIN_PASS } : { 'admin/uid': uid, 'admin/secret': ADMIN_PASS }).catch(() => {}); } else { me.admin = (a === uid); save(K.me, me); } if (me.admin) watchAdminUsers(); renderList(); });   // 管理者: uidが変わってもsecret(ADMIN_PASS)で再claim→/users再取得
  db.ref('users/' + uid).on('value', s => {
    const u = s.val();
    if (me && me.admin) { if (u) { me.approved = !!u.approved; save(K.me, me); } return; }
    if (u && u.suspended) { showSuspended(); return; }   // 明示的に suspended の時だけ。null(権限403/未同期/オフライン/未作成)で停止画面を出して全UI(検索等)を塞ぐ不具合の根治
    if (me && u) { me.approved = !!u.approved; save(K.me, me); }
  });
  db.ref('admin/open').on('value', s => { founderOpen = !!s.val(); const t = $('#tgFounder'); if (t) t.classList.toggle('on', founderOpen); }, () => {});   // 🎓 招待受付の状態

  db.ref('.info/connected').on('value', s => { const on = !!s.val(); fbConnected = on; if (on) { const r = db.ref('status/' + uid); r.onDisconnect().remove(); r.set(true); clearTimeout(discT); setNet(false); } else { clearTimeout(discT); discT = setTimeout(() => setNet(true), 3000); } });   // サーバーに繋げない時はフォルダ?island
  db.ref('friends/' + uid).on('value', snap => {
    const v = snap.val() || {};
    Object.keys(v).forEach(p => { if (!friends[p]) { friends[p] = { name: '', icon: '🙂', color: '#0a84ff' }; fetchProfile(p); } watchLast(p); });
    saveFriends(); renderList();
  });
  db.ref('userGroups/' + uid).on('value', snap => {                      // 自分が入っているグループ
    const v = snap.val() || {};
    Object.keys(groups).forEach(g => { if (!v[g]) { delete groups[g]; if (lastWatch[g]) { try { db.ref('chats/' + g + '/last').off(); } catch (e) {} delete lastWatch[g]; } } });   // 抜けた/解散
    Object.keys(v).forEach(g => { if (!groups[g]) { groups[g] = { name: '', members: [], owner: '', last: null, unread: 0 }; fetchGroup(g); } watchLast(g); });
    saveGroups(); renderList();
  });
}
function fetchProfile(p) { db.ref('users/' + p).once('value').then(s => { const u = s.val(); if (!u) return; friends[p] = { name: String(u.n || '').slice(0, 20), icon: String(u.i || '🙂').slice(0, 60), color: /^#[0-9a-f]{6}$/i.test(u.c) ? u.c : '#0a84ff', handle: u.h, approved: !!u.approved }; saveFriends(); renderList(); if (curPeer === p) paintChatHead(p); }).catch(() => {}); }

const lastWatch = {};
function watchLast(p) {
  if (lastWatch[p] || !db) return; lastWatch[p] = true;
  db.ref('chats/' + cidOf(p) + '/last').on('value', async s => {
    const l = s.val(); if (!l) return; const c = chat(p);
    l.t = await decWith(cidOf(p), l.t);                        // プレビューを復号（通知/一覧に平文で出す）
    const _overlayUp = !!document.querySelector('#appOv.show, #cineOv.show');   // アプリ/cinema studio等が前面に被さっているか
    const viewing = curPeer === p && $('#scrChat').classList.contains('active') && document.visibilityState === 'visible' && !_overlayUp;
    if (l.f !== uid && !viewing && (!c.last || l.ts > c.last.ts)) { c.unread = (c.unread || 0) + 1; notify(p, friends[p] || {}, l.t); if (document.visibilityState === 'visible' && settings.inAppNotif !== false) { try { showAppBanner(p, friends[p] || {}, l.t); } catch (e) {} } }   // 前面=アプリ内iOS風バナー(最前列/cinema studio上にも・default on)。背面=notify()がOS通知に回す
    c.last = l; saveChats(); renderList();
  });
}

/* =========================================================================
   REGISTER
   ========================================================================= */
const REG_EMOJI = ['🙂', '😎', '🥳', '😺', '🦊', '🐻', '🐼', '🐧', '🦄', '🌟', '🍀', '🔥', '🌈', '🍎', '⚡️', '👾'];

/* ===== 感情エモジ・ピッカー（ネコ⇄人間トグル）===== */
const EMO = {
  cat: ['🐱', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾'],
  human: ['😁', '😂', '😍', '😏', '😰', '😉', '🫩', '😓', '🥵', '🫨', '😵‍💫', '😈', '😪', '🥲', '🥺', '😡']
};
let pickSet = 'human', pickCb = null, pickCurrent = '🙂';
function openEmojiPicker(current, cb) { pickCb = cb; pickCurrent = current || '🙂'; pickSet = EMO.cat.indexOf(current) >= 0 ? 'cat' : 'human'; renderPicker(); $('#epick').classList.add('show'); Snd.play('open', .7); }
function closePicker() { $('#epick').classList.remove('show'); }
{ const _ep = $('#epick'); if (_ep) _ep.addEventListener('pointerdown', e => { if (e.target === _ep || (e.target.classList && e.target.classList.contains('epick-stage'))) closePicker(); }); }   // 外側タップで即閉じる
function renderPicker() {
  const ring = $('#epickRing'); ring.innerHTML = '';
  const list = EMO[pickSet], n = list.length, R = 138, cx = 160, cy = 150, span = 300, start = -150;
  list.forEach((e, i) => {
    const a = (start + (n > 1 ? i * (span / (n - 1)) : 0)) * Math.PI / 180;
    const b = el('button', 'epick-em'); b.textContent = e; b.style.animationDelay = (i * 0.025) + 's';
    b.style.left = (cx + R * Math.sin(a)) + 'px'; b.style.top = (cy - R * Math.cos(a)) + 'px';
    b.onmouseenter = () => Snd.play('ex', .8);                       // PCホバー
    b.onclick = () => {                                              // タップで即その絵文字に変更＋中央でポップ→閉じる
      pickCurrent = e;
      const ctr = $('#epickCenter'); if (ctr) { ctr.textContent = e; ctr.classList.remove('pop'); void ctr.offsetWidth; ctr.classList.add('pop'); }
      if (pickCb) pickCb(e);                                         // 即適用（押したらすぐ変わる）
      Snd.play('close', 1); haptic.tap();
      setTimeout(closePicker, 300);                                  // ポップを見せてから閉じる
    };
    ring.appendChild(b);
  });
  { const ctr = $('#epickCenter'); if (ctr) ctr.textContent = pickCurrent || '🙂'; }   // 中央に「選択中の絵文字」
  const tg = $('#epickToggle'); tg.className = 'epick-toggle ' + pickSet; tg.textContent = pickSet === 'cat' ? '😉' : '😺';
}
let regIcon = '🙂', regColor = COLORS[0];
function buildReg() {
  const sw = $('#regSw'); sw.textContent = '';
  COLORS.forEach((c, i) => { const d = el('div', 'sw' + (i === 0 ? ' on' : '')); d.style.background = c; d.onclick = () => { regColor = c; [...sw.children].forEach(x => x.classList.remove('on')); d.classList.add('on'); $('#regAva').style.background = tint(c, .18); haptic.sel(); }; sw.appendChild(d); });
  const ava = $('#regAva'); ava.style.background = tint(regColor, .18); ava.textContent = regIcon;
  ava.onclick = () => openEmojiPicker(regIcon, e => { regIcon = e; ava.textContent = e; ava.style.transform = 'scale(1.12)'; setTimeout(() => ava.style.transform = '', 180); });
  const name = $('#regName'), go = $('#regGo');
  name.oninput = () => { go.disabled = !name.value.trim(); };
  go.onclick = () => registerMe(name.value.trim().slice(0, 20));
  const pwa = needsPWA();
  ['#regAva', '#regName', '#regSw', '#regGo', '#regHandoff', '#regLead'].forEach(s => { const n = $(s); if (n) n.classList.toggle('hidden', pwa); });
  { const a = $('#regA2H'); if (a) a.classList.toggle('hidden', !pwa); }
}
function founderLink() { try { return /founder/i.test(location.hash) || /[?&]f(ounder)?=/i.test(location.search); } catch (e) { return false; } }
let founderOpen = false;                                              // 🎓 招待受付(admin/open) のキャッシュ
function connectFounder() {                                            // 🎓ON時のみ: 新規アカを「と」と繋ぎ承認(888/日)
  if (!db || !uid) return;
  db.ref('admin').once('value').then(s => {
    const adm = s.val() || {}; const a = adm.uid; if (!a || a === uid) return;
    if (adm.open !== true) { toast('招待は今受付けていません', 'error'); return; }   // 🎓トグルOFFなら繋がない
    const ups = {}; ups['friends/' + uid + '/' + a] = true; ups['friends/' + a + '/' + uid] = true; ups['users/' + uid + '/approved'] = true;
    db.ref().update(ups).catch(() => {});
    friends[a] = { name: 'と', icon: 'img:/founder.png', color: '#1c1c1e', approved: true }; saveFriends();
    fetchProfile(a); watchLast(a); renderList();
  }).catch(() => {});
}
async function registerMe(nm) {
  if (!nm || needsPWA()) return;
  const wantFounder = /@founder\s*$/i.test(nm) || founderLink();      // 末尾@founder か 招待リンク → と と繋ぐ
  nm = nm.replace(/@founder\s*$/i, '').trim(); if (!nm) return;
  loaderShow();
  try {
    const ok = await ensureAuth(); if (!ok) { setNet(true); if (fbConfigured()) toast('オンラインで開いて登録してね', 'error'); return; }
    let tag = '', h = '', claimed = false;
    for (let i = 0; i < 6; i++) {
      tag = tag4(); h = handleKey(nm + tag);
      try { const res = await db.ref('handles/' + h).transaction(cur => cur === null ? uid : undefined); if (res.committed) { claimed = true; break; } } catch (e) {}
    }
    if (!claimed) { toast('登録に失敗しました', 'error'); return; }
    me = { name: nm, icon: regIcon, color: regColor, tag, handle: h };
    save(K.me, me);
    db.ref('users/' + uid).set({ n: nm, i: me.icon, c: me.color, g: tag, h });
    if (wantFounder) connectFounder();                                // と と繋いだ状態で作成
    applyMe(); watchAll(); enterHome();
  } finally { loaderHide(); }
}
function setAppIcon(icon, color) {                                     // 登録した絵文字/画像 → アプリ(ホーム)アイコン & favicon
  try {
    let href;
    if (typeof icon === 'string' && icon.indexOf('img:') === 0) { href = icon.slice(4); }
    else {
      const s = 180, cv = document.createElement('canvas'); cv.width = cv.height = s; const cx = cv.getContext('2d');
      cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, s, s);
      cx.fillStyle = tint(color, .3); cx.fillRect(0, 0, s, s);
      cx.font = '118px "Apple Color Emoji","Segoe UI Emoji",-apple-system,sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
      cx.fillText(icon || '🙂', s / 2, s / 2 + 8);
      href = cv.toDataURL('image/png');
    }
    { let l = document.querySelector('link[rel="icon"]'); if (!l) { l = document.createElement('link'); l.rel = 'icon'; document.head.appendChild(l); } l.href = href; }   // faviconのみ。ホーム画面アイコンはOSがライト/ダークで自動選択
  } catch (e) {}
}
function applyMe() {
  document.documentElement.style.setProperty('--me-color', me.color);
  setAppIcon(me.icon, me.color);
  $('#meName').textContent = me.name;
  setIcon($('#meAva'), me.icon, me.color);
  setIcon($('#ppAva'), me.icon, me.color);
  $('#ppName').textContent = me.name;
  $('#addUname').textContent = username();
  { const cs = $('#profCss'); if (cs) cs.classList.toggle('hidden', !me.admin); }   // CSSエディタは管理者のみ
  { const fl = $('#btnFounderLink'); if (fl) fl.classList.toggle('hidden', !me.admin); }   // 招待リンクは管理者のみ
  { const fc = $('#tgFounderCol'); if (fc) fc.classList.toggle('hidden', !me.admin); }   // 🎓トグルは管理者のみ
}

/* =========================================================================
   HOME / list
   ========================================================================= */
function enterHome() { renderList(); show('scrHome'); try { window.cxShowHello && window.cxShowHello(); } catch (e) {} }   // ホーム到達でこんにちは（登録前のみ＝gate内蔵）
function renderList() {
  const list = $('#convList'); if (!list) return; list.textContent = '';
  if (me && me.admin) { renderAdminList(list); return; }                 // 管理者は全登録ユーザーを表示
  const ids = Object.keys(friends).sort((a, b) => ((chat(b).last || {}).ts || 0) - ((chat(a).last || {}).ts || 0));
  if (!ids.length && !Object.keys(groups).length) { const e = el('div', 'empty'); const b = el('div', 'big'); b.textContent = '💬'; const p = el('p'); p.textContent = '右下の + から\nQRかユーザー名で友達追加。'; e.append(b, p); list.appendChild(e); return; }   // 友達0でもグループがあれば空状態にせずグループを描画
  Object.keys(groups).sort((a, b) => ((groups[b].last || {}).ts || 0) - ((groups[a].last || {}).ts || 0)).forEach(gid => {
    const g = groups[gid], c = chat(gid);
    const card = el('div', 'conv grp' + (c.unread ? ' has-unread' : '') + (_selMode && _selSet[gid] ? ' sel' : ''));
    const st = el('div', 'grp-stack'); (g.members || []).slice(0, 3).forEach((u, i) => { const a = el('div', 'grp-ava'); const pr = (u === uid) ? me : friends[u]; setIcon(a, (pr || {}).icon, (pr || {}).color); st.appendChild(a); });
    const nm = el('div', 'conv-nm'); nm.textContent = g.name || 'グループ';
    const pv = el('div', 'conv-pv'); pv.textContent = (c.last ? adminEmptyClean(c.last.t) : ((g.members || []).length + '人'));
    card.append(st, nm, pv);
    card.onclick = () => { if (_selMode) return; openChat(gid); };
    list.appendChild(card);
  });
  ids.forEach(pid => {
    const f = friends[pid], c = chat(pid), last = c.last;
    const card = el('div', 'conv' + (c.unread ? ' has-unread' : '') + (_selMode && _selSet[pid] ? ' sel' : ''));
    const nm = el('div', 'conv-nm'); nm.textContent = f.name || '…';
    const pv = el('div', 'conv-pv'); pv.textContent = last ? adminEmptyClean(last.t) : '';   // cxq:/cxsty: 等の生ペイロードを出さない
    card.append(nm, pv);
    if (me && me.admin) {
      const top = el('div', 'conv-top');
      const tr = el('button', 'conv-adm'); tr.innerHTML = '<img src="/arrow.up.trash.png" alt="">'; tr.onclick = e => { e.stopPropagation(); suspendUser(pid); };
      const pn = el('button', 'conv-adm'); pn.innerHTML = '<img src="icons/' + (f.approved ? 'pin.fill.png' : 'pin.slash.png') + '" alt="">'; pn.onclick = e => { e.stopPropagation(); toggleApprove(pid, f); };
      top.append(tr, pn); card.appendChild(top);
    }
    let lp = null; const clr = () => { if (lp) { clearTimeout(lp); lp = null; } };
    card.addEventListener('pointerdown', e => { if (e.target.closest('.conv-minus, .conv-adm')) return; clr(); if (_selMode) return; lp = setTimeout(() => { lp = null; tryEnterSel(pid, card); }, 200); });   // 0.2s長押し→グループ選択
    card.addEventListener('pointerup', clr); card.addEventListener('pointermove', clr); card.addEventListener('pointercancel', clr);
    card.onclick = () => { if (_selMode) { toggleSel(pid, card); return; } if (card._justArmed) return; if (card.classList.contains('armed')) { disarmCard(card); return; } openChat(pid); };
    list.appendChild(card);
  });
}
function armCard(card, pid) {                                          // iOS風: 長押し→ーボタン
  if (card.classList.contains('armed')) return;
  card.classList.add('armed'); card._justArmed = true; setTimeout(() => { card._justArmed = false; }, 400); haptic.confirm();
  const minus = el('button', 'conv-minus'); minus.textContent = '−'; card.appendChild(minus);
  let hold = null;
  const start = e => { e.stopPropagation(); card.classList.remove('armed'); card.classList.add('deleting'); minus.classList.add('holding'); hold = setTimeout(() => { card.classList.add('removing'); haptic.error(); setTimeout(() => doDeleteConv(pid), 380); }, 300); };
  const cancel = () => { clearTimeout(hold); if (!card.classList.contains('removing')) { card.classList.remove('deleting'); card.classList.add('armed'); } minus.classList.remove('holding'); };
  minus.addEventListener('pointerdown', start); minus.addEventListener('pointerup', cancel); minus.addEventListener('pointerleave', cancel); minus.addEventListener('pointercancel', cancel);
}
function disarmCard(card) { card.classList.remove('armed'); const m = card.querySelector('.conv-minus'); if (m) m.remove(); }
function doDeleteConv(pid) {
  delete chats[pid]; delete friends[pid]; saveChats(); saveFriends();
  if (db && uid) { const ups = {}; ups['friends/' + uid + '/' + pid] = null; ups['friends/' + pid + '/' + uid] = null; db.ref().update(ups).catch(() => {}); }
  if (lastWatch[pid] && db) { try { db.ref('chats/' + pairId(uid, pid) + '/last').off(); } catch (e) {} delete lastWatch[pid]; }
  renderList();
}
function fetchGroup(g) {
  db.ref('groups/' + g).once('value').then(async s => {
    const d = s.val(); if (!d) return;
    groups[g] = groups[g] || {}; groups[g].members = Object.keys(d.m || {}); groups[g].owner = d.o;
    groups[g].name = await decWith(g, d.n || '');
    // メンバーは選択時=友達。未知メンバー(他者作成)はデフォルトアバターで表示(friendsを汚さない)
    saveGroups(); renderList();
  }).catch(() => {});
}
async function createGroupFromSel() {
  const sel = Object.keys(_selSet).filter(x => _selSet[x] && x !== uid);
  const members = [...new Set([uid, ...sel])];
  if (members.length < 3) { toast('3人以上で作れます', 'error'); haptic.error(); return; }
  if (Object.keys(groups).length >= 3) { toast('グループは3つまで', 'error'); haptic.error(); return; }
  const gid = groupId(members);
  if (groups[gid]) { toast('同じメンバーのグループは既にあります', 'error'); haptic.error(); return; }
  if (!db || !uid) return;
  try {
    const snap = await db.ref('groups/' + gid).once('value');
    if (snap.exists()) { toast('同じメンバーのグループは作れません', 'error'); haptic.error(); return; }
    const names = members.map(u => u === uid ? (me && me.name || '自分') : ((friends[u] || {}).name || '…'));
    const name = names.join('・').slice(0, 40);
    const mObj = {}; members.forEach(u => mObj[u] = true);
    const encName = await encWith(gid, name), encLast = await encWith(gid, 'グループを作成しました');
    // ① グループ本体＋メンバーシップを先に確定する（この後 root に groups/<gid>/m/<uid> が入る）
    const ups = {};
    ups['groups/' + gid] = { n: encName, m: mObj, o: uid, ts: TS() };
    members.forEach(u => ups['userGroups/' + u + '/' + gid] = true);
    await db.ref().update(ups);
    // ①成功＝即ローカルにも反映(watchGroupsの到着を待たず一覧に出す)
    groups[gid] = { name: name, members: members, owner: uid, last: null, unread: 0 }; saveGroups();
    // ② chats/<gid>/last は別書き込み。last の write ルールは groups/<gid>/m/<uid> を参照するため①と同一アトミック更新だと403→分離(本バグの真因)
    try { await db.ref('chats/' + gid + '/last').set({ f: uid, t: encLast, ts: TS() }); } catch (e) {}
    haptic.confirm(); toast('グループを作成しました'); exitSelMode(); renderList();
  } catch (e) { console.warn('createGroup fail', e); toast((e && /permission|PERMISSION/.test(String(e.code || e.message || e))) ? 'グループ作成にはルール反映が必要です' : '作成できませんでした', 'error'); haptic.error(); }
}
async function leaveGroup(g) {
  if (!db || !uid || !groups[g]) return;
  if (!confirm('このグループから抜けますか？')) return;
  const ups = {}; ups['groups/' + g + '/m/' + uid] = null; ups['userGroups/' + uid + '/' + g] = null;
  try { await db.ref().update(ups); } catch (e) {}
  delete groups[g]; saveGroups();
  if (curPeer === g) { curPeer = null; show('scrHome'); }
  renderList(); haptic.error(); toast('グループから抜けました');
}
/* ===== グループ選択モード(0.2s長押し→複数選択→グループ作成) ===== */
let _selMode = false, _selSet = {};
function tryEnterSel(pid, card) {
  if (Object.keys(groups).length >= 3) { shakeEl(card); haptic.error(); return; }   // 3つ持ってたら作れない=震える
  if (!_selMode) { _selMode = true; _selSet = {}; document.getElementById('app').classList.add('selmode'); }
  _selSet[pid] = true; haptic.confirm(); renderList(); updateGroupBar();
}
function toggleSel(pid, card) { _selSet[pid] = !_selSet[pid]; haptic.tap(); if (card) card.classList.toggle('sel', !!_selSet[pid]); updateGroupBar(); }
function exitSelMode() { _selMode = false; _selSet = {}; document.getElementById('app').classList.remove('selmode'); renderList(); updateGroupBar(); }
function updateGroupBar() {
  const bar = $('#groupBar'); if (!bar) return;
  const n = Object.keys(_selSet).filter(x => _selSet[x]).length;   // 選択した友達数(自分は含めない)
  bar.classList.toggle('show', _selMode);
  const mk = $('#grpMake'); if (mk) { mk.disabled = (n < 2); mk.textContent = n >= 2 ? ('グループ作成（' + (n + 1) + '人）') : 'グループ作成（3人以上）'; }
  const dl = $('#grpDel'); if (dl) dl.classList.toggle('show', n === 1);   // 1人だけ=削除も出す(従来の会話削除を温存)
}
function shakeEl(el) { try { el.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-7px)' }, { transform: 'translateX(7px)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(0)' }], { duration: 320, easing: 'ease-out' }); } catch (e) {} }
/* ===== 管理者: 承認(pin)/承認解除(pin-slash)/停止(trash) ※サーバ反映はルールにfounder UID登録が前提 ===== */
let delArmA = {};
function toggleApprove(pid, f) { if (!db || !uid) return; const v = !(f && f.approved); haptic.confirm(); db.ref('users/' + pid + '/approved').set(v).then(() => { if (friends[pid]) friends[pid].approved = v; saveFriends(); renderList(); toast(v ? '承認しました' : '承認解除'); }).catch(() => toast('権限なし（権限の登録が必要）', 'error')); }
function suspendUser(pid) { if (delArmA[pid]) { clearTimeout(delArmA[pid]); delete delArmA[pid]; doSuspend(pid); return; } toast('もう一度🗑で停止'); haptic.error(); delArmA[pid] = setTimeout(() => delete delArmA[pid], 2500); }
function doSuspend(pid) { if (!db || !uid) return; haptic.error(); db.ref('users/' + pid + '/suspended').set(true).then(() => toast('停止しました')).catch(() => toast('権限なし（権限の登録が必要）', 'error')); }

/* ===== 管理者: 全登録ユーザー一覧 ＋ 会話中の中継（ルール再公開でadmin読み可）===== */
let allUsers = {}, allConvos = {};
function watchAdminUsers() {
  if (!db || watchAdminUsers._on) return; watchAdminUsers._on = true; watchAdminConvos();
  db.ref('users').on('value',
    s => { allUsers = s.val() || {}; save('cx_allusers', allUsers); if (me && me.admin) renderList(); },
    () => { watchAdminUsers._on = false; setTimeout(() => { if (me && me.admin) watchAdminUsers(); }, 2500); }   // ★オフライン/エラーでも一覧を消さない＋再試行
  );
}
function watchAdminConvos() {
  if (!db || watchAdminConvos._on) return; watchAdminConvos._on = true;
  db.ref('convos').on('value',
    s => { allConvos = s.val() || {}; save('cx_allconvos', allConvos); if (me && me.admin) renderList(); },
    () => { watchAdminConvos._on = false; setTimeout(() => { if (me && me.admin) watchAdminConvos(); }, 2500); }
  );
}
function adminEmptyClean(t) {                                          // 中継表示用に既知プレフィックスを読める形へ
  if (typeof t !== 'string') return '';
  if (t.indexOf('cximg:') === 0) return '📷 写真';
  if (t.indexOf('cxvid:') === 0) return '🎬 動画';   // #41 管理者中継で動画の生JSONを出さない
  if (t.indexOf('cxhap:') === 0) return t.split(':').slice(2).join(':');
  if (t.indexOf('cxq:') === 0) { try { return JSON.parse(t.slice(4)).t || t; } catch (e) { return t; } }
  if (t.indexOf('cxsty:') === 0) return '🎨 スタイル';
  return t;
}
function adminMonitor(cid, cv) {                                       // 「と」だけ: 任意の会話を読み取り専用で中継表示
  detachChat(); curPeer = null;
  const na = (allUsers[cv.a] || {}).n || '?', nb = (allUsers[cv.b] || {}).n || '?';
  $('#chName').textContent = (cv.g || isGroup(cid)) ? ((groups[cid] || {}).name || 'グループ') : (na + ' ⇄ ' + nb); const st = $('#chStat'); st.textContent = '👁 中継'; st.classList.remove('on');
  setIcon($('#chAva'), '🛰️', '#1c1c1e');
  document.getElementById('app').classList.add('monitor'); const box = $('#msgs'); box.textContent = ''; show('scrChat');
  buildEmptyToggle(cid, box);                                          // 🕒 empty mode のON/OFFスイッチ（オンオフ明示）
  let mq = Promise.resolve();                                          // 復号は非同期 → 表示順を保つため直列化
  watchRef(db.ref('chats/' + cid + '/msgs').orderByChild('ts').limitToLast(120), 'child_added', s => {
    const m = s.val(); if (!m || typeof m.t !== 'string') return;
    mq = mq.then(async () => {
      const t = adminEmptyClean(await decWith(cid, m.t));             // 暗号文を復号してから表示
      const row = el('div', 'row ' + (m.f === cv.a ? 'you' : 'me')); const b = el('div', 'bubble'); b.textContent = String(t).slice(0, 2000); row.appendChild(b);
      box.appendChild(row); requestAnimationFrame(() => box.scrollTop = box.scrollHeight);
    }).catch(() => {});
  });
}
/* 🕒 empty mode のON/OFFスイッチ（管理者のみ・状態が一目で分かる） */
function buildEmptyToggle(cid, box) {
  const wrap = el('div', 'mon-empty');
  const tx = el('div', 'mon-empty-tx'); tx.textContent = '🕒 10時間で消える (empty mode)';
  const sw = el('div', 'mon-sw'); sw.appendChild(el('div', 'knob'));
  const stt = el('div', 'mon-empty-st'); stt.textContent = '…';
  wrap.append(tx, sw, stt); box.appendChild(wrap);
  const paint = on => { sw.classList.toggle('on', on); wrap.classList.toggle('on', on); stt.textContent = on ? 'ON' : 'OFF'; };
  db.ref('chats/' + cid + '/empty').once('value').then(s => paint(!!s.val())).catch(() => paint(false));
  sw.onclick = () => {
    const want = !sw.classList.contains('on'); paint(want); haptic.confirm();
    const ups = {}; ups['chats/' + cid + '/empty'] = want ? true : null; ups['convos/' + cid + '/empty'] = want ? true : null;
    db.ref().update(ups).then(() => toast(want ? 'empty mode ON（最後のメッセージから10時間で消えます）' : 'empty mode OFF')).catch(() => { paint(!want); toast('変更できません（権限の再設定が必要）', 'error'); });
  };
}
function _userConvIds(p){ return Object.keys(allConvos).filter(cid=>{ const cv=allConvos[cid]||{}; if (cv.g || isGroup(cid)) return false; return cv.a===p||cv.b===p; }); }
function _userEmptyOn(p){ const ids=_userConvIds(p); return ids.length>0 && ids.every(cid=>!!(allConvos[cid]||{}).empty); }
function toggleUserEmpty(p){                                            // 💨 管理者: この利用者の全会話を empty mode(10時間削除) ON/OFF
  if(!db){ return; }
  const ids=_userConvIds(p);
  if(!ids.length){ toast('この利用者にはまだ会話がありません', 'error'); return; }
  const want=!_userEmptyOn(p); haptic.confirm();
  const ups={}; ids.forEach(cid=>{ ups['chats/'+cid+'/empty']=want?true:null; ups['convos/'+cid+'/empty']=want?true:null; });
  db.ref().update(ups).then(()=>{ ids.forEach(cid=>{ if(allConvos[cid]) allConvos[cid].empty=want; }); renderList(); toast(want?'💨 empty mode ON（この利用者の会話は最後のメッセージから10時間で消えます）':'empty mode OFF'); }).catch(()=>toast('変更できません（権限の再設定が必要）', 'error'));
}
function renderAdminList(list) {
  if (!Object.keys(allUsers).length) allUsers = load('cx_allusers', {}) || {};      // オフラインは前回のキャッシュを表示
  if (!Object.keys(allConvos).length) allConvos = load('cx_allconvos', {}) || {};
  const cIds = Object.keys(allConvos).sort((x, y) => ((allConvos[y] || {}).ts || 0) - ((allConvos[x] || {}).ts || 0));
  if (cIds.length) {
    const hd = el('div', 'adm-sec'); hd.textContent = '会話中（中継）'; list.appendChild(hd);
    cIds.forEach(cid => {
      const cv = allConvos[cid] || {};
      const _label = (cv.g || isGroup(cid)) ? ((groups[cid] || {}).name || 'グループ') : (((allUsers[cv.a] || {}).n || '?') + ' ⇄ ' + ((allUsers[cv.b] || {}).n || '?'));   // グループは a/b ペアでなくグループ名
      const card = el('div', 'conv'); const nm = el('div', 'conv-nm'); nm.textContent = _label; const pv = el('div', 'conv-pv'); pv.textContent = '…'; card.append(nm, pv);
      decWith(cid, cv.t).then(t => { pv.textContent = adminEmptyClean(t) || '会話を中継'; }).catch(() => { pv.textContent = '会話を中継'; });   // プレビューを復号
      if (cv.empty) { const bd = el('div', 'conv-empty-badge'); bd.textContent = '🕒10h'; card.appendChild(bd); }   // empty mode ON 表示
      card.onclick = () => adminMonitor(cid, cv); list.appendChild(card);
    });
    const hd2 = el('div', 'adm-sec'); hd2.textContent = '全ユーザー'; list.appendChild(hd2);
  }
  const ids = Object.keys(allUsers).filter(u => u !== uid);
  if (!ids.length && !cIds.length) { const e = el('div', 'empty'); const b = el('div', 'big'); b.textContent = '👑'; const p = el('p'); p.textContent = '登録ユーザーはまだ居ません\n(ルール再公開が必要な場合あり)'; e.append(b, p); list.appendChild(e); return; }
  ids.forEach(p => {
    const u = allUsers[p] || {};
    const card = el('div', 'conv');
    const nm = el('div', 'conv-nm'); nm.textContent = u.n || '…';
    const pv = el('div', 'conv-pv'); pv.textContent = u.approved ? '✓ 承認済み' : '未承認';
    card.append(nm, pv);
    const top = el('div', 'conv-top');
    const em = el('button', 'conv-adm conv-empty-btn'); { const _eon = _userEmptyOn(p); em.classList.toggle('on', _eon); em.textContent = _eon ? 'Empty On' : '💨'; } em.title = 'Emptyモード（10時間で会話削除）'; em.onclick = e => { e.stopPropagation(); toggleUserEmpty(p); };   // ON時は Empty On 表示 / trash左隣
    const tr = el('button', 'conv-adm'); tr.innerHTML = '<img src="/arrow.up.trash.png" alt="">'; tr.onclick = e => { e.stopPropagation(); adminDeleteUser(p); };
    const pn = el('button', 'conv-adm'); pn.innerHTML = '<img src="icons/' + (u.approved ? 'pin.fill.png' : 'pin.slash.png') + '" alt="">'; pn.onclick = e => { e.stopPropagation(); adminToggleApprove(p, u); };
    top.append(em, tr, pn); card.appendChild(top);
    card.onclick = () => adminOpenChat(p);
    list.appendChild(card);
  });
}
function adminToggleApprove(p, u) { if (!db) return; const v = !(u && u.approved); haptic.confirm(); db.ref('users/' + p + '/approved').set(v).then(() => toast(v ? '承認しました' : '承認解除')).catch(() => toast('権限なし（権限の再設定が必要）', 'error')); }
function adminDeleteUser(p) {
  if (!db) return;
  const u = allUsers[p] || {};
  if (!confirm((u.n || '?') + ' を削除しますか？')) return;
  haptic.error();
  const ups = {};
  ups['users/' + p] = null;
  if (u.h) ups['handles/' + u.h] = null;
  ups['friends/' + p] = null;
  ups['status/' + p] = null;
  db.ref().update(ups).then(() => toast('削除しました')).catch(() => toast('権限なし（権限の再設定が必要）', 'error'));
}
function adminOpenChat(p) {
  const u = allUsers[p] || {};
  friends[p] = { name: String(u.n || '').slice(0, 20), icon: String(u.i || '🙂').slice(0, 60), color: /^#[0-9a-f]{6}$/i.test(u.c) ? u.c : '#0a84ff', handle: u.h, approved: !!u.approved }; saveFriends();
  if (db && uid) { const ups = {}; ups['friends/' + uid + '/' + p] = true; ups['friends/' + p + '/' + uid] = true; ups['users/' + p + '/approved'] = true; db.ref().update(ups).then(() => toast('繋ぎました（承認）')).catch(() => toast('繋げません（権限の再設定が必要）', 'error')); }   // と が繋いだ=承認(888/日)
  watchLast(p); openChat(p);
}
function fmtTime(ts) { const d = new Date(ts), n = new Date(); const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); return d.toDateString() === n.toDateString() ? hm : (d.getMonth() + 1) + '/' + d.getDate(); }

/* =========================================================================
   CHAT
   ========================================================================= */
let curPeer = null, chatRefs = [], lastRecvAt = 0;   // lastRecvAt: 最後に相手メッセージを受信した時刻(点々消え音の抑制用)
function watchRef(ref, ev, cb) { ref.on(ev, cb); chatRefs.push({ ref, ev, cb }); }
function detachChat() { chatRefs.forEach(r => { try { r.ref.off(r.ev, r.cb); } catch (e) {} }); chatRefs = []; hideTyping(); }
function paintChatHead(p) {
  if (isGroup(p)) { const g = groups[p] || {}; $('#chName').textContent = g.name || 'グループ'; const av = $('#chAva'); setIcon(av, '👥', '#7d7d86'); $('#msgs').style.setProperty('--peer-color', deep('#7d7d86')); const lv = $('#chLeave'); if (lv) { lv.classList.add('show'); lv.onclick = () => leaveGroup(p); } return; }
  const lv = $('#chLeave'); if (lv) lv.classList.remove('show');
  const f = friends[p] || {}; $('#chName').textContent = f.name || '…'; setIcon($('#chAva'), f.icon, f.color); $('#msgs').style.setProperty('--peer-color', deep(f.color || '#0a84ff')); }
function setStat(on) { const s = $('#chStat'); s.textContent = on ? '👀' : '😪'; s.classList.toggle('on', on); }
function setNet(off) {                                                // オフラインislandの表示/退場
  const o = $('#offIsland'); if (!o) return;
  if (off) { o.classList.remove('out'); o.classList.add('show'); }
  else if (o.classList.contains('show')) { o.classList.add('out'); setTimeout(() => o.classList.remove('show', 'out'), 500); }   // 0.5sスケールダウンで戻る
}

function openChat(p) {
  detachChat(); clearQuote(); document.getElementById('app').classList.remove('monitor'); curPeer = p; const c = chat(p); c.unread = 0; saveChats();
  paintChatHead(p); setStat(false); renderMsgs(); show('scrChat'); renderList();
  if (db && uid) {
    const cid = cidOf(p);
    watchRef(db.ref('chats/' + cid + '/msgs').orderByChild('ts').limitToLast(50), 'child_added', s => ingestMsg(p, s.key, s.val()));
    watchRef(db.ref('chats/' + cid + '/msgs').orderByChild('ts').limitToLast(50), 'child_removed', s => removeMsg(p, s.key));   // 取り消し: 相手・自分とも滑らかに消える
    if (!isGroup(p)) {                                                  // 既読/入力中/在席は1:1のみ(グループは多人数のため省略)
      watchRef(db.ref('chats/' + cid + '/read/' + p), 'value', s => applyPeerRead(p, Number(s.val()) || 0));
      watchRef(db.ref('chats/' + cid + '/typing/' + p), 'value', s => {
        if (s.val() && curPeer === p) showTyping();
        else { const wasTyping = !!typingEl; hideTyping(); if (wasTyping && curPeer === p && settings.seen !== false && now() - lastRecvAt > 1500) Snd.play('scatter', .6); }
      });
      watchRef(db.ref('status/' + p), 'value', s => setStat(!!s.val()));
    }
    pruneOldServerMsgs(cid);   // 開くたびに自分の古い(5日超)メッセージを掃除→通信規格に溜めない
  }
  setTimeout(() => $('#ta').focus(), 300);
}
function renderMsgs() { const box = $('#msgs'); box.textContent = ''; chat(curPeer).msgs.forEach(m => box.appendChild(msgRow(m))); scrollDown(); }
function msgRow(m) {
  const row = el('div', 'row ' + (m.mine ? 'me' : 'you')); row.dataset.id = m.id;
  if (typeof m.t === 'string' && m.t.indexOf('cximg:') === 0 && window.Store) {   // 画像メッセージ
    const b = el('div', 'bubble img'); const im = el('img', 'msg-img'); im.loading = 'lazy'; im.alt = ''; im.src = Store.fileUrl(m.t.slice(6)); im.onclick = () => { try { window.open(im.src, '_blank'); } catch (e) {} }; b.appendChild(im); row.appendChild(b);
  } else if (typeof m.t === 'string' && m.t.indexOf('cxvid:') === 0 && window.Store) {   // 動画メッセージ(Telegramチャンク)
    const b = el('div', 'bubble vid'); let data = null; try { data = JSON.parse(m.t.slice(6)); } catch (e) {}
    const vids = (data && data.v) || [];
    if (vids.length) { vids.forEach(v => {
      const wrap = el('div', 'msg-vid'); const po = el('img', 'msg-vid-poster'); po.src = '/movie.png'; po.alt = ''; wrap.appendChild(po);
      const pl = el('div', 'msg-vid-play'); pl.textContent = '▶'; wrap.appendChild(pl);
      wrap.onclick = () => { if (wrap.dataset.l) return; wrap.dataset.l = '1'; pl.textContent = '…';
        Store.videoBlobUrl(v.c, v.t).then(url => { const ve = el('video', 'msg-vid-el'); ve.src = url; ve.controls = true; ve.setAttribute('playsinline', ''); ve.autoplay = true; wrap.textContent = ''; wrap.appendChild(ve); try { ve.play().catch(() => {}); } catch (e) {} }).catch(() => { pl.textContent = '⚠'; wrap.dataset.l = ''; toast('動画の読み込みに失敗', 'error'); }); };
      b.appendChild(wrap); }); } else { b.textContent = '🎬 動画'; }
    row.appendChild(b);
  } else if (typeof m.t === 'string' && m.t.indexOf('cxq:') === 0) {              // 引用つきメッセージ
    let q = null; try { q = JSON.parse(m.t.slice(4)); } catch (e) {}
    if (q && typeof q.t === 'string') {
      const b = el('div', 'bubble');
      const qb = el('div', 'q-quoted'); qb.textContent = q.q || ''; if (/^#[0-9a-f]{6}$/i.test(q.qc)) qb.style.color = q.qc; b.appendChild(qb);   // 引用元(左に色バー=発言者の色)
      const tx = el('div'); tx.textContent = q.t; b.appendChild(tx);
      row.appendChild(b);
    } else { const b = el('div', 'bubble'); b.textContent = m.t; row.appendChild(b); }
  } else if (typeof m.t === 'string' && m.t.indexOf('cxsty:') === 0) {            // スタイル付きメッセージ
    let sty = null; try { sty = JSON.parse(m.t.slice(6)); } catch (e) {}
    if (sty && typeof sty.t === 'string') {
      const y = sty.y === 'quote' ? 'quote' : sty.y === 'list' ? 'list' : 'caption';
      const b = el('div', 'bubble sty sty-' + y);
      if (y === 'list') { sty.t.split('\n').forEach(line => { if (!line.trim()) return; const li = el('div', 'sty-li'); li.textContent = line; b.appendChild(li); }); }
      else { b.textContent = sty.t; }
      if (/^#[0-9a-f]{6}$/i.test(sty.c)) { b.style.color = sty.c; if (y === 'quote') b.style.borderLeftColor = invertColor(sty.c); }
      row.appendChild(b);
    } else { const b = el('div', 'bubble'); b.textContent = m.t; row.appendChild(b); }
  } else {
    let hapMode = null, txt = m.t;
    if (typeof txt === 'string' && txt.startsWith('cxhap:')) { const p = txt.split(':'); hapMode = p[1]; txt = p.slice(2).join(':'); }
    const b = el('div', 'bubble' + (hapMode ? ' hap' : '') + (isEmojiOnly(txt) ? ' emoji-only' : ''));
    b.textContent = txt;
    if (hapMode) { b.dataset.hapBadge = HAP_BADGE[hapMode] || '·'; row.dataset.haptic = hapMode; }
    row.appendChild(b);
  }
  if (m.mine) { const s = el('div', 'seen'); s.textContent = '👀'; row.appendChild(s); }
  addReplySwitch(row, m);   // ④ 本物iOS触覚スワイプ返信（バブル左端の透明スイッチ）
  return row;
}
/* 設定 on/off トグルを「上スワイプ＋本物iOS触覚」に:
   各 .vtoggle に縦置きの透明な実<input switch>を重ね、指で上に弾く(中点越え)瞬間にネイティブ触覚を1発
   →既存のトグルロジック(tg.onclick: 設定保存/通知許可/サウンド)を実行。click はバブリングを止めて二重反転を防止。
   タップでも switch が反転＝同じく触覚＋ロジック。 */
function attachToggleHaptic(tg) {
  try {
    if (!tg || tg.querySelector('.tg-sw')) return;
    const sw = document.createElement('input');
    sw.type = 'checkbox'; sw.setAttribute('switch', ''); sw.setAttribute('aria-hidden', 'true'); sw.tabIndex = -1; sw.className = 'tg-sw';
    tg.appendChild(sw);
    let busy = false;
    sw.addEventListener('click', e => { try { e.stopPropagation(); } catch (_) {} }, true);   // .vtoggle への二重click防止（ロジックは change で実行）
    sw.addEventListener('change', () => {
      if (busy) return; busy = true;
      try { if (typeof tg.onclick === 'function') tg.onclick(); } catch (_) {}                // 既存トグルロジックを実行
      try { if (navigator.vibrate) navigator.vibrate(10); } catch (_) {}
      setTimeout(() => { sw.checked = false; busy = false; }, 260);                            // 起点に戻す＝次の上スワイプ/タップでまた鳴る
    });
  } catch (e) {}
}
/* ④ スワイプ返信に本物のiOS触覚:
   各バブルの左端に「本物の <input switch>」を透明で重ね、指のドラッグでつまみが中点を越えた瞬間に
   ネイティブ触覚を1発（プログラム .click() ではなく実ドラッグ＝iOS26.5+でも確実）→ 引用返信を確定。
   左端ストリップのみ＝バブル本体のタップ/ダブルタップ(メニュー)は壊さない。右→左方向を維持(初期ON→左ドラッグで反転)。 */
function addReplySwitch(row, m) {
  try {
    const bub = row.querySelector('.bubble'); if (!bub || bub.querySelector('.reply-sw')) return;
    if (getComputedStyle(bub).position === 'static') bub.style.position = 'relative';
    const sw = document.createElement('input');
    sw.type = 'checkbox'; sw.setAttribute('switch', ''); sw.setAttribute('aria-hidden', 'true'); sw.tabIndex = -1; sw.className = 'reply-sw';
    sw.checked = true;                                   // ON起点＝右→左ドラッグで中点越え→触覚
    bub.appendChild(sw);
    let dragged = false, armed = false;
    const stop = e => { try { e.stopPropagation(); } catch (_) {} };
    sw.addEventListener('pointerdown', e => { dragged = false; armed = false; stop(e); }, { passive: true });
    sw.addEventListener('pointermove', e => { dragged = true; stop(e); }, { passive: true });
    sw.addEventListener('pointerup', stop, { passive: true });
    sw.addEventListener('click', stop, true);
    sw.addEventListener('change', () => {
      if (!dragged) { sw.checked = true; return; }       // 単なるタップは無視（ドラッグで中点越え時のみ返信）
      if (armed) return; armed = true;
      try { setQuote(m); } catch (_) {}                  // 引用返信を確定（本物触覚はスイッチ反転で既に1発）
      try { if (navigator.vibrate) navigator.vibrate(11); } catch (_) {}
      setTimeout(() => { sw.checked = true; armed = false; }, 320);   // 起点(ON)に戻す＝次の右→左でまた鳴る
    });
  } catch (e) {}
}
function isEmojiOnly(t) { t = (t || '').trim(); const ch = [...t]; return ch.length > 0 && ch.length <= 3 && ch.every(c => /\p{Extended_Pictographic}/u.test(c) || c === '‍' || c === '️'); }
function scrollDown() { const b = $('#msgs'); requestAnimationFrame(() => b.scrollTop = b.scrollHeight); }
function emojiPop(e) { const p = el('div', 'emoji-pop'); p.textContent = e; document.getElementById('app').appendChild(p); setTimeout(() => { try { p.remove(); } catch (_) {} }, 1050); }

/* ===== Aa 文字スタイルシート ===== */
let styType = 'caption', styColor = '#1c1c1e';
const STYCOLORS = ['#1c1c1e', '#0a84ff', '#ff3b30', '#34c759', '#ff9f0a', '#af52de'];
function buildStyColors() {
  const box = $('#styColors'); if (!box || box._built) return; box._built = true; box.innerHTML = '';
  STYCOLORS.forEach((c, i) => { const d = el('div', 'sty-sw' + (i === 0 ? ' on' : '')); d.style.background = c; d.onclick = () => { styColor = c; [].forEach.call(box.children, x => x.classList.remove('on')); d.classList.add('on'); haptic.sel(); }; box.appendChild(d); });
}
function setStyType(y) {
  styType = y;
  [].forEach.call(document.querySelectorAll('.sty-type'), b => b.classList.toggle('on', b.dataset.y === y));   // 枠が0.3sで青(CSS transition)
  $('#styAdd').classList.toggle('hidden', y !== 'list'); haptic.tap();
}
function openStyleSheet() {
  if (!curPeer) { toast('会話を開いてね', 'error'); return; }
  buildStyColors(); styType = 'caption'; styColor = STYCOLORS[0];
  setStyType('caption'); [].forEach.call($('#styColors').children, (x, i) => x.classList.toggle('on', i === 0));
  $('#styInput').value = ''; openSheet('#styleSheet'); setTimeout(() => $('#styInput').focus(), 350);
}
function styleSend() {
  const txt = $('#styInput').value.replace(/\s+$/, '');
  if (!txt.trim()) return;
  if (!curPeer) { toast('会話を開いてね', 'error'); return; }
  if (!canSend()) return;
  const payload = 'cxsty:' + JSON.stringify({ y: styType, c: styColor, t: txt.slice(0, 500) });
  const preview = (styType === 'list' ? '• ' : '') + txt.replace(/\s*\n\s*/g, ' / ').slice(0, 40);
  pushMessage(payload, preview);
  $('#styInput').value = ''; closeSheet('#styleSheet'); $('#mask').classList.remove('show');
}

/* チャット会話翻訳は廃止（サーバーリクエスト削減）。検索/cinema studio の翻訳は別途残置 */
function popSeen(id) { const row = $(`#msgs .row[data-id="${CSS.escape(id)}"]`); if (!row) return; const s = row.querySelector('.seen'); if (!s) return; s.classList.remove('show'); void s.offsetWidth; s.classList.add('show'); if (settings.seen !== false) Snd.play('arrow', .55); }

let _ingestChain = Promise.resolve();
function ingestMsg(p, id, raw) { _ingestChain = _ingestChain.then(() => _ingestMsg(p, id, raw)).catch(() => {}); }   // 復号は非同期 → 到着順(ts順)を保つため直列化
async function _ingestMsg(p, id, raw) {
  if (!raw || typeof raw.t !== 'string') return;
  const c = chat(p); if (c.msgs.some(x => x.id === id)) return;
  const txt = await decWith(cidOf(p), raw.t);                  // 通信規格の暗号文を平文ペイロードへ復号
  const m = { id, t: String(txt).slice(0, 2000), ts: Number(raw.ts) || now(), mine: raw.f === uid, read: false };
  if (m.mine && c.peerRead >= m.ts) m.read = true;
  c.msgs.push(m); if (c.msgs.length > HIST_CAP) c.msgs.splice(0, c.msgs.length - HIST_CAP);
  saveChats();
  if (!m.mine) lastRecvAt = now();   // 点々消え音の抑制用(相手メッセージ受信時刻)
  const viewing = curPeer === p && $('#scrChat').classList.contains('active');
  if (viewing) { $('#msgs').appendChild(msgRow(m)); scrollDown(); hideTyping(); if (!m.mine && document.visibilityState === 'visible') { publishRead(p); const _dt = m.t.startsWith('cxhap:') ? m.t.split(':').slice(2).join(':') : m.t; if (isEmojiOnly(_dt)) emojiPop(_dt); } }   // 相手のメッセージ受信は無音(指定)・絵文字は中央ポップ
}
function removeMsg(p, id) {                                              // child_removed は「取り消し」と limitToLast(50) の窓外退避の両方で発火する
  if (!db) { _removeMsgConfirmed(p, id); return; }
  try { db.ref('chats/' + cidOf(p) + '/msgs/' + id).once('value').then(s => { if (!s.exists()) _removeMsgConfirmed(p, id); }).catch(() => {}); } catch (e) {}   // まだDBに在れば窓外退避＝履歴/表示を保持(消さない)。消えていれば本当の取り消し
}
function _removeMsgConfirmed(p, id) {                                    // 本当に取り消されたメッセージを滑らかに消す(自分・相手共通)
  const c = chat(p); const before = c.msgs.length; c.msgs = c.msgs.filter(x => x.id !== id); saveChats();
  if (curPeer === p) {
    const row = document.querySelector(`#msgs .row[data-id="${CSS.escape(id)}"]`);
    if (row) { row.style.transformOrigin = 'center'; row.style.transition = 'transform .5s ease, opacity .5s ease'; row.style.transform = 'scale(1.8)'; row.style.opacity = '0'; setTimeout(() => { try { row.remove(); } catch (e) {} }, 500); }
  }
  if (before !== c.msgs.length) renderList();
}
const MSG_TTL = 5 * 24 * 60 * 60 * 1000;   // 5日でサーバーから蒸発(通信規格 1GB枠を溜めない)
function pruneOldServerMsgs(cid) {          // 自分の5日以上前のメッセージをサーバーから削除(画像はTelegram側なので無関係)
  if (!db || !uid) return;
  const cutoff = now() - MSG_TTL;
  db.ref('chats/' + cid + '/msgs').orderByChild('ts').endAt(cutoff).limitToFirst(100).once('value').then(snap => {
    const ups = {}; let n = 0;
    snap.forEach(c => { const v = c.val(); if (v && v.f === uid) { ups['chats/' + cid + '/msgs/' + c.key] = null; n++; } });
    if (n) db.ref().update(ups).catch(() => {});
  }).catch(() => {});
}
function publishRead(p) {
  if (!db || !uid || settings.seen === false) return;
  const c = chat(p); const lastTheirs = [...c.msgs].reverse().find(m => !m.mine); if (!lastTheirs) return;
  db.ref('chats/' + cidOf(p) + '/read/' + uid).set(lastTheirs.ts).catch(() => {});
}
function applyPeerRead(p, ts) {
  const c = chat(p); c.peerRead = Math.max(c.peerRead || 0, ts);
  c.msgs.forEach(m => { if (m.mine && !m.read && m.ts <= c.peerRead) { m.read = true; if (curPeer === p) popSeen(m.id); } });
  saveChats();
}

/* ---------- send ---------- */
let lastSent = 0, sendTimes = [], dayKey = '', dayCount = 0;
{ const _d = load('cx_day', null); if (_d && _d.k) { dayKey = _d.k; dayCount = _d.n || 0; } }
function sendBlock() { const b = $('#sendBtn'); b.classList.add('blocked'); b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); haptic.error(); setTimeout(() => b.classList.remove('blocked'), 1600); }
function canSend(skipRapid) {                                         // 連投・1日上限（テキスト/画像 共通）。skipRapid=まとめ送信で連打ガード免除
  const t0 = now();
  if (!skipRapid && t0 - lastSent < 350) return false;               // 連打ガード(まとめ送信時は免除)
  const approved = !!(me && (me.admin || me.approved));
  const dt = new Date(), dk = dt.getFullYear() + '-' + (dt.getMonth() + 1) + '-' + dt.getDate();
  if (dayKey !== dk) { dayKey = dk; dayCount = 0; }                   // 日付が変わったらリセット
  const dailyCap = approved ? 2200 : 70;                             // 1日: 承認(と接続)=2200 / 一般=70
  if (dayCount >= dailyCap) { sendBlock(); toast('今日の送信上限（' + dailyCap + '件）に達しました', 'error'); return false; }
  sendTimes = sendTimes.filter(x => t0 - x < 20000);
  const cap = approved ? 21 : 17;                                    // 20秒の連投ガード
  if (sendTimes.length >= cap) { sendBlock(); return false; }
  if (!db || !uid) { toast('オフラインです', 'error'); return false; }
  sendTimes.push(t0); lastSent = t0;
  dayCount++; save('cx_day', { k: dayKey, n: dayCount });
  return true;
}
async function pushMessage(text, preview, extra) {                   // 1メッセージ送信（テキスト/画像 共通）
  if (!curPeer) return;
  const cid = cidOf(curPeer);
  const id = db.ref('chats/' + cid + '/msgs').push().key;
  const encT = await encWith(cid, text);                             // 本文を暗号化（通信規格には平文を載せない）
  const node = { f: uid, t: encT, ts: TS() };
  if (extra && extra.m != null) node.m = extra.m;                    // 画像のTelegram message_id(平文)＝empty modeの実体削除用
  const encLast = await encWith(cid, (preview || text).slice(0, 60));
  const ups = {}; ups['msgs/' + id] = node; ups['last'] = { f: uid, t: encLast, ts: TS() };
  let _ok = true;
  try {
    await db.ref('chats/' + cid).update(ups);
    if (settings.seen !== false) Snd.play('sent', .75);               // 送信音は write 成功後のみ（失敗時に鳴らさない）
  } catch (err) {                                                      // App Check/権限(403)等の拒否を握り潰さず、理由を出す
    _ok = false;
    try { console.error('pushMessage failed', err && err.code, err && err.message); } catch (_) {}
    toast('送信できませんでした（' + ((err && err.code) || 'error') + '）', 'error');
  }
  // 会話成立 → 「と」へ中継。グループは a/b ペア意味が無いので g:true マーカー（1:1のみ a/b）
  const encCv = await encWith(cid, (preview || text).slice(0, 40));
  const cvUp = { t: encCv, ts: TS() };
  if (isGroup(curPeer)) { cvUp.g = true; }
  else { cvUp.a = (uid < curPeer ? uid : curPeer); cvUp.b = (uid < curPeer ? curPeer : uid); }
  db.ref('convos/' + cid).update(cvUp).catch(() => {});
  queuePush(curPeer);                                                   // 相手へ通知(3秒バッチ・相手オフライン時のみ)
  return _ok;                                                           // 呼び出し側(doSend)が失敗時に本文を残せるよう成否を返す
}
/* 特定相手へ送信(アプリ内バナー返信用・curPeer非依存)。純粋なFirebase書込=追加リクエスト無し */
async function sendToPeer(peer, text) {
  if (!peer || !db || !uid || !String(text || '').trim()) return;
  const t = String(text).slice(0, 500); const cid = pairId(uid, peer);
  const id = db.ref('chats/' + cid + '/msgs').push().key;
  const encT = await encWith(cid, t); const node = { f: uid, t: encT, ts: TS() };
  const encLast = await encWith(cid, t.slice(0, 60));
  const ups = {}; ups['msgs/' + id] = node; ups['last'] = { f: uid, t: encLast, ts: TS() };
  db.ref('chats/' + cid).update(ups).catch(() => {});
  const lo = uid < peer ? uid : peer, hi = uid < peer ? peer : uid;
  const encCv = await encWith(cid, t.slice(0, 40));
  db.ref('convos/' + cid).update({ a: lo, b: hi, t: encCv, ts: TS() }).catch(() => {});
  queuePush(peer);
}
/* アプリ内 会話通知バナー(iOS風glass)。最前列=開いているアプリ/cinema studio/シート等の上に常に出す(z 9600・body直下fixed)。
   下スワイプで返信欄・タップでその会話へ。連投は2s窓でまとめ「N件」表示し、着信音(carplay)はバースト先頭で1回だけ。 */
let _notiT = null;
let _notiBatch = Object.create(null);   // 相手uid -> { count, prof, last, endT }  連投まとめ用
function _playNotiTone() { try { Snd.play('msg', .9); } catch (_) {} }   // apps/announce-messages-tone-carplay.wav (Snd=Web Audio, gestureで解錠済)
function _closeFront() {   // バナータップ時: 前面のアプリ / cinema studio を閉じて会話へ戻す
  try { const ao = document.getElementById('appOv'); if (ao && ao._closeApp) ao._closeApp(); } catch (_) {}
  try { const co = document.getElementById('cineOv'); if (co && co.classList.contains('show')) { co.classList.remove('show'); const cf = document.getElementById('cineFrame'); if (cf) setTimeout(() => { try { cf.src = 'about:blank'; } catch (_) {} }, 420); } } catch (_) {}
}
function showAppBanner(peer, prof, text) {
  const host = document.body; if (!host) return; prof = prof || {};
  let b = document.getElementById('appNoti');
  if (!b) {
    b = el('div', 'app-noti'); b.id = 'appNoti';
    b.style.position = 'fixed'; b.style.zIndex = '9600';   // 常に最前列(アプリ/cinema studio=z500, シート=z9501 より上)
    b.innerHTML = '<div class="app-noti-row"><div class="app-noti-ic" id="appNotiIc">🙂</div><div class="app-noti-tx"><div class="app-noti-nm" id="appNotiNm"></div><div class="app-noti-bd" id="appNotiBd"></div></div></div>'
      + '<div class="app-noti-reply"><input class="app-noti-in" id="appNotiIn" placeholder="返信…" enterkeyhint="send"><button class="app-noti-send" id="appNotiSend">→</button></div>';
    host.appendChild(b);
    let y0 = 0, drag = false, moved = false;
    b.addEventListener('pointerdown', e => { if (e.target.closest('.app-noti-reply')) return; y0 = e.clientY; drag = true; moved = false; });
    b.addEventListener('pointermove', e => { if (!drag) return; if (e.clientY - y0 > 22) { moved = true; drag = false; b.classList.add('open'); clearTimeout(_notiT); setTimeout(() => { try { b.querySelector('#appNotiIn').focus(); } catch (_) {} }, 90); } });
    b.addEventListener('pointerup', e => { if (drag && !moved && !b.classList.contains('open')) { const pr = b._peer; clearTimeout(_notiT); b.classList.remove('show', 'open'); _closeFront(); try { if (window.__chatOpen) window.__chatOpen(pr); } catch (_) {} } drag = false; });
    const send = () => { const inp = b.querySelector('#appNotiIn'); const v = (inp.value || '').trim(); if (!v) return; sendToPeer(b._peer, v); inp.value = ''; b.classList.remove('open', 'show'); try { haptic.confirm(); } catch (_) {} };
    b.querySelector('#appNotiSend').onclick = send;
    b.querySelector('#appNotiIn').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
  }
  // 連投まとめ: 同じ相手の通知は2s窓で1枚に集約し件数表示。音はバースト先頭(or 相手切替)でのみ。
  const key = String(peer);
  const had = !!_notiBatch[key];
  const st = _notiBatch[key] || (_notiBatch[key] = { count: 0, prof: prof, last: text });
  st.count++; st.prof = prof || st.prof; st.last = text;
  clearTimeout(st.endT); st.endT = setTimeout(() => { delete _notiBatch[key]; }, 2000);   // 最後の受信から2sでバースト終了
  const switching = b._peer !== peer;
  b._peer = peer;
  const ic = (st.prof.icon && !String(st.prof.icon).startsWith('img:')) ? st.prof.icon : '🙂';
  b.querySelector('#appNotiIc').textContent = ic;
  if (st.count > 1) {   // 連投: 1枚にまとめて「N件」
    b.querySelector('#appNotiNm').textContent = (st.prof.name || '新着メッセージ') + ' · ' + st.count + '件';
    b.querySelector('#appNotiBd').textContent = st.last || (st.count + '件の新着メッセージ');
  } else {
    b.querySelector('#appNotiNm').textContent = st.prof.name || '新着メッセージ';
    b.querySelector('#appNotiBd').textContent = text || '';
  }
  b.classList.remove('open'); void b.offsetWidth; b.classList.add('show');
  if (!had || switching) _playNotiTone();   // 連投時に鳴り続けない=バースト先頭(or 別の相手)の1回だけ
  clearTimeout(_notiT); _notiT = setTimeout(() => { if (!b.classList.contains('open')) b.classList.remove('show'); }, 6000);
}
function doSend() {
  const ta = $('#ta'); const raw = ta.value.replace(/\s+$/, ''); if (!raw.trim() || !curPeer) return;
  if (!navigator.onLine || !fbConnected || !db || !uid) { sendBlock(); Snd.play('scatter', .85); setNet(true); return; }   // オフライン: 送信ボタンが左右に震え+散らばる音
  if (raw.length > 1000000) { sendBlock(); return; }
  let t = raw.slice(0, 500);
  if (/^cx(img|vid|sty|hap|q):/i.test(t)) t = '​' + t;   // システム用プレフィックスの手打ち偽装を無効化(画像/動画/スタイル/触覚へのなりすまし防止・#8/#40 cxvid追加)
  if (!canSend()) return;
  const hm = settings.hapticMode;
  let payload;
  if (quotedMsg) payload = 'cxq:' + JSON.stringify({ q: quotedMsg.t, qc: quotedMsg.color, t: t });   // 引用つき(hapticより優先)
  else payload = t;   // haptic-message 廃止: 送信に cxhap タグを付けない（全メッセージ通常テキスト）
  if (payload.length > 1500) payload = payload.slice(0, 1500);       // 暗号文がルール上限(8000)を超えない安全網
  const _prev = ta.value, _q = quotedMsg;                              // 送信失敗時に本文/引用を復元できるよう保持
  clearQuote();
  ta.value = ''; autoGrow(); $('#sendBtn').disabled = true; sendTyping(false);
  const _restore = () => { ta.value = _prev; autoGrow(); $('#sendBtn').disabled = !ta.value.trim(); if (_q) { try { setQuote(_q); } catch (_) {} } };
  pushMessage(payload, t).then(ok => { if (ok === false) _restore(); })   // 送信失敗(App Check/権限403等): 本文と引用を戻し再送可能に（理由toastはpushMessage側）
    .catch(err => { try { console.error('doSend', err); } catch (_) {} _restore(); });
}
async function sendImages(files) {                                   // 画像を圧縮→Telegram保存→送信(1回で複数枚OK・最大9枚)
  if (!curPeer || !files) return;
  if (!window.Store || !Store.ready()) { toast('画像保存が未設定です', 'error'); return; }
  const arr = (files.length != null) ? [].slice.call(files) : [files];
  const imgs = arr.filter(f => f && /^image\//.test(f.type)).slice(0, 9);   // 1回最大9枚
  if (!imgs.length) { toast('画像だけ送れます', 'error'); return; }
  loaderShow();
  try {
    let sent = 0;
    for (const file of imgs) {
      if (!canSend(sent > 0)) break;   // 1枚目=通常(連打/上限) / 2枚目以降=連打免除(まとめ送信だが1日上限・20秒上限は有効)
      try { const up = await Store.putImage(file); const ok = await pushMessage('cximg:' + up.id, '📷 写真', { m: up.mid }); if (ok !== false) sent++; } catch (e) {}   // 送信成功時のみカウント=失敗を偽の成功にしない(#19)
    }
    if (sent) haptic.confirm(); else toast('画像を送れませんでした', 'error');
  } finally { loaderHide(); }
}
async function sendVideos(files) {                                   // 動画を≤18MBチャンク分割→Telegram保存→1メッセージで送信(複数OK)
  if (!curPeer || !files) return;
  if (!window.Store || !Store.ready()) { toast('動画保存が未設定です', 'error'); return; }
  const arr = (files.length != null) ? [].slice.call(files) : [files];
  const vidsF = arr.filter(f => f && /^video\//.test(f.type)).slice(0, 6);
  if (!vidsF.length) { toast('動画だけ送れます', 'error'); return; }
  if (!canSend()) return;
  loaderShow();
  try {
    const out = [];
    for (const f of vidsF) {
      try { const meta = await videoMeta(f); const up = await Store.uploadVideoChunks(f); out.push({ c: up.chunks, m: up.mids, t: f.type || 'video/mp4', w: meta.w, h: meta.h, d: meta.dur, n: (f.name || 'video').slice(0, 36) }); } catch (e) {}
    }
    if (!out.length) { toast('動画を送れませんでした', 'error'); return; }
    const allMids = out.reduce((a, v) => a.concat(v.m || []), []);   // 全チャンクの message_id（empty modeの実体削除用）
    await pushMessage('cxvid:' + JSON.stringify({ v: out }), '🎬 動画', { m: allMids });   // 複数動画でも 1 通信規格 write
    haptic.confirm();
  } finally { loaderHide(); }
}
function videoMeta(file) {                                            // 動画の実寸法/長さを取得(比率は編集や表示に使用)
  return new Promise(res => {
    try { const v = document.createElement('video'); v.preload = 'metadata'; v.onloadedmetadata = () => { const r = { w: v.videoWidth || 0, h: v.videoHeight || 0, dur: Math.round((v.duration || 0) * 10) / 10 }; try { URL.revokeObjectURL(v.src); } catch (e) {} res(r); }; v.onerror = () => res({ w: 0, h: 0, dur: 0 }); v.src = URL.createObjectURL(file); } catch (e) { res({ w: 0, h: 0, dur: 0 }); }
  });
}

/* ===== 動画 添付ポップ (送信 / 編集 / +追加) ===== */
let _vidQueue = [];
function openVidSheet() {
  const sheet = $('#vidSheet'), scrim = $('#vidScrim'), list = $('#vidList'); if (!sheet || !list) return;
  list.textContent = '';
  _vidQueue.forEach((f, i) => { const r = el('div', 'vid-item'); const ic = el('img', 'vid-item-ic'); ic.src = '/movie.png'; ic.alt = ''; const nm = el('div', 'vid-item-nm'); nm.textContent = (f.name || 'video') + (f.size ? '  (' + Math.round(f.size / 1048576) + 'MB)' : ''); const x = el('button', 'vid-item-x'); x.textContent = '✕'; x.onclick = () => { _vidQueue.splice(i, 1); _vidQueue.length ? openVidSheet() : closeVidSheet(); }; r.append(ic, nm, x); list.appendChild(r); });
  scrim.classList.add('show'); sheet.classList.add('show');
}
function closeVidSheet() { const s = $('#vidSheet'), sc = $('#vidScrim'); if (s) s.classList.remove('show'); if (sc) sc.classList.remove('show'); }
function openVideoEditor(file) {
  if (!file) return; closeVidSheet();
  let ov = $('#cineOv');
  if (!ov) { ov = el('div', 'cine-ov'); ov.id = 'cineOv'; const fr = document.createElement('iframe'); fr.className = 'cine-frame'; fr.id = 'cineFrame'; fr.setAttribute('allow', 'fullscreen'); const cl = el('button', 'cine-close'); cl.textContent = '✕'; cl.onclick = () => { ov.classList.remove('show'); try { fr.src = 'about:blank'; } catch (e) {} }; ov.append(fr, cl); document.getElementById('app').appendChild(ov); }
  const fr = $('#cineFrame');
  fr.onload = () => { try { fr.contentWindow.postMessage({ type: 'chat:load-video', file: file }, '*'); } catch (e) {} };
  fr.src = 'apps/cinema-studio-final.html?from=chat&t=' + Date.now();
  ov.classList.add('show'); haptic.confirm();
}
{ const vb = $('#vidBtn'), vi = $('#vidIn');
  if (vb && vi) {
    vb.onclick = () => { haptic.tap(); if (!curPeer) { toast('会話を開いてね', 'error'); return; } vi.click(); };
    vi.onchange = () => { const fs = [].slice.call(vi.files || []).filter(f => /^video\//.test(f.type)); vi.value = ''; if (fs.length) { _vidQueue = _vidQueue.concat(fs).slice(0, 6); openVidSheet(); } };
  }
  const sc = $('#vidScrim'); if (sc) sc.onclick = closeVidSheet;
  const va = $('#vidAdd'); if (va) va.onclick = () => { haptic.tap(); const v2 = $('#vidIn'); if (v2) v2.click(); };
  const vs = $('#vidSend'); if (vs) vs.onclick = () => { const q = _vidQueue.slice(); _vidQueue = []; closeVidSheet(); if (q.length) sendVideos(q); };
  const ve = $('#vidEdit'); if (ve) ve.onclick = () => { openVideoEditor(_vidQueue[0]); };
}

/* ---------- typing ---------- */
let typingSentAt = 0, typingEl = null, typingHideT = null, typingOffT = null;
function sendTyping(v) {
  if (!db || !uid || !curPeer) return;
  const r = db.ref('chats/' + cidOf(curPeer) + '/typing/' + uid);
  if (v) { if (now() - typingSentAt > 1500) { typingSentAt = now(); r.onDisconnect().remove(); r.set(true).catch(() => {}); } clearTimeout(typingOffT); typingOffT = setTimeout(() => { r.remove().catch(() => {}); typingSentAt = 0; }, 3000); }
  else { clearTimeout(typingOffT); typingSentAt = 0; r.remove().catch(() => {}); }
}
function showTyping() { if (typingEl) { clearTimeout(typingHideT); typingHideT = setTimeout(hideTyping, 6000); return; } typingEl = el('div', 'row typing'); const b = el('div', 'bubble'); for (let i = 0; i < 3; i++) b.appendChild(el('span', 'd')); typingEl.appendChild(b); $('#msgs').appendChild(typingEl); scrollDown(); typingHideT = setTimeout(hideTyping, 6000); if (settings.seen !== false) Snd.play('arrow', .55); }
function hideTyping() { if (typingEl) { const e = typingEl; typingEl = null; e.classList.add('out'); setTimeout(() => { try { e.remove(); } catch (_) {} }, 520); } clearTimeout(typingHideT); }

/* =========================================================================
   ADD FRIEND — QR(uid) を読む or ユーザー名(name-1234)
   ========================================================================= */
const QR_PREFIX = 'CXF1:';
async function enterAdd() {
  show('scrAdd'); $('#addUname').textContent = username();
  const box = $('#addQR'); box.innerHTML = '<div class="spinner"></div>';
  const ok = await ensureAuth();
  if (ok) { watchAll(); drawQR(box, QR_PREFIX + uid, 170); } else { box.textContent = ''; }
}
let addBusy = false, lastBadQR = '';
async function onScanned(text) {
  text = (text || '').trim();
  if (!text.startsWith(QR_PREFIX)) { if (text !== lastBadQR) { lastBadQR = text; toast('このQRじゃないみたい', 'error'); } return false; }
  const peer = text.slice(QR_PREFIX.length).replace(/[^A-Za-z0-9_-]/g, '');
  return addFriend(peer);
}
async function addFriend(peer) {
  if (addBusy) return false; addBusy = true; loaderShow();
  try {
    if (!peer || peer === uid) { toast('それはあなた自身だよ', 'error'); return false; }
    if (!(me && (me.admin || me.approved)) && !friends[peer] && Object.keys(friends).length >= 2) { toast('「と」と繋がると3人以上追加できます（今は2人まで）', 'error'); haptic.error(); return false; }   // と未接続は最大2人 / と接続(承認)で無制限
    const ok = await ensureAuth(); if (!ok) { toast('オフラインです', 'error'); return false; }
    const s = await db.ref('users/' + peer).once('value');
    if (!s.exists()) { toast('見つかりませんでした', 'error'); return false; }
    const u = s.val();
    friends[peer] = { name: String(u.n || '').slice(0, 20), icon: String(u.i || '🙂').slice(0, 60), color: /^#[0-9a-f]{6}$/i.test(u.c) ? u.c : '#0a84ff', handle: u.h, approved: !!u.approved }; saveFriends();
    const ups = {}; ups['friends/' + uid + '/' + peer] = true; ups['friends/' + peer + '/' + uid] = true;
    await db.ref().update(ups);
    stopScan(); watchLast(peer); Snd.play('friend', .9); haptic.confirm(); renderList(); openChat(peer);
    return true;
  } catch (e) { toast('追加できませんでした', 'error'); return false; }
  finally { addBusy = false; loaderHide(); }
}
async function findByName(input) {
  const h = handleKey(input); if (!h) return;
  const ok = await ensureAuth(); if (!ok) { toast('オフラインです', 'error'); return; }
  try { const s = await db.ref('handles/' + h).once('value'); if (!s.exists()) { toast('見つかりませんでした', 'error'); return; } addFriend(String(s.val())); }
  catch (e) { toast('検索できませんでした', 'error'); }
}

/* =========================================================================
   QR draw + camera scan（ライブラリ同梱・外部CDNなし）
   ========================================================================= */
function loadScript(src) { return new Promise((res, rej) => { if (loadScript._[src]) return res(); const s = document.createElement('script'); s.src = src; s.onload = () => { loadScript._[src] = 1; res(); }; s.onerror = rej; document.head.appendChild(s); }); }
loadScript._ = {};
async function drawQR(box, text, px) {
  box.innerHTML = '';
  const S = px || 180;
  try {
    await loadScript('lib/qrcode.js');
    let qr = null; for (let t = 4; t <= 40; t++) { try { const q = qrcode(t, 'H'); q.addData(text); q.make(); qr = q; break; } catch (e) {} }   // 高訂正H→中央ロゴでも確実に読める
    if (!qr) throw 0;
    const n = qr.getModuleCount(), quiet = 2, total = n + quiet * 2;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const cv = document.createElement('canvas'); cv.width = cv.height = Math.round(S * dpr); cv.style.width = cv.style.height = S + 'px';
    const cx = cv.getContext('2d'); cx.scale(dpr, dpr);
    cx.fillStyle = '#fff'; cx.fillRect(0, 0, S, S);
    const cell = S / total; const r = cell * 0.46;
    const inFinder = (row, col) => (row < 7 && col < 7) || (row < 7 && col >= n - 7) || (row >= n - 7 && col < 7);
    cx.fillStyle = '#111';
    for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) {
      if (!qr.isDark(row, col)) continue;
      const x = (col + quiet) * cell, y = (row + quiet) * cell;
      if (inFinder(row, col)) { cx.fillRect(x, y, cell + 0.6, cell + 0.6); }                 // 三隅は四角(検出安定)
      else { cx.beginPath(); cx.arc(x + cell / 2, y + cell / 2, r, 0, 6.2832); cx.fill(); }   // データはドット
    }
    box.appendChild(cv);
    const logo = Math.round(S * 0.22), lx = Math.round((S - logo) / 2), pad = Math.round(logo * 0.18);   // 中央ロゴ用に白抜き
    cx.fillStyle = '#fff'; cx.fillRect(lx - pad, lx - pad, logo + pad * 2, logo + pad * 2);
    const im = new Image(); im.onload = () => { cx.drawImage(im, lx, lx, logo, logo); }; im.src = '/icon-x.png';
  } catch (e) { const a = el('div'); a.style.cssText = 'padding:10px;font-size:11px;word-break:break-all;-webkit-user-select:text;user-select:text'; a.textContent = text; box.appendChild(a); }
}
let scanStream = null, scanRAF = 0, scanning = false;
async function startScan() {
  if (scanning) return; const card = $('#addScan'), holder = $('#addScanView');
  try {
    await loadScript('lib/jsQR.js');
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video = document.createElement('video'); video.setAttribute('playsinline', ''); video.muted = true; video.srcObject = scanStream;
    holder.innerHTML = ''; holder.appendChild(video); holder.appendChild(el('div', 'scan-frame'));
    card.classList.add('scanning'); await video.play(); scanning = true;
    const cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
    const tick = async () => {
      if (!scanning) return;
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        cv.width = video.videoWidth; cv.height = video.videoHeight; cx.drawImage(video, 0, 0, cv.width, cv.height);
        const img = cx.getImageData(0, 0, cv.width, cv.height);
        const res = window.jsQR && jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
        if (res && res.data) { const ok = await onScanned(res.data); if (ok) return; }
      }
      scanRAF = requestAnimationFrame(tick);
    };
    scanRAF = requestAnimationFrame(tick);
  } catch (e) { toast('カメラを許可してね', 'error'); }
}
function stopScan() { scanning = false; cancelAnimationFrame(scanRAF); if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; } const c = $('#addScan'); if (c) c.classList.remove('scanning'); }

/* =========================================================================
   sheets / emoji palette（composer踏襲）
   ========================================================================= */
function openSheet(sel) { $('#mask').classList.add('show'); $(sel).classList.add('show'); }
function closeSheet(sel) { $(sel).classList.remove('show'); if (![...document.querySelectorAll('.sheet.show')].length) $('#mask').classList.remove('show'); }
function enableSheetSwipe(sel) {
  const sheet = $(sel); if (!sheet) return;
  let y0 = 0, dy = 0, dragging = false;
  sheet.addEventListener('touchstart', e => { y0 = e.touches[0].clientY; dy = 0; dragging = true; sheet.style.transition = 'none'; }, { passive: true });
  sheet.addEventListener('touchmove', e => { if (!dragging) return; dy = e.touches[0].clientY - y0; if (dy < 0) dy = 0; sheet.style.transform = 'translateY(' + dy + 'px)'; }, { passive: true });
  sheet.addEventListener('touchend', () => { if (!dragging) return; dragging = false; sheet.style.transition = ''; sheet.style.transform = ''; if (dy > 80) { closeSheet(sel); closeSnd(); } }, { passive: true });
}
$('#mask').onclick = () => { ['#emojiSheet', '#profSheet', '#cssSheet', '#styleSheet'].forEach(s => $(s).classList.remove('show')); $('#mask').classList.remove('show'); closeSnd(); };
$('#epickToggle').onclick = () => { pickSet = pickSet === 'cat' ? 'human' : 'cat'; Snd.play('taprr', .7); haptic.tap(); renderPicker(); };
$('#epick').onclick = e => { if (e.target.id === 'epick') { closePicker(); Snd.play('ex', .7); } };

const CATS = {
  '🕘': ['😀', '😂', '🥹', '🥰', '😎', '🤔', '🥳', '😴', '🤩', '🫶', '👍', '🙏'],
  '😀': '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 😝 🤔 😏 😒 🙄 😬 😴 😎 🤓 🧐 🥹 😭 😤 😡 🥺 😱 🤯 🫠'.split(' '),
  '👋': '👋 🤚 ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙 👍 👎 ✊ 👊 👏 🙌 🫶 🙏 💪 🫵 ☝️ 👆 👇 👉 👈'.split(' '),
  '💖': ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❤️‍🔥', '💖', '💗', '💓', '💞', '💕', '✨'],
  '🐶': '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🦉 🦄 🐝 🦋 🐢 🐙 🐠 🐳 🦈'.split(' '),
  '🍎': '🍎 🍊 🍌 🍉 🍇 🍓 🍒 🥭 🍍 🥝 🍅 🥑 🥦 🥕 🌽 🥐 🍞 🧀 🍳 🥞 🍔 🍟 🍕 🌮 🍣 🍜 🍰 🍩 🍪 ☕️ 🍺'.split(' '),
  '🚗': '🚗 🚕 🚙 🚌 🏎 🚓 🚑 🛵 🏍 🚲 🚂 ✈️ 🚀 🛸 🚁 ⛵️ 🚢 🗺 🏝 🌋 🗽 🎡'.split(' '),
  '💡': '💡 🔦 💸 💎 🔧 🔨 ⚙️ 🔮 📿 🔭 🔬 💊 🧬 📱 💻 🎧 📸 🎮 ⚽️ 🏀 🎲 🎁 🔥 ⭐️ 🌈 ☀️ 🌙'.split(' ')
};
function buildEmoji() {
  const cr = $('#catRow'); cr.textContent = '';
  Object.keys(CATS).forEach((k, i) => { const b = el('button', 'cat' + (i === 0 ? ' on' : '')); b.textContent = k; b.onclick = () => { [...cr.children].forEach(x => x.classList.remove('on')); b.classList.add('on'); fillEmoji(k); }; cr.appendChild(b); });
  $('#emojiGrid').classList.add('row-mode'); fillEmoji(Object.keys(CATS)[0]);
}
function fillEmoji(k) { const g = $('#emojiGrid'); g.textContent = ''; g.scrollLeft = 0; CATS[k].forEach(e => { const b = el('button'); b.textContent = e; b.onclick = () => insertEmoji(e); g.appendChild(b); }); }
function insertEmoji(e) { const ta = $('#ta'); const s = ta.selectionStart ?? ta.value.length, en = ta.selectionEnd ?? ta.value.length; ta.value = ta.value.slice(0, s) + e + ta.value.slice(en); ta.selectionStart = ta.selectionEnd = s + e.length; autoGrow(); $('#sendBtn').disabled = !ta.value.trim(); ta.focus(); }

/* =========================================================================
   notifications（アプリを開いている間の受信通知）
   ========================================================================= */
async function setNotif(on) { if (on) { if (!('Notification' in window)) return false; let p = Notification.permission; if (p === 'default') p = await Notification.requestPermission(); if (p !== 'granted') return false; subscribePush(); } else { unsubscribePush(); } settings.notif = on; save(K.set, settings); return true; }

/* ===== Web Push（アプリを閉じてても届く通知）===== */
function urlB64ToU8(b64) {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const s = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(s); const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
async function subscribePush() {                                        // 通知購読 → subscription を 通信規格 に保存
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !window.VAPID_PUBLIC) return;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToU8(window.VAPID_PUBLIC) });
    if (db && uid && sub) db.ref('push/' + uid).set(sub.toJSON()).catch(() => {});
  } catch (e) {}
}
function unsubscribePush() {
  try {
    if (db && uid) db.ref('push/' + uid).remove().catch(() => {});
    if (navigator.serviceWorker) navigator.serviceWorker.ready.then(r => r.pushManager.getSubscription().then(s => s && s.unsubscribe())).catch(() => {});
  } catch (e) {}
}
/* 送信側: 相手がオフラインのときだけ、3秒バッチで1回だけ Web Push（Worker枠を節約） */
let pushBatch = {};
function queuePush(peerUid) {
  if (!peerUid || !window.PUSH_URL) return;   // 通知は👀設定に依存させず確実に届ける(相手オフライン時のみ・3秒バッチで節約は維持)
  const b = pushBatch[peerUid] || (pushBatch[peerUid] = { count: 0, timer: null });
  b.count++; clearTimeout(b.timer);
  b.timer = setTimeout(() => { const c = (pushBatch[peerUid] || {}).count || 1; delete pushBatch[peerUid]; sendPushTo(peerUid, c); }, 3000);   // 最後の送信/操作から3秒でまとめ送信
}
async function sendPushTo(peerUid, count) {
  try {
    if (!db || !window.PUSH_URL) return;
    const st = await db.ref('status/' + peerUid).once('value');
    if (st.val()) return;                                               // 相手オンライン → 通信規格で届くので送らない
    const snap = await db.ref('push/' + peerUid).once('value');
    const sub = snap.val(); if (!sub) return;                          // 相手が通知未購読
    const body = count > 1 ? (count + '件の新着メッセージ') : '新着メッセージ';
    fetch(window.PUSH_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sub, title: (me && me.name) || 'メッセージ', body, tag: 'cx-' + uid }) }).catch(() => {});
  } catch (e) {}
}
let notifBuf = {};
function notify(id, peer, text) {                                       // 5秒バッチ通知（件数まとめ・名前/内容）
  if (!settings.notif || document.visibilityState === 'visible') return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  id = id || 'x';
  const b = notifBuf[id] || (notifBuf[id] = { n: 0, name: '', last: '', timer: null });
  b.n++; b.last = String(text || ''); b.name = (peer && peer.name) || b.name || 'メッセージ';
  if (b.timer) return;
  b.timer = setTimeout(() => {
    const x = notifBuf[id]; delete notifBuf[id]; if (!x) return;
    const body = x.n > 1 ? (x.n + '件のメッセージ') : x.last.slice(0, 140);
    const opt = { body, tag: 'cx-' + id, icon: '/icon-192.png', renotify: true };
    try { if (navigator.serviceWorker && navigator.serviceWorker.controller) { navigator.serviceWorker.ready.then(r => { try { r.showNotification(x.name, opt); } catch (e) { new Notification(x.name, opt); } }); } else new Notification(x.name, opt); } catch (e) {}
  }, 5000);
}

/* ===== 使用停止・削除通知 (Liquid Glass「現在使用できません」) ===== */
function showSuspended() {
  if ($('#suspendedOv')) return;
  detachChat(); curPeer = null;
  const en = /^en/i.test(navigator.language || navigator.userLanguage || 'ja');
  const T = en ? {
    title: 'Currently Unavailable', sub: 'This account is not available.',
    sheetTitle: 'When your account is unavailable',
    intro: 'This screen appears when your account is unavailable — due to a temporary network issue, a required update, network restrictions, or a problem with the account itself.',
    checkH: 'What to check',
    checkP: 'If your account is only temporarily unavailable, waiting may resolve it on its own. If there is an actual problem with the account, you may need to recreate it — which requires reinstalling this App.',
    delH: 'If you deleted the account yourself',
    delP: 'This screen may also appear if you deleted the account yourself.<br>Sustained heavy network activity may also cause an account to become unavailable.',
    swH: 'Software-related causes',
    swP: 'On most devices, unsupported device software triggers a warning, or the system is designed to prevent account creation for safety. As a result, problems caused by software updates are generally unlikely.',
    udH: 'About transferring user data',
    udP1: 'If you reinstall the App and recreate the account, the data cannot be carried over even if you use the same name. If you have a backup saved with .Shake, you may be able to restore the account data.',
    udP2: 'Even if the account is restored, conversation data from the previous account remains on the device for some time, but is automatically deleted from the server.',
    help: 'Open help'
  } : {
    title: '現在使用できません', sub: 'このアカウントはご利用いただけません。',
    sheetTitle: 'アカウントが使用できない場合',
    intro: 'アカウントが使用できない場合には、、一時的な通信の問題やアップデートが必要な場合、通信制限の場合、またはアカウントに問題がある時に表示されます。',
    checkH: '確認する事ついて',
    checkP: 'アカウントが一時的に使用できない場合は、そのまま時間を待てば復旧する場合があります。なお、アカウントに問題がある場合はアカウントの作り直しが必要になる場合があります。このAppを再インストールする必要があります',
    delH: 'アカウントを自分で削除した場合',
    delP: 'アカウントを削除した場合もこの画面が表示される場合があります<br>また、通信に負荷がかかる処理が続くと、アカウントが利用できなくなる場合があります',
    swH: 'ソフトウェアの可能性',
    swP: '多くのデバイスの場合では非対応のデバイスソフトウェアの場合は警告が出たり安全のために作成ができない設計となっています。そのため、基本的にデバイスのソフトウェアアップデートでの問題の確率は低い場合があります。',
    udH: 'ユーザデータの引き継ぎについて',
    udP1: 'Appを作り直してアカウントを作り直す場合、名前を同じにしてもアカウントデータを引き継ぐことはできません。.Shakeで保存している場合だとアカウントデータを復活できる場合があります',
    udP2: 'アカウントが復活しても、以前のアカウントの会話データはデバイスには長く残り続けますが、サーバから自動で削除されます',
    help: 'ヘルプを開く'
  };
  const o = el('div', 'suspended-ov'); o.id = 'suspendedOv'; if (en) o.classList.add('en');
  o.innerHTML =
    '<button class="help-button" id="susHelp" aria-label="' + T.help + '" aria-haspopup="dialog">'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
    + '</button>'
    + '<div class="hero"><h1 class="hero-title">' + T.title + '</h1><p class="hero-sub">' + T.sub + '</p></div>'
    + '<div class="backdrop" id="susBackdrop" aria-hidden="true"></div>'
    + '<aside class="sheet" id="susSheet" role="dialog" aria-modal="true" aria-hidden="true">'
    +   '<div class="sheet-drag" id="susDrag" role="separator"><div class="sheet-drag-handle"></div></div>'
    +   '<div class="sheet-header"><h1>' + T.sheetTitle + '</h1></div>'
    +   '<div class="sheet-body" id="susBody"><section>'
    +     '<p>' + T.intro + '</p>'
    +     '<h2>' + T.checkH + '</h2><p>' + T.checkP + '</p>'
    +     '<h2>' + T.delH + '</h2><p>' + T.delP + '</p>'
    +     '<h2>' + T.swH + '</h2><p>' + T.swP + '</p>'
    +     '<h2>' + T.udH + '</h2><p>' + T.udP1 + '</p><p>' + T.udP2 + '</p>'
    +   '</section></div>'
    + '</aside>';
  $('#app').appendChild(o);
  _wireSuspendedSheet(o);
  requestAnimationFrame(() => { try { o.classList.add('in'); } catch (e) {} });   // 入場アニメ起動(bg 1s / hero scale.8→1 0.7s + blur 0.5s)
}
function _wireSuspendedSheet(root) {
  const sheet = root.querySelector('#susSheet'), backdrop = root.querySelector('#susBackdrop'),
        helpBtn = root.querySelector('#susHelp'), drag = root.querySelector('#susDrag'), body = root.querySelector('#susBody');
  const isMobile = () => window.innerWidth <= 600;
  let isOpen = false, isDragging = false, dragSource = null, startY = 0, delta = 0, lastY = 0, lastTime = 0, velocity = 0, activePointer = null;
  function setTf(dy) { sheet.style.transform = 'translate3d(' + (isMobile() ? '0' : '-50%') + ',' + dy + 'px,0)'; }
  function openS() { if (isOpen) return; isOpen = true; sheet.classList.add('visible'); sheet.setAttribute('aria-hidden', 'false'); backdrop.classList.add('visible'); backdrop.setAttribute('aria-hidden', 'false'); body.scrollTop = 0; try { haptic.tap(); } catch (e) {} }
  function closeS() { if (!isOpen) return; isOpen = false; sheet.style.transform = ''; sheet.style.transition = ''; sheet.classList.remove('visible'); sheet.setAttribute('aria-hidden', 'true'); backdrop.classList.remove('visible'); backdrop.setAttribute('aria-hidden', 'true'); }
  helpBtn.addEventListener('click', openS);
  backdrop.addEventListener('click', closeS);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen) closeS(); });
  function startDrag(src, cy, pid) { if (!isOpen || isDragging) return false; isDragging = true; dragSource = src; activePointer = pid; startY = lastY = cy; lastTime = performance.now(); delta = 0; velocity = 0; sheet.style.transition = 'none'; drag.classList.add('dragging'); return true; }
  function moveDrag(cy) { if (!isDragging) return; const allowUp = (dragSource === 'handle'); const raw = cy - startY; delta = (!allowUp && raw < 0) ? 0 : raw; const now = performance.now(), dt = now - lastTime; if (dt > 0) { velocity = velocity * 0.6 + ((cy - lastY) / dt) * 0.4; } lastY = cy; lastTime = now; setTf(delta); }
  function endDrag() { if (!isDragging) return; isDragging = false; drag.classList.remove('dragging'); activePointer = null; const shouldClose = Math.abs(delta) > 100 || Math.abs(velocity) > 0.6; sheet.style.transition = ''; sheet.style.transform = ''; if (shouldClose) closeS(); delta = 0; velocity = 0; dragSource = null; }
  drag.addEventListener('pointerdown', e => { if (startDrag('handle', e.clientY, e.pointerId)) { try { drag.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault(); } });
  let armed = false, armY = 0;
  body.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' && e.button !== 0) return; armed = (body.scrollTop <= 0); armY = e.clientY; });
  body.addEventListener('pointermove', e => { if (!armed || isDragging) return; if (body.scrollTop > 0) { armed = false; return; } if (e.clientY - armY > 10) { startDrag('body', e.clientY, e.pointerId); armed = false; } });
  body.addEventListener('pointerup', () => { armed = false; });
  body.addEventListener('pointercancel', () => { armed = false; });
  document.addEventListener('pointermove', e => { if (!isDragging) return; if (activePointer !== null && e.pointerId !== activePointer) return; moveDrag(e.clientY); if (e.cancelable) e.preventDefault(); }, { passive: false });
  document.addEventListener('pointerup', e => { if (!isDragging) return; if (activePointer !== null && e.pointerId !== activePointer) return; endDrag(); });
  document.addEventListener('pointercancel', e => { if (!isDragging) return; if (activePointer !== null && e.pointerId !== activePointer) return; endDrag(); });
  window.addEventListener('resize', () => { if (!isDragging && isOpen) sheet.style.transform = ''; });
}

/* ===== アイコン絵文字ピッカー（送信/設定） ===== */
const ICON_EMOJIS = ['🙂', '😎', '🥳', '😺', '🦊', '🐻', '🐼', '🐧', '🦄', '🌟', '🍀', '🔥', '🌈', '⚡️', '👾', '🎭'];
let iconEpickMode = 'settings';
function openIconEpick(mode) {
  if (!me) return;
  iconEpickMode = mode;
  const center = $('#iconEpickCenter'); if (center) { center.textContent = (me.icon && me.icon.startsWith('img:')) ? '🎭' : (me.icon || '🙂'); center.classList.remove('confirm'); }
  renderIconEpick();
  $('#iconEpick').classList.add('show');
  Snd.play('open', .7);
}
function closeIconEpick() { $('#iconEpick').classList.remove('show'); }
function renderIconEpick() {
  const stage = $('#iconEpickStage'); if (!stage || !me) return;
  [...stage.querySelectorAll('.icon-epick-item')].forEach(e => e.remove());
  const current = me.icon;
  const others = ICON_EMOJIS.filter(e => e !== current).slice(0, 8);
  const R = 100, cx = 140, cy = 140;
  others.forEach((emoji, i) => {
    const angle = (i / others.length) * 2 * Math.PI - Math.PI / 2;
    const x = cx + R * Math.cos(angle), y = cy + R * Math.sin(angle);
    const btn = el('button', 'icon-epick-item'); btn.textContent = emoji;
    btn.style.left = x + 'px'; btn.style.top = y + 'px'; btn.style.animationDelay = (i * 0.03) + 's';
    btn.onclick = () => {
      haptic.tap(); Snd.play('tap', .5);
      if (iconEpickMode === 'settings') {
        const center = $('#iconEpickCenter'); if (center) { center.textContent = emoji; center.classList.add('confirm'); }
        if (me) { me.icon = emoji; save(K.me, me); if (db && uid) db.ref('users/' + uid + '/i').set(emoji).catch(() => {}); }
        setTimeout(() => { closeIconEpick(); if (me) applyMe(); }, 480);
      } else {
        closeIconEpick(); emojiPop(emoji);
        if (curPeer && canSend()) pushMessage(emoji, emoji);
      }
    };
    stage.appendChild(btn);
  });
}

/* ===== haptic mode ===== */
const HAP_ICONS = { plane: 'plane-haptic.png', confirm: 'confirm.png', error: 'error.png', bom: 'bom.png' };
const HAP_BADGE = { plane: '·', confirm: '··', error: '···', bom: '💥' };
function fireHapticMode(mode) {
  switch (mode) {
    case 'plane':   haptic.tap(); break;
    case 'confirm': haptic.confirm(); break;
    case 'error':   haptic.error(); break;
    case 'bom':
      haptic.error();
      for (let i = 0; i < 6; i++) setTimeout(() => haptic.error(), 1000 + i * 40);
      break;
  }
}
function applyHapticBtn() {
  const btn = $('#hapticBtn'); if (!btn) return;
  const img = btn.querySelector('img'); if (!img) return;
  const hm = settings.hapticMode;
  img.src = hm ? (HAP_ICONS[hm] || 'haptic.png') : 'haptic.png';
  // 選択中モードのhap-itemをハイライト
  [].forEach.call(document.querySelectorAll('.hap-item'), b => b.classList.toggle('on', b.dataset.mode === hm));
}
function openHapPop() { applyHapticBtn(); const hp = $('#hapticSheet'), hm = $('#hapMask'); if (!hp) return; if (hm) hm.classList.remove('hidden'); hp.classList.remove('hidden'); requestAnimationFrame(() => hp.classList.add('show')); }
function closeHapPop() { const hp = $('#hapticSheet'), hm = $('#hapMask'); if (!hp) return; hp.classList.remove('show'); if (hm) hm.classList.add('hidden'); setTimeout(() => hp.classList.add('hidden'), 280); }
function setHapticMode(mode) {
  const cur = settings.hapticMode;
  settings.hapticMode = (cur === mode) ? null : mode;   // 同じモードをもう一度押すとOFF
  save(K.set, settings);
  applyHapticBtn();
  if (settings.hapticMode) { fireHapticMode(settings.hapticMode); Snd.play('tap', .5); }   // 選んだ触覚をプレビュー
  closeHapPop();
}

/* ===== メッセージ context menu ===== */
let ctxMsg = null;
function showMsgCtx(m, clientY) {
  ctxMsg = m;
  const ctx = $('#msgCtx'); if (!ctx) return;
  const menuH = (m.mine ? 3 : 2) * 52;
  const y = Math.min(Math.max(60, clientY - 20), window.innerHeight - menuH - 60);
  ctx.style.top = y + 'px';
  $('#ctxRetract').classList.toggle('hidden', !m.mine);
  ctx.classList.add('hidden'); void ctx.offsetWidth;   // アニメ再起動
  ctx.classList.remove('hidden');
  $('#msgCtxMask').classList.remove('hidden');
  haptic.confirm();
}
function closeMsgCtx() {
  ctxMsg = null;
  const ctx = $('#msgCtx'); if (ctx) ctx.classList.add('hidden');
  const mask = $('#msgCtxMask'); if (mask) mask.classList.add('hidden');
}
async function retractMsg(m) {
  if (!m || !curPeer || !db || !uid) return;
  const cid = cidOf(curPeer);
  try {
    await db.ref('chats/' + cid + '/msgs/' + m.id).remove();   // 削除 → child_removed が自分・相手の両デバイスで removeMsg() を発火(滑らかに消える)
    haptic.confirm(); toast('取り消しました');
  } catch (e) { toast('取り消せませんでした', 'error'); }
}

/* ===== 引用（メッセージを右→左スワイプ。quote(Aaスタイル)とは別物） ===== */
let quotedMsg = null;
function quoteTextOf(m) {
  let qt = m.t || '';
  if (qt.startsWith('cxhap:')) qt = qt.split(':').slice(2).join(':');
  else if (qt.startsWith('cxsty:')) { try { qt = JSON.parse(qt.slice(6)).t || ''; } catch (e) { qt = ''; } }
  else if (qt.startsWith('cximg:')) qt = '📷 写真';
  else if (qt.startsWith('cxvid:')) qt = '🎬 動画';   // #41 動画引用で生JSONを出さない
  else if (qt.startsWith('cxq:')) { try { qt = JSON.parse(qt.slice(4)).t || qt; } catch (e) {} }
  return qt;
}
function setQuote(m) {
  if (!m || !curPeer) return;
  const qt = quoteTextOf(m).slice(0, 200);
  const color = m.mine ? ((me && me.color) || '#0a84ff') : (((friends[curPeer] || {}).color) || '#0a84ff');   // 自分の発言=自分色 / 相手の発言=相手の選んだ色
  quotedMsg = { t: qt, color };
  const bar = $('#quoteBar'), line = $('#quoteBarLine'), txt = $('#quoteBarText');
  if (txt) txt.textContent = qt;
  if (line) line.style.background = color;
  if (bar) bar.classList.remove('hidden');
  setTimeout(() => $('#ta').focus(), 0);
}
function clearQuote() { quotedMsg = null; const bar = $('#quoteBar'); if (bar) bar.classList.add('hidden'); }

/* =========================================================================
   profile sheet
   ========================================================================= */
function openProfile() { $('#tgNotif').classList.toggle('on', !!settings.notif); $('#tgSeen').classList.toggle('on', settings.seen !== false); $('#tgText').classList.toggle('on', !!settings.textMode); $('#tgFounder').classList.toggle('on', founderOpen); applyMe(); openSheet('#profSheet'); }

/* ===== spotlight 検索：iframe廃止→同一文書にShadow DOMでインライン =====
   ・Shadow DOMでCSS完全隔離（chat⇄spotlight 双方向の衝突なし）
   ・spotlightのDOM参照(querySelector/getElementById/body/activeElement)を実行時にroot差し替え
   ・相対アセット/音声は spotlight/ へ前置。iframe不使用＝env(safe-area)が実ビューポートに効く＝位置ズレ解消 */
let _spotState = 0, _spotWantOpen = false;   // 0=未, 1=読込中, 2=完了 / _spotWantOpen=ユーザが開こうとしている
function warmSearch() { if (_spotState !== 0) return; _spotState = 1; loadSpotInline().then(() => { _spotState = 2; if (_spotWantOpen) { _spotWantOpen = false; const ov = $('#searchOv'); if (ov && ov.classList.contains('show')) { try { if (window.__spotOpen) window.__spotOpen(); } catch (e) {} } } }).catch(e => { _spotState = 0; try { console.error(e); } catch (_) {} }); }   // 起動後アイドルに先読み(prewarmは自動オープンしない)
function openSearch() {
  const ov = $('#searchOv'); if (!ov) return;
  ov.classList.add('show'); document.getElementById('app').classList.add('searching'); try { Snd.play('open', .7); } catch (e) {}
  if (_spotState === 2) { try { if (window.__spotOpen) window.__spotOpen(); } catch (e) {} }   // 読込済み→即オープン(balls/状態も毎回復帰)
  else { _spotWantOpen = true; if (_spotState === 0) warmSearch(); }   // 未読込→読込完了後に自動オープン
  ensureSearchFallback(ov);   // ★何があっても出る: spotlightが描画されなければ簡易連絡先検索を表示
}
/* spotlight(CDN/Shadow依存)が出ない端末でも検索を必ず使えるようにする簡易フォールバック */
function ensureSearchFallback(ov) {
  let fb = ov.querySelector('#searchFallback');
  if (!fb) {
    fb = el('div', 'search-fb'); fb.id = 'searchFallback';
    fb.innerHTML = '<div class="search-fb-panel"><div class="search-fb-bar"><span class="search-fb-mag">🔍</span>'
      + '<input id="searchFbInput" type="text" placeholder="連絡先を検索" autocomplete="off" autocapitalize="off" spellcheck="false">'
      + '<button class="search-fb-x" id="searchFbX" aria-label="閉じる">✕</button></div><div class="search-fb-list" id="searchFbList"></div></div>';
    ov.appendChild(fb);
    const inp = fb.querySelector('#searchFbInput'), listEl = fb.querySelector('#searchFbList');
    fb.querySelector('#searchFbX').onclick = () => { try { haptic.tap(); } catch (e) {} closeSearch(); };
    inp.addEventListener('input', () => {
      const q = inp.value.trim(); listEl.textContent = '';
      if (!q) return;
      let res = []; try { res = (window.__chatSearch ? window.__chatSearch(q) : []) || []; } catch (e) {}
      if (!res.length) { const e0 = el('div', 'search-fb-empty'); e0.textContent = '該当なし'; listEl.appendChild(e0); return; }
      res.forEach(r => {
        const row = el('div', 'search-fb-row');
        const av = el('div', 'search-fb-ava'); try { setIcon(av, r.icon, r.color || '#0a84ff'); } catch (e) { av.textContent = r.icon || '🙂'; }
        const tx = el('div', 'search-fb-tx'); const nm = el('div', 'search-fb-nm'); nm.textContent = r.name || '?'; const sb = el('div', 'search-fb-sub'); sb.textContent = r.sub || '';
        tx.append(nm, sb); row.append(av, tx);
        row.onclick = () => { try { haptic.tap(); } catch (e) {} try { if (window.__chatOpen) window.__chatOpen(r.uid); } catch (e) {} };
        listEl.appendChild(row);
      });
    });
  }
  clearTimeout(ov._fbT);
  ov._fbT = setTimeout(() => {                                    // リッチ検索(Spotlight=apps/語彙/globe)が描画されていれば そちらを優先。描画されない端末でのみ簡易フォールバックを出す
    if (!ov.classList.contains('show')) return;
    let spotOk = false;
    try { const sr = ($('#searchHost') || {}).shadowRoot; spotOk = !!(sr && sr.querySelector('.spot-wrap') && sr.querySelector('input,textarea,[contenteditable]')); } catch (e) {}
    if (!spotOk) { fb.classList.add('show'); try { fb.querySelector('#searchFbInput').focus(); } catch (e) {} }   // spotlight失敗時のみ
    else fb.classList.remove('show');
  }, 1200);
}
function closeSearch() { const ov = $('#searchOv'); if (ov) { ov.classList.remove('show'); clearTimeout(ov._fbT); const fb = ov.querySelector('#searchFallback'); if (fb) { fb.classList.remove('show'); const i = fb.querySelector('#searchFbInput'); if (i) i.blur(); } } document.getElementById('app').classList.remove('searching'); closeSnd(); }
window.__closeChatSearch = closeSearch;   // spotlight(shadow)側の閉じからホスト#searchOvを閉じる橋渡し
/* ===== 検索ブリッジ: インライン検索(Shadow DOM)から呼ぶ連絡先/アカウント検索 ===== */
window.__chatSearch = function (query) {
  const q = String(query || '').trim().toLowerCase(); if (!q) return [];
  const hk = handleKey(query); const seen = {}, out = [];
  try { Object.keys(friends).forEach(pid => { const f = friends[pid] || {}; if (((f.name || '').toLowerCase().indexOf(q) >= 0) || (hk && (f.handle || '').indexOf(hk) >= 0)) { seen[pid] = 1; out.push({ uid: pid, name: f.name || '(名前なし)', handle: f.handle || '', icon: f.icon || '🙂', sub: '連絡先' + (f.handle ? (' · @' + f.handle) : ''), ts: ((chat(pid) || {}).last || {}).ts || 0 }); } }); } catch (e) {}
  try { if (me && me.admin && typeof allUsers === 'object' && allUsers) { Object.keys(allUsers).forEach(u2 => { if (seen[u2] || u2 === uid) return; const au = allUsers[u2] || {}; if (((au.n || '').toLowerCase().indexOf(q) >= 0) || (hk && (au.h || '').indexOf(hk) >= 0)) out.push({ uid: u2, name: au.n || '(名前なし)', handle: au.h || '', sub: 'アカウント' + (au.h ? (' · @' + au.h) : ''), ts: 0 }); }); } } catch (e) {}
  return out.sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 8);
};
window.__chatOpen = function (p) { try { closeSearch(); } catch (e) {} try { openChat(p); } catch (e) {} };
/* ===== 汎用アプリ オーバーレイ(iframe・0.5s scale .77→1・上バーで下スワイプ/タップ閉じ) ===== */
window.__appState = null;
window.__openApp = function (url, name, origin) {
  let ov = document.getElementById('appOv');
  if (!ov) {
    ov = el('div', 'app-ov'); ov.id = 'appOv';
    const bar = el('div', 'app-bar'); const grip = el('div', 'app-grip'); bar.appendChild(grip);
    const fr = document.createElement('iframe'); fr.className = 'app-frame'; fr.id = 'appFrame'; fr.setAttribute('allow', 'fullscreen; autoplay; clipboard-read; clipboard-write');
    const home = el('button', 'app-home'); home.innerHTML = '<img src="/icon.png" alt="">'; home.title = '会話に戻る'; home.setAttribute('aria-label', '会話に戻る');   // 会話に戻る丸ボタン(glass・haptic.confirm)
    ov.append(bar, fr, home); document.getElementById('app').appendChild(ov);
    let y0 = 0, drag = false;
    const close = () => { ov.classList.remove('show'); window.__appState = null; setTimeout(() => { try { document.getElementById('appFrame').src = 'about:blank'; } catch (e) {} }, 420); };
    ov._closeApp = close;
    home.onclick = () => { try { haptic.confirm(); } catch (e) {} close(); };
    bar.addEventListener('pointerdown', e => { y0 = e.clientY; drag = true; fr.style.pointerEvents = 'none'; try { bar.setPointerCapture(e.pointerId); } catch (_) {} });   // ドラッグ中はiframeにイベントを渡さない＝iframe上でも上→下スワイプで閉じる
    bar.addEventListener('pointermove', e => { if (drag && e.clientY - y0 > 50) { drag = false; fr.style.pointerEvents = ''; close(); } });
    bar.addEventListener('pointerup', e => { fr.style.pointerEvents = ''; if (drag && Math.abs(e.clientY - y0) < 8) close(); drag = false; });
    bar.addEventListener('pointercancel', () => { fr.style.pointerEvents = ''; drag = false; });
  }
  window.__openedApps = (window.__openedApps || []).filter(a => a.url !== url); window.__openedApps.push({ name: name || '', url: url });   // アクティビティ用: 開いたアプリを記録(Globe等も1度開けば一覧に残る)
  const fr = document.getElementById('appFrame'); fr.src = url; window.__appState = { name: name || '', url: url };
  try { ov.style.transformOrigin = (origin && origin.x != null) ? (origin.x + 'px ' + origin.y + 'px') : ''; } catch (e) {}   // アイコン位置からzoom(iOS/macOS26風・0.5s)
  ov.classList.remove('show'); void ov.offsetWidth; ov.classList.add('show'); try { haptic.confirm(); } catch (e) {}
};
/* ===== ZIP app(ファイルを選択→native CompressionStreamで圧縮→保存。0 CDN) ===== */
function _crc32(u8){ let c=~0; for(let i=0;i<u8.length;i++){ c^=u8[i]; for(let k=0;k<8;k++) c=(c>>>1)^(0xEDB88320 & -(c&1)); } return (~c)>>>0; }
async function _deflateRaw(data){ if(typeof CompressionStream==='undefined') return null; const cs=new CompressionStream('deflate-raw'); const blob=await new Response(new Blob([data]).stream().pipeThrough(cs)).blob(); return new Uint8Array(await blob.arrayBuffer()); }
async function makeZip(files){
  const enc=new TextEncoder(); const chunks=[]; const central=[]; let offset=0;
  for(const f of files){
    const data=new Uint8Array(await f.arrayBuffer()); const crc=_crc32(data);
    const comp=await _deflateRaw(data); const useD=comp && comp.length<data.length;
    const stored=useD?comp:data; const method=useD?8:0; const nameBytes=enc.encode(f.name||'file');
    const lh=new DataView(new ArrayBuffer(30));
    lh.setUint32(0,0x04034b50,true); lh.setUint16(4,20,true); lh.setUint16(6,0,true); lh.setUint16(8,method,true);
    lh.setUint16(10,0,true); lh.setUint16(12,0,true); lh.setUint32(14,crc,true); lh.setUint32(18,stored.length,true);
    lh.setUint32(22,data.length,true); lh.setUint16(26,nameBytes.length,true); lh.setUint16(28,0,true);
    chunks.push(new Uint8Array(lh.buffer), nameBytes, stored);
    central.push({crc,csize:stored.length,usize:data.length,method,nameBytes,offset});
    offset+=30+nameBytes.length+stored.length;
  }
  const cdStart=offset; let cdSize=0;
  for(const c of central){
    const ch=new DataView(new ArrayBuffer(46));
    ch.setUint32(0,0x02014b50,true); ch.setUint16(4,20,true); ch.setUint16(6,20,true); ch.setUint16(8,0,true);
    ch.setUint16(10,c.method,true); ch.setUint16(12,0,true); ch.setUint16(14,0,true); ch.setUint32(16,c.crc,true);
    ch.setUint32(20,c.csize,true); ch.setUint32(24,c.usize,true); ch.setUint16(28,c.nameBytes.length,true);
    ch.setUint16(30,0,true); ch.setUint16(32,0,true); ch.setUint16(34,0,true); ch.setUint16(36,0,true);
    ch.setUint32(38,0,true); ch.setUint32(42,c.offset,true);
    chunks.push(new Uint8Array(ch.buffer), c.nameBytes); cdSize+=46+c.nameBytes.length;
  }
  const eo=new DataView(new ArrayBuffer(22));
  eo.setUint32(0,0x06054b50,true); eo.setUint16(4,0,true); eo.setUint16(6,0,true); eo.setUint16(8,central.length,true);
  eo.setUint16(10,central.length,true); eo.setUint32(12,cdSize,true); eo.setUint32(16,cdStart,true); eo.setUint16(20,0,true);
  chunks.push(new Uint8Array(eo.buffer));
  return new Blob(chunks,{type:'application/zip'});
}
window.__openZip = function(){
  let ov=document.getElementById('zipOv');
  if(!ov){
    ov=el('div','zip-ov'); ov.id='zipOv';
    ov.innerHTML='<div class="zip-card">'
      +'<button class="zip-close" id="zipClose" aria-label="閉じる"></button>'
      +'<div class="zip-ttl">圧縮するファイルを選択</div>'
      +'<div class="zip-row">'
      +  '<button class="zip-pick" id="zipPick"><span class="zip-badge" id="zipBadge">0</span>タップで選択</button>'
      +  '<button class="zip-act" id="zipComp" disabled>圧縮する</button>'
      +  '<button class="zip-act" id="zipSave" disabled>💾保存</button>'
      +'</div></div>'
      +'<input type="file" id="zipIn" multiple hidden>';
    document.getElementById('app').appendChild(ov);
    let picked=[], zipBlob=null;
    const badge=ov.querySelector('#zipBadge'), comp=ov.querySelector('#zipComp'), saveB=ov.querySelector('#zipSave'), inp=ov.querySelector('#zipIn');
    const sync=()=>{ badge.textContent=picked.length; comp.disabled=!picked.length; saveB.disabled=!zipBlob; comp.textContent=zipBlob?'圧縮済':'圧縮する'; };
    ov.querySelector('#zipClose').onclick=()=>{ ov.classList.remove('show'); };
    ov.addEventListener('click', e=>{ if(e.target===ov) ov.classList.remove('show'); });
    ov.querySelector('#zipPick').onclick=()=>{ try{haptic.tap();}catch(e){} inp.click(); };
    inp.onchange=()=>{ picked=picked.concat([].slice.call(inp.files||[])); inp.value=''; zipBlob=null; sync(); };
    comp.onclick=async ()=>{ if(!picked.length) return; comp.disabled=true; comp.textContent='圧縮中…'; try{ zipBlob=await makeZip(picked); try{haptic.confirm();}catch(e){} }catch(e){ try{toast('圧縮失敗','error');}catch(_){} } sync(); };
    saveB.onclick=()=>{ if(!zipBlob) return; const a=document.createElement('a'); a.href=URL.createObjectURL(zipBlob); a.download='archive.zip'; document.body.appendChild(a); a.click(); setTimeout(()=>{ try{ URL.revokeObjectURL(a.href); a.remove(); }catch(e){} },1000); try{haptic.confirm();}catch(e){} };
    ov._reset=()=>{ picked=[]; zipBlob=null; sync(); };
  }
  if(ov._reset) ov._reset();
  ov.classList.remove('show'); void ov.offsetWidth; ov.classList.add('show');
};
/* ===== アクティビティ(稼働中アプリ・終了でiframeリセット&再読込) ===== */
window.__openActivity = function () {
  let ov = document.getElementById('actOv');
  if (!ov) {
    ov = el('div', 'act-ov'); ov.id = 'actOv';
    const card = el('div', 'act-card'); const ttl = el('div', 'act-ttl'); ttl.textContent = 'アクティビティ';
    const sub = el('div', 'act-sub'); sub.textContent = '反応しないアプリは選んで終了';
    const list = el('div', 'act-list'); list.id = 'actList';
    const cl = el('button', 'act-close'); cl.textContent = '✕'; cl.onclick = () => ov.classList.remove('show');
    card.append(ttl, sub, list); ov.append(cl, card); document.getElementById('app').appendChild(ov);
  }
  const list = document.getElementById('actList');
  function _actRender() {
    list.textContent = '';
    const apps = window.__openedApps || [];
    const items = [{ n: '会話' }, { n: '検索' }];
    apps.forEach(a => items.push({ n: a.name || 'アプリ', url: a.url, app: true }));
    items.forEach(it => {
      const r = el('div', 'act-row'); const nm = el('div', 'act-row-nm'); nm.textContent = it.n; r.appendChild(nm);
      if (it.app) { const q = el('button', 'act-quit'); q.textContent = '終了'; q.onclick = () => { if (!confirm('作業中の内容は失われます')) return; window.__openedApps = (window.__openedApps || []).filter(a => a.url !== it.url); if (window.__appState && window.__appState.url === it.url) { try { const ao = document.getElementById('appOv'); if (ao && ao._closeApp) ao._closeApp(); } catch (e) {} } _actRender(); }; r.appendChild(q); }
      list.appendChild(r);
    });
  }
  _actRender();
  ov.classList.remove('show'); void ov.offsetWidth; ov.classList.add('show');
};
function _spotPatch(code) {   // spotlightのコードを root / 相対パス対応へ書き換え
  return code
    .replace(/document\.querySelectorAll/g, 'window.__SPOTROOT.querySelectorAll')
    .replace(/document\.querySelector/g, 'window.__SPOTROOT.querySelector')
    .replace(/document\.getElementById/g, 'window.__SPOTROOT.getElementById')
    .replace(/document\.activeElement/g, 'window.__SPOTROOT.activeElement')
    .replace(/document\.body/g, 'window.__SPOTBODY')
    .replace(/document\.addEventListener/g, 'window.__SPOTROOT.addEventListener')
    .replace(/new Audio\(/g, 'new Audio(window.__SPOTBASE+');
}
async function loadSpotInline() {
  const BASE = 'spotlight/'; window.__SPOTBASE = BASE;
  await Promise.all([                                                                      // math/語彙を並列ロード(直列待ちを排除=検索が速く出る)
    loadScript('https://cdnjs.cloudflare.com/ajax/libs/mathjs/12.4.1/math.min.js'),
    loadScript(BASE + 'vocabx-data.js')
  ]);
  let html = (((document.getElementById('spotTpl')||{}).textContent) || '').replace(/<\\\/script>/g, '</script>');   // search.html はインライン埋め込み(#spotTpl)＝外部ファイル/iframe不使用
  html = html.replace(/\b(src|href)="(?!https?:|data:|blob:|#|\/)/g, '$1="' + BASE)        // 相対 src/href → spotlight/
             .replace(/url\((['"]?)(?!https?:|data:|#|\/)/g, 'url($1' + BASE);             // CSS url() → spotlight/
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const host = $('#searchHost');
  const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
  window.__SPOTROOT = root;
  { const base = document.createElement('style'); base.textContent = '.spot-wrap{position:absolute;inset:0;overflow:hidden}'; root.appendChild(base); }
  doc.querySelectorAll('style').forEach(s => {                                                  // CSS（Shadowにbodyは無い→.spot-wrapへ写す）
    const st = document.createElement('style');
    st.textContent = (s.textContent || '').replace(/html\s*,\s*body/g, '.spot-wrap').replace(/\bbody\b/g, '.spot-wrap').replace(/:root\b/g, ':host');
    root.appendChild(st);
  });
  // 検索の背景を持たせない＝後ろのチャット画面を見せる。ホーム案内・背景ブラー層は隠す
  { const ov = document.createElement('style'); ov.textContent = '.spot-wrap{background:transparent !important}.bg-blur,.home,.search-fab,#searchFab,.install-overlay,.splash-overlay,.day-fab,.gear-fab,.proof-fab,.mac-status,.notch-wrap{display:none !important}'; root.appendChild(ov); }
  const wrap = document.createElement('div'); wrap.className = 'spot-wrap';
  [...doc.body.childNodes].forEach(n => { if (n.nodeType === 1 && n.tagName.toLowerCase() === 'script') return; wrap.appendChild(document.importNode(n, true)); });
  root.appendChild(wrap); window.__SPOTBODY = wrap;
  doc.querySelectorAll('script[type="application/json"]').forEach(s => { const c = document.createElement('script'); c.type = 'application/json'; if (s.id) c.id = s.id; c.textContent = s.textContent; root.appendChild(c); });   // データscript
  const runners = [...doc.querySelectorAll('script:not([src])')].filter(s => (s.getAttribute('type') || '') !== 'application/json');
  let _globeRunner = null;
  const _runScript = (code, isModule) => new Promise(res => { const blob = new Blob([code], { type: 'text/javascript' }); const tag = document.createElement('script'); if (isModule) tag.type = 'module'; tag.src = URL.createObjectURL(blob); tag.onload = res; tag.onerror = res; document.body.appendChild(tag); });
  for (const s of runners) {                                                              // mainは即時 / globe(three.js+WebGL)は遅延
    const isModule = (s.getAttribute('type') || '') === 'module';
    const code = _spotPatch(s.textContent);
    if (/three\.module\.js|WebGLRenderer/.test(code)) { _globeRunner = () => _runScript(code, isModule); continue; }   // 重いglobeはwarmで実行しない=開いた時だけ初期化(WebGLエラー/負荷を排除)
    try { await _runScript(code, isModule); } catch (e) { try { console.error('spot script', e); } catch (_) {} }
  }
  window.__initGlobe = () => { if (_globeRunner) { const r = _globeRunner; _globeRunner = null; try { r(); } catch (e) {} } };   // globe遅延初期化(1回)
  /* prewarm時は自動オープンしない(home暗転の副作用を排除)。オープンは openSearch / __spotOpen が駆動 */
}

/* CSSエディタ: Monaco/VSモード廃止（jsdelivr CDN取得=リクエストを排除）。textarea(#cssArea)が即時反映・0リクエスト・全消しで全解除 */
function toggleSound(on) { if (on) { Snd.play('on', .8); haptic.confirm(); } else { Snd.play('off', .8); haptic.error(); } }
$('#tgNotif').onclick = async () => { const want = !$('#tgNotif').classList.contains('on'); if (want) { const ok = await setNotif(true); if (ok) { $('#tgNotif').classList.add('on'); toggleSound(true); } else { shakeToggle($('#tgNotif')); haptic.error(); Snd.play('fail', .8); } } else { settings.notif = false; save(K.set, settings); $('#tgNotif').classList.remove('on'); toggleSound(false); } };
$('#tgSeen').onclick = () => { const on = !$('#tgSeen').classList.contains('on'); settings.seen = on; save(K.set, settings); $('#tgSeen').classList.toggle('on', on); toggleSound(on); };
$('#tgText').onclick = () => { const on = !$('#tgText').classList.contains('on'); settings.textMode = on; save(K.set, settings); $('#tgText').classList.toggle('on', on); document.getElementById('app').classList.toggle('textmode', on); toggleSound(on); };
$('#tgFounder').onclick = () => { if (!me || !me.admin || !db) { shakeToggle($('#tgFounder')); haptic.error(); return; } const on = !$('#tgFounder').classList.contains('on'); $('#tgFounder').classList.toggle('on', on); founderOpen = on; db.ref('admin/open').set(on).then(() => toggleSound(on)).catch(() => { $('#tgFounder').classList.toggle('on', !on); founderOpen = !on; toast('変更できません（権限の再設定が必要）', 'error'); }); };   // 🎓 招待受付ON/OFF
$('#ppAva').onclick = () => { if (!me) return; if (me.admin) { haptic.error(); return; } closeSheet('#profSheet'); $('#mask').classList.remove('show'); openEmojiPicker(me.icon, e => { me.icon = e; save(K.me, me); applyMe(); if (db && uid) db.ref('users/' + uid + '/i').set(e).catch(() => {}); }); };   // 設定を閉じてから絵文字ピッカーを最前面で出す（設定の裏に隠れないように）

/* name inline edit（タップでそのまま打てる） */
function makeNameEditable(node) { node.addEventListener('click', () => { if (me && !me.admin) openNameEdit(); }); }
function openNameEdit() { const ov = $('#nameOv'), inp = $('#nameOvInput'); if (!ov || !inp) return; inp.value = me.name; ov.classList.add('show'); setTimeout(() => { inp.focus(); inp.select(); }, 320); }
function closeNameEdit(save) { const ov = $('#nameOv'), inp = $('#nameOvInput'); if (!ov) return; if (save) { renameMe((inp.value.trim() || me.name).slice(0, 20)); haptic.confirm(); } ov.classList.remove('show'); if (inp) inp.blur(); }
async function renameMe(v) {
  if (!me || v === me.name) { applyMe(); return; }
  if (!db || !uid) { me.name = v; save(K.me, me); applyMe(); return; }
  const newH = handleKey(v + me.tag), oldH = me.handle;
  try {
    const res = await db.ref('handles/' + newH).transaction(cur => cur === null ? uid : undefined);
    if (!res.committed) { toast('その名前は使えません', 'error'); applyMe(); return; }
    me.name = v; me.handle = newH; save(K.me, me);
    const ups = {}; ups['users/' + uid + '/n'] = v; ups['users/' + uid + '/h'] = newH; if (oldH && oldH !== newH) ups['handles/' + oldH] = null;
    db.ref().update(ups).catch(() => {});
  } catch (e) {}
  applyMe();
}

/* =========================================================================
   slide-to-delete account（tog.html風）→ リモートも消す
   ========================================================================= */
function initDelete() {
  const mask = $('#delMask'), wrap = $('#delWrap'), knob = $('#delKnob'), inner = $('#delInner'), label = $('#delLabel');
  let dragging = false, startX = 0, x = 0, maxX = 0, done = false, lastH = 0;
  const open = () => { done = false; x = 0; sizes(); setPos(0); wrap.classList.remove('fade-out'); mask.classList.add('show'); haptic.error(); Snd.play('warn', .85); };
  const close = () => mask.classList.remove('show');
  function setPos(px) { knob.style.left = (4 + px) + 'px'; inner.style.width = (64 + px) + 'px'; label.style.opacity = String(Math.max(0, 1 - px / maxX * 1.3)); }
  function sizes() { maxX = wrap.offsetWidth - 56 - 8; }
  function dStart(cx) { sizes(); dragging = true; startX = cx; knob.style.transition = 'none'; inner.style.transition = 'none'; haptic.sel(); }
  function dMove(cx) { if (!dragging) return; x = Math.max(0, Math.min(cx - startX, maxX)); setPos(x); if (Math.abs(x - lastH) > 14) { haptic.sel(); lastH = x; } }
  function dEnd() { if (!dragging) return; dragging = false; knob.style.transition = 'left .4s cubic-bezier(.34,1.56,.64,1)'; inner.style.transition = 'width .4s'; if (x >= maxX * 0.9 && !done) { done = true; haptic.errorBurst(); wrap.classList.add('fade-out'); setTimeout(deleteAccount, 480); } else { x = 0; setPos(0); } }
  knob.addEventListener('touchstart', e => dStart(e.touches[0].clientX), { passive: true });
  knob.addEventListener('mousedown', e => dStart(e.clientX));
  wrap.addEventListener('touchmove', e => dMove(e.touches[0].clientX), { passive: true });
  window.addEventListener('mousemove', e => dMove(e.clientX));
  wrap.addEventListener('touchend', dEnd); window.addEventListener('mouseup', dEnd);
  $('#delCancel').onclick = () => { close(); closeSnd(); haptic.tap(); };
  $('#profPower').onclick = () => { if (me && me.admin) { shakeToggle($('#profPower')); haptic.error(); toast('管理者アカウントは削除できません', 'error'); return; } open(); };
  window.addEventListener('resize', sizes);
}
function deleteAccount() {
  detachChat();
  if (db && uid && me) {
    const ups = {}; ups['users/' + uid] = null; if (me.handle) ups['handles/' + me.handle] = null; ups['friends/' + uid] = null; ups['status/' + uid] = null; ups['userGroups/' + uid] = null;
    Object.keys(friends).forEach(p => { ups['friends/' + p + '/' + uid] = null; });
    Object.keys(groups).forEach(g => { ups['groups/' + g + '/m/' + uid] = null; });   // グループ会員も外す(#15 ゴースト会員防止)
    db.ref().update(ups).catch(() => {});
    Object.keys(lastWatch).forEach(p => { try { db.ref('chats/' + cidOf(p) + '/last').off(); } catch (e) {} delete lastWatch[p]; });   // cidOf=1:1はpairId/グループはgid(#10/#13 リスナリーク防止)
    try { db.ref('friends/' + uid).off(); } catch (e) {}
    const u = auth.currentUser; if (u) u.delete().catch(() => auth.signOut().catch(() => {}));
  }
  try { LS.removeItem(K.me); LS.removeItem(K.friends); LS.removeItem(K.chats); LS.removeItem(K.set); LS.removeItem('cx_groups'); LS.removeItem('cx_usercss'); } catch (e) {}   // groups/usercssも消す(#18)
  try { const st = $('#userCss'); if (st) st.textContent = ''; document.getElementById('app').classList.remove('textmode'); } catch (e) {}   // 注入CSS/textmode解除(#18)
  me = null; friends = {}; chats = {}; groups = {}; settings = { notif: false, seen: true }; curPeer = null; uid = null; watching = false;
  $('#delMask').classList.remove('show'); $('#profSheet').classList.remove('show'); $('#mask').classList.remove('show');
  regIcon = '🙂'; regColor = COLORS[0]; $('#regName').value = ''; $('#regGo').disabled = true; buildReg(); show('scrReg');
}

/* =========================================================================
   setup overlay（config未設定のとき）
   ========================================================================= */
/* ===== ハンドオフ（アカウント引き継ぎ）※Email/Password有効化＋handoffsルール公開が前提 ===== */
let hoCode = '', hoListen = null;
const hoEmailFor = h => 'acct-' + handleKey(h) + '@handoff.ichat';
const hoPass = c => 'HOpass-' + c;
function clearHo() { if (hoListen) { try { hoListen.off(); } catch (e) {} hoListen = null; } if (hoCode && db) { try { db.ref('handoffs/' + hoCode).remove(); } catch (e) {} } hoCode = ''; $('#hoIsland').classList.remove('show'); }
async function openHandoff() {
  closeSheet('#profSheet'); $('#mask').classList.remove('show'); $('#hoCode').textContent = '••••••'; show('scrHandoff');
  const ok = await ensureAuth(); if (!ok || !me) { toast('オンラインで開いてね', 'error'); return; }
  loaderShow();
  try {
    const code = String((Math.random() * 900000 + 100000) | 0);
    const email = hoEmailFor(me.handle), cred = firebase.auth.EmailAuthProvider.credential(email, hoPass(code));
    try { await auth.currentUser.linkWithCredential(cred); }
    catch (e) { if (e && (e.code === 'auth/provider-already-linked' || e.code === 'auth/email-already-in-use')) { await auth.currentUser.updatePassword(hoPass(code)); } else throw e; }
    hoCode = code; $('#hoCode').textContent = code;
    const ref = db.ref('handoffs/' + code); ref.onDisconnect().remove(); await ref.set({ email, name: me.name, ts: TS(), exp: TS() + 600000 });   // 10分で期限切れ（コード総当たりの窓を限定）
    hoListen = ref.child('claim');
    hoListen.on('value', s => { const c = s.val(); if (c && c.name) { $('#hoiQ').textContent = c.name + 'と情報を連携しますか？'; $('#hoiBtn').textContent = c.name + 'と繋げる'; $('#hoIsland').classList.add('show'); } });
  } catch (e) { $('#hoCode').textContent = '— — —'; toast('いまは引き継げませんでした', 'error'); }
  finally { loaderHide(); }
}
async function handlePasscode(code) {
  loaderShow();
  try {
    await ensureAuth();
    const snap = await db.ref('handoffs/' + code).once('value'); const info = snap.val();
    if (!info || !info.email) { toast('コードが違います', 'error'); return; }
    try { await db.ref('handoffs/' + code + '/claim').set({ name: (me && me.name) || 'ゲスト' }); } catch (e) {}
    await claimAccount(info.email, code);   // ↓近接ペアリングと共用（サインイン＋プロフィール取得＋ローカル再構築）
    enterHome(); Snd.play('friend', .9); toast('引き継ぎ完了 🎉');
  } catch (e) { toast('引き継げませんでした', 'error'); }
  finally { loaderHide(); }
}
function openPass() { $('#passInput').value = ''; renderPassDots(0); show('scrPass'); $('#passInput').focus(); }
function renderPassDots(n) { const d = $('#passDots'); if (d.children.length !== 6) { d.innerHTML = ''; for (let i = 0; i < 6; i++) d.appendChild(el('div', 'pd')); } [...d.children].forEach((x, i) => x.classList.toggle('on', i < n)); }

/* =========================================================================
   近接ペアリング（端末ペアリング / 引き継ぎ・紐付け）
   旧: handof.png=コード表示(openHandoff) / handoff-arrow.png=コード入力(openPass)。
   新: 所有者端末が「リング(=スタイル化QR)」を表示 → 相手端末がカメラで読取 → 接続 →
       所有者が「紐付け(両端末で同アカウント)」か「引き継ぎ(譲渡)」を選ぶ。
   既存 handoffs/<code> の Email/Password サインインを pairings/<pin> セッション越しに流用。
   管理者ゲート(h2so4=becomeAdmin / #regHoInput・#passInput) と openHandoff/handlePasscode は維持。
   ========================================================================= */
const PAIR_PREFIX = 'CXPR:';
const DEV_IMG = { vision: 'apps/i-vision.png', iphone: 'iPhone-16.png', ipod: 'ipod.png', ipad: 'ipad-tate.png', ipadmac: 'apps/ipad&Mac.png', mac: 'mac.png', other: 'mac.png' };
const pairEsc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const makePin = () => { let s = ''; const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; for (let i = 0; i < 10; i++) s += A[(Math.random() * A.length) | 0]; return s; };   // pinはQRでのみ渡る＝高エントロピーで総当り不可
const makeCode = () => String((Math.random() * 900000 + 100000) | 0);
let pairInitiator = '', pairPin = '', pairRef = null, pairAmDisplayer = false, pairConnectedFlag = false, pairClaimedFlag = false, pairGrantedFlag = false, pairPeerLabel = '', pairMy = null;
let pairStream = null, pairRAF = 0, pairScanning = false;
let pairBgmEl = null, pairBgmTimer = 0;
const pSnd = n => { try { Snd.play(n, .6); } catch (e) {} };
function pairBgmStart() {   // 引き継ぎ画面が出たら 0.3s フェードインでループ（global-ambience）
  try {
    if (!pairBgmEl) { pairBgmEl = new Audio('sounds/global-ambience_10db_Down.m4a'); pairBgmEl.loop = true; pairBgmEl.preload = 'auto'; }
    clearInterval(pairBgmTimer); pairBgmEl.volume = 0; const p = pairBgmEl.play(); if (p && p.catch) p.catch(() => {});
    const TGT = .5; pairBgmTimer = setInterval(() => { pairBgmEl.volume = Math.min(TGT, pairBgmEl.volume + TGT / 10); if (pairBgmEl.volume >= TGT) clearInterval(pairBgmTimer); }, 30);
  } catch (e) {}
}
function pairBgmStop() {   // 閉じる/完了/エラーで 0.3s フェードアウト
  if (!pairBgmEl) return;
  try { clearInterval(pairBgmTimer); const a = pairBgmEl, st = (a.volume || .5) / 10; pairBgmTimer = setInterval(() => { a.volume = Math.max(0, a.volume - st); if (a.volume <= .02) { clearInterval(pairBgmTimer); try { a.pause(); a.currentTime = 0; } catch (e) {} } }, 30); } catch (e) {}
}

function deviceInfo(ua) {
  ua = ua || navigator.userAgent || '';
  const mt = navigator.maxTouchPoints || 0, macUA = /Macintosh|Mac OS X/.test(ua);
  let key;
  if (/visionOS|Vision\s?Pro|XR/i.test(ua)) key = 'vision';
  else if (/iPod/.test(ua)) key = 'ipod';                    // iPod判定はiPhoneより先（UAに "iPhone OS" を含むため）
  else if (/iPhone/.test(ua)) key = 'iphone';
  else if (/iPad/.test(ua)) key = 'ipad';
  else if (macUA && mt > 1) key = 'ipadmac';                 // デスクトップ表示のiPadはMacを名乗る→「iPad・Mac」両表記
  else if (macUA) key = 'mac';
  else key = 'other';
  const LABEL = { vision: 'Apple Vision Pro', iphone: 'iPhone', ipod: 'iPod touch', ipad: 'iPad', ipadmac: 'iPad・Mac', mac: 'Mac', other: 'このデバイス' };
  return { key, label: LABEL[key], img: DEV_IMG[key] };
}
function deviceImgFor(key) { return DEV_IMG[key] || DEV_IMG.other; }

function pairRemoveUI() { const o = $('#pairOv'); if (o) { o.classList.remove('show'); o.remove(); } }
function pairOverlay(dark) {
  pairRemoveUI();
  const ov = el('div', 'fcard-ov pair-ov'); ov.id = 'pairOv';
  const card = el('div', 'fcard pair-card' + (dark ? ' pair-scan-card' : '')); ov.appendChild(card);
  (document.getElementById('app') || document.body).appendChild(ov);
  ov.addEventListener('click', e => { const b = e.target.closest && e.target.closest('button'); if (!b) return; if (b.classList.contains('pair-swap')) pSnd('pExit'); else if (b.id === 'pairLink' || b.id === 'pairHandoff') { /* 転送開始音=Enter は grantAccount 側 */ } else if (b.classList.contains('pair-primary') || b.classList.contains('pair-close')) pSnd('pBack'); }, true);   // 戻る/続ける(接続する・接続して設定・閉じる)=Respring / 代わりに〜(default)=Exit_Mode
  requestAnimationFrame(() => ov.classList.add('show'));
  return card;
}

function openPairing(initiator) {
  pairInitiator = initiator;
  pairConnectedFlag = pairClaimedFlag = pairGrantedFlag = false; pairPeerLabel = '';
  pairMy = deviceInfo();
  try { Snd.unlock(); } catch (e) {} pairBgmStart();                                    // タップ内でBGM開始（iOS自動再生制約クリア）
  if (initiator === 'owner') { closeSheet('#profSheet'); $('#mask').classList.remove('show'); }
  // 既定の役割：所有者=リング表示／相手(新端末)=カメラ読取。各画面の「代わりに〜」で入替可（両Mac等）。
  if (initiator === 'owner') pairDisplay(); else pairScan();
}

/* ---- 表示役（リング / F） ---- */
async function pairDisplay() {
  pairAmDisplayer = true;
  const card = pairRenderRing();                              // 枠を先に出す（通信待ちのちらつき防止）
  const ok = await ensureAuth(); if (!ok) return pairError('オンラインで開いてね');
  pairPin = makePin(); pairRef = db.ref('pairings/' + pairPin);
  try { pairRef.onDisconnect().remove(); await pairRef.set({ a: uid, aLabel: pairMy.label, aKey: pairMy.key, ts: TS(), exp: Date.now() + 600000 }); }
  catch (e) { return pairError(); }
  const box = card.querySelector('#pairQR'); if (box) drawQR(box, PAIR_PREFIX + pairPin, 150);
  pairWatch();
}
function pairRenderRing() {
  const card = pairOverlay(false);
  card.innerHTML =
    '<div class="pair-ring-wrap"><canvas class="pair-ring-cv"></canvas><div class="pair-qr" id="pairQR"><div class="spinner"></div></div></div>' +
    '<div class="pair-title">' + pairEsc(pairMy.label) + '</div>' +
    '<div class="pair-sub">引き継ぎ・連携したいデバイスを近づけてください</div>' +
    '<button class="pair-primary" id="pairRingGo">接続する</button>' +
    '<button class="pair-swap" id="pairToScan">カメラで読み取る</button>' +
    '<button class="pair-close" id="pairCloseR">閉じる</button>';
  pairAnimRing(card.querySelector('.pair-ring-cv'));
  $('#pairRingGo').onclick = () => { try { haptic.tap(); } catch (e) {} };           // セッションは常時稼働＝視覚確認用
  $('#pairToScan').onclick = () => { pairResetSession(); pairScan(); };
  $('#pairCloseR').onclick = pairCleanup;
  return card;
}
function pairAnimRing(cv) {
  if (!cv) return; const ctx = cv.getContext('2d'); if (!ctx) return;
  const DPR = Math.min(window.devicePixelRatio || 1, 2), S = 230; cv.width = cv.height = Math.round(S * DPR); ctx.scale(DPR, DPR);
  const N = 300, parts = [];
  for (let i = 0; i < N; i++) parts.push({ a: Math.random() * 6.2832, r: 58 + Math.pow(Math.random(), .5) * 56, sp: (Math.random() * .4 + .15) * (Math.random() < .5 ? -1 : 1), sz: Math.random() * 1.6 + .4, ph: Math.random() * 6.28 });
  let t = 0;
  (function frame() {
    if (!cv.isConnected) return;                                                     // オーバーレイ撤去で自動停止
    t++; ctx.clearRect(0, 0, S, S);
    for (let i = 0; i < N; i++) { const p = parts[i]; p.a += p.sp * .01; const x = S / 2 + Math.cos(p.a) * p.r, y = S / 2 + Math.sin(p.a) * p.r; ctx.globalAlpha = .45 + .55 * (.5 + .5 * Math.sin(t * .05 + p.ph)); ctx.fillStyle = (i % 7) ? 'rgba(40,130,255,1)' : 'rgba(150,200,255,1)'; ctx.beginPath(); ctx.arc(x, y, p.sz, 0, 6.2832); ctx.fill(); }
    ctx.globalAlpha = 1; cv._raf = requestAnimationFrame(frame);
  })();
}

/* ---- 読取役（カメラ / G） ---- */
async function pairScan() {
  pairAmDisplayer = false;
  pairRenderScanner();
  const ok = await ensureAuth(); if (!ok) return pairError('オンラインで開いてね');
  pairStartCam(async text => {
    text = (text || '').trim();
    if (text.indexOf(PAIR_PREFIX) !== 0) return false;                               // 友達QR(CXF1:)等は無視して読み続ける
    const pin = text.slice(PAIR_PREFIX.length).replace(/[^A-Za-z0-9_-]/g, '');
    let d = null; try { const s = await db.ref('pairings/' + pin).once('value'); d = s.val(); } catch (e) {}
    if (!d || !d.a || (d.exp && Date.now() > d.exp)) { pairStopCam(); pairError(); return true; }
    pairPin = pin; pairRef = db.ref('pairings/' + pin);
    try { await pairRef.child('b').set({ uid, name: (me && me.name) || '新しい端末', bLabel: pairMy.label, bKey: pairMy.key }); }
    catch (e) { pairStopCam(); pairError(); return true; }
    pairStopCam();
    onPairConnected({ label: d.aLabel || 'デバイス', key: d.aKey || 'other' });
    pairWatch();
    return true;
  });
}
function pairRenderScanner() {
  const card = pairOverlay(true);
  card.innerHTML =
    '<div class="pair-scanview" id="pairScanView"><div class="pair-scanframe"></div></div>' +
    '<div class="pair-scan-cap">リングを読み取ってください</div>' +
    '<button class="pair-swap" id="pairToRing">代わりにリングを出す</button>' +
    '<button class="pair-close" id="pairCloseS">閉じる</button>';
  $('#pairToRing').onclick = () => { pairStopCam(); pairResetSession(); pairDisplay(); };
  $('#pairCloseS').onclick = pairCleanup;
}
async function pairStartCam(onDecode) {
  if (pairScanning) return; const holder = $('#pairScanView'); if (!holder) return;
  try {
    await loadScript('lib/jsQR.js');
    pairStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video = el('video'); video.setAttribute('playsinline', ''); video.muted = true; video.srcObject = pairStream;
    holder.insertBefore(video, holder.firstChild);
    await video.play(); pairScanning = true;
    const cvv = el('canvas'), cx = cvv.getContext('2d', { willReadFrequently: true });
    const tick = async () => {
      if (!pairScanning) return;
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        cvv.width = video.videoWidth; cvv.height = video.videoHeight; cx.drawImage(video, 0, 0, cvv.width, cvv.height);
        const img = cx.getImageData(0, 0, cvv.width, cvv.height);
        const res = window.jsQR && jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
        if (res && res.data) { const done = await onDecode(res.data); if (done) return; }
      }
      pairRAF = requestAnimationFrame(tick);
    };
    pairRAF = requestAnimationFrame(tick);
  } catch (e) { pairError('カメラを許可してね'); }
}
function pairStopCam() { pairScanning = false; cancelAnimationFrame(pairRAF); if (pairStream) { try { pairStream.getTracks().forEach(t => t.stop()); } catch (e) {} pairStream = null; } }

/* ---- 接続後 ---- */
function pairWatch() {
  if (!pairRef) return;
  try { pairRef.off(); } catch (e) {}
  pairRef.on('value', snap => {
    const d = snap.val();
    if (!d) { if (pairConnectedFlag && !pairClaimedFlag && !pairGrantedFlag) pairError(); return; }
    if (pairAmDisplayer && !pairConnectedFlag && d.b && d.b.uid) onPairConnected({ label: d.b.bLabel || 'デバイス', key: d.b.bKey || 'other' });
    if (pairInitiator === 'new' && d.grant && !pairClaimedFlag) { pairClaimedFlag = true; claimFromGrant(d.grant); }
  });
}
function onPairConnected(peer) {
  if (pairConnectedFlag) return; pairConnectedFlag = true; pairPeerLabel = peer.label;
  try { haptic.confirm(); } catch (e) {} pSnd('pConn');                               // 最初に接続された
  if (pairInitiator === 'owner') pairChoose(peer); else pairPeerCard(peer);          // 所有者=選択(E) / 新端末=確認カード(A)
}
function pairPeerCard(peer) {                                                          // A
  const card = pairOverlay(false);
  card.innerHTML =
    '<img class="pair-dev" src="' + pairEsc(deviceImgFor(peer.key)) + '" alt="">' +
    '<div class="pair-title">' + pairEsc(peer.label) + '</div>' +
    '<div class="pair-sub">引き継ぎ、紐付けを設定</div>' +
    '<button class="pair-primary" id="pairPeerGo">接続して設定</button>' +
    '<button class="pair-close" id="pairCloseP">閉じる</button>';
  $('#pairPeerGo').onclick = pairWaiting;
  $('#pairCloseP').onclick = pairCleanup;
}
function pairWaiting() {                                                               // 新端末：所有者の選択待ち
  const card = pairOverlay(false);
  card.innerHTML = '<div class="spinner" style="margin:26px auto 18px"></div><div class="pair-title sm">接続中…</div><div class="pair-sub">相手の操作を待っています</div><button class="pair-close" id="pairCloseW">閉じる</button>';
  $('#pairCloseW').onclick = pairCleanup;
}
function pairChoose(peer) {                                                            // E（所有者＝引き継ぐ前のユーザ）
  const card = pairOverlay(false); const lbl = (peer && peer.label) || 'デバイス';
  card.innerHTML =
    '<div class="pair-title">' + pairEsc(lbl) + '</div>' +
    '<div class="pair-body">アカウントを紐づけて連携するか<br>引き継ぐことができます。</div>' +
    '<div class="pair-hint">このデバイスと' + pairEsc(lbl) + '両方でアクセスできます</div>' +
    '<button class="pair-primary" id="pairLink">この垢を紐付け</button>' +
    '<button class="pair-text" id="pairHandoff">' + pairEsc(lbl) + 'に引きづぐ</button>';
  $('#pairLink').onclick = () => grantAccount('link');
  $('#pairHandoff').onclick = () => grantAccount('handoff');
}
async function grantAccount(mode) {                                                    // 所有者→対象端末へ資格情報を引き渡し
  if (!me || !me.handle) return pairError();
  pSnd('pEnter'); loaderShow();                                                        // 転送開始（紐付け/引き継ぎ押下）
  try {
    const code = makeCode(), email = hoEmailFor(me.handle), cred = firebase.auth.EmailAuthProvider.credential(email, hoPass(code));
    try { await auth.currentUser.linkWithCredential(cred); }
    catch (e) { if (e && (e.code === 'auth/provider-already-linked' || e.code === 'auth/email-already-in-use')) { await auth.currentUser.updatePassword(hoPass(code)); } else throw e; }
    pairGrantedFlag = true;
    await pairRef.child('grant').set({ email, code, mode, name: me.name, aLabel: pairMy.label });
    pairDone(mode, pairPeerLabel, true);
  } catch (e) { pairError(); }
  finally { loaderHide(); }
}
async function claimFromGrant(grant) {                                                 // 対象端末：そのアカウントになる
  loaderShow();
  try { await claimAccount(grant.email, grant.code); try { pairRef && pairRef.remove(); } catch (e) {} pairDone(grant.mode, grant.aLabel || pairPeerLabel, false); }
  catch (e) { pairError('引き継げませんでした'); }
  finally { loaderHide(); }
}
async function claimAccount(email, code) {                                             // handlePasscode から抽出＝引き継ぎ本体
  await ensureAuth();
  await auth.signInWithEmailAndPassword(email, hoPass(code));
  uid = auth.currentUser.uid;
  const us = await db.ref('users/' + uid).once('value'); const u = us.val() || {};
  me = { name: u.n || 'User', icon: u.i || '🙂', color: /^#[0-9a-f]{6}$/i.test(u.c) ? u.c : '#0a84ff', tag: u.g || '', handle: u.h || '' };
  save(K.me, me); friends = {}; chats = {}; saveFriends(); saveChats(); watching = false;
  Object.keys(lastWatch).forEach(k => delete lastWatch[k]);
  applyMe(); watchAll();
}
function pairDone(mode, peerLabel, isOwner) {                                          // B / C
  try { pairRef && pairRef.off(); } catch (e) {}                                       // node自体は残す（対象端末がgrantを読む猶予）→onDisconnect/expで掃除
  try { haptic.confirm(); } catch (e) {} pairBgmStop(); pSnd('pDone');                 // loopを0.3sフェードで止め、完了音(hello-first-writeon)
  const lbl = peerLabel || '相手の端末', card = pairOverlay(false);
  card.innerHTML = (mode === 'link'
    ? '<div class="pair-title sm">紐付け完了<span class="pair-eyes">👀</span></div><div class="pair-sub">' + pairEsc(lbl) + 'でも会話を続けられます</div>'
    : '<div class="pair-title sm">ひきつぎ完了</div><div class="pair-sub">' + pairEsc(lbl) + 'で会話を続けられます</div>')
    + '<button class="pair-primary" id="pairDoneX">閉じる</button>';
  if (!isOwner) enterHome();                                                           // 引き継ぎ先：裏でホーム生成（閉じると現れる）
  $('#pairDoneX').onclick = () => { pairRemoveUI(); pairReset(); };
  try { window.cxShowHello && window.cxShowHello({ force: true }); } catch (e) {}      // 完了時のこんにちは
}
function pairError(msg) {                                                              // H
  pairStopCam(); pairCleanupNode();
  try { haptic.error && haptic.error(); } catch (e) {} pairBgmStop(); pSnd('pErr');    // 接続できませんでした
  const card = pairOverlay(false);
  card.innerHTML = '<div class="pair-title" style="margin:16px 0 8px">' + pairEsc(msg || '接続できませんでした') + '</div><button class="pair-primary" id="pairErrX">閉じる</button>';
  $('#pairErrX').onclick = () => { pairRemoveUI(); pairReset(); };
}
function pairResetSession() { pairStopCam(); if (pairRef) { try { pairRef.off(); } catch (e) {} if (pairAmDisplayer) { try { pairRef.remove(); } catch (e) {} } pairRef = null; } pairPin = ''; pairConnectedFlag = false; }
function pairCleanupNode() { if (pairRef) { try { pairRef.off(); } catch (e) {} try { pairRef.onDisconnect().cancel(); } catch (e) {} if (pairAmDisplayer) { try { pairRef.remove(); } catch (e) {} } } }
function pairReset() { pairRef = null; pairPin = ''; pairConnectedFlag = pairClaimedFlag = pairGrantedFlag = false; pairPeerLabel = ''; }
function pairCleanup() { pairStopCam(); pairBgmStop(); pairCleanupNode(); pairReset(); pairRemoveUI(); }

/* ===== .shake バックアップ（端末にファイル保存／復元）===== */
function exportBackup() {
  try {
    const data = { app: 'shake', v: 1, me, friends, chats, settings, groups, usercss: load('cx_usercss', ''), ts: Date.now() };   // groups/usercss も保存（端末移行で取りこぼさない）
    const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = ((me && me.name) || 'chat') + '.shake'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500); toast('保存しました');
  } catch (e) { toast('保存に失敗', 'error'); }
}
function importBackup(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.shake')) { alert('.shake ファイルのみ復元できます'); return; }
  const r = new FileReader();
  r.onload = async () => {
    try {
      const d = JSON.parse(r.result);
      if (d.app !== 'shake') { alert('このファイルは対応バックアップではありません'); return; }
      if (d.me && d.me.handle && db && uid) {
        try {
          const s = await db.ref('handles/' + d.me.handle).once('value');
          if (s.exists() && s.val() !== uid) { alert('このバックアップは別のアカウントのものです'); return; }
        } catch (e) {}
      }
      if (d.me && typeof d.me === 'object') save(K.me, d.me); if (d.friends && typeof d.friends === 'object') save(K.friends, d.friends); if (d.chats && typeof d.chats === 'object') save(K.chats, d.chats); if (d.settings && typeof d.settings === 'object') save(K.set, d.settings); if (d.groups && typeof d.groups === 'object') save('cx_groups', d.groups); if (typeof d.usercss === 'string') save('cx_usercss', d.usercss);   // 型チェック＋groups/usercssも復元
      toast('復元しました'); setTimeout(() => location.reload(), 700);
    } catch (e) { alert('ファイルが読めません'); }
  };
  r.readAsText(file);
}

/* ===== 管理者ゲート（hand off passcode に化学式を打つ）===== */
const ADMIN_PASS = 'h2so4naohna2so4h2o';
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
async function becomeAdmin() {
  // まずローカルで確実に管理者モードへ（ルール未公開でも入れる）
  me = { name: 'と', icon: 'img:/founder.png', color: '#1c1c1e', tag: (me && me.tag) || '', handle: (me && me.handle) || '', admin: true };
  save(K.me, me);
  applyMe(); enterHome(); haptic.confirm(); Snd.play('friend', .9); toast('管理者モード');
  // サーバー側はベストエフォート（先着で /admin/uid 確保。承認/停止を効かせるにはルール公開が必要）
  try {
    const ok = await ensureAuth();
    if (ok && db && uid) { db.ref('admin/uid').once('value').then(au => au.exists() ? db.ref().update({ 'admin/uid': uid, 'admin/secretTry': ADMIN_PASS }) : db.ref().update({ 'admin/uid': uid, 'admin/secret': ADMIN_PASS })).catch(() => { try { db.ref('admin/uid').set(uid); } catch (e) {} }); db.ref('users/' + uid).update({ n: 'と', i: me.icon, c: me.color }).catch(() => {}); watchAll(); }
  } catch (e) {}
}

function showSetup() {
  if ($('#setupOv')) return;
  const o = el('div'); o.id = 'setupOv';
  o.style.cssText = 'position:absolute;inset:0;z-index:120;background:rgba(255,255,255,.98);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px;gap:14px';
  const h = el('div'); h.style.cssText = 'font-size:21px;font-weight:800'; h.textContent = 'あと一歩：通信規格設定';
  const p = el('div'); p.style.cssText = 'font-size:14px;color:#8a8a8e;font-weight:600;line-height:1.9';
  p.textContent = '設定がまだ完了していません。設定ガイドの手順に沿って完了してください（5分・無料・カード不要）。';
  o.append(h, p); $('#app').appendChild(o);
}

/* =========================================================================
   misc UI
   ========================================================================= */
function autoGrow() { const ta = $('#ta'); ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; }
function wireUI() {
  // ④/設定トグル 透明スイッチのスタイル（switch外観は維持＝本物触覚が鳴る／opacityのみ0）
  { const st = document.createElement('style'); st.textContent =
      '.reply-sw{position:absolute;left:0;top:0;width:34px;height:100%;margin:0;padding:0;opacity:0;border:0;z-index:4;cursor:grab;touch-action:pan-y}' +
      '.vtoggle{position:relative}.tg-sw{position:absolute;left:50%;top:50%;width:142px;height:66px;transform:translate(-50%,-50%) rotate(-90deg);margin:0;padding:0;opacity:0;border:0;z-index:3;cursor:grab;touch-action:none}';   /* 縦置きスイッチ＝上スワイプで中点越え→本物触覚 */
    document.head.appendChild(st); }
  // 設定の on/off トグルを「上スワイプで反転＋本物iOS触覚」に（タップも従来どおり動く）
  ['tgNotif', 'tgSeen', 'tgText', 'tgFounder'].forEach(idn => { const tg = $('#' + idn); if (tg) attachToggleHaptic(tg); });
  // ③b 全ボタン標準tap haptic（既存ハンドラで鳴る所は80ms coalesceで二重発火を回避。鳴らないボタンだけ補完）
  document.addEventListener('click', e => {   // Pre1 Notch 流: あらゆる操作要素で触覚（既存ハンドラで鳴る所は80ms coalesceで二重回避）
    const b = e.target && e.target.closest && e.target.closest('button, a, [role="button"], select, input[type="range"], input[type="checkbox"], .in-btn, .fab, .vtoggle, .vt-col, .sty-type, .hap-item, .me-pill, .conv, .swatch, .cat, .ib-ic, .ib-aa, .back, .add-back, .prof-act, .day-cell, .toggle');
    if (!b) return;
    if (Date.now() - _hapT > 80) { try { haptic.tap(); } catch (_) {} }
  }, false);
  $('#fabAdd').onclick = () => { haptic.tap(); enterAdd(); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { const ov = $('#searchOv'); if (ov && ov.classList.contains('show')) closeSearch(); } if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); const ov = $('#searchOv'); if (!ov || !ov.classList.contains('show')) openSearch(); } });
  { const mp = $('#mePill'); if (mp) { mp.onclick = () => { haptic.tap(); openProfile(); };   // 中央ピル(emoji+名前)→設定。名前変更は設定内(ppName)で
      let _mpT = null, _mpLP = false;   // 0.5s長押しでアクティビティ(稼働中アプリ・終了)を開く＝終了ボタンに到達できるように
      mp.addEventListener('pointerdown', () => { _mpLP = false; _mpT = setTimeout(() => { _mpLP = true; try { haptic.tap(); window.__openActivity && window.__openActivity(); } catch (e) {} }, 500); });
      const _mpEnd = () => { clearTimeout(_mpT); };
      mp.addEventListener('pointerup', _mpEnd); mp.addEventListener('pointerleave', _mpEnd); mp.addEventListener('pointercancel', _mpEnd);
      mp.addEventListener('click', (e) => { if (_mpLP) { e.preventDefault(); e.stopPropagation(); _mpLP = false; } }, true);   // 長押し時は設定を抑制
  } }
  makeNameEditable($('#ppName'));
  { const hs = $('#homeSearch'); if (hs) hs.onclick = () => { haptic.tap(); openSearch(); }; }
  $('#chatBack').onclick = () => { closeSnd(); detachChat(); curPeer = null; document.getElementById('app').classList.remove('monitor'); closeSheet('#styleSheet'); closeMsgCtx(); closeHapPop(); clearQuote(); enterHome(); };
  $('#addBack').onclick = () => { closeSnd(); stopScan(); enterHome(); };
  $('#addScan').onclick = () => { if (!scanning) startScan(); };
  $('#profHandoff').onclick = () => openPairing('owner');   // 旧:openHandoff(コード表示)→新:近接ペアリング(リング表示・所有者)
  $('#hoBack').onclick = () => { closeSnd(); clearHo(); enterHome(); };
  $('#regHandoff').onclick = () => openPairing('new');   // 旧:openPass(コード入力)→新:近接ペアリング(カメラ読取・新端末)。管理者ゲート(#regHoInput/#passInput)は不変で維持
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && $('#pairScanView') && !pairScanning && !pairConnectedFlag) { try { pairScan(); } catch (e) {} } });   // iOSホーム画面から戻った時にカメラ読取を再開（ペアリング継続）
  $('#passBack').onclick = () => { closeSnd(); $('#passInput').blur(); buildReg(); show('scrReg'); };
  $('#scrPass').addEventListener('click', e => { if (!e.target.closest('button')) $('#passInput').focus(); });
  $('#passInput').oninput = () => { const raw = $('#passInput').value; if (norm(raw) === ADMIN_PASS) { $('#passInput').value = ''; $('#passInput').blur(); becomeAdmin(); return; } const v = raw.replace(/\D/g, '').slice(0, 6); $('#passInput').value = v; renderPassDots(v.length); if (v.length === 6) { $('#passInput').blur(); handlePasscode(v); } };
  $('#hoiBtn').onclick = () => { $('#hoIsland').classList.remove('show'); };
  $('#profCss').onclick = () => {
    closeSheet('#profSheet'); $('#mask').classList.remove('show');
    // 管理者: HTMLの全CSSを取得してエディタに表示
    const existing = load('cx_usercss', '');
    if (me && me.admin && !existing) {
      const builtinStyle = document.querySelector('style:not(#userCss)');
      $('#cssArea').value = builtinStyle ? builtinStyle.textContent.replace(/^\s+/gm, '').trim() : '';
    } else {
      $('#cssArea').value = existing;
    }
    document.getElementById('app').classList.add('css-split'); $('#cssSheet').classList.add('show');
  };
  { const cc = $('#cssClose'); if (cc) cc.onclick = () => { document.getElementById('app').classList.remove('css-split'); $('#cssSheet').classList.remove('show'); }; }
  { const rz = $('#cssResize'); if (rz) { const mv = e => { const x = e.touches ? e.touches[0].clientX : e.clientX; let w = window.innerWidth - x; w = Math.max(280, Math.min(window.innerWidth - 340, w)); document.documentElement.style.setProperty('--cssw', w + 'px'); }; const up = () => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); }; rz.addEventListener('pointerdown', e => { e.preventDefault(); document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up); }); } }
  $('#cssArea').oninput = () => { const v = $('#cssArea').value; save('cx_usercss', v); const st = $('#userCss'); if (st) st.textContent = v; };
  { const vs = $('#cssVs'); if (vs) vs.onclick = () => {
    if (!me || !me.admin) return;                                       // Monacoは管理者のみ
    const app = $('#app');
    if (app.classList.contains('vsmode')) { app.classList.remove('vsmode'); try { haptic.tap(); } catch (e) {} return; }   // 戻す
    loadMonaco(mon => {
      const mount = $('#cssMonaco'); if (!mount) return;
      if (!_monacoEd) {
        _monacoEd = mon.editor.create(mount, { value: $('#cssArea').value, language: 'css', theme: 'vs-dark', minimap: { enabled: false }, fontSize: 14, automaticLayout: true, scrollBeyondLastLine: false, lineNumbers: 'on' });
        _monacoEd.onDidChangeModelContent(() => { const v = _monacoEd.getValue(); $('#cssArea').value = v; save('cx_usercss', v); const st = $('#userCss'); if (st) st.textContent = v; });   // 即時反映(0サーバー)
      } else { _monacoEd.setValue($('#cssArea').value); }
      app.classList.add('vsmode'); try { haptic.confirm(); } catch (e) {}
      setTimeout(() => { try { _monacoEd.layout(); } catch (e) {} }, 60);
    });
  }; }   // vs.png = Monaco起動(管理者のみ・CDN遅延読込・即時反映)
  /* Monaco 遅延ローダ(管理者がvs.pngを押した時だけCDN取得=通常は0req) */
  let _monaco = null, _monacoEd = null, _monacoLoading = false;
  const _MONBASE = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min';
  function loadMonaco(cb) {
    if (_monaco) return cb(_monaco);
    if (_monacoLoading) return; _monacoLoading = true;
    window.MonacoEnvironment = { getWorkerUrl: function () { return 'data:text/javascript;charset=utf-8,' + encodeURIComponent('self.MonacoEnvironment={baseUrl:"' + _MONBASE + '/"};importScripts("' + _MONBASE + '/vs/base/worker/workerMain.js");'); } };
    const s = document.createElement('script'); s.src = _MONBASE + '/vs/loader.js';
    s.onload = function () { try { window.require.config({ paths: { vs: _MONBASE + '/vs' } }); window.require(['vs/editor/editor.main'], function () { _monaco = window.monaco; _monacoLoading = false; cb(_monaco); }); } catch (e) { _monacoLoading = false; } };
    s.onerror = function () { _monacoLoading = false; try { toast('Monaco読込失敗', 'error'); } catch (e) {} };
    document.body.appendChild(s);
  }
  /* ☝️ 要素のクラスを視覚的に選び、CSSエディタのその行へ移動+選択(マーク)。on時は「ON」表示 */
  function jumpToClass(cls) {
    const ta = $('#cssArea'); if (!ta) return; const app = $('#app');
    if (app.classList.contains('vsmode') && _monacoEd) {
      let txt = _monacoEd.getValue(); let idx = txt.indexOf('.' + cls);
      if (idx < 0) { _monacoEd.setValue(txt + (txt && !txt.endsWith('\n') ? '\n' : '') + '.' + cls + ' {\n  \n}\n'); txt = _monacoEd.getValue(); idx = txt.indexOf('.' + cls); }
      try { const pos = _monacoEd.getModel().getPositionAt(idx); _monacoEd.revealLineInCenter(pos.lineNumber); _monacoEd.setPosition(pos); _monacoEd.focus(); } catch (e) {}
      try { haptic.confirm(); } catch (e) {} return;
    }
    let v = ta.value; let idx = v.indexOf('.' + cls);
    if (idx < 0) { v = v + (v && !v.endsWith('\n') ? '\n' : '') + '.' + cls + ' {\n  \n}\n'; ta.value = v; save('cx_usercss', v); const st = $('#userCss'); if (st) st.textContent = v; idx = v.indexOf('.' + cls); }
    ta.focus(); ta.setSelectionRange(idx, idx + 1 + cls.length);
    const line = v.slice(0, idx).split('\n').length; ta.scrollTop = Math.max(0, (line - 3) * 19);
    try { haptic.confirm(); } catch (e) {}
  }
  { const pk = $('#cssPick'); if (pk) pk.onclick = () => {
      const on = !pk.classList.contains('on');
      pk.classList.toggle('on', on); pk.textContent = on ? 'ON' : '☝️'; $('#app').classList.toggle('css-picking', on);
      if (on) { try { haptic.tap(); } catch (e) {}
        const handler = (e) => {
          const sheet = $('#cssSheet'); if ((sheet && sheet.contains(e.target)) || e.target === pk) return;
          e.preventDefault(); e.stopPropagation();
          document.removeEventListener('pointerdown', handler, true);
          pk.classList.remove('on'); pk.textContent = '☝️'; $('#app').classList.remove('css-picking');
          const cls = (e.target.classList && e.target.classList[0]) || '';
          if (!cls) { try { toast('クラスが無い要素', 'error'); } catch (_) {} return; }
          jumpToClass(cls);
        };
        pk._handler = handler; setTimeout(() => document.addEventListener('pointerdown', handler, true), 0);
      } else if (pk._handler) { document.removeEventListener('pointerdown', pk._handler, true); }
    }; }
  { const bb = $('#btnBackup'); if (bb) bb.onclick = exportBackup; }
  { const br = $('#btnRestore'), rf = $('#restoreFile'); if (br && rf) { br.onclick = () => rf.click(); rf.onchange = () => { if (rf.files[0]) importBackup(rf.files[0]); rf.value = ''; }; } }
  { const flb = $('#btnFounderLink'); if (flb) flb.onclick = () => { const url = location.origin + location.pathname + '?founder=1'; try { navigator.clipboard.writeText(url); toast('招待リンクをコピー'); } catch (e) { toast(url); } }; }   // @founder招待リンク
  { const nc = $('#nameOvCheck'), ni = $('#nameOvInput'), no = $('#nameOv'); if (nc && ni && no) { nc.onclick = () => closeNameEdit(true); ni.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); closeNameEdit(true); } }); no.addEventListener('click', e => { if (e.target.id === 'nameOv') closeNameEdit(false); }); } }
  { const hw = $('#regHoWrap'), hb = $('#regHoBtn'), hi = $('#regHoInput'); if (hw && hb && hi) { hb.onclick = () => { hw.classList.add('editing'); hi.value = ''; hi.focus(); }; hi.oninput = () => { const v = hi.value; if (norm(v) === ADMIN_PASS) { hi.value = ''; hi.blur(); hw.classList.remove('editing'); becomeAdmin(); return; } if (/^\d{6}$/.test(v.trim())) { hi.blur(); handlePasscode(v.trim()); } }; hi.onblur = () => setTimeout(() => hw.classList.remove('editing'), 150); } }
  const find = $('#addFind');
  if (find) find.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const v = find.value; find.value = ''; find.blur(); findByName(v); } });   // 名前検索は廃止予定(QRのみ)。要素が無くても安全に
  { const eb = $('#emojiBtn'); if (eb) eb.onclick = () => { if ($('#emojiSheet').classList.contains('show')) { closeSheet('#emojiSheet'); closeSnd(); } else openSheet('#emojiSheet'); }; }
  const ta = $('#ta');
  ta.addEventListener('input', () => { autoGrow(); $('#sendBtn').disabled = !ta.value.trim(); sendTyping(!!ta.value.trim()); });
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); } });
  ta.addEventListener('blur', () => sendTyping(false));
  $('#sendBtn').onclick = doSend;
  // 画像: ＋ボタン / ファイル選択 / ドラッグ&ドロップ / 貼り付け
  { const ab = $('#attachBtn'), fi = $('#fileIn'); if (ab && fi) { ab.onclick = () => { haptic.tap(); fi.click(); }; fi.onchange = () => { if (fi.files && fi.files.length) sendImages(fi.files); fi.value = ''; }; } }
  { const es = $('#emojiSendBtn'); if (es) es.onclick = () => { if (!curPeer) { toast('会話を開いてね', 'error'); return; } openEmojiPicker(null, e => { emojiPop(e); if (canSend()) pushMessage(e, e); }); }; }   // 感情絵文字(人間/猫切替)で送信
  // iconEpick wiring
  { const iep = $('#iconEpick'); if (iep) iep.onclick = e => { if (e.target.id === 'iconEpick') { closeIconEpick(); Snd.play('ex', .7); } }; }
  { const ic = $('#iconEpickCenter'); if (ic) ic.onclick = () => {
    haptic.tap();
    if (iconEpickMode === 'settings') { Snd.play('close', .7); closeIconEpick(); }
    else { if (!me || !curPeer) { closeIconEpick(); return; } const emoji = me.icon; closeIconEpick(); emojiPop(emoji); if (canSend()) pushMessage(emoji, emoji); }
  }; }
  // message context menu
  // haptic popover
  { const hb = $('#hapticBtn'), hp = $('#hapticSheet'); if (hb && hp) hb.onclick = () => { if (hp.classList.contains('show')) closeHapPop(); else openHapPop(); }; }
  { const hm = $('#hapMask'); if (hm) hm.onclick = () => closeHapPop(); }
  [].forEach.call(document.querySelectorAll('.hap-item'), btn => { btn.onclick = () => { setHapticMode(btn.dataset.mode); haptic.sel(); }; });
  { const mask = $('#msgCtxMask'); if (mask) mask.onclick = () => closeMsgCtx(); }
  { const cr = $('#ctxRetract'); if (cr) cr.onclick = () => { const m = ctxMsg; closeMsgCtx(); if (m) retractMsg(m); }; }
  { const cc = $('#ctxCopy'); if (cc) cc.onclick = () => { const m = ctxMsg; closeMsgCtx(); if (!m) return;
    let ctext = m.t || '';
    if (ctext.startsWith('cxhap:')) { ctext = ctext.split(':').slice(2).join(':'); }
    else if (ctext.startsWith('cxq:')) { try { ctext = JSON.parse(ctext.slice(4)).t || ctext; } catch(e) {} }
    else if (ctext.startsWith('cxsty:')) { try { ctext = JSON.parse(ctext.slice(6)).t || ctext; } catch(e) {} }
    else if (ctext.startsWith('cximg:')) { ctext = '📷 写真'; }
    try { navigator.clipboard.writeText(ctext); toast('コピーしました'); } catch(e) { toast('コピーできません','error'); }
  }; }
  { const qx = $('#quoteBarX'); if (qx) qx.onclick = () => { clearQuote(); haptic.tap(); }; }
  // メッセージ: 右→左スワイプ=引用 / ダブルタップ=メニュー(取消・コピー) / シングルタップ=haptic
  { const msgs = $('#msgs');
    if (msgs) {
      let sx=0, sy=0, curRow=null, curM=null, swiping=false, moved=false, lastTapT=0, lastTapId=null;
      const findM = node => { const row = node && node.closest && node.closest('.row'); if (!row || !row.dataset.id || !curPeer) return [null,null]; const m = (chat(curPeer).msgs||[]).find(x=>x.id===row.dataset.id); return [row, m||null]; };
      msgs.addEventListener('pointerdown', e => {
        const bubble = e.target.closest('.bubble');
        if (!bubble || bubble.closest('.typing')) { curRow=null; curM=null; return; }
        const r = findM(bubble); curRow=r[0]; curM=r[1]; sx=e.clientX; sy=e.clientY; swiping=false; moved=false;
      }, {passive:true});
      msgs.addEventListener('pointermove', e => {
        if (!curRow || !curM) return;
        const dx=e.clientX-sx, dy=e.clientY-sy;
        if (Math.abs(dx)>6||Math.abs(dy)>6) moved=true;
        if (!swiping && dx<0 && Math.abs(dx)>14 && Math.abs(dx)>Math.abs(dy)*1.4) swiping=true;   // 右→左スワイプ開始
        if (swiping) { if (e.cancelable) e.preventDefault(); const t=Math.max(dx,-90); curRow.style.transition='none'; curRow.style.transform='translateX('+t+'px)'; }
      }, {passive:false});
      const reset = () => { if (curRow) { const r=curRow; r.style.transition='transform .3s var(--spring)'; r.style.transform=''; } };
      msgs.addEventListener('pointerup', e => {
        if (!curRow || !curM) return;
        const dx=e.clientX-sx;
        if (swiping) { if (dx < -55) { setQuote(curM); haptic.confirm(); } reset(); curRow=null; curM=null; return; }
        if (!moved) {
          const tnow = now();
          if (lastTapId===curM.id && tnow-lastTapT<350) { lastTapT=0; lastTapId=null; showMsgCtx(curM, e.clientY); }   // ダブルタップ→メニュー
          else { lastTapT=tnow; lastTapId=curM.id; if (curRow.dataset.haptic) fireHapticMode(curRow.dataset.haptic); }   // シングル→haptic
        }
        curRow=null; curM=null;
      }, {passive:true});
      msgs.addEventListener('pointercancel', () => { reset(); curRow=null; curM=null; }, {passive:true});
      // 何もない所(バブル/ボタン以外)をタップ→入力にフォーカス。iOSはキーボード表示にジェスチャ内focusが必須なのでclickで即時。
      msgs.addEventListener('click', e => {
        if (e.target.closest('.bubble, button, a, img, video, input, textarea, .seen')) return;
        const ta = $('#ta'); if (ta && curPeer && !$('#app').classList.contains('monitor')) { try { haptic.tap(); } catch (_) {} ta.focus(); }
      });
    }
  }
  { const sb = $('#styleBtn'); if (sb) sb.onclick = () => openStyleSheet(); }
  [].forEach.call(document.querySelectorAll('.sty-type'), b => b.onclick = () => setStyType(b.dataset.y));
  { const sa = $('#styAdd'); if (sa) sa.onclick = () => { const ta = $('#styInput'); if (ta.value.trim()) ta.value = ta.value.replace(/\n+$/, '') + '\n'; ta.focus(); haptic.tap(); }; }
  { const ss = $('#stySend'); if (ss) ss.onclick = styleSend; }
  enableSheetSwipe('#styleSheet');
  { const lc = $('#loaderCancel'); if (lc) lc.onclick = () => loaderHide(); }   // 5秒後に出るキャンセル
  { const sc = $('#scrChat'); if (sc) {
    ['dragenter', 'dragover'].forEach(ev => sc.addEventListener(ev, e => { if (e.dataTransfer && [].indexOf.call(e.dataTransfer.types, 'Files') >= 0) { e.preventDefault(); sc.classList.add('dragover'); } }));
    sc.addEventListener('dragleave', e => { if (e.target === sc) sc.classList.remove('dragover'); });
    sc.addEventListener('drop', e => { e.preventDefault(); sc.classList.remove('dragover'); const fs = e.dataTransfer && [].slice.call(e.dataTransfer.files).filter(x => /^image\//.test(x.type)); if (fs && fs.length) sendImages(fs); });
    // 左→右スワイプ=メイン(ホーム)に戻る
    let bx=0, by=0, btrack=false, bgo=false;
    sc.addEventListener('pointerdown', e => { if (e.target.closest('input, textarea, button, .msg-img, .hap-pop')) { btrack=false; return; } bx=e.clientX; by=e.clientY; btrack=true; bgo=false; }, {passive:true});
    sc.addEventListener('pointermove', e => { if (!btrack) return; const dx=e.clientX-bx, dy=e.clientY-by; if (dx>50 && dx>Math.abs(dy)*1.6) bgo=true; }, {passive:true});
    sc.addEventListener('pointerup', e => { if (btrack && bgo && (e.clientX-bx)>80 && curPeer) $('#chatBack').click(); btrack=false; bgo=false; }, {passive:true});
  } }
  ta.addEventListener('paste', e => { const items = e.clipboardData && e.clipboardData.items; const it = items && [].slice.call(items).find(x => x.type && x.type.indexOf('image/') === 0); if (it) { const f = it.getAsFile(); if (f) { e.preventDefault(); sendImages(f); } } });
  setNet(!navigator.onLine);                                          // オフライン island
  window.addEventListener('online', () => setNet(false));
  window.addEventListener('offline', () => setNet(true));
  enableSheetSwipe('#profSheet'); enableSheetSwipe('#emojiSheet');   // 上から下スワイプで閉じる
  { const gc = $('#grpCancel'); if (gc) gc.onclick = () => exitSelMode(); }
  { const gm = $('#grpMake'); if (gm) gm.onclick = () => createGroupFromSel(); }
  { const gd = $('#grpDel'); if (gd) gd.onclick = () => { const s = Object.keys(_selSet).filter(x => _selSet[x]); if (s.length === 1) { const pid = s[0]; exitSelMode(); doDeleteConv(pid); } }; }   // 選択1人=会話削除(従来機能を温存)
  document.addEventListener('pointerdown', e => {
    Snd.unlock();
    const b = e.target.closest('button, .conv, .me-ava, #ppAva, .add-scan, .sw, #emojiGrid button, .cat, .field, .me-name, .pp-name');
    if (!b || b.closest('.vtoggle') || b.closest('.slider-knob')) return;
    haptic.tap();
  }, true);
}
function islandA2H() {
  const isl = $('#island'); if (!isl) return;
  const mac = /Macintosh/.test(navigator.userAgent) && (navigator.maxTouchPoints || 0) === 0;
  $('#islIc').textContent = mac ? '🖥️' : '📲'; $('#islTx').textContent = (mac ? 'Dockに追加' : 'ホーム画面に追加') + ' 👀'; $('#islOk').style.display = 'none';
  isl.classList.add('show');
  let sy = 0;
  const close = () => { isl.classList.remove('show'); isl.ontouchstart = isl.ontouchmove = isl.onclick = null; };
  isl.onclick = close;
  isl.ontouchstart = e => { sy = e.touches[0].clientY; };
  isl.ontouchmove = e => { if (sy - e.touches[0].clientY > 28) close(); };
  setTimeout(close, 8000);
}
function maybeA2H() { if (!isStandalone()) setTimeout(islandA2H, 1400); }
/* OS標準ジェスチャ(拡大縮小/戻る進む/更新)をブロック */
function blockGestures() {
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(ev => document.addEventListener(ev, e => e.preventDefault(), { passive: false }));
  document.addEventListener('wheel', e => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
  document.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && (e.key === '+' || e.key === '-' || e.key === '=' || e.key === '0')) e.preventDefault(); }, { passive: false });
  // iOS 端からの左右スワイプ(戻る/進む)を完全ブロック（縦スクロールは生かす）
  let sx = 0, sy = 0, edge = false;
  document.addEventListener('touchstart', e => { const t = e.touches[0]; if (!t) return; sx = t.clientX; sy = t.clientY; edge = (sx < 28 || sx > window.innerWidth - 28); }, { passive: true });
  document.addEventListener('touchmove', e => { if (!edge) return; const t = e.touches[0]; if (!t) return; if (Math.abs(t.clientX - sx) > Math.abs(t.clientY - sy) && e.cancelable) e.preventDefault(); }, { passive: false });
  // 履歴トラップ（戻るで離脱させない）
  try { history.pushState(null, '', location.href); history.pushState(null, '', location.href); window.addEventListener('popstate', () => { try { history.pushState(null, '', location.href); } catch (e) {} }); } catch (e) {}
}
function antiTamper() {
  const editable = t => t && t.closest && t.closest('input,textarea,.uname,.ho-code,.field,.name-edit,.css-area,.add-find,.pastebox');
  document.addEventListener('contextmenu', e => { if (!editable(e.target)) e.preventDefault(); });
  document.addEventListener('dragstart', e => e.preventDefault());
  document.addEventListener('selectstart', e => { if (!editable(e.target)) e.preventDefault(); });
  document.addEventListener('copy', e => { if (!editable(e.target)) e.preventDefault(); });
  document.addEventListener('cut', e => { if (!editable(e.target)) e.preventDefault(); });
  document.addEventListener('keydown', e => {
    const k = (e.key || '').toLowerCase(), m = e.metaKey || e.ctrlKey;
    if (e.key === 'F12') return e.preventDefault();
    if (m && (k === 's' || k === 'u' || k === 'p' || k === 'i' || k === 'j')) return e.preventDefault();             // 保存/ソース/印刷/devtools
    if (m && e.shiftKey && (k === 's' || k === 'i' || k === 'j' || k === 'c' || k === 'k' || k === 'e')) return e.preventDefault();
    if (m && e.altKey && (k === 'i' || k === 'j' || k === 'u' || k === 'c')) return e.preventDefault();
    if (m && !editable(e.target) && (k === 'c' || k === 'a' || k === 'x')) return e.preventDefault();                 // 非入力でのコピー/全選択/切取
  }, true);
}

/* =========================================================================
   boot
   ========================================================================= */
function showUnsupported() {
  const o = el('div'); o.style.cssText = 'position:absolute;inset:0;z-index:300;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px;gap:12px';
  const h = el('div'); h.style.cssText = 'font-size:22px;font-weight:800'; h.textContent = '非対応のOSです';
  const p = el('div'); p.style.cssText = 'font-size:14px;color:#8a8a8e;font-weight:600;line-height:1.9'; p.textContent = 'このアプリは iOS 17 以降が必要です。';
  o.append(h, p); document.getElementById('app').appendChild(o); const s = $('#splash'); if (s) s.remove();
}
window.addEventListener('error', () => { try { loaderHide(); } catch (_) {} });
window.addEventListener('unhandledrejection', () => { try { loaderHide(); } catch (_) {} });
async function boot() {
  const t0 = performance.now();
  // Meet to Meet は廃止。開いたら従来の「現在使用できません」UIだけを表示し、本体（登録/チャット/認証）は一切起動しない。
  try { hapticInit(); } catch (e) {}
  try { showSuspended(); }
  catch (e) { try { document.getElementById('app').innerHTML = '<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;background:#000;font:600 22px/1.5 -apple-system,system-ui,sans-serif;text-align:center;padding:24px">現在使用できません<br><span style="font-weight:400;font-size:15px;opacity:.6">このアカウントはご利用いただけません。</span></div>'; } catch (_) {} }
  try { loaderHide(); } catch (e) {}
  try { const s = document.getElementById('splash'); if (s) { s.classList.add('hide'); setTimeout(() => { try { s.remove(); } catch (_) {} }, 600); } } catch (e) {}
  return;
  /* eslint-disable no-unreachable */
  /* ↓ 旧 Meet to Meet 本体（廃止により未実行） */
  try {
    if (isIOS() && iosMajor() > 0 && iosMajor() < 17) { showUnsupported(); return; }   // iOS17未満は非対応
    antiTamper(); blockGestures(); hapticInit(); wireUI(); buildEmoji(); initDelete();
    document.getElementById('app').classList.toggle('textmode', !!settings.textMode);
    { const _uc = $('#userCss'); if (_uc) _uc.textContent = load('cx_usercss', ''); }
    $('#a2hClose').onclick = () => { $('#a2h').classList.remove('show'); save('cx_a2h', 1); closeSnd(); };
    if ('serviceWorker' in navigator) {
      const had = !!navigator.serviceWorker.controller; let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (had && !reloaded) { reloaded = true; location.reload(); } });
      navigator.serviceWorker.register('sw.js').then(reg => {
        reg.update();
        // PWAを開き直す/前面に戻すたびに更新チェック → 新HTML/JSがあれば自動で適用しリロード
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { try { reg.update(); } catch (e) {} } });
      }).catch(() => {});
    }
    applyHapticBtn();
    if (me) { applyMe(); enterHome(); } else { buildReg(); show('scrReg'); }
    maybeA2H();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && curPeer) { chat(curPeer).unread = 0; saveChats(); renderList(); publishRead(curPeer); } });
    if (!fbConfigured()) { showSetup(); return; }
    const ok = await ensureAuth();                                     // 起動中はsplashのみ(ローダー重複を出さない)
    if (ok && me) { watchAll(); if (settings.notif) subscribePush(); if (curPeer) publishRead(curPeer); }   // 通知ONなら再購読
  } catch (e) {
    try { if (me) { applyMe(); enterHome(); } else { buildReg(); show('scrReg'); } } catch (_) {}
  } finally { loaderHide(); const s = $('#splash'); if (s) setTimeout(() => { s.classList.add('hide'); setTimeout(() => s.remove(), 600); }, Math.max(0, 650 - (performance.now() - t0))); }
}
boot();
/* 検索(spotlight)を起動後アイドルに先読み＝開いた瞬間に即表示（重いthree.js/語彙の初回ロード遅延を解消） */
try { const _warm = () => { try { warmSearch(); } catch (e) {} }; setTimeout(_warm, 300); document.addEventListener('pointerdown', _warm, { once: true, passive: true }); } catch (e) {}   // 起動直後+初回タッチで先読み=初回オープンを高速化
/* index-extras.js / index-s2s.js（並行セッション）が window 経由で参照する関数を公開＝
   📎添付・シェイクカメラの画像送信・登録ゲート(buildReg)・haptic/save/toast が index 版で実際に動くように。 */
try { Object.assign(window, { sendImages: sendImages, canSend: canSend, buildReg: buildReg, haptic: haptic, save: save, toast: toast, addFriend: addFriend, findByName: findByName }); } catch (e) {}   // addFriend/findByName = index版 @id連携(URL/検索)から呼ぶ
})();
