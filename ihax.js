/* =========================================================================
   ihax.js — iHax: Shake-to-Shake 内蔵オンデバイスLLM (WebLLM / WebGPU)
   -------------------------------------------------------------------------
   ★qwenpad-cf (https://qwenpad.pages.dev) で iPhone/iPad/Mac Safari 実証済みの
     パターンをそのまま移植:
       - web-llm は 0.2.84 に固定 (ihax-worker.js と必ず同一バージョン。
         別バージョンを掴むとプロトコル不一致で沈黙クラッシュする)
       - CreateWebWorkerMLCEngine(worker, modelId, {appConfig, initProgressCallback})
       - 進捗コールバックは {progress:0..1, text} 形
       - Qwen3系の thinking は extra_body:{enable_thinking:false} で抑止
         + 万一漏れた場合の stripThink() 表示保護
       - 45秒進捗なし=スタール検出でロード失敗扱い(回線不安定/破損キャッシュ)
   ★モデルの重みは WebLLM が Cache API に自動キャッシュする
     = PWA に「インストール」された状態が維持され、アプリを閉じて再度開いても
       ダウンロードはキャッシュ済みシャードの続きから再開される。
   ★window.IHAX_MODEL_BASE (R2公開URL等) をこのファイル読込前に設定しておくと、
     重みの取得先を HuggingFace から差し替えられる(容量制限に強い配信)。
   ★どの失敗もホストアプリを壊さない: 全公開APIは try/catch 保護、
     console.warn は失敗経路につき最大1回。
   ========================================================================= */
