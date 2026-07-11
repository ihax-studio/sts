/* ============================================================================
   Native Change — "Let's change the media type" Dynamic Island menu.

   NO own trigger button. It is opened by the EXISTING OmniBar rotate.png button
   (omnibar.js `bRep`) via window.NativeChange.open(), in all 3 studios.

   Shows the OTHER media types (current excluded; no 3D), caption underneath,
   plays question.mp3 on open. Picking a type runs the conversion handoff:
   exportDoc() → sessionStorage 'nc_pending' → navigate to the target studio,
   which on load imports it (importDoc) and plays inteli.mp3 on completion.

   Configure BEFORE this script loads (per studio):
     window.NativeChangeConfig = {
       current: 'app' | 'doc' | 'video',   // this studio's type (hidden in menu)
       exportDoc: function(){ return { title, html, blocks } },   // current → ncDoc
       importDoc: function(ncDoc){ ... },                         // ncDoc → new content here
       onPick: function(target, current){ ... }   // optional override of the whole handoff
     };
   ============================================================================ */
(function () {
  if (window.NativeChange) return;
  var cfg = window.NativeChangeConfig || {};
  var current = cfg.current || 'app';

  var TYPES = {
    doc:   { label: '書類', icon: 'doc-x.png',   url: 'document-studio.html' },
    app:   { label: 'App',  icon: 'hanf-off.png', url: 'index.html' },
    video: { label: '動画', icon: 'icon-512.png', url: 'cinema-studio-final.html' }
  };
  var PENDING = 'nc_pending';

  // ---------- styles ----------
  var st = document.createElement('style');
  st.textContent =
    '.nc-scrim{position:fixed;inset:0;z-index:2147483350;background:transparent;opacity:0;pointer-events:none}' +
    '.nc-scrim.show{pointer-events:auto}' +
    '.nc-island{position:fixed;left:50%;top:max(env(safe-area-inset-top,0px) + 6px, 10px);' +
      'transform:translateX(-50%) scale(.2);transform-origin:top center;z-index:2147483400;' +
      'display:flex;flex-direction:column;align-items:center;gap:7px;' +
      'background:#000;color:#fff;border-radius:36px;padding:16px 30px 13px;' +
      'box-shadow:0 22px 70px rgba(0,0,0,.62),inset 0 0 0 .5px rgba(255,255,255,.10);' +
      'opacity:0;pointer-events:none;will-change:transform,opacity;' +
      'transition:transform .5s cubic-bezier(.2,.9,.2,1.05),opacity .34s ease}' +
    '.nc-island.show{transform:translateX(-50%) scale(1);opacity:1;pointer-events:auto}' +
    '.nc-row{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:18px;max-width:min(86vw,440px)}' +
    '.nc-opt{width:56px;height:56px;border:none;background:none;cursor:pointer;padding:6px;border-radius:16px;-webkit-tap-highlight-color:transparent;transition:transform .25s cubic-bezier(.16,1,.3,1)}' +
    '.nc-opt img{width:100%;height:100%;object-fit:contain;display:block}' +
    '.nc-opt:active{transform:scale(.84)}' +
    '.nc-cap{font:600 13px/1.3 -apple-system,"Hiragino Sans",system-ui;color:rgba(255,255,255,.92);letter-spacing:.2px}';
  document.head.appendChild(st);

  // ---------- DOM ----------
  var scrim = document.createElement('div'); scrim.className = 'nc-scrim';
  var island = document.createElement('div'); island.className = 'nc-island';
  var row = document.createElement('div'); row.className = 'nc-row';
  Object.keys(TYPES).forEach(function (k) {
    if (k === current) return;                      // hide the current type
    var t = TYPES[k];
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'nc-opt'; b.setAttribute('aria-label', t.label); b.dataset.type = k;
    b.innerHTML = '<img src="' + t.icon + '" alt="' + t.label + '">';
    b.addEventListener('click', function (e) { e.stopPropagation(); pick(k); });
    row.appendChild(b);
  });
  // extra SAME-studio options (e.g. document 書類⇄プレゼン orientation) — run an action in place, no navigation
  (cfg.extraOptions || []).forEach(function (opt) {
    if (!opt) return;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'nc-opt'; b.setAttribute('aria-label', opt.label || '');
    b.innerHTML = '<img src="' + (opt.icon || '') + '" alt="' + (opt.label || '') + '">';
    b.addEventListener('click', function (e) {
      e.stopPropagation(); closeMenu();
      try { if (window.haptic && haptic.selection) haptic.selection(); } catch (_) {}
      try { if (typeof opt.action === 'function') opt.action(); } catch (_) {}
    });
    row.appendChild(b);
  });
  var cap = document.createElement('div'); cap.className = 'nc-cap'; cap.textContent = "Let's change the media type";
  island.appendChild(row); island.appendChild(cap);
  function mount() { document.body.appendChild(scrim); document.body.appendChild(island); }

  // ---------- sounds ----------
  function ping(src) { try { var a = new Audio(src); a.play().catch(function () {}); } catch (_) {} }
  function playQuestion() { ping('question.mp3'); }   // change START
  function playInteli() { ping('inteli.mp3'); }       // conversion COMPLETE

  // ---------- F(#36) 変更/確認バー ----------
  // 変換完了後に表示: [⊖取消(delx)] [↩︎戻す(reee)] | [🔗共有(share-x)] | [✓確定(checkxxx)]
  // ✓/上スワイプ → 自由に動かせる Siri アイコン(circle-white.png)に収納。アイコンから
  // 「バーを開く / 変更前を見る(元のスタジオへ — 元の内容は元スタジオに残っている)」。
  var CONFIRM = 'nc_confirm';
  function clearConfirm() { try { sessionStorage.removeItem(CONFIRM); } catch (_) {} }
  function makeDraggable(el, onSwipeUp, onTap) {
    var sx = 0, sy = 0, ox = 0, oy = 0, moved = false, pid = null;
    el.addEventListener('pointerdown', function (e) {
      if (e.target.closest && e.target.closest('button')) return;   // ボタンはドラッグ対象外
      pid = e.pointerId; sx = e.clientX; sy = e.clientY; moved = false;
      var r = el.getBoundingClientRect(); ox = r.left; oy = r.top;
      try { el.setPointerCapture(pid); } catch (_) {}
      e.preventDefault();
    });
    el.addEventListener('pointermove', function (e) {
      if (pid === null || e.pointerId !== pid) return;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
      if (!moved) return;
      el.style.left = (ox + dx) + 'px'; el.style.top = (oy + dy) + 'px';
      el.style.right = 'auto'; el.style.bottom = 'auto'; el.style.transform = 'none';
    });
    el.addEventListener('pointerup', function (e) {
      if (pid === null || e.pointerId !== pid) return;
      var dy = e.clientY - sy, dx = e.clientX - sx;
      try { el.releasePointerCapture(pid); } catch (_) {}
      pid = null;
      if (moved && dy < -56 && Math.abs(dx) < 80) { if (onSwipeUp) onSwipeUp(); }   // 上スワイプ=収納/閉じ
      else if (!moved && onTap) onTap(e);
    });
    el.addEventListener('pointercancel', function () { pid = null; });
  }
  var barEl = null, iconEl = null, confirmInfo = null;
  function dismissAll() { if (barEl) { barEl.remove(); barEl = null; } if (iconEl) { iconEl.remove(); iconEl = null; } clearConfirm(); }
  function collapseToIcon() {
    clearConfirm();   // ✓=確定: sessionStorage は掃除(以後のリロードでバー再出現させない)。アイコンはメモリ上の confirmInfo で動く
    if (barEl) { barEl.remove(); barEl = null; }
    if (iconEl) return;
    iconEl = document.createElement('div');
    iconEl.style.cssText = 'position:fixed;right:14px;bottom:calc(110px + env(safe-area-inset-bottom,0px));width:52px;height:52px;z-index:2147483390;cursor:pointer;touch-action:none;filter:drop-shadow(0 6px 16px rgba(0,0,0,.45))';
    iconEl.innerHTML = '<img src="circle-white.png" alt="" style="width:100%;height:100%;animation:ncspin 6s linear infinite;pointer-events:none">';
    ensureFxStyle();
    document.body.appendChild(iconEl);
    makeDraggable(iconEl, function () { dismissAll(); }, function () { showIconMenu(); });   // タップ=メニュー / 上スワイプ=完了
  }
  var menuEl = null;
  function showIconMenu() {
    if (!iconEl) return;
    if (menuEl) { menuEl.remove(); menuEl = null; return; }   // タップでトグル(閉じられる)
    var m = document.createElement('div');
    menuEl = m;
    m.style.cssText = 'position:fixed;z-index:2147483395;background:rgba(20,20,24,.95);color:#fff;border:1px solid rgba(255,255,255,.16);border-radius:14px;padding:6px;font:600 13px -apple-system,sans-serif;-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px);box-shadow:0 14px 40px rgba(0,0,0,.5)';
    var r = iconEl.getBoundingClientRect();
    m.style.left = Math.max(8, Math.min(r.left - 70, window.innerWidth - 180)) + 'px';
    m.style.top = Math.max(8, r.top - 100) + 'px';
    m.innerHTML =
      '<div data-m="bar"  style="padding:9px 14px;cursor:pointer;border-radius:9px">バーを開く</div>' +
      '<div data-m="prev" style="padding:9px 14px;cursor:pointer;border-radius:9px">変更前を見る</div>';
    document.body.appendChild(m);
    var closer = function (e) { if (!m.contains(e.target) && !(iconEl && iconEl.contains(e.target))) { m.remove(); menuEl = null; document.removeEventListener('pointerdown', closer, true); } };
    setTimeout(function () { document.addEventListener('pointerdown', closer, true); }, 0);
    m.addEventListener('click', function (e) {
      var d = e.target.getAttribute && e.target.getAttribute('data-m');
      m.remove(); menuEl = null; document.removeEventListener('pointerdown', closer, true);
      if (d === 'bar') showBar();
      else if (d === 'prev' && confirmInfo && TYPES[confirmInfo.from]) { clearConfirm(); location.href = TYPES[confirmInfo.from].url; }   // 変更前=元スタジオ(内容は残っている)
    });
  }
  function ensureFxStyle() {
    if (document.getElementById('ncFxStyle')) return;
    var s = document.createElement('style'); s.id = 'ncFxStyle';
    s.textContent = '@keyframes ncspin{to{transform:rotate(360deg)}}' +
      '.nc-cbar{position:fixed;left:50%;bottom:calc(26px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:2147483390;display:flex;align-items:center;gap:14px;background:rgba(20,20,24,.92);-webkit-backdrop-filter:blur(24px) saturate(160%);backdrop-filter:blur(24px) saturate(160%);border:1px solid rgba(255,255,255,.16);border-radius:30px;padding:10px 18px;box-shadow:0 18px 50px rgba(0,0,0,.5);touch-action:none;animation:ncbarup .38s cubic-bezier(.2,.9,.2,1.05)}' +
      '@keyframes ncbarup{from{opacity:0;transform:translateX(-50%) translateY(24px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}' +
      '.nc-cbar button{border:none;background:none;cursor:pointer;padding:4px;-webkit-tap-highlight-color:transparent}' +
      '.nc-cbar button img{width:34px;height:34px;object-fit:contain;display:block;pointer-events:none}' +
      '.nc-cbar button:active{transform:scale(.88)}' +
      '.nc-cbar .nc-sep{width:1px;height:26px;background:rgba(255,255,255,.18)}';
    document.head.appendChild(s);
  }
  function showBar() {
    if (!confirmInfo) { try { confirmInfo = JSON.parse(sessionStorage.getItem(CONFIRM) || 'null'); } catch (_) {} }
    if (!confirmInfo) return;
    if (iconEl) { iconEl.remove(); iconEl = null; }
    if (barEl) return;
    ensureFxStyle();
    barEl = document.createElement('div');
    barEl.className = 'nc-cbar';
    barEl.innerHTML =
      '<button data-nc="del"   title="変換を取り消す"><img src="delx.png" alt="取消"></button>' +
      '<button data-nc="undo"  title="元に戻す"><img src="reee.png" alt="戻す"></button>' +
      '<span class="nc-sep"></span>' +
      '<button data-nc="share" title="共有 (AirDrop)"><img src="share-x.png" alt="共有"></button>' +
      '<span class="nc-sep"></span>' +
      '<button data-nc="ok"    title="確定"><img src="checkxxx.png" alt="確定"></button>';
    document.body.appendChild(barEl);
    makeDraggable(barEl, function () { collapseToIcon(); });   // 上スワイプ=Siriアイコンに収納
    barEl.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('button'); if (!b) return;
      var act = b.getAttribute('data-nc');
      try { if (window.haptic && haptic.tap) haptic.tap(); } catch (_) {}
      if (act === 'ok') { collapseToIcon(); return; }
      if (act === 'share') {
        var sh = { title: (confirmInfo.title || document.title || ''), url: location.href };
        if (navigator.share) navigator.share(sh).catch(function () {});
        else { try { (cfg.toast || function(){})( 'このブラウザは共有に未対応です'); } catch (_) {} }
        return;
      }
      if (act === 'del' || act === 'undo') {
        var ok = false;
        try { if (typeof cfg.undoImport === 'function') ok = cfg.undoImport(confirmInfo) !== false; } catch (_) { ok = false; }
        if (!ok) { try { (cfg.toast || window.alert)('この変換は手動で削除してください'); } catch (_) {} }
        dismissAll();
        return;
      }
    });
  }
  function maybeShowConfirm() {
    var raw = null; try { raw = sessionStorage.getItem(CONFIRM); } catch (_) {}
    if (!raw) return;
    var info = null; try { info = JSON.parse(raw); } catch (_) {}
    if (!info || info.to !== current) return;   // 対象スタジオでのみ表示
    confirmInfo = info;
    showBar();
  }

  // ---------- open / close ----------
  var open = false;
  function openMenu() {
    if (open) return; open = true;
    island.classList.add('show'); scrim.classList.add('show');
    playQuestion();
    try { if (window.haptic && haptic.confirm) haptic.confirm(); } catch (_) {}
  }
  function closeMenu() {
    if (!open) return; open = false;
    island.classList.remove('show'); scrim.classList.remove('show');
  }

  // ---------- pick → conversion handoff ----------
  function pick(target) {
    if (target === current) { closeMenu(); return; }
    closeMenu();
    try { if (window.haptic && haptic.selection) haptic.selection(); } catch (_) {}
    // a host may fully override the handoff (e.g. for the P5 responsive Siri flow)
    if (typeof cfg.onPick === 'function') { try { cfg.onPick(target, current); return; } catch (_) {} }
    convert(target);
  }
  // blob: URL → data: URL so media (images/video/audio) survives the cross-studio navigation (R1)
  function blobToDataURL(url) {
    return new Promise(function (resolve) {
      if (!url || typeof url !== 'string' || url.indexOf('blob:') !== 0) { resolve(url); return; }
      try {
        fetch(url).then(function (r) { return r.blob(); }).then(function (b) {
          var fr = new FileReader();
          fr.onload = function () { resolve(fr.result); };
          fr.onerror = function () { resolve(url); };
          fr.readAsDataURL(b);
        }).catch(function () { resolve(url); });
      } catch (_) { resolve(url); }
    });
  }
  function resolveMedia(arr) {
    if (!arr || !arr.length) return Promise.resolve(arr);
    return Promise.all(arr.map(function (L) {
      if (!L || typeof L.src !== 'string' || L.src.indexOf('blob:') !== 0) return Promise.resolve();
      return blobToDataURL(L.src).then(function (d) { L.src = d; });
    })).then(function () { return arr; });
  }
  function convert(target) {
    var dest = TYPES[target]; if (!dest) return;
    var doc = { from: current, to: target };
    try {
      if (typeof cfg.exportDoc === 'function') {
        var d = cfg.exportDoc() || {};
        doc.title = d.title || '';
        doc.layers = d.layers || [];      // R1: rich, full-fidelity ordered layers
        doc.html = d.html || '';          // back-compat
        doc.blocks = d.blocks || [];      // back-compat
      }
    } catch (_) {}
    // resolve blob: media → data: in layers AND blocks BEFORE navigating, then hand off
    Promise.resolve()
      .then(function () { return resolveMedia(doc.layers); })
      .then(function () { return resolveMedia(doc.blocks); })
      .then(function () {
        function tryStore(d) { try { sessionStorage.setItem(PENDING, JSON.stringify(d)); return true; } catch (e) { return false; } }
        // 容量超過でも「大きすぎ」で失敗させない: 重いメディアを外した軽量版(テキスト/構造/書式は保持)で変換を続行
        if (!tryStore(doc) && !tryStore(stripHeavyMedia(doc))) { try { sessionStorage.removeItem(PENDING); } catch (_) {} return; }
        try { sessionStorage.setItem(CONFIRM, JSON.stringify({ from: current, to: target, title: doc.title || '' })); } catch (_) {}   // F: 変換先で確認バーを出す
        try { location.href = dest.url; } catch (_) {}   // target imports on load (importPending)
      });
  }
  // sessionStorage 容量超過時の degrade 用: src(dataURL)/native内メディアを外し、テキスト/kind/style/geom は残す
  function stripHeavyMedia(doc) {
    function lighten(L) {
      if (!L) return L;
      var c = {}, k; for (k in L) c[k] = L[k];
      if (c.src) c.src = '';
      if (c.native && c.native.data) {
        var nd = {}, d = c.native.data, j; for (j in d) nd[j] = d[j];
        if (nd.src) nd.src = '';
        if (nd.items) nd.items = [];
        if (nd.videoSrc) nd.videoSrc = '';
        c.native = { studio: c.native.studio, clip: c.native.clip, name: c.native.name, data: nd };
      } else if (c.native && c.native.clip) {
        c.native = { studio: c.native.studio, clip: c.native.clip, name: c.native.name };   // cinema: clipはsrcを持たないのでそのまま
      }
      return c;
    }
    var out = { from: doc.from, to: doc.to, title: doc.title, html: '' };
    out.layers = (doc.layers || []).map(lighten);
    out.blocks = (doc.blocks || []).map(function (b) { if (!b) return b; var c = {}, k; for (k in b) c[k] = b[k]; if (c.src) c.src = ''; return c; });
    return out;
  }

  // ---------- import on load (target studio) ----------
  function importPending() {
    var raw = null;
    try { raw = sessionStorage.getItem(PENDING); } catch (_) {}
    if (!raw) return false;
    var doc; try { doc = JSON.parse(raw); } catch (_) { doc = null; }
    if (!doc || doc.to !== current) return false;     // not for this studio — leave it
    var ok = false;
    try { if (typeof cfg.importDoc === 'function') ok = cfg.importDoc(doc) !== false; } catch (_) { ok = false; }
    if (ok) {
      try { sessionStorage.removeItem(PENDING); } catch (_) {}   // consume ONLY on success (so a not-ready studio can retry)
      playInteli(); try { if (window.haptic && haptic.confirm) haptic.confirm(); } catch (_) {}
      try { maybeShowConfirm(); } catch (_) {}   // F: 取込成功 → 確認バー
    }
    return ok;
  }
  // wait until this studio's APIs exist (doc=sync / app=window.sites / cinema=window.editor lazily) before importing
  function whenReady(fn, tries) {
    tries = tries || 0;
    var ready = true;
    try { ready = (typeof cfg.ready === 'function') ? !!cfg.ready() : true; } catch (_) { ready = true; }
    if (ready || tries > 600) { fn(); return; }       // poll ~100ms up to ~60s, then attempt once anyway
    setTimeout(function () { whenReady(fn, tries + 1); }, 100);
  }

  // ---------- events ----------
  scrim.addEventListener('click', closeMenu);
  var sy = null;
  function down(e) { sy = e.clientY; }
  function up(e) { if (sy != null && sy - e.clientY > 26) closeMenu(); sy = null; }
  island.addEventListener('pointerdown', down);
  island.addEventListener('pointerup', up);
  island.addEventListener('pointercancel', function () { sy = null; });
  scrim.addEventListener('pointerdown', down);
  scrim.addEventListener('pointerup', up);
  scrim.addEventListener('pointercancel', function () { sy = null; });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });

  function boot() {
    mount();
    var raw = null; try { raw = sessionStorage.getItem(PENDING); } catch (_) {}
    if (!raw) {
      // F: App は import 後に reload するため、pending 消費済みでも nc_confirm が残っていればバーを出す
      // (バー/アイコンが既に出ている場合は何もしない=二重表示防止)
      setTimeout(function () { if (!barEl && !iconEl) { try { maybeShowConfirm(); } catch (_) {} } }, 600);
      return;
    }
    var doc; try { doc = JSON.parse(raw); } catch (_) { doc = null; }
    if (!doc || doc.to !== current) return;            // pending is for another studio — leave it
    whenReady(importPending);                          // import the moment this studio's APIs are ready
  }
  if (document.body) boot(); else document.addEventListener('DOMContentLoaded', boot);

  window.NativeChange = {
    open: openMenu, close: closeMenu, pick: pick, convert: convert,
    importPending: importPending, current: function () { return current; },
    el: { island: island, scrim: scrim }
  };
})();
