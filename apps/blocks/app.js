/* =====================================================
   Story Dock — Visual Blocks  (app.js)
   - state / render / drag / popover / codegen / runner / validator / store
   ===================================================== */
(() => {
  const { CATEGORIES, BLOCKS } = window.STORYDOCK_CATALOG;
  const BLOCK_BY_ID = Object.fromEntries(BLOCKS.map(b => [b.id, b]));
  const CAT_BY_ID = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));

  // ---------- state ----------
  const STATE = {
    lang: 'js',
    program: [],         // [node, ...]
    selectedId: null,
    paletteCat: null,    // active category filter
    paletteQuery: '',
    iTab: 'code',
    issues: [],
    vars: [],            // {name, source}
    nextId: 1,
  };

  function newNode(blockId, overrides = {}) {
    const def = BLOCK_BY_ID[blockId];
    if (!def) throw new Error('unknown block: ' + blockId);
    const params = {};
    for (const p of def.params || []) params[p.key] = (overrides.params?.[p.key] ?? p.default ?? '');
    const slots = {};
    for (const s of def.slots || []) slots[s.key] = overrides.slots?.[s.key] ?? [];
    return { uid: 'n' + (STATE.nextId++), blockId, params, slots };
  }

  // ---------- helpers ----------
  function el(tag, attrs = {}, children = []) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v;
      else if (k === 'dataset') for (const [dk, dv] of Object.entries(v)) e.dataset[dk] = dv;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'html') e.innerHTML = v;
      else if (v === true) e.setAttribute(k, '');
      else if (v !== false && v != null) e.setAttribute(k, v);
    }
    for (const c of [].concat(children)) {
      if (c == null || c === false) continue;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return e;
  }

  function find(uid, list = STATE.program, parent = null, parentSlot = null) {
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (n.uid === uid) return { node: n, parent, parentSlot, parentList: list, index: i };
      const def = BLOCK_BY_ID[n.blockId];
      for (const s of def.slots || []) {
        const hit = find(uid, n.slots[s.key], n, s.key);
        if (hit) return hit;
      }
    }
    return null;
  }

  function walk(fn, list = STATE.program) {
    for (const n of list) {
      fn(n);
      const def = BLOCK_BY_ID[n.blockId];
      for (const s of def.slots || []) walk(fn, n.slots[s.key]);
    }
  }

  // ---------- palette ----------
  const palCats = document.getElementById('palette-cats');
  const palList = document.getElementById('palette-list');
  const palSearch = document.getElementById('palette-search');

  function renderPalette() {
    palCats.innerHTML = '';
    // clear-all blocks (left of "すべて")
    const clearAllBtn = el('button', {
      class: 'cat-clear', title: 'キャンバスを全消去', 'aria-label': 'キャンバスを全消去',
      onclick: () => {
        if (!STATE.program.length) return;
        if (!confirm('全部消す？')) return;
        STATE.program = []; STATE.selectedId = null;
        renderStack(); renderCode(); validate(); persist();
        try { window.haptic?.error?.(); } catch {}
      },
    }, '⌫');
    palCats.appendChild(clearAllBtn);
    palCats.appendChild(catPill('all', 'すべて'));
    for (const c of CATEGORIES) palCats.appendChild(catPill(c.id, c.label, c.tone));

    const q = STATE.paletteQuery.trim().toLowerCase();
    const cat = STATE.paletteCat;
    palList.innerHTML = '';
    for (const b of BLOCKS) {
      if (cat && cat !== 'all' && b.cat !== cat) continue;
      if (q && !(b.label.toLowerCase().includes(q) || b.id.includes(q))) continue;
      palList.appendChild(paletteItem(b));
    }
  }
  function catPill(id, label, tone) {
    const p = el('button', {
      class: 'cat-pill' + ((STATE.paletteCat || 'all') === id ? ' is-on' : ''),
      onclick: () => { STATE.paletteCat = id === 'all' ? null : id; renderPalette(); },
    }, label);
    if (tone) p.classList.add(tone);
    return p;
  }
  function paletteItem(b) {
    const cat = CAT_BY_ID[b.cat];
    return el('button', {
      class: 'palette-item ' + (cat?.tone || ''),
      title: b.label,
      dataset: { bid: b.id, tone: cat?.tone || '' },
      onclick: () => addToProgram(b.id),
    }, [
      el('span', { class: 'palette-item__icon' }, b.icon || '▢'),
      el('span', {}, [
        el('div', { class: 'palette-item__label' }, b.label.replace(/<[^>]+>/g, '…')),
        el('div', { class: 'palette-item__hint' }, cat?.label || ''),
      ]),
    ]);
  }

  palSearch.addEventListener('input', () => {
    STATE.paletteQuery = palSearch.value;
    renderPalette();
  });

  const recentlyAdded = new Set();
  function addToProgram(blockId, parentUid = null, slotKey = null) {
    const node = newNode(blockId);
    if (parentUid) {
      const hit = find(parentUid);
      if (hit) {
        hit.node.slots[slotKey] = (hit.node.slots[slotKey] || []).concat(node);
      }
    } else {
      STATE.program.push(node);
    }
    STATE.selectedId = node.uid;
    recentlyAdded.add(node.uid);
    renderStack(); renderCode(); validate(); persist();
  }

  // ---------- stack (canvas) ----------
  const stackEl = document.getElementById('stack');
  const emptyEl = document.getElementById('canvas-empty');

  function renderStack() {
    stackEl.innerHTML = '';
    if (!STATE.program.length) {
      emptyEl.classList.remove('is-hidden');
    } else {
      emptyEl.classList.add('is-hidden');
    }
    for (const n of STATE.program) stackEl.appendChild(stackBlock(n));
  }

  function stackBlock(node) {
    const def = BLOCK_BY_ID[node.blockId];
    const cat = CAT_BY_ID[def.cat];
    const isNew = recentlyAdded.has(node.uid);
    const li = el('li', {
      class: 'stack-block ' + (cat?.tone || '')
        + (STATE.selectedId === node.uid ? ' is-selected' : '')
        + (isNew ? ' is-entering' : ''),
      dataset: { uid: node.uid, bid: node.blockId, tone: cat?.tone || '' },
      onclick: (e) => { e.stopPropagation(); STATE.selectedId = node.uid; renderStack(); },
    }, [
      el('span', { class: 'stack-block__icon' }, def.icon || '▢'),
      blockBody(node, def),
      el('span', { class: 'stack-block__act' }, [
        el('button', { class: 'iconbtn', title:'上へ', onclick:(e)=>{ e.stopPropagation(); moveNode(node.uid,-1); } }, '▲'),
        el('button', { class: 'iconbtn', title:'下へ', onclick:(e)=>{ e.stopPropagation(); moveNode(node.uid,+1); } }, '▼'),
        el('button', { class: 'iconbtn', title:'削除', onclick:(e)=>{ e.stopPropagation(); removeNode(node.uid); } }, '⌫'),
      ]),
    ]);
    // slots
    for (const s of def.slots || []) {
      const slotEl = el('div', {
        class: 'slot',
        dataset: { slotKey: s.key, parentUid: node.uid },
      }, [ el('div', { class: 'slot__label' }, s.label) ]);
      for (const child of node.slots[s.key]) slotEl.appendChild(stackBlock(child));
      slotEl.appendChild(el('button', {
        class: 'slot__drop',
        onclick: (e) => { e.stopPropagation(); openAddPopover(e.currentTarget, node.uid, s.key); },
      }, '+ ブロック追加'));
      li.appendChild(slotEl);
    }
    if (isNew) {
      requestAnimationFrame(() => requestAnimationFrame(() => li.classList.remove('is-entering')));
      recentlyAdded.delete(node.uid);
    }
    return li;
  }

  function blockBody(node, def) {
    // tokenize label with <param-key> placeholders
    const wrap = el('span', { class: 'stack-block__body' });
    const tokens = def.label.split(/(<[^>]+>)/);
    for (const t of tokens) {
      if (/^<.+>$/.test(t)) {
        const key = t.slice(1, -1);
        const p = (def.params || []).find(pp => pp.key === key);
        if (!p) { wrap.appendChild(document.createTextNode(t)); continue; }
        const val = node.params[key];
        wrap.appendChild(paramChip(node, p, val));
      } else if (t.trim()) {
        wrap.appendChild(el('span', { class: 'stack-block__label' }, t));
      }
    }
    return wrap;
  }

  function paramChip(node, p, val) {
    const isEmpty = (val === '' || val == null);
    let cls = 'chip';
    if (p.kind === 'var' || (typeof val === 'string' && /^[a-zA-Z_]\w*$/.test(val) && p.kind!=='select')) cls += ' chip--var';
    if (p.kind === 'text') cls += ' chip--str';
    if (p.kind === 'select' && (val === 'true' || val === 'false')) cls += ' chip--bool';
    if (p.kind === 'expr' && /^-?\d+(\.\d+)?$/.test(String(val||''))) cls += ' chip--num';
    const c = el('span', {
      class: cls,
      dataset: { empty: isEmpty ? '1' : '0', key: p.key },
      onclick: (e) => { e.stopPropagation(); openParamPopover(e.currentTarget, node.uid, p.key); },
      title: p.placeholder || p.key,
    }, isEmpty ? (p.placeholder || p.key) : String(val));
    return c;
  }

  function moveNode(uid, dir) {
    const hit = find(uid);
    if (!hit) return;
    const list = hit.parentList;
    const i = hit.index;
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    renderStack(); renderCode(); validate(); persist();
  }
  function removeNode(uid) {
    const liEl = stackEl.querySelector(`.stack-block[data-uid="${uid}"]`);
    const commit = () => {
      const hit = find(uid);
      if (!hit) return;
      hit.parentList.splice(hit.index, 1);
      if (STATE.selectedId === uid) STATE.selectedId = null;
      renderStack(); renderCode(); validate(); persist();
    };
    if (liEl) {
      liEl.classList.add('is-exiting');
      setTimeout(commit, 500);
    } else commit();
  }

  // ---------- pointer-event drag (touch + mouse + pen) ----------
  const canvasEl = document.getElementById('canvas');
  const DRAG_THRESHOLD = 8;
  const drag = {
    pending: null,        // { kind, payload, label, tone, sourceEl }
    active: false,
    pointerId: null,
    startX: 0, startY: 0,
    offsetX: 0, offsetY: 0,
    ghost: null,
    sourceEl: null,
    autoScrollT: null,
    lastClientY: 0,
  };

  function clearDropTargets() {
    document.querySelectorAll(
      '.drop-target, .drop-target--top, .drop-target--bottom'
    ).forEach(e => e.classList.remove('drop-target','drop-target--top','drop-target--bottom'));
  }

  function containsUid(node, uid) {
    if (!node) return false;
    if (node.uid === uid) return true;
    for (const s of BLOCK_BY_ID[node.blockId].slots || []) {
      for (const child of node.slots[s.key]) if (containsUid(child, uid)) return true;
    }
    return false;
  }

  function pickInsertionAt(x, y) {
    const ghost = drag.ghost;
    if (ghost) ghost.style.visibility = 'hidden';
    const under = document.elementFromPoint(x, y);
    if (ghost) ghost.style.visibility = '';
    if (!under) return null;
    const block = under.closest('.stack-block');
    const slot  = under.closest('.slot');
    const drop  = under.closest('.slot__drop');
    if (drop) {
      const slotOfDrop = drop.closest('.slot');
      return { type:'slot', parentUid: slotOfDrop?.dataset.parentUid, slotKey: slotOfDrop?.dataset.slotKey, el: drop };
    }
    if (block && stackEl.contains(block)) {
      const r = block.getBoundingClientRect();
      const before = y < r.top + r.height / 2;
      return { type:'beside', uid: block.dataset.uid, before, el: block };
    }
    if (slot) return { type:'slot', parentUid: slot.dataset.parentUid, slotKey: slot.dataset.slotKey, el: slot };
    if (canvasEl.contains(under)) return { type:'append', el: stackEl };
    return null;
  }

  function markDropTarget(ins) {
    if (!ins) return;
    if (ins.type === 'beside') ins.el.classList.add('drop-target', ins.before ? 'drop-target--top' : 'drop-target--bottom');
    else ins.el.classList.add('drop-target');
  }

  function makeGhost(label, tone) {
    const g = el('div', { class: 'drag-ghost ' + (tone || '') }, label);
    document.body.appendChild(g);
    return g;
  }

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (drag.pending || drag.active) return;
    if (e.target.closest('.iconbtn, .slot__drop, input, textarea, select')) return;

    const item = e.target.closest('.palette-item, .stack-block');
    if (!item) return;
    if (item.closest('.popover')) return;

    let pending;
    if (item.classList.contains('palette-item')) {
      const bid = item.dataset.bid;
      const def = BLOCK_BY_ID[bid]; if (!def) return;
      pending = {
        kind: 'add', payload: bid,
        label: def.label.replace(/<[^>]+>/g, '…'),
        tone: item.dataset.tone || '',
        sourceEl: item,
      };
    } else {
      const uid = item.dataset.uid;
      const def = BLOCK_BY_ID[item.dataset.bid]; if (!def) return;
      pending = {
        kind: 'move', payload: uid,
        label: def.label.replace(/<[^>]+>/g, '…'),
        tone: item.dataset.tone || '',
        sourceEl: item,
      };
    }
    drag.pending = pending;
    drag.startX = e.clientX;
    drag.startY = e.clientY;
    drag.pointerId = e.pointerId;
    drag.sourceEl = item;
    try { item.setPointerCapture(e.pointerId); } catch {}
    item.addEventListener('pointermove', onPointerMove);
    item.addEventListener('pointerup', onPointerUp);
    item.addEventListener('pointercancel', onPointerUp);
  }

  function onPointerMove(e) {
    if (!drag.pending && !drag.active) return;
    drag.lastClientY = e.clientY;
    if (!drag.active) {
      const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      beginDrag(e);
    }
    if (drag.ghost) {
      drag.ghost.style.transform =
        `translate(${e.clientX - drag.offsetX}px, ${e.clientY - drag.offsetY}px) scale(1.04)`;
    }
    clearDropTargets();
    const ins = pickInsertionAt(e.clientX, e.clientY);
    markDropTarget(ins);
    scheduleAutoScroll();
    e.preventDefault();
  }

  function beginDrag(e) {
    const p = drag.pending;
    drag.active = true;
    drag.ghost = makeGhost(p.label, p.tone);
    const gr = drag.ghost.getBoundingClientRect();
    drag.offsetX = Math.min(gr.width / 2, 80);
    drag.offsetY = gr.height / 2;
    if (p.kind === 'move') p.sourceEl.classList.add('is-dragging');
    document.body.classList.add('is-dragging-anywhere');
    try { window.haptic?.(); } catch {}
  }

  function onPointerUp(e) {
    const item = drag.sourceEl;
    if (item) {
      item.removeEventListener('pointermove', onPointerMove);
      item.removeEventListener('pointerup', onPointerUp);
      item.removeEventListener('pointercancel', onPointerUp);
      try { item.releasePointerCapture(drag.pointerId); } catch {}
    }
    stopAutoScroll();
    if (!drag.active) {
      drag.pending = null; drag.sourceEl = null;
      return;
    }
    const ins = pickInsertionAt(e.clientX, e.clientY);
    clearDropTargets();
    if (ins) {
      if (drag.pending.kind === 'add') addAtInsertion(drag.pending.payload, ins);
      else moveAtInsertion(drag.pending.payload, ins);
      try { window.haptic?.confirm?.(); } catch {}
    }
    if (drag.ghost) drag.ghost.remove();
    if (item) item.classList.remove('is-dragging');
    document.body.classList.remove('is-dragging-anywhere');
    drag.ghost = null;
    drag.active = false;
    drag.pending = null;
    drag.sourceEl = null;
    drag.pointerId = null;
    // suppress the synthetic click after drag
    const suppress = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
    document.addEventListener('click', suppress, { capture: true, once: true });
  }

  function scheduleAutoScroll() {
    if (drag.autoScrollT) return;
    const tick = () => {
      drag.autoScrollT = null;
      if (!drag.active) return;
      const r = canvasEl.getBoundingClientRect();
      const EDGE = 60;
      const y = drag.lastClientY;
      if (y - r.top < EDGE) canvasEl.scrollTop -= Math.max(2, EDGE - (y - r.top));
      else if (r.bottom - y < EDGE) canvasEl.scrollTop += Math.max(2, EDGE - (r.bottom - y));
      drag.autoScrollT = requestAnimationFrame(tick);
    };
    drag.autoScrollT = requestAnimationFrame(tick);
  }
  function stopAutoScroll() {
    if (drag.autoScrollT) cancelAnimationFrame(drag.autoScrollT);
    drag.autoScrollT = null;
  }

  document.addEventListener('pointerdown', onPointerDown);

  function addAtInsertion(blockId, ins) {
    const node = newNode(blockId);
    if (ins.type === 'beside') {
      const hit = find(ins.uid); if (!hit) return;
      hit.parentList.splice(ins.before ? hit.index : hit.index + 1, 0, node);
    } else if (ins.type === 'slot') {
      const hit = find(ins.parentUid); if (!hit) return;
      (hit.node.slots[ins.slotKey] = hit.node.slots[ins.slotKey] || []).push(node);
    } else {
      STATE.program.push(node);
    }
    STATE.selectedId = node.uid;
    recentlyAdded.add(node.uid);
    renderStack(); renderCode(); validate(); persist();
  }
  function moveAtInsertion(uid, ins) {
    const hit = find(uid); if (!hit) return;
    const node = hit.node;
    // forbid moving into own subtree
    if (ins.type === 'beside' && containsUid(node, ins.uid)) return;
    if (ins.type === 'slot'   && containsUid(node, ins.parentUid)) return;
    hit.parentList.splice(hit.index, 1);
    if (ins.type === 'beside') {
      const dst = find(ins.uid); if (!dst) { STATE.program.push(node); }
      else dst.parentList.splice(ins.before ? dst.index : dst.index + 1, 0, node);
    } else if (ins.type === 'slot') {
      const dst = find(ins.parentUid); if (!dst) { STATE.program.push(node); }
      else (dst.node.slots[ins.slotKey] = dst.node.slots[ins.slotKey] || []).push(node);
    } else {
      STATE.program.push(node);
    }
    renderStack(); renderCode(); validate(); persist();
  }

  // ---------- popover ----------
  const popEl = document.getElementById('popover');
  const popInner = document.getElementById('popover-inner');

  function placePopover(near) {
    const r = near.getBoundingClientRect();
    popEl.style.left = Math.min(window.innerWidth - 360, Math.max(8, r.left)) + 'px';
    popEl.style.top  = Math.min(window.innerHeight - 340, r.bottom + 8) + 'px';
    popEl.classList.add('is-on');
    popEl.setAttribute('aria-hidden', 'false');
  }
  function closePopover() {
    popEl.classList.remove('is-on');
    popEl.setAttribute('aria-hidden', 'true');
    setTimeout(() => { if (!popEl.classList.contains('is-on')) popInner.innerHTML = ''; }, 500);
  }
  document.addEventListener('click', (e) => {
    if (!popEl.classList.contains('is-on')) return;
    if (!popEl.contains(e.target)) closePopover();
  });

  function openAddPopover(near, parentUid, slotKey) {
    popInner.innerHTML = '';
    popInner.appendChild(el('div', { class: 'popover__title' }, 'ブロックを追加'));
    const input = el('input', { type:'search', placeholder:'検索...' });
    popInner.appendChild(input);
    const list = el('div', { class:'palette__list', style:'max-height:260px; overflow:auto; margin-top:6px;' });
    function refill() {
      list.innerHTML = '';
      const q = input.value.trim().toLowerCase();
      for (const b of BLOCKS) {
        if (q && !b.label.toLowerCase().includes(q) && !b.id.includes(q)) continue;
        list.appendChild(el('button', {
          class: 'palette-item ' + (CAT_BY_ID[b.cat]?.tone||''),
          onclick: () => { addToProgram(b.id, parentUid, slotKey); closePopover(); },
        }, [
          el('span', { class:'palette-item__icon' }, b.icon||'▢'),
          el('span', {}, [
            el('div', { class:'palette-item__label' }, b.label.replace(/<[^>]+>/g,'…')),
            el('div', { class:'palette-item__hint' }, CAT_BY_ID[b.cat]?.label || ''),
          ]),
        ]));
      }
    }
    input.addEventListener('input', refill);
    popInner.appendChild(list);
    refill();
    placePopover(near);
    input.focus();
  }

  function openParamPopover(near, uid, key) {
    const hit = find(uid); if (!hit) return;
    const def = BLOCK_BY_ID[hit.node.blockId];
    const p = def.params.find(pp => pp.key === key);
    popInner.innerHTML = '';
    popInner.appendChild(el('div', { class:'popover__title' }, `${def.label.replace(/<[^>]+>/g,'…')}  /  ${key}`));
    popInner.appendChild(el('label', {}, kindLabel(p.kind)));

    let input;
    if (p.kind === 'select') {
      input = el('select', {});
      for (const o of p.options) input.appendChild(el('option', { value: o, selected: hit.node.params[key] === o }, o));
    } else if (p.kind === 'var') {
      // datalist of known vars
      input = el('input', { type:'text', value: hit.node.params[key] ?? '', list:'datalist-vars' });
      let dl = document.getElementById('datalist-vars');
      if (!dl) { dl = el('datalist', { id:'datalist-vars' }); document.body.appendChild(dl); }
      dl.innerHTML = '';
      for (const v of STATE.vars) dl.appendChild(el('option', { value: v.name }));
    } else if (p.kind === 'text' && (p.placeholder||'').length > 16) {
      input = el('textarea', { rows:3, placeholder: p.placeholder || '' }, hit.node.params[key] ?? '');
    } else {
      input = el('input', { type: p.kind === 'num' ? 'number' : 'text', value: hit.node.params[key] ?? '', placeholder: p.placeholder || '' });
    }
    popInner.appendChild(input);

    // magic-variable picker: pick from previously declared outputs
    if (p.kind === 'var' || p.kind === 'expr') {
      const before = declaredBeforeNode(uid);
      popInner.appendChild(el('label', {}, '前のブロックの出力から'));
      const wrap = el('div', { class:'magic-pick' });
      if (!before.length) {
        wrap.appendChild(el('div', { class:'magic-pick__empty' }, 'まだ出力がありません'));
      } else {
        for (const v of before) {
          wrap.appendChild(el('button', {
            class:'magic-pick__chip',
            type:'button',
            onclick: () => {
              if (p.kind === 'var') input.value = v.name;
              else if (input.tagName === 'TEXTAREA') {
                const s = input.selectionStart ?? input.value.length;
                input.value = input.value.slice(0,s) + v.name + input.value.slice(s);
              } else {
                input.value = v.name;
              }
              input.focus();
            },
          }, [
            el('span', { 'aria-hidden': 'true' }, v.icon || '•'),
            document.createTextNode(' ' + v.name + ' '),
            el('small', {}, v.source),
          ]));
        }
      }
      popInner.appendChild(wrap);
    }

    popInner.appendChild(el('div', { class:'row', style:'margin-top:8px;' }, [
      el('button', {
        class:'tbtn',
        type:'button',
        onclick: () => {
          const v = input.tagName === 'TEXTAREA' ? input.value : (input.value);
          hit.node.params[key] = v;
          closePopover(); renderStack(); renderCode(); validate(); persist();
        },
      }, '反映'),
      el('button', { class:'tbtn tbtn--ghost', type:'button', onclick: closePopover }, 'キャンセル'),
    ]));
    placePopover(near);
    if (input.focus) input.focus();
  }

  function declaredBeforeNode(targetUid) {
    const vars = [];
    let stop = false;
    function walk(list) {
      for (const n of list) {
        if (stop) return;
        if (n.uid === targetUid) { stop = true; return; }
        const def = BLOCK_BY_ID[n.blockId];
        for (const p of def.params || []) {
          if (p.declares && n.params[p.key] && /^[a-zA-Z_]\w*$/.test(n.params[p.key])) {
            vars.push({
              name: n.params[p.key],
              source: def.label.replace(/<[^>]+>/g, '…'),
              icon: def.icon,
            });
          }
        }
        for (const s of def.slots || []) walk(n.slots[s.key]);
        if (stop) return;
      }
    }
    walk(STATE.program);
    const map = new Map();
    for (const v of vars) map.set(v.name, v);
    return Array.from(map.values());
  }

  function kindLabel(k) {
    return ({
      text: 'テキスト', expr: '式 (JS)', ident: '名前 (英数_)', num: '数値',
      bool: '真偽', select: '選択', var: '変数を参照',
    })[k] || k;
  }

  // ---------- codegen ----------
  const codeOut = document.getElementById('code-output');

  function generateChild(list, lang) {
    return list.map(n => generateOne(n, lang)).join('\n');
  }
  function generateOne(node, lang) {
    const def = BLOCK_BY_ID[node.blockId];
    const slotsCode = {};
    for (const s of def.slots || []) slotsCode[s.key] = generateChild(node.slots[s.key], lang);
    const fn = def[lang];
    try { return fn(node.params, slotsCode); }
    catch (e) { return `// [error in ${def.id}: ${e.message}]`; }
  }
  function pretty(code) {
    let indent = 0;
    return code.split('\n').map(raw => {
      const line = raw.replace(/^\s+/, '');
      const opens = (line.match(/[{(\[]/g) || []).length;
      const closes = (line.match(/[)}\]]/g) || []).length;
      const leadCloses = (line.match(/^[)}\]]+/) || [''])[0].length;
      const before = Math.max(0, indent - leadCloses);
      const out = '  '.repeat(before) + line;
      indent += opens - closes;
      if (indent < 0) indent = 0;
      return out;
    }).join('\n');
  }

  function renderCode() {
    const raw = generateChild(STATE.program, STATE.lang);
    const code = pretty(raw);
    codeOut.textContent = code || '// (まだブロックがありません)';
    return code;
  }

  // ---------- validate ----------
  const issueList = document.getElementById('issuelist');
  const varList   = document.getElementById('varlist');
  const issuesBadge = document.getElementById('issues-badge');

  function validate() {
    const rtKept = (STATE.issues || []).filter(i => i.runtime);
    const issues = [];
    const declared = new Map(); // name -> {source, count}
    // collect declarations
    walk((n) => {
      const def = BLOCK_BY_ID[n.blockId];
      for (const p of def.params || []) {
        if (p.declares) {
          const name = n.params[p.key];
          if (!name) continue;
          if (!/^[a-zA-Z_]\w*$/.test(name)) {
            issues.push({ kind:'err', msg:`変数名がおかしい: "${name}"`, where: def.label });
          }
          declared.set(name, { source: def.label, uid: n.uid });
        }
      }
    });
    // empty / missing params
    walk((n) => {
      const def = BLOCK_BY_ID[n.blockId];
      for (const p of def.params || []) {
        if (p.default !== undefined && p.default !== '') continue;
        if (n.params[p.key] === '' || n.params[p.key] == null) {
          issues.push({ kind:'warn', msg:`未入力: ${p.key}`, where: def.label });
        }
      }
      // var references — find identifiers in expr/var params
      for (const p of def.params || []) {
        const v = n.params[p.key];
        if (!v) continue;
        if (p.kind === 'var') {
          if (/^[a-zA-Z_]\w*$/.test(v) && !declared.has(v) && !globalIdents().has(v)) {
            issues.push({ kind:'warn', msg:`未定義の変数: ${v}`, where: def.label });
          }
        }
      }
    });

    STATE.issues = issues.concat(rtKept);
    STATE.vars = Array.from(declared, ([name, info]) => ({ name, source: info.source }));
    renderIssues(); renderVars(); updateDock();
  }

  function pushRuntimeIssue(msg) {
    const rt = STATE.issues.filter(i => i.runtime);
    if (!rt.some(i => i.msg === msg)) {
      STATE.issues.push({ kind: 'err', msg, where: 'runtime', runtime: true });
    }
    renderIssues(); updateDock();
  }
  function clearRuntimeIssues() {
    if (!STATE.issues.some(i => i.runtime)) return;
    STATE.issues = STATE.issues.filter(i => !i.runtime);
    renderIssues(); updateDock();
  }

  function globalIdents() {
    return new Set([
      'console','document','window','location','navigator','localStorage','history',
      'matchMedia','URL','URLSearchParams','Date','Math','JSON','Object','Array','String','Number','Boolean',
      'fetch','setTimeout','setInterval','clearInterval','clearTimeout','Promise','Audio','speechSynthesis',
      'IntersectionObserver','CustomEvent','SpeechSynthesisUtterance',
    ]);
  }

  function renderIssues() {
    issueList.innerHTML = '';
    issuesBadge.textContent = STATE.issues.length;
    issuesBadge.dataset.zero = STATE.issues.length ? '0' : '1';
    for (const i of STATE.issues) {
      issueList.appendChild(el('li', { class: 'issue--' + i.kind }, [
        document.createTextNode(i.msg),
        el('span', { class:'issue__where' }, '@ ' + (i.where||'')),
      ]));
    }
    if (!STATE.issues.length) {
      issueList.appendChild(el('li', {}, '問題なし ✓'));
    }
    // mirror to mobile sheet
    const sl = document.getElementById('sheet-issuelist');
    if (sl) {
      sl.innerHTML = '';
      if (!STATE.issues.length) sl.appendChild(el('li', {}, '問題なし ✓'));
      else for (const i of STATE.issues) {
        sl.appendChild(el('li', { class: 'issue--' + i.kind }, [
          document.createTextNode(i.msg),
          el('span', { class:'issue__where' }, '@ ' + (i.where||'')),
        ]));
      }
    }
    const sBadge = document.getElementById('sheet-issues-badge');
    if (sBadge) { sBadge.textContent = STATE.issues.length; sBadge.dataset.zero = STATE.issues.length ? '0' : '1'; }
  }
  function renderVars() {
    varList.innerHTML = '';
    if (!STATE.vars.length) varList.appendChild(el('li', {}, '宣言された変数はありません'));
    for (const v of STATE.vars) {
      varList.appendChild(el('li', {}, [
        el('strong', {}, v.name),
        document.createTextNode('  '),
        el('span', { class:'issue__where' }, v.source),
      ]));
    }
  }

  // ---------- runner ----------
  const runner = document.getElementById('runner');
  const logEl = document.getElementById('console-log');
  const consoleBadge = document.getElementById('console-badge');
  let unreadLogs = 0;
  function bumpConsoleBadge() {
    const activeTab = document.querySelector('.itab.is-on')?.dataset.itab;
    if (activeTab === 'console') return;
    unreadLogs++;
    consoleBadge.textContent = unreadLogs;
    consoleBadge.dataset.zero = '0';
  }
  function appendLog(text, cls = '') {
    const line = el('div', { class: 'log-line ' + cls }, text);
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
    // mirror to sheet
    const sheetLog = document.getElementById('sheet-console-log');
    if (sheetLog) {
      const line2 = el('div', { class: 'log-line ' + cls }, text);
      sheetLog.appendChild(line2);
      sheetLog.scrollTop = sheetLog.scrollHeight;
    }
    bumpConsoleBadge();
  }
  document.getElementById('btn-clearlog').addEventListener('click', () => {
    logEl.innerHTML = '';
    unreadLogs = 0;
    consoleBadge.textContent = '0';
    consoleBadge.dataset.zero = '1';
  });

  window.addEventListener('message', (ev) => {
    const d = ev.data;
    if (!d || d.kind !== 'storydock') return;
    if (d.type === 'log')   appendLog(d.text);
    else if (d.type === 'err') {
      appendLog(d.text, 'log-err');
      try { window.haptic?.error?.(); } catch {}
      pushRuntimeIssue(d.text);
    }
    else if (d.type === 'warn') appendLog(d.text, 'log-warn');
    else if (d.type === 'info') appendLog(d.text, 'log-info');
    else if (d.type === 'done') appendLog('— end —', 'log-info');
  });

  // global haptic on tap for every interactive element
  document.addEventListener('click', (e) => {
    const el = e.target.closest('button, .chip, .palette-item, .cat-pill, .slot__drop, .stack-block');
    if (!el || el.disabled) return;
    try { window.haptic?.(); } catch {}
  }, { capture: true });

  async function run() {
    if (STATE.lang !== 'js') {
      appendLog('Swift コードは実行できません (まだ)。Code タブで確認してね。', 'log-warn');
      return;
    }
    clearRuntimeIssues();
    const code = renderCode();
    appendLog('▶ Run...', 'log-info');
    const html = `<!doctype html><body><script>
      const post = (type, text) => parent.postMessage({ kind:'storydock', type, text }, '*');
      const fmt = (a) => a.map(v => {
        try { return typeof v === 'string' ? v : JSON.stringify(v); }
        catch { return String(v); }
      }).join(' ');
      const _log = console.log, _warn = console.warn, _err = console.error, _info = console.info;
      console.log  = (...a) => { post('log', fmt(a)); _log(...a); };
      console.warn = (...a) => { post('warn', fmt(a)); _warn(...a); };
      console.error= (...a) => { post('err', fmt(a)); _err(...a); };
      console.info = (...a) => { post('info', fmt(a)); _info(...a); };
      window.onerror = (msg) => post('err', String(msg));
      window.onunhandledrejection = (e) => post('err', 'unhandled: ' + (e.reason && e.reason.message || e.reason));
      (async () => {
        try {
          ${code}
        } catch (e) { post('err', String(e && (e.stack || e.message) || e)); }
        post('done', '');
      })();
    <\/script></body>`;
    runner.srcdoc = html;
  }

  // ---------- toolbar ----------
  document.querySelectorAll('.seg__btn').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.seg__btn').forEach(x => x.classList.toggle('is-on', x === b));
      STATE.lang = b.dataset.lang;
      document.getElementById('console-hint').textContent =
        STATE.lang === 'js' ? 'Runtime: JS sandbox' : 'Runtime: Swift (preview only)';
      renderCode();
    });
  });
  document.querySelectorAll('.itab').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.itab').forEach(x => x.classList.toggle('is-on', x === t));
      document.querySelectorAll('.inspector__pane').forEach(p => p.classList.toggle('is-on', p.dataset.pane === t.dataset.itab));
      if (t.dataset.itab === 'console') {
        unreadLogs = 0;
        consoleBadge.textContent = '0';
        consoleBadge.dataset.zero = '1';
      }
    });
  });

  document.getElementById('btn-run').addEventListener('click', run);
  document.getElementById('btn-export').addEventListener('click', () => {
    const data = { lang: STATE.lang, program: STATE.program, savedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: 'story-dock-blocks.json' });
    document.body.appendChild(a); a.click(); a.remove();
  });

  // keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'r') { e.preventDefault(); run(); }
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); persist(true); appendLog('💾 saved', 'log-info'); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'b') { e.preventDefault(); validate(); }
    if (e.key === 'Backspace' && STATE.selectedId && document.activeElement === document.body) {
      removeNode(STATE.selectedId);
    }
  });

  // ---------- persistence ----------
  const KEY = 'storydock_blocks_v1';
  function persist(verbose = false) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ lang: STATE.lang, program: STATE.program, nextId: STATE.nextId }));
    } catch (e) { if (verbose) appendLog('save failed: ' + e.message, 'log-err'); }
  }
  function restore() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return seedDemo();
      const data = JSON.parse(raw);
      STATE.lang = data.lang || 'js';
      STATE.program = data.program || [];
      STATE.nextId = data.nextId || 1;
      // sync UI: select lang button
      document.querySelectorAll('.seg__btn').forEach(b => b.classList.toggle('is-on', b.dataset.lang === STATE.lang));
    } catch (e) { console.warn(e); seedDemo(); }
  }
  function seedDemo() {
    STATE.program = [
      newNode('d_let', { params: { name:'name', value:'"Story Dock"' } }),
      newNode('t_concat', { params: { out:'greeting', tpl:'Hello, ${name}!' } }),
      newNode('db_log', { params: { value:'greeting' } }),
      (() => {
        const lp = newNode('for_count', { params: { i:'i', n:'3' } });
        lp.slots.body = [ newNode('db_log', { params: { value:'i' } }) ];
        return lp;
      })(),
    ];
  }

  // ---------- floating dock (issues / console) ----------
  const dockEl = document.getElementById('dock');
  const dockConsole = document.getElementById('dock-console');
  const dockIssues  = document.getElementById('dock-issues');
  const dockIssuesCount = document.getElementById('dock-issues-count');

  let dockState = 'hidden';
  let dockExpandTimer = null;

  function setDockState(s) {
    if (dockState === s) return;
    dockState = s;
    dockEl.dataset.state = s;
    dockConsole.classList.toggle('is-on', s === 'console');
    dockIssues.classList.toggle('is-on', s === 'issues-expanded' || s === 'issues-compact');
  }

  function updateDock() {
    const total = STATE.issues.length;
    dockIssuesCount.textContent = total;
    if (total > 0) {
      if (dockState !== 'issues-expanded' && dockState !== 'issues-compact') {
        setDockState('issues-expanded');
        clearTimeout(dockExpandTimer);
        dockExpandTimer = setTimeout(() => {
          if (dockState === 'issues-expanded') setDockState('issues-compact');
        }, 1500);
      }
    } else {
      clearTimeout(dockExpandTimer);
      setDockState('console');
    }
  }

  // ---------- bottom sheet (issues + console on mobile) ----------
  const sheetEl = document.getElementById('sheet');
  const sheetScrim = document.getElementById('sheet-scrim');

  function openSheet(tab) {
    document.querySelectorAll('.sheet__tabs .itab').forEach(t =>
      t.classList.toggle('is-on', t.dataset.stab === tab));
    document.querySelectorAll('.sheet__pane').forEach(p =>
      p.classList.toggle('is-on', p.dataset.spane === tab));
    sheetEl.classList.add('is-on');
    sheetEl.setAttribute('aria-hidden', 'false');
    if (tab === 'console') {
      unreadLogs = 0;
      consoleBadge.textContent = '0';
      consoleBadge.dataset.zero = '1';
      const sb = document.getElementById('sheet-console-badge');
      if (sb) { sb.textContent = '0'; sb.dataset.zero = '1'; }
    }
  }
  function closeSheet() {
    sheetEl.classList.remove('is-on');
    sheetEl.setAttribute('aria-hidden', 'true');
  }
  sheetScrim.addEventListener('click', closeSheet);
  document.querySelectorAll('.sheet__tabs .itab').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.sheet__tabs .itab').forEach(x => x.classList.toggle('is-on', x === t));
      document.querySelectorAll('.sheet__pane').forEach(p => p.classList.toggle('is-on', p.dataset.spane === t.dataset.stab));
    });
  });

  dockConsole.addEventListener('click', () => openSheet('console'));
  dockIssues.addEventListener('click',  () => openSheet('issues'));

  // ---------- Mac native bridge ----------
  function setupNativeBridge() {
    if (!window.__storydock_native || !window.storyDockNative) return;
    document.documentElement.classList.add('is-native-mac');

    // route haptics through NSHapticFeedbackManager
    const native = window.storyDockNative;
    window.haptic = Object.assign(
      () => native.haptic('tap'),
      {
        confirm: () => native.haptic('confirm'),
        error:   () => native.haptic('error'),
      }
    );

    function doHandoff() {
      const code = pretty(generateChild(STATE.program, 'swift'));
      const header =
        '// Story Dock — handoff (' + new Date().toISOString() + ')\n' +
        '// Generated from ' + STATE.program.length + ' top-level block(s)\n\n';
      native.handoffSwift(header + code);
      try { window.haptic?.confirm?.(); } catch {}
    }
    native._triggerHandoff = doHandoff;

    // handoff button — third circle in float-actions
    const fa = document.getElementById('float-actions');
    const exportBtn = document.getElementById('btn-export');
    const btn = el('button', {
      class: 'circle-btn circle-btn--handoff', id: 'btn-handoff',
      title: 'Swift にハンドオフ (⌘E)', 'aria-label': 'Swift にハンドオフ',
      onclick: doHandoff,
    }, '⇪');
    if (fa) fa.insertBefore(btn, exportBtn);
  }

  // ---------- pull-to-clear (swipe past bottom to delete all) ----------
  function clearAllLogs() {
    logEl.innerHTML = '';
    unreadLogs = 0;
    consoleBadge.textContent = '0';
    consoleBadge.dataset.zero = '1';
    const sLog = document.getElementById('sheet-console-log');
    if (sLog) sLog.innerHTML = '';
    const sb = document.getElementById('sheet-console-badge');
    if (sb) { sb.textContent = '0'; sb.dataset.zero = '1'; }
    try { window.haptic?.warning?.(); } catch {}
  }
  function clearAllIssues() {
    STATE.issues = [];
    renderIssues();
    updateDock();
    try { window.haptic?.warning?.(); } catch {}
  }

  function attachPullToClear(scrollEl, tray, onClear) {
    if (!scrollEl || !tray) return;
    const THRESHOLD = 96;
    const MAX = 160;
    let pull = 0;
    let wheelTimer = null;
    let touching = false;
    let lastY = null;
    let labelEl = tray.querySelector('.clear-tray__inner');
    const origLabel = labelEl ? labelEl.textContent : 'もっとスワイプで削除。';

    function setPull(v, animate) {
      pull = Math.max(0, Math.min(v, MAX));
      tray.style.transition = animate ? 'height .32s cubic-bezier(.22,.61,.36,1)' : 'none';
      tray.style.height = pull + 'px';
      const ready = pull >= THRESHOLD;
      tray.classList.toggle('is-ready', ready);
      if (labelEl) labelEl.textContent = ready ? '離して全削除' : origLabel;
    }
    function atBottom() {
      return scrollEl.scrollHeight - scrollEl.clientHeight - scrollEl.scrollTop <= 1;
    }
    function commit() {
      if (pull >= THRESHOLD) {
        setPull(MAX, true);
        setTimeout(() => { onClear(); setPull(0, true); }, 160);
      } else {
        setPull(0, true);
      }
    }

    scrollEl.addEventListener('wheel', (e) => {
      if (e.deltaY <= 0 && pull === 0) return;
      if (!atBottom() && pull === 0) return;
      e.preventDefault();
      setPull(pull + e.deltaY * 0.55, false);
      if (wheelTimer) clearTimeout(wheelTimer);
      wheelTimer = setTimeout(commit, 220);
    }, { passive: false });

    scrollEl.addEventListener('touchstart', (e) => {
      touching = true;
      lastY = e.touches[0].clientY;
    }, { passive: true });
    scrollEl.addEventListener('touchmove', (e) => {
      if (!touching) return;
      const cy = e.touches[0].clientY;
      const dy = lastY - cy;
      lastY = cy;
      if ((atBottom() && dy > 0) || pull > 0) {
        e.preventDefault();
        setPull(pull + dy, false);
      }
    }, { passive: false });
    scrollEl.addEventListener('touchend', () => {
      if (!touching) return;
      touching = false;
      commit();
    });
    scrollEl.addEventListener('touchcancel', () => {
      touching = false;
      setPull(0, true);
    });
  }

  function wireClearTrays() {
    const map = [
      { scroll: document.getElementById('console-log'), tray: document.querySelector('.clear-tray[data-clear-for="log"]'), clear: clearAllLogs },
      { scroll: document.querySelector('.pane__scroll[data-scroll="issues"]'), tray: document.querySelector('.clear-tray[data-clear-for="issues"]'), clear: clearAllIssues },
      { scroll: document.getElementById('sheet-console-log'), tray: document.querySelector('.clear-tray[data-clear-for="sheet-log"]'), clear: clearAllLogs },
      { scroll: document.querySelector('.pane__scroll[data-scroll="sheet-issues"]'), tray: document.querySelector('.clear-tray[data-clear-for="sheet-issues"]'), clear: clearAllIssues },
    ];
    for (const m of map) attachPullToClear(m.scroll, m.tray, m.clear);
  }

  // patch renderIssues to auto-scroll to bottom on growth
  const _renderIssues = renderIssues;
  renderIssues = function () {
    const wraps = [
      document.querySelector('.pane__scroll[data-scroll="issues"]'),
      document.querySelector('.pane__scroll[data-scroll="sheet-issues"]'),
    ];
    const wasAtBottom = wraps.map(w => w && (w.scrollHeight - w.clientHeight - w.scrollTop <= 4));
    _renderIssues();
    wraps.forEach((w, i) => {
      if (w && wasAtBottom[i]) w.scrollTop = w.scrollHeight;
    });
  };

  // ---------- boot ----------
  restore();
  renderPalette();
  renderStack();
  renderCode();
  validate();
  updateDock();
  setupNativeBridge();
  wireClearTrays();

  // ---------- composer bridge ----------
  // When this editor is loaded inside an iframe by the Story Dock composer, sync state
  // both ways via postMessage so the parent can capture program + generated code.
  if (window.parent && window.parent !== window) {
    let _bridgeReady = false;
    function _post(extra) {
      try {
        const code = (typeof renderCode === 'function') ? renderCode() : '';
        window.parent.postMessage(Object.assign({
          type: 'sd-blocks-state',
          program: STATE.program,
          lang: STATE.lang,
          code: code
        }, extra || {}), '*');
      } catch (_) {}
    }
    // chain on top of persist so every state-mutating call posts to parent
    const _origPersist = persist;
    persist = function () { _origPersist.apply(this, arguments); if (_bridgeReady) _post(); };
    window.addEventListener('message', (e) => {
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'sd-blocks-load') {
        if (Array.isArray(d.program)) STATE.program = d.program;
        if (typeof d.lang === 'string') STATE.lang = d.lang;
        if (typeof d.nextId === 'number') STATE.nextId = d.nextId;
        document.querySelectorAll('.seg__btn').forEach(b => b.classList.toggle('is-on', b.dataset.lang === STATE.lang));
        renderStack(); renderCode(); validate();
        _bridgeReady = true;
        _post({ initial: true });
      } else if (d.type === 'sd-blocks-request-state') {
        _bridgeReady = true;
        _post({ requested: true });
      }
    });
    // Tell parent we're ready to receive load.
    try { window.parent.postMessage({ type: 'sd-blocks-ready' }, '*'); } catch (_) {}
  }
})();
