/* sw.js — خدمة عامل بسيطة لتخزين التطبيق للعمل دون اتصال (PWA)
   تُسجَّل في الوضع المحلي. إشعارات الخلفية تُدار في firebase-messaging-sw.js */
const CACHE = 'task-calendar-natija-v4';
const ASSETS = ['./', 'index.html', 'manifest.json', 'natija-storage.js', 'natija-model.js?v=20261024-motion-history-1', 'natija-v2.js?v=20261024-motion-history-1', 'natija-v2.css?v=20261024-motion-history-1', 'cloud.js', 'onboarding.js?v=1.20261024.2', 'onboarding.css?v=1', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // الشبكة أولاً ثم الكاش، مع رجوع للكاش عند انقطاع الاتصال
  e.respondWith(
    fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        e.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}));
      }
      return res;
    }).catch(async (error) => {
      const cached = await caches.match(req);
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const shell = await caches.match('index.html');
        if (shell) return shell;
      }
      throw error;
    })
  );
});
