/* index-s2s.js — "Shake to Shake"（index版だけの新SNS / meettomeet非対応） Phase 1 + 2b
 * P1 : 端末判定(カテゴリ)・ゲート(Safari/通知ON/対応機種)・撮影導入ダイアログ
 * 2b : スケジュール判定(平日3-4回 7-19時 / 休日4-5h 5am〜1am)・撮影→Telegram→ s2s/<uid>(軽量ref)・
 *      横断フィード(自分＋友達の最新1件)・削除/再投稿。Push は worker/s2s-push.js(cron)で別途デプロイ。
 * 軽量: 画像はTelegram、RTDBは file_id 等の ref のみ。読みは home表示時/フィード時のみ・1人1ノード。
 */
(function () {
  'use strict';
  // S2S（Shake to Shake）は index専用。meettomeet.html では非対応＝以降を一切動かさない。
  // （meettomeet と index が同じ script 群を読む統一構成のため、ファイル名で明示ゲート。web/PWA とも start_url で判定可）
  var _isMeet = false; try { _isMeet = /meettomeet/i.test((window.location && location.pathname) || ''); } catch (e) {}
  if (_isMeet) return;
  var D = document;
  function $(s, r) { return (r || D).querySelector(s); }
  function ce(t, c) { var n = D.createElement(t); if (c) n.className = c; return n; }
  function vib(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} }
  function toast(m, t) { try { if (window.toast) window.toast(m, t); } catch (e) {} }
  function ready(fn) { if (D.readyState !== 'loading') setTimeout(fn, 0); else D.addEventListener('DOMContentLoaded', function () { setTimeout(fn, 0); }); }
  function myUid() { try { var c = firebase.auth().currentUser; return c ? c.uid : null; } catch (e) { return null; } }
  function fdb() { try { return firebase.database(); } catch (e) { return null; } }
  function friendsMap() { try { return JSON.parse(localStorage.getItem('cx_friends') || '{}'); } catch (e) { return {}; } }
  function rfu(x) { if (!x) return ''; var s = String(x); if (/^(https?:|data:|blob:)/.test(s)) return s; return window.Store ? window.Store.fileUrl(s) : ''; }   // S6: R2はURL直/Telegramはfile_id→/dl?id=
  function myInfo() { try { return JSON.parse(localStorage.getItem('cx_me') || '{}'); } catch (e) { return {}; } }
  function hapTap(b, f, o) { try { if (window.__hapTap) return window.__hapTap(b, f, o); } catch (e) {} if (b) b.onclick = f; return b; }   // iOS確実触覚（透明スイッチ）。無ければ通常click
  var lastUrl = null, myPost = null, _tick = null;

  var DEV = detect();
  ready(function () { try { initBanner(); startTick(); } catch (e) { try { console.error('s2s', e); } catch (_) {} } });

  /* ---- 端末判定（カテゴリ。正確な機種名/Macインチは取得不可→カテゴリで） ---- */
  function detect() {
    var ua = navigator.userAgent || '', vendor = navigator.vendor || '', mt = navigator.maxTouchPoints || 0;
    var notSafari = /Chrome|CriOS|EdgiOS|FxiOS|Android|Edg\/|OPR\//i.test(ua);
    var isSafari = /Safari/.test(ua) && /Apple/.test(vendor) && !notSafari;
    var w = screen.width || 0, h = screen.height || 0, ratio = Math.max(w, h) / (Math.min(w, h) || 1);
    var isIPhone = /iPhone/.test(ua), isIPod = /iPod/.test(ua);
    var isIPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && mt > 1);
    var isVision = /visionOS|Vision Pro|XR/i.test(ua);
    var isMac = /Macintosh/.test(ua) && mt === 0 && !isVision;
    var cat = 'other', name = '', frame = '', trigger = '', instr = '';
    if (isVision) { cat = 'vision'; name = 'Apple Vision Pro'; frame = 'visionpro.png'; trigger = 'doubletap'; instr = 'ダブルタップで撮影'; }
    else if (isIPad) { cat = 'ipad'; name = 'iPad'; trigger = 'shake'; instr = 'iPadをシェイクしてショット'; frame = matchMedia('(orientation:landscape)').matches ? 'ipad-landscape.png' : 'ipad-tate.png'; }
    else if (isMac) { cat = 'mac'; name = 'Mac'; frame = 'mac.png'; trigger = 'force'; instr = 'Macを押し込んで撮影'; }
    else if (isIPhone || isIPod) { cat = isIPod ? 'ipod' : 'iphone'; name = isIPod ? 'iPod touch' : 'iPhone'; trigger = 'shake'; instr = (isIPod ? 'iPod' : 'iPhone') + 'をシェイクしてショット'; frame = ratio >= 2.05 ? 'iPhone-16.png' : 'ipod.png'; }
    var supported = isSafari && (cat === 'iphone' || cat === 'ipod' || cat === 'ipad' || cat === 'mac' || cat === 'vision');
    return { cat: cat, name: name, frame: frame, trigger: trigger, instr: instr, supported: supported, isSafari: isSafari, multiCam: (cat === 'iphone' || cat === 'ipod' || cat === 'ipad') };
  }
  function gated() {
    if (!DEV.supported) return false;                 // Safari以外/非対応機種は出さない
    try { if (!(typeof Notification !== 'undefined' && Notification.permission === 'granted')) return false; } catch (e) { return false; }   // 通知ONのみ
    if (emptyModeOn()) return false;                  // empty mode のユーザーは使用不可
    return true;
  }
  function emptyModeOn() { try { return localStorage.getItem('cx_emptyself') === '1'; } catch (e) { return false; } }   // app側がempty判定時に立てる想定。無ければfalse

  /* ---- スケジュール（平日3-4回 7-19時 / 休日4-5h 5am〜1am・日付シードで全端末一致） ---- */
  function at(base, h) { var x = new Date(base); var hh = Math.floor(((h % 24) + 24) % 24), mm = Math.floor((h - Math.floor(h)) * 60); x.setHours(hh, mm, 0, 0); if (h >= 24) x.setTime(x.getTime() + Math.floor(h / 24) * 86400000); return x.getTime(); }
  function dayTimes(d) {   // S8: 毎日 3〜5回・04:00〜23:30 にランダム（日付シードで全端末＋サーバー s2s-push.js と一致）
    var seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    function rnd(k) { var x = Math.sin(seed * 97.13 + k * 131.7) * 10000; return x - Math.floor(x); }
    var n = 3 + Math.floor(rnd(0) * 3), t = [], START = 4, END = 23.5;   // 3,4,5回
    for (var i = 0; i < n; i++) { var frac = (i + 0.18 + rnd(i + 1) * 0.64) / n; t.push(at(d, START + (END - START) * frac)); }
    return t.sort(function (a, b) { return a - b; });
  }
  function schedState() {
    var now = Date.now(), d = new Date(), times = dayTimes(d), WIN = 40 * 60000, inWin = false, next = null;
    for (var i = 0; i < times.length; i++) { if (now >= times[i] && now < times[i] + WIN) inWin = true; if (times[i] > now && next === null) next = times[i]; }
    if (next === null) { var tm = new Date(d); tm.setDate(tm.getDate() + 1); var tt = dayTimes(tm); next = tt[0] || null; }
    return { inWin: inWin, next: next };
  }
  function hhmm(ts) { var d = new Date(ts); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function startTick() { if (_tick) return; _tick = setInterval(function () { var hm = $('#scrHome'); if (hm && hm.classList.contains('active') && gated()) initBanner(); }, 60000); }   // 60s毎にウィンドウ状態を反映(0リクエスト)

  /* ---- 一覧トップ note バナー ---- */
  function initBanner() {
    var host = $('.home-top'); if (!host) return;
    var ex = $('#s2sBanner');
    if (!gated()) { if (ex) ex.remove(); return; }
    if (myPost === null) loadMyPost();
    var st = schedState();
    if (ex) ex.remove();
    var b = ce('div', 's2s-banner' + (st.inWin ? ' active' : '')); b.id = 's2sBanner';
    var sub = st.inWin ? '📸 今がシェイクタイム！' : (myPost ? '最後の投稿 ' + ago(myPost.ts) : '次は ' + (st.next ? hhmm(st.next) + '頃' : '—'));
    var thumb = (myPost && myPost.imgs && myPost.imgs[0]) ? '<img class="s2s-thumb" src="' + rfu(myPost.imgs[0]) + '">' : (lastUrl ? '<img class="s2s-thumb" src="' + lastUrl + '">' : '<div class="s2s-thumb empty">🫨</div>');
    b.innerHTML =
      '<div class="s2s-stack">' + thumb +
        '<div class="s2s-ring"><svg viewBox="0 0 46 46"><circle class="bg" cx="23" cy="23" r="20"/><circle class="prog" cx="23" cy="23" r="20"/></svg><span>' + (st.inWin ? '!' : '👀') + '</span></div>' +
      '</div>' +
      '<div class="s2s-meta"><div class="s2s-title">Shake to Shake</div><div class="s2s-sub">' + sub + '</div></div>' +
      '<button class="s2s-go" id="s2sGo" type="button">' + (st.inWin ? '🫨' : '👀') + '</button>';
    host.appendChild(b);
    var act = st.inWin ? start : openFeed;
    b.addEventListener('click', act);
    var go = b.querySelector('#s2sGo'); if (go) hapTap(go);   // 実タップで確実haptic（switchのclickはbへ伝播してact 1回）
  }
  function loadMyPost() {
    var uid = myUid(), db = fdb(); if (!uid || !db) { myPost = false; return; }
    db.ref('s2s/' + uid).once('value').then(function (s) { myPost = s.val() || false; var ex = $('#s2sBanner'); if (ex && gated()) initBanner(); }).catch(function () { myPost = false; });
  }

  /* ---- 撮影フロー（ウィンドウ内のみ＝通知を受けた時だけ投稿可） ---- */
  function start() { vib(12); if (!schedState().inWin) { toast('次のシェイクタイムに投稿できます', 'error'); return; } introDialog(openCamera); }
  function introDialog(after) {
    var ov = ce('div', 's2s-intro'); ov.id = 's2sIntro';
    var inner = ce('div', 's2s-intro-in');
    var frame = ce('div', 's2s-frame s2s-' + DEV.cat);
    if (DEV.frame) { var img = ce('img'); img.src = DEV.frame; img.alt = DEV.name; img.onerror = function () { frame.classList.add('noimg'); }; frame.appendChild(img); } else frame.classList.add('noimg');
    if (DEV.trigger === 'shake') { var emo = ce('img', 's2s-emo'); emo.src = 'shake-shake.png'; emo.alt = ''; frame.appendChild(emo); }
    var tx = ce('div', 's2s-intro-tx'); tx.textContent = DEV.instr || (DEV.name + 'で撮影');
    inner.appendChild(frame); inner.appendChild(tx); ov.appendChild(inner);
    (D.getElementById('app') || D.body).appendChild(ov);
    requestAnimationFrame(function () { ov.classList.add('show'); });
    if (DEV.trigger === 'shake') vib([0, 30, 55, 30, 55, 30]);
    setTimeout(function () { ov.classList.remove('show'); setTimeout(function () { try { ov.remove(); } catch (e) {} if (after) after(); }, 280); }, 500);
  }
  function openCamera() { if (window.__indexExtras && window.__indexExtras.openShakeCam) window.__indexExtras.openShakeCam({ onCapture: onShot, multiShot: DEV.multiCam, devName: DEV.name }); else toast('カメラを準備中…'); }
  function onShot(files, shots) {
    var uid = myUid(), db = fdb();
    if (!uid || !db || !window.Store || !window.Store.ready()) { toast('オンラインで投稿してね', 'error'); return; }
    toast('投稿中…');
    var arr = files || [], imgs = [];
    (function up(i) {
      if (i >= arr.length) {
        if (!imgs.length) { toast('投稿に失敗', 'error'); return; }
        var post = { ts: Date.now(), imgs: imgs, best: 0, n: imgs.length };
        db.ref('s2s/' + uid).set(post).then(function () { myPost = post; try { lastUrl = shots && shots[0] ? shots[0].url : null; } catch (e) {} toast('投稿しました 🫨'); initBanner(); }).catch(function () { toast('投稿に失敗', 'error'); });
        return;
      }
      window.Store.putImage(arr[i]).then(function (u) { imgs.push(u.id); up(i + 1); }).catch(function () { up(i + 1); });   // ベストショット含め全カメラ分をTelegramへ
    })(0);
  }

  /* ---- 横断フィード（自分＋友達の最新1件） ---- */
  function openFeed() {
    vib(8);
    var ov = $('#s2sFeed') || (function () { var x = ce('div', 's2s-feed'); x.id = 's2sFeed'; x.addEventListener('click', function (e) { if (e.target === x) x.classList.remove('show'); }); (D.getElementById('app') || D.body).appendChild(x); return x; })();
    ov.innerHTML = '<div class="s2s-feed-head"><div class="s2s-feed-ttl">Shake to Shake</div><button class="s2s-feed-x" id="s2sFeedX" type="button">✕</button></div><div class="s2s-feed-list" id="s2sFeedList"><div class="s2s-feed-empty">読み込み中…</div></div>';
    hapTap(ov.querySelector('#s2sFeedX'), function () { ov.classList.remove('show'); });
    var list = ov.querySelector('#s2sFeedList');
    requestAnimationFrame(function () { ov.classList.add('show'); });
    var uid = myUid(), db = fdb(); if (!db) { list.innerHTML = '<div class="s2s-feed-empty">オンラインで開いてね</div>'; return; }
    var fr = friendsMap(), ids = [];
    Object.keys(fr).forEach(function (k) { if (k !== uid) ids.push(k); });   // 友達
    if (uid) ids.push(uid);   // 自分の投稿もフィードに出す（中央下の自分＝自分の最新ショット。renderFeedが（自分）表示・再投稿/削除を付与）
    if (!ids.length) { list.innerHTML = '<div class="s2s-feed-empty s2s-feed-none">😪</div>'; return; }   // 未ログイン等でidが皆無の時のみ
    var got = 0, posts = [];
    ids.forEach(function (id) {
      db.ref('s2s/' + id).once('value').then(function (s) { var v = s.val(); if (v && v.imgs && v.imgs.length) posts.push({ uid: id, post: v }); }).catch(function () {}).then(function () { if (++got === ids.length) renderFeed(list, posts, uid, fr); });
    });
  }
  function renderFeed(list, posts, uid, fr) {
    posts.sort(function (a, b) { return (b.post.ts || 0) - (a.post.ts || 0); });
    if (!posts.length) { list.innerHTML = '<div class="s2s-feed-empty s2s-feed-none">😪</div>'; return; }   // 相手の投稿が無い＝😪を上に
    list.textContent = '';
    posts.forEach(function (p) {
      var mine = p.uid === uid, info = mine ? myInfo() : (fr[p.uid] || {});
      var item = ce('div', 's2s-post');
      var head = ce('div', 's2s-post-head');
      var ava = ce('div', 's2s-post-ava'); s2sIcon(ava, info);
      var nm = ce('div', 's2s-post-nm'); nm.textContent = (info.name || (mine ? '自分' : '友達')) + (mine ? '（自分）' : '');
      var tm = ce('div', 's2s-post-tm'); tm.textContent = ago(p.post.ts);
      head.appendChild(ava); head.appendChild(nm); head.appendChild(tm); item.appendChild(head);
      var imgs = (p.post.imgs || []).slice(), best = p.post.best || 0; if (best > 0 && best < imgs.length) imgs.unshift(imgs.splice(best, 1)[0]);   // ベストショットを先頭に
      var wrap = ce('div', 's2s-post-imgs');
      imgs.forEach(function (fid, i) { var im = ce('img', 's2s-post-img' + (i === 0 ? ' best' : '')); im.src = rfu(fid); im.loading = 'lazy'; wrap.appendChild(im); });
      item.appendChild(wrap);
      (function (pp, mn) { wrap.style.cursor = 'pointer'; wrap.addEventListener('click', function () { try { if (window.__viewS2SPost) window.__viewS2SPost(pp, mn); } catch (e) {} }); })(p.post, mine);   // S7: 画像タップ→Vision Photos風ギャラリー(自分の投稿はX削除/pinお気に入り)
      if (mine) {
        var act = ce('div', 's2s-post-act');
        var re = ce('button', 's2s-post-re'); re.textContent = '再投稿'; hapTap(re, function () { var db = fdb(); if (db && uid) db.ref('s2s/' + uid + '/ts').set(Date.now()).then(function () { if (myPost) myPost.ts = Date.now(); toast('再投稿しました'); openFeed(); initBanner(); }); });   // 軽量: ts更新のみ(画像再アップ無し)
        var del = ce('button', 's2s-post-del'); del.textContent = '削除'; hapTap(del, function () { var db = fdb(); if (db && uid) db.ref('s2s/' + uid).remove().then(function () { myPost = false; toast('削除しました'); openFeed(); initBanner(); }); });
        act.appendChild(re); act.appendChild(del); item.appendChild(act);
      }
      list.appendChild(item);
    });
  }
  function s2sIcon(node, info) { var icon = (info && info.icon) || '🙂', color = (info && info.color) || '#0a84ff'; node.style.background = color; if (/^img:/.test(icon)) { var im = ce('img'); im.src = icon.slice(4); im.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%'; node.appendChild(im); } else node.textContent = icon; }
  function ago(ts) { var s = (Date.now() - ts) / 1000; if (s < 60) return 'たった今'; if (s < 3600) return Math.floor(s / 60) + '分前'; if (s < 86400) return Math.floor(s / 3600) + '時間前'; return Math.floor(s / 86400) + '日前'; }

  /* ---- 「始める」直後の S2S 導入ダイアログ（通知ON＝投稿解放 / 👀見たよ / ←作り直し） ----
   * index版のみ（build-index.mjs が index にしか index-s2s.js を入れない＝meettomeet非対応）。
   * 通知ON: 既存 setNotif(true)（許可要求→push購読→settings.notif保存）を再利用。
   *   → granted で gated() が true になり、ホームに Shake to Shake バナーが出て投稿可能に。
   * 👀見たよ: 既存 settings.seen と同期（設定シートの #tgSeen と同じ値）。
   * ←(戻る): deleteAccount() で作り直し（アカウント全消去→登録画面へ）。 */
  function seenOn() { try { return (settings && settings.seen !== false); } catch (e) { return true; } }
  function setSeen(on) { try { if (settings) { settings.seen = on; if (typeof save === 'function' && typeof K !== 'undefined') save(K.set, settings); } var t = $('#tgSeen'); if (t) t.classList.toggle('on', on); } catch (e) {} }
  function iosTab() { try { return /iphone|ipad|ipod/i.test(navigator.userAgent) && !(navigator.standalone || matchMedia('(display-mode: standalone)').matches); } catch (e) { return false; } }

  function onboard() {
    if ($('#s2sOb')) return;
    var ov = ce('div', 's2s-ob'); ov.id = 's2sOb';
    var back = ce('button', 's2s-ob-back'); back.type = 'button'; back.setAttribute('aria-label', 'アカウントを作り直す');
    back.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>';
    var inn = ce('div', 's2s-ob-in');
    var emo = ce('img', 's2s-ob-emo'); emo.src = 'shake-shake.png'; emo.alt = '🫨';
    emo.onerror = function () { var s = ce('div', 's2s-ob-emo txt'); s.textContent = '🫨'; try { emo.replaceWith(s); } catch (e) {} };
    var h = ce('div', 's2s-ob-h'); h.textContent = 'シェアしよう';
    var sub = ce('div', 's2s-ob-sub'); sub.innerHTML = '通知を許可するとシェイクで<br>ショットを共有できるよ';
    var row = ce('div', 's2s-ob-seen');
    var ic = ce('span', 's2s-ob-seen-ic'); ic.textContent = '👀';
    var tx = ce('span', 's2s-ob-seen-tx'); tx.textContent = '入力中と既読';
    var sw = ce('span', 's2s-ob-sw'); sw.appendChild(ce('span', 's2s-ob-knob'));
    var on = seenOn(); if (on) sw.classList.add('on');
    row.appendChild(ic); row.appendChild(tx); row.appendChild(sw);
    row.addEventListener('click', function () { on = !on; sw.classList.toggle('on', on); setSeen(on); vib(8); });
    var notif = ce('button', 's2s-ob-notif'); notif.type = 'button'; notif.textContent = 'タップで通知オンにしてシェア';
    var skip = ce('button', 's2s-ob-skip'); skip.type = 'button'; skip.textContent = '今はしない';
    inn.appendChild(emo); inn.appendChild(h); inn.appendChild(sub); inn.appendChild(row); inn.appendChild(notif); inn.appendChild(skip);
    ov.appendChild(back); ov.appendChild(inn);
    (D.getElementById('app') || D.body).appendChild(ov);
    requestAnimationFrame(function () { ov.classList.add('show'); });
    vib([0, 22, 38, 22]);

    function close() { ov.classList.remove('show'); setTimeout(function () { try { ov.remove(); } catch (e) {} try { initBanner(); } catch (e) {} }, 300); }
    skip.addEventListener('click', function () { vib(8); close(); });
    back.addEventListener('click', function () {
      vib(10); ov.classList.remove('show');
      setTimeout(function () { try { ov.remove(); } catch (e) {} try { if (typeof deleteAccount === 'function') deleteAccount(); else if (typeof show === 'function') show('scrReg'); } catch (e) {} }, 260);
    });
    notif.addEventListener('click', function () {
      vib(10);
      if (typeof Notification === 'undefined') { toast('この端末は通知に対応していません', 'error'); return; }
      var p;
      try { p = (typeof setNotif === 'function') ? setNotif(true) : Notification.requestPermission().then(function (r) { return r === 'granted'; }); }
      catch (e) { p = Promise.resolve(false); }
      Promise.resolve(p).then(function (okv) {
        var granted = okv || (typeof Notification !== 'undefined' && Notification.permission === 'granted');
        if (granted) {
          notif.classList.add('done'); notif.textContent = '通知オン ✓'; vib([0, 18, 26, 34]);
          try { var t = $('#tgNotif'); if (t) t.classList.add('on'); } catch (e) {}
          setTimeout(close, 650);
        } else {
          toast(iosTab() ? 'ホーム画面に追加すると通知が使えます' : '通知をオンにできませんでした', 'error');
        }
      });
    });
  }

  try { window.__s2s = { device: DEV, openFeed: openFeed, schedState: schedState, onboard: onboard }; } catch (e) {}
})();
