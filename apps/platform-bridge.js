/* platform-bridge.js
 * Single shim for haptic / export / persistence so identical JS runs in both
 *   - PWA (Safari / mobile)
 *   - Mac native Swift WKWebView (ihax-composer-mac/)
 *
 * Compatibility policy: see WORK_LOG_ihax_composer_mac_2026-05-19.md
 *   - JS is the single source of truth. Mac wrapper only adds a native bridge.
 *   - Haptic kinds: selection|medium|soft|heavy|success|error|warning|alignment|level
 *   - Force Touch: Swift bridges NSResponder.pressureChange → window._macForceTouch(force, x, y)
 *     The existing webkitmouseforcechanged listener still fires on Safari for Mac PWA.
 */
(function () {
  'use strict';

  const hasBridge = !!(window.webkit && window.webkit.messageHandlers
    && window.webkit.messageHandlers.nativeBridge);
  const isMacNative = hasBridge && /Mac OS X/.test(navigator.userAgent);

  // Lazy-load ios-haptics for PWA only (Safari iOS / Mac Safari).
  let iosHapticPromise = null;
  function ensureIosHaptic() {
    if (iosHapticPromise) return iosHapticPromise;
    iosHapticPromise = (async () => {
      try {
        const mod = await import('https://esm.sh/ios-haptics');
        return mod.haptic;
      } catch (_e) {
        return null;
      }
    })();
    return iosHapticPromise;
  }
  if (!isMacNative) ensureIosHaptic();

  function postNative(msg) {
    try { window.webkit.messageHandlers.nativeBridge.postMessage(msg); } catch (_e) {}
  }

  // Throttle continuous haptics (e.g. drag) so trackpad doesn't buzz like a phone.
  let lastHapticAt = 0;
  function haptic(kind) {
    kind = kind || 'selection';
    if (isMacNative) {
      const now = performance.now();
      if (now - lastHapticAt < 35) return;
      lastHapticAt = now;
      postNative({ type: 'haptic', kind });
    } else {
      ensureIosHaptic().then((h) => {
        if (!h) return;
        const fn = h[kind] || h.selection;
        if (typeof fn === 'function') { try { fn(); } catch (_e) {} }
      });
    }
  }

  // Export-to-app payload bridge.
  // payload = { name, emoji, html, css, files, projectId, alreadyExported }
  function exportApp(payload) {
    if (isMacNative) {
      postNative({ type: 'exportApp', payload });
    } else {
      // PWA fallback — old behaviour: trigger zip download of html bundle.
      if (typeof window.__pwaExportZip === 'function') {
        window.__pwaExportZip(payload);
      } else {
        // Minimal fallback: dump html into a download.
        const blob = new Blob([payload.html || ''], { type: 'text/html' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = (payload.name || 'app') + '.html';
        document.body.appendChild(a); a.click(); a.remove();
      }
    }
  }

  // Open / share / next-project signals after completion screen.
  function openExportedApp(projectId) {
    if (isMacNative) postNative({ type: 'openExportedApp', projectId });
  }
  function shareExportedApp(projectId) {
    if (isMacNative) postNative({ type: 'shareExportedApp', projectId });
  }

  // Project auto-save (in-app, not user-facing file save).
  const AUTOSAVE_KEY = 'composerAutoSave';
  function saveProject(snapshot) {
    try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(snapshot)); } catch (_e) {}
    if (isMacNative) postNative({ type: 'saveProject', snapshot });
  }
  function loadProject() {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_e) { return null; }
  }
  function clearProject() {
    try { localStorage.removeItem(AUTOSAVE_KEY); } catch (_e) {}
    if (isMacNative) postNative({ type: 'clearProject' });
  }

  // Set of exported project ids (so we know to show 更新 warning).
  const EXPORTED_KEY = 'composerExportedIds';
  function markExported(projectId) {
    try {
      const list = JSON.parse(localStorage.getItem(EXPORTED_KEY) || '[]');
      if (!list.includes(projectId)) {
        list.push(projectId);
        localStorage.setItem(EXPORTED_KEY, JSON.stringify(list));
      }
    } catch (_e) {}
  }
  function hasExported(projectId) {
    try {
      const list = JSON.parse(localStorage.getItem(EXPORTED_KEY) || '[]');
      return list.includes(projectId);
    } catch (_e) { return false; }
  }

  // Window close prompt (Mac native asks Swift to intercept window close).
  function onBeforeClosePrompt(handler) {
    window.__composerBeforeClose = handler;
    if (isMacNative) postNative({ type: 'registerBeforeClose' });
  }

  // Native → JS: Swift can call window.platform._fromNative({type, ...})
  function _fromNative(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'forceTouch':
        if (typeof window._macForceTouch === 'function') {
          try { window._macForceTouch(msg.force, msg.x, msg.y); } catch (_e) {}
        }
        break;
      case 'beforeClose':
        if (typeof window.__composerBeforeClose === 'function') {
          try { window.__composerBeforeClose(); } catch (_e) {}
        }
        break;
    }
  }

  window.platform = {
    isMacNative,
    haptic,
    exportApp,
    openExportedApp,
    shareExportedApp,
    saveProject, loadProject, clearProject,
    markExported, hasExported,
    onBeforeClosePrompt,
    _fromNative,
  };

  // Convenience global mirror (legacy code calls window.haptic.* directly).
  if (!window.haptic) {
    window.haptic = new Proxy({}, { get: (_t, k) => () => haptic(typeof k === 'string' ? k : 'selection') });
  }
})();
