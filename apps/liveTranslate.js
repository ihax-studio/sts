/* =====================================================================
   liveTranslate.js — Live-translation suggestion bar (Image #18)
   ONE shared module for the app composer AND Document Studio.
   When the user types in a language different from the selected one,
   a glass capsule floats under the line: [source flag][target flag]
   translated-text  [A文 insert]. Flags re-open the terrakoku globe to
   re-aim source/target (without changing the doc language). The A文
   button replaces the typed text with the translation (reversible).

   Hosts call:  LiveTranslateBar.mount(adapter)  once,
                LiveTranslateBar.scan({text, anchorEl, blockKey}) on input,
                LiveTranslateBar.consume(msg)  at the top of their terrakoku
                  'message' listener (returns true → skip normal pick),
                LiveTranslateBar.hide().
   adapter = { getTarget(), translateFn(text,from,to)->Promise<string>,
               openGlobe(), closeGlobe(), applyInsert(state)->oldValue|null,
               revert(state, old) }
   ===================================================================== */
(function () {
  if (window.LiveTranslateBar) return;

  var IDLE_MS = 700, MIN_CHARS = 4, DOMINANCE = 0.55, UNDO_MS = 4000, CACHE_MAX = 40;

  var FLAG = { ja:'🇯🇵', en:'🇺🇸', zh:'🇨🇳', ko:'🇰🇷', es:'🇪🇸', fr:'🇫🇷', de:'🇩🇪',
    it:'🇮🇹', pt:'🇵🇹', ru:'🇷🇺', ar:'🇸🇦', hi:'🇮🇳', th:'🇹🇭', vi:'🇻🇳', el:'🇬🇷',
    uk:'🇺🇦', fa:'🇮🇷', nl:'🇳🇱', pl:'🇵🇱', tr:'🇹🇷', sv:'🇸🇪', no:'🇳🇴', fi:'🇫🇮',
    id:'🇮🇩', is:'🇮🇸' };
  var RTL = { ar:1, fa:1 };

  /* ---------- language detection (dependency-free Unicode heuristic) ---------- */
  function detectScript(text) {
    var t = (text || '').replace(/[\s\d]/g, '')
      .replace(/[!-/:-@[-`{-~　-〿＀-￯]/g, '');
    if (t.length < MIN_CHARS) return null;
    var b = { latin:0, cyrillic:0, arabic:0, deva:0, thai:0, greek:0, hangul:0, hira:0, kata:0, han:0 };
    for (var i = 0; i < t.length; i++) {
      var c = t.charCodeAt(i);
      if ((c>=0x41&&c<=0x5A)||(c>=0x61&&c<=0x7A)||(c>=0xC0&&c<=0x24F)) b.latin++;
      else if (c>=0x400&&c<=0x4FF) b.cyrillic++;
      else if (c>=0x600&&c<=0x6FF) b.arabic++;
      else if (c>=0x900&&c<=0x97F) b.deva++;
      else if (c>=0xE00&&c<=0xE7F) b.thai++;
      else if (c>=0x370&&c<=0x3FF) b.greek++;
      else if ((c>=0xAC00&&c<=0xD7AF)||(c>=0x1100&&c<=0x11FF)) b.hangul++;
      else if (c>=0x3040&&c<=0x309F) b.hira++;
      else if (c>=0x30A0&&c<=0x30FF) b.kata++;
      else if ((c>=0x4E00&&c<=0x9FFF)||(c>=0x3400&&c<=0x4DBF)) b.han++;
    }
    var total = t.length;
    // any kana → it's Japanese (group kana+kanji as one family)
    if ((b.hira + b.kata) > 0 && (b.hira + b.kata + b.han) / total >= DOMINANCE) return 'jpkana';
    var best = null, bn = 0;
    for (var k in b) { if (b[k] > bn) { bn = b[k]; best = k; } }
    if (!best || bn / total < DOMINANCE) return null;
    return best;
  }
  function scriptToCode(script, target) {
    switch (script) {
      case 'latin': return 'en';
      case 'cyrillic': return 'ru';
      case 'arabic': return 'ar';
      case 'deva': return 'hi';
      case 'thai': return 'th';
      case 'greek': return 'el';
      case 'hangul': return 'ko';
      case 'hira': case 'kata': case 'jpkana': return 'ja';
      case 'han': return (target === 'zh' || target === 'ko') ? target : 'ja';
      default: return null;
    }
  }

  /* ---------- the glass capsule ---------- */
  var bar, flagsEl, fromFlag, toFlag, textEl, goEl, goImg;
  function buildBar() {
    if (bar) return;
    var st = document.createElement('style');
    st.textContent =
      '.lt-bar{position:fixed;z-index:99990;display:flex;align-items:center;gap:12px;max-width:min(560px,92vw);' +
        'background:rgba(255,255,255,.97);border-radius:999px;padding:8px 12px 8px 10px;' +
        'box-shadow:0 0 0 1px rgba(255,255,255,.7),0 18px 44px -14px rgba(120,60,200,.45),0 0 34px rgba(190,90,230,.42),0 0 64px rgba(120,140,255,.3);' +
        'backdrop-filter:blur(16px) saturate(1.5);-webkit-backdrop-filter:blur(16px) saturate(1.5);' +
        'opacity:0;transform:translateY(8px) scale(.96);pointer-events:none;' +
        'transition:opacity .26s ease,transform .26s cubic-bezier(.16,1,.3,1)}' +
      '.lt-bar.show{opacity:1;transform:none;pointer-events:auto;animation:ltGlow 2.6s ease-in-out infinite}' +
      '@keyframes ltGlow{0%,100%{box-shadow:0 0 0 1px rgba(255,255,255,.7),0 18px 44px -14px rgba(120,60,200,.45),0 0 30px rgba(190,90,230,.36),0 0 56px rgba(120,140,255,.26)}' +
        '50%{box-shadow:0 0 0 1px rgba(255,255,255,.7),0 18px 44px -14px rgba(120,60,200,.5),0 0 42px rgba(190,90,230,.5),0 0 76px rgba(120,140,255,.38)}}' +
      '.lt-flags{display:flex;align-items:center;flex:0 0 auto}' +
      '.lt-flag{width:36px;height:36px;border-radius:50%;background:#fff;display:grid;place-items:center;font-size:19px;cursor:pointer;' +
        'border:none;box-shadow:0 3px 10px rgba(0,0,0,.18);transition:transform .15s cubic-bezier(.34,1.56,.64,1)}' +
      '.lt-flag:active{transform:scale(.88)}' +
      '.lt-flag.to{margin-left:0}' +
      '.lt-text{flex:1 1 auto;min-width:90px;font:700 16px/1.35 -apple-system,"Hiragino Sans",system-ui;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' +
        'background:linear-gradient(90deg,#19c2ff,#a14bff 55%,#ff3db0);-webkit-background-clip:text;background-clip:text;color:transparent}' +
      '.lt-text.muted{background:none;color:#9a9aa6;-webkit-text-fill-color:#9a9aa6}' +
      '.lt-text.shim{opacity:.5;animation:ltShim 1s ease-in-out infinite}' +
      '@keyframes ltShim{0%,100%{opacity:.4}50%{opacity:.85}}' +
      '.lt-go{flex:0 0 auto;width:42px;height:42px;border-radius:50%;cursor:pointer;display:grid;place-items:center;' +
        'background:#fff;border:1px solid #fff;box-shadow:0 3px 12px -2px rgba(0,0,0,.22),inset 0 0 0 1px rgba(0,0,0,.06);' +
        'color:#5a4ad0;font:800 13px/1 -apple-system,system-ui;transition:transform .15s ease,filter .2s}' +
      '.lt-go:active{transform:scale(.9)}' +
      '.lt-go img{width:22px;height:22px;object-fit:contain;pointer-events:none}' +
      '.lt-go.disabled{filter:grayscale(1) opacity(.45);pointer-events:none}' +
      '.lt-bar.lt-rtl{flex-direction:row-reverse}';
    document.head.appendChild(st);

    bar = document.createElement('div'); bar.className = 'lt-bar'; bar.setAttribute('aria-hidden', 'true');
    flagsEl = document.createElement('div'); flagsEl.className = 'lt-flags';
    fromFlag = document.createElement('button'); fromFlag.type = 'button'; fromFlag.className = 'lt-flag from'; fromFlag.setAttribute('aria-label', '元の言語');
    toFlag = document.createElement('button'); toFlag.type = 'button'; toFlag.className = 'lt-flag to'; toFlag.setAttribute('aria-label', '翻訳後の言語');
    flagsEl.appendChild(toFlag);   // 検出は自動 → 言語アイコンは翻訳先のみ1つ
    textEl = document.createElement('div'); textEl.className = 'lt-text';
    goEl = document.createElement('button'); goEl.type = 'button'; goEl.className = 'lt-go'; goEl.setAttribute('aria-label', '翻訳を挿入');
    goImg = document.createElement('img'); goImg.src = 'trans.png'; goImg.alt = '翻訳';
    goImg.onerror = function () { goImg.style.display = 'none'; goEl.textContent = 'A文'; };
    goEl.appendChild(goImg);
    bar.appendChild(flagsEl); bar.appendChild(textEl); bar.appendChild(goEl);
    document.body.appendChild(bar);

    fromFlag.addEventListener('click', function () { repick('from'); });
    toFlag.addEventListener('click', function () { repick('to'); });
    goEl.addEventListener('click', onGo);
  }

  /* ---------- state + translation ---------- */
  var adapter = null, cur = null, _seq = 0, _pendingSlot = null, _idleT = null, lastTypedAt = 0;
  var cache = new Map(), inflight = new Map();

  function mount(a) { adapter = a; buildBar(); }

  function scan(ctx) {
    if (!adapter) return;
    lastTypedAt = Date.now();
    clearTimeout(_idleT);
    _idleT = setTimeout(function () { runDetect(ctx); }, IDLE_MS);
  }

  function runDetect(ctx) {
    try {
      var text = (ctx && ctx.text || '').trim();
      var target = (adapter.getTarget && adapter.getTarget()) || 'ja';
      var script = detectScript(text);
      var from = script ? scriptToCode(script, target) : null;
      if (!from || from === target) { hide(); return; }
      // don't re-pop something the user just accepted/dismissed for this block
      var el = ctx && ctx.anchorEl;
      if (el && el.__ltDismissed === text) { hide(); return; }
      cur = { from: from, to: target, srcText: text, anchorEl: el, blockKey: (ctx && ctx.blockKey) || '', translated: '' };
      refreshBar();
    } catch (_) { hide(); }
  }

  function setFlag(elFlag, code) { elFlag.textContent = FLAG[code] || '🌐'; }

  function refreshBar() {
    if (!cur) return;
    setFlag(fromFlag, cur.from); setFlag(toFlag, cur.to);
    bar.classList.toggle('lt-rtl', !!RTL[cur.to]);
    position();
    bar.classList.add('show'); bar.setAttribute('aria-hidden', 'false');
    goEl.classList.remove('disabled'); resetGo();
    if (!navigator.onLine) {
      textEl.className = 'lt-text muted'; textEl.textContent = '📴 オフライン';
      goEl.classList.add('disabled'); return;
    }
    var key = cur.from + '|' + cur.to + '|' + cur.srcText.replace(/\s+/g, ' ');
    if (cache.has(key)) { fill(cache.get(key)); return; }
    textEl.className = 'lt-text shim'; textEl.textContent = cur.srcText;
    var seq = ++_seq;
    translateCached(key, cur.srcText, cur.from, cur.to).then(function (tr) {
      if (seq !== _seq || !cur) return;             // stale (kept typing / re-picked)
      fill(tr);
    }).catch(function () {
      if (seq !== _seq) return;
      textEl.className = 'lt-text muted'; textEl.textContent = '翻訳できません'; goEl.classList.add('disabled');
    });
  }
  function fill(tr) {
    if (!cur) return;
    if (!tr || tr.trim() === cur.srcText.trim()) {
      textEl.className = 'lt-text muted'; textEl.textContent = '翻訳できません'; goEl.classList.add('disabled'); return;
    }
    cur.translated = tr;
    textEl.className = 'lt-text'; textEl.textContent = tr; goEl.classList.remove('disabled');
  }
  function translateCached(key, text, from, to) {
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    if (inflight.has(key)) return inflight.get(key);
    var p = Promise.resolve(adapter.translateFn(text, from, to)).then(function (tr) {
      tr = tr || text;
      cache.set(key, tr);
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);   // FIFO evict
      inflight.delete(key); return tr;
    }).catch(function (e) { inflight.delete(key); throw e; });
    inflight.set(key, p); return p;
  }

  /* ---------- positioning (below the anchor line, clamped) ---------- */
  function position() {
    var r = adapter.anchorFor && adapter.anchorFor(cur);
    var bw = bar.offsetWidth || 320, bh = bar.offsetHeight || 56;
    var left, top;
    if (r && (r.width || r.height || r.top)) {
      left = r.left + r.width / 2 - bw / 2;
      top = r.bottom + 10;
      if (top + bh > window.innerHeight - 8) top = r.top - bh - 10;
    } else {
      left = window.innerWidth / 2 - bw / 2;
      top = window.innerHeight - bh - (90);
    }
    left = Math.max(8, Math.min(left, window.innerWidth - bw - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - bh - 8));
    bar.style.left = left + 'px'; bar.style.top = top + 'px';
  }

  /* ---------- re-pick a flag via the terrakoku globe ---------- */
  function repick(slot) {
    if (!cur || !adapter.openGlobe) return;
    _pendingSlot = slot;
    bar.style.pointerEvents = 'none';
    adapter.openGlobe();
  }
  // host calls this at the TOP of its terrakoku 'message' listener
  function consume(msg) {
    if (!_pendingSlot || !msg || msg.type !== 'terrakoku-lang' || !msg.lang) return false;
    var code = String(msg.lang).toLowerCase();
    if (cur) {
      if (_pendingSlot === 'from') cur.from = code; else cur.to = code;
      setFlag(fromFlag, cur.from); setFlag(toFlag, cur.to);
    }
    _pendingSlot = null;
    bar.style.pointerEvents = '';
    try { adapter.closeGlobe && adapter.closeGlobe(); } catch (_) {}
    refreshBar();
    return true;   // host SKIPS its normal pickLang/addLanguage for this event
  }

  /* ---------- insert (replace typed text with translation) + undo ---------- */
  var _undoT = null, _lastOld = null;
  function resetGo() {
    clearTimeout(_undoT); _lastOld = null;
    goEl.classList.remove('lt-undo');
    if (goImg && goImg.style.display !== 'none') goImg.style.display = '';
    goEl.removeAttribute('data-undo');
  }
  function onGo() {
    if (!cur || !cur.translated || !adapter.applyInsert) return;
    if (goEl.getAttribute('data-undo') === '1') {                 // currently an undo button
      try { adapter.revert && adapter.revert(cur, _lastOld); } catch (_) {}
      resetGo(); refreshBar(); return;
    }
    var old = null;
    try { old = adapter.applyInsert(cur); } catch (_) {}
    if (cur.anchorEl) cur.anchorEl.__ltDismissed = cur.translated;  // don't re-pop the accepted result
    _lastOld = old;
    // morph A文 → ↩︎ 元に戻す for UNDO_MS
    goEl.setAttribute('data-undo', '1');
    if (goImg) goImg.style.display = 'none';
    goEl.textContent = '↩︎'; goEl.appendChild(goImg);
    clearTimeout(_undoT);
    _undoT = setTimeout(function () { resetGo(); hide(); }, UNDO_MS);
  }

  function hide() { if (bar) { bar.classList.remove('show'); bar.setAttribute('aria-hidden', 'true'); } }

  window.LiveTranslateBar = { mount: mount, scan: scan, consume: consume, hide: hide, _detect: detectScript };
})();
