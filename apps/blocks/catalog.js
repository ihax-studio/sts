/* =====================================================
   Story Dock — Visual Block Catalog (102 blocks)
   各ブロック:
     id, cat, label, icon, tone, kind: 'stmt'|'value',
     params: [{key, kind, placeholder, default, options?}],
     slots:  [{key, label, optional?}],
     js(p, slots), swift(p, slots) -> string
   ===================================================== */
(() => {

  const CATEGORIES = [
    { id:'data_create', label:'変数',       tone:'c-data',  group:'データ' },
    { id:'data_text',   label:'テキスト',   tone:'c-text',  group:'データ' },
    { id:'data_num',    label:'数値',       tone:'c-num',   group:'データ' },
    { id:'data_list',   label:'リスト',     tone:'c-list',  group:'データ' },
    { id:'data_dict',   label:'辞書',       tone:'c-dict',  group:'データ' },
    { id:'data_type',   label:'型・判定',   tone:'c-data',  group:'データ' },
    { id:'data_json',   label:'JSON',       tone:'c-data',  group:'データ' },
    { id:'logic_branch',label:'分岐',       tone:'c-logic', group:'ロジック' },
    { id:'logic_loop',  label:'くりかえし', tone:'c-loop',  group:'ロジック' },
    { id:'logic_fn',    label:'関数',       tone:'c-fn',    group:'ロジック' },
    { id:'logic_err',   label:'エラー',     tone:'c-logic', group:'ロジック' },
    { id:'logic_async', label:'非同期',     tone:'c-logic', group:'ロジック' },
    { id:'calc',        label:'計算・比較', tone:'c-num',   group:'演算' },
    { id:'ui_elem',     label:'要素',       tone:'c-ui',    group:'画面' },
    { id:'ui_style',    label:'スタイル',   tone:'c-style', group:'画面' },
    { id:'ui_img',      label:'画像',       tone:'c-img',   group:'画面' },
    { id:'ui_input',    label:'入力',       tone:'c-input', group:'画面' },
    { id:'anim',        label:'アニメ',     tone:'c-anim',  group:'画面' },
    { id:'scroll',      label:'スクロール', tone:'c-scroll',group:'画面' },
    { id:'event',       label:'イベント',   tone:'c-event', group:'反応' },
    { id:'fb',          label:'フィードバック', tone:'c-fb', group:'反応' },
    { id:'net',         label:'通信・保存', tone:'c-net',   group:'外部' },
    { id:'time',        label:'時間',       tone:'c-time',  group:'時' },
    { id:'date',        label:'日付・書式', tone:'c-date',  group:'時' },
    { id:'dialog',      label:'ダイアログ', tone:'c-dialog',group:'反応' },
    { id:'resp',        label:'レスポンシブ', tone:'c-resp', group:'画面' },
    { id:'nav',         label:'ナビ',       tone:'c-nav',   group:'外部' },
    { id:'share',       label:'共有',       tone:'c-share', group:'外部' },
    { id:'a11y',        label:'A11y',       tone:'c-a11y',  group:'外部' },
    { id:'debug',       label:'デバッグ',   tone:'c-debug', group:'デバッグ' },
    { id:'acquire',     label:'取得',       tone:'c-acq',   group:'取得' },
  ];

  // helpers
  const q = (s) => (s === undefined || s === null || s === '') ? '""' : s;
  const sq = (s) => '"' + String(s).replace(/"/g,'\\"') + '"';

  const BLOCKS = [
    // ============ 1. 変数 ============
    { id:'d_let', cat:'data_create', label:'変数をつくる <name> = <value>', icon:'＋', kind:'stmt',
      params:[
        { key:'name', kind:'ident', placeholder:'x', default:'x', declares:true },
        { key:'value', kind:'expr', placeholder:'0', default:'0' },
      ],
      js:(p)=>`let ${p.name} = ${p.value};`,
      swift:(p)=>`var ${p.name} = ${p.value}`,
    },
    { id:'d_const', cat:'data_create', label:'定数をつくる <name> = <value>', icon:'＝', kind:'stmt',
      params:[
        { key:'name', kind:'ident', placeholder:'PI', default:'PI', declares:true },
        { key:'value', kind:'expr', placeholder:'3.14', default:'3.14' },
      ],
      js:(p)=>`const ${p.name} = ${p.value};`,
      swift:(p)=>`let ${p.name} = ${p.value}`,
    },
    { id:'d_set', cat:'data_create', label:'<name> に <value> を代入', icon:'→', kind:'stmt',
      params:[
        { key:'name', kind:'var', placeholder:'x', default:'x' },
        { key:'value', kind:'expr', placeholder:'10', default:'10' },
      ],
      js:(p)=>`${p.name} = ${p.value};`,
      swift:(p)=>`${p.name} = ${p.value}`,
    },
    { id:'d_flag', cat:'data_create', label:'フラグ <name> を <bool> にする', icon:'⚑', kind:'stmt',
      params:[
        { key:'name', kind:'ident', placeholder:'flag', default:'flag', declares:true },
        { key:'bool', kind:'select', options:['true','false'], default:'true' },
      ],
      js:(p)=>`let ${p.name} = ${p.bool};`,
      swift:(p)=>`var ${p.name} = ${p.bool}`,
    },
    { id:'d_toggle', cat:'data_create', label:'<name> を反転する', icon:'⇄', kind:'stmt',
      params:[ { key:'name', kind:'var', placeholder:'flag', default:'flag' } ],
      js:(p)=>`${p.name} = !${p.name};`,
      swift:(p)=>`${p.name}.toggle()`,
    },

    // ============ 2. テキスト ============
    { id:'t_concat', cat:'data_text', label:'テンプレ文字列 → <out>', icon:'¶', kind:'value',
      params:[
        { key:'out', kind:'ident', placeholder:'text', default:'text', declares:true },
        { key:'tpl', kind:'text', placeholder:'${name}さん こんにちは', default:'${name}さん こんにちは' },
      ],
      js:(p)=>`let ${p.out} = \`${p.tpl}\`;`,
      swift:(p)=>{
        const swift = p.tpl.replace(/\$\{([^}]+)\}/g, (_,e)=>`\\(${e})`);
        return `let ${p.out} = "${swift}"`;
      },
    },
    { id:'t_transform', cat:'data_text', label:'<src> を <op> → <out>', icon:'Aa', kind:'value',
      params:[
        { key:'out', kind:'ident', default:'text', declares:true },
        { key:'src', kind:'expr', default:'text' },
        { key:'op', kind:'select', options:['upper','lower','trim','reverse'], default:'upper' },
      ],
      js:(p)=>{
        switch (p.op) {
          case 'upper':   return `let ${p.out} = String(${p.src}).toUpperCase();`;
          case 'lower':   return `let ${p.out} = String(${p.src}).toLowerCase();`;
          case 'trim':    return `let ${p.out} = String(${p.src}).trim();`;
          case 'reverse': return `let ${p.out} = String(${p.src}).split("").reverse().join("");`;
        }
      },
      swift:(p)=>{
        switch (p.op) {
          case 'upper':   return `let ${p.out} = String(${p.src}).uppercased()`;
          case 'lower':   return `let ${p.out} = String(${p.src}).lowercased()`;
          case 'trim':    return `let ${p.out} = String(${p.src}).trimmingCharacters(in: .whitespaces)`;
          case 'reverse': return `let ${p.out} = String(String(${p.src}).reversed())`;
        }
      },
    },
    { id:'t_length', cat:'data_text', label:'<src> の文字数 → <out>', icon:'|n|', kind:'value',
      params:[
        { key:'out', kind:'ident', default:'len', declares:true },
        { key:'src', kind:'expr', default:'text' },
      ],
      js:(p)=>`let ${p.out} = String(${p.src}).length;`,
      swift:(p)=>`let ${p.out} = String(${p.src}).count`,
    },
    { id:'t_slice', cat:'data_text', label:'<src> の [<from>..<to>] → <out>', icon:'⋯', kind:'value',
      params:[
        { key:'out', kind:'ident', default:'sub', declares:true },
        { key:'src', kind:'expr', default:'text' },
        { key:'from', kind:'expr', default:'0' },
        { key:'to', kind:'expr', default:'3' },
      ],
      js:(p)=>`let ${p.out} = String(${p.src}).slice(${p.from}, ${p.to});`,
      swift:(p)=>`let ${p.out} = String(${p.src}).dropFirst(${p.from}).prefix(${p.to} - ${p.from})`,
    },

    // ============ 3. 数値 ============
    { id:'n_convert', cat:'data_num', label:'<src> を <op> → <out>', icon:'#', kind:'value',
      params:[
        { key:'out', kind:'ident', default:'n', declares:true },
        { key:'src', kind:'expr', default:'"3.7"' },
        { key:'op', kind:'select', options:['int','floor','round','ceil','fixed2'], default:'int' },
      ],
      js:(p)=>{
        switch(p.op){
          case 'int': return `let ${p.out} = parseInt(${p.src}, 10);`;
          case 'floor': return `let ${p.out} = Math.floor(${p.src});`;
          case 'round': return `let ${p.out} = Math.round(${p.src});`;
          case 'ceil': return `let ${p.out} = Math.ceil(${p.src});`;
          case 'fixed2': return `let ${p.out} = Number(${p.src}).toFixed(2);`;
        }
      },
      swift:(p)=>{
        switch(p.op){
          case 'int': return `let ${p.out} = Int(String(${p.src})) ?? 0`;
          case 'floor': return `let ${p.out} = floor(Double(${p.src}))`;
          case 'round': return `let ${p.out} = (Double(${p.src})).rounded()`;
          case 'ceil':  return `let ${p.out} = ceil(Double(${p.src}))`;
          case 'fixed2':return `let ${p.out} = String(format: "%.2f", Double(${p.src}))`;
        }
      },
    },
    { id:'n_random', cat:'data_num', label:'乱数 [<from>..<to>] → <out>', icon:'🎲', kind:'value',
      params:[
        { key:'out', kind:'ident', default:'r', declares:true },
        { key:'from', kind:'expr', default:'0' },
        { key:'to', kind:'expr', default:'10' },
      ],
      js:(p)=>`let ${p.out} = Math.floor(Math.random() * (${p.to} - ${p.from} + 1)) + ${p.from};`,
      swift:(p)=>`let ${p.out} = Int.random(in: ${p.from}...${p.to})`,
    },
    { id:'n_clamp', cat:'data_num', label:'<src> を <min>..<max> に制限 → <out>', icon:'⇔', kind:'value',
      params:[
        { key:'out', kind:'ident', default:'c', declares:true },
        { key:'src', kind:'expr', default:'x' },
        { key:'min', kind:'expr', default:'0' },
        { key:'max', kind:'expr', default:'100' },
      ],
      js:(p)=>`let ${p.out} = Math.min(Math.max(${p.src}, ${p.min}), ${p.max});`,
      swift:(p)=>`let ${p.out} = min(max(${p.src}, ${p.min}), ${p.max})`,
    },

    // ============ 4. リスト ============
    { id:'l_array', cat:'data_list', label:'リスト <name> = [<items>]', icon:'[]', kind:'stmt',
      params:[
        { key:'name', kind:'ident', default:'list', declares:true },
        { key:'items', kind:'text', default:'1, 2, 3', placeholder:'1, 2, 3' },
      ],
      js:(p)=>`let ${p.name} = [${p.items}];`,
      swift:(p)=>`var ${p.name}: [Any] = [${p.items}]`,
    },
    { id:'l_mutate', cat:'data_list', label:'<list> に <op> <value>', icon:'±', kind:'stmt',
      params:[
        { key:'list', kind:'var', default:'list' },
        { key:'op', kind:'select', options:['push','pop','shift','removeAt'], default:'push' },
        { key:'value', kind:'expr', default:'0' },
      ],
      js:(p)=>{
        switch(p.op){
          case 'push':     return `${p.list}.push(${p.value});`;
          case 'pop':      return `${p.list}.pop();`;
          case 'shift':    return `${p.list}.shift();`;
          case 'removeAt': return `${p.list}.splice(${p.value}, 1);`;
        }
      },
      swift:(p)=>{
        switch(p.op){
          case 'push':     return `${p.list}.append(${p.value})`;
          case 'pop':      return `_ = ${p.list}.popLast()`;
          case 'shift':    return `${p.list}.removeFirst()`;
          case 'removeAt': return `${p.list}.remove(at: ${p.value})`;
        }
      },
    },
    { id:'l_find', cat:'data_list', label:'<list> から <op> <value> → <out>', icon:'🔍', kind:'value',
      params:[
        { key:'out', kind:'ident', default:'found', declares:true },
        { key:'list', kind:'var', default:'list' },
        { key:'op', kind:'select', options:['indexOf','includes','first'], default:'indexOf' },
        { key:'value', kind:'expr', default:'0' },
      ],
      js:(p)=>{
        if (p.op==='indexOf')  return `let ${p.out} = ${p.list}.indexOf(${p.value});`;
        if (p.op==='includes') return `let ${p.out} = ${p.list}.includes(${p.value});`;
        if (p.op==='first')    return `let ${p.out} = ${p.list}[0];`;
      },
      swift:(p)=>{
        if (p.op==='indexOf')  return `let ${p.out} = ${p.list}.firstIndex(where: { ($0 as AnyObject) === (${p.value} as AnyObject) })`;
        if (p.op==='includes') return `let ${p.out} = ${p.list}.contains(where: { ($0 as AnyObject) === (${p.value} as AnyObject) })`;
        if (p.op==='first')    return `let ${p.out} = ${p.list}.first`;
      },
    },
    { id:'l_sort', cat:'data_list', label:'<list> を <op> → <out>', icon:'↕', kind:'value',
      params:[
        { key:'out', kind:'ident', default:'sorted', declares:true },
        { key:'list', kind:'var', default:'list' },
        { key:'op', kind:'select', options:['sort','reverse','shuffle'], default:'sort' },
      ],
      js:(p)=>{
        if (p.op==='sort')    return `let ${p.out} = [...${p.list}].sort();`;
        if (p.op==='reverse') return `let ${p.out} = [...${p.list}].reverse();`;
        return `let ${p.out} = [...${p.list}].sort(()=>Math.random()-.5);`;
      },
      swift:(p)=>{
        if (p.op==='sort')    return `let ${p.out} = ${p.list}.sorted { "\\($0)" < "\\($1)" }`;
        if (p.op==='reverse') return `let ${p.out} = Array(${p.list}.reversed())`;
        return `let ${p.out} = ${p.list}.shuffled()`;
      },
    },
    { id:'l_length', cat:'data_list', label:'<list> の長さ → <out>', icon:'|n|', kind:'value',
      params:[
        { key:'out', kind:'ident', default:'n', declares:true },
        { key:'list', kind:'var', default:'list' },
      ],
      js:(p)=>`let ${p.out} = ${p.list}.length;`,
      swift:(p)=>`let ${p.out} = ${p.list}.count`,
    },
    { id:'l_map', cat:'data_list', label:'<list> の各要素を <expr> に → <out>', icon:'→', kind:'value',
      params:[
        { key:'out', kind:'ident', default:'mapped', declares:true },
        { key:'list', kind:'var', default:'list' },
        { key:'arg', kind:'ident', default:'x' },
        { key:'expr', kind:'expr', default:'x * 2' },
      ],
      js:(p)=>`let ${p.out} = ${p.list}.map((${p.arg}) => ${p.expr});`,
      swift:(p)=>`let ${p.out} = ${p.list}.map { ${p.arg} in ${p.expr} }`,
    },

    // ============ 5. 辞書 ============
    { id:'m_obj', cat:'data_dict', label:'辞書 <name> = {<pairs>}', icon:'{}', kind:'stmt',
      params:[
        { key:'name', kind:'ident', default:'obj', declares:true },
        { key:'pairs', kind:'text', default:'a:1, b:2', placeholder:'key:value, ...' },
      ],
      js:(p)=>`let ${p.name} = { ${p.pairs} };`,
      swift:(p)=>`var ${p.name}: [String: Any] = [${p.pairs.split(',').map(kv=>{
        const [k,v] = kv.split(':').map(s=>s.trim());
        return `"${k}": ${v}`;
      }).join(', ')}]`,
    },
    { id:'m_get', cat:'data_dict', label:'<dict>[<key>] → <out>', icon:'•', kind:'value',
      params:[
        { key:'out', kind:'ident', default:'v', declares:true },
        { key:'dict', kind:'var', default:'obj' },
        { key:'key', kind:'expr', default:'"a"' },
      ],
      js:(p)=>`let ${p.out} = ${p.dict}[${p.key}];`,
      swift:(p)=>`let ${p.out} = ${p.dict}[${p.key}]`,
    },
    { id:'m_keys', cat:'data_dict', label:'<dict> のキー一覧 → <out>', icon:'⌷', kind:'value',
      params:[
        { key:'out', kind:'ident', default:'keys', declares:true },
        { key:'dict', kind:'var', default:'obj' },
      ],
      js:(p)=>`let ${p.out} = Object.keys(${p.dict});`,
      swift:(p)=>`let ${p.out} = Array(${p.dict}.keys)`,
    },

    // ============ 6. 型・判定 ============
    { id:'y_typeof', cat:'data_type', label:'<src> の型 → <out>', icon:'τ', kind:'value',
      params:[
        { key:'out', kind:'ident', default:'t', declares:true },
        { key:'src', kind:'expr', default:'x' },
      ],
      js:(p)=>`let ${p.out} = Array.isArray(${p.src}) ? 'array' : typeof ${p.src};`,
      swift:(p)=>`let ${p.out} = String(describing: type(of: ${p.src}))`,
    },
    { id:'y_isnil', cat:'data_type', label:'<src> は無い？ → <out>', icon:'∅', kind:'value',
      params:[
        { key:'out', kind:'ident', default:'isNil', declares:true },
        { key:'src', kind:'expr', default:'x' },
      ],
      js:(p)=>`let ${p.out} = (${p.src} === null || ${p.src} === undefined);`,
      swift:(p)=>`let ${p.out} = (${p.src} == nil)`,
    },

    // ============ 7. JSON ============
    { id:'j_stringify', cat:'data_json', label:'<src> を JSON文字列 → <out>', icon:'{ }', kind:'value',
      params:[
        { key:'out', kind:'ident', default:'json', declares:true },
        { key:'src', kind:'expr', default:'obj' },
      ],
      js:(p)=>`let ${p.out} = JSON.stringify(${p.src});`,
      swift:(p)=>`let ${p.out} = String(data: try! JSONSerialization.data(withJSONObject: ${p.src}), encoding: .utf8) ?? ""`,
    },
    { id:'j_parse', cat:'data_json', label:'<src> を JSONから戻す → <out>', icon:'} {', kind:'value',
      params:[
        { key:'out', kind:'ident', default:'obj', declares:true },
        { key:'src', kind:'expr', default:'json' },
      ],
      js:(p)=>`let ${p.out} = JSON.parse(${p.src});`,
      swift:(p)=>`let ${p.out} = try! JSONSerialization.jsonObject(with: Data((${p.src}).utf8))`,
    },

    // ============ 8. 分岐 ============
    { id:'if_block', cat:'logic_branch', label:'もし <cond> なら', icon:'?', kind:'stmt',
      params:[{ key:'cond', kind:'expr', default:'x > 0' }],
      slots:[{ key:'then', label:'なら' }, { key:'else', label:'そうでなければ', optional:true }],
      js:(p,s)=>`if (${p.cond}) {\n${s.then}\n}${s.else?.trim() ? ` else {\n${s.else}\n}`:''}`,
      swift:(p,s)=>`if ${p.cond} {\n${s.then}\n}${s.else?.trim() ? ` else {\n${s.else}\n}`:''}`,
    },
    { id:'switch_block', cat:'logic_branch', label:'<src> で分岐 (<cases>)', icon:'⊞', kind:'stmt',
      params:[
        { key:'src', kind:'expr', default:'x' },
        { key:'cases', kind:'text', default:'1, 2, default', placeholder:'1, 2, default' },
      ],
      slots:[{ key:'body', label:'ケースごと (順番に並べる)' }],
      js:(p,s)=>{
        const arr = p.cases.split(',').map(c=>c.trim());
        const body = (s.body||'').split('\n');
        const each = Math.ceil(body.length / arr.length);
        const cases = arr.map((c,i)=>{
          const part = body.slice(i*each, (i+1)*each).join('\n');
          if (c==='default') return `default:\n${part}\n  break;`;
          return `case ${c}:\n${part}\n  break;`;
        }).join('\n');
        return `switch (${p.src}) {\n${cases}\n}`;
      },
      swift:(p,s)=>{
        const arr = p.cases.split(',').map(c=>c.trim());
        const body = (s.body||'').split('\n');
        const each = Math.ceil(body.length / arr.length);
        const cases = arr.map((c,i)=>{
          const part = body.slice(i*each, (i+1)*each).join('\n');
          if (c==='default') return `default:\n${part}`;
          return `case ${c}:\n${part}`;
        }).join('\n');
        return `switch ${p.src} {\n${cases}\n}`;
      },
    },
    { id:'range_check', cat:'logic_branch', label:'<src> は <a>..<b> ？ → <out>', icon:'⟦⟧', kind:'value',
      params:[
        { key:'out', kind:'ident', default:'inRange', declares:true },
        { key:'src', kind:'expr', default:'x' },
        { key:'a', kind:'expr', default:'0' },
        { key:'b', kind:'expr', default:'100' },
      ],
      js:(p)=>`let ${p.out} = (${p.src} >= ${p.a} && ${p.src} <= ${p.b});`,
      swift:(p)=>`let ${p.out} = (${p.a}...${p.b}).contains(${p.src})`,
    },

    // ============ 9. くりかえし ============
    { id:'for_count', cat:'logic_loop', label:'<n> 回くりかえす (<i>)', icon:'⟲', kind:'stmt',
      params:[
        { key:'i', kind:'ident', default:'i' },
        { key:'n', kind:'expr', default:'10' },
      ],
      slots:[{ key:'body', label:'本体' }],
      js:(p,s)=>`for (let ${p.i} = 0; ${p.i} < ${p.n}; ${p.i}++) {\n${s.body}\n}`,
      swift:(p,s)=>`for ${p.i} in 0..<${p.n} {\n${s.body}\n}`,
    },
    { id:'while_block', cat:'logic_loop', label:'<cond> の間くりかえす', icon:'∞', kind:'stmt',
      params:[{ key:'cond', kind:'expr', default:'x > 0' }],
      slots:[{ key:'body', label:'本体' }],
      js:(p,s)=>`while (${p.cond}) {\n${s.body}\n}`,
      swift:(p,s)=>`while ${p.cond} {\n${s.body}\n}`,
    },
    { id:'foreach', cat:'logic_loop', label:'<list> の各 <item> で…', icon:'⊕', kind:'stmt',
      params:[
        { key:'item', kind:'ident', default:'item' },
        { key:'list', kind:'var', default:'list' },
      ],
      slots:[{ key:'body', label:'本体' }],
      js:(p,s)=>`for (const ${p.item} of ${p.list}) {\n${s.body}\n}`,
      swift:(p,s)=>`for ${p.item} in ${p.list} {\n${s.body}\n}`,
    },
    { id:'lp_break',    cat:'logic_loop', label:'くりかえしを止める', icon:'■', kind:'stmt',
      params:[], js:()=>`break;`, swift:()=>`break`,
    },
    { id:'lp_continue', cat:'logic_loop', label:'次へスキップ', icon:'»', kind:'stmt',
      params:[], js:()=>`continue;`, swift:()=>`continue`,
    },

    // ============ 10. 関数 ============
    { id:'fn_def', cat:'logic_fn', label:'関数 <name>(<args>) をつくる', icon:'ƒ', kind:'stmt',
      params:[
        { key:'name', kind:'ident', default:'greet', declares:true },
        { key:'args', kind:'text', default:'name', placeholder:'a, b' },
      ],
      slots:[{ key:'body', label:'本体' }],
      js:(p,s)=>`function ${p.name}(${p.args}) {\n${s.body}\n}`,
      swift:(p,s)=>`func ${p.name}(${p.args.split(',').map(a=>{const t=a.trim();return t?`_ ${t}: Any`:''}).filter(Boolean).join(', ')}) {\n${s.body}\n}`,
    },
    { id:'fn_call', cat:'logic_fn', label:'関数 <name>(<args>) を呼ぶ → <out>', icon:'()', kind:'value',
      params:[
        { key:'out', kind:'ident', default:'r', declares:true },
        { key:'name', kind:'ident', default:'greet' },
        { key:'args', kind:'text', default:'"hi"', placeholder:'引数' },
      ],
      js:(p)=>`let ${p.out} = ${p.name}(${p.args});`,
      swift:(p)=>`let ${p.out} = ${p.name}(${p.args})`,
    },
    { id:'fn_return', cat:'logic_fn', label:'<value> を返す', icon:'↩', kind:'stmt',
      params:[{ key:'value', kind:'expr', default:'null' }],
      js:(p)=>`return ${p.value};`,
      swift:(p)=>`return ${p.value}`,
    },

    // ============ 11. エラー ============
    { id:'try_catch', cat:'logic_err', label:'try / catch (<err>)', icon:'⚠', kind:'stmt',
      params:[{ key:'err', kind:'ident', default:'err' }],
      slots:[{ key:'try', label:'試す' }, { key:'catch', label:'失敗したら' }],
      js:(p,s)=>`try {\n${s.try}\n} catch (${p.err}) {\n${s.catch}\n}`,
      swift:(p,s)=>`do {\n${s.try}\n} catch let ${p.err} {\n${s.catch}\n}`,
    },

    // ============ 12. 非同期 ============
    { id:'await_call', cat:'logic_async', label:'<expr> を待つ → <out>', icon:'⏳', kind:'value',
      params:[
        { key:'out', kind:'ident', default:'res', declares:true },
        { key:'expr', kind:'expr', default:'fetch(url)' },
      ],
      js:(p)=>`let ${p.out} = await ${p.expr};`,
      swift:(p)=>`let ${p.out} = try await ${p.expr}`,
    },

    // ============ 13. 計算・比較 ============
    { id:'calc_op', cat:'calc', label:'<a> <op> <b> → <out>', icon:'＝', kind:'value',
      params:[
        { key:'out', kind:'ident', default:'r', declares:true },
        { key:'a', kind:'expr', default:'1' },
        { key:'op', kind:'select', options:['+','-','*','/','%','**'], default:'+' },
        { key:'b', kind:'expr', default:'2' },
      ],
      js:(p)=>`let ${p.out} = ${p.a} ${p.op} ${p.b};`,
      swift:(p)=>`let ${p.out} = ${p.a} ${p.op} ${p.b}`,
    },
    { id:'compare_op', cat:'calc', label:'<a> <op> <b> → <out>', icon:'⋚', kind:'value',
      params:[
        { key:'out', kind:'ident', default:'ok', declares:true },
        { key:'a', kind:'expr', default:'x' },
        { key:'op', kind:'select', options:['===','!==','>','<','>=','<=','&&','||'], default:'===' },
        { key:'b', kind:'expr', default:'1' },
      ],
      js:(p)=>`let ${p.out} = (${p.a} ${p.op} ${p.b});`,
      swift:(p)=>`let ${p.out} = (${p.a} ${p.op==='==='?'==':p.op==='!=='?'!=':p.op} ${p.b})`,
    },

    // ============ 14. 要素 ============
    { id:'ui_create', cat:'ui_elem', label:'要素 <tag> をつくる #<id>', icon:'▢', kind:'stmt',
      params:[
        { key:'tag', kind:'select', options:['div','span','button','p','h1','h2','section'], default:'div' },
        { key:'id', kind:'ident', default:'box', declares:true },
        { key:'text', kind:'text', default:'Hello' },
      ],
      js:(p)=>`const ${p.id} = document.createElement('${p.tag}');\n${p.id}.id = '${p.id}';\n${p.id}.textContent = ${JSON.stringify(p.text)};\ndocument.body.appendChild(${p.id});`,
      swift:(p)=>`// SwiftUI:\nText("${p.text}")  // id: ${p.id}`,
    },
    { id:'ui_settext', cat:'ui_elem', label:'#<id> のテキストを <text> に', icon:'Ⓣ', kind:'stmt',
      params:[
        { key:'id', kind:'var', default:'box' },
        { key:'text', kind:'expr', default:'"Hi"' },
      ],
      js:(p)=>`document.getElementById('${p.id}').textContent = ${p.text};`,
      swift:(p)=>`${p.id} = ${p.text} // @State var ${p.id}: String`,
    },
    { id:'ui_show', cat:'ui_elem', label:'画面 <name> を表示', icon:'▣', kind:'stmt',
      params:[{ key:'name', kind:'text', default:'Detail' }],
      js:(p)=>`document.body.dataset.screen = ${JSON.stringify(p.name)};`,
      swift:(p)=>`navigationPath.append("${p.name}")`,
    },
    { id:'ui_popup', cat:'ui_elem', label:'ポップアップ <name> を出す', icon:'◳', kind:'stmt',
      params:[{ key:'name', kind:'text', default:'Settings' }],
      js:(p)=>`document.body.dataset.modal = ${JSON.stringify(p.name)};`,
      swift:(p)=>`presentedSheet = "${p.name}"`,
    },
    { id:'ui_remove', cat:'ui_elem', label:'#<id> を削除', icon:'⊖', kind:'stmt',
      params:[{ key:'id', kind:'ident', default:'box' }],
      js:(p)=>`document.getElementById('${p.id}')?.remove();`,
      swift:(p)=>`items.removeAll { $0.id == "${p.id}" }`,
    },

    // ============ 15. スタイル ============
    { id:'s_set', cat:'ui_style', label:'#<id>.<prop> = <value>', icon:'✦', kind:'stmt',
      params:[
        { key:'id', kind:'ident', default:'box' },
        { key:'prop', kind:'select', options:['color','background','fontSize','opacity','transform','borderRadius'], default:'color' },
        { key:'value', kind:'text', default:'red' },
      ],
      js:(p)=>`document.getElementById('${p.id}').style.${p.prop} = ${JSON.stringify(p.value)};`,
      swift:(p)=>`// modifier: .${p.prop}("${p.value}")`,
    },
    { id:'s_stack', cat:'ui_style', label:'#<id> を <dir> に並べる', icon:'⫶', kind:'stmt',
      params:[
        { key:'id', kind:'ident', default:'box' },
        { key:'dir', kind:'select', options:['row','column','center','grid'], default:'column' },
      ],
      js:(p)=>{
        if (p.dir==='grid') return `document.getElementById('${p.id}').style.display='grid';`;
        if (p.dir==='center') return `Object.assign(document.getElementById('${p.id}').style, { display:'flex', justifyContent:'center', alignItems:'center' });`;
        return `Object.assign(document.getElementById('${p.id}').style, { display:'flex', flexDirection:'${p.dir}' });`;
      },
      swift:(p)=>{
        if (p.dir==='row') return `HStack { /* children */ }`;
        if (p.dir==='column') return `VStack { /* children */ }`;
        if (p.dir==='center') return `ZStack { /* children */ }`;
        return `LazyVGrid(columns: [GridItem(.flexible())]) { /* children */ }`;
      },
    },
    { id:'s_pad', cat:'ui_style', label:'#<id> 余白 <pad>, サイズ <w>x<h>', icon:'⊞', kind:'stmt',
      params:[
        { key:'id', kind:'ident', default:'box' },
        { key:'pad', kind:'text', default:'12px' },
        { key:'w', kind:'text', default:'auto' },
        { key:'h', kind:'text', default:'auto' },
      ],
      js:(p)=>`Object.assign(document.getElementById('${p.id}').style, { padding:'${p.pad}', width:'${p.w}', height:'${p.h}' });`,
      swift:(p)=>`/* .padding(${p.pad}).frame(width: ${p.w}, height: ${p.h}) */`,
    },
    { id:'s_visible', cat:'ui_style', label:'#<id> を <state>', icon:'◎', kind:'stmt',
      params:[
        { key:'id', kind:'ident', default:'box' },
        { key:'state', kind:'select', options:['show','hide'], default:'show' },
      ],
      js:(p)=>`document.getElementById('${p.id}').style.display = '${p.state==='show'?'':'none'}';`,
      swift:(p)=>`isVisible_${p.id} = ${p.state==='show'?'true':'false'}`,
    },

    // ============ 16. 画像 ============
    { id:'img_show', cat:'ui_img', label:'画像 <url> を #<id> に', icon:'▦', kind:'stmt',
      params:[
        { key:'id', kind:'ident', default:'pic' },
        { key:'url', kind:'text', default:'https://placekitten.com/200/200' },
      ],
      js:(p)=>`(()=>{ const i=document.getElementById('${p.id}')||document.createElement('img'); i.id='${p.id}'; i.src=${JSON.stringify(p.url)}; if(!i.parentNode) document.body.appendChild(i); })();`,
      swift:(p)=>`AsyncImage(url: URL(string: "${p.url}"))`,
    },
    { id:'img_bg', cat:'ui_img', label:'背景 #<id> を <bg> に', icon:'▩', kind:'stmt',
      params:[
        { key:'id', kind:'ident', default:'box' },
        { key:'bg', kind:'text', default:'linear-gradient(135deg,#5ac8fa22,#af52de22)' },
      ],
      js:(p)=>`document.getElementById('${p.id}').style.background = ${JSON.stringify(p.bg)};`,
      swift:(p)=>`.background(LinearGradient(...))`,
    },

    // ============ 17. 入力 ============
    { id:'in_field', cat:'ui_input', label:'入力欄 #<id> placeholder=<ph>', icon:'⎚', kind:'stmt',
      params:[
        { key:'id', kind:'ident', default:'name', declares:true },
        { key:'ph', kind:'text', default:'name' },
      ],
      js:(p)=>`(()=>{ const e=document.createElement('input'); e.id='${p.id}'; e.placeholder=${JSON.stringify(p.ph)}; document.body.appendChild(e); })();`,
      swift:(p)=>`TextField("${p.ph}", text: $${p.id})`,
    },
    { id:'in_value', cat:'ui_input', label:'#<id> の値 → <out>', icon:'⌨', kind:'value',
      params:[
        { key:'out', kind:'ident', default:'v', declares:true },
        { key:'id', kind:'ident', default:'name' },
      ],
      js:(p)=>`let ${p.out} = document.getElementById('${p.id}').value;`,
      swift:(p)=>`let ${p.out} = ${p.id}`,
    },
    { id:'in_clone', cat:'ui_input', label:'#<id> を <n> 個複製', icon:'⊕', kind:'stmt',
      params:[
        { key:'id', kind:'ident', default:'card' },
        { key:'n', kind:'expr', default:'3' },
      ],
      js:(p)=>`(()=>{ const o=document.getElementById('${p.id}'); for(let i=0;i<${p.n};i++){ const c=o.cloneNode(true); c.id='${p.id}_'+i; o.parentNode.appendChild(c); } })();`,
      swift:(p)=>`ForEach(0..<${p.n}, id: \\.self) { _ in /* ${p.id} */ }`,
    },

    // ============ 18. アニメ ============
    { id:'a_fade', cat:'anim', label:'#<id> を <dir> フェード <ms>ms', icon:'☼', kind:'stmt',
      params:[
        { key:'id', kind:'ident', default:'box' },
        { key:'dir', kind:'select', options:['in','out'], default:'in' },
        { key:'ms', kind:'expr', default:'400' },
      ],
      js:(p)=>`(()=>{ const e=document.getElementById('${p.id}'); e.style.transition='opacity ${p.ms}ms'; e.style.opacity=${p.dir==='in'?'1':'0'}; })();`,
      swift:(p)=>`withAnimation(.easeInOut(duration: ${p.ms}/1000)) { isVisible_${p.id} = ${p.dir==='in'?'true':'false'} }`,
    },
    { id:'a_slide', cat:'anim', label:'#<id> を <dir> スライド <px>px', icon:'➜', kind:'stmt',
      params:[
        { key:'id', kind:'ident', default:'box' },
        { key:'dir', kind:'select', options:['x','y'], default:'x' },
        { key:'px', kind:'expr', default:'100' },
      ],
      js:(p)=>`(()=>{ const e=document.getElementById('${p.id}'); e.style.transition='transform .35s'; e.style.transform='translate${p.dir.toUpperCase()}(${p.px}px)'; })();`,
      swift:(p)=>`.offset(${p.dir}: ${p.px})`,
    },
    { id:'a_scale', cat:'anim', label:'#<id> をスケール <n>', icon:'⤢', kind:'stmt',
      params:[
        { key:'id', kind:'ident', default:'box' },
        { key:'n', kind:'expr', default:'1.2' },
      ],
      js:(p)=>`(()=>{ const e=document.getElementById('${p.id}'); e.style.transition='transform .25s'; e.style.transform='scale(${p.n})'; })();`,
      swift:(p)=>`.scaleEffect(${p.n})`,
    },
    { id:'a_delay', cat:'anim', label:'<ms>ms 待つ', icon:'⏱', kind:'stmt',
      params:[{ key:'ms', kind:'expr', default:'500' }],
      js:(p)=>`await new Promise(r=>setTimeout(r, ${p.ms}));`,
      swift:(p)=>`try await Task.sleep(nanoseconds: UInt64(${p.ms}) * 1_000_000)`,
    },
    { id:'a_sequence', cat:'anim', label:'順に実行', icon:'⇶', kind:'stmt',
      params:[], slots:[{ key:'body', label:'順番に' }],
      js:(p,s)=>`(async () => {\n${s.body}\n})();`,
      swift:(p,s)=>`Task {\n${s.body}\n}`,
    },

    // ============ 19. スクロール ============
    { id:'sc_detect', cat:'scroll', label:'#<id> がスクロールで見えたら…', icon:'⤓', kind:'stmt',
      params:[{ key:'id', kind:'ident', default:'box' }],
      slots:[{ key:'body', label:'見えたとき' }],
      js:(p,s)=>`new IntersectionObserver((es)=>{ if (es.some(e=>e.isIntersecting)) {\n${s.body}\n} }).observe(document.getElementById('${p.id}'));`,
      swift:(p,s)=>`.onAppear { /* ${p.id} */ \n${s.body}\n }`,
    },
    { id:'sc_to', cat:'scroll', label:'#<id> までスクロール', icon:'⇩', kind:'stmt',
      params:[{ key:'id', kind:'ident', default:'box' }],
      js:(p)=>`document.getElementById('${p.id}').scrollIntoView({ behavior:'smooth' });`,
      swift:(p)=>`proxy.scrollTo("${p.id}", anchor: .top)`,
    },
    { id:'sc_anchor', cat:'scroll', label:'#<id> にアンカー設定', icon:'⚓', kind:'stmt',
      params:[{ key:'id', kind:'ident', default:'box' }],
      js:(p)=>`location.hash = '${p.id}';`,
      swift:(p)=>`.id("${p.id}")`,
    },

    // ============ 20. イベント ============
    { id:'e_on', cat:'event', label:'#<id> が <ev> されたら…', icon:'⨀', kind:'stmt',
      params:[
        { key:'id', kind:'ident', default:'btn' },
        { key:'ev', kind:'select', options:['click','dblclick','mouseenter','mouseleave','input','change'], default:'click' },
      ],
      slots:[{ key:'body', label:'そのとき' }],
      js:(p,s)=>`document.getElementById('${p.id}').addEventListener('${p.ev}', () => {\n${s.body}\n});`,
      swift:(p,s)=>`.onTapGesture {\n${s.body}\n}`,
    },
    { id:'e_timer', cat:'event', label:'<ms>ms ごとに繰り返す', icon:'⏲', kind:'stmt',
      params:[{ key:'ms', kind:'expr', default:'1000' }],
      slots:[{ key:'body', label:'毎回' }],
      js:(p,s)=>`setInterval(() => {\n${s.body}\n}, ${p.ms});`,
      swift:(p,s)=>`Timer.scheduledTimer(withTimeInterval: Double(${p.ms})/1000, repeats: true) { _ in\n${s.body}\n}`,
    },
    { id:'e_keyboard', cat:'event', label:'キー <key> が押されたら…', icon:'⌨', kind:'stmt',
      params:[{ key:'key', kind:'text', default:'Enter' }],
      slots:[{ key:'body', label:'そのとき' }],
      js:(p,s)=>`window.addEventListener('keydown', (ev) => { if (ev.key === ${JSON.stringify(p.key)}) {\n${s.body}\n} });`,
      swift:(p,s)=>`.onKeyPress(.${p.key.toLowerCase()}) {\n${s.body}\nreturn .handled\n}`,
    },
    { id:'e_swipe', cat:'event', label:'#<id> を <dir> スワイプしたら…', icon:'⇨', kind:'stmt',
      params:[
        { key:'id', kind:'ident', default:'box' },
        { key:'dir', kind:'select', options:['left','right','up','down'], default:'left' },
      ],
      slots:[{ key:'body', label:'そのとき' }],
      js:(p,s)=>`(()=>{ let sx=0,sy=0; const e=document.getElementById('${p.id}');
e.addEventListener('touchstart',t=>{sx=t.touches[0].clientX;sy=t.touches[0].clientY;});
e.addEventListener('touchend',t=>{ const dx=t.changedTouches[0].clientX-sx; const dy=t.changedTouches[0].clientY-sy;
  const d = Math.abs(dx)>Math.abs(dy) ? (dx<0?'left':'right') : (dy<0?'up':'down');
  if (d==='${p.dir}') {\n${s.body}\n}}); })();`,
      swift:(p,s)=>`.gesture(DragGesture().onEnded { _ in\n${s.body}\n})`,
    },
    { id:'e_msg', cat:'event', label:'メッセージ <name> を <dir>', icon:'⌬', kind:'stmt',
      params:[
        { key:'name', kind:'text', default:'ping' },
        { key:'dir', kind:'select', options:['post','listen'], default:'post' },
      ],
      slots:[{ key:'body', label:'受け取ったとき', optional:true }],
      js:(p,s)=>p.dir==='post'
        ? `window.dispatchEvent(new CustomEvent(${JSON.stringify(p.name)}));`
        : `window.addEventListener(${JSON.stringify(p.name)}, () => {\n${s.body||''}\n});`,
      swift:(p,s)=>p.dir==='post'
        ? `NotificationCenter.default.post(name: .init("${p.name}"), object: nil)`
        : `NotificationCenter.default.addObserver(forName: .init("${p.name}"), object: nil, queue: .main) { _ in\n${s.body||''}\n}`,
    },
    { id:'e_load', cat:'event', label:'ページ読み込み時…', icon:'⏏', kind:'stmt',
      params:[], slots:[{ key:'body', label:'起動時' }],
      js:(p,s)=>`document.addEventListener('DOMContentLoaded', () => {\n${s.body}\n});`,
      swift:(p,s)=>`.onAppear {\n${s.body}\n}`,
    },

    // ============ 21. フィードバック ============
    { id:'fb_vibrate', cat:'fb', label:'振動 <kind>', icon:'≋', kind:'stmt',
      params:[{ key:'kind', kind:'select', options:['light','medium','heavy'], default:'light' }],
      js:(p)=>{
        const map = { light: 10, medium: 30, heavy: 60 };
        return `navigator.vibrate && navigator.vibrate(${map[p.kind]||10});`;
      },
      swift:(p)=>`UIImpactFeedbackGenerator(style: .${p.kind}).impactOccurred()`,
    },
    { id:'fb_sound', cat:'fb', label:'音を鳴らす <url>', icon:'♪', kind:'stmt',
      params:[{ key:'url', kind:'text', default:'https://actions.google.com/sounds/v1/cartoon/clang_and_wobble.ogg' }],
      js:(p)=>`new Audio(${JSON.stringify(p.url)}).play();`,
      swift:(p)=>`AVAudioPlayer(contentsOf: URL(string: "${p.url}")!).play()`,
    },
    { id:'fb_shake', cat:'fb', label:'シェイク検知 → ', icon:'≈', kind:'stmt',
      params:[], slots:[{ key:'body', label:'振られたとき' }],
      js:(p,s)=>`(()=>{ let last=0; window.addEventListener('devicemotion',e=>{ const a=e.accelerationIncludingGravity; const g=Math.hypot(a.x,a.y,a.z); const now=Date.now(); if (g>20 && now-last>500){ last=now;\n${s.body}\n}}); })();`,
      swift:(p,s)=>`// motionEnded(.motionShake) {\n${s.body}\n}`,
    },
    { id:'fb_speak', cat:'fb', label:'<text> を読み上げ', icon:'🔊', kind:'stmt',
      params:[{ key:'text', kind:'expr', default:'"hello"' }],
      js:(p)=>`speechSynthesis.speak(new SpeechSynthesisUtterance(${p.text}));`,
      swift:(p)=>`AVSpeechSynthesizer().speak(AVSpeechUtterance(string: ${p.text}))`,
    },

    // ============ 22. 通信・保存 ============
    { id:'net_save', cat:'net', label:'保存: <key> = <value>', icon:'💾', kind:'stmt',
      params:[
        { key:'key', kind:'text', default:'token' },
        { key:'value', kind:'expr', default:'"abc"' },
      ],
      js:(p)=>`localStorage.setItem(${JSON.stringify(p.key)}, JSON.stringify(${p.value}));`,
      swift:(p)=>`UserDefaults.standard.set(${p.value}, forKey: "${p.key}")`,
    },
    { id:'net_load', cat:'net', label:'読み込み: <key> → <out>', icon:'📂', kind:'value',
      params:[
        { key:'out', kind:'ident', default:'v', declares:true },
        { key:'key', kind:'text', default:'token' },
      ],
      js:(p)=>`let ${p.out} = JSON.parse(localStorage.getItem(${JSON.stringify(p.key)})||"null");`,
      swift:(p)=>`let ${p.out} = UserDefaults.standard.object(forKey: "${p.key}")`,
    },
    { id:'net_remove', cat:'net', label:'削除: <key>', icon:'🗑', kind:'stmt',
      params:[{ key:'key', kind:'text', default:'token' }],
      js:(p)=>`localStorage.removeItem(${JSON.stringify(p.key)});`,
      swift:(p)=>`UserDefaults.standard.removeObject(forKey: "${p.key}")`,
    },
    { id:'net_get', cat:'net', label:'GET <url> → <out>', icon:'⇣', kind:'value',
      params:[
        { key:'out', kind:'ident', default:'res', declares:true },
        { key:'url', kind:'text', default:'https://example.com/api' },
      ],
      js:(p)=>`let ${p.out} = await (await fetch(${JSON.stringify(p.url)})).json();`,
      swift:(p)=>`let ${p.out} = try await URLSession.shared.data(from: URL(string: "${p.url}")!).0`,
    },
    { id:'net_post', cat:'net', label:'POST <url> body=<body> → <out>', icon:'⇡', kind:'value',
      params:[
        { key:'out', kind:'ident', default:'res', declares:true },
        { key:'url', kind:'text', default:'https://example.com/api' },
        { key:'body', kind:'expr', default:'{ a: 1 }' },
      ],
      js:(p)=>`let ${p.out} = await (await fetch(${JSON.stringify(p.url)}, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(${p.body}) })).json();`,
      swift:(p)=>`var req = URLRequest(url: URL(string: "${p.url}")!); req.httpMethod = "POST"; req.httpBody = try JSONSerialization.data(withJSONObject: ${p.body});\nlet ${p.out} = try await URLSession.shared.data(for: req).0`,
    },
    { id:'net_cookie', cat:'net', label:'クッキー <op> <key>=<value>', icon:'🍪', kind:'stmt',
      params:[
        { key:'op', kind:'select', options:['set','read'], default:'set' },
        { key:'key', kind:'text', default:'sid' },
        { key:'value', kind:'expr', default:'"abc"' },
      ],
      js:(p)=>p.op==='set'
        ? `document.cookie = ${JSON.stringify(p.key)} + '=' + encodeURIComponent(${p.value}) + ';path=/';`
        : `let _cv = (document.cookie.match(new RegExp('${p.key}=([^;]+)'))||[])[1];`,
      swift:(p)=>p.op==='set'
        ? `HTTPCookieStorage.shared.setCookie(HTTPCookie(properties: [.name:"${p.key}", .value: "\\(${p.value})", .path:"/", .domain:""])!)`
        : `let _cv = HTTPCookieStorage.shared.cookies?.first { $0.name == "${p.key}" }?.value`,
    },

    // ============ 23. 時間 ============
    { id:'t_now', cat:'time', label:'現在時刻 → <out>', icon:'🕒', kind:'value',
      params:[{ key:'out', kind:'ident', default:'now', declares:true }],
      js:(p)=>`let ${p.out} = Date.now();`,
      swift:(p)=>`let ${p.out} = Date()`,
    },
    { id:'t_countdown', cat:'time', label:'<sec>秒カウントダウン → <out>', icon:'⏳', kind:'stmt',
      params:[
        { key:'out', kind:'ident', default:'left', declares:true },
        { key:'sec', kind:'expr', default:'10' },
      ],
      slots:[{ key:'body', label:'毎秒' }, { key:'end', label:'終了時', optional:true }],
      js:(p,s)=>`let ${p.out} = ${p.sec};\n(()=>{ const _t = setInterval(()=>{ ${p.out}--;\n${s.body}\nif (${p.out}<=0) { clearInterval(_t);\n${s.end||''}\n} }, 1000); })();`,
      swift:(p,s)=>`var ${p.out} = ${p.sec}\nTimer.scheduledTimer(withTimeInterval: 1, repeats: true) { t in ${p.out} -= 1\n${s.body}\nif ${p.out} <= 0 { t.invalidate();\n${s.end||''}\n} }`,
    },
    { id:'t_elapsed', cat:'time', label:'経過時間 <start>〜今 → <out>', icon:'⌛', kind:'value',
      params:[
        { key:'out', kind:'ident', default:'el', declares:true },
        { key:'start', kind:'expr', default:'startedAt' },
      ],
      js:(p)=>`let ${p.out} = Date.now() - ${p.start};`,
      swift:(p)=>`let ${p.out} = Date().timeIntervalSince(${p.start})`,
    },

    // ============ 24. 日付・書式 ============
    { id:'d_format', cat:'date', label:'日付 <src> を <fmt> で → <out>', icon:'📅', kind:'value',
      params:[
        { key:'out', kind:'ident', default:'s', declares:true },
        { key:'src', kind:'expr', default:'new Date()' },
        { key:'fmt', kind:'select', options:['short','long','iso','time'], default:'short' },
      ],
      js:(p)=>{
        if (p.fmt==='iso') return `let ${p.out} = new Date(${p.src}).toISOString();`;
        if (p.fmt==='time') return `let ${p.out} = new Date(${p.src}).toLocaleTimeString('ja-JP');`;
        const style = p.fmt==='long' ? 'long' : 'short';
        return `let ${p.out} = new Date(${p.src}).toLocaleDateString('ja-JP', { dateStyle: '${style}' });`;
      },
      swift:(p)=>`let ${p.out} = (${p.src}).formatted(date: .${p.fmt==='long'?'long':'abbreviated'}, time: .${p.fmt==='time'?'shortened':'omitted'})`,
    },
    { id:'d_calc', cat:'date', label:'日付 <src> に <n> <unit> 足す → <out>', icon:'➕', kind:'value',
      params:[
        { key:'out', kind:'ident', default:'d', declares:true },
        { key:'src', kind:'expr', default:'new Date()' },
        { key:'n', kind:'expr', default:'1' },
        { key:'unit', kind:'select', options:['day','hour','minute'], default:'day' },
      ],
      js:(p)=>{
        const ms = p.unit==='day' ? '86400000' : p.unit==='hour' ? '3600000' : '60000';
        return `let ${p.out} = new Date(new Date(${p.src}).getTime() + ${p.n}*${ms});`;
      },
      swift:(p)=>`let ${p.out} = Calendar.current.date(byAdding: .${p.unit}, value: ${p.n}, to: ${p.src})!`,
    },

    // ============ 25. ダイアログ ============
    { id:'dg_alert', cat:'dialog', label:'アラート <msg>', icon:'❕', kind:'stmt',
      params:[{ key:'msg', kind:'expr', default:'"完了しました"' }],
      js:(p)=>`alert(${p.msg});`,
      swift:(p)=>`showAlert = true; alertMsg = ${p.msg}`,
    },
    { id:'dg_prompt', cat:'dialog', label:'入力ダイアログ <msg> → <out>', icon:'❓', kind:'value',
      params:[
        { key:'out', kind:'ident', default:'ans', declares:true },
        { key:'msg', kind:'expr', default:'"名前は？"' },
      ],
      js:(p)=>`let ${p.out} = prompt(${p.msg});`,
      swift:(p)=>`var ${p.out}: String = "" // .alert with TextField`,
    },
    { id:'dg_confirm', cat:'dialog', label:'はい/いいえ <msg> → <out>', icon:'❔', kind:'value',
      params:[
        { key:'out', kind:'ident', default:'ok', declares:true },
        { key:'msg', kind:'expr', default:'"よろしいですか？"' },
      ],
      js:(p)=>`let ${p.out} = confirm(${p.msg});`,
      swift:(p)=>`var ${p.out}: Bool = false // .confirmationDialog`,
    },
    { id:'dg_toast', cat:'dialog', label:'トースト <msg> <ms>ms', icon:'🍞', kind:'stmt',
      params:[
        { key:'msg', kind:'expr', default:'"保存しました"' },
        { key:'ms', kind:'expr', default:'1500' },
      ],
      js:(p)=>`(()=>{ const t=document.createElement('div'); t.textContent=${p.msg}; Object.assign(t.style,{position:'fixed',left:'50%',bottom:'40px',transform:'translateX(-50%)',background:'rgba(0,0,0,.8)',color:'#fff',padding:'10px 16px',borderRadius:'12px',zIndex:9999,font:'600 13px system-ui'}); document.body.appendChild(t); setTimeout(()=>t.remove(), ${p.ms}); })();`,
      swift:(p)=>`// custom toast overlay (${p.ms}ms)`,
    },
    { id:'dg_beforeunload', cat:'dialog', label:'閉じる時に警告', icon:'⏹', kind:'stmt',
      params:[],
      js:()=>`window.addEventListener('beforeunload', (e)=>{ e.preventDefault(); e.returnValue=''; });`,
      swift:()=>`// scenePhase: .onChange(of: scenePhase) { ... }`,
    },

    // ============ 26. レスポンシブ ============
    { id:'rp_size', cat:'resp', label:'画面サイズが <op> <px>px なら…', icon:'📐', kind:'stmt',
      params:[
        { key:'op', kind:'select', options:['<','>','<=','>='], default:'<' },
        { key:'px', kind:'expr', default:'768' },
      ],
      slots:[{ key:'body', label:'そのとき' }],
      js:(p,s)=>`if (window.matchMedia(\`(max-width: \${${p.px}}px)\`).matches) {\n${s.body}\n}`,
      swift:(p,s)=>`if horizontalSizeClass == .compact {\n${s.body}\n}`,
    },
    { id:'rp_orient', cat:'resp', label:'<orient> のときに…', icon:'🔄', kind:'stmt',
      params:[{ key:'orient', kind:'select', options:['portrait','landscape'], default:'portrait' }],
      slots:[{ key:'body', label:'そのとき' }],
      js:(p,s)=>`if (matchMedia('(orientation: ${p.orient})').matches) {\n${s.body}\n}`,
      swift:(p,s)=>`if verticalSizeClass == .${p.orient==='portrait'?'regular':'compact'} {\n${s.body}\n}`,
    },
    { id:'rp_safe', cat:'resp', label:'Safe Area を <op>', icon:'▭', kind:'stmt',
      params:[{ key:'op', kind:'select', options:['apply','ignore'], default:'apply' }],
      js:(p)=>p.op==='apply'
        ? `document.body.style.paddingTop = 'env(safe-area-inset-top)';`
        : `document.body.style.padding = '0';`,
      swift:(p)=>p.op==='apply' ? `.safeAreaInset(edge: .top) { Color.clear.frame(height: 0) }` : `.ignoresSafeArea()`,
    },
    { id:'rp_font', cat:'resp', label:'#<id> フォント <min>〜<max>px 自動', icon:'Aa', kind:'stmt',
      params:[
        { key:'id', kind:'ident', default:'box' },
        { key:'min', kind:'expr', default:'14' },
        { key:'max', kind:'expr', default:'22' },
      ],
      js:(p)=>`document.getElementById('${p.id}').style.fontSize = \`clamp(\${${p.min}}px, 2vw, \${${p.max}}px)\`;`,
      swift:(p)=>`.minimumScaleFactor(${p.min}/${p.max})`,
    },

    // ============ 27. ナビ ============
    { id:'nv_goto', cat:'nav', label:'<url> に飛ばす', icon:'⇪', kind:'stmt',
      params:[{ key:'url', kind:'text', default:'https://apple.com' }],
      js:(p)=>`location.href = ${JSON.stringify(p.url)};`,
      swift:(p)=>`UIApplication.shared.open(URL(string: "${p.url}")!)`,
    },
    { id:'nv_back', cat:'nav', label:'戻る', icon:'↩', kind:'stmt',
      params:[],
      js:()=>`history.back();`,
      swift:()=>`dismiss()`,
    },
    { id:'nv_query', cat:'nav', label:'URL ?<key> → <out>', icon:'?=', kind:'value',
      params:[
        { key:'out', kind:'ident', default:'v', declares:true },
        { key:'key', kind:'text', default:'id' },
      ],
      js:(p)=>`let ${p.out} = new URLSearchParams(location.search).get(${JSON.stringify(p.key)});`,
      swift:(p)=>`let ${p.out} = URLComponents(string: url)?.queryItems?.first { $0.name == "${p.key}" }?.value`,
    },
    { id:'nv_switch', cat:'nav', label:'ページ <name> に切替', icon:'▶', kind:'stmt',
      params:[{ key:'name', kind:'text', default:'home' }],
      js:(p)=>`document.querySelectorAll('[data-page]').forEach(el => el.style.display = (el.dataset.page === ${JSON.stringify(p.name)} ? '' : 'none'));`,
      swift:(p)=>`path.append("${p.name}")`,
    },

    // ============ 28. 共有 ============
    { id:'sh_share', cat:'share', label:'共有 <text>', icon:'⇪', kind:'stmt',
      params:[{ key:'text', kind:'expr', default:'"Story Dock"' }],
      js:(p)=>`navigator.share && navigator.share({ text: ${p.text} });`,
      swift:(p)=>`ShareLink(item: ${p.text})`,
    },
    { id:'sh_copy', cat:'share', label:'<text> をコピー', icon:'⎘', kind:'stmt',
      params:[{ key:'text', kind:'expr', default:'"hello"' }],
      js:(p)=>`navigator.clipboard.writeText(String(${p.text}));`,
      swift:(p)=>`UIPasteboard.general.string = "\\(${p.text})"`,
    },
    { id:'sh_open', cat:'share', label:'<url> を新規タブで開く', icon:'⤴', kind:'stmt',
      params:[{ key:'url', kind:'text', default:'https://apple.com' }],
      js:(p)=>`window.open(${JSON.stringify(p.url)}, '_blank');`,
      swift:(p)=>`UIApplication.shared.open(URL(string: "${p.url}")!)`,
    },

    // ============ 29. A11y ============
    { id:'ax_dark', cat:'a11y', label:'ダークモードか → <out>', icon:'☾', kind:'value',
      params:[{ key:'out', kind:'ident', default:'isDark', declares:true }],
      js:(p)=>`let ${p.out} = matchMedia('(prefers-color-scheme: dark)').matches;`,
      swift:(p)=>`@Environment(\\.colorScheme) var colorScheme; let ${p.out} = (colorScheme == .dark)`,
    },
    { id:'ax_motion', cat:'a11y', label:'視覚効果を減らすか → <out>', icon:'∿', kind:'value',
      params:[{ key:'out', kind:'ident', default:'isReduced', declares:true }],
      js:(p)=>`let ${p.out} = matchMedia('(prefers-reduced-motion: reduce)').matches;`,
      swift:(p)=>`@Environment(\\.accessibilityReduceMotion) var reduce; let ${p.out} = reduce`,
    },

    // ============ 30. デバッグ ============
    { id:'db_log', cat:'debug', label:'ログ <value>', icon:'⌬', kind:'stmt',
      params:[{ key:'value', kind:'expr', default:'"hello"' }],
      js:(p)=>`console.log(${p.value});`,
      swift:(p)=>`print(${p.value})`,
    },
    { id:'db_comment', cat:'debug', label:'コメント <text>', icon:'⍝', kind:'stmt',
      params:[{ key:'text', kind:'text', default:'TODO' }],
      js:(p)=>`// ${p.text}`,
      swift:(p)=>`// ${p.text}`,
    },

    // ============ 31. 取得 (sensors / device input) ============
    { id:'acq_mic', cat:'acquire', label:'マイクで <sec>秒 録音 → <out>', icon:'🎙', kind:'value',
      params:[
        { key:'out', kind:'ident', default:'audio', declares:true },
        { key:'sec', kind:'expr', default:'3' },
      ],
      js:(p)=>`let ${p.out} = await new Promise(async (res, rej) => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream);
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = () => { stream.getTracks().forEach(t=>t.stop()); res(new Blob(chunks, { type: 'audio/webm' })); };
    rec.start();
    setTimeout(() => rec.stop(), ${p.sec} * 1000);
  } catch (e) { rej(e); }
});`,
      swift:(p)=>`let ${p.out} = try await AudioRecorder.record(seconds: ${p.sec})`,
    },
    { id:'acq_camera', cat:'acquire', label:'カメラで撮影 → <out>', icon:'📷', kind:'value',
      params:[{ key:'out', kind:'ident', default:'photo', declares:true }],
      js:(p)=>`let ${p.out} = await new Promise(async (res, rej) => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const v = document.createElement('video');
    v.srcObject = stream; await v.play();
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    stream.getTracks().forEach(t => t.stop());
    res(c.toDataURL('image/png'));
  } catch (e) { rej(e); }
});`,
      swift:(p)=>`let ${p.out} = try await CameraCapture.takePhoto()`,
    },
    { id:'acq_geo', cat:'acquire', label:'位置情報 → <out>', icon:'📍', kind:'value',
      params:[{ key:'out', kind:'ident', default:'loc', declares:true }],
      js:(p)=>`let ${p.out} = await new Promise((res, rej) =>
  navigator.geolocation.getCurrentPosition(
    (pos) => res({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy }),
    (err) => rej(err)
  )
);`,
      swift:(p)=>`let ${p.out} = try await LocationManager.shared.current()`,
    },
    { id:'acq_shake', cat:'acquire', label:'シェイクされたら…', icon:'≈', kind:'stmt',
      params:[], slots:[{ key:'body', label:'振られたとき' }],
      js:(p,s)=>`(()=>{ let last = 0; window.addEventListener('devicemotion', (ev) => {
  const a = ev.accelerationIncludingGravity || { x:0, y:0, z:0 };
  const g = Math.hypot(a.x, a.y, a.z);
  const now = Date.now();
  if (g > 22 && now - last > 500) { last = now;\n${s.body}\n}
}); })();`,
      swift:(p,s)=>`.onShake {\n${s.body}\n}`,
    },
    { id:'acq_now', cat:'acquire', label:'現在時刻 → <out>', icon:'🕒', kind:'value',
      params:[
        { key:'out', kind:'ident', default:'now', declares:true },
        { key:'as',  kind:'select', options:['ms','date','iso'], default:'ms' },
      ],
      js:(p)=>{
        if (p.as === 'date') return `let ${p.out} = new Date();`;
        if (p.as === 'iso')  return `let ${p.out} = new Date().toISOString();`;
        return `let ${p.out} = Date.now();`;
      },
      swift:(p)=>{
        if (p.as === 'iso')  return `let ${p.out} = ISO8601DateFormatter().string(from: Date())`;
        if (p.as === 'date') return `let ${p.out} = Date()`;
        return `let ${p.out} = Int(Date().timeIntervalSince1970 * 1000)`;
      },
    },
  ];

  // public
  window.STORYDOCK_CATALOG = { CATEGORIES, BLOCKS };
})();
