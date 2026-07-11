/* composer-export.js — JS side of the iHax Composer export flow.
 *
 * On Mac native (WKWebView): all modals are rendered by Swift NSPanel
 *   (Sources/Modals/*). JS just emits intents and answers data requests.
 * On PWA: minimal HTML fallbacks (until a web-only modal lib is added).
 *
 * Compatibility: see WORK_LOG_ihax_composer_mac_2026-05-19.md
 */
(function () {
  'use strict';

  const P = window.platform;
  if (!P) { console.warn('platform-bridge.js not loaded'); return; }

  // ── Project id (persistent) ────────────────────────────────────────────
  const PID_KEY = 'composerProjectId';
  function getProjectId() {
    let id = '';
    try { id = localStorage.getItem(PID_KEY) || ''; } catch (_e) {}
    if (!id) {
      id = 'prj_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
      try { localStorage.setItem(PID_KEY, id); } catch (_e) {}
    }
    return id;
  }
  function resetProjectId() { try { localStorage.removeItem(PID_KEY); } catch (_e) {} }

  // ── Snapshot of current composer state ─────────────────────────────────
  function snapshotCurrentProject() {
    let sites = {}, files = [], currentSite = '';
    try { sites = JSON.parse(localStorage.getItem('storyDockSites') || '{}'); } catch (_e) {}
    try { files = JSON.parse(localStorage.getItem('storyDockFiles') || '[]'); } catch (_e) {}
    try { currentSite = localStorage.getItem('storyDockCurrentSite') || ''; } catch (_e) {}
    return {
      projectId: getProjectId(),
      currentSite, sites, files,
      currentHTML: (document.getElementById('mainContent') || {}).innerHTML || '',
      userCSS: (function(){ try { return localStorage.getItem('composerUserCSS') || ''; } catch (_e) { return ''; } })(),
      ts: Date.now(),
    };
  }

  // ── Auto-save: throttle to 800ms after last edit ───────────────────────
  let autoSaveT = 0;
  function scheduleAutoSave() {
    clearTimeout(autoSaveT);
    autoSaveT = setTimeout(() => { P.saveProject(snapshotCurrentProject()); }, 800);
  }
  // Explicit, immediate save — used by the "ホームに戻る → 保存しますか？" prompt.
  window.__composerSave = function () { try { P.saveProject(snapshotCurrentProject()); } catch (_e) {} };
  function startAutoSave() {
    const root = document.getElementById('mainContent');
    if (root && 'MutationObserver' in window) {
      new MutationObserver(scheduleAutoSave).observe(root, {
        childList: true, subtree: true, characterData: true, attributes: true,
      });
    }
    const origSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      origSet.call(this, k, v);
      if (k === 'storyDockSites' || k === 'storyDockFiles' || k === 'storyDockCurrentSite' || k === 'composerUserCSS') {
        scheduleAutoSave();
      }
    };
  }

  // ── Slider haptic on number scrubs ─────────────────────────────────────
  function startSliderHaptic() {
    const lastVal = new WeakMap();
    document.addEventListener('input', (e) => {
      const t = e.target;
      if (!t) return;
      const isSlider = (t.type === 'range') || t.classList.contains('se-slider') || t.classList.contains('cx-slider');
      if (!isSlider) return;
      const v = parseFloat(t.value);
      const prev = lastVal.get(t);
      if (prev == null || Math.floor(v) !== Math.floor(prev)) P.haptic('selection');
      lastVal.set(t, v);
    }, true);
  }

  // ── Trackpad two-finger SCROLL (not drag) → slider scrub. 3 phases:
  //   Phase 1 — DETECT: a `wheel` event whose target is inside a slider.
  //   Phase 2 — ACCUMULATE: sum dominant-axis pixel delta into a remainder
  //             buffer until it crosses one slider `step` worth of pixels.
  //             This is per-slider so different sliders don't share state.
  //   Phase 3 — APPLY+HAPTIC: emit value change(s), one haptic per crossed
  //             step. Avoids firing 60 haptics/sec on a smooth swipe.
  //   Axes: deltaY (vertical scroll) and deltaX (horizontal scroll) both
  //         scrub. Finger-up = +, finger-right = +.
  function startSliderWheelScrub() {
    const PX_PER_STEP = 12;   // pixels of scroll per +1 step (smooth feel)
    const accum = new WeakMap();   // slider → leftover pixels (signed)

    function findSlider(el) {
      while (el && el !== document.body) {
        if (el.matches && (el.matches('input[type="range"]')
                            || el.classList.contains('se-slider')
                            || el.classList.contains('cx-slider'))) return el;
        el = el.parentNode;
      }
      return null;
    }

    document.addEventListener('wheel', (e) => {
      // ── Phase 1: detect a slider under the cursor ──
      const slider = findSlider(e.target);
      if (!slider) return;

      // Pull bounds + step once.
      const minV = parseFloat(slider.min || '0');
      const maxV = parseFloat(slider.max || '100');
      const step = parseFloat(slider.step || '1') || 1;

      // ── Phase 2: accumulate pixel delta on the dominant axis ──
      // macOS natural-scroll deltas:
      //   finger-up   → deltaY < 0   → we want + (increment) → flip sign
      //   finger-right→ deltaX > 0   → we want + (increment)
      const ax = Math.abs(e.deltaX), ay = Math.abs(e.deltaY);
      const axisDelta = (ax >= ay) ? e.deltaX : -e.deltaY;
      const prev = accum.get(slider) || 0;
      let pool = prev + axisDelta;
      let stepsToApply = (pool / PX_PER_STEP) | 0;   // truncate toward 0
      if (stepsToApply !== 0) {
        pool -= stepsToApply * PX_PER_STEP;
      }
      accum.set(slider, pool);

      // Always consume the wheel so it never accidentally scrolls the page
      // (a slider catching the wheel = user is scrubbing, not panning).
      e.preventDefault();
      e.stopPropagation();
      if (stepsToApply === 0) return;

      // ── Phase 3: apply value change + one haptic per integer step ──
      const before = parseFloat(slider.value);
      let v = before + stepsToApply * step;
      if (v < minV) v = minV;
      if (v > maxV) v = maxV;
      // Round to step grid so int sliders stay int.
      const decimals = (String(step).split('.')[1] || '').length;
      v = parseFloat(v.toFixed(decimals));
      if (v === before) return;

      slider.value = String(v);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
      P.haptic('selection');
    }, { capture: true, passive: false });
  }

  // ── Swift → JS callbacks ───────────────────────────────────────────────
  // Override platform._fromNative router (it already exists in platform-bridge.js,
  // we extend it here so Swift can request snapshots / trigger applies).
  const baseFromNative = P._fromNative;
  P._fromNative = function (msg) {
    if (!msg || typeof msg !== 'object') return baseFromNative(msg);
    switch (msg.type) {
      case 'snapshotRequest':
        try {
          window.webkit.messageHandlers.nativeBridge.postMessage({
            type: 'snapshotResponse', snapshot: snapshotCurrentProject(),
          });
        } catch (_e) {}
        return;
      case 'projectIdRequest':
        try {
          window.webkit.messageHandlers.nativeBridge.postMessage({
            type: 'projectIdResponse', projectId: getProjectId(),
          });
        } catch (_e) {}
        return;
      case 'resumeApply':
        applySnapshot(msg.snapshot || {});
        return;
      case 'clearAndReload':
        resetProjectId();
        try {
          localStorage.removeItem('storyDockSites');
          localStorage.removeItem('storyDockFiles');
          localStorage.removeItem('storyDockCurrentSite');
        } catch (_e) {}
        sessionStorage.setItem('cx_skip_resume', '1');
        location.reload();
        return;
      case 'openRename':
        openFilenameRename();
        return;
      case 'createInitialPage':
        // FORBIDDEN: do not silently fall back to "site1.html". If Swift
        // somehow sent no name (it shouldn't — NewPagePanel rejects empty
        // input), refuse to write anything so we don't pollute storage.
        if (msg.name && String(msg.name).trim().length > 0) {
          createInitialPage(String(msg.name).trim());
        }
        return;
      default:
        return baseFromNative(msg);
    }
  };

  function createInitialPage(name) {
    try {
      const sites = JSON.parse(localStorage.getItem('storyDockSites') || '{}');
      sites[name] = sites[name] || { html: '', css: '', meta: {} };
      localStorage.setItem('storyDockSites', JSON.stringify(sites));
      const files = JSON.parse(localStorage.getItem('storyDockFiles') || '[]');
      if (!files.includes(name)) files.push(name);
      localStorage.setItem('storyDockFiles', JSON.stringify(files));
      localStorage.setItem('storyDockCurrentSite', name);
      sessionStorage.setItem('cx_skip_resume', '1');
    } catch (_e) {}
    setTimeout(() => location.reload(), 200);
  }
  function hasAnyPage() {
    try {
      const s = JSON.parse(localStorage.getItem('storyDockSites') || '{}');
      return Object.keys(s).length > 0;
    } catch (_e) { return false; }
  }
  function maybePromptEmpty() {
    if (hasAnyPage()) return;
    // index launcher owns app naming/creation — don't double-prompt for a name.
    try {
      if (sessionStorage.getItem('sl_pending_name')) return;   // launcher app-create in progress (page about to be made)
      if (document.querySelector('.studio-launcher') && !document.body.classList.contains('launched')) return;  // launcher still on screen
    } catch (_e) {}
    if (P.isMacNative) {
      window.webkit.messageHandlers.nativeBridge.postMessage({ type: 'openNewPagePrompt' });
    } else {
      // PWA: no blocking prompt. Open the in-app new-page overlay (nice input);
      // if it's not present, fall back to creating a default page so the user is
      // never stuck on an empty workspace.
      const npo = document.getElementById('newPageOverlay');
      const npi = document.getElementById('newPageInput');
      if (npo) {
        npo.classList.add('active');
        if (npi) { npi.value = ''; setTimeout(function () { try { npi.focus(); } catch (_e) {} }, 280); }
      } else {
        createInitialPage('Untitled');
      }
    }
  }

  function applySnapshot(snap) {
    try {
      if (snap.sites)       localStorage.setItem('storyDockSites', JSON.stringify(snap.sites));
      if (snap.files)       localStorage.setItem('storyDockFiles', JSON.stringify(snap.files));
      if (snap.currentSite) localStorage.setItem('storyDockCurrentSite', snap.currentSite);
      if (snap.userCSS)     localStorage.setItem('composerUserCSS', snap.userCSS);
      sessionStorage.setItem('cx_skip_resume', '1');
    } catch (_e) {}
    setTimeout(() => location.reload(), 320);
  }

  function openFilenameRename() {
    const pill = document.getElementById('filenamePill');
    const collapsed = document.getElementById('filenameCollapsed');
    if (collapsed && pill && !pill.classList.contains('expanded')) collapsed.click();
    setTimeout(() => document.getElementById('filenameInput')?.focus(), 200);
  }

  // ── PWA export (web) — bundle the current page into an installable PWA .zip ──
  const _CRC = (function () { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
  function _crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = _CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function _zipStore(files) {
    const enc = new TextEncoder(); const parts = [], central = []; let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name), data = f.data, crc = _crc32(data), size = data.length;
      const lh = new Uint8Array(30 + name.length), dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(8, 0, true);
      dv.setUint16(12, 0x21, true); dv.setUint32(14, crc, true); dv.setUint32(18, size, true); dv.setUint32(22, size, true); dv.setUint16(26, name.length, true);
      lh.set(name, 30); parts.push(lh, data);
      const ch = new Uint8Array(46 + name.length), cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(10, 0, true);
      cv.setUint16(14, 0x21, true); cv.setUint32(16, crc, true); cv.setUint32(20, size, true); cv.setUint32(24, size, true); cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true);
      ch.set(name, 46); central.push(ch); offset += lh.length + data.length;
    }
    const cdStart = offset; let cdSize = 0; for (const c of central) { parts.push(c); cdSize += c.length; }
    const eo = new Uint8Array(22), ev = new DataView(eo.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, cdSize, true); ev.setUint32(16, cdStart, true);
    parts.push(eo); let total = 0; parts.forEach(p => total += p.length); const out = new Uint8Array(total); let o = 0; parts.forEach(p => { out.set(p, o); o += p.length; }); return out;
  }
  function _esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function _toast(msg) {
    let t = document.getElementById('cxToast');
    if (!t) { t = document.createElement('div'); t.id = 'cxToast'; t.style.cssText = 'position:fixed;top:84px;left:50%;transform:translateX(-50%) scale(.9);background:rgba(20,18,40,.9);color:#fff;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);padding:12px 22px;border-radius:16px;font:600 14px/1.4 -apple-system,system-ui;z-index:2147483600;opacity:0;transition:opacity .3s,transform .3s;pointer-events:none;max-width:80vw;text-align:center'; document.body.appendChild(t); }
    t.textContent = msg; requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'translateX(-50%) scale(1)'; });
    clearTimeout(_toast._t); _toast._t = setTimeout(() => { t.style.opacity = '0'; }, 2200);
  }
  async function _fetchText(u) { try { const r = await fetch(u); return r.ok ? await r.text() : ''; } catch (_) { return ''; } }
  async function _fetchBytes(u) { const r = await fetch(u); if (!r.ok) throw 0; return new Uint8Array(await r.arrayBuffer()); }
  async function exportPWA() {
    try {
      P.haptic && P.haptic('medium');
      _toast('📦 書き出し中…');
      const enc = new TextEncoder();
      const main = document.getElementById('mainContent');
      const inner = main ? main.innerHTML : '';
      const title = ((document.getElementById('pageTitle') || {}).textContent || document.title || 'App').trim() || 'App';
      const safe = (title.replace(/[^\w぀-ヿ一-龯\- ]/g, '').trim().replace(/\s+/g, '-').slice(0, 40)) || 'app';
      const css = (await _fetchText("ihax-studios'-style.css")) + '\n' + (await _fetchText('composer-export.css'));
      const html = '<!DOCTYPE html>\n<html lang="ja">\n<head>\n<meta charset="UTF-8">\n'
        + '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">\n'
        + '<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="theme-color" content="#f0f2f5">\n'
        + '<link rel="manifest" href="manifest.json">\n<link rel="apple-touch-icon" href="icon-192.png">\n'
        + '<title>' + _esc(title) + '</title>\n<link rel="stylesheet" href="style.css">\n</head>\n'
        + '<body>\n<div class="main-content">\n' + inner + '\n</div>\n'
        + '<script>if("serviceWorker"in navigator)navigator.serviceWorker.register("sw.js").catch(function(){});<' + '/script>\n</body>\n</html>';
      const manifest = JSON.stringify({ name: title, short_name: safe, start_url: '.', display: 'standalone', background_color: '#f0f2f5', theme_color: '#f0f2f5', icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }] }, null, 2);
      const sw = 'const C="' + safe + '-v1";const A=["./","index.html","style.css","manifest.json","icon-192.png","icon-512.png"];'
        + 'self.addEventListener("install",e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(A).catch(()=>{})).then(()=>self.skipWaiting()))});'
        + 'self.addEventListener("activate",e=>{e.waitUntil(self.clients.claim())});'
        + 'self.addEventListener("fetch",e=>{e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp).catch(()=>{}));return r}).catch(()=>caches.match(e.request).then(m=>m||caches.match("index.html"))))});';
      const files = [
        { name: 'index.html', data: enc.encode(html) },
        { name: 'style.css', data: enc.encode(css) },
        { name: 'manifest.json', data: enc.encode(manifest) },
        { name: 'sw.js', data: enc.encode(sw) }
      ];
      for (const ic of ['icon-192.png', 'icon-512.png']) { try { files.push({ name: ic, data: await _fetchBytes(ic) }); } catch (_) {} }
      const blob = new Blob([_zipStore(files)], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = safe + '-pwa.zip';
      document.body.appendChild(a); a.click();
      setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1500);
    } catch (e) { console.error(e); _toast('⚠️ 失敗'); }
  }
  window.__composerExportPWA = exportPWA;

  // ── 􀈈 export buttons → Mac: Swift Stage 1 · PWA: zip export ──────────────
  function wireExportButtons() {
    const open = () => {
      P.haptic('medium');
      if (P.isMacNative) {
        window.webkit.messageHandlers.nativeBridge.postMessage({ type: 'openExportFlow' });
      } else {
        exportPWA();
      }
    };
    document.getElementById('filenameExportBtn')?.addEventListener('click', (e) => { e.stopPropagation(); open(); });
    // exportBtnPreview 撤去（死にボタン）。open() は上の filenameExportBtn が担当。
  }

  // (× close button was removed by user request — Cmd+Q or power slide-to-delete only.)
  function wireWindowClose() { /* no-op */ }

  // ── Right-click → ask Swift to show popover ───────────────────────────
  // PHASE-GUARD: only intercept REAL right-click events (button === 2 or
  // mouse-detail right). Mac trackpad two-finger TAP also fires
  // 'contextmenu' but with no button; we let those through so the composer's
  // original two-finger tap → add-bar still fires.
  function wireRightClick() {
    document.addEventListener('contextmenu', (e) => {
      const isRealRight = (e.button === 2) || (e.which === 3);
      if (!isRealRight) {
        // Two-finger tap or accessibility menu — don't hijack.
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (P.isMacNative) {
        window.webkit.messageHandlers.nativeBridge.postMessage({
          type: 'openRightClick', x: e.clientX, y: e.clientY,
        });
      }
    }, true);
  }

  // ── Globe presence ↔ Swift offline badge ──────────────────────────────
  function wireGlobeAwareness() {
    if (!P.isMacNative) return;
    const post = (present) => {
      try {
        window.webkit.messageHandlers.nativeBridge.postMessage({
          type: 'globePresent', present,
        });
      } catch (_e) {}
    };
    let last = null;
    const check = () => {
      // 2026-05-19: 実 DOM の globe class は .placed-globe (index.html L1885)。
      // 旧セレクタは存在しない class を指していたので Swift 側 OfflineBadgePanel が
      // ジオ無し扱いになりオフライン badge が永久に隠れていた。
      const has = !!document.querySelector(
        '.placed-globe, .globe, [data-kind="globe"], #globeCanvas, #globeWrap, .stack-globe'
      );
      if (has !== last) { last = has; post(has); }
    };
    if ('MutationObserver' in window) {
      const root = document.getElementById('mainContent') || document.body;
      new MutationObserver(check).observe(root, { childList: true, subtree: true });
    }
    check();
  }

  // ── Recovery dialog: ask Swift to show on boot if autosave exists ─────
  function maybeShowReopen() {
    try { if (sessionStorage.getItem('cx_skip_resume') === '1') { sessionStorage.removeItem('cx_skip_resume'); return; } } catch (_e) {}
    let snap = null;
    try { snap = JSON.parse(localStorage.getItem('composerAutoSave') || 'null'); } catch (_e) {}
    if (!snap) return;
    // The old confirm()/native reopen dialog is ABOLISHED. Resume is now surfaced by the
    // launcher as an Apple Watch-style Smart Stack card. Expose the snapshot + applier so
    // the launcher (and anything else) can offer "前回の続き" without a blocking alert.
    window.__composerResumeSnap = snap;
    window.__composerResume = function () { try { applySnapshot(snap); } catch (_e) {} };
    try { window.dispatchEvent(new CustomEvent('composer:resume-available', { detail: { snap: snap } })); } catch (_e) {}
  }

  // ── Kill the legacy 3D chip/object action dialog at the source ────────
  // Even though composer.html already sets __3DOpenActionMenu to noop, other
  // code paths (e.g. __3DBuildActionMenuItems consumer) might still inject
  // the menu DOM. Force the openers + a MutationObserver sweep.
  function killLegacy3DActionMenu() {
    const noop = function () {};
    try { Object.defineProperty(window, '__3DOpenActionMenu', { value: noop, writable: true, configurable: true }); } catch (_e) {}
    window.__3DBuildActionMenuItems = function () { return []; };
    window.__3DBuildChipMenuItems = function () { return []; };
    const mo = new MutationObserver(() => {
      document.querySelectorAll('.x3d-action-menu, .x3d-action-backdrop').forEach((el) => el.remove());
    });
    mo.observe(document.body, { childList: true, subtree: false });
  }

  function boot() {
    // RE-DESIGN: keep the composer's original tap → add-bar, long-press /
    // Force Touch → site switch, and OS context menu fully intact.
    // We add NOTHING that intercepts mouse/wheel/contextmenu globally.
    killLegacy3DActionMenu();
    wireExportButtons();          // savex.png buttons (filename pill + preview corner)
    // wireWindowClose — disabled (× removed by user)
    // RESTORED ("web と同じようにやれ"). Both are scoped so they don't break
    // the composer's original behaviour:
    //   wireRightClick blocks only real right-clicks (e.button === 2 || which === 3).
    //   Trackpad two-finger tap fires contextmenu with button=0 and is passed
    //   through, so the composer's add-bar still appears.
    //   startSliderWheelScrub only intercepts wheel events when the cursor is
    //   over an input[type=range] / .se-slider / .cx-slider; all other wheel
    //   events scroll the page normally.
    wireRightClick();
    startSliderWheelScrub();
    wireGlobeAwareness();
    startAutoSave();
    startSliderHaptic();          // only listens to slider 'input' events — non-invasive
    // Empty-state gate: composer window stays hidden in Mac native mode.
    // If we have pages → reveal window. If not → show NewPagePanel; window
    // will reveal after createInitialPage triggers reload.
    if (P.isMacNative) {
      if (hasAnyPage()) {
        window.webkit.messageHandlers.nativeBridge.postMessage({ type: 'showComposerWindow' });
        setTimeout(maybeShowReopen, 800);
      } else {
        window.webkit.messageHandlers.nativeBridge.postMessage({ type: 'openNewPagePrompt' });
      }
    } else {
      setTimeout(maybeShowReopen, 800);
      setTimeout(maybePromptEmpty, 1400);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
