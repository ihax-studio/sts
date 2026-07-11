/* =============================================================================
   Insta Composer Service Worker (Phase 59-E)
   - Network-first: 更新が常に最優先で取得される (PWA 自動更新の根幹)
   - クライアントからの SKIP_WAITING メッセージで即座に起動
   - オフライン時のみ cache fallback
   ============================================================================= */
const CACHE = 'insta-composer-v6-' + '20260530';
const PRECACHE = ['/', '/index.html', '/document-studio.html', '/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(PRECACHE).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // network-first: 最新を取りに行き、失敗時のみ cache fallback
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res && res.ok && new URL(req.url).origin === location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch (_) {
      const cached = await caches.match(req);
      if (cached) return cached;
      const fallback = await caches.match('/index.html');
      if (fallback) return fallback;
      return new Response('', { status: 504 });
    }
  })());
});
