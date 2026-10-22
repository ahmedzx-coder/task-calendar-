/* Optional opt-in email reminders for Natija users.
 * Delivers to the verified Firebase Authentication email address only.
 * The Gmail SMTP credentials are GitHub Actions Secrets, NEVER browser code.
 */
'use strict';

const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { createHash } = require('node:crypto');
const { DateTime } = require('luxon');
const nodemailer = require('nodemailer');

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
const sender = String(process.env.GMAIL_SENDER_EMAIL || '').trim();
const password = String(process.env.GMAIL_APP_PASSWORD || '').replace(/\s/g, '');
const CATCHUP_MIN = 30;
const MAX_PER_ACCOUNT_DAY = 60;
const LEASE_MILLISECONDS = 180000;
const APP_URL = 'https://ahmedzx-coder.github.io/task-calendar-/';

if (!sender || !password) {
  console.log('Email reminders not configured. Set GMAIL_SENDER_EMAIL and GMAIL_APP_PASSWORD in GitHub Actions Secrets.');
  process.exit(0);
}
if (!raw) {
  console.error('Missing FIREBASE_SERVICE_ACCOUNT secret.');
  process.exit(1);
}
let serviceAccount;
try { serviceAccount = JSON.parse(raw); }
catch (_error) { console.error('Invalid FIREBASE_SERVICE_ACCOUNT JSON.'); process.exit(1); }

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();
const auth = getAuth();
const transport = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  connectionTimeout: 12000,
  greetingTimeout: 12000,
  socketTimeout: 20000,
  auth: { user: sender, pass: password }
});

function timeToMinutes(value) {
  const match = String(value || '').trim().toLowerCase().match(/^(\d{1,2}):(\d{2})\s*(am|pm|ص|م)?/);
  if (!match) return null;
  let h = Number(match[1]);
  const min = Number(match[2]);
  if (h > 23 || min > 59) return null;
  if (match[3] === 'pm' || match[3] === 'م') { if (h < 12) h += 12; }
  if (match[3] === 'am' || match[3] === 'ص') { if (h === 12) h = 0; }
  return h * 60 + min;
}

async function claimReminder(userRef, today, key, currentTime) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const data = snap.data() || {};
    if (data.emailRemindersEnabled !== true) return false;
    const existing = data.emailPushed || {};
    const pushed = {};
    const todayPrefix = today + '_';
    for (const name of Object.keys(existing)) {
      if (name.startsWith(todayPrefix)) pushed[name] = existing[name];
    }
    const previous = pushed[key];
    if (previous === true || (typeof previous === 'number' && currentTime - previous < LEASE_MILLISECONDS)) return false;
    if (Object.keys(pushed).filter(name => pushed[name] === true).length >= MAX_PER_ACCOUNT_DAY) return false;
    pushed[key] = currentTime;
    tx.set(userRef, { emailPushed: pushed }, { merge: true });
    return true;
  });
}

async function finishReminder(userRef, key, lease, delivered) {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const data = snap.data() || {};
    const pushed = Object.assign({}, data.emailPushed || {});
    if (pushed[key] !== lease) return;
    if (delivered) pushed[key] = true;
    else delete pushed[key];
    tx.set(userRef, { emailPushed: pushed }, { merge: true });
  });
}

async function main() {
  const users = await db.collection('users').where('emailRemindersEnabled', '==', true).get();
  console.log('Email reminders: opted-in accounts:', users.size);
  let sent = 0, errors = 0, skippedUnverified = 0;

  for (const doc of users.docs) {
    const data = doc.data() || {};
    const tasks = Array.isArray(data.tasks) ? data.tasks : [];
    if (!tasks.length) continue;

    let account;
    try { account = await auth.getUser(doc.id); }
    catch (_error) { console.warn('Email reminders: account lookup failed'); errors++; continue; }
    // A client-controlled email field in Firestore must never be used as the recipient.
    if (!account.email || !account.emailVerified) { skippedUnverified++; continue; }
    const time = DateTime.now().setZone(data.tz || 'UTC');
    if (!time.isValid) continue;
    const today = time.toFormat('yyyy-LL-dd');
    const nowMin = time.hour * 60 + time.minute;
    const ar = (data.lang || 'ar') === 'ar';

    for (const task of tasks) {
      if (!task || task.completed || task.date !== today || !task.time || task.id == null) continue;
      const taskMin = timeToMinutes(task.time);
      if (taskMin === null) continue;
      const reminder = Math.max(0, Number.parseInt(task.reminderMinutes, 10) || 0);
      const events = [
        { type: 'rem', due: reminder > 0 && nowMin >= taskMin - reminder && nowMin < taskMin },
        { type: 'alarm', due: nowMin >= taskMin && nowMin - taskMin <= CATCHUP_MIN }
      ];
      for (const event of events) {
        if (!event.due) continue;
        const hashedId = createHash('sha256').update(String(task.id)).digest('hex').slice(0, 24);
        const key = today + '_' + hashedId + (task.reminderVersion ? '_' + task.reminderVersion : '') + '_' + event.type;
        const lease = Date.now();
        const claimed = await claimReminder(doc.ref, today, key, lease);
        if (!claimed) continue;

        const title = String(task.title || (ar ? 'مهمة' : 'Task')).slice(0, 180);
        const header = event.type === 'rem'
          ? (ar ? '🔔 تذكير قبل الموعد' : '🔔 Upcoming task')
          : (ar ? '⏰ حان وقت المهمة' : '⏰ Task time');
        const body = [
          header,
          title,
          (ar ? 'الوقت: ' : 'Time: ') + String(task.time).slice(0, 30),
          '',
          APP_URL
        ].join('\n');

        try {
          await transport.sendMail({
            from: { name: 'Natija Reminders', address: sender },
            to: account.email,
            subject: header + ' — ' + title,
            text: body
          });
          await finishReminder(doc.ref, key, lease, true);
          sent++;
        } catch (error) {
          errors++;
          console.warn('Email reminder failed:', error.code || 'delivery');
          try { await finishReminder(doc.ref, key, lease, false); }
          catch (_) { console.warn('Email reminder receipt cleanup failed'); }
        }
      }
    }
  }
  transport.close();
  console.log('Email reminders sent:', sent, '| delivery errors:', errors, '| unverified accounts:', skippedUnverified);
  if (errors) process.exitCode = 1;
}

main().catch((error) => { console.error('Email reminder worker failed:', error.message); process.exitCode = 1; });
