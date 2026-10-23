/* scripts/send-reminders.js
   يعمل داخل GitHub Actions كل ~5 دقائق: يقرأ مهام المستخدمين من Firestore
   ويُرسل إشعار FCM للمهام المستحقة — فتصل الإشعارات حتى والمتصفح مغلق،
   بدون الحاجة لخطة Blaze. المصادقة عبر Service Account مُخزَّن في GitHub Secret.
*/
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { DateTime } = require('luxon');

// نافذة الالتقاط (بالدقائق): تعوّض تأخير جدولة GitHub Actions حتى لا تُفوَّت مهمة
const CATCHUP_MIN = 30;

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) {
  console.error('✖ لا يوجد FIREBASE_SERVICE_ACCOUNT في البيئة. أضِفه كـ GitHub Secret.');
  process.exit(1);
}
let serviceAccount;
try { serviceAccount = JSON.parse(raw); }
catch (e) { console.error('✖ FIREBASE_SERVICE_ACCOUNT ليس JSON صالحًا:', e.message); process.exit(1); }

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

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

async function main() {
  console.log('🔍 فحص Firestore — المشروع:', serviceAccount.project_id, '| المجموعة: users');
  const snap = await db.collection('users').get();
  console.log('👥 عدد مستندات المستخدمين:', snap.size);
  if (snap.empty) {
    console.log('ℹ️ مفيش مستخدمين في Firestore/users بعد. سجّل دخولك على الموقع (يكتب المستند تلقائيًا) ثم أعد تشغيل الـ workflow.');
    return;
  }
  let usersChecked = 0, sent = 0;

  for (const docSnap of snap.docs) {
    usersChecked++;
    const data = docSnap.data() || {};
    const tokens = Array.isArray(data.fcmTokens) ? data.fcmTokens.filter(Boolean) : [];
    const tasks = Array.isArray(data.tasks) ? data.tasks : [];
    if (!tokens.length || !tasks.length) continue;

    const tz = data.tz || 'UTC';
    const now = DateTime.now().setZone(tz);
    const today = now.toFormat('yyyy-LL-dd');
    const nowMin = now.hour * 60 + now.minute;
    const isAr = (data.lang || 'ar') === 'ar';

    const pushed = Object.assign({}, data.pushed || {});
    const messages = [];
    let changed = false;

    for (const t of tasks) {
      if (!t || t.completed || t.date !== today || !t.time) continue;
      const taskMin = timeToMinutes(t.time);
      if (taskMin == null) continue;
      const rem = parseInt(t.reminderMinutes || 0, 10) || 0;

      // تذكير قبل الموعد
      if (rem > 0) {
        const key = `${today}_${t.id}${t.reminderVersion ? '_' + t.reminderVersion : ''}_rem`;
        if (!pushed[key] && nowMin >= (taskMin - rem) && nowMin < taskMin) {
          pushed[key] = true; changed = true;
          messages.push({ title: isAr ? '🔔 تذكير قبل الموعد' : '🔔 Upcoming task',
                          body: t.title || (isAr ? 'لديك مهمة قريبًا' : 'You have a task soon') });
        }
      }

      // موعد المهمة (مع نافذة التقاط تعوّض تأخير الجدولة)
      const keyA = `${today}_${t.id}${t.reminderVersion ? '_' + t.reminderVersion : ''}_alarm`;
      if (!pushed[keyA] && alarmWasScheduledAhead(t, now, taskMin) && nowMin >= taskMin && (nowMin - taskMin) <= CATCHUP_MIN) {
        pushed[keyA] = true; changed = true;
        messages.push({ title: isAr ? '⏰ حان وقت المهمة' : '⏰ Task time',
                        body: t.title || (isAr ? 'حان وقت مهمتك' : "It's time for your task") });
      }
    }

    if (!messages.length) continue;

    // أبقِ مفاتيح اليوم فقط لتفادي تضخّم المستند
    const prunedPushed = {};
    Object.keys(pushed).forEach((k) => { if (k.indexOf(today + '_') === 0) prunedPushed[k] = true; });

    const res = await getMessaging().sendEachForMulticast({
      tokens,
      notification: {
        title: messages[0].title,
        body: messages.map((m) => m.body).join(isAr ? '، ' : ', ')
      },
      webpush: { fcmOptions: { link: 'https://ahmedzx-coder.github.io/task-calendar-/' } }
    });
    sent += res.successCount;

    const invalid = [];
    res.responses.forEach((r, i) => {
      if (!r.success) {
        const code = r.error && r.error.code;
        if (code === 'messaging/registration-token-not-registered' ||
            code === 'messaging/invalid-registration-token') invalid.push(tokens[i]);
      }
    });

    const update = { pushed: prunedPushed };
    if (invalid.length) update.fcmTokens = FieldValue.arrayRemove(...invalid);
    await docSnap.ref.set(update, { merge: true });
  }

  console.log(`✓ فُحِص ${usersChecked} مستخدم، أُرسل ${sent} إشعار.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('✖ خطأ:', e); process.exit(1); });

// Do not send a due-time alarm for a start that predates creation/rescheduling.
function alarmWasScheduledAhead(task, clock, minute) {
  const scheduledAt = clock.set({ hour: Math.floor(minute / 60), minute: minute % 60, second: 0, millisecond: 0 }).toMillis();
  const scheduledSince = Math.max(Date.parse(task.createdAt) || 0, Number(task.reminderVersion) || 0);
  return scheduledAt > scheduledSince;
}