(() => {
  "use strict";
  if (window.iHax) return; // ★二重読込ガード

  /* ================= 定数 ================= */
  const WEBLLM_URL = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.84/+esm";
  const DEFAULT_MODEL_ID = "Qwen3-0.6B-q4f16_1-MLC"; // 日本語もこなせる軽量モデル・iPhone RAM安全圏(~1.4GB)
  const STALL_MS = 45000; // ★qwenpad実証値: これ以上進捗が止まったら失敗扱い
  const MAX_HIST = 17;    // system + 8往復。プリフィル肥大を防ぐ
  const GRAD = "linear-gradient(135deg,#0a84ff,#bf5af2,#ff375f,#ff9f0a)"; // Apple Intelligence風
  /* ★中国語混入バグ対策(qwenpad実証): 小型モデルは指示が緩いと学習データ由来の
     中国語が漏れるため「日本語のみ・中国語禁止」を明示するのが実効的。 */
  const DEFAULT_SYS =
    "あなたはユーザーの端末上で動く、日本語で簡潔に答えるアシスタント。" +
    "回答は必ず日本語のみ。中国語の文字・文章は絶対に出力しない。短く実用的に。";

  /* ================= エンジン状態 (シングルトン) ================= */
  let _webllmP = null;      // dynamic import の Promise (1回だけ)
  let _engine = null;       // ロード済みエンジン
  let _enginePromise = null;// ロード中の Promise (合流用)
  let _lastProg = { progress: 0, text: "" };
  const _progCbs = new Set();

  const loadWebLLM = () => _webllmP || (_webllmP = import(WEBLLM_URL));

  function dispatchProg(r) {
    _lastProg = r;
    for (const cb of _progCbs) { try { cb(r); } catch (_) {} }
    try { _dlIsland(r); } catch (_) {}
  }

  /* ★DL中のDynamic Island風ピル: 文字なし・スライダ(進捗バー)だけ。
     完了で check.png が scaleup で出て 0.9s 後に閉じる。
     キャッシュからの即ロード(textに Fetching が出ない)では出さない=毎回チカチカしない。 */
  let _dlp = null, _dlpFetch = false, _dlpDone = false;
  function _dlIsland(r) {
    const fetching = /fetch/i.test(r.text || "");
    if (fetching) _dlpFetch = true;
    if (!_dlpFetch || _dlpDone) return;
    if (!_dlp && r.progress < 0.995) {
      const p = document.createElement("div");
      p.id = "ihaxDl";
      p.style.cssText = "position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 12px);transform:translateX(-50%) scale(.6);opacity:0;z-index:9954;background:#000;border-radius:99px;padding:12px 18px;display:flex;align-items:center;justify-content:center;width:min(46vw,210px);box-shadow:0 8px 26px rgba(0,0,0,.45);transition:transform .45s cubic-bezier(.16,1,.3,1),opacity .3s ease;pointer-events:none";
      const trk = document.createElement("div");
      trk.style.cssText = "position:relative;width:100%;height:5px;border-radius:99px;background:rgba(255,255,255,.18);overflow:hidden";
      const fill = document.createElement("div");
      fill.style.cssText = "position:absolute;left:0;top:0;bottom:0;width:0%;border-radius:99px;background:linear-gradient(90deg,#0a84ff,#bf5af2,#ff375f,#ff9f0a);transition:width .3s cubic-bezier(.22,1,.36,1)";
      trk.appendChild(fill); p.appendChild(trk); document.body.appendChild(p);
      p.__fill = fill; _dlp = p;
      requestAnimationFrame(() => requestAnimationFrame(() => { p.style.transform = "translateX(-50%) scale(1)"; p.style.opacity = "1"; }));
    }
    if (_dlp && _dlp.__fill) _dlp.__fill.style.width = Math.round(Math.min(1, r.progress || 0) * 100) + "%";
  }
  function _dlIslandDone() {
    if (!_dlp || _dlpDone) { _dlpFetch = false; return; }
    _dlpDone = true;
    const p = _dlp;
    try {
      p.innerHTML = "";
      const ck = document.createElement("img"); ck.src = "check.png"; ck.alt = "";
      ck.style.cssText = "width:22px;height:22px;object-fit:contain;filter:brightness(0) invert(1);transform:scale(.2);transition:transform .45s cubic-bezier(.16,1,.3,1)";
      p.style.width = "auto"; p.appendChild(ck);
      requestAnimationFrame(() => requestAnimationFrame(() => { ck.style.transform = "scale(1)"; }));
      setTimeout(() => { p.style.transform = "translateX(-50%) scale(.6)"; p.style.opacity = "0"; setTimeout(() => { try { p.remove(); } catch (_) {} }, 320); }, 900);
    } catch (_) { try { p.remove(); } catch (__) {} }
    _dlp = null; _dlpFetch = false; _dlpDone = false;
  }

  /* prebuiltAppConfig を深いコピーして対象エントリだけ差し替える。
     ★IHAX_MODEL_BASE があれば model(重みの取得先)のみ上書き。model_lib(wasm)はそのまま。 */
  async function buildAppConfig(webllm) {
    const cfg = JSON.parse(JSON.stringify(webllm.prebuiltAppConfig));
    const list = cfg.model_list || (cfg.model_list = []);
    let entry = list.find((m) => m.model_id === api.MODEL_ID);
    if (!entry) {
      // ★prebuilt に無い場合の保険: Qwen3兄弟の model_lib を流用して手組み
      //   (0.2.84 の prebuilt には Qwen3-0.6B-q4f16_1-MLC が居るので通常は通らない)
      const sib = list.find((m) => /^Qwen3-.*-q4f16_1-MLC$/.test(m.model_id));
      entry = {
        model: window.IHAX_MODEL_BASE || ("https://huggingface.co/mlc-ai/" + api.MODEL_ID),
        model_id: api.MODEL_ID,
        model_lib: sib ? sib.model_lib.replace(/Qwen3-[^/]*?-q4f16_1/, api.MODEL_ID.replace(/-MLC$/, "")) : undefined,
        vram_required_MB: 1404,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
      };
      list.push(entry);
    }
    if (typeof window.IHAX_MODEL_BASE === "string" && window.IHAX_MODEL_BASE) {
      entry.model = window.IHAX_MODEL_BASE; // R2等から配信=容量が安定
    }
    return cfg;
  }

  /* ★Cloudflare Pages 限定: リンクに "pages" を含むホストのみ利用可(Netlifyでは一切モデルを読み込まない)。
     = Netlifyの帯域/リクエストをiHaxモデルで消費しない・モデルはCloudflareで確実に配信/実行する設計。 */
  /* ★以前は pages.dev 限定だったが解禁: iHaxの重みは HuggingFace/CDN 直配信で
     アプリのホスト(Netlify等)の帯域を一切使わない。どのホストでもPWA(Mac/iPhone/iPad)で
     動くようにし、実際に動くかは下の WebGPU 判定(supported)に委ねる。 */
  function _pagesHost() { return true; }

  /* ---------- iHax.supported() ---------- */
  async function supported() {
    if (typeof window.__ihaxOK === "boolean") return window.__ihaxOK;
    let ok = false;
    if (!_pagesHost()) { window.__ihaxOK = false; return false; }   // ★Netlify等ではiHaxを無効化(モデルを取りに行かない)
    try {
      ok = !!(navigator.gpu && (await navigator.gpu.requestAdapter()));
    } catch (_) { ok = false; }
    window.__ihaxOK = ok;
    return ok;
  }

  /* ---------- iHax.ensureEngine(onProgress) ----------
     シングルトン。多重呼び出しは同じ Promise に合流し、onProgress は全員に配信。
     ★重みは WebLLM が Cache API に自動保存 → アプリを閉じて再度開いても
       ダウンロードはキャッシュ済みシャードの続きから再開される(=実質インストール)。
     ★クラッシュしたらシングルトンをリセットし、次回呼び出しで再試行できるようにする。 */
  function ensureEngine(onProgress) {
    if (!_pagesHost()) { return Promise.reject(new Error("iHax is Cloudflare-Pages only")); }   // ★Netlifyではモデルを絶対に読み込まない
    if (typeof onProgress === "function") {
      if (_engine) { try { onProgress({ progress: 1, text: "ready" }); } catch (_) {} }
      else {
        _progCbs.add(onProgress);
        if (_enginePromise) { try { onProgress(_lastProg); } catch (_) {} }
      }
    }
    if (_engine) return Promise.resolve(_engine);
    if (_enginePromise) return _enginePromise;

    _enginePromise = (async () => {
      const webllm = await loadWebLLM();
      const appConfig = await buildAppConfig(webllm);
      const eng = await new Promise((resolve, reject) => {
        let done = false, last = Date.now();
        const worker = new Worker("ihax-worker.js", { type: "module" });
        const fail = (e) => {
          if (done) return; done = true; clearInterval(t);
          try { worker.terminate(); } catch (_) {}
          reject(e instanceof Error ? e : new Error(String(e)));
        };
        worker.addEventListener("error", () =>
          fail(new Error("ロード中にワーカーがクラッシュしました(メモリ不足の可能性)")));
        const t = setInterval(() => {
          if (Date.now() - last > STALL_MS)
            fail(new Error("45秒間進捗がありません。回線不安定か破損キャッシュの可能性(再試行で続きから再開します)"));
        }, 5000);
        webllm.CreateWebWorkerMLCEngine(worker, api.MODEL_ID, {
          appConfig,
          initProgressCallback: (r) => {
            last = Date.now();
            dispatchProg({ progress: r.progress || 0, text: r.text || "" });
          },
        }).then((e) => {
          if (done) return; done = true; clearInterval(t);
          // ★ロード後にワーカーが落ちた場合もシングルトンをリセット → 次回で再起動
          worker.addEventListener("error", () => {
            if (_engine === e) {
              _engine = null; _enginePromise = null; api.ready = false;
              console.warn("iHax: エンジンがクラッシュしました。次回呼び出しで再起動します。");
            }
          });
          resolve(e);
        }).catch(fail);
      });
      return eng;
    })().then((eng) => {
      _engine = eng; api.ready = true;
      dispatchProg({ progress: 1, text: "done" });
      try { _dlIslandDone(); } catch (_) {}   // ★DLピル→check.png scaleup→閉じる
      _progCbs.clear();
      return eng;
    }).catch((e) => {
      _engine = null; _enginePromise = null; api.ready = false;
      try { if (_dlp) { _dlp.remove(); _dlp = null; _dlpFetch = false; _dlpDone = false; } } catch (_) {}   // ★失敗時はピルを静かに消す
      _progCbs.clear();
      console.warn("iHax: エンジン起動に失敗:", e && e.message);
      try { window.__ihaxLastErr = String((e && (e.message || e)) || "unknown"); dispatchProg({ progress: 0, text: "ERROR: " + window.__ihaxLastErr }); } catch (_) {}   // ★失敗理由をUIに出せるように保存+進捗欄へ流す
      throw e;
    });
    return _enginePromise;
  }

  /* ---------- 思考トークン表示保護 (qwenpadのstripThinkをそのまま移植) ----------
     ★既定は extra_body:{enable_thinking:false} で抑止するが、漏れた場合の保険。 */
  function stripThink(s) {
    s = s.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    const i = s.indexOf("<think>");
    if (i >= 0) s = (s.slice(0, i) + " 🤔(思考中…)").trim();
    return s;
  }

  /* ---------- iHax.ask(messages, opts) ----------
     messages=[{role,content}...] / opts={onToken(全文), temperature, maxTokens} */
  async function ask(messages, opts) {
    opts = opts || {};
    try {
      const eng = await ensureEngine();
      const msgs = (messages || []).slice();
      if (!msgs.some((m) => m && m.role === "system"))
        msgs.unshift({ role: "system", content: DEFAULT_SYS });
      const req = {
        messages: msgs,
        stream: true,
        temperature: opts.temperature != null ? opts.temperature : 0.7,
        max_tokens: opts.maxTokens || 512,
        /* ★qwenpad実証の thinking 抑止機構: Qwen3系に思考トークンを出させず即答 */
        extra_body: { enable_thinking: false },
      };
      let full = "", shown = "";
      const stream = await eng.chat.completions.create(req);
      for await (const c of stream) {
        full += (c.choices && c.choices[0] && c.choices[0].delta && c.choices[0].delta.content) || "";
        shown = stripThink(full);
        if (opts.onToken) { try { opts.onToken(shown); } catch (_) {} }
      }
      return shown;
    } catch (e) {
      console.warn("iHax: ask失敗:", e && e.message);
      throw (e instanceof Error ? e : new Error(String(e)));
    }
  }

  /* ---------- 便利ラッパ(失敗してもホストを壊さない=安全な既定値を返す) ---------- */

  /* iHax.summarize(text) → 1〜2文の日本語要約。失敗時は "" */
  async function summarize(text) {
    try {
      const out = await ask([
        { role: "user", content: "次のメッセージを日本語で1〜2文に要約して。要約だけを出力:\n" + text },
      ], { temperature: 0.3 });
      return out.trim();
    } catch (_) { return ""; }
  }

  /* iHax.proofread(original, translated) → 校正済みの翻訳文のみ。失敗時は translated をそのまま返す */
  async function proofread(original, translated) {
    try {
      const out = await ask([
        { role: "user", content:
          "次の原文と日本語訳を照合し、誤訳や不自然な表現を直して。修正後の翻訳文だけを出力(前置き・説明は禁止):\n" +
          "原文:\n" + original + "\n翻訳:\n" + translated },
      ], { temperature: 0.2 });
      const s = out.trim();
      return s || translated;
    } catch (_) { return translated; }
  }

  /* iHax.suggestReply(history) → history=[{me:bool,text}...最大6件]。失敗時は "" */
  async function suggestReply(history) {
    try {
      const lines = (history || []).slice(-6)
        .map((m) => (m.me ? "自分" : "相手") + ": " + m.text).join("\n");
      const out = await ask([
        { role: "user", content:
          "次のチャットの流れに合う短い返信を日本語で1つだけ提案して(20字以内、絵文字可)。返信文だけを出力:\n" + lines },
      ], { temperature: 0.8, maxTokens: 60 });
      // ★引用符・改行を剥がして1行にする
      return out.trim().split(/\n/)[0].replace(/^[「『"'“]+|[」』"'”]+$/g, "").trim();
    } catch (_) { return ""; }
  }

  /* ---------- iHax.webSearch(q) → [{t,s,u}] 最大5件 ----------
     DuckDuckGo html版を CORSプロキシ経由で取得(9秒タイムアウト)。
     全滅したら ja.wikipedia.org の検索APIへフォールバック。失敗時は [] */
  function fetchT(url, ms) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    return fetch(url, { signal: ctl.signal }).finally(() => clearTimeout(t));
  }
  function deent(s) {
    return (s || "").replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'")
      .replace(/\s+/g, " ").trim();
  }
  function parseDDG(html) {
    const out = [];
    const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div)>/g;
    let m;
    while ((m = re.exec(html)) && out.length < 5) {
      let u = m[1];
      const dd = u.match(/uddg=([^&]+)/); // DDGのリダイレクトURLを実URLへ展開
      if (dd) { try { u = decodeURIComponent(dd[1]); } catch (_) {} }
      if (u.slice(0, 2) === "//") u = "https:" + u;
      if (/duckduckgo\.com\/y\.js/.test(u)) continue; // ★広告枠(y.js)は除外
      const t = deent(m[2]);
      if (t) out.push({ t, s: deent(m[3]), u });
    }
    return out;
  }
  async function webSearch(q) {
    try {
      const ddg = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(q);
      const proxies = [
        "https://corsproxy.io/?url=" + encodeURIComponent(ddg),
        "https://api.allorigins.win/raw?url=" + encodeURIComponent(ddg),
      ];
      for (const u of proxies) {
        try {
          const res = await fetchT(u, 9000);
          if (!res.ok) continue;
          const hits = parseDDG(await res.text());
          if (hits.length) return hits;
        } catch (_) { /* 次のプロキシへ */ }
      }
      // ★最終フォールバック: Wikipedia検索(origin=*でCORS可・プロキシ不要)
      const wu = "https://ja.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srsearch=" + encodeURIComponent(q);
      const res = await fetchT(wu, 9000);
      const j = await res.json();
      return ((j.query && j.query.search) || []).slice(0, 5).map((it) => ({
        t: it.title,
        s: deent(it.snippet),
        u: "https://ja.wikipedia.org/wiki/" + encodeURIComponent(it.title),
      }));
    } catch (e) {
      console.warn("iHax: webSearch失敗:", e && e.message);
      return [];
    }
  }

  /* ---------- iHax.askWeb(question, opts) ----------
     検索→結果を根拠に回答。検索が空なら普通の ask にフォールバック。 */
  async function askWeb(question, opts) {
    const hits = await webSearch(question);
    if (!hits.length) return ask([{ role: "user", content: question }], opts);
    const ctx = hits.map((r, i) => "[" + (i + 1) + "] " + r.t + " — " + r.s).join("\n");
    const prompt =
      "次のWeb検索結果を根拠に、質問へ日本語で簡潔に答えて。出典番号やURLは書かず、答えだけを出力。\n\n" +
      "検索結果:\n" + ctx + "\n\n質問: " + question;
    return ask([{ role: "user", content: prompt }], opts);
  }

  /* =========================================================================
     iHax.openApp() — フルスクリーンのネイティブ風オーバーレイ (iframeではない)
     ダークガラス + Apple Intelligence グラデ。閉じ方: ✕ / 背景タップ / 下スワイプ
     ========================================================================= */
  let _styleDone = false;
  function injectStyle() {
    if (_styleDone || document.getElementById("ihaxStyle")) { _styleDone = true; return; }
    _styleDone = true;
    const st = document.createElement("style");
    st.id = "ihaxStyle";
    st.textContent = `
#ihaxApp{position:fixed;inset:0;z-index:9870;display:flex;flex-direction:column;
  background:transparent;
  -webkit-backdrop-filter:blur(40px) saturate(1.4) brightness(.78);backdrop-filter:blur(40px) saturate(1.4) brightness(.78);
  color:#f2f3f7;font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans",sans-serif;
  opacity:0;transform:scale(.96);
  transition:opacity .5s cubic-bezier(.22,1,.36,1),transform .5s cubic-bezier(.22,1,.36,1);}
#ihaxApp.ihax-open{opacity:1;transform:scale(1);}
#ihaxApp *{box-sizing:border-box;}
.ihax-head{display:flex;align-items:center;gap:12px;flex:0 0 auto;
  padding:calc(14px + env(safe-area-inset-top)) 18px 12px;}
.ihax-ico{width:36px;height:36px;border-radius:50%;object-fit:cover;background:rgba(255,255,255,.1);}
.ihax-titles{flex:1;min-width:0;}
.ihax-title{font-size:17px;font-weight:700;letter-spacing:.02em;}
.ihax-sub{font-size:12px;opacity:.65;}
.ihax-x{width:44px;height:44px;border-radius:50%;border:none;flex:0 0 auto;
  background:none;color:#fff;font:100 34px/1 -apple-system,BlinkMacSystemFont,"SF Pro Display",sans-serif;
  padding:0;cursor:pointer;-webkit-tap-highlight-color:transparent;
  transition:opacity .3s cubic-bezier(.22,1,.36,1);}
.ihax-x:active{opacity:.45;}
.ihax-dlwrap{flex:1;display:flex;align-items:center;justify-content:center;padding:24px;}
.ihax-dlcard{width:min(340px,86vw);padding:28px 24px;border-radius:24px;text-align:center;
  background:transparent;border:none;
  display:flex;flex-direction:column;align-items:center;gap:16px;}
.ihax-ring{position:relative;width:128px;height:128px;}
.ihax-ring svg{display:block;transform:rotate(-90deg);}
.ihax-ring circle{transition:stroke-dashoffset .3s cubic-bezier(.22,1,.36,1);}
.ihax-ringpct{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  font-size:22px;font-weight:700;font-variant-numeric:tabular-nums;}
.ihax-note{font-size:12px;line-height:1.7;opacity:.7;}
.ihax-dlbtn{border:none;border-radius:14px;padding:12px 20px;font-size:14px;font-weight:700;
  color:#fff;cursor:pointer;background:${GRAD};
  transition:opacity .3s cubic-bezier(.22,1,.36,1),transform .3s cubic-bezier(.22,1,.36,1);}
.ihax-dlbtn:disabled{opacity:.5;}
.ihax-dlbtn:active{transform:scale(.97);}
/* ★iOSタイマーホイール風: 縦スクロールスナップ + 上下フェードマスク */
.ihax-chat{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;
  display:flex;flex-direction:column;gap:10px;padding:28px 16px;
  scroll-snap-type:y proximity;
  -webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 10%,#000 90%,transparent 100%);
  mask-image:linear-gradient(to bottom,transparent 0,#000 10%,#000 90%,transparent 100%);}
.ihax-msg{max-width:78%;padding:10px 14px;border-radius:18px;font-size:15px;line-height:1.55;
  white-space:pre-wrap;word-break:break-word;scroll-snap-align:center;flex:0 0 auto;}
.ihax-msg.ihax-me{align-self:flex-end;border:1.5px solid transparent;
  background:linear-gradient(rgba(24,26,36,.88),rgba(24,26,36,.88)) padding-box,${GRAD} border-box;}
.ihax-msg.ihax-ai{align-self:flex-start;background:rgba(255,255,255,.08);
  border:none;}
.ihax-inrow{flex:0 0 auto;display:flex;gap:8px;align-items:center;
  padding:10px 14px calc(12px + env(safe-area-inset-bottom));}
.ihax-in{flex:1;min-width:0;border:none;border-radius:20px;
  background:rgba(255,255,255,.08);color:#fff;padding:10px 14px;font-size:15px;outline:none;
  font-family:inherit;-webkit-appearance:none;appearance:none;}
.ihax-in::placeholder{color:rgba(255,255,255,.4);}
.ihax-webbtn{width:40px;height:40px;border-radius:50%;flex:0 0 auto;font-size:17px;cursor:pointer;
  border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.08);
  transition:all .3s cubic-bezier(.22,1,.36,1);}
.ihax-webbtn.ihax-on{background:${GRAD};border-color:transparent;
  box-shadow:0 0 14px rgba(191,90,242,.55);}
.ihax-sendbtn{border:none;border-radius:20px;padding:10px 16px;font-size:14px;font-weight:700;
  flex:0 0 auto;color:#fff;cursor:pointer;background:${GRAD};
  transition:opacity .3s cubic-bezier(.22,1,.36,1),transform .3s cubic-bezier(.22,1,.36,1);}
.ihax-sendbtn:disabled{opacity:.5;}
.ihax-sendbtn:active{transform:scale(.97);}
`;
    document.head.appendChild(st);
  }

  /* オーバーレイのチャット履歴はセッション中保持(閉じて開き直しても続きから) */
  const _hist = [{ role: "system", content: DEFAULT_SYS }];

  function openApp() {
    try {
      if (document.getElementById("ihaxApp")) return; // ★既に開いている
      injectStyle();

      const root = document.createElement("div");
      root.id = "ihaxApp";

      /* ---- ヘッダ ---- */
      const head = document.createElement("div"); head.className = "ihax-head";
      const ico = document.createElement("img");
      ico.className = "ihax-ico"; ico.src = "iHax-AI.png"; ico.alt = "";
      const titles = document.createElement("div"); titles.className = "ihax-titles";
      const title = document.createElement("div"); title.className = "ihax-title"; title.textContent = "iHax";
      const sub = document.createElement("div"); sub.className = "ihax-sub";
      titles.appendChild(title); titles.appendChild(sub);
      const xBtn = document.createElement("button"); xBtn.className = "ihax-x"; xBtn.textContent = "×";
      head.appendChild(ico); head.appendChild(titles); head.appendChild(xBtn);

      /* ---- ダウンロードカード (グラデの進捗リング) ---- */
      const dlwrap = document.createElement("div"); dlwrap.className = "ihax-dlwrap";
      const card = document.createElement("div"); card.className = "ihax-dlcard";
      const R = 56, C = 2 * Math.PI * R; // リング半径と円周
      const ringWrap = document.createElement("div"); ringWrap.className = "ihax-ring";
      ringWrap.innerHTML =
        '<svg width="128" height="128" viewBox="0 0 128 128">' +
        '<defs><linearGradient id="ihaxGrad" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0" stop-color="#0a84ff"/><stop offset=".38" stop-color="#bf5af2"/>' +
        '<stop offset=".68" stop-color="#ff375f"/><stop offset="1" stop-color="#ff9f0a"/>' +
        "</linearGradient></defs>" +
        '<circle cx="64" cy="64" r="' + R + '" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="8"/>' +
        '<circle class="ihax-arc" cx="64" cy="64" r="' + R + '" fill="none" stroke="url(#ihaxGrad)"' +
        ' stroke-width="8" stroke-linecap="round" stroke-dasharray="' + C + '" stroke-dashoffset="' + C + '"/>' +
        "</svg>";
      const pctEl = document.createElement("div"); pctEl.className = "ihax-ringpct"; pctEl.textContent = "0%";
      ringWrap.appendChild(pctEl);
      const arc = ringWrap.querySelector(".ihax-arc");
      const note = document.createElement("div"); note.className = "ihax-note";
      note.textContent = "約350MB・ダウンロードは1回だけ。アプリを閉じても続きから再開できます。";
      const dlBtn = document.createElement("button"); dlBtn.className = "ihax-dlbtn";
      dlBtn.textContent = "モデルをダウンロード";
      card.appendChild(ringWrap); card.appendChild(note); card.appendChild(dlBtn);
      dlwrap.appendChild(card);

      /* ---- チャットエリア (ホイール風スナップ) ---- */
      const chat = document.createElement("div"); chat.className = "ihax-chat";
      chat.style.display = "none";

      /* ---- 入力行 ---- */
      const inrow = document.createElement("div"); inrow.className = "ihax-inrow";
      inrow.style.display = "none";
      const input = document.createElement("input");
      input.className = "ihax-in"; input.type = "text";
      input.placeholder = "メッセージ"; input.autocomplete = "off";
      const webBtn = document.createElement("button"); webBtn.className = "ihax-webbtn"; webBtn.textContent = "🌐";
      webBtn.title = "ネット検索を根拠に回答";
      const sendBtn = document.createElement("button"); sendBtn.className = "ihax-sendbtn"; sendBtn.textContent = "送信";
      inrow.appendChild(input); inrow.appendChild(webBtn); inrow.appendChild(sendBtn);

      root.appendChild(head); root.appendChild(dlwrap); root.appendChild(chat); root.appendChild(inrow);
      document.body.appendChild(root);
      /* 開くアニメ: opacity+scale(.96→1) */
      requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add("ihax-open")));

      /* ---- バブル生成 (enterReadyより先に定義しておく=TDZ回避) ---- */
      const addMsg = (me, text) => {
        const d = document.createElement("div");
        d.className = "ihax-msg " + (me ? "ihax-me" : "ihax-ai");
        d.textContent = text;
        chat.appendChild(d);
        chat.scrollTop = chat.scrollHeight;
        return { el: d, set: (s) => { d.textContent = s; chat.scrollTop = chat.scrollHeight; } };
      };

      /* ---- 状態表示 ---- */
      const setRing = (p) => {
        p = Math.max(0, Math.min(1, p));
        arc.style.strokeDashoffset = String(C * (1 - p));
        pctEl.textContent = Math.round(p * 100) + "%";
      };
      const enterReady = () => {
        sub.textContent = "準備完了";
        dlwrap.style.display = "none";
        chat.style.display = "flex";
        inrow.style.display = "flex";
        if (!chat.childElementCount)
          addMsg(false, "モデル準備完了。なんでも聞いてください 💬");
        chat.scrollTop = chat.scrollHeight;
      };
      const wireDL = () => {
        dlBtn.disabled = true; dlBtn.textContent = "ダウンロード中…";
        sub.textContent = "DL中 " + Math.round((_lastProg.progress || 0) * 100) + "%";
        setRing(_lastProg.progress || 0);
        /* ★オーバーレイを閉じてもダウンロードは継続(エンジンPromiseは生き続ける) */
        ensureEngine((r) => {
          const p = r.progress || 0;
          setRing(p);
          sub.textContent = "DL中 " + Math.round(p * 100) + "%";
        }).then(() => { if (document.body.contains(root)) enterReady(); })
          .catch((e) => {
            if (!document.body.contains(root)) return;
            sub.textContent = "エラー";
            dlBtn.disabled = false; dlBtn.textContent = "再試行";
            note.textContent = "失敗: " + ((e && e.message) || e) + "(再試行はキャッシュ済みの続きから再開します)";
            try { note.style.whiteSpace = "pre-wrap"; diag().then((d) => { try { note.textContent += "\n診断: " + d; } catch (_) {} }); } catch (_) {}   // ★どの層で詰まったか自動診断を追記
          });
      };
      dlBtn.addEventListener("click", wireDL);

      if (api.ready) enterReady();
      else {
        sub.textContent = "未ダウンロード";
        if (_enginePromise) wireDL(); // 既にDL進行中なら進捗表示に合流
        supported().then((ok) => {
          if (!ok && !api.ready) {
            sub.textContent = "非対応";
            dlBtn.disabled = true;
            note.textContent = "この端末/OSはWebGPU非対応のためiHaxを利用できません(iOS/iPadOS 26以降のSafari、Apple Silicon Macで利用可)。";
          }
        });
      }

      /* ---- チャット送信 ---- */
      let busy = false, webOn = false;
      const onSend = async () => {
        const q = (input.value || "").trim();
        if (!q || busy || !api.ready) return;
        input.value = ""; busy = true; sendBtn.disabled = true;
        addMsg(true, q);
        const b = addMsg(false, "…");
        try {
          let ans;
          if (webOn) {
            b.set("🌐 検索中…");
            ans = await askWeb(q, { onToken: b.set }); // ストリーミングで最後のAIバブルを更新
          } else {
            ans = await ask(_hist.concat([{ role: "user", content: q }]), { onToken: b.set });
          }
          _hist.push({ role: "user", content: q });
          _hist.push({ role: "assistant", content: ans || "" });
          if (_hist.length > MAX_HIST) _hist.splice(1, _hist.length - MAX_HIST); // systemは残す
          if (!ans) b.set("(応答なし)");
        } catch (e) {
          b.set("⚠ " + ((e && e.message) || "失敗しました"));
        }
        busy = false; sendBtn.disabled = false;
      };
      sendBtn.addEventListener("click", onSend);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") onSend(); });
      webBtn.addEventListener("click", () => {
        webOn = !webOn;
        webBtn.classList.toggle("ihax-on", webOn);
      });

      /* ---- 閉じる: ✕ / 背景タップ / 下スワイプ ---- */
      let closed = false;
      const close = () => {
        if (closed) return; closed = true;
        root.classList.remove("ihax-open"); // 逆アニメ(0.5s)
        setTimeout(() => { try { root.remove(); } catch (_) {} }, 520);
      };
      xBtn.addEventListener("click", close);
      root.addEventListener("click", (e) => {
        // 何もない背景(ルート直下・カード外・バブル間)のタップで閉じる
        if (e.target === root || e.target === dlwrap || e.target === chat) close();
      });
      let ty0 = null, tx0 = null, inChat = false;
      root.addEventListener("touchstart", (e) => {
        const t = e.touches[0];
        ty0 = t.clientY; tx0 = t.clientX;
        inChat = chat.contains(e.target);
      }, { passive: true });
      root.addEventListener("touchend", (e) => {
        if (ty0 == null) return;
        const t = e.changedTouches[0];
        const dy = t.clientY - ty0, dx = Math.abs(t.clientX - tx0);
        ty0 = null;
        // ★チャットが先頭までスクロール済みの時だけスワイプ閉じ(スクロールと衝突させない)
        if (dy > 90 && dx < 60 && (!inChat || chat.scrollTop <= 0)) close();
      }, { passive: true });
    } catch (e) {
      console.warn("iHax: openApp失敗:", e && e.message);
    }
  }

  /* ================= 公開API ================= */
  /* ★診断: モデルDLがどの層で詰まるか実測(config/シャード/wasm/GPU)。openApp失敗時に自動実行して画面に出す */
  async function diag() {
    const out = [];
    async function t(name, url) {
      try { const r = await fetch(url, { method: "GET", headers: { range: "bytes=0-64" } });
        out.push(name + ":" + ((r.ok || r.status === 206) ? "OK" : "HTTP" + r.status)); }
      catch (e) { out.push(name + ":BLOCKED(" + String((e && e.message) || e).slice(0, 42) + ")"); }
    }
    const base = (typeof window.IHAX_MODEL_BASE === "string" && window.IHAX_MODEL_BASE) || ("https://huggingface.co/mlc-ai/" + api.MODEL_ID);
    await t("config", base + "/resolve/main/mlc-chat-config.json");
    await t("shard", base + "/resolve/main/params_shard_0.bin");
    let wasmUrl = "";
    try { const w = await loadWebLLM(); const e2 = (w.prebuiltAppConfig.model_list || []).find((m) => m.model_id === api.MODEL_ID); wasmUrl = (e2 && e2.model_lib) || ""; } catch (e3) { out.push("lib:BLOCKED(" + String((e3 && e3.message) || e3).slice(0, 42) + ")"); }
    if (wasmUrl) await t("wasm", wasmUrl);
    out.push("gpu:" + (navigator.gpu ? "yes" : "NO"));
    out.push("host:" + location.hostname);
    return out.join(" / ");
  }
  const api = {
    MODEL_ID: DEFAULT_MODEL_ID, // ★ensureEngine 前なら差し替え可
    ready: false,               // エンジンロード済みか
    supported,
    ensureEngine,
    ask,
    summarize,
    proofread,
    suggestReply,
    webSearch,
    askWeb,
    openApp,
    diag,
  };
  window.iHax = api;
})();
