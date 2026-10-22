/* =========================================================================
   cloud.js — طبقة السحابة لتقويم المهام
   تسجيل الدخول (Firebase Auth) + مزامنة Firestore اللحظية + إشعارات (FCM)
   تعمل كطبقة فوق التطبيق عبر window.AppBridge، والتطبيق يظل يشتغل محلياً
   بالكامل حتى لو Firebase غير مُعد بعد (وضع محلي).
   ========================================================================= */
(function () {
  'use strict';

  var cfg = (typeof window !== 'undefined' && window.FIREBASE_CONFIG) || {};
  var vapidKey = (typeof window !== 'undefined' && window.FIREBASE_VAPID_KEY) || '';

  // هل تم ضبط Firebase فعلاً؟ (المفاتيح الافتراضية تبدأ بـ YOUR_)
  function isConfigured() {
    return !!(cfg && cfg.apiKey && cfg.apiKey.indexOf('YOUR_') === -1 && cfg.projectId);
  }
  function vapidReady() {
    return !!(vapidKey && vapidKey.indexOf('YOUR_') === -1);
  }

  var isAr = (localStorage.getItem('task-planner-lang-v1') || 'ar') === 'ar';
  function T(ar, en) { return isAr ? ar : en; }

  // ---------- وضع محلي (Firebase غير مُعد) ----------
  if (!isConfigured() || typeof firebase === 'undefined') {
    document.addEventListener('DOMContentLoaded', function () {
      showBanner(
        T('وضع محلي — لتفعيل الدخول والمزامنة والإشعارات، اضبط ملف firebase-config.js',
          'Local mode — set firebase-config.js to enable login, sync & notifications'),
        'warn'
      );
    });
    // سجّل إشعارات محلية بسيطة تعتمد على المتصفح فقط (تظهر أثناء فتح التطبيق)
    wireLocalOnlyNotifications();
    return;
  }

  // ================= تهيئة Firebase =================
  firebase.initializeApp(cfg);
  var auth = firebase.auth();
  var db = firebase.firestore();
  var messaging = null;
  try { if (firebase.messaging && firebase.messaging.isSupported()) messaging = firebase.messaging(); }
  catch (e) { messaging = null; }

  var currentUser = null;
  var unsubscribeDoc = null;
  var saveTimer = null;
  var applyingRemote = false;   // يمنع حلقة الدفع عند تطبيق بيانات السحابة
  var OWNER_KEY = 'task-planner-owner-uid'; // صاحب البيانات المحلية الحالية (لمنع تسرّب المهام بين الحسابات)

  // ================= الجسر مع التطبيق =================
  function bridge() { return window.AppBridge || null; }

  function getLocalData() {
    var b = bridge();
    if (b && b.getData) return b.getData();
    return {
      tasks: JSON.parse(localStorage.getItem('tasks') || '[]'),
      completedTasks: JSON.parse(localStorage.getItem('completedTasks') || '[]')
    };
  }

  function applyToApp(tasks, completedTasks) {
    applyingRemote = true;
    try {
      var b = bridge();
      if (b && b.applyRemote) b.applyRemote(tasks, completedTasks);
      else {
        localStorage.setItem('tasks', JSON.stringify(tasks || []));
        localStorage.setItem('completedTasks', JSON.stringify(completedTasks || []));
        location.reload();
      }
    } finally {
      // أفلت القفل بعد دورة الحدث لتفادي صدى الحفظ المحلي
      setTimeout(function () { applyingRemote = false; }, 0);
    }
  }

  // دمج آمن بالـ id: لا نفقد مهام محلية غير مرفوعة، ونرجّح الأحدث عند التعارض
  function mergeById(localArr, remoteArr) {
    var map = {};
    (remoteArr || []).forEach(function (t) { if (t && t.id != null) map[t.id] = t; });
    (localArr || []).forEach(function (t) {
      if (!t || t.id == null) return;
      var r = map[t.id];
      if (!r) { map[t.id] = t; return; }
      var lu = +t.updatedAt || 0, ru = +r.updatedAt || 0;
      map[t.id] = lu >= ru ? t : r;
    });
    return Object.keys(map).map(function (k) { return map[k]; });
  }

  // ================= المزامنة =================
  function userDoc() { return db.collection('users').doc(currentUser.uid); }

  // يحفظ المنطقة الزمنية واللغة ليحسب الـ Cloud Function مواعيد الإشعارات بدقة
  function saveProfile() {
    if (!currentUser) return;
    var tz = 'UTC';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) {}
    userDoc().set({
      tz: tz,
      lang: isAr ? 'ar' : 'en',
      email: currentUser.email || null
    }, { merge: true }).catch(function () {});
  }

  function clearLocalTasks() { applyToApp([], []); }

  function startSync() {
    if (unsubscribeDoc) { unsubscribeDoc(); unsubscribeDoc = null; }

    // حماية الخصوصية: لا تدمج مهامًا محلية تخص حسابًا آخر على نفس الجهاز.
    // الدمج مسموح فقط لو البيانات المحلية مجهولة (استُخدمت قبل أي تسجيل دخول)
    // أو تخص نفس المستخدم الحالي.
    var owner = localStorage.getItem(OWNER_KEY);
    var canMergeLocal = (!owner || owner === currentUser.uid);
    if (!canMergeLocal) clearLocalTasks();

    userDoc().get().then(function (snap) {
      var local = canMergeLocal ? getLocalData() : { tasks: [], completedTasks: [] };
      if (!snap.exists) {
        // أول ربط لهذا الحساب
        applyToApp(local.tasks, local.completedTasks);
        pushToCloud(local.tasks, local.completedTasks, true);
      } else {
        var data = snap.data() || {};
        var mergedTasks = mergeById(local.tasks, data.tasks || []);
        var mergedCompleted = mergeById(local.completedTasks, data.completedTasks || []);
        applyToApp(mergedTasks, mergedCompleted);
        pushToCloud(mergedTasks, mergedCompleted, true);
      }
      localStorage.setItem(OWNER_KEY, currentUser.uid);
      listenRealtime();
    }).catch(function (err) {
      console.error('[cloud] sync error', err);
      showBanner(T('تعذّرت المزامنة: ', 'Sync error: ') + err.message, 'warn');
    });
  }

  function listenRealtime() {
    unsubscribeDoc = userDoc().onSnapshot({ includeMetadataChanges: false }, function (snap) {
      if (!snap.exists) return;
      if (snap.metadata.hasPendingWrites) return; // تجاهل صدى كتابتنا المحلية
      var data = snap.data() || {};
      applyToApp(data.tasks || [], data.completedTasks || []);
    }, function (err) { console.error('[cloud] snapshot error', err); });
  }

  function pushToCloud(tasks, completedTasks, immediate) {
    if (!currentUser) return;
    var payload = {
      tasks: tasks || [],
      completedTasks: completedTasks || [],
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    var write = function () {
      userDoc().set(payload, { merge: true }).catch(function (e) {
        console.error('[cloud] write error', e);
      });
    };
    if (immediate) { write(); return; }
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(write, 800); // debounce
  }

  // يُستدعى من التطبيق بعد كل حفظ محلي ناتج عن المستخدم
  function onLocalSave() {
    if (applyingRemote || !currentUser) return;
    var d = getLocalData();
    pushToCloud(d.tasks, d.completedTasks, false);
  }

  // ================= الإشعارات =================
  function ensureNotifyPermission() {
    if (!('Notification' in window)) return Promise.resolve(false);
    if (Notification.permission === 'granted') return Promise.resolve(true);
    if (Notification.permission === 'denied') return Promise.resolve(false);
    return Notification.requestPermission().then(function (p) { return p === 'granted'; });
  }

  function registerPush() {
    if (!messaging || !vapidReady() || !('serviceWorker' in navigator)) return;
    ensureNotifyPermission().then(function (ok) {
      if (!ok) return;
      navigator.serviceWorker.register('firebase-messaging-sw.js').then(function (reg) {
        return messaging.getToken({ vapidKey: vapidKey, serviceWorkerRegistration: reg });
      }).then(function (token) {
        if (!token || !currentUser) return;
        userDoc().set({
          fcmTokens: firebase.firestore.FieldValue.arrayUnion(token)
        }, { merge: true });
      }).catch(function (e) { console.warn('[cloud] push token error', e); });
    });
    // إشعارات تصل أثناء فتح التبويب (foreground)
    try {
      messaging.onMessage(function (p) {
        var n = (p && p.notification) || {};
        showSystemNotification(n.title || T('تذكير', 'Reminder'), n.body || '', 'fcm');
      });
    } catch (e) {}
  }

  // إشعار نظام يظهر حتى لو التبويب في الخلفية (عبر الـ service worker إن توفّر)
  function showSystemNotification(title, body, tag) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    var opts = { body: body || '', tag: tag || 'task', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', lang: isAr ? 'ar' : 'en' };
    if ('serviceWorker' in navigator && navigator.serviceWorker.ready) {
      navigator.serviceWorker.ready.then(function (reg) {
        reg.showNotification(title, opts);
      }).catch(function () { try { new Notification(title, opts); } catch (e) {} });
    } else {
      try { new Notification(title, opts); } catch (e) {}
    }
  }

  // إشعارات محلية فقط (وضع بدون Firebase)
  function wireLocalOnlyNotifications() {
    document.addEventListener('DOMContentLoaded', function () {
      installNotifyHook();
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(function () {});
      }
    });
  }

  function installNotifyHook() {
    var b = bridge();
    if (b && b.setNotifyHook) {
      b.setNotifyHook(function (title, body, tag) { showSystemNotification(title, body, tag); });
    }
  }

  // ================= واجهة الدخول =================
  function showAuthOverlay(show) {
    var el = document.getElementById('authOverlay');
    if (el) el.classList.toggle('hidden', !show);
  }

  function wireAuthUI() {
    var $ = function (id) { return document.getElementById(id); };
    var emailBtn = $('authEmailBtn');
    var googleBtn = $('authGoogleBtn');
    var signupBtn = $('authSignupBtn');
    var logoutBtn = $('authLogoutBtn');
    var msg = $('authMsg');

    function setMsg(txt, kind) {
      if (!msg) return;
      msg.textContent = txt || '';
      msg.style.color = kind === 'err' ? '#e74c3c' : '#10b981';
    }
    function creds() {
      return { email: ($('authEmail') || {}).value || '', pass: ($('authPassword') || {}).value || '' };
    }

    if (emailBtn) emailBtn.onclick = function () {
      var c = creds();
      auth.signInWithEmailAndPassword(c.email.trim(), c.pass)
        .catch(function (e) { setMsg(mapErr(e), 'err'); });
    };
    if (signupBtn) signupBtn.onclick = function () {
      var c = creds();
      auth.createUserWithEmailAndPassword(c.email.trim(), c.pass)
        .catch(function (e) { setMsg(mapErr(e), 'err'); });
    };
    if (googleBtn) googleBtn.onclick = function () {
      var provider = new firebase.auth.GoogleAuthProvider();
      auth.signInWithPopup(provider).catch(function (e) { setMsg(mapErr(e), 'err'); });
    };
    if (logoutBtn) logoutBtn.onclick = function () { auth.signOut(); };
  }

  function mapErr(e) {
    var m = (e && e.code) || '';
    var dict = {
      'auth/invalid-email': T('بريد غير صالح', 'Invalid email'),
      'auth/user-not-found': T('المستخدم غير موجود', 'User not found'),
      'auth/wrong-password': T('كلمة مرور خاطئة', 'Wrong password'),
      'auth/invalid-credential': T('بيانات دخول غير صحيحة', 'Invalid credentials'),
      'auth/email-already-in-use': T('البريد مستخدم بالفعل', 'Email already in use'),
      'auth/weak-password': T('كلمة المرور ضعيفة (6 أحرف على الأقل)', 'Weak password (min 6 chars)'),
      'auth/popup-blocked': T('المتصفح منع النافذة المنبثقة', 'Popup blocked'),
      'auth/popup-closed-by-user': T('تم إغلاق نافذة الدخول', 'Popup closed')
    };
    return dict[m] || (e && e.message) || T('خطأ غير متوقع', 'Unexpected error');
  }

  // ================= البانر العلوي =================
  function showBanner(text, kind) {
    var id = 'cloudBanner';
    var el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:2000;' +
        'padding:8px 14px;padding-bottom:max(8px,env(safe-area-inset-bottom));' +
        'font-size:13px;text-align:center;font-family:inherit;color:#fff;' +
        'box-shadow:0 -2px 10px rgba(0,0,0,.25);';
      document.body.appendChild(el);
    }
    el.style.background = kind === 'warn' ? '#b45309' : '#047857';
    el.textContent = text;
    if (kind !== 'warn') setTimeout(function () { if (el) el.remove(); }, 4000);
  }

  // ================= إقلاع الطبقة =================
  document.addEventListener('DOMContentLoaded', function () {
    wireAuthUI();
    installNotifyHook();
    var b = bridge();
    if (b && b.setLocalSaveHook) b.setLocalSaveHook(onLocalSave);

    auth.onAuthStateChanged(function (user) {
      currentUser = user;
      if (user) {
        showAuthOverlay(false);
        var chip = document.getElementById('authUserChip');
        if (chip) chip.textContent = (user.email || user.displayName || T('مُسجّل', 'Signed in'));
        saveProfile();
        startSync();
        registerPush();
        showBanner(T('تم تسجيل الدخول — المزامنة مُفعّلة', 'Signed in — sync enabled'), 'ok');
      } else {
        if (unsubscribeDoc) { unsubscribeDoc(); unsubscribeDoc = null; }
        // امسح بيانات الحساب من الجهاز عند الخروج حتى لا تتسرّب لأي حساب لاحق
        if (localStorage.getItem(OWNER_KEY)) {
          clearLocalTasks();
          localStorage.removeItem(OWNER_KEY);
        }
        showAuthOverlay(true);
      }
    });
  });
})();
