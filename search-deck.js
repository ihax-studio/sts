/* ═══════════════════════════════════════════════════════════════════════════
   search-deck.js — 新・検索/アプリ一覧「SearchDeck」(旧Spotlightの後継・完全ネイティブ)
   旧: 391KBテンプレをShadow DOMに注入=読込レース/破損/中央ズレの温床 → 全廃。
   新: このファイルだけで完結。#searchHost に素のDOMを構築する。
   機能(旧と同等): アプリ一覧(中央グリッド・タップで起動) / アプリ名フィルタ /
                  友達・招待リンク検索(__chatSearch/__chatOpen) / 楽曲検索(__gc.musicSearch→再生)
   ホストAPI: SearchDeck.init(opts) … opts = {
       apps:[{n,i,run}], onRequestClose(), chatSearch(q), chatOpen(id),
       musicSearch(q)=>Promise<[track]>, playMusic(track), haptic() }
     SearchDeck.open({focus}) / SearchDeck.close()
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
  'use strict';
  if(window.SearchDeck) return;

  var cb={}, built=false, els={}, musicSeq=0, musicTimer=null, _wasSearching=false;

  function el(tag, cls, text){ var e=document.createElement(tag); if(cls) e.className=cls; if(text!=null) e.textContent=text; return e; }

  function build(){
    if(built) return; built=true;
    var host=document.getElementById('searchHost'); if(!host) return;
    host.innerHTML='';

    var wrap=el('div','sd-wrap'); els.wrap=wrap;
    var col=el('div','sd-col');

    // 検索バー
    var bar=el('div','sd-bar'); els.bar=bar;
    var mag=document.createElement('img'); mag.className='sd-mag'; mag.src='high-search-white.png'; mag.alt='';
    var input=document.createElement('input'); input.type='search'; input.placeholder='検索 / Search';
    input.setAttribute('autocomplete','off'); input.setAttribute('spellcheck','false'); input.enterKeyHint='search';
    input.setAttribute('autocapitalize','none'); input.setAttribute('autocorrect','off');   // ★iPhone対策: 先頭大文字化/自動修正/末尾スペースで曲が出ない問題=PCと同じ素の入力にする
    els.input=input;
    var xb=el('button','sd-x','✕'); xb.type='button'; xb.setAttribute('aria-label','クリア');
    bar.appendChild(mag); bar.appendChild(input); bar.appendChild(xb);

    // スクロール領域: 検索結果 + その下にアプリグリッド(★検索中もapp一覧は結果の下に出る)
    var scroll=el('div','sd-scroll'); els.scroll=scroll;
    var apps=el('div','sd-apps'); els.apps=apps; apps.setAttribute('data-hswipe','');   // ★グローバルの横スワイプ殺しの例外に=1行モードで指の左右スクロールが確実に効く
    /* ★保存済みの並び順(長押しドラッグで並び替え)を復元 */
    var appsArr=(cb.apps||[]).slice();
    try{ var ord=JSON.parse(localStorage.getItem('sd_app_order')||'[]');
      if(ord.length){ appsArr.sort(function(a,b){ var ia=ord.indexOf(a.n), ib=ord.indexOf(b.n); if(ia<0)ia=999; if(ib<0)ib=999; return ia-ib; }); } }catch(_){}
    appsArr.forEach(function(a,i){
      var b=el('button','sd-app'); b.type='button'; b.setAttribute('data-nm',(a.n||'').toLowerCase()); b.setAttribute('data-nm-raw',a.n||'');
      if(a.gone) b.__gone=a.gone;          /* ★gone()=trueの間は完全非表示(開くたび評価: ミュージック/翻訳) */
      if(a.hidden) b.__searchOnly=true;    /* ★hidden=名前を検索した時だけ出る(Story Magic/Document Studio/Terrakoku) */
      b.style.animationDelay=(i*35)+'ms';
      var ic=document.createElement('img'); ic.className='ic'; ic.src=a.i; ic.alt=''; ic.loading='lazy'; ic.draggable=false;
      ic.onerror=function(){ this.style.objectFit='contain'; this.style.padding='14px'; };
      if(a.inv){ ic.style.filter='brightness(0) invert(1)'; ic.style.objectFit='contain'; ic.style.padding='17px'; ic.style.boxSizing='border-box'; }   /* ★黒グリフ画像は白抜きに。グリフはデカくしすぎない・枠/大きさは他のアイコンと同じ */
      var nm=el('div','nm',a.n);
      b.appendChild(ic); b.appendChild(nm);
      b.addEventListener('click',function(ev){ ev.stopPropagation(); if(reorder.sup()){ ev.preventDefault(); return; } try{ cb.haptic&&cb.haptic(); }catch(_){}
        if(a.stay){ if(els.input){ els.input.value=a.seed||''; onInput(); try{ els.input.focus(); }catch(_){} } return; }   // stay=デッキ内機能(グラフ等)=閉じずに種入力
        try{ cb.onRequestClose&&cb.onRequestClose(); }catch(_){}
        setTimeout(function(){ try{ a.run&&a.run(); }catch(_){} },140); });
      apps.appendChild(b);
    });

    var res=el('div','sd-res'); els.res=res;
    scroll.appendChild(apps);   // ★スクロール=アプリ一覧のみ(結果はバーの上へ)
    syncFriendTiles();   // ★友達もapp一覧のタイルに=アプリと同じ長押しドラッグ→左端でドックに追加できる(pin廃止の代替)
    reorder.attach(apps);   // ★長押し→ドラッグでiOS風並び替え(FLIP+ジグル+保存)
    /* ★検索中(1行)=アイコンの上でも指の左右ドラッグでappsを確実にスクロール。iOSはネイティブ横スクロールが子ボタン上で効かないのでJSでscrollLeftを直接動かす。横優勢の時だけ効かせ長押し並び替えと共存 */
    (function(){ var on=false, sx=0, sy=0, sl=0, axis=0;
      function searching(){ var o=document.getElementById('searchOv'); return o&&o.classList.contains('sd-searching'); }
      apps.addEventListener('touchstart', function(e){ if(!searching()){ on=false; return; } var t=e.touches&&e.touches[0]; if(!t)return; on=true; sx=t.clientX; sy=t.clientY; sl=apps.scrollLeft; axis=0; }, {passive:true});
      apps.addEventListener('touchmove', function(e){ if(!on)return; var t=e.touches&&e.touches[0]; if(!t)return; var dx=t.clientX-sx, dy=t.clientY-sy;
        if(!axis){ if(Math.abs(dx)>6||Math.abs(dy)>6) axis=(Math.abs(dx)>Math.abs(dy))?'x':'y'; }
        if(axis==='x'){ apps.scrollLeft=sl-dx; if(e.cancelable) e.preventDefault(); } }, {passive:false});
      function end(){ on=false; }
      apps.addEventListener('touchend', end, {passive:true}); apps.addEventListener('touchcancel', end, {passive:true});
    })();
    /* ★検索中: 結果はinputの上にスライドアップ / input+appsは0.5sで下へ(文字を消すと0.5sで上に戻る) */
    col.appendChild(res); col.appendChild(bar); col.appendChild(scroll);
    wrap.appendChild(col); host.appendChild(wrap);

    // 入力
    input.addEventListener('input', onInput);
    input.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); var first=res.querySelector('.sd-row'); if(first) first.click(); } });
    xb.addEventListener('click', function(ev){ ev.stopPropagation(); input.value=''; onInput(); input.focus(); });

    // 何も無い所タップ=閉じる(バー/行/タイル以外)
    wrap.addEventListener('click', function(e){
      if(e.target.closest && e.target.closest('.sd-bar, .sd-row, .sd-app, .sd-cat')) return;
      try{ cb.onRequestClose&&cb.onRequestClose(); }catch(_){}
    });
    // バーを掴んで下スワイプ=閉じる
    (function(){ var y0=0, drag=false;
      bar.addEventListener('touchstart', function(e){ var t=e.touches&&e.touches[0]; if(!t)return; y0=t.clientY; drag=true; }, {passive:true});
      bar.addEventListener('touchend', function(e){ if(!drag)return; drag=false; var t=e.changedTouches&&e.changedTouches[0]; if(!t)return;
        if(t.clientY-y0>70){ try{ cb.onRequestClose&&cb.onRequestClose(); }catch(_){} } }, {passive:true});
    })();
  }

  function setBarHas(){ if(els.bar) els.bar.classList.toggle('has', !!(els.input&&els.input.value)); }

  /* ★友達タイル: app一覧の末尾に友達(丸アイコン)を並べる。タップ=会話 / 長押しドラッグ→左端=ドックに追加。
     開くたびに作り直す(友達の増減/名前変更に追従)。cb.friends() は host(index.html)が提供 */
  function syncFriendTiles(){
    if(!els.apps) return;
    Array.prototype.slice.call(els.apps.querySelectorAll('.sd-app[data-fr]')).forEach(function(b){ try{ b.remove(); }catch(_){} });
    var frs=[]; try{ frs=(cb.friends&&cb.friends())||[]; }catch(_){}
    frs.forEach(function(f){
      if(!f||!f.peer) return;
      var b=el('button','sd-app'); b.type='button';
      b.setAttribute('data-fr', f.peer); b.setAttribute('data-av', f.ava||'🙂'); b.setAttribute('data-c', f.color||'#62d8ff');
      b.setAttribute('data-nm',(f.name||'').toLowerCase()); b.setAttribute('data-nm-raw', f.name||'友達');
      var ic;
      if(String(f.ava||'').indexOf('img:')===0){ ic=document.createElement('img'); ic.className='ic'; ic.src=String(f.ava).slice(4); ic.alt=''; ic.draggable=false; }
      else { ic=el('div','ic', f.ava||'🙂'); ic.style.cssText='display:flex;align-items:center;justify-content:center;font-size:30px;color:#fff;background:'+(f.color||'#62d8ff'); }
      b.appendChild(ic); b.appendChild(el('div','nm', f.name||'友達'));
      b.addEventListener('click', function(ev){ ev.stopPropagation(); if(reorder.sup()){ ev.preventDefault(); return; } try{ cb.haptic&&cb.haptic(); }catch(_){}
        try{ cb.onRequestClose&&cb.onRequestClose(); }catch(_){}
        setTimeout(function(){ try{ cb.chatOpen&&cb.chatOpen(f.peer); }catch(_){} },140); });
      els.apps.appendChild(b);
    });
  }

  function onInput(){
    setBarHas();
    var q=(els.input&&els.input.value||'').trim();
    try{ var ov=document.getElementById('searchOv'); if(ov) ov.classList.toggle('sd-searching', !!q); }catch(_){}   // ★文字があれば input+apps を下げ、結果を上に出す(0.5s)
    filterApps(q);
    /* ★1行に畳まれる瞬間だけ「右から1個ずつ0.3sスライドイン」を再生。文字を消して4列に戻る時はグリッド用アニメへ戻す */
    if(q){ if(!_wasSearching) playRowSlide(); }
    else if(_wasSearching) clearRowSlide();
    _wasSearching=!!q;
    var fn=buildFn(q);          // 数式(y=…/x=…)ならグラフ表示(1s描画)・他の検索は抑制
    renderGraph(q, fn);
    renderFriends(fn?'':q);
    scheduleMusic(fn?'':q);
    scheduleTranslate(fn?'':q);
    scheduleVocab(fn?'':q);
  }

  /* ── vocabx英単語: 英語を検索したら意味が出る。データ(667KB)は初回の英語検索時にだけ遅延ロード ── */
  var vocabLoading=false, vocSeq=0, vocabTries=0;
  function ensureVocab(done){ if(window.VOCABX){ done(true); return; }
    if(vocabLoading || vocabTries>=4){ done(false); return; }   /* ★失敗は4回まで=無限リトライしない */
    vocabLoading=true; vocabTries++;
    var s=document.createElement('script'); s.src='spotlight/vocabx-data.js';
    s.onload=function(){ vocabLoading=false; done(!!window.VOCABX); };
    s.onerror=function(){ vocabLoading=false; done(false); };
    document.head.appendChild(s); }
  function scheduleVocab(q){
    var my=++vocSeq;
    var old=els.res.querySelector('[data-sec="vx"]');
    var en=/^[a-zA-Z][a-zA-Z \-']{1,30}$/.test(q||'');
    if(!en){ if(old) old.remove(); return; }
    ensureVocab(function(okv){ if(my!==vocSeq) return;
      if(!okv){ if(vocabLoading || vocabTries<4){ setTimeout(function(){ if(my===vocSeq) scheduleVocab(q); },700); } return; }   // ロード中のみ再試行(上限4回=無限ループしない)
      renderVocab(q); }); }
  function renderVocab(q){
    var old=els.res.querySelector('[data-sec="vx"]'); if(old) old.remove();
    var ql=q.toLowerCase(), V=window.VOCABX||[], hits=[];
    for(var i=0;i<V.length && hits.length<3;i++){ var w=(V[i].w||'').toLowerCase(); if(w===ql){ hits.unshift(V[i]); } }
    if(!hits.length){ for(var j=0;j<V.length && hits.length<3;j++){ var w2=(V[j].w||'').toLowerCase();
      if(w2.indexOf(ql)===0 && w2.length<=ql.length+10) hits.push(V[j]); } }
    if(!hits.length) return;
    var s=section('英単語'); s.c.setAttribute('data-sec','vx');
    hits.forEach(function(v){
      var row=el('button','sd-tr'); row.type='button';
      row.appendChild(el('div','trt', v.j||''));
      row.appendChild(el('div','trs', (v.w||'')+(v.p?('  ・  '+v.p):'')));
      row.addEventListener('click', function(ev){ ev.stopPropagation(); speakPair(v.w||'', v.j||''); try{ cb.haptic&&cb.haptic(); }catch(_){} });
      s.rows.appendChild(row);
      requestAnimationFrame(function(){ requestAnimationFrame(function(){ row.classList.add('in'); }); }); });
    els.res.insertBefore(s.c, els.res.firstChild);
  }

  /* ── グラフ(復帰): y=式 / x=式(縦線・yの式は軸を入れ替えて描画) / x を含む数式 → canvasに1sで描画 ── */
  function buildFn(src){
    var s=String(src||'').toLowerCase().replace(/\s+/g,'');
    var axis='y';
    var m=s.match(/^([xy])=/); if(m){ axis=m[1]; s=s.slice(2); }   // ★「y=」「x=」「X=」どれでも
    if(!s) return null;
    if(!/^[0-9x+\-*/^().,a-z]+$/.test(s)) return null;
    if(axis==='x') s=s.replace(/y/g,'x');                          // x=f(y) は変数を読み替え(軸を入れ替えて描く)
    var isConst=/^[0-9+\-*/^().,]+$/.test(s) && !/[a-z]/.test(s);  // ★「x=2」「y=3」=定数線
    if(!isConst){
      if(!/x/.test(s)) return null;
      if(!/[+\-*/^]/.test(s) && !/[a-z]{2,}/.test(s.replace(/x/g,'')) && axis==='y' && !m) return null;
      var ids=s.match(/[a-z]+/g)||[];
      var ok={sin:1,cos:1,tan:1,asin:1,acos:1,atan:1,sqrt:1,abs:1,log:1,ln:1,exp:1,pow:1,min:1,max:1,floor:1,ceil:1,round:1,pi:1,e:1,x:1,y:1};
      for(var i=0;i<ids.length;i++){ if(!ok[ids[i]]) return null; } }
    var js=s.replace(/\^/g,'**')
            .replace(/\b(sin|cos|tan|asin|acos|atan|sqrt|abs|exp|pow|min|max|floor|ceil|round)\b/g,'Math.$1')
            .replace(/\bln\b/g,'Math.log').replace(/\blog\b/g,'Math.log10')
            .replace(/\bpi\b/g,'Math.PI').replace(/\be\b/g,'Math.E');
    try{ var f=new Function('x','"use strict";return ('+js+');'); var t0=f(1); if(typeof t0!=='number') return null;
      f.__axis=axis; f.__const=isConst; return f; }catch(err){ return null; }
  }
  function renderGraph(q, fn){
    var old=els.res.querySelector('[data-sec="gr"]'); if(old) old.remove();
    if(!fn) return;
    var s=section('グラフ'); s.c.setAttribute('data-sec','gr');
    var card=el('div','sd-graph');
    var cv=document.createElement('canvas');
    var W=Math.min(window.innerWidth*0.92,560)-8, H=200, DPR=Math.min(2,window.devicePixelRatio||1);
    cv.width=W*DPR; cv.height=H*DPR; cv.style.width=W+'px'; cv.style.height=H+'px';
    var ctx=cv.getContext('2d'); ctx.scale(DPR,DPR);
    var N=420, xs=[], ys=[], ymin=Infinity, ymax=-Infinity;
    for(var i=0;i<=N;i++){ var x=-10+20*i/N, y=NaN; try{ y=fn(x); }catch(_){}
      if(typeof y!=='number'||!isFinite(y)||Math.abs(y)>1e6) y=NaN;
      xs.push(x); ys.push(y); if(!isNaN(y)){ if(y<ymin)ymin=y; if(y>ymax)ymax=y; } }
    if(!(ymin<ymax)){ ymin=(isFinite(ymin)?ymin:0)-1; ymax=(isFinite(ymax)?ymax:0)+1; }
    var pad=(ymax-ymin)*0.12||1; ymin-=pad; ymax+=pad;
    var sw=!!(fn&&fn.__axis==='x'); if(sw){ ymin=-10; ymax=10; }   // ★x=…は軸を入れ替えて描く(縦線/横向きの式)
    function px(x){ return (x+10)/20*W; }
    function py(y){ return H-(y-ymin)/(ymax-ymin)*H; }
    ctx.strokeStyle='rgba(255,255,255,.4)'; ctx.lineWidth=1.2;                      // 軸(xy原点線は残す・縦の目盛り灰色線は廃止)
    if(ymin<0&&ymax>0){ ctx.beginPath(); ctx.moveTo(0,py(0)); ctx.lineTo(W,py(0)); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(px(0),0); ctx.lineTo(px(0),H); ctx.stroke();
    var _ig=ctx.createLinearGradient(0,0,W,0); _ig.addColorStop(0,'#ff2d92'); _ig.addColorStop(.5,'#a15cff'); _ig.addColorStop(1,'#3ae0ff');   // ★iTunes風マゼンタ→シアン
    ctx.strokeStyle=_ig; ctx.lineWidth=2.6; ctx.lineJoin='round'; ctx.shadowColor='rgba(160,92,255,.5)'; ctx.shadowBlur=8;
    ctx.beginPath(); var pen=false;
    for(var j=0;j<=N;j++){ var yv=ys[j];
      if(isNaN(yv)){ pen=false; continue; }
      var X=sw?px(yv):px(xs[j]), Y=sw?py(xs[j]):py(yv);   // ★x=…は(値,t)で縦向きに
      if(!pen){ ctx.moveTo(X,Y); pen=true; } else { ctx.lineTo(X,Y); } }
    ctx.stroke();
    card.appendChild(cv);
    var cap=el('div','sd-graph-cap',(sw?'x = ':'y = ')+String(q).replace(/^[xy]\s*=\s*/i,'')+(sw?'   (y: −10 〜 10)':'   (x: −10 〜 10)'));
    card.appendChild(cap);
    s.rows.appendChild(card);
    els.res.insertBefore(s.c, els.res.firstChild);
  }

  /* ── 翻訳(復帰): 日本語→英語 / 英語→日本語。結果はスライドアップ・タップでコピー ── */
  var trTimer=null, trSeq=0;
  function scheduleTranslate(q){
    clearTimeout(trTimer);
    var old=els.res.querySelector('[data-sec="tr"]');
    var jp=/[ぁ-ヿ㐀-䶿一-鿿]/.test(q);
    var en=!jp && /^[\x20-\x7e]+$/.test(q) && /[a-zA-Z]{2,}/.test(q);
    if(q.length<2 || (!jp&&!en)){ if(old) old.remove(); trSeq++; return; }
    var tl=jp?'en':'ja', my=++trSeq;
    trTimer=setTimeout(function(){
      var base=(window.STORAGE_URL||'');
      var p = base ? fetch(base+'/tr?q='+encodeURIComponent(q.slice(0,500))+'&tl='+tl).then(function(r){ return r.json(); }).then(function(d){ if(d&&d.ok&&d.text) return d.text; throw 0; }) : Promise.reject(0);
      p.catch(function(){
        var lp=jp?'ja|en':'en|ja';
        return fetch('https://api.mymemory.translated.net/get?q='+encodeURIComponent(q.slice(0,400))+'&langpair='+lp)
          .then(function(r){ return r.json(); }).then(function(d){ var t=d&&d.responseData&&d.responseData.translatedText; if(t) return t; throw 0; });
      }).then(function(text){ if(my!==trSeq) return; renderTranslate(q, text, tl); })
        .catch(function(){ if(my===trSeq){ var o=els.res.querySelector('[data-sec="tr"]'); if(o) o.remove(); } });
    }, 500);
  }
  function renderTranslate(q, text, tl){
    var old=els.res.querySelector('[data-sec="tr"]'); if(old) old.remove();
    if(!text || text.toLowerCase()===q.toLowerCase()) return;
    var s=section('翻訳 → '+(tl==='en'?'English':'日本語')); s.c.setAttribute('data-sec','tr');
    var row=el('button','sd-tr'); row.type='button';
    row.appendChild(el('div','trt', text));
    row.appendChild(el('div','trs', q));
    row.addEventListener('click', function(ev){ ev.stopPropagation();   // ★タップ=TTS(サマンサ英文1.1x→0.1s後にKyoko日本語1.2x)
      var en=(tl==='en')?text:q, ja=(tl==='en')?q:text;
      speakPair(en, ja);
      try{ navigator.clipboard.writeText(text); }catch(_){}
      try{ cb.haptic&&cb.haptic(); }catch(_){} });
    s.rows.appendChild(row);
    els.res.insertBefore(s.c, els.res.firstChild);
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ row.classList.add('in'); }); });
  }

  function filterApps(q){
    var ql=q.toLowerCase();
    var hits=0;
    Array.prototype.forEach.call(els.apps.children, function(b){
      if(b.classList.contains('sd-gone')) return;   /* gone=検索にも出ない */
      if(!ql || (b.getAttribute('data-nm')||'').indexOf(ql)>=0) hits++;
    });
    /* ★app一覧は常に(結果の下に)出す: 名前が合えば絞り込み・1件も合わなければ全部表示。
       __searchOnly(隠しapp)は「名前が検索に合った時」だけ出る=何もなければ出ない */
    var showAll=(!ql || hits===0);
    Array.prototype.forEach.call(els.apps.children, function(b){
      if(b.classList.contains('sd-gone')){ b.classList.add('hide'); return; }
      var match=!!ql && (b.getAttribute('data-nm')||'').indexOf(ql)>=0;
      var hit=b.__searchOnly ? match : (showAll || match);
      b.classList.toggle('hide', !hit);
    });
    /* ★displayはCSSに任せる(通常=grid / 検索中=横1行flex)。ここでinline指定するとレイアウト切替アニメが効かない */
  }

  /* ★検索で1行になった時: 表示中のアプリだけを右から1個ずつ0.3sでスライドイン(stagger) */
  function playRowSlide(){ try{ var vis=0; Array.prototype.forEach.call(els.apps.children, function(b){
      if(b.classList.contains('hide') || b.classList.contains('sd-gone')) return;
      b.style.animation='none'; void b.offsetWidth;
      b.style.animation='sdAppSlideX .3s cubic-bezier(.16,1,.3,1) both';
      b.style.animationDelay=(vis*55)+'ms'; vis++; }); }catch(_){} }
  /* ★4列グリッドへ戻る時: inlineアニメを外してCSSの出現アニメへ戻す */
  function clearRowSlide(){ try{ Array.prototype.forEach.call(els.apps.children, function(b){ b.style.animation=''; b.style.animationDelay=''; }); }catch(_){} }

  /* ═══ 長押し→ドラッグでアプリ並び替え(iOS風): ゴーストが指に追従・他タイルはFLIPで滑らかに詰める・ジグル・順序を保存 ═══ */
  var reorder=(function(){
    var grid=null, dragging=false, supUntil=0;
    var ghost=null, ph=null, sx=0, sy=0, lastSwap=0, lastX=0, lastY=0;
    function blockScroll(e){ if(dragging){ try{ if(e.cancelable) e.preventDefault(); }catch(_){} } }
    function flip(mut){
      var kids=Array.prototype.slice.call(grid.children).map(function(c){ return [c, c.getBoundingClientRect()]; });
      mut();
      kids.forEach(function(p){ var c=p[0], b=p[1], a=c.getBoundingClientRect();
        var dx=b.left-a.left, dy=b.top-a.top; if(!dx&&!dy) return;
        c.style.transition='none'; c.style.transform='translate('+dx+'px,'+dy+'px)';
        requestAnimationFrame(function(){ c.style.transition='transform .3s cubic-bezier(.22,1,.36,1)'; c.style.transform='';
          setTimeout(function(){ c.style.transition=''; },330); }); });
    }
    function start(t, e){
      dragging=true; try{ cb.haptic&&cb.haptic(); }catch(_){}
      grid.classList.add('sd-editing');
      if(els.scroll) els.scroll.style.overflowY='hidden';
      var r=t.getBoundingClientRect(); sx=e.clientX; sy=e.clientY;
      ghost=t.cloneNode(true); ghost.className='sd-app sd-ghost';
      ghost.style.cssText='position:fixed;left:'+r.left+'px;top:'+r.top+'px;width:'+r.width+'px;margin:0;z-index:99999;pointer-events:none;opacity:1;transform:scale(1.14);transition:transform .18s cubic-bezier(.22,1,.36,1);filter:drop-shadow(0 14px 28px rgba(0,0,0,.45))';
      document.body.appendChild(ghost);
      ph=t; ph.classList.add('sd-ph');
    }
    function move(e){ if(!dragging||!ghost) return;
      lastX=e.clientX; lastY=e.clientY;
      ghost.style.transform='translate('+(e.clientX-sx)+'px,'+(e.clientY-sy)+'px) scale(1.14)';
      /* ★左端(ドック)にかざしたら: ドックを開いて(既存アイコンが消えない)ドロップ先リングをぽって出す＋ゴーストも光る */
      try{ var _dk=document.getElementById('gcDock'); if(_dk){ var _dr=_dk.getBoundingClientRect(); var _over=(lastX < Math.max(_dr.right+34,96));
        ghost.style.filter=_over?'drop-shadow(0 0 0 3px rgba(124,192,255,.9)) drop-shadow(0 14px 28px rgba(0,0,0,.45))':'drop-shadow(0 14px 28px rgba(0,0,0,.45))';
        if(_over){ if(!_dk.classList.contains('show')) _dk.classList.add('show'); _dk.classList.add('open'); _dk.classList.add('gcdk-drop'); } else { _dk.classList.remove('gcdk-drop'); } } }catch(_){}
      var now=Date.now(); if(now-lastSwap<90) return;
      var kids=Array.prototype.slice.call(grid.children);
      for(var i=0;i<kids.length;i++){ var c=kids[i]; if(c===ph||c.classList.contains('hide')) continue;
        var kr=c.getBoundingClientRect();
        if(e.clientX>=kr.left&&e.clientX<=kr.right&&e.clientY>=kr.top&&e.clientY<=kr.bottom){
          lastSwap=now;
          var pIdx=kids.indexOf(ph), tIdx=i;
          flip(function(){ if(pIdx<tIdx){ grid.insertBefore(ph, c.nextSibling); } else { grid.insertBefore(ph, c); } });
          try{ cb.haptic&&cb.haptic(); }catch(_){}
          break; } }
    }
    function end(){ if(!dragging) return; dragging=false; supUntil=Date.now()+350;
      /* ★左端(ドック)にドロップ=そのアプリをドックに追加(iOS風・元タイルはグリッドに残す) */
      try{ var _dk=document.getElementById('gcDock');
        if(_dk && ph && window.__gcAddDockApp){ var _dr=_dk.getBoundingClientRect();
          if(lastX < Math.max(_dr.right+34,96)){
            var _fr=ph.getAttribute('data-fr');
            if(_fr){ window.__gcAddDockApp({ f:_fr, n:ph.getAttribute('data-nm-raw')||'友達', av:ph.getAttribute('data-av')||'🙂', c:ph.getAttribute('data-c')||'#62d8ff' }); }   // ★友達タイル→ドック
            else { var _nm=ph.getAttribute('data-nm-raw')||''; var _ie=ph.querySelector('img.ic'); var _is=_ie?(_ie.getAttribute('src')||''):'';
              if(_nm){ window.__gcAddDockApp({n:_nm, i:_is}); } } } _dk.classList.remove('gcdk-drop'); } }catch(_){}
      grid.classList.remove('sd-editing');
      if(els.scroll) els.scroll.style.overflowY='';
      if(ghost&&ph){ var pr=ph.getBoundingClientRect(), gr=ghost.getBoundingClientRect();
        ghost.style.transition='transform .28s cubic-bezier(.22,1,.36,1), opacity .28s';
        ghost.style.transform='translate('+(pr.left-parseFloat(ghost.style.left))+'px,'+(pr.top-parseFloat(ghost.style.top))+'px) scale(1)';
        (function(g){ setTimeout(function(){ try{ g.remove(); }catch(_){} },300); })(ghost); }
      else if(ghost){ try{ ghost.remove(); }catch(_){} }
      if(ph){ (function(p){ setTimeout(function(){ p.classList.remove('sd-ph'); },260); })(ph); }
      ghost=null; ph=null;
      try{ var names=Array.prototype.map.call(grid.children,function(c){ return c.getAttribute('data-nm-raw'); }).filter(Boolean);
        localStorage.setItem('sd_app_order', JSON.stringify(names)); }catch(_){}
    }
    function attach(g){ if(grid) return; grid=g;
      document.addEventListener('touchmove', blockScroll, {passive:false});
      var lpT=null, px0=0, py0=0, cand=null;
      grid.addEventListener('pointerdown', function(e){ var t=e.target.closest&&e.target.closest('.sd-app'); if(!t) return;
        cand=t; px0=e.clientX; py0=e.clientY;
        clearTimeout(lpT); lpT=setTimeout(function(){ if(cand){ start(cand, {clientX:px0, clientY:py0}); } }, 430); });
      grid.addEventListener('pointermove', function(e){
        if(!dragging){ if(cand && (Math.abs(e.clientX-px0)>9||Math.abs(e.clientY-py0)>9)){ clearTimeout(lpT); cand=null; } return; }
        move(e); });
      window.addEventListener('pointerup', function(){ clearTimeout(lpT); cand=null; end(); });
      window.addEventListener('pointercancel', function(){ clearTimeout(lpT); cand=null; end(); });
    }
    return { attach:attach, sup:function(){ return dragging || Date.now()<supUntil; } };
  })();

  function section(title){ var c=el('div'); c.appendChild(el('div','sd-cat',title)); var rows=el('div','sd-rows'); c.appendChild(rows); return {c:c, rows:rows}; }

  function renderFriends(q){
    var old=els.res.querySelector('[data-sec="fr"]'); if(old) old.remove();
    if(!q) return;
    var list=[]; try{ list=(cb.chatSearch&&cb.chatSearch(q))||[]; }catch(_){}
    if(!list.length) return;
    var s=section('連絡先・追加'); s.c.setAttribute('data-sec','fr');
    list.forEach(function(r){
      var row=el('button','sd-row'); row.type='button';
      var art=el('div','rart', r.icon||'💬');
      var meta=el('div','rmeta'); meta.appendChild(el('div','rt', r.name||'')); meta.appendChild(el('div','rs', r.sub||''));
      row.appendChild(art); row.appendChild(meta);
      row.addEventListener('click', function(ev){ ev.stopPropagation(); try{ cb.haptic&&cb.haptic(); }catch(_){} try{ cb.chatOpen&&cb.chatOpen(r.uid); }catch(_){} });
      s.rows.appendChild(row);
    });
    els.res.insertBefore(s.c, els.res.firstChild);
    slideRows(s.rows);
  }
  /* ★結果行は枠なし+slideupで順に出る */
  function slideRows(rows){ try{ Array.prototype.forEach.call(rows.querySelectorAll('.sd-row'), function(r,i){
    r.style.transitionDelay=(i*36)+'ms';
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ r.classList.add('in'); }); }); }); }catch(_){} }
  /* ★翻訳/英単語のタップ=TTS(サマンサが英文1.1x→0.1秒後にKyokoが日本語1.2x) */
  function speakPair(en, ja){ try{ var ss=window.speechSynthesis; if(!ss) return; ss.cancel();
    var vs=ss.getVoices()||[];
    function pick(nm,lang){ for(var i=0;i<vs.length;i++){ if((vs[i].name||'').indexOf(nm)>=0) return vs[i]; }
      for(var j=0;j<vs.length;j++){ if((vs[j].lang||'').indexOf(lang)===0) return vs[j]; } return null; }
    if(en){ var u1=new SpeechSynthesisUtterance(en); u1.rate=1.1; u1.lang='en-US'; var v1=pick('Samantha','en'); if(v1)u1.voice=v1; ss.speak(u1); }
    setTimeout(function(){ if(!ja) return; var u2=new SpeechSynthesisUtterance(ja); u2.rate=1.2; u2.lang='ja-JP'; var v2=pick('Kyoko','ja'); if(v2)u2.voice=v2; ss.speak(u2); },100);
  }catch(_){} }

  function scheduleMusic(q){
    clearTimeout(musicTimer);
    var old=els.res.querySelector('[data-sec="mu"]');
    if(q.length<2){ if(old) old.remove(); musicSeq++; return; }
    var my=++musicSeq;
    musicTimer=setTimeout(function(){
      if(!cb.musicSearch) return;
      var sp=els.res.querySelector('[data-sec="mu-spin"]');
      if(!sp && !old){ sp=el('div','sd-spin'); sp.setAttribute('data-sec','mu-spin'); sp.innerHTML='<div class="gc-spin" style="width:34px;height:34px"></div>'; els.res.appendChild(sp);
        requestAnimationFrame(function(){ requestAnimationFrame(function(){ sp.classList.add('in'); }); }); }   // ★0.3sで伸びてinput+appsを下へ押す+自身もscale/opacity
      cb.musicSearch(q).then(function(list){
        if(my!==musicSeq) return;
        renderMusic(list||[]);
      }).catch(function(){ if(my===musicSeq) renderMusic([]); });
    }, 350);
  }

  function renderMusic(list){
    var sp=els.res.querySelector('[data-sec="mu-spin"]'); if(sp){ sp.classList.remove('in'); (function(s){ setTimeout(function(){ try{ s.remove(); }catch(_){} },300); })(sp); }   // ★0.3sで縮んで消える
    var old=els.res.querySelector('[data-sec="mu"]'); if(old) old.remove();
    if(!list.length) return;
    var s=section('ミュージック'); s.c.setAttribute('data-sec','mu');
    list.slice(0,30).forEach(function(t){
      var row=el('button','sd-row'); row.type='button';
      /* ★hostのmusicSearchは{id,title,artist,art,preview}へ変換済み。iTunes生形(trackName等)も両対応=曲名が確実に出る */
      var ttl=t.title||t.trackName||'', art0=t.art||t.artworkUrl100||'', artist=t.artist||t.artistName||'';
      var artUrl=String(art0).replace('100x100','300x300');
      var art;
      if(artUrl){ art=document.createElement('img'); art.className='rart'; art.src=artUrl; art.alt=''; art.loading='lazy';
        art.onerror=function(){ var d=el('div','rart','♪'); this.replaceWith(d); }; }
      else { art=el('div','rart','♪'); }
      var meta=el('div','rmeta');
      meta.appendChild(el('div','rt', ttl));
      meta.appendChild(el('div','rs', artist+(t.collectionName?(' · '+t.collectionName):'')));
      row.appendChild(art); row.appendChild(meta);
      /* ♥ お気に入り(1曲だけ)=Purple Music廃止後の設定経路。押すとプロフィールへ共有 */
      if(cb.setFav){ var fv=null; try{ fv=cb.getFav&&cb.getFav(); }catch(_){}
        var on=!!(fv && ((fv.id&&String(fv.id)===String(t.id||t.trackId)) || ((fv.title||'')===ttl && (fv.artist||'')===artist)));
        var hb=el('button','sd-heart'+(on?' on':''), on?'♥':'♡'); hb.type='button'; hb.setAttribute('aria-label','お気に入りに設定');
        hb.addEventListener('click', function(ev){ ev.stopPropagation(); try{ cb.haptic&&cb.haptic(); }catch(_){}
          try{ cb.setFav(on?null:t); }catch(_){} renderMusic(list); });
        row.appendChild(hb); }
      row.addEventListener('click', function(ev){ ev.stopPropagation(); try{ cb.haptic&&cb.haptic(); }catch(_){} try{ cb.playMusic&&cb.playMusic(t); }catch(_){} });
      s.rows.appendChild(row);
    });
    els.res.appendChild(s.c);
    slideRows(s.rows);
  }

  window.SearchDeck={
    init: function(opts){ cb=opts||{}; },
    open: function(o){
      build();
      try{ syncFriendTiles(); }catch(_){}   // ★友達タイルを最新化(追加/削除/名前変更に追従)
      /* ★開くたびに gone() を評価(classic切替/再生状態/environment変更に追従) */
      try{ Array.prototype.forEach.call(els.apps.children, function(b){ b.classList.toggle('sd-gone', !!(b.__gone && b.__gone())); }); }catch(_){}
      if(els.input){ els.input.value=''; setBarHas(); }
      /* ★入力が空なのにapps1行のまま残る不具合の修正: 開くたびに検索状態(sd-searching)を確実に解除しグリッドへ戻す */
      try{ var _ov=document.getElementById('searchOv'); if(_ov) _ov.classList.remove('sd-searching'); }catch(_){}
      _wasSearching=false; try{ clearRowSlide(); }catch(_){}
      filterApps(''); renderFriends(''); renderMusic([]); renderGraph('',null);
      trSeq++; vocSeq++; var oldTr=els.res&&els.res.querySelector('[data-sec="tr"]'); if(oldTr) oldTr.remove();
      var oldVx=els.res&&els.res.querySelector('[data-sec="vx"]'); if(oldVx) oldVx.remove();
      var oldSp=els.res&&els.res.querySelector('[data-sec="mu-spin"]'); if(oldSp) oldSp.remove();
      // アプリタイルの出現アニメを毎回リプレイ
      try{ Array.prototype.forEach.call(els.apps.children, function(b,i){ b.style.animation='none'; void b.offsetWidth; b.style.animation=''; b.style.animationDelay=(i*35)+'ms'; }); }catch(_){}
      if(o&&o.focus){ setTimeout(function(){ try{ els.input.focus(); }catch(_){} }, 280); }
    },
    close: function(){ try{ if(els.input) els.input.blur(); }catch(_){} }
  };
})();
