/* sw.js — خدمة عامل بسيطة لتخزين التطبيق للعمل دون اتصال (PWA)
   تُسجَّل في الوضع المحلي. إشعارات الخلفية تُدار في firebase-messaging-sw.js */
const CACHE = 'task-calendar-natija-v2';
const ASSETS = ['./', 'index.html', 'manifest.json', 'natija-storage.js', 'natija-model.js', 'natija-v2.js', 'natija-v2.css', 'cloud.js', 'onboarding.js', 'onboarding.css', 'icons/icon-192.png', 'icons/icon-512.png'];

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
  if (req.method !== 'GET') return;
  // الشبكة أولاً ثم الكاش، مع رجوع للكاش عند انقطاع الاتصال
  e.respondWith(
    fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(req).then((r) => r || caches.match('index.html')))
  );
});
