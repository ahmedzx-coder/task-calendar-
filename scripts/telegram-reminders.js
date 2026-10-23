/* Telegram reminders for Natija. Runs from the existing scheduled GitHub Action.
   BOT TOKEN and Firebase service account are supplied only via GitHub Actions Secrets.
   The private telegramLinks collection is NOT exposed by firestore.rules. */
'use strict';

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { DateTime } = require('luxon');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
const CATCHUP_MIN = 30;
const APP_URL = 'https://ahmedzx-coder.github.io/task-calendar-/';

if (!BOT_TOKEN) {
  console.log('Telegram reminders not configured: add TELEGRAM_BOT_TOKEN in GitHub Actions Secrets.');
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
const users = db.collection('users');
const links = db.collection('telegramLinks'); // backend-only; never trust a client-supplied chat ID
const state = db.collection('integrationState').doc('telegram');

async function api(method, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/' + method, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      const error = new Error('Telegram ' + method + ': HTTP ' + response.status);
      error.status = result.error_code || response.status;
      throw error;
    }
    return result.result;
  } finally { clearTimeout(timeout); }
}

async function reply(chatId, text) {
  return api('sendMessage', { chat_id: chatId, text, disable_web_page_preview: true });
}

async function unlinkUser(uid) {
  await links.doc(uid).delete();
  await users.doc(uid).set({
    telegramConnected: false,
    telegramDisconnectRequested: false,
    telegramLink: FieldValue.delete()
  }, { merge: true });
}

async function applyDisconnectRequests() {
  const pending = await users.where('telegramDisconnectRequested', '==', true).get();
  for (const doc of pending.docs) await unlinkUser(doc.id);
}

async function processCommand(message) {
  if (!message || !message.chat || message.chat.type !== 'private') return;
  const chatId = String(message.chat.id);
  const input = String(message.text || '').trim();

  if (/^\/stop(?:@NatijaReminderBot)?$/i.test(input)) {
    const linked = await links.where('chatId', '==', chatId).get();
    for (const doc of linked.docs) await unlinkUser(doc.id);
    await reply(chatId, '✅ تم إيقاف تنبيهات نتيجة على هذا الحساب. يمكنك الربط مجددًا من موقع نتيجة.');
    return;
  }

  const match = input.match(/^\/start(?:@NatijaReminderBot)?\s+([A-Za-z0-9_-]{1,64})$/i);
  if (!match) {
    if (/^\/start(?:@NatijaReminderBot)?$/i.test(input)) {
      await reply(chatId, 'أهلاً بك في نتيجة! افتح الموقع وسجّل دخولك، ثم اختر «ربط Telegram» من القائمة.\n' + APP_URL);
    }
    return;
  }

  // The link code is generated with crypto.getRandomValues in the authenticated web client,
  // and is valid for 30 minutes. The bot never accepts an arbitrary user ID.
  const matched = await users.where('telegramLink.code', '==', match[1]).limit(2).get();
  const valid = matched.docs.filter(doc => {
    const link = (doc.data() || {}).telegramLink || {};
    return Number(link.expiresAt) > Date.now() &&
      !(doc.data() || {}).telegramDisconnectRequested;
  });
  if (valid.length !== 1) {
    await reply(chatId, 'رابط الربط غير صالح أو انتهت مدته. أنشئ رابطًا جديدًا من موقع نتيجة.');
    return;
  }

  const target = valid[0];
  // A private Telegram conversation should belong to only one Natija account.
  const existing = await links.where('chatId', '==', chatId).get();
  for (const doc of existing.docs) {
    if (doc.id !== target.id) await unlinkUser(doc.id);
  }
  await links.doc(target.id).set({
    chatId,
    linkedAt: FieldValue.serverTimestamp(),
    pushed: {}
  }, { merge: true });
  await target.ref.set({
    telegramConnected: true,
    telegramDisconnectRequested: false,
    telegramLink: FieldValue.delete()
  }, { merge: true });
  await reply(chatId, '✅ تم ربط Telegram بنتيجة بنجاح! هتوصلك تذكيرات المهام هنا.\nلإلغاء الربط اكتب /stop');
}

async function pollCommands() {
  const snap = await state.get();
  let offset = (snap.exists && Number(snap.data().offset)) || 0;
  const updates = await api('getUpdates', {
    offset, limit: 100, timeout: 0, allowed_updates: ['message']
  });
  for (const update of updates) {
    if (!Number.isInteger(update.update_id) || update.update_id < offset) continue;
    await processCommand(update.message);
    offset = update.update_id + 1;
    // Save after each processed update so a later failure doesn't lose linking requests.
    await state.set({ offset }, { merge: true });
  }
}

