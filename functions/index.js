/* functions/index.js
   دالة مجدولة تعمل كل دقيقة: تقرأ مهام المستخدمين من Firestore، وتُرسل
   إشعار FCM عند حلول موعد/تذكير مهمة — فتصل الإشعارات حتى لو المتصفح مغلق.
   تتطلب خطة Blaze (مجانية فعلياً للاستخدام الخفيف). انظر SETUP-FIREBASE.md.
*/
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { DateTime } = require('luxon');

initializeApp();
const db = getFirestore();

// يحوّل "09:00 AM" أو "21:30" أو "9:5 pm" إلى عدد دقائق من منتصف الليل
function timeToMinutes(str) {
  if (!str) return null;
  const s = String(str).trim().toLowerCase();
  const m = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm|ص|م)?/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ap = m[3];
  if (ap === 'pm' || ap === 'م') { if (h < 12) h += 12; }
  if (ap === 'am' || ap === 'ص') { if (h === 12) h = 0; }
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

exports.sendTaskReminders = onSchedule(
  { schedule: 'every 1 minutes', timeZone: 'UTC', region: 'us-central1' },
  async () => {
    const snap = await db.collection('users').get();
    const jobs = [];

    snap.forEach((docSnap) => {
      const data = docSnap.data() || {};
      const tokens = Array.isArray(data.fcmTokens) ? data.fcmTokens.filter(Boolean) : [];
      const tasks = Array.isArray(data.tasks) ? data.tasks : [];
      if (!tokens.length || !tasks.length) return;

      const tz = data.tz || 'UTC';
      const now = DateTime.now().setZone(tz);
      const today = now.toFormat('yyyy-LL-dd');
      const nowMin = now.hour * 60 + now.minute;
      const isAr = (data.lang || 'ar') === 'ar';

      const pushed = Object.assign({}, data.pushed || {}); // مفاتيح: date_id_type
      let changed = false;
      const messages = [];

      tasks.forEach((t) => {
        if (!t || t.completed || t.date !== today || !t.time) return;
        const taskMin = timeToMinutes(t.time);
        if (taskMin == null) return;
        const rem = parseInt(t.reminderMinutes || 0, 10) || 0;

        // تذكير قبل الموعد
        if (rem > 0) {
          const key = `${today}_${t.id}_rem`;
          if (!pushed[key] && nowMin >= (taskMin - rem) && nowMin < taskMin) {
            pushed[key] = true; changed = true;
            messages.push({
              title: isAr ? '🔔 تذكير قبل الموعد' : '🔔 Upcoming task',
              body: t.title || (isAr ? 'لديك مهمة قريبًا' : 'You have a task soon'),
              tag: 'rem-' + t.id
            });
          }
        }

        // موعد المهمة (خلال نافذة 3 دقائق بعد الوقت)
        const keyA = `${today}_${t.id}_alarm`;
        if (!pushed[keyA] && nowMin >= taskMin && (nowMin - taskMin) <= 3) {
          pushed[keyA] = true; changed = true;
          messages.push({
            title: isAr ? '⏰ حان وقت المهمة' : '⏰ Task time',
            body: t.title || (isAr ? 'حان وقت مهمتك' : "It's time for your task"),
            tag: 'alm-' + t.id
          });
        }
      });

      if (!messages.length) return;

      // تنظيف مفاتيح الأيام السابقة لتفادي التضخم
      const prunedPushed = {};
      Object.keys(pushed).forEach((k) => { if (k.indexOf(today + '_') === 0) prunedPushed[k] = true; });

      const send = getMessaging().sendEachForMulticast({
        tokens,
        notification: {
          title: messages[0].title,
          body: messages.map((m) => m.body).join(isAr ? '، ' : ', ')
        },
        data: { tag: messages[0].tag },
        webpush: { fcmOptions: { link: 'https://ahmedzx-coder.github.io/task-calendar-/' } }
      }).then((res) => {
        // أزل التوكنات غير الصالحة
        const invalid = [];
        res.responses.forEach((r, i) => {
          if (!r.success) {
            const code = r.error && r.error.code;
            if (code === 'messaging/registration-token-not-registered' ||
                code === 'messaging/invalid-registration-token') invalid.push(tokens[i]);
          }
        });
        const update = { pushed: prunedPushed };
        if (invalid.length) update.fcmTokens = FieldValue.arrayRemove.apply(null, invalid);
        return docSnap.ref.set(update, { merge: true });
      }).catch((e) => console.error('send error', e));

      jobs.push(send);
    });

    await Promise.all(jobs);
    return null;
  }
);
