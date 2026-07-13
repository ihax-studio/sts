/* ============================================================================
   storage.js — 通信規格 × Telegram「fusion」ストレージ・クライアント
   ----------------------------------------------------------------------------
   ・画像/ファイルは Cloudflare Worker 経由で Telegram に保存（実質無制限・無料）
   ・通信規格 には短い ID（file_id）だけ載せる → 無料枠に優しい
   ・Worker の URL は firebase-config.js の window.STORAGE_URL に書く
       window.STORAGE_URL = "https://tg-storage2.xxxx.workers.dev";
   仕様（ユーザー指定）:
   ・77KB 以下 … そのまま添付
   ・77KB 超  … 77KB 以内に収まるよう寸法/画質を自動調整、色は最大 32768色(15bit)に減色
   ========================================================================== */
(function () {
  'use strict';
  const MAX_BYTES = 77 * 1024;          // 77KB
  const COLOR_MASK = 0xF8;              // 上位5bit → 32(=2^5)階調/ch → 32^3 = 32768色

  function base() { return (window.STORAGE_URL || '').replace(/\/+$/, ''); }
  function ready() { return !!base(); }

  function loadImage(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = e => { URL.revokeObjectURL(url); rej(e); };
      img.src = url;
    });
  }
  function toBlob(canvas, q) { return new Promise(r => canvas.toBlob(r, 'image/jpeg', q)); }

  // 画像を 77KB 以内・32768色以内に収める（77KB以下の元画像はそのまま返す）
  async function compressImage(file) {
    if (!/^image\//.test(file.type)) return { blob: file, type: file.type, name: file.name || 'file' };
    if (file.size <= MAX_BYTES) return { blob: file, type: file.type, name: file.name || 'img' };

    const img = await loadImage(file);
    let w = img.width, h = img.height;
    const MAXDIM = 888;   // 送信画像は長辺888pに統一（比率保持・77KB上限内でより低圧縮=クリーン・軽量。index/meettomeet共通）
    if (Math.max(w, h) > MAXDIM) { const r = MAXDIM / Math.max(w, h); w = Math.round(w * r); h = Math.round(h * r); }

    let scale = 1;
    for (let dim = 0; dim < 14; dim++) {
      const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
      const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
      const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0, cw, ch);
      // 15bit 減色（各チャンネル上位5bit）
      try { const id = cx.getImageData(0, 0, cw, ch); const d = id.data; for (let i = 0; i < d.length; i += 4) { d[i] &= COLOR_MASK; d[i + 1] &= COLOR_MASK; d[i + 2] &= COLOR_MASK; } cx.putImageData(id, 0, 0); } catch (e) {}
      let q = 0.82;
      for (let qi = 0; qi < 6; qi++) {
        const blob = await toBlob(cv, q);
        if (blob && blob.size <= MAX_BYTES) return { blob, type: 'image/jpeg', name: (file.name || 'img').replace(/\.\w+$/, '') + '.jpg' };
        q -= 0.12;
      }
      scale *= 0.82;                    // まだ大きい → 寸法を縮める
    }
    // 最終手段：極小で返す
    const cv = document.createElement('canvas'); cv.width = 240; cv.height = Math.max(1, Math.round(240 * h / w));
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    const blob = await toBlob(cv, 0.5);
    return { blob, type: 'image/jpeg', name: 'img.jpg' };
  }

  // Worker にアップロード → { id: Telegram file_id, mid: Telegram message_id }
  // mid は empty mode が Telegram から実体を消す(deleteMessage)のに使う。旧Worker応答では undefined。
  // ★根本対策(2026-07-13): 旧実装は単発fetch=携帯回線/Worker/Telegramの一時的な不調(5xx/429/flood/timeout/
  //   iCloudプライベートリレーの瞬断)で即throw→「送信に失敗しました」(index.htmlの10339)を誘発していた。
  //   タイムアウト付き+指数バックオフで最大6回リトライ=一時的な不調では絶対に失敗しない=10339を根絶。
  //   恒久エラー(413大きすぎ等の4xx)だけ即中断=無駄な待ちを避ける。
  const UP_BACKOFF = [0, 700, 1600, 3200, 6000, 10000];   // 6試行(累計≈21s)+各45sタイムアウト
  function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  async function upload(blob, name, type) {
    if (!ready()) throw new Error('STORAGE_URL 未設定');
    const u = base() + '/up?name=' + encodeURIComponent((name || 'file').slice(0, 60)) + '&type=' + encodeURIComponent(type || blob.type || 'application/octet-stream');
    let lastErr = null;
    for (let attempt = 0; attempt < UP_BACKOFF.length; attempt++) {
      if (UP_BACKOFF[attempt]) await _sleep(UP_BACKOFF[attempt]);
      let ctl = null, timer = 0;
      try {
        ctl = ('AbortController' in self) ? new AbortController() : null;
        timer = setTimeout(function () { try { ctl && ctl.abort(); } catch (e) {} }, 45000);
        const r = await fetch(u, { method: 'POST', body: blob, signal: ctl ? ctl.signal : undefined, keepalive: false });
        clearTimeout(timer); timer = 0;
        if (r.ok) {
          const d = await r.json().catch(() => ({}));
          if (d && d.ok && d.id) return { id: d.id, mid: d.mid };   // ★成功
          lastErr = new Error((d && d.err) || 'upload failed');     // 応答不正=一時的とみなしリトライ
        } else {
          lastErr = new Error('http ' + r.status);
          if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) break;   // 恒久4xx=即中断
        }
      } catch (e) {
        if (timer) clearTimeout(timer);
        lastErr = e;   // ネットワーク断/timeout/abort=リトライ
      }
    }
    throw lastErr || new Error('upload failed');
  }

  // file_id → 表示用URL（<img src> にそのまま使える）
  function fileUrl(id) { return ready() ? base() + '/dl?id=' + encodeURIComponent(id) : ''; }

  // 画像ファイルを「圧縮→アップロード」して { id: file_id, mid: message_id } を返す高水準関数
  async function putImage(file) { const { blob, name, type } = await compressImage(file); return upload(blob, name, type); }

  // 任意のテキスト(JSON等)を保存（バックアップ/履歴退避用）→ file_id 文字列を返す
  async function putText(text, name) { const r = await upload(new Blob([text], { type: 'application/json' }), name || 'data.json', 'application/json'); return r.id; }
  async function getText(id) { const r = await fetch(fileUrl(id)); return r.text(); }

  // チャット会話翻訳(Google直叩き)は廃止（サーバーリクエスト削減）

  // ===== 動画: Telegram の getFile 20MB DL上限を「チャンク分割」で回避（無制限・無料）=====
  const VID_CHUNK = 18 * 1024 * 1024;   // 18MB/チャンク（DL20MB上限の安全圏）
  // 動画を ≤18MB に分割して順にアップロード → { chunks:[file_id...], mids:[message_id...] }
  async function uploadVideoChunks(file, onProgress) {
    if (!ready()) throw new Error('STORAGE_URL 未設定');
    const total = Math.max(1, Math.ceil(file.size / VID_CHUNK));
    const ids = [], mids = [];
    for (let i = 0; i < total; i++) {
      const part = file.slice(i * VID_CHUNK, (i + 1) * VID_CHUNK);
      const r = await upload(part, (file.name || 'video').slice(0, 36) + '.p' + i, 'application/octet-stream');
      ids.push(r.id); if (r.mid != null) mids.push(r.mid);
      if (onProgress) { try { onProgress(i + 1, total); } catch (e) {} }
    }
    return { chunks: ids, mids: mids };
  }
  // チャンクidの配列 → /dl で順に取得して結合 → 再生用 blob URL（再視聴はエッジキャッシュ=0リクエスト）
  async function videoBlobUrl(chunkIds, type) {
    const parts = [];
    for (const id of (chunkIds || [])) { const r = await fetch(fileUrl(id)); parts.push(await r.arrayBuffer()); }
    return URL.createObjectURL(new Blob(parts, { type: type || 'video/mp4' }));
  }

  window.Store = { ready, compressImage, upload, putImage, putText, getText, fileUrl, uploadVideoChunks, videoBlobUrl, MAX_BYTES };
})();
