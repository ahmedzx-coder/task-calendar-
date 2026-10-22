/* firebase-messaging-sw.js
   يستقبل إشعارات FCM في الخلفية (حتى لو التبويب مغلق، طالما المتصفح يعمل
   أو التطبيق مثبّت كـ PWA). يجب أن يكون في جذر الموقع. */

importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
importScripts('firebase-config.js'); // يضبط self.FIREBASE_CONFIG

try {
  if (self.FIREBASE_CONFIG && self.FIREBASE_CONFIG.apiKey &&
      self.FIREBASE_CONFIG.apiKey.indexOf('YOUR_') === -1) {
    firebase.initializeApp(self.FIREBASE_CONFIG);
    var messaging = firebase.messaging();

    messaging.onBackgroundMessage(function (payload) {
      // الرسائل التي تحتوي notification يعرضها Firebase تلقائيًا —
      // لا نعرضها مرة ثانية حتى لا يظهر الإشعار مكرّرًا.
      if (payload && payload.notification) return;
      var d = (payload && payload.data) || {};
      self.registration.showNotification(d.title || '📅 تقويم المهام', {
        body: d.body || '',
        icon: 'icons/icon-192.png',
        badge: 'icons/icon-192.png',
        tag: d.tag || 'task',
        data: d
      });
    });
  }
} catch (e) {
  // في وضع عدم الإعداد نتجاهل بهدوء
}

// فتح التطبيق عند النقر على الإشعار
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if ('focus' in list[i]) return list[i].focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});
