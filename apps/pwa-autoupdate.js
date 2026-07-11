/* === PWA online 自動更新（全スタジオ共通）===
   online 接続中に focus / visibilitychange / online / 一定間隔で、
   サーバー上の自分自身(HTML)の <!-- BUILD:xxx --> タグを取得し、
   現在のビルドと違えば caches を全削除 → ?_v= 付きでハードリロードする。
   各HTMLは末尾付近に <!-- BUILD:日付-内容 --> を1つ持つこと（無ければ本文長で代替）。 */
(function () {
  var SELF_URL = location.pathname.split('/').pop() || location.pathname;
  // "--" + ">" を script 終端と誤検出させないため文字列結合で組む
  var BUILD_RE = new RegExp('<' + '!' + '--\\s*BUILD:([\\w.\\-]+)\\s*--' + '>');
  var _curBuild = null;
  try { var m0 = document.documentElement.outerHTML.match(BUILD_RE); if (m0) _curBuild = m0[1]; } catch (_) {}
  var _checking = false;
  async function checkForUpdate() {
    if (_checking || !navigator.onLine) return;
    _checking = true;
    try {
      var r = await fetch(SELF_URL + (SELF_URL.indexOf('?') < 0 ? '?' : '&') + '_pwacheck=' + Date.now(), { cache: 'no-store', credentials: 'omit' });
      if (!r.ok) return;
      var t = await r.text();
      var m = t.match(BUILD_RE);
      var newBuild = m ? m[1] : ('len:' + t.length);
      if (_curBuild == null) { _curBuild = newBuild; return; }
      if (newBuild !== _curBuild) {
        try { if ('caches' in window) { var keys = await caches.keys(); await Promise.all(keys.map(function (k) { return caches.delete(k); })); } } catch (_) {}
        try { if ('serviceWorker' in navigator) { var regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(function (reg) { return reg.update().catch(function () { return null; }); })); } } catch (_) {}
        var url = new URL(location.href);
        url.searchParams.set('_v', newBuild);   // ?_v= で bfcache を回避
        location.replace(url.toString());
      }
    } catch (_) {} finally { _checking = false; }
  }
  setTimeout(checkForUpdate, 3000);
  setInterval(checkForUpdate, 5 * 60 * 1000);
  window.addEventListener('online', checkForUpdate);
  window.addEventListener('focus', checkForUpdate);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) checkForUpdate(); });
})();
