/* =========================================================================
   إعدادات Firebase — عدّل هذا الملف فقط ببيانات مشروعك
   -------------------------------------------------------------------------
   من أين تجيب هذه القيم؟ (الدليل الكامل في SETUP-FIREBASE.md)
   1) أنشئ مشروع على https://console.firebase.google.com
   2) Project settings ▸ General ▸ Your apps ▸ Web app  → انسخ كائن firebaseConfig
   3) Project settings ▸ Cloud Messaging ▸ Web Push certificates ▸ Generate key pair
      → انسخ المفتاح وحطه في FIREBASE_VAPID_KEY
   ملاحظة: إعدادات الويب في Firebase ليست سرّية، من الطبيعي وجودها في كود الواجهة.
   ========================================================================= */

var FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

// مفتاح Web Push (VAPID) — مطلوب للإشعارات
var FIREBASE_VAPID_KEY = "YOUR_WEB_PUSH_CERTIFICATE_KEY";

/* يُستخدم نفس الملف داخل الصفحة وداخل الـ service worker */
if (typeof self !== 'undefined') {
  self.FIREBASE_CONFIG = FIREBASE_CONFIG;
  self.FIREBASE_VAPID_KEY = FIREBASE_VAPID_KEY;
}
