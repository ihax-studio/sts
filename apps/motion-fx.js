/* motion-fx.js — shared cinematic transition engine (Framer/Apple-grade).
 *
 *   MotionFX.cinematic(title, midFn, kicker?)  → same-page: title-card in → midFn() at peak → reveal out.
 *   MotionFX.enter(title, href, kicker?)       → cross-file: play title-card in, then navigate; the
 *                                                target page's boot() reveals out → one continuous motion.
 *   MotionFX.boot()                            → call on load; if a transition is in flight, play the reveal.
 *
 * The look: a dark cinematic card with a faint grid, a kicker, a big blur-in title, and an accent line.
 */
(function () {
  'use strict';
  if (window.MotionFX) return;
  var EASE = 'cubic-bezier(.16,1,.3,1)';
  var reduce = false;
  try { reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) {}

  var STYLE = '' +
    '.mfx-overlay{position:fixed;inset:0;z-index:2147483600;display:flex;align-items:center;justify-content:center;' +
    'background:radial-gradient(125% 125% at 50% 38%,#17152400 0%,#0a0912 0%,#070610 62%,#040308 100%);opacity:0;pointer-events:none;' +
    'background-color:#070610;-webkit-font-smoothing:antialiased;}' +
    '.mfx-overlay.mfx-show{pointer-events:auto;}' +
    '.mfx-grid{position:absolute;inset:0;opacity:.12;' +
    'background-image:linear-gradient(rgba(255,255,255,.55) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.55) 1px,transparent 1px);' +
    'background-size:62px 62px;-webkit-mask-image:radial-gradient(closest-side at 50% 50%,#000 55%,transparent);mask-image:radial-gradient(closest-side at 50% 50%,#000 55%,transparent);}' +
    '.mfx-center{position:relative;text-align:center;color:#fff;padding:0 26px;max-width:90vw;}' +
    '.mfx-kicker{font:600 13px/1 -apple-system,"SF Pro Text",system-ui;letter-spacing:.3em;text-transform:uppercase;color:rgba(255,255,255,.46);margin-bottom:18px;}' +
    '.mfx-title{font:800 clamp(34px,7.4vw,78px)/1.02 -apple-system,"SF Pro Display","Hiragino Sans",system-ui;letter-spacing:-.022em;color:#fff;}' +
    '.mfx-line{height:2px;width:128px;background:linear-gradient(90deg,#7a5cf5,#4f6cf5,#e24a86);margin:24px auto 0;border-radius:2px;box-shadow:0 0 26px rgba(124,92,255,.6);transform-origin:center;}';

  var overlay, gridEl, kickerEl, titleEl, lineEl;
  function ensure() {
    if (overlay) return;
    var st = document.createElement('style'); st.textContent = STYLE; document.head.appendChild(st);
    overlay = document.createElement('div'); overlay.className = 'mfx-overlay';
    gridEl = document.createElement('div'); gridEl.className = 'mfx-grid';
    var c = document.createElement('div'); c.className = 'mfx-center';
    kickerEl = document.createElement('div'); kickerEl.className = 'mfx-kicker';
    titleEl = document.createElement('div'); titleEl.className = 'mfx-title';
    lineEl = document.createElement('div'); lineEl.className = 'mfx-line';
    c.appendChild(kickerEl); c.appendChild(titleEl); c.appendChild(lineEl);
    overlay.appendChild(gridEl); overlay.appendChild(c);
    document.body.appendChild(overlay);
  }
  function setText(title, kicker) {
    ensure();
    titleEl.textContent = title || '';
    kickerEl.textContent = kicker || 'Studio';
    kickerEl.style.display = kicker === '' ? 'none' : '';
  }
  function anim(el, frames, ms, delay) {
    // Always RESOLVE (never reject) — even on cancel — so Promise.all chains can't break
    // and leave the overlay stuck when a new transition interrupts an old one.
    return new Promise(function (resolve) {
      try {
        var a = el.animate(frames, { duration: reduce ? 1 : ms, delay: delay || 0, easing: EASE, fill: 'both' });
        a.onfinish = function () { resolve(); };
        a.oncancel = function () { resolve(); };
      } catch (_) { resolve(); }
    });
  }
  // title-card builds in (covers the screen)
  function animateIn() {
    // cancel any lingering animations from a prior transition on the shared overlay
    [overlay, gridEl, kickerEl, titleEl, lineEl].forEach(function (e) { try { e.getAnimations().forEach(function (a) { a.cancel(); }); } catch (_) {} });
    overlay.classList.add('mfx-show');
    var pIn = [
      anim(overlay, [{ opacity: 0 }, { opacity: 1 }], 360),
      anim(gridEl, [{ transform: 'scale(1.08)' }, { transform: 'scale(1)' }], 700),
      anim(kickerEl, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], 460, 120),
      anim(titleEl, [{ opacity: 0, filter: 'blur(14px)', transform: 'translateY(24px) scale(1.04)' }, { opacity: 1, filter: 'blur(0)', transform: 'none' }], 620, 90),
      anim(lineEl, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], 600, 200)
    ];
    return Promise.all(pIn);
  }
  // title-card dissolves out (reveals the page underneath)
  function animateOut() {
    var pOut = [
      anim(titleEl, [{ opacity: 1, filter: 'blur(0)', transform: 'none' }, { opacity: 0, filter: 'blur(10px)', transform: 'translateY(-16px) scale(1.03)' }], 460),
      anim(kickerEl, [{ opacity: 1 }, { opacity: 0 }], 300),
      anim(lineEl, [{ transform: 'scaleX(1)', opacity: 1 }, { transform: 'scaleX(0)', opacity: 0 }], 360),
      anim(overlay, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.03)' }], 540, 160)
    ];
    return Promise.all(pOut).then(function () { overlay.classList.remove('mfx-show'); });
  }
  // show the card already fully covering (for the reveal half after navigation)
  function showCovered(title, kicker) {
    setText(title, kicker);
    overlay.classList.add('mfx-show');
    overlay.style.opacity = '1';
    titleEl.style.opacity = '1'; titleEl.style.filter = 'blur(0)'; titleEl.style.transform = 'none';
    kickerEl.style.opacity = '1';
    lineEl.style.transform = 'scaleX(1)'; lineEl.style.opacity = '1';
  }

  // ===== Apple-style motion-graphics confirm sheet (MotionFX.ask) =====
  var ASK_STYLE = '' +
    '.mfx-ask{position:fixed;inset:0;z-index:2147483601;display:flex;align-items:center;justify-content:center;padding:20px;' +
    'background:rgba(8,6,16,.46);backdrop-filter:blur(9px) saturate(140%);-webkit-backdrop-filter:blur(9px) saturate(140%);opacity:0;pointer-events:none;transition:opacity .3s ease;}' +
    '.mfx-ask.mfx-ask-show{opacity:1;pointer-events:auto;}' +
    '.mfx-ask-card{width:min(344px,92vw);padding:26px 22px 16px;border-radius:30px;text-align:center;' +
    'background:linear-gradient(180deg,rgba(255,255,255,.94),rgba(247,247,251,.9));backdrop-filter:blur(34px) saturate(1.8);-webkit-backdrop-filter:blur(34px) saturate(1.8);' +
    'box-shadow:0 34px 80px -20px rgba(20,10,50,.55),inset 0 1px 0 rgba(255,255,255,.95);font-family:-apple-system,"SF Pro Display","Hiragino Sans",system-ui;}' +
    '.mfx-ask-icon{width:56px;height:56px;margin:2px auto 14px;border-radius:17px;display:flex;align-items:center;justify-content:center;' +
    'background:linear-gradient(180deg,#7a5cf5,#5b3df0);box-shadow:0 12px 26px -8px rgba(110,70,240,.6);}' +
    '.mfx-ask-icon svg{width:28px;height:28px;color:#fff;}' +
    '.mfx-ask-title{font:700 19px/1.3 -apple-system,"Hiragino Sans",system-ui;color:#15151b;letter-spacing:-.01em;}' +
    '.mfx-ask-msg{margin-top:6px;font:500 14px/1.5 -apple-system,"Hiragino Sans",system-ui;color:#7a7a86;}' +
    '.mfx-ask-actions{display:flex;flex-direction:column;gap:9px;margin-top:20px;}' +
    '.mfx-ask-btn{border:none;border-radius:15px;padding:14px;font:600 16px/1 -apple-system,"Hiragino Sans",system-ui;cursor:pointer;' +
    'background:rgba(120,110,240,.12);color:#5b3df0;transition:transform .12s ease,background .18s ease;-webkit-tap-highlight-color:transparent;}' +
    '.mfx-ask-btn:active{transform:scale(.96);}' +
    '.mfx-ask-btn.primary{background:linear-gradient(180deg,#7a5cf5,#5b3df0);color:#fff;box-shadow:0 12px 26px -10px rgba(110,70,240,.7);}' +
    '.mfx-ask-btn.destructive{color:#e0405e;background:rgba(224,64,94,.1);}' +
    '.mfx-ask-cancel{margin-top:12px;border:none;background:transparent;color:#9a9aa6;font:600 15px/1 -apple-system,system-ui;cursor:pointer;padding:8px;}' +
    '.mfx-ask-cancel:active{opacity:.6;}';
  var askOv, askCard, askIcon, askTitle, askMsg, askActions, askCancelBtn, _askStyled = false;
  function ensureAsk() {
    if (askOv) return;
    if (!_askStyled) { var s = document.createElement('style'); s.textContent = ASK_STYLE; document.head.appendChild(s); _askStyled = true; }
    askOv = document.createElement('div'); askOv.className = 'mfx-ask';
    askCard = document.createElement('div'); askCard.className = 'mfx-ask-card';
    askIcon = document.createElement('div'); askIcon.className = 'mfx-ask-icon';
    askIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>';
    askTitle = document.createElement('div'); askTitle.className = 'mfx-ask-title';
    askMsg = document.createElement('div'); askMsg.className = 'mfx-ask-msg';
    askActions = document.createElement('div'); askActions.className = 'mfx-ask-actions';
    askCancelBtn = document.createElement('button'); askCancelBtn.className = 'mfx-ask-cancel'; askCancelBtn.type = 'button';
    askCard.appendChild(askIcon); askCard.appendChild(askTitle); askCard.appendChild(askMsg); askCard.appendChild(askActions); askCard.appendChild(askCancelBtn);
    askOv.appendChild(askCard); document.body.appendChild(askOv);
  }
  function openAsk() {
    askOv.classList.add('mfx-ask-show');
    try { askCard.animate([{ opacity: 0, transform: 'translateY(18px) scale(.93)' }, { opacity: 1, transform: 'none' }], { duration: reduce ? 1 : 440, easing: 'cubic-bezier(.2,.9,.2,1.05)', fill: 'both' }); } catch (_) {}
    try { askIcon.animate([{ opacity: 0, transform: 'scale(.5)' }, { opacity: 1, transform: 'none' }], { duration: reduce ? 1 : 560, delay: reduce ? 0 : 90, easing: 'cubic-bezier(.2,.9,.2,1.2)', fill: 'both' }); } catch (_) {}
  }
  function closeAsk() {
    try { askCard.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(10px) scale(.97)' }], { duration: reduce ? 1 : 240, easing: 'ease', fill: 'both' }); } catch (_) {}
    setTimeout(function () { try { askOv.classList.remove('mfx-ask-show'); } catch (_) {} }, reduce ? 6 : 240);
  }
  function doAsk(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      ensureAsk();
      var done = false;
      function pick(k) { if (done) return; done = true; closeAsk(); resolve(k); }
      askTitle.textContent = opts.title || '';
      askMsg.textContent = opts.message || ''; askMsg.style.display = opts.message ? '' : 'none';
      askActions.innerHTML = '';
      (opts.actions || []).forEach(function (a) {
        var b = document.createElement('button'); b.type = 'button';
        b.className = 'mfx-ask-btn' + (a.kind === 'primary' ? ' primary' : '') + (a.kind === 'destructive' ? ' destructive' : '');
        b.textContent = a.label;
        b.onclick = function () { try { if (window.sfx) window.sfx.play(a.kind === 'primary' ? 'done' : 'navPop'); } catch (_) {} pick(a.key); };
        askActions.appendChild(b);
      });
      if (opts.cancel === false) { askCancelBtn.style.display = 'none'; }
      else { askCancelBtn.style.display = ''; askCancelBtn.textContent = opts.cancel || 'キャンセル'; askCancelBtn.onclick = function () { pick('cancel'); }; }
      askOv.onclick = function (e) { if (e.target === askOv) pick('cancel'); };
      try { if (window.sfx) window.sfx.play('navPush'); } catch (_) {}
      openAsk();
    });
  }

  var _busy = false;
  function forceClean() { try { ensure(); overlay.classList.remove('mfx-show'); } catch (_) {} }

  window.MotionFX = {
    cinematic: function (title, midFn, kicker) {
      // already transitioning → run the action immediately, skip a second overlapping animation
      if (_busy) { try { midFn && midFn(); } catch (_) {} return Promise.resolve(); }
      _busy = true;
      setText(title, kicker);
      // midFn (the swap/nav) and cleanup are GUARANTEED by independent timers, so a stalled
      // animation (background tab, odd renderer) can never drop the action or stick the overlay.
      var midDone = false, cleaned = false;
      var runMid  = function () { if (midDone) return; midDone = true; try { midFn && midFn(); } catch (_) {} };
      var cleanup = function () { if (cleaned) return; cleaned = true; _busy = false; forceClean(); };
      animateIn().then(function () { runMid(); return new Promise(function (r) { setTimeout(r, 160); }); }).then(animateOut).then(cleanup, cleanup);
      setTimeout(runMid,  reduce ? 0  : 760);    // safety: action by the visual peak
      setTimeout(cleanup, reduce ? 30 : 1700);   // safety: overlay always cleared
      return Promise.resolve();
    },
    enter: function (title, href, kicker) {
      try { sessionStorage.setItem('mfx_in', JSON.stringify({ title: title, kicker: kicker || 'Studio', t: Date.now() })); } catch (_) {}
      if (!_busy) { _busy = true; setText(title, kicker); animateIn(); }
      setTimeout(function () { location.href = href; }, reduce ? 0 : 470);
    },
    boot: function () {
      if (!document.body) { document.addEventListener('DOMContentLoaded', function () { try { window.MotionFX.boot(); } catch (_) {} }, { once: true }); return false; }
      var raw; try { raw = sessionStorage.getItem('mfx_in'); } catch (_) { raw = null; }
      if (!raw) return false;
      try { sessionStorage.removeItem('mfx_in'); } catch (_) {}
      var d; try { d = JSON.parse(raw); } catch (_) { return false; }
      if (!d || (Date.now() - d.t) > 3500) return false;
      _busy = true;
      ensure(); showCovered(d.title, d.kicker);
      var cleaned = false;
      var cleanup = function () { if (cleaned) return; cleaned = true; _busy = false; forceClean(); };
      requestAnimationFrame(function () { setTimeout(function () { animateOut().then(cleanup, cleanup); }, 140); });
      setTimeout(cleanup, reduce ? 40 : 1200);   // safety net
      return true;
    },
    ask: doAsk
  };
})();
