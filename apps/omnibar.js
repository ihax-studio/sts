/* =====================================================================
   omnibar.js — universal top action bar (Image #1)
   [↺ undo]  [ 🔄置換 · ⬇️保存 · 🗑️↑削除 · 🏠Home ]  [↻ redo]
   ONE shared module for the app composer, Document Studio and cinema.
   Appears on top-tap / sl-home-btn. Undo/redo snapshot the host's own
   localStorage string and restore it through the host's load path
   (here: write + reload — the most reliable path). Stacks live in
   sessionStorage so undo/redo survive the reload (multi-step).

   Host calls:  OmniBar.mount(adapter); then OmniBar.toggle()/show()/hide().
   adapter = { ns:'composer', snapshot()->string, restore(str),
               save(), del(), home(), replace()? }
   ===================================================================== */
(function () {
  if (window.OmniBar) return;

  var SKEY = 'omnibar:undo:', RKEY = 'omnibar:redo:', LKEY = 'omnibar:last:';
  var adapter = null, ns = 'default', bar = null, wrap = null, undoBtn = null, redoBtn = null, pollT = null;

  function getStack(k) { try { return JSON.parse(sessionStorage.getItem(k + ns) || '[]'); } catch (_) { return []; } }
  function setStack(k, v) { try { sessionStorage.setItem(k + ns, JSON.stringify(v.slice(-30))); } catch (_) {} }
  function setLast(s) { try { sessionStorage.setItem(LKEY + ns, s == null ? '' : s); } catch (_) {} }
  function getLast() { try { return sessionStorage.getItem(LKEY + ns); } catch (_) { return null; } }

  function snap() { try { return adapter.snapshot ? adapter.snapshot() : ''; } catch (_) { return ''; } }

  // poll for host edits → push onto the undo stack (debounced via interval)
  function record() {
    var cur = snap(), last = getLast();
    if (last == null) { setLast(cur); return; }
    if (cur !== last) {
      var u = getStack(SKEY); u.push(last); setStack(SKEY, u);
      setStack(RKEY, []);                 // a fresh edit invalidates redo
      setLast(cur); updateButtons();
    }
  }
  function hostManaged() { return !!(adapter && adapter.undo); }
  function undo() {
    if (hostManaged()) { buzz('tap'); try { adapter.undo(); } catch (_) {} updateButtons(); return; }
    var u = getStack(SKEY); if (!u.length) { buzz('error'); return; }
    var cur = snap(), r = getStack(RKEY); r.push(cur); setStack(RKEY, r);
    var prev = u.pop(); setStack(SKEY, u); setLast(prev);
    buzz('tap'); try { adapter.restore(prev); } catch (_) {}     // restore (reloads)
  }
  function redo() {
    if (hostManaged()) { buzz('tap'); try { adapter.redo(); } catch (_) {} updateButtons(); return; }
    var r = getStack(RKEY); if (!r.length) { buzz('error'); return; }
    var cur = snap(), u = getStack(SKEY); u.push(cur); setStack(SKEY, u);
    var nxt = r.pop(); setStack(RKEY, r); setLast(nxt);
    buzz('tap'); try { adapter.restore(nxt); } catch (_) {}
  }
  function updateButtons() {
    if (!undoBtn) return;
    var nu, nr;
    if (hostManaged()) { nu = adapter.canUndo ? !adapter.canUndo() : false; nr = adapter.canRedo ? !adapter.canRedo() : false; }
    else { nu = !getStack(SKEY).length; nr = !getStack(RKEY).length; }
    undoBtn.classList.toggle('ob-off', nu);
    redoBtn.classList.toggle('ob-off', nr);
  }
  function buzz(kind) {
    try {
      if (window.haptic) { var f = (kind === 'error' && haptic.error) ? haptic.error : (haptic.tap || haptic.selection || haptic); f(); }
      else if (window.triggerHaptic) window.triggerHaptic();
      else if (navigator.vibrate) navigator.vibrate(kind === 'error' ? 20 : 7);
    } catch (_) {}
  }

  function build() {
    if (bar) return;
    var st = document.createElement('style');
    st.textContent =
      // Dynamic-Island style: ONE floating frosted island, no separate background plates.
      // Entrance = slide (translateY) + scale pop — grows from the notch for a真の island feel.
      '.ob-wrap{position:fixed;top:max(env(safe-area-inset-top, 0px) + 8px, 14px);left:50%;transform:translateX(-50%) translateY(-16px) scale(.82);transform-origin:top center;' +
        'z-index:99995;opacity:0;pointer-events:none;transition:opacity .24s ease,transform .42s cubic-bezier(.2,.9,.2,1.05)}' +
      '.ob-wrap.show{opacity:1;pointer-events:auto;transform:translateX(-50%) translateY(0) scale(1)}' +
      '.ob-island{display:flex;align-items:center;gap:2px;padding:6px 8px;border-radius:999px;' +
        'background:rgba(248,248,250,.5);backdrop-filter:blur(30px) saturate(1.8);-webkit-backdrop-filter:blur(30px) saturate(1.8);' +
        'box-shadow:0 16px 38px -14px rgba(20,20,45,.4),inset 0 1px 0 rgba(255,255,255,.55),inset 0 0 0 1px rgba(255,255,255,.25)}' +
      '.ob-ic{width:52px;height:52px;border-radius:50%;border:none;background:none;cursor:pointer;display:grid;place-items:center;transition:transform .14s ease,opacity .2s}' +
      '.ob-ic:active{transform:scale(.85)}' +
      '.ob-ic img{width:27px;height:27px;object-fit:contain;pointer-events:none}' +
      '.ob-ic svg{width:26px;height:26px}' +
      '.ob-home{position:relative}' +
      '.ob-home::before{content:"";position:absolute;inset:5px;border-radius:50%;background:radial-gradient(circle at 38% 30%,#8f86ec,#6b5fe0 82%);box-shadow:0 4px 12px -3px rgba(107,95,224,.6)}' +
      '.ob-home svg{position:relative;color:#fff}' +
      '.ob-sep{width:1px;height:24px;background:rgba(0,0,0,.1);margin:0 3px;flex:0 0 auto}' +
      '.ob-off{opacity:.3;pointer-events:none}';
    document.head.appendChild(st);

    function imgIc(cls, label, src) {
      var b = document.createElement('button'); b.className = 'ob-ic ' + cls; b.type = 'button'; b.setAttribute('aria-label', label);
      var im = document.createElement('img'); im.src = src; im.alt = label; im.draggable = false; b.appendChild(im); return b;
    }
    function sep() { var s = document.createElement('div'); s.className = 'ob-sep'; return s; }
    var homeSvg = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3.2L3.5 10.5c-.3.27-.5.66-.5 1.06V20a1 1 0 0 0 1 1h5v-6h6v6h5a1 1 0 0 0 1-1v-8.44c0-.4-.18-.79-.5-1.06z"/></svg>';

    wrap = document.createElement('div'); wrap.className = 'ob-wrap'; wrap.setAttribute('aria-hidden', 'true');
    var island = document.createElement('div'); island.className = 'ob-island';
    // svg→png: use the imported PNG glyphs (Image #1)
    undoBtn = imgIc('ob-undo', '一つ前', 'back.png');
    redoBtn = imgIc('ob-redo', '一つ後', 'neeee.png');
    var bRep = imgIc('ob-rep', '変換', 'rotate.png');
    var bSave = imgIc('ob-save', '保存', 'save.png');
    var bDel = imgIc('ob-del', '削除', 'arrow.up.trash.png');
    var bHome = document.createElement('button'); bHome.className = 'ob-ic ob-home'; bHome.type = 'button'; bHome.setAttribute('aria-label', 'ホーム'); bHome.innerHTML = homeSvg;
    island.appendChild(undoBtn); island.appendChild(sep());
    island.appendChild(bRep); island.appendChild(bSave); island.appendChild(bDel); island.appendChild(bHome);
    island.appendChild(sep()); island.appendChild(redoBtn);
    wrap.appendChild(island);
    document.body.appendChild(wrap);
    bar = wrap;

    undoBtn.addEventListener('click', undo);
    redoBtn.addEventListener('click', redo);
    // rotate.png = メディアタイプ変換 Island を開く（今までの bar の rotate.png をそのまま流用）
    bRep.addEventListener('click', function () {
      buzz('tap');
      hide();                                            // OmniBar を畳んでから（同じ上中央位置に）Island を出す
      if (window.NativeChange) { NativeChange.open(); return; }
      try { adapter.replace && adapter.replace(); } catch (_) {}   // 後方互換: NativeChange 未読込なら従来の置換
    });
    bSave.addEventListener('click', function () { buzz('tap'); try { adapter.save && adapter.save(); } catch (_) {} flash(bSave); });
    bDel.addEventListener('click', function () { buzz('tap'); try { adapter.del && adapter.del(); } catch (_) {} });
    bHome.addEventListener('click', function () { buzz('tap'); try { adapter.home && adapter.home(); } catch (_) {} });

    // tap outside / Esc closes
    document.addEventListener('pointerdown', function (e) {
      if (wrap.classList.contains('show') && !e.target.closest('.ob-wrap') && !e.target.closest('.sl-home-btn')) hide();
    }, true);
    window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && wrap.classList.contains('show')) hide(); });
  }
  function flash(btn) { btn.style.transform = 'scale(1.18)'; setTimeout(function () { btn.style.transform = ''; }, 160); }

  function mount(a) {
    adapter = a; ns = (a && a.ns) || 'default'; build();
    if (!hostManaged() && getLast() == null) setLast(snap());
    clearInterval(pollT);
    pollT = setInterval(function () { if (!hostManaged()) record(); updateButtons(); }, 1200);
    updateButtons();
  }
  function show() {
    if (!bar) return;
    // Flush the host's edits so the snapshot captures the latest add, then checkpoint it —
    // this is what makes 一つ前(undo) able to take back something you just added.
    try { if (!hostManaged() && adapter && adapter.save) adapter.save(); } catch (_) {}
    record(); updateButtons();
    wrap.classList.add('show'); wrap.setAttribute('aria-hidden', 'false'); buzz('tap');
  }
  function hide() { if (!bar) return; wrap.classList.remove('show'); wrap.setAttribute('aria-hidden', 'true'); }
  function toggle() { if (!bar) return; wrap.classList.contains('show') ? hide() : show(); }

  window.OmniBar = { mount: mount, show: show, hide: hide, toggle: toggle, _undo: undo, _redo: redo };
})();
