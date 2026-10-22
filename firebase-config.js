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
  apiKey:            "AIzaSyCMDiRKZG3aBTgo6WQQwjNGdFWAgdLzGgo",
  authDomain:        "calendar-tasks-month.firebaseapp.com",
  projectId:         "calendar-tasks-month",
  storageBucket:     "calendar-tasks-month.firebasestorage.app",
  messagingSenderId: "408815698654",
  appId:             "1:408815698654:web:c2a6f9ca1ace921047f84f",
  measurementId:     "G-NGTKD40K4F"
};

// مفتاح Web Push (VAPID) — مطلوب للإشعارات
var FIREBASE_VAPID_KEY = "BNMphnnx9s0sebxCgdpkm2MPB9ATzVnRY4Uc1E2qEAoiSmgSK-ytiT85bA7SFh1mCxFsjxBOcdwNl44N249nQSA";

/* يُستخدم نفس الملف داخل الصفحة وداخل الـ service worker */
if (typeof self !== 'undefined') {
  self.FIREBASE_CONFIG = FIREBASE_CONFIG;
  self.FIREBASE_VAPID_KEY = FIREBASE_VAPID_KEY;
}
