// 自毁型 Service Worker - 强力清空浏览器残留缓存并彻底注销自身
self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          console.log('[SW-Destruct] Deleting cache storage:', key);
          return caches.delete(key);
        })
      );
    }).then(() => {
      console.log('[SW-Destruct] All caches deleted. Unregistering self...');
      return self.registration.unregister();
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// 不拦截任何 fetch 请求，直接由浏览器原生出网
self.addEventListener('fetch', (e) => {
  // Network-Only
});
