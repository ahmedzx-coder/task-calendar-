/* =========================================================================
   cloud.js — طبقة السحابة لتطبيق نتيجة (Natija)
   تسجيل الدخول (Firebase Auth) + مزامنة Firestore اللحظية + إشعارات (FCM)
   تعمل كطبقة فوق التطبيق عبر window.AppBridge، والتطبيق يظل يشتغل محلياً
   بالكامل حتى لو Firebase غير مُعد أو تعذّر تحميله (وضع محلي).
   ========================================================================= */
(function () {
  'use strict';

  var cfg = (typeof window !== 'undefined' && window.FIREBASE_CONFIG) || {};
  var vapidKey = (typeof window !== 'undefined' && window.FIREBASE_VAPID_KEY) || '';

  // هل تم ضبط Firebase فعلاً؟ (المفاتيح الافتراضية تبدأ بـ YOUR_)
  function isConfigured() {
    return !window.NatijaPreview && !!(cfg && cfg.apiKey && cfg.apiKey.indexOf('YOUR_') === -1 && cfg.projectId);
  }
  function vapidReady() {
    return !!(vapidKey && vapidKey.indexOf('YOUR_') === -1);
  }

  var isAr = (window.NatijaStorage.getItem('task-planner-lang-v1') || 'ar') === 'ar';
  function T(ar, en) { return isAr ? ar : en; }
  // The language toggle belongs to index.html. Keep cloud banners and
  // Firebase menu controls synchronized when users switch languages.
  window.addEventListener('natija-language-changed', function (event) {
    isAr = (event.detail && event.detail.language || window.NatijaStorage.getItem('task-planner-lang-v1') || 'ar') === 'ar';
    updateNotifyUI();
    if (typeof telegramIsConnected !== 'undefined') updateTelegramButtons(telegramIsConnected);
    if (typeof emailReminderEnabled !== 'undefined') updateEmailReminderButton(emailReminderEnabled);
    if (typeof currentUser !== 'undefined' && currentUser) saveProfile();
  });
  function $(id) { return document.getElementById(id); }
  function bridge() { return window.AppBridge || null; }

  // ================= الأشرطة السفلية (رسائل + طلب تفعيل الإشعارات) =================
  function barHost() {
    var host = $('cloudBars');
    if (!host) {
      host = document.createElement('div');
      host.id = 'cloudBars';
      host.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2000;display:flex;' +
        'flex-direction:column;padding-bottom:env(safe-area-inset-bottom);pointer-events:none;';
      document.body.appendChild(host);
    }
    return host;
  }

  function barStyle(bg) {
    return 'pointer-events:auto;background:' + bg + ';color:#fff;padding:9px 14px;font-size:13px;' +
      'text-align:center;font-family:inherit;box-shadow:0 -2px 10px rgba(0,0,0,.25);' +
      'display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;';
  }

  // kind: 'ok' (يختفي تلقائيًا) | 'warn' (يبقى حتى يُضغط عليه)
  function showBanner(text, kind) {
    var el = $('cloudBanner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'cloudBanner';
      el.title = T('اضغط للإخفاء', 'Tap to dismiss');
      el.onclick = function () { el.remove(); };
      barHost().appendChild(el);
    }
    el.style.cssText = barStyle(kind === 'warn' ? '#b45309' : '#047857') + 'cursor:pointer;';
    el.textContent = text;
    clearTimeout(el._t);
    if (kind !== 'warn') el._t = setTimeout(function () { el.remove(); }, 4000);
  }

  function showNotifyPrompt(onEnable) {
    if ($('notifyPrompt')) return;
    var el = document.createElement('div');
    el.id = 'notifyPrompt';
    el.style.cssText = barStyle('#1e3a5f');
    var msg = document.createElement('span');
    msg.textContent = T('🔔 فعّل الإشعارات عشان توصلك تنبيهات مهامك حتى والموقع مقفول',
                        '🔔 Enable notifications to get task reminders even when the site is closed');
    var btn = document.createElement('button');
    btn.id = 'notifyPromptBtn';
    btn.textContent = T('تفعيل', 'Enable');
    btn.style.cssText = 'border:none;border-radius:999px;padding:7px 18px;font-weight:700;cursor:pointer;' +
      'background:#10b981;color:#fff;min-height:36px;font-family:inherit;';
    btn.onclick = onEnable;
    var close = document.createElement('button');
    close.textContent = '✕';
    close.setAttribute('aria-label', T('إغلاق', 'Close'));
    close.style.cssText = 'border:none;background:transparent;color:#cbd5e1;font-size:16px;cursor:pointer;min-height:36px;';
    close.onclick = hideNotifyPrompt;
    el.appendChild(msg); el.appendChild(btn); el.appendChild(close);
    barHost().appendChild(el);
  }
  function hideNotifyPrompt() { var el = $('notifyPrompt'); if (el) el.remove(); }

  // ================= الإشعارات (مشتركة بين الوضعين) =================
  function notifySupported() { return ('Notification' in window) && ('serviceWorker' in navigator); }

  // نص زر الإشعارات في القائمة حسب حالة الإذن
  function updateNotifyUI() {
    var btn = $('notifyEnableBtn');
    if (!btn) return;
    if (!notifySupported()) { btn.classList.add('hidden'); return; }
    var p = Notification.permission;
    btn.textContent = p === 'granted' ? T('🔔 الإشعارات مفعّلة ✅', '🔔 Notifications on ✅')
                    : p === 'denied'  ? T('🔕 الإشعارات مرفوضة', '🔕 Notifications blocked')
                    : T('🔔 تفعيل الإشعارات', '🔔 Enable notifications');
  }

  // لا نطلب الإذن إلا بضغطة من المستخدم (شرط Safari وFirefox والآيفون)
  function ensureNotifyPermission(allowPrompt) {
    if (!('Notification' in window)) return Promise.resolve(false);
    if (Notification.permission === 'granted') return Promise.resolve(true);
    if (Notification.permission === 'denied' || !allowPrompt) return Promise.resolve(false);
    return Promise.resolve(Notification.requestPermission()).then(function (p) { return p === 'granted'; });
  }

  function deniedHint() {
    showBanner(T('الإشعارات مرفوضة للموقع ده — اضغط 🔒 جنب العنوان ← الإشعارات ← سماح، وبعدين اعمل Refresh',
                 'Notifications are blocked — click 🔒 next to the address ← Notifications ← Allow, then refresh'), 'warn');
  }

  // إشعار نظام يظهر حتى لو التبويب في الخلفية (عبر الـ service worker إن وُجد)
  function showSystemNotification(title, body, tag) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    var opts = { body: body || '', tag: tag || 'task', icon: 'icons/icon-192.png',
                 badge: 'icons/icon-192.png', lang: isAr ? 'ar' : 'en' };
    var direct = function () { try { new Notification(title, opts); } catch (e) {} };
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then(function (reg) {
        if (reg) return reg.showNotification(title, opts);
        direct();
      }).catch(direct);
    } else {
      direct();
    }
  }

  function installNotifyHook() {
    var b = bridge();
    if (b && b.setNotifyHook) {
      b.setNotifyHook(function (title, body, tag) { showSystemNotification(title, body, tag); });
    }
  }

  // Do not expose the task calendar before Firebase resolves the session.
  // Authentication failures leave the app closed, with a clear retry action.
  function showAuthBootError() {
    var msg = $('authBootMessage');
    if (msg) msg.textContent = T(
      'تعذّر الاتصال بتسجيل الدخول. اتأكد من الإنترنت واضغط إعادة المحاولة.',
      'Could not check your login. Check your connection and try again.'
    );
    var retry = $('authBootRetryBtn');
    if (retry) retry.hidden = false;
  }

  // ================= وضع محلي (Firebase غير مُعد أو تعذّر تحميله) =================
  if (!isConfigured() || typeof firebase === 'undefined') {
    document.addEventListener('DOMContentLoaded', function () {
      if (window.NatijaPreview) {
        ['authLogoutBtn', 'authUserChip', 'notifyEnableBtn'].forEach(function (id) { var el = $(id); if (el) el.classList.add('hidden'); });
        document.documentElement.classList.remove('auth-pending');
        return;
      }
      // On the published site, offline/Firebase errors must not silently
      // reveal tasks belonging to the last logged-in account.
      showAuthBootError();
      return;
      installNotifyHook();
      ['authLogoutBtn', 'authUserChip'].forEach(function (id) { var el = $(id); if (el) el.classList.add('hidden'); });
      if (!window.NatijaPreview && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});

      var nb = $('notifyEnableBtn');
      if (nb) nb.onclick = function () {
        if (!notifySupported()) return;
        if (Notification.permission === 'denied') { deniedHint(); return; }
        ensureNotifyPermission(true).then(function (ok) {
          updateNotifyUI();
          if (ok) showBanner(T('🔔 تم تفعيل الإشعارات (أثناء فتح التطبيق)', '🔔 Notifications enabled (while the app is open)'), 'ok');
        });
      };
      updateNotifyUI();

      showBanner(isConfigured()
        ? T('تعذّر تحميل Firebase — شغّال في الوضع المحلي. اتأكد من الإنترنت، أو إن مانع الإعلانات/Brave Shields مش حاجب gstatic.com',
            'Could not load Firebase — running in local mode. Check your connection or ad-blocker (gstatic.com)')
        : T('وضع محلي — لتفعيل الدخول والمزامنة والإشعارات، اضبط ملف firebase-config.js',
            'Local mode — set firebase-config.js to enable login, sync & notifications'),
        'warn');
    });
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
  function getLocalData() {
    var b = bridge();
    if (b && b.getData) return b.getData();
    return {
      tasks: JSON.parse(window.NatijaStorage.getItem('tasks') || '[]'),
      completedTasks: JSON.parse(window.NatijaStorage.getItem('completedTasks') || '[]')
    };
  }

  function applyToApp(tasks, completedTasks, projects) {
    applyingRemote = true;
    try {
      var b = bridge();
      if (b && b.applyRemote) b.applyRemote(tasks, completedTasks, projects);
      else {
        window.NatijaStorage.setItem('tasks', JSON.stringify(tasks || []));
        window.NatijaStorage.setItem('completedTasks', JSON.stringify(completedTasks || []));
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

  // يحفظ المنطقة الزمنية واللغة ليحسب سكربت التنبيهات المواعيد بدقة
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

  function syncErrText(err) {
    var code = err && err.code;
    if (code === 'permission-denied') {
      return T('Firestore رافض الوصول — انشر قواعد الأمان (Rules) من Firebase Console',
               'Firestore denied access — publish the security rules in Firebase Console');
    }
    if (code === 'unavailable') {
      return T('مفيش اتصال بـ Firestore دلوقتي — هيتزامن أول ما النت يرجع',
               'Firestore unavailable — will sync when back online');
    }
    return T('تعذّرت المزامنة: ', 'Sync error: ') + ((err && err.message) || err);
  }

  function clearLocalTasks() { applyToApp([], []); }

  function startSync() {
    if (unsubscribeDoc) { unsubscribeDoc(); unsubscribeDoc = null; }

    // حماية الخصوصية: لا تدمج مهامًا محلية تخص حسابًا آخر على نفس الجهاز.
    // الدمج مسموح فقط لو البيانات المحلية مجهولة (استُخدمت قبل أي تسجيل دخول)
    // أو تخص نفس المستخدم الحالي.
    var owner = window.NatijaStorage.getItem(OWNER_KEY);
    var canMergeLocal = (!owner || owner === currentUser.uid);
    if (!canMergeLocal) clearLocalTasks();

    var syncingUid = currentUser.uid;
    userDoc().get().then(function (snap) {
      if (!currentUser || currentUser.uid !== syncingUid) return;
      var local = canMergeLocal ? getLocalData() : { tasks: [], completedTasks: [] };
      var data = (snap.exists && snap.data()) || {};
      var mergedTasks = mergeById(local.tasks, data.tasks || []);
      var mergedCompleted = mergeById(local.completedTasks, data.completedTasks || []);
      applyToApp(mergedTasks, mergedCompleted, mergeById(local.projects || [], data.projects || []));
      pushToCloud(mergedTasks, mergedCompleted, true);
      window.NatijaStorage.setItem(OWNER_KEY, currentUser.uid);
      listenRealtime();
      // Show onboarding once per account, only after its existing task data
      // has loaded. This never writes demo tasks or changes notification settings.
      if (window.NatijaTour) {
        setTimeout(function () {
          if (currentUser && currentUser.uid === syncingUid) {
            window.NatijaTour.maybeStart(syncingUid, Number(data.onboardingVersion || 0) >= 1);
          }
        }, 400);
      }
    }).catch(function (err) {
      console.error('[cloud] sync error', err);
      showBanner(syncErrText(err), 'warn');
    });
  }

  function listenRealtime() {
    unsubscribeDoc = userDoc().onSnapshot({ includeMetadataChanges: false }, function (snap) {
      if (!snap.exists) return;
      if (snap.metadata && snap.metadata.hasPendingWrites) return; // تجاهل صدى كتابتنا المحلية
      var data = snap.data() || {};
      applyToApp(data.tasks || [], data.completedTasks || [], data.projects || []);
    }, function (err) { console.error('[cloud] snapshot error', err); });
  }

  function pushToCloud(tasks, completedTasks, immediate) {
    if (!currentUser) return;
    var payload = {
      tasks: tasks || [],
      completedTasks: completedTasks || [],
      projects: getLocalData().projects || [],
      schemaVersion: 2,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    var target = userDoc(), ownerUid = currentUser.uid;
    var write = function () {
      if (!currentUser || currentUser.uid !== ownerUid) return;
      target.set(payload, { merge: true }).catch(function (e) {
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

  // ================= Push (FCM) =================
  function pushErrorHint(e) {
    var m = (e && (e.message || e.code)) || String(e);
    var n = (e && e.name) || '';
    if (navigator.brave && /push service|AbortError|Registration failed|token-subscribe/i.test(m + ' ' + n)) {
      return T('متصفح Brave بيقفل خدمة الإشعارات افتراضيًا: افتح brave://settings/privacy وفعّل "Use Google services for push messaging" وأعد تشغيل Brave — أو جرّب Chrome',
               'Brave blocks push by default: open brave://settings/privacy, enable "Use Google services for push messaging" and restart Brave — or use Chrome');
    }
    return T('تعذّر تفعيل الإشعارات: ', 'Could not enable notifications: ') + m;
  }

  // يسجّل الجهاز لاستقبال الإشعارات ويحفظ التوكن في حساب المستخدم.
  // fromClick=true فقط عند ضغطة المستخدم (يُسمح حينها بطلب الإذن وعرض الرسائل)
  function registerPush(fromClick) {
    if (!notifySupported() || !messaging) {
      if (fromClick) showBanner(T('المتصفح ده مش بيدعم الإشعارات الفورية — على الآيفون ضيف الموقع للشاشة الرئيسية الأول',
                                  'This browser does not support push — on iPhone, add the site to the Home Screen first'), 'warn');
      return Promise.resolve(false);
    }
    if (!vapidReady()) return Promise.resolve(false);
    if (fromClick && Notification.permission === 'denied') { deniedHint(); return Promise.resolve(false); }

    return ensureNotifyPermission(fromClick).then(function (ok) {
      updateNotifyUI();
      if (!ok) return false;
      return navigator.serviceWorker.register('firebase-messaging-sw.js').then(function (reg) {
        return messaging.getToken({ vapidKey: vapidKey, serviceWorkerRegistration: reg });
      }).then(function (token) {
        if (!token) throw new Error(T('ماطلعش توكن للجهاز', 'No device token'));
        if (!currentUser) return;
        return userDoc().set({ fcmTokens: firebase.firestore.FieldValue.arrayUnion(token) }, { merge: true });
      }).then(function () {
        hideNotifyPrompt();
        if (fromClick) showBanner(T('🔔 تم تفعيل الإشعارات على الجهاز ده', '🔔 Notifications enabled on this device'), 'ok');
        return true;
      }).catch(function (e) {
        console.warn('[cloud] push token error', e);
        if (fromClick) showBanner(pushErrorHint(e), 'warn');
        return false;
      });
    });
  }

  // عند الخروج: شيل الجهاز من حساب المستخدم حتى لا تصل إشعاراته لأي حساب لاحق على نفس الجهاز
  function detachDeviceToken() {
    if (!messaging || !currentUser || !notifySupported() || Notification.permission !== 'granted') {
      return Promise.resolve();
    }
    return navigator.serviceWorker.getRegistration().then(function (reg) {
      if (!reg) return;
      return messaging.getToken({ vapidKey: vapidKey, serviceWorkerRegistration: reg }).then(function (token) {
        if (!token) return;
        return userDoc().set({ fcmTokens: firebase.firestore.FieldValue.arrayRemove(token) }, { merge: true })
          .then(function () { return messaging.deleteToken(); });
      });
    }).catch(function (e) { console.warn('[cloud] detach token error', e); });
  }

  // Telegram connection: a one-time random deep-link code is stored in the current
  // user's Firebase document. A trusted GitHub Action resolves the code through the
  // Telegram Bot API and stores the chat ID in a backend-only collection.
  var telegramSnapshotUnsub = null;
  var telegramIsConnected = false;
  function updateTelegramButtons(connected) {
    telegramIsConnected = !!connected;
    var connect = $('telegramConnectBtn');
    var disconnect = $('telegramDisconnectBtn');
    if (connect) connect.classList.toggle('hidden', !currentUser || !!connected);
    if (disconnect) disconnect.classList.toggle('hidden', !currentUser || !connected);
    if (connect) connect.textContent = T('✈️ ربط Telegram', '✈️ Connect Telegram');
    if (disconnect) disconnect.textContent = T('✈️ إلغاء ربط Telegram', '✈️ Disconnect Telegram');
  }

  function connectTelegram() {
    if (!currentUser) return;
    var bytes = new Uint8Array(24);
    if (!window.crypto || !window.crypto.getRandomValues) {
      showBanner(T('المتصفح لا يدعم الربط الآمن', 'Secure linking is not supported'), 'warn');
      return;
    }
    window.crypto.getRandomValues(bytes);
    var code = Array.prototype.map.call(bytes, function (b) {
      return ('0' + b.toString(16)).slice(-2);
    }).join('');
    userDoc().set({
      telegramLink: { code: code, expiresAt: Date.now() + 30 * 60 * 1000 },
      telegramDisconnectRequested: false
    }, { merge: true }).then(function () {
      var url = 'https://t.me/NatijaReminderBot?start=' + code;
      // Display the link as a fallback in case popup restrictions block it.
      showBanner(T('افتح Telegram واضغط Start لإتمام الربط', 'Open Telegram and tap Start to finish linking'), 'ok');
      var tab = window.open(url, '_blank', 'noopener,noreferrer');
      if (!tab) window.location.href = url;
    }).catch(function (error) { showBanner(syncErrText(error), 'warn'); });
  }

  function disconnectTelegram() {
    if (!currentUser) return;
    // Only the trusted backend removes the private mapping.
    userDoc().set({
      telegramDisconnectRequested: true,
      telegramConnected: false,
      telegramLink: firebase.firestore.FieldValue.delete()
    }, { merge: true }).then(function () {
      showBanner(T('سيتم إيقاف رسائل Telegram في الفحص القادم', 'Telegram messages will stop on the next check'), 'ok');
    }).catch(function (error) { showBanner(syncErrText(error), 'warn'); });
  }

  function watchTelegramStatus() {
    if (telegramSnapshotUnsub) telegramSnapshotUnsub();
    telegramSnapshotUnsub = userDoc().onSnapshot(function (snapshot) {
      var data = snapshot.data() || {};
      updateTelegramButtons(!!data.telegramConnected && !data.telegramDisconnectRequested);
      updateEmailReminderButton(data.emailRemindersEnabled === true);
    }, function () { updateTelegramButtons(false); updateEmailReminderButton(false); });
  }

  // Opt-in email reminders to the verified email address in Firebase Authentication.
  // The browser never sees Gmail SMTP credentials or chooses arbitrary recipients.
  var emailReminderEnabled = false;
  function updateEmailReminderButton(enabled) {
    emailReminderEnabled = !!enabled;
    var btn = $('emailReminderBtn');
    if (!btn) return;
    btn.classList.toggle('hidden', !currentUser || !currentUser.email);
    btn.textContent = enabled
      ? T('📧 إيقاف تذكيرات الإيميل ✅', '📧 Disable email reminders ✅')
      : T('📧 تفعيل تذكيرات الإيميل', '📧 Enable email reminders');
  }

  function toggleEmailReminders() {
    if (!currentUser || !currentUser.email) return;
    var user = currentUser;
    var ref = db.collection('users').doc(user.uid);
    if (emailReminderEnabled) {
      ref.set({ emailRemindersEnabled: false }, { merge: true }).then(function () {
        showBanner(T('تم إيقاف تذكيرات الإيميل', 'Email reminders disabled'), 'ok');
      }).catch(function (err) { showBanner(syncErrText(err), 'warn'); });
      return;
    }
    user.reload().then(function () {
      if (!auth.currentUser || auth.currentUser.uid !== user.uid) return;
      if (!auth.currentUser.emailVerified) {
        return auth.currentUser.sendEmailVerification().then(function () {
          showBanner(T('بعتنالك رسالة تأكيد على إيميل حسابك. افتحها وبعد التأكيد اضغط تفعيل تذكيرات الإيميل مرة تانية',
                       'Verification email sent. Verify your address, then enable email reminders again'), 'warn');
        });
      }
      return ref.set({ emailRemindersEnabled: true }, { merge: true }).then(function () {
        showBanner(T('تم طلب تفعيل تذكيرات الإيميل على بريد حسابك. لازم يكون Gmail SMTP متضبط في GitHub Secrets',
                     'Email reminders opted in for your account. Gmail SMTP must be configured in GitHub Secrets'), 'ok');
      });
    }).catch(function (err) { showBanner(syncErrText(err), 'warn'); });
  }

  // ================= واجهة الدخول =================
  function showAuthOverlay(show) {
    var el = $('authOverlay');
    if (!el) return;
    document.body.classList.toggle('auth-locked', !!show);
    el.classList.toggle('hidden', !show);
    // The first paint stays private until we know whether to show login or app.
    document.documentElement.classList.remove('auth-pending');
    // The login screen has its own scroll area. Never scroll the calendar
    // underneath it; reset the viewport when signing out.
    if (show) window.scrollTo(0, 0);
  }

  function wireAuthUI() {
    var emailBtn = $('authEmailBtn');
    var googleBtn = $('authGoogleBtn');
    var signupBtn = $('authSignupBtn');
    var logoutBtn = $('authLogoutBtn');
    var passInput = $('authPassword');
    var msg = $('authMsg');

    function setMsg(txt, kind) {
      if (!msg) return;
      msg.textContent = txt || '';
      msg.style.color = kind === 'err' ? '#e74c3c' : '#10b981';
    }
    function creds() {
      return { email: (($('authEmail') || {}).value || '').trim(), pass: (passInput || {}).value || '' };
    }

    if (emailBtn) emailBtn.onclick = function () {
      var c = creds();
      setMsg('');
      auth.signInWithEmailAndPassword(c.email, c.pass).catch(function (e) { setMsg(mapErr(e), 'err'); });
    };
    if (signupBtn) signupBtn.onclick = function () {
      var c = creds();
      setMsg('');
      auth.createUserWithEmailAndPassword(c.email, c.pass).catch(function (e) { setMsg(mapErr(e), 'err'); });
    };
    if (googleBtn) googleBtn.onclick = function () {
      setMsg('');
      var provider = new firebase.auth.GoogleAuthProvider();
      auth.signInWithPopup(provider).catch(function (e) { setMsg(mapErr(e), 'err'); });
    };
    if (passInput) passInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && emailBtn) emailBtn.click();
    });
    if (logoutBtn) logoutBtn.onclick = function () {
      // لا تعلّق الخروج لو الشبكة بطيئة
      var t = setTimeout(function () { auth.signOut(); }, 4000);
      detachDeviceToken().then(function () { clearTimeout(t); auth.signOut(); });
    };
  }

  function mapErr(e) {
    var m = (e && e.code) || '';
    var dict = {
      'auth/invalid-email': T('بريد غير صالح', 'Invalid email'),
      'auth/missing-password': T('اكتب كلمة المرور', 'Enter your password'),
      'auth/user-not-found': T('المستخدم غير موجود', 'User not found'),
      'auth/wrong-password': T('كلمة مرور خاطئة', 'Wrong password'),
      'auth/invalid-credential': T('بيانات دخول غير صحيحة', 'Invalid credentials'),
      'auth/email-already-in-use': T('البريد مستخدم بالفعل — جرّب تسجيل الدخول', 'Email already in use — try signing in'),
      'auth/weak-password': T('كلمة المرور ضعيفة (6 أحرف على الأقل)', 'Weak password (min 6 chars)'),
      'auth/operation-not-allowed': T('طريقة الدخول دي مش مفعّلة في Firebase (Authentication ← Sign-in method)',
                                      'This sign-in method is not enabled in Firebase'),
      'auth/unauthorized-domain': T('النطاق ده مش مصرّح بيه — ضيفه في Authentication ← Settings ← Authorized domains',
                                    'This domain is not authorized in Firebase'),
      'auth/popup-blocked': T('المتصفح منع النافذة المنبثقة — اسمح بالـ popups وجرّب تاني', 'Popup blocked — allow popups and retry'),
      'auth/popup-closed-by-user': T('تم إغلاق نافذة الدخول', 'Popup closed'),
      'auth/network-request-failed': T('مشكلة في الاتصال بالإنترنت', 'Network error'),
      'auth/too-many-requests': T('محاولات كتير — استنى شوية وجرّب تاني', 'Too many attempts — try again later')
    };
    return dict[m] || (e && e.message) || T('خطأ غير متوقع', 'Unexpected error');
  }

  // ================= إقلاع الطبقة =================
  document.addEventListener('DOMContentLoaded', function () {
    wireAuthUI();
    if ($('telegramConnectBtn')) $('telegramConnectBtn').onclick = connectTelegram;
    if ($('telegramDisconnectBtn')) $('telegramDisconnectBtn').onclick = disconnectTelegram;
    if ($('emailReminderBtn')) $('emailReminderBtn').onclick = toggleEmailReminders;
    window.addEventListener('natija-onboarding-completed', function (event) {
      var detail = event.detail || {};
      if (!currentUser || detail.uid !== currentUser.uid || detail.version !== 1) return;
      userDoc().set({ onboardingVersion: 1 }, { merge: true }).catch(function (err) {
        console.warn('[cloud] onboarding progress sync failed:', err && err.code);
      });
    });
    installNotifyHook();
    var b = bridge();
    if (b && b.setLocalSaveHook) b.setLocalSaveHook(onLocalSave);

    var nb = $('notifyEnableBtn');
    if (nb) nb.onclick = function () { registerPush(true); };
    updateNotifyUI();

    auth.onAuthStateChanged(function (user) {
      currentUser = user;
      if (window.NatijaTour) window.NatijaTour.identify(user ? user.uid : null);
      if (user) {
        showAuthOverlay(false);
        var chip = $('authUserChip');
        if (chip) chip.textContent = (user.email || user.displayName || T('مُسجّل', 'Signed in'));
        saveProfile();
        startSync();
        watchTelegramStatus();
        if (notifySupported() && messaging && vapidReady()) {
          if (Notification.permission === 'granted') registerPush(false);  // تحديث التوكن بهدوء
          else if (Notification.permission === 'default') showNotifyPrompt(function () { registerPush(true); });
        }
        showBanner(T('تم تسجيل الدخول — المزامنة مُفعّلة', 'Signed in — sync enabled'), 'ok');
      } else {
        if (unsubscribeDoc) { unsubscribeDoc(); unsubscribeDoc = null; }
        if (telegramSnapshotUnsub) { telegramSnapshotUnsub(); telegramSnapshotUnsub = null; }
        updateTelegramButtons(false);
        updateEmailReminderButton(false);
        hideNotifyPrompt();
        // امسح بيانات الحساب من الجهاز عند الخروج حتى لا تتسرّب لأي حساب لاحق
        if (window.NatijaStorage.getItem(OWNER_KEY)) {
          clearLocalTasks();
          window.NatijaStorage.removeItem(OWNER_KEY);
        }
        showAuthOverlay(true);
      }
    }, function (error) {
      console.warn('[cloud] Firebase auth initialization failed', error && error.code);
      showAuthBootError();
    });
  });
})();
