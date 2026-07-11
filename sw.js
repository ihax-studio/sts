/* 旧SW(自壊版) — このSWは廃止済み。現行は gc-sw.js。
   旧sw.jsは .js を network-first でキャッシュしており、通信失敗時に
   壊れた/古い spotlight-tpl.js を配って「検索が空」になる事故経路だった。
   まだ旧sw.jsに支配されている端末が更新チェックでこれを受け取ると、
   全キャッシュ削除 → 自分を登録解除 → ページ再読込 で gc-sw.js に切替わる。 */
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    try { const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k))); } catch (_) {}
    try { await self.registration.unregister(); } catch (_) {}
    try {
      const cs = await self.clients.matchAll({ type: 'window' });
      cs.forEach(c => { try { c.navigate(c.url); } catch (_) {} });
    } catch (_) {}
  })());
});
/* fetchハンドラ無し = 全リクエスト素通し(ネットワーク直行) */