function timeToMinutes(value) {
  const m = String(value || '').trim().toLowerCase().match(/^(\d{1,2}):(\d{2})\s*(am|pm|ص|م)?/);
  if (!m) return null;
  let hour = Number(m[1]);
  const min = Number(m[2]);
  if (hour > 23 || min > 59) return null;
  if (m[3] === 'pm' || m[3] === 'م') { if (hour < 12) hour += 12; }
  if (m[3] === 'am' || m[3] === 'ص') { if (hour === 12) hour = 0; }
  return hour * 60 + min;
}

async function deliverReminders() {
  const linkDocs = await links.get();
  let sent = 0;
  for (const linkDoc of linkDocs.docs) {
    const chatId = (linkDoc.data() || {}).chatId;
    if (!chatId) continue;
    const userSnap = await users.doc(linkDoc.id).get();
    if (!userSnap.exists) { await linkDoc.ref.delete(); continue; }
    const data = userSnap.data() || {};
    if (data.telegramDisconnectRequested) { await unlinkUser(linkDoc.id); continue; }
    const tasks = Array.isArray(data.tasks) ? data.tasks : [];
    if (!tasks.length) continue;
    const time = DateTime.now().setZone(data.tz || 'UTC');
    if (!time.isValid) continue;
    const today = time.toFormat('yyyy-LL-dd');
    const minutes = time.hour * 60 + time.minute;
    const ar = (data.lang || 'ar') === 'ar';
    const pushed = Object.assign({}, linkDoc.data().pushed || {});
    // Trim older keys, while retaining today's delivery receipts.
    const todayPrefix = today + '_';
    for (const key of Object.keys(pushed)) {
      if (!key.startsWith(todayPrefix)) delete pushed[key];
    }

    for (const task of tasks) {
      if (!task || task.completed || task.date !== today || !task.time || task.id == null) continue;
      const taskMinute = timeToMinutes(task.time);
      if (taskMinute === null) continue;
      const reminder = Math.max(0, Number.parseInt(task.reminderMinutes, 10) || 0);
      const due = [
        { kind: 'rem', active: reminder > 0 && minutes >= taskMinute - reminder && minutes < taskMinute },
        { kind: 'alarm', active: alarmWasScheduledAhead(task, time, taskMinute) && minutes >= taskMinute && minutes - taskMinute <= CATCHUP_MIN }
      ];
      for (const item of due) {
        if (!item.active) continue;
        const key = today + '_' + task.id + (task.reminderVersion ? '_' + task.reminderVersion : '') + '_' + item.kind;
        if (pushed[key]) continue;
        const title = String(task.title || (ar ? 'مهمة' : 'Task')).slice(0, 180);
        const prefix = item.kind === 'rem'
          ? (ar ? '🔔 تذكير قبل الموعد' : '🔔 Upcoming task')
          : (ar ? '⏰ حان وقت المهمة' : '⏰ Task time');
        const message = prefix + '\n' + title + '\n' +
          (ar ? 'الوقت: ' : 'Time: ') + String(task.time) + '\n' + APP_URL;
        try {
          await reply(chatId, message);
          pushed[key] = true;
          // Persist every successful delivery to avoid duplicates after a later failure.
          await linkDoc.ref.set({ pushed }, { merge: true });
          sent++;
        } catch (error) {
          if (error.status === 403 || error.status === 400) {
            await unlinkUser(linkDoc.id); // bot blocked / chat invalid
          } else {
            console.warn('Telegram delivery failed (status):', error.status || 'network');
          }
          break;
        }
      }
    }
  }
  console.log('Telegram reminder messages sent:', sent);
}

async function main() {
  await applyDisconnectRequests();
  try { await pollCommands(); }
  catch (error) { console.warn('Telegram polling failed:', error.status || error.message); }
  await applyDisconnectRequests();
  await deliverReminders();
}
main().catch(error => { console.error('Telegram job failed:', error.message); process.exitCode = 1; });

// Do not send a due-time alarm for a start that predates creation/rescheduling.
function alarmWasScheduledAhead(task, clock, minute) {
  const scheduledAt = clock.set({ hour: Math.floor(minute / 60), minute: minute % 60, second: 0, millisecond: 0 }).toMillis();
  const scheduledSince = Math.max(Date.parse(task.createdAt) || 0, Number(task.reminderVersion) || 0);
  return scheduledAt > scheduledSince;
}
