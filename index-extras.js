/* index-extras.js — index版だけの追加挙動。app.js は一切編集しない（並行セッションと衝突しない）。
 *   1) 入力バー刷新: 📎 / 🫨 / Aa（morph）
 *   2) シェイクカメラ（共通）: シェイク/ダブルタップ/Force Touch撮影・タイマー(3/7s)・明るさ/彩度/なめらか・
 *      シェイクフィルタ(デジカメ標準/普通は無し)・📸/普通・0.2sフラッシュ・ベストショット(前面/背面)選択
 *   3) CSSエディタに shaketoshake.css を即反映
 */
(function () {
  'use strict';
  var D = document;
  function $(s, r) { return (r || D).querySelector(s); }
  function ce(tag, cls) { var n = D.createElement(tag); if (cls) n.className = cls; return n; }
  function vib(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {} }
  function toast(m, t) { try { if (window.toast) return window.toast(m, t); } catch (e) {} }
  function ready(fn) { if (D.readyState !== 'loading') setTimeout(fn, 0); else D.addEventListener('DOMContentLoaded', function () { setTimeout(fn, 0); }); }

  /* iOS確実触覚（決定版）: 対象ボタンに“本物”の透明 <input switch>（opacity:0・全面・pointer-events有効）を重ね、
   *   指の実タップで直接トグル → iOSが「ユーザー操作」と認め 26.5 でも 1タップ=確実に1発。change で本来の動作を実行。
   *   ※透明化は opacity:0 のみ（display:none/visibility:hidden/appearance:none は本物スイッチでなくなり触覚が出ない）。 */
  function hapTap(btn, fn, opt) {
    if (!btn) return btn;
    opt = opt || {};
    if (btn._hap) { btn._hapFn = (fn !== undefined ? fn : btn._hapFn); return btn; }   // 二重バインド防止（アクションだけ差し替え）
    try { if (getComputedStyle(btn).position === 'static') btn.style.position = 'relative'; } catch (e) {}
    var sw = D.createElement('input');
    sw.type = 'checkbox'; sw.setAttribute('switch', ''); sw.className = 'hap-sw'; sw.setAttribute('aria-hidden', 'true'); sw.tabIndex = -1;
    btn._hap = sw; btn._hapFn = fn || null;
    sw.addEventListener('change', function (ev) {
      try { if (navigator.vibrate) navigator.vibrate(opt.burst || 12); } catch (e) {}   // Androidフォールバック（iOSはスイッチ自体が鳴る）
      sw.checked = false;                                                                // 戻して次タップでも確実に鳴る
      var f = btn._hapFn; if (f) { try { f.call(btn, ev); } catch (e) {} }
    });
    btn.appendChild(sw);
    return btn;
  }
  try { window.__hapTap = hapTap; } catch (e) {}

  /* 起動時の手書き「hello」（index版・web/PWA）。HelloText のストロークデータ hello/<lang>.json を
   * システムの国/地域ロケールで1言語だけ Canvas に手書き描画 → 少し保持 → 0.5s scaleup で退場。
   * 枠なし・不透明な暗転で中央アイコンは出さない。出すのはアカウント作成前だけ（登録済み cx_me / 停止 #suspendedOv では出さない）。 */
  function setupHelloGreeting(opts) {
    opts = opts || {};
    var darkTheme = true; try { darkTheme = !(window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches); } catch (e) {}
    var INK = darkTheme ? '#fff' : '#0b0b0c', GLOW = darkTheme ? 'rgba(255,255,255,.55)' : 'rgba(10,10,12,.20)';   // 文字色もテーマ追従（ライト背景で白字＝見えない を回避）
    function reg() { try { return !!localStorage.getItem('cx_me'); } catch (e) { return false; } }   // アカウント作成済み？
    function susp() { return !!D.getElementById('suspendedOv'); }                                     // 使用不可（停止画面）？
    if (!opts.force && (reg() || susp())) return;                                                     // force=引き継ぎ完了時など（登録済みでも出す）
    if (D.getElementById('idxHello')) return;                                                         // 既に表示中なら二重表示しない
    if (!D.body) { ready(function () { setupHelloGreeting(opts); }); return; }                        // body未生成なら準備後に
    if (!opts.force) { try { var _la = +sessionStorage.getItem('idxHelloAt') || 0; if (Date.now() - _la < 2500) return; sessionStorage.setItem('idxHelloAt', String(Date.now())); } catch (e) {} }   // 連発抑止（once→クールダウン：ホーム/前景復帰でも再生）
    if (!D.getElementById('idxHelloCss')) {
      var st = ce('style'); st.id = 'idxHelloCss';
      st.textContent = '#idxHello{position:fixed;inset:0;z-index:100000;overflow:hidden;opacity:1;transition:opacity .5s ease,transform .5s ease;will-change:opacity,transform;background:rgba(0,0,0,.92);-webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px)}'
        + '@media (prefers-color-scheme: light){#idxHello{background:rgba(244,246,249,.92)}}'           // bgは黒固定をやめテーマ追従（黒でなくてOK）
        + '#idxHello.out{opacity:0;transform:scale(1.18)}'                                            // 退場=0.5s scaleup+フェード
        + '#idxHello canvas{position:absolute;inset:0;width:100%;height:100%;display:block}'
        + '@media (prefers-reduced-motion:reduce){#idxHello{transition:opacity .3s ease}#idxHello.out{transform:none}}';
      (D.head || D.documentElement).appendChild(st);
    }
    function pickLang() {   // navigator のロケール → HelloText のファイル名（pt/zh は地域別）
      var raw = (navigator.languages && navigator.languages[0]) || navigator.language || 'en';
      raw = String(raw).replace('_', '-'); var p = raw.toLowerCase().split('-'); var base = p[0], region = (p[1] || '').toUpperCase();
      if (base === 'zh') { if (region === 'TW' || /hant/i.test(raw)) return 'zh_TW'; if (region === 'HK') return 'zh_HK'; return 'zh_CN'; }
      if (base === 'pt') { return region === 'BR' ? 'pt_BR' : 'pt_PT'; }
      var AV = { ar:1,ca:1,cs:1,da:1,de:1,el:1,en:1,es:1,fi:1,fr:1,he:1,hi:1,hr:1,hu:1,id:1,it:1,ja:1,ko:1,lt:1,ms:1,nl:1,no:1,pl:1,ro:1,ru:1,sk:1,sl:1,sv:1,th:1,tr:1,uk:1,vi:1 };
      return AV[base] ? base : 'en';
    }
    var ov = ce('div'); ov.id = 'idxHello';
    var cv = ce('canvas'); ov.appendChild(cv); D.body.appendChild(ov);                                // 不透明な黒で即・中央アイコンを隠す
    var done = false, guard = null, anim = null;
    function dismiss() { if (done) return; done = true; if (guard) clearInterval(guard); if (anim) clearTimeout(anim); ov.classList.add('out'); setTimeout(function () { try { ov.remove(); } catch (e) {} }, 560); }
    ov.addEventListener('pointerdown', dismiss);                                                      // タップで早く閉じてもOK
    guard = setInterval(function () { if (susp()) { try { ov.remove(); } catch (e) {} if (guard) clearInterval(guard); } }, 200);
    setTimeout(function () { if (guard) clearInterval(guard); }, 3000);
    setTimeout(function () { try { ov.remove(); } catch (e) {} }, 8000);                              // 絶対セーフティ
    function draw(glyph) {
      var ctx = cv.getContext('2d'); if (!ctx) { setTimeout(dismiss, 600); return; }
      var DPR = 1, W = 0, H = 0, fit = null;
      function bez(a, b, c, d, t) { var mt = 1 - t; return mt * mt * mt * a + 3 * mt * mt * t * b + 3 * mt * t * t * c + t * t * t * d; }
      function buildWord(g) {
        var sc = g.scale || [1, 1, 1, 1], sx = sc[0], sy = sc[1], sw = sc[3] || 1;
        var strokes = [], widths = [], minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, i;
        (g.strokes || []).forEach(function (stroke) {
          var pts = [];
          stroke.forEach(function (s) {
            var p0 = s.p0, p1 = s.p1, p2 = s.p2, p3 = s.p3, chord = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
            var steps = Math.max(8, Math.min(60, Math.round(chord / 18)));
            for (var k = (pts.length ? 1 : 0); k <= steps; k++) {
              var t = k / steps, x = bez(p0[0], p1[0], p2[0], p3[0], t) * sx, y = bez(p0[1], p1[1], p2[1], p3[1], t) * sy, w = bez(p0[3], p1[3], p2[3], p3[3], t) * sw;
              pts.push({ x: x, y: y, w: w }); widths.push(w);
              if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
          });
          var len = 0; for (i = 1; i < pts.length; i++) { len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); pts[i].s = len; }
          if (pts.length) pts[0].s = 0; strokes.push({ pts: pts, len: len });
        });
        widths.sort(function (a, b) { return a - b; });
        return { strokes: strokes, total: strokes.reduce(function (a, s) { return a + s.len; }, 0), medW: widths.length ? widths[widths.length >> 1] : 30, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY };
      }
      var word = buildWord(glyph);
      function layout() { var aw = W * DPR * 0.78, ah = H * DPR * 0.46, s = Math.min(aw / word.w, ah / word.h); fit = { s: s, ox: W * DPR / 2 - word.cx * s, oy: H * DPR / 2 + word.cy * s, lw: word.medW * s * 1.05 }; }
      function resize() { if (done) return; DPR = Math.min(window.devicePixelRatio || 1, 2.5); W = window.innerWidth; H = window.innerHeight; cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR); layout(); }
      window.addEventListener('resize', resize); resize();
      function SX(p) { return fit.ox + p.x * fit.s; } function SY(p) { return fit.oy - p.y * fit.s; }   // y反転（フォントはy上向き）
      function paint(f) {
        ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = INK; ctx.lineWidth = fit.lw; ctx.shadowColor = GLOW; ctx.shadowBlur = fit.lw * 1.6;
        var target = f * word.total, acc = 0, tip = null, k, i;
        for (k = 0; k < word.strokes.length; k++) {
          var stk = word.strokes[k]; if (acc >= target) break; var pts = stk.pts, started = false; ctx.beginPath();
          for (i = 0; i < pts.length; i++) {
            if (acc + (pts[i].s || 0) <= target) { var x = SX(pts[i]), y = SY(pts[i]); if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y); tip = pts[i]; }
            else { var pv = pts[i - 1], sl = (pts[i].s - pv.s) || 1e-6, r = (target - (acc + pv.s)) / sl; if (started) ctx.lineTo(SX({ x: pv.x + (pts[i].x - pv.x) * r }), SY({ y: pv.y + (pts[i].y - pv.y) * r })); tip = { x: pv.x + (pts[i].x - pv.x) * r, y: pv.y + (pts[i].y - pv.y) * r }; break; }
          }
          if (started) ctx.stroke(); acc += stk.len;
        }
        if (tip && f < 1) { ctx.shadowBlur = fit.lw * 3; ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(SX(tip), SY(tip), fit.lw * 0.62, 0, 7); ctx.fill(); }   // 描いてる先端の光
        ctx.shadowBlur = 0;
      }
      var reduce = false; try { reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches; } catch (e) {}
      var drawMs = reduce ? 1 : Math.max(1100, Math.min(2600, word.total / 1000 * 620)), HOLD = reduce ? 500 : 650;
      var now0 = (window.performance && performance.now) ? performance.now() : (+new Date());
      function clk() { return ((window.performance && performance.now) ? performance.now() : (+new Date())) - now0; }
      function tick() {   // setTimeout 駆動＝起動直後にrAFが抑制されても確実に描画が進む
        if (done) return; var el = clk(); ctx.clearRect(0, 0, cv.width, cv.height);
        if (el < drawMs) { var f = el / drawMs; paint(1 - Math.pow(1 - f, 1.7)); anim = setTimeout(tick, 16); }
        else { paint(1); if (el < drawMs + HOLD) anim = setTimeout(tick, 32); else dismiss(); }
      }
      tick();
    }
    function load(f, allowFallback) {
      fetch('hello/' + f + '.json').then(function (r) { if (!r.ok) throw 0; return r.json(); })
        .then(function (g) { if (!done) draw(g); })
        .catch(function () { if (allowFallback && f !== 'en') load('en', false); else setTimeout(dismiss, 500); });
    }
    load(pickLang(), true);
  }
  try { window.cxShowHello = function (o) { try { setupHelloGreeting(o || {}); } catch (e) {} }; } catch (e) {}   // app.js（IIFE）から完了時/ホーム復帰時に呼ぶ
  try { setupHelloGreeting(); } catch (e) {}   // 起動と同時に（中央アイコンより前に）暗転で覆う＝速い・アイコンを出さない
  try { D.addEventListener('visibilitychange', function () { if (D.visibilityState === 'visible') window.cxShowHello(); }); window.addEventListener('pageshow', function (e) { if (e && e.persisted) window.cxShowHello(); }); } catch (e) {}   // 前景/bfcache復帰でも（登録前のみ・gate内蔵）

  /* ===== ID連携（@id / 連携URL）=====
   * ・登録済み: add画面に「連携リンクをコピー」（中身=QRの uid を文字化＝ ?c=<uid>）。
   * ・?c=<uid> で開いた時: つながる確認画面。つながる→addFriend / 拒否はジェスチャ（iPhone=シェイク, 不可=長押し, Mac=trackpad押し込み）。
   * ・未登録で開いた時: 相手の @id を見せ「垢つくって繋がる」→登録後に自動連携（pendingConnect）。 */
  function setupConnectLink() {
    function fdb() { try { return firebase.database(); } catch (e) { return null; } }
    function myUid() { try { return (firebase.auth().currentUser || {}).uid || null; } catch (e) { return null; } }
    function isReg() { try { return !!localStorage.getItem('cx_me'); } catch (e) { return false; } }
    function friendsMap() { try { return JSON.parse(localStorage.getItem('cx_friends') || '{}'); } catch (e) { return {}; } }
    function whenAuth(cb) { try { var u = firebase.auth().currentUser; if (u) return cb(u); firebase.auth().onAuthStateChanged(function (x) { if (x) cb(x); }); } catch (e) {} }
    var IS_IOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    var IS_MAC = /Macintosh/i.test(navigator.userAgent) && !('ontouchend' in document);
    var HAS_MOTION = (typeof DeviceMotionEvent !== 'undefined');
    if (!D.getElementById('cxConnCss')) {
      var st = ce('style'); st.id = 'cxConnCss';
      st.textContent = '#cxConn{position:fixed;inset:0;z-index:99990;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:13px;padding:34px;background:rgba(18,18,22,.5);-webkit-backdrop-filter:blur(34px) saturate(1.7);backdrop-filter:blur(34px) saturate(1.7);opacity:0;transition:opacity .4s ease;text-align:center;color:#fff;-webkit-user-select:none;user-select:none;touch-action:none}'
        + '#cxConn.in{opacity:1}#cxConn.out{opacity:0;transform:scale(1.06);transition:opacity .45s ease,transform .45s ease}'
        + '#cxConn .cc-ava{width:120px;height:120px;border-radius:50%;display:grid;place-items:center;font-size:64px;overflow:hidden;box-shadow:0 0 0 6px rgba(255,255,255,.1),0 18px 50px rgba(0,0,0,.45)}'
        + '#cxConn .cc-ava img{width:100%;height:100%;object-fit:cover}'
        + '#cxConn .cc-nm{font-size:27px;font-weight:800}#cxConn .cc-id{font-size:15px;font-weight:600;opacity:.66}'
        + '#cxConn .cc-go{margin-top:10px;border:none;border-radius:99px;padding:16px 48px;font-size:18px;font-weight:800;color:#fff;background:linear-gradient(135deg,#0a84ff,#af52de);box-shadow:0 12px 30px rgba(160,53,191,.42);cursor:pointer;transition:transform .15s}'
        + '#cxConn .cc-go:active{transform:scale(.93)}#cxConn .cc-no{border:none;background:none;color:rgba(255,255,255,.6);font-size:14px;font-weight:600;cursor:pointer;padding:10px}'
        + '#cxConn .cc-reject{font-size:21px;font-weight:800;line-height:1.5;max-width:82%}#cxConn .cc-sub{font-size:14px;opacity:.6}';
      (D.head || D.documentElement).appendChild(st);
    }
    function avaInto(el, prof) { var i = String(prof.i || '🙂'); if (i.indexOf('img:') === 0) { var im = ce('img'); im.src = i.slice(4); el.appendChild(im); } else { el.textContent = i || '🙂'; try { el.style.background = /^#[0-9a-f]{6}$/i.test(prof.c) ? prof.c : 'rgba(255,255,255,.14)'; } catch (e) {} } }
    function fadeIn(ov) { requestAnimationFrame(function () { ov.classList.add('in'); }); setTimeout(function () { ov.classList.add('in'); }, 60); }
    function stripURL() { try { history.replaceState(null, '', location.origin + location.pathname); } catch (e) {} }
    function showConnect(uid, prof) {
      if (D.getElementById('cxConn')) return;
      var ov = ce('div'); ov.id = 'cxConn';
      var ava = ce('div', 'cc-ava'); avaInto(ava, prof);
      var nm = ce('div', 'cc-nm'); nm.textContent = prof.n || '新しい友達';
      var id = ce('div', 'cc-id'); id.textContent = prof.h ? ('@' + String(prof.h).replace(/^@/, '')) : '';
      var go = ce('button', 'cc-go'); go.textContent = 'つながる';
      var no = ce('button', 'cc-no'); no.textContent = (HAS_MOTION && IS_IOS) ? '振って拒否する' : '拒否する';
      ov.append(ava, nm, id, go, no); D.body.appendChild(ov); fadeIn(ov);
      var closed = false, motionH = null, forceH = null, lpT = null;
      function cleanup() { try { window.removeEventListener('devicemotion', motionH); } catch (e) {} try { ov.removeEventListener('webkitmouseforcewillbegin', forceH); } catch (e) {} clearTimeout(lpT); }
      function close(addIt) { if (closed) return; closed = true; cleanup(); if (addIt) { try { if (window.addFriend) window.addFriend(uid); } catch (e) {} } ov.classList.add('out'); setTimeout(function () { try { ov.remove(); } catch (e) {} }, 480); stripURL(); }
      hapTap(go, function () { close(true); });
      hapTap(no, function () { enterReject(); });
      function enterReject() {
        cleanup(); ov.innerHTML = '';
        var rj = ce('div', 'cc-reject'), sub = ce('div', 'cc-sub'); sub.textContent = 'タップでやっぱ追加';
        if (HAS_MOTION && IS_IOS) { rj.textContent = 'iPhoneをふって拒否 😈'; armShake(); }
        else if (IS_MAC) { rj.textContent = 'トラックパッドを押し込んで拒否'; armForce(); }
        else { rj.textContent = '長押しで拒否'; armLong(); }
        ov.append(rj, sub);
        ov.addEventListener('click', function () { close(true); });   // タップ=やっぱ追加
      }
      function armShake() {
        function start() { var lx = 0, ly = 0, lz = 0, t0 = 0; motionH = function (e) { var a = e.accelerationIncludingGravity || e.acceleration; if (!a) return; var d = Math.abs((a.x || 0) - lx) + Math.abs((a.y || 0) - ly) + Math.abs((a.z || 0) - lz); lx = a.x || 0; ly = a.y || 0; lz = a.z || 0; if (d > 28) { var n = +new Date(); if (n - t0 > 500) { t0 = n; close(false); } } }; window.addEventListener('devicemotion', motionH); }
        try { if (DeviceMotionEvent && DeviceMotionEvent.requestPermission) DeviceMotionEvent.requestPermission().then(function (s) { if (s === 'granted') start(); else armLong(); }).catch(armLong); else start(); } catch (e) { armLong(); }
      }
      function armForce() { forceH = function () { close(false); }; try { ov.addEventListener('webkitmouseforcewillbegin', forceH); ov.addEventListener('webkitmouseforcedown', forceH); } catch (e) { armLong(); } }
      function armLong() { ov.addEventListener('pointerdown', function () { clearTimeout(lpT); lpT = setTimeout(function () { close(false); }, 600); }); ov.addEventListener('pointerup', function () { clearTimeout(lpT); }); ov.addEventListener('pointercancel', function () { clearTimeout(lpT); }); }
    }
    function showUnreg(uid, prof) {
      if (D.getElementById('cxConn')) return;
      var ov = ce('div'); ov.id = 'cxConn';
      var ava = ce('div', 'cc-ava'); avaInto(ava, prof);
      var nm = ce('div', 'cc-nm'); nm.textContent = prof.n || '友達';
      var id = ce('div', 'cc-id'); id.textContent = prof.h ? ('@' + String(prof.h).replace(/^@/, '')) : '';
      var go = ce('button', 'cc-go'); go.textContent = '垢つくって繋がる';
      var sub = ce('div', 'cc-sub'); sub.textContent = '登録済みなら "検索" に "' + (prof.h || '') + '" を貼ってね';
      ov.append(ava, nm, id, go, sub); D.body.appendChild(ov); fadeIn(ov);
      hapTap(go, function () { ov.classList.add('out'); setTimeout(function () { try { ov.remove(); } catch (e) {} }, 460); stripURL(); });   // 裏の登録画面へ。pending保存済→登録後に自動連携
    }
    function resolveShow(uid, unreg) { whenAuth(function () { var d = fdb(); if (!d) return; d.ref('users/' + uid).once('value').then(function (s) { var p = s.val(); if (!p) { if (!unreg) toast('見つかりませんでした', 'error'); stripURL(); return; } if (unreg) showUnreg(uid, p); else showConnect(uid, p); }).catch(function () { stripURL(); }); }); }
    function parseTarget() { try { var c = new URLSearchParams(location.search).get('c'); if (!c) { var m = (location.hash || '').match(/[#&]c=([^&]+)/); if (m) c = decodeURIComponent(m[1]); } return c ? c.replace(/[^A-Za-z0-9_-]/g, '') : null; } catch (e) { return null; } }
    // 1) 連携URLで開いた
    var uid = parseTarget();
    if (uid) {
      if (uid === myUid()) stripURL();
      else if (friendsMap()[uid]) { stripURL(); try { if (window.__chatOpen) window.__chatOpen(uid); } catch (e) {} }
      else if (!isReg()) { try { localStorage.setItem('cx_pendingConnect', uid); } catch (e) {} resolveShow(uid, true); }
      else resolveShow(uid, false);
    }
    // 2) 登録完了後に保留中の連携を自動実行
    try {
      var pend = localStorage.getItem('cx_pendingConnect');
      if (pend) {
        var act = function () { var u; try { u = localStorage.getItem('cx_pendingConnect'); localStorage.removeItem('cx_pendingConnect'); } catch (e) {} if (u && u !== myUid() && !friendsMap()[u]) resolveShow(u, false); };
        if (isReg() && myUid()) act();
        else { var n = 0, iv = setInterval(function () { n++; if (isReg() && myUid()) { clearInterval(iv); act(); } else if (n > 180) clearInterval(iv); }, 1000); }
      }
    } catch (e) {}
    // 3) 自分の連携リンクをコピー（add画面）
    try {
      var host = D.querySelector('#scrAdd .add-me');
      if (host && !D.getElementById('cxCopyLink')) {
        var b = ce('button', 'cx-copylink'); b.id = 'cxCopyLink'; b.type = 'button'; b.textContent = '🔗 連携リンクをコピー';
        b.style.cssText = 'margin:12px auto 0;display:block;border:none;border-radius:99px;padding:11px 22px;font-size:14px;font-weight:700;color:#0a84ff;background:rgba(10,132,255,.12);cursor:pointer';
        hapTap(b, function () { var u = myUid(); if (!u) { toast('オンラインで開いてね', 'error'); return; } var url = location.origin + location.pathname + '?c=' + u; try { if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { toast('連携リンクをコピー'); }, function () { toast(url); }); else toast(url); } catch (e) { toast(url); } });
        host.appendChild(b);
      }
    } catch (e) {}
  }

  ready(function () {
    try { setupConnectLink(); } catch (e) { try { console.error('connectlink', e); } catch (_) {} }
    try { setupComposer(); } catch (e) { try { console.error('composer', e); } catch (_) {} }
    try { setupCssEditor(); } catch (e) { try { console.error('cssEditor', e); } catch (_) {} }
    try { setupMisc(); } catch (e) {}
    try { setupProfileSong(); } catch (e) {}
    try { setupFriendSong(); } catch (e) {}
  });

  /* ============================ 0) 登録ゲート解除（index専用） ============================
   * app.js: needsPWA() = isIOS() && !isStandalone() が true（iOS Safariのタブ等）だと
   *   buildReg() が「はじめる(#regGo)」ごとフォームを .hidden で隠し、registerMe() も即 return。
   *   → iPhone のブラウザで「始める」が押せない。index版はPWA強制を外して常に登録可能にする。
   * 方針: needsPWA/isStandalone は const で上書き不可 → app.js は一切触らず、
   *   グローバルの window.buildReg をラップして毎回フォームを再表示＋自前登録に差し替える。
   * 注意: iOSのWeb Push/通知は「ホーム画面に追加(PWA)」した時だけ実体が効く（タブでは登録は出来るが通知は不可）。 */
  (function unlockRegisterGate() {
    if (typeof window.buildReg !== 'function') return;
    var orig = window.buildReg;
    window.buildReg = function () {
      var r;
      try { r = orig.apply(this, arguments); } catch (e) { try { console.error('buildReg', e); } catch (_) {} }
      try { indexUnlockRegister(); } catch (e) {}
      return r;
    };
  })();

  function indexUnlockRegister() {
    // PWA強制ゲートで「はじめる」が隠れる/弾かれるのは iOS(非standalone) のときだけ。
    // Mac/Android/PC/standalone では元の registerMe が正常動作するので一切介入しない（元フロー温存＝index固有のクラッシュ回避）。
    var gateBlocks = false;
    try { gateBlocks = (typeof needsPWA === 'function') ? !!needsPWA() : false; } catch (e) { gateBlocks = false; }
    if (!gateBlocks) return;
    ['#regAva', '#regName', '#regSw', '#regGo', '#regHandoff', '#regLead'].forEach(function (s) { var n = $(s); if (n) n.classList.remove('hidden'); });
    var a2h = $('#regA2H'); if (a2h) a2h.classList.add('hidden');   // 「ホーム画面に追加」案内は隠してフォームを出す
    var go = $('#regGo'), name = $('#regName'); if (!go || !name) return;
    go.disabled = !name.value.trim();
    if (!name.__idxBound) { name.__idxBound = 1; name.addEventListener('input', function () { go.disabled = !name.value.trim(); }); }
    go.onclick = function () { var nm = (name.value || '').trim().slice(0, 20); if (!nm) { go.disabled = true; vib(8); return; } vib(12); indexRegister(nm); };   // ← needsPWA を通さない自前ハンドラ
  }

  // registerMe(app.js) 相当を needsPWA ガード抜きで再実装。成功後に S2S 導入ダイアログを出す（「始める→ダイアログ」）。
  async function indexRegister(nm) {
    try {
      var wantFounder = /@founder\s*$/i.test(nm) || (typeof founderLink === 'function' && founderLink());
      nm = nm.replace(/@founder\s*$/i, '').trim(); if (!nm) return;
      try { loaderShow(); } catch (e) {}
      try {
        var ok = await ensureAuth();
        if (!ok) { try { setNet(true); } catch (e) {} if (typeof fbConfigured === 'function' && fbConfigured()) toast('オンラインで開いて登録してね', 'error'); return; }
        var tag = '', h = '', claimed = false;
        for (var i = 0; i < 6; i++) {
          tag = tag4(); h = handleKey(nm + tag);
          try { var res = await db.ref('handles/' + h).transaction(function (cur) { return cur === null ? uid : undefined; }); if (res.committed) { claimed = true; break; } } catch (e) {}
        }
        if (!claimed) { toast('登録に失敗しました', 'error'); return; }
        me = { name: nm, icon: regIcon, color: regColor, tag: tag, handle: h };
        save(K.me, me);
        db.ref('users/' + uid).set({ n: nm, i: me.icon, c: me.color, g: tag, h: h });
        if (wantFounder && typeof connectFounder === 'function') connectFounder();
        applyMe(); watchAll(); enterHome();
        setTimeout(function () { try { if (window.__s2s && window.__s2s.onboard) window.__s2s.onboard(); } catch (e) {} }, 300);   // 始める→S2S導入ダイアログ
      } finally { try { loaderHide(); } catch (e) {} }
    } catch (e) {
      try { console.error('indexRegister', e); } catch (_) {}
      try { if (!me && typeof registerMe === 'function') registerMe(nm); } catch (_) {}   // フォールバック（未登録時のみ・非iOS等で有効）
    }
  }

  /* ============================ 0b) 検索のアプリ一覧(ランチャー)を index で復活 ============================
   * 共有 spotTpl(meettomeet由来) は `.apps{display:none !important}` で apps ボールを隠している(commit 524ebe2)。
   * ランチャーのJS(openApps/AppsGrid)とアプリ定義は生きているので、検索の Shadow Root(__SPOTROOT)へ
   * index専用の上書きスタイルを1回注入して apps ボールを表示する。meettomeet は触らない＝非表示のまま(差別化維持)。 */
  (function showAppsLauncher() {
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      var root = window.__SPOTROOT;
      if (root) {
        try {
          if (!root.querySelector('#idxAppsFix')) {
            var st = D.createElement('style'); st.id = 'idxAppsFix';
            // apps ボールを表示＋確実に見える/押せるように(共有CSSの !important を後勝ちで上書き)
            st.textContent = '.sp-ball.apps{ display:grid !important; } .apps{ display:grid !important; }'
              + '.sp-balls .sp-ball.apps{ transform:scale(1) !important; opacity:1 !important; pointer-events:auto !important; }';
            root.appendChild(st);
          }
        } catch (e) {}
        clearInterval(iv);
      }
      if (tries > 240) clearInterval(iv);   // 検索が一度も読まれない場合は ~120s で諦め
    }, 500);
  })();

  function setupMisc() {
    // アクティビティ: 背景(何もない所)タップでも閉じる（✕ボタンに加えて）
    D.addEventListener('click', function (e) { var t = e.target; if (t && t.classList && t.classList.contains('act-ov')) t.classList.remove('show'); });
  }

  /* ===== プロフィールの「お気に入りの曲」（無料・APIキー不要・URL貼り付け→埋め込み） ===== */
  function songEmbed(url) {
    url = (url || '').trim(); if (!url) return null;
    try {
      var u = new URL(url), h = u.hostname.replace(/^www\./, '');
      if (h === 'open.spotify.com') return { svc: 'spotify', name: 'Spotify', src: 'https://open.spotify.com/embed' + u.pathname + (u.search || ''), h: 152 };
      if (h === 'soundcloud.com') return { svc: 'soundcloud', name: 'SoundCloud', src: 'https://w.soundcloud.com/player/?url=' + encodeURIComponent(url) + '&color=%23ff5500&auto_play=false&show_comments=false', h: 166 };
      if (h === 'music.apple.com') return { svc: 'apple', name: 'Apple Music', src: 'https://embed.music.apple.com' + u.pathname + (u.search || ''), h: 175 };
      if (h === 'music.youtube.com' || h === 'youtube.com') { var id = u.searchParams.get('v'); if (id) return { svc: 'youtube', name: 'YouTube', src: 'https://www.youtube.com/embed/' + id, h: 152 }; }
      if (h === 'youtu.be') { var id2 = u.pathname.slice(1); if (id2) return { svc: 'youtube', name: 'YouTube', src: 'https://www.youtube.com/embed/' + id2, h: 152 }; }
    } catch (e) {}
    return null;
  }
  function songSave(url) {
    try { localStorage.setItem('cx_profsong', url || ''); } catch (e) {}
    try { var cu = firebase.auth().currentUser; if (cu && firebase.database) firebase.database().ref('users/' + cu.uid + '/song').set(url || null); } catch (e) {}   // アカウントに保存(self-write許可済・軽量ref)
  }
  function songLoad() { try { return localStorage.getItem('cx_profsong') || ''; } catch (e) { return ''; } }
  function setupProfileSong() {
    var body = $('#profSheet .prof-body'); if (!body || $('#profSong')) return;
    var sec = ce('div', 'prof-song'); sec.id = 'profSong';
    var pill = $('#profPill', body) || $('.profile-pill', body);
    if (pill && pill.nextSibling) body.insertBefore(sec, pill.nextSibling); else body.appendChild(sec);
    render();
    // 別端末/再インストール時: localが空ならアカウントから1回だけ復元（軽量・guard）
    if (!songLoad()) { try { var cu = firebase.auth().currentUser; if (cu && firebase.database) firebase.database().ref('users/' + cu.uid + '/song').once('value').then(function (s) { var v = s.val(); if (v) { try { localStorage.setItem('cx_profsong', v); } catch (e) {} render(); } }).catch(function () {}); } catch (e) {} }

    function render() {
      var url = songLoad(); sec.textContent = '';
      var ttl = ce('div', 'psong-ttl'); ttl.textContent = '🎵 お気に入りの曲'; sec.appendChild(ttl);
      if (url) {
        var em = songEmbed(url);
        var card = ce('div', 'psong-card ' + (em ? 'svc-' + em.svc : ''));
        var chip = ce('div', 'psong-chip'); chip.textContent = em ? em.name : '🎵';
        var lbl = ce('div', 'psong-url'); lbl.textContent = url.replace(/^https?:\/\//, '');
        var play = ce('button', 'psong-play'); play.type = 'button'; play.textContent = '▶';
        var rm = ce('button', 'psong-x'); rm.type = 'button'; rm.textContent = '✕';
        var head = ce('div', 'psong-head'); head.appendChild(chip); head.appendChild(lbl); head.appendChild(play); head.appendChild(rm);
        var slot = ce('div', 'psong-slot'); card.appendChild(head); card.appendChild(slot);
        play.onclick = function () {   // 遅延埋め込み（タップで初めてiframe＝軽量）。CSP未許可/未対応URLは外部で開く
          if (slot.firstChild) { slot.textContent = ''; play.textContent = '▶'; return; }
          if (em) { var fr = ce('iframe', 'psong-frame'); fr.src = em.src; fr.style.height = em.h + 'px'; fr.setAttribute('allow', 'autoplay; encrypted-media; clipboard-write'); fr.setAttribute('loading', 'lazy'); fr.frameBorder = '0'; slot.appendChild(fr); play.textContent = '⏸'; }
          else window.open(url, '_blank');
          vib(8);
        };
        rm.onclick = function () { songSave(''); render(); vib(8); };
        sec.appendChild(card);
      } else {
        var add = ce('button', 'psong-add'); add.type = 'button'; add.textContent = '＋ 好きな曲を貼る'; add.onclick = openInput; sec.appendChild(add);
      }
    }
    function openInput() {
      sec.textContent = '';
      var ttl = ce('div', 'psong-ttl'); ttl.textContent = '🎵 お気に入りの曲';
      var row = ce('div', 'psong-input-row');
      var inp = ce('input', 'psong-input'); inp.type = 'url'; inp.placeholder = 'Spotify / Apple Music / SoundCloud のURL'; inp.autocapitalize = 'off'; inp.spellcheck = false;
      var ok = ce('button', 'psong-ok'); ok.type = 'button'; ok.textContent = '保存';
      ok.onclick = function () { var v = (inp.value || '').trim(); if (!v) return; if (!/^https?:\/\//.test(v)) { toast('URLを貼ってね', 'error'); return; } songSave(v); vib(10); render(); };
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') ok.onclick(); });
      row.appendChild(inp); row.appendChild(ok); sec.appendChild(ttl); sec.appendChild(row);
      setTimeout(function () { try { inp.focus(); } catch (e) {} }, 60);
    }
  }

  /* ===== 友達のプロフィール: 相手の🎵を見る（チャットヘッダーのアバター/名前タップ） ===== */
  function setupFriendSong() {
    var av = $('#chAva'), nm = $('#chName');
    var open = function () {
      var leave = $('#chLeave'); if (leave && leave.classList.contains('show')) return;       // グループはスキップ
      var name = ((nm && nm.textContent) || '').trim(); if (!name || name === '—' || name.indexOf(' ⇄ ') >= 0) return;   // 中継表示も除外
      var friends = {}; try { friends = JSON.parse(localStorage.getItem('cx_friends') || '{}'); } catch (e) {}
      var uid = null, info = null;
      for (var k in friends) { if (friends[k] && friends[k].name === name) { uid = k; info = friends[k]; break; } }   // 名前→uid
      showFriendCard(name, info, uid);
    };
    if (av) { av.style.cursor = 'pointer'; av.addEventListener('click', open); }
    if (nm) { nm.style.cursor = 'pointer'; nm.addEventListener('click', open); }
  }
  function fcardIcon(node, info) {
    var icon = (info && info.icon) || '🙂', color = (info && info.color) || '#0a84ff';
    node.style.background = color;
    if (/^img:/.test(icon)) { var im = ce('img'); im.src = icon.slice(4); im.alt = ''; im.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%'; node.appendChild(im); }
    else node.textContent = icon;
  }
  function showFriendCard(name, info, uid) {
    var ov = $('#friendCard');
    if (!ov) { ov = ce('div', 'fcard-ov'); ov.id = 'friendCard'; ov.addEventListener('click', function (e) { if (e.target === ov) ov.classList.remove('show'); }); (D.getElementById('app') || D.body).appendChild(ov); }
    ov.textContent = '';
    var card = ce('div', 'fcard');
    var ava = ce('div', 'fcard-ava'); fcardIcon(ava, info);
    var nm2 = ce('div', 'fcard-name'); nm2.textContent = name;
    var song = ce('div', 'fcard-song'); song.textContent = '🎵 …';
    card.appendChild(ava); card.appendChild(nm2); card.appendChild(song);
    ov.appendChild(card); requestAnimationFrame(function () { ov.classList.add('show'); });
    if (uid) { try { firebase.database().ref('users/' + uid + '/song').once('value').then(function (s) { renderFriendSong(song, s.val()); }).catch(function () { renderFriendSong(song, null); }); } catch (e) { renderFriendSong(song, null); } }
    else renderFriendSong(song, null);
  }
  function renderFriendSong(slot, url) {
    slot.textContent = '';
    if (!url) { slot.className = 'fcard-song empty'; slot.textContent = '🎵 お気に入りの曲は未設定'; return; }
    slot.className = 'fcard-song';
    var em = songEmbed(url);
    var card = ce('div', 'psong-card ' + (em ? 'svc-' + em.svc : ''));
    var chip = ce('div', 'psong-chip'); chip.textContent = em ? em.name : '🎵';
    var lbl = ce('div', 'psong-url'); lbl.textContent = url.replace(/^https?:\/\//, '');
    var play = ce('button', 'psong-play'); play.type = 'button'; play.textContent = '▶';
    var head = ce('div', 'psong-head'); head.appendChild(chip); head.appendChild(lbl); head.appendChild(play);
    var s = ce('div', 'psong-slot'); card.appendChild(head); card.appendChild(s);
    play.onclick = function () { if (s.firstChild) { s.textContent = ''; play.textContent = '▶'; return; } if (em) { var fr = ce('iframe', 'psong-frame'); fr.src = em.src; fr.style.height = em.h + 'px'; fr.setAttribute('allow', 'autoplay; encrypted-media'); fr.setAttribute('loading', 'lazy'); fr.frameBorder = '0'; s.appendChild(fr); play.textContent = '⏸'; } else window.open(url, '_blank'); vib(8); };
    slot.appendChild(card);
  }

  /* ============================ 1) 入力バー刷新 ============================ */
  function setupComposer() {
    var bar = $('.input-bar');
    if (!bar || bar.classList.contains('composer')) return;
    var ta = $('#ta', bar), send = $('#sendBtn', bar);
    bar.classList.add('composer', 'collapsed');
    var fileIn = $('#fileIn');
    var mini = ce('button', 'ib-mini'); mini.id = 'ibMini'; mini.type = 'button'; mini.textContent = '‹'; mini.setAttribute('aria-label', '戻す');
    var cluster = ce('div', 'ib-cluster');
    var attach = ce('button', 'ib-ic'); attach.id = 'attachBtn'; attach.type = 'button'; attach.textContent = '📎'; attach.title = 'ファイルを添付';
    var shake = ce('button', 'ib-ic'); shake.id = 'shakeBtn'; shake.type = 'button'; shake.textContent = '🫨'; shake.title = 'シェイクして撮影';
    cluster.appendChild(attach); cluster.appendChild(shake);
    var aa = ce('button', 'ib-aa'); aa.id = 'aaMorph'; aa.type = 'button'; aa.textContent = 'Aa'; aa.title = '文字入力';
    bar.insertBefore(mini, bar.firstChild);
    bar.insertBefore(cluster, mini.nextSibling);
    if (send) bar.insertBefore(aa, send); else bar.appendChild(aa);
    attach.onclick = function () { vib(10); if (fileIn) fileIn.click(); };
    if (fileIn) fileIn.onchange = function () { if (fileIn.files && fileIn.files.length && window.sendImages) { window.sendImages(fileIn.files); fileIn.value = ''; } };
    shake.onclick = function () { vib(12); openShakeCam(); };
    function expand() { bar.classList.remove('collapsed'); bar.classList.add('expanded'); if (ta) { try { ta.focus(); } catch (e) {} } }
    function collapse() { bar.classList.remove('expanded'); bar.classList.add('collapsed'); if (ta) { try { ta.blur(); } catch (e) {} } }
    aa.onclick = function () { vib(10); expand(); };
    mini.onclick = function () { vib(10); collapse(); };
    var sx = 0, sy = 0, sw = false;
    bar.addEventListener('touchstart', function (e) { if (!bar.classList.contains('expanded')) return; var t = e.touches[0]; sx = t.clientX; sy = t.clientY; sw = true; }, { passive: true });
    bar.addEventListener('touchmove', function (e) { if (!sw) return; var t = e.touches[0]; if (t.clientX - sx > 46 && Math.abs(t.clientY - sy) < 42) { sw = false; collapse(); } }, { passive: true });
    bar.addEventListener('touchend', function () { sw = false; });
  }

  /* ============================ 2) シェイクカメラ（共通・リッチ） ============================ */
  var cam = { stream: null, motion: null, cooling: false, denied: false, busy: false, mode: 'normal', facing: 'environment',
    timer: 0, multiShot: false, devName: '', onCapture: null, f: { bright: 1, sat: 1, smooth: 0, shakeFx: false } };

  function openShakeCam(opts) {
    opts = opts || {};
    cam.onCapture = opts.onCapture || null;          // 指定時はそこへ(配列)。未指定=チャットへ送信
    cam.multiShot = !!opts.multiShot;                // iPhone/iPad/iPod=前面/背面ベストショット
    cam.devName = opts.devName || '';
    cam.mode = 'normal'; cam.timer = 0; cam.facing = 'environment';
    cam.f = { bright: 1, sat: 1, smooth: 0, shakeFx: false };
    var ov = $('#shakeCam') || buildShakeCam();
    syncUI(ov); applyFilters(ov);
    ov.classList.add('show');
    startCam(ov); requestMotion(ov);
  }
  function closeShakeCam() { var ov = $('#shakeCam'); if (!ov) return; ov.classList.remove('show'); stopCam(); var p = $('#camPick'); if (p) p.classList.remove('show'); }

  function buildShakeCam() {
    var ov = ce('div', 'cam-ov'); ov.id = 'shakeCam';
    var stage = ce('div', 'cam-stage');
    var video = ce('video', 'cam-video'); video.id = 'camVideo'; video.setAttribute('playsinline', ''); video.muted = true; video.autoplay = true;
    var grain = ce('div', 'cam-grain');
    var shutter = ce('div', 'cam-shutter'); shutter.id = 'camShutter';
    stage.appendChild(video); stage.appendChild(grain); stage.appendChild(shutter);
    var close = ce('button', 'cam-close'); close.type = 'button'; close.textContent = '✕'; close.onclick = function () { vib(8); closeShakeCam(); };
    var hint = ce('div', 'cam-hint'); hint.id = 'camHint'; hint.textContent = '📱 振って撮影';
    var count = ce('div', 'cam-count'); count.id = 'camCount';

    // 下部コントロール: [タイマー左] [普通/📸 中央] [明るさ右]
    var timer = ce('button', 'cam-side'); timer.id = 'camTimer'; timer.type = 'button';
    var tImg = ce('img'); tImg.src = 'disabele-clock.png'; tImg.alt = 'タイマー'; timer.appendChild(tImg);
    var tBadge = ce('span', 'cam-side-badge'); tBadge.id = 'camTimerBadge'; timer.appendChild(tBadge);
    timer.onclick = function () { cam.timer = cam.timer === 0 ? 3 : cam.timer === 3 ? 7 : 0; vib(8); var b = $('#camTimerBadge'); b.textContent = cam.timer ? cam.timer : ''; b.classList.toggle('on', !!cam.timer); b.classList.remove('pop'); void b.offsetWidth; if (cam.timer) b.classList.add('pop'); };

    var modes = ce('div', 'cam-modes'); modes.id = 'camModes';
    var mNorm = ce('button', 'cam-mode on'); mNorm.id = 'camNorm'; mNorm.type = 'button'; mNorm.title = '普通画質';
    var nImg = ce('img'); nImg.src = 'iphoness.png'; nImg.alt = '普通'; mNorm.appendChild(nImg);
    var mDigi = ce('button', 'cam-mode'); mDigi.id = 'camDigi'; mDigi.type = 'button'; mDigi.title = 'デジカメ画質'; mDigi.textContent = '📸';
    modes.appendChild(mNorm); modes.appendChild(mDigi);
    mNorm.onclick = function () { if (cam.denied) return denyShake(); setMode(ov, 'normal'); };
    mDigi.onclick = function () { if (cam.denied) return denyShake(); setMode(ov, 'digi'); };

    var bright = ce('button', 'cam-side'); bright.id = 'camBright'; bright.type = 'button';
    var bImg = ce('img'); bImg.src = 'bright.png'; bImg.alt = '明るさ'; bright.appendChild(bImg);
    bright.onclick = function () { var p = $('#camFilters', ov); p.classList.toggle('show'); vib(8); };

    var bottom = ce('div', 'cam-bottom'); bottom.appendChild(timer); bottom.appendChild(modes); bottom.appendChild(bright);

    // フィルタパネル（明るさ/彩度/なめらか/シェイクフィルタ）
    var fp = ce('div', 'cam-filters'); fp.id = 'camFilters';
    fp.appendChild(slider('明るさ', 'bright', 0.6, 1.6, 0.02, ov));
    fp.appendChild(slider('彩度', 'sat', 0.4, 1.8, 0.02, ov));
    fp.appendChild(slider('なめらか', 'smooth', 0, 1, 0.02, ov));
    var fx = ce('label', 'cam-fx'); fx.id = 'camFxRow';
    var fxck = ce('input'); fxck.type = 'checkbox'; fxck.id = 'camFx';
    fxck.onchange = function () { cam.f.shakeFx = fxck.checked; applyFilters(ov); vib(8); };
    var fxtx = ce('span'); fxtx.textContent = 'シェイクフィルタ（デジカメ）';
    fx.appendChild(fxck); fx.appendChild(fxtx); fp.appendChild(fx);

    // 代替シャッター: ダブルタップ(Vision Pro / シェイク権限OFF) + Force Touch ~1.7(Mac)
    var lt = 0;
    stage.addEventListener('click', function () { var now = Date.now(); if (now - lt < 320) { lt = 0; triggerCapture(ov); } else lt = now; });
    stage.addEventListener('mousedown', function (e) { if (typeof e.webkitForce === 'number' && e.webkitForce >= 1.7) triggerCapture(ov); });
    try { stage.addEventListener('webkitmouseforcedown', function () { triggerCapture(ov); }); } catch (e) {}

    ov.appendChild(stage); ov.appendChild(close); ov.appendChild(hint); ov.appendChild(count); ov.appendChild(fp); ov.appendChild(bottom);
    (D.getElementById('app') || D.body).appendChild(ov);
    return ov;
  }
  function slider(label, key, min, max, step, ov) {
    var row = ce('div', 'cam-srow'); var lb = ce('span', 'cam-slab'); lb.textContent = label;
    var inp = ce('input'); inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = cam.f[key];
    inp.oninput = function () { cam.f[key] = parseFloat(inp.value); applyFilters(ov); };
    row.appendChild(lb); row.appendChild(inp); return row;
  }
  function setMode(ov, m) {
    cam.mode = m; vib(8);
    $('#camNorm', ov).classList.toggle('on', m === 'normal'); $('#camDigi', ov).classList.toggle('on', m === 'digi');
    var fxRow = $('#camFxRow', ov); if (fxRow) fxRow.style.display = (m === 'digi') ? 'flex' : 'none';   // シェイクフィルタはデジカメのみ
    if (m === 'digi' && !cam.f.shakeFx) { cam.f.shakeFx = true; var c = $('#camFx', ov); if (c) c.checked = true; }   // デジカメ標準ON
    if (m === 'normal') { cam.f.shakeFx = false; var c2 = $('#camFx', ov); if (c2) c2.checked = false; }              // 普通(iphoness)は無し
    applyFilters(ov);
  }
  function syncUI(ov) {
    setMode(ov, cam.mode);
    var b = $('#camTimerBadge', ov); if (b) { b.textContent = cam.timer || ''; b.classList.toggle('on', !!cam.timer); }
    ['bright', 'sat', 'smooth'].forEach(function (k) { var i = ov.querySelector('.cam-srow input[data-k="' + k + '"]'); });
    var fp = $('#camFilters', ov); if (fp) fp.classList.remove('show');
  }
  function applyFilters(ov) {
    ov = ov || $('#shakeCam'); if (!ov) return;
    var v = $('#camVideo', ov); if (!v) return;
    v.style.filter = filterStr();
    v.classList.toggle('digicam', cam.mode === 'digi');
    v.classList.toggle('shakefx', !!cam.f.shakeFx && cam.mode === 'digi');
    ov.classList.toggle('digi', cam.mode === 'digi');
  }
  function filterStr() {
    var b = cam.f.bright, s = cam.f.sat, sm = cam.f.smooth;
    if (cam.mode === 'digi') { b *= 1.04; s *= 1.3; }
    var str = 'brightness(' + b.toFixed(2) + ') saturate(' + s.toFixed(2) + ')' + (cam.mode === 'digi' ? ' contrast(1.16)' : '');
    if (sm > 0.01) str += ' blur(' + (sm * 1.6).toFixed(2) + 'px) brightness(' + (1 + sm * 0.08).toFixed(2) + ')';   // なめらか(美肌)=軽いブラー+明るさ
    return str;
  }

  function startCam(ov) {
    var video = $('#camVideo', ov); if (!video) return;
    if (cam.stream) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('カメラ非対応', 'error'); return closeShakeCam(); }
    var get = function (constraints, fb) {
      navigator.mediaDevices.getUserMedia(constraints).then(function (s) { cam.stream = s; video.srcObject = s; try { video.play(); } catch (e) {} })
        .catch(function () { if (fb) fb(); else { toast('カメラを使えません', 'error'); closeShakeCam(); } });
    };
    get({ video: { facingMode: { ideal: cam.facing } }, audio: false }, function () { get({ video: true, audio: false }, null); });
  }
  function stopCam() {
    if (cam.stream) { try { cam.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} cam.stream = null; }
    if (cam.motion) { try { window.removeEventListener('devicemotion', cam.motion); } catch (e) {} cam.motion = null; }
    var v = $('#camVideo'); if (v) v.srcObject = null;
  }
  function requestMotion(ov) {
    var hint = $('#camHint', ov);
    var attach = function () { cam.denied = false; if (hint) hint.textContent = (cam.devName ? cam.devName : '📱') + ' 振って撮影'; if (cam.motion) return; cam.motion = function (e) { onMotion(e, ov); }; window.addEventListener('devicemotion', cam.motion); };
    try {
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        DeviceMotionEvent.requestPermission().then(function (st) { if (st === 'granted') attach(); else fail(); }).catch(fail);
      } else if (typeof DeviceMotionEvent !== 'undefined') { attach(); }
      else { cam.denied = true; if (hint) hint.textContent = 'ダブルタップで撮影'; }
    } catch (e) { cam.denied = true; }
    function fail() { cam.denied = true; if (hint) hint.textContent = '傾きの許可をオンに（タップで再試行）・またはダブルタップ'; denyShake(); }
    if (hint) hint.onclick = function () { if (cam.denied) requestMotion(ov); };
  }
  function denyShake() { var m = $('#camModes'); if (!m) return; m.classList.remove('denied'); void m.offsetWidth; m.classList.add('denied'); vib([20, 40, 20]); }
  function onMotion(e, ov) {
    if (cam.cooling || cam.busy) return;
    var a = e.accelerationIncludingGravity || e.acceleration; if (!a) return;
    var mag = Math.sqrt((a.x || 0) * (a.x || 0) + (a.y || 0) * (a.y || 0) + (a.z || 0) * (a.z || 0));
    var thr = e.accelerationIncludingGravity ? 24 : 15;
    if (mag > thr) { cam.cooling = true; setTimeout(function () { cam.cooling = false; }, 1300); triggerCapture(ov); }
  }

  function triggerCapture(ov) {
    if (cam.busy) return;
    if (cam.timer > 0) { runCountdown(ov, cam.timer, function () { doCapture(ov); }); }
    else doCapture(ov);
  }
  function runCountdown(ov, n, done) {
    cam.busy = true; var el = $('#camCount', ov);
    (function tick() {
      if (n <= 0) { el.classList.remove('show'); cam.busy = false; done(); return; }
      el.textContent = n; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); vib(15);
      n--; setTimeout(tick, 1000);
    })();
  }
  function frameToFile(video, cb) {
    var w = video.videoWidth, h = video.videoHeight; if (!w) return cb(null);
    var cap = Math.min(1, 888 / Math.max(w, h)); var cw = Math.round(w * cap), chh = Math.round(h * cap);   // 長辺888p・比率保持
    var cv = ce('canvas'); cv.width = cw; cv.height = chh; var cx = cv.getContext('2d');
    try { cx.filter = filterStr(); } catch (e) {}
    cx.drawImage(video, 0, 0, cw, chh);
    try { cx.filter = 'none'; } catch (e) {}
    if (cam.mode === 'digi') {
      try { var g = cx.getImageData(0, 0, cw, chh), d = g.data; for (var i = 0; i < d.length; i += 4) { var nz = (Math.random() - 0.5) * 16; d[i] += nz; d[i + 1] += nz; d[i + 2] += nz; } cx.putImageData(g, 0, 0); } catch (e) {}
      if (cam.f.shakeFx) { try { cx.globalAlpha = 0.5; cx.globalCompositeOperation = 'screen'; cx.drawImage(cv, 3, 0); cx.drawImage(cv, -3, 0); cx.globalAlpha = 1; cx.globalCompositeOperation = 'source-over'; } catch (e) {} }   // RGBズレ風グリッチ
    }
    var sharp = sharpness(cx, cw, chh);
    cv.toBlob(function (blob) { if (!blob) return cb(null); var f; var name = 'shake-' + Date.now() + '-' + Math.round(sharp) + '.jpg'; try { f = new File([blob], name, { type: 'image/jpeg' }); } catch (e) { f = blob; } cb({ file: f, url: URL.createObjectURL(blob), sharp: sharp }); }, 'image/jpeg', cam.mode === 'digi' ? 0.9 : 0.82);
  }
  function sharpness(cx, w, h) {   // ラプラシアン分散でベストショット自動採点
    try { var s = cx.getImageData(0, (h >> 2), w, Math.min(80, h >> 1)).data, sum = 0, sq = 0, n = 0; for (var i = 0; i < s.length - 4; i += 16) { var l = s[i] * .3 + s[i + 1] * .59 + s[i + 2] * .11, l2 = s[i + 4] * .3 + s[i + 5] * .59 + s[i + 6] * .11, dx = l2 - l; sum += dx; sq += dx * dx; n++; } return n ? (sq / n - (sum / n) * (sum / n)) : 0; } catch (e) { return 0; }
  }
  function doCapture(ov) {
    var video = $('#camVideo', ov); if (!video || !video.videoWidth) return;
    cam.busy = true; vib(30);
    var sh = $('#camShutter', ov); if (sh) { sh.classList.remove('flash'); void sh.offsetWidth; sh.classList.add('flash'); }   // 0.2sフラッシュ
    frameToFile(video, function (shot1) {
      if (!shot1) { cam.busy = false; return; }
      if (!cam.multiShot) { cam.busy = false; return finalize(ov, [shot1]); }
      // ベストショット: 背面/前面のもう一方も撮る
      grabOpposite(function (shot2) {
        cam.busy = false;
        if (shot2) finalize(ov, [shot1, shot2]); else finalize(ov, [shot1]);
      });
    });
  }
  function grabOpposite(cb) {
    var other = cam.facing === 'environment' ? 'user' : 'environment';
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: other } }, audio: false }).then(function (s) {
      var v = ce('video'); v.setAttribute('playsinline', ''); v.muted = true; v.srcObject = s;
      v.play().catch(function () {});
      setTimeout(function () { frameToFile(v, function (shot) { try { s.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} cb(shot); }); }, 420);
    }).catch(function () { cb(null); });
  }
  function finalize(ov, shots) {
    shots = shots.filter(Boolean); if (!shots.length) return;
    if (shots.length === 1) return post(ov, shots);
    // ベストショット選択UI（自動でsharp最大を先頭・タップで変更）
    shots.sort(function (a, b) { return b.sharp - a.sharp; });
    showPicker(ov, shots);
  }
  /* ベストショット・レビュー（段階1: バー[グラデ→白]・上スワイプでベスト選択・右スワイプでApple Watch風×削除・撮り直し=haptic.error）。
   * タップ操作もフォールバックで両対応（実機ジェスチャはヘッドレス検証不可のため）。 */
  function hap(name) { try { if (window.haptic && typeof window.haptic[name] === 'function') return window.haptic[name](); } catch (e) {} vib(name === 'error' ? [18, 40, 18] : name === 'confirm' ? [0, 14, 24] : 10); }
  function showPicker(ov, shots) {
    var p = $('#camPick') || (function () { var x = ce('div', 'cam-pick'); x.id = 'camPick'; (D.getElementById('app') || D.body).appendChild(x); return x; })();
    var best = 0;

    function selectBest(i) { if (i === best || i < 0 || i >= shots.length) return; best = i; hap('confirm'); render(); }
    function removeShot(i) {
      hap('error');
      shots.splice(i, 1);
      if (!shots.length) { p.classList.remove('show'); cam.busy = false; return; }   // 全部消したら撮り直しへ戻す
      if (best >= shots.length) best = shots.length - 1; else if (i < best) best--;
      render();
    }
    function closeOthers(except, bar) { [].forEach.call(bar.querySelectorAll('.cam-rev-card'), function (c) { if (c !== except) { c.style.transform = ''; c._open = false; c.parentNode.classList.remove('revealed'); } }); }

    function bindGestures(cell, card, i, bar) {
      var sx = 0, sy = 0, dir = '', tracking = false;
      card.addEventListener('touchstart', function (e) { var t = e.touches[0]; sx = t.clientX; sy = t.clientY; dir = ''; tracking = true; closeOthers(card, bar); }, { passive: true });
      card.addEventListener('touchmove', function (e) {
        if (!tracking) return; var t = e.touches[0], dx = t.clientX - sx, dy = t.clientY - sy;
        if (!dir) { if (Math.abs(dx) < 7 && Math.abs(dy) < 7) return; dir = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v'; }
        if (dir === 'h') { e.preventDefault(); var x = Math.max(0, Math.min(76, card._open ? 76 + dx : dx)); card.style.transform = 'translateX(' + x + 'px)'; cell.classList.toggle('revealed', x > 24); }
        else if (dir === 'v') { e.preventDefault(); var y = Math.max(-46, Math.min(8, dy)); card.style.transform = 'translateY(' + y + 'px)'; }
      }, { passive: false });
      card.addEventListener('touchend', function (e) {
        if (!tracking) return; tracking = false;
        var ch = (e.changedTouches && e.changedTouches[0]) || null, dx = ch ? ch.clientX - sx : 0, dy = ch ? ch.clientY - sy : 0;
        if (dir === 'h') {
          if (dx > 42 || (card._open && dx > -30)) { card._open = true; card.style.transform = 'translateX(76px)'; cell.classList.add('revealed'); }
          else { card._open = false; card.style.transform = ''; cell.classList.remove('revealed'); }
        } else if (dir === 'v' && dy < -34) { card.style.transform = ''; selectBest(i); }
        else if (!dir) { if (card._open) { card._open = false; card.style.transform = ''; cell.classList.remove('revealed'); } else selectBest(i); }   // タップ=ベスト選択（フォールバック）
        else { card.style.transform = card._open ? 'translateX(76px)' : ''; }
      });
    }

    function render() {
      p.innerHTML = '';
      var hero = ce('div', 'cam-rev-hero');
      var hImg = ce('img'); hImg.src = shots[best] ? shots[best].url : ''; hImg.alt = ''; hero.appendChild(hImg);
      var hb = ce('div', 'cam-rev-herobadge'); hb.textContent = 'ベストショット'; hero.appendChild(hb);
      p.appendChild(hero);
      var hint = ce('div', 'cam-rev-hint'); hint.textContent = shots.length > 1 ? '上スワイプでベスト・右スワイプで削除' : '右スワイプで削除して撮り直し'; p.appendChild(hint);

      var bar = ce('div', 'cam-rev-bar');
      shots.forEach(function (s, i) {
        var cell = ce('div', 'cam-rev-cell' + (i === best ? ' best' : ''));
        var x = ce('button', 'cam-rev-x'); x.type = 'button'; x.setAttribute('aria-label', '削除');
        x.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';
        hapTap(x, function () { removeShot(i); });
        var card = ce('div', 'cam-rev-card');
        var im = ce('img'); im.src = s.url; im.alt = ''; card.appendChild(im);
        var tag = ce('span', 'cam-rev-tag'); tag.textContent = 'ベスト'; card.appendChild(tag);
        cell.appendChild(x); cell.appendChild(card);
        bindGestures(cell, card, i, bar);
        bar.appendChild(cell);
      });
      p.appendChild(bar);

      var row = ce('div', 'cam-rev-actions');
      var redo = ce('button', 'cam-rev-redo'); redo.type = 'button'; redo.textContent = '撮り直す';
      hapTap(redo, function () { hap('error'); p.classList.remove('show'); cam.busy = false; });
      var postBtn = ce('button', 'cam-rev-post'); postBtn.type = 'button'; postBtn.textContent = '投稿（' + shots.length + '枚）';
      hapTap(postBtn, function () { var ordered = [shots[best]].concat(shots.filter(function (_, j) { return j !== best; })); p.classList.remove('show'); post(ov, ordered); });
      row.appendChild(redo); row.appendChild(postBtn); p.appendChild(row);
    }

    render();
    p.classList.add('show');
  }
  function post(ov, shots) {
    var files = shots.map(function (s) { return s.file; });
    try {
      if (cam.onCapture) { cam.onCapture(files, shots); closeShakeCam(); return; }
      if (window.canSend && !window.canSend()) { toast('送信できません', 'error'); return; }
      if (window.sendImages) { window.sendImages(files); toast('送信しました'); closeShakeCam(); }
      else toast('送信機能が見つかりません', 'error');
    } catch (e) { toast('送信に失敗', 'error'); }
  }

  /* ============================ 3) CSSエディタに shaketoshake.css ============================ */
  var cssCache = null, cssFetching = false;
  function fetchCss(cb) {
    if (cssCache != null) return cb(cssCache);
    if (cssFetching) return; cssFetching = true;
    fetch('shaketoshake.css', { cache: 'force-cache' }).then(function (r) { return r.text(); }).then(function (t) { cssCache = t; cssFetching = false; cb(t); }).catch(function () { cssFetching = false; });
  }
  function applyUserCss(v) { var st = $('#userCss'); if (st) st.textContent = v; try { if (window.save) window.save('cx_usercss', v); } catch (e) {} }
  function setupCssEditor() {
    var sheet = $('#cssSheet'); if (!sheet) return;
    var seed = function () {
      var ta = $('#cssArea'); if (!ta) return;
      ta.oninput = function () { applyUserCss(ta.value); };
      if (!ta.value || !ta.value.trim()) fetchCss(function (css) { var t = $('#cssArea'); if (t && (!t.value || !t.value.trim())) t.value = css; });
    };
    var mo = new MutationObserver(function () { if (sheet.classList.contains('show')) seed(); });
    mo.observe(sheet, { attributes: true, attributeFilter: ['class'] });
    if (sheet.classList.contains('show')) seed();
  }

  try { window.__indexExtras = { version: 'ix-3', openShakeCam: openShakeCam }; } catch (e) {}
})();
