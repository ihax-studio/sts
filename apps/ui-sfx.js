/* ui-sfx.js — shared UI sound + haptic manager (Apple-style cues).
 * window.sfx.play('done'|'received'|'sent'|'lock'|'authStart'|'swish'|
 *                 'navPush'|'navPop'|'notify'|'opticSuccess'|'opticStart'|'opticFail', vol?)
 * Sounds are subtle by design; each is paired with a matching haptic.
 */
(function () {
  'use strict';
  var DIR = (function () {
    // resolve relative to this script so sub-pages still find /sounds
    try { var s = document.currentScript; if (s && s.src) return s.src.replace(/[^\/]*$/, '') + 'sounds/'; } catch (_) {}
    return 'sounds/';
  })();
  var MAP = {
    done: 'done.m4a', received: 'received.m4a', sent: 'sent.m4a', lock: 'lock.m4a',
    authStart: 'authstart.m4a', swish: 'swish.m4a', navPush: 'navpush.m4a', navPop: 'navpop.m4a',
    notify: 'notify.m4a', opticSuccess: 'opticsuccess.m4a', opticStart: 'opticstart.m4a', opticFail: 'opticfail.m4a'
  };
  var HAPTIC = {
    done: 'confirm', lock: 'confirm', opticSuccess: 'confirm', opticFail: 'error',
    received: 'light', sent: 'light', navPush: 'light', navPop: 'light',
    notify: 'light', authStart: 'light', swish: 'light'
  };
  var VOL = { done: 0.6, lock: 0.55, received: 0.5, sent: 0.5, swish: 0.45, navPush: 0.4, navPop: 0.4, notify: 0.5, authStart: 0.5, opticSuccess: 0.6, opticStart: 0.5, opticFail: 0.55 };
  var cache = {}, enabled = true;
  function base(name) {
    var f = MAP[name]; if (!f) return null;
    if (!cache[name]) { var a = new Audio(DIR + f); a.preload = 'auto'; cache[name] = a; }
    return cache[name];
  }
  function play(name, vol) {
    if (!enabled) return;
    try {
      var a = base(name);
      if (a) { var n = a.cloneNode(); n.volume = (vol == null ? (VOL[name] == null ? 0.5 : VOL[name]) : vol); n.play().catch(function () {}); }
    } catch (_) {}
    try { if (window.haptic) { var h = HAPTIC[name] || 'light'; (window.haptic[h] || window.haptic.light || window.haptic.selection || function () {})(); } } catch (_) {}
    try { if (!window.haptic) navigator.vibrate && navigator.vibrate(name === 'done' || name === 'lock' ? 14 : 7); } catch (_) {}
  }
  // warm the cache on first user gesture (autoplay policy)
  function warm() { Object.keys(MAP).forEach(function (k) { try { base(k); } catch (_) {} }); }
  document.addEventListener('pointerdown', warm, { once: true, capture: true });
  document.addEventListener('keydown', warm, { once: true, capture: true });
  window.sfx = { play: play, enable: function (on) { enabled = !!on; }, MAP: MAP };
})();
