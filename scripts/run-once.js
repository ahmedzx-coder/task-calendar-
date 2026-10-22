/* Railway cron entrypoint for Natija reminders.
 * Runs both existing workers once, then terminates so Railway can schedule
 * the next run. Requires FIREBASE_SERVICE_ACCOUNT and TELEGRAM_BOT_TOKEN.
 */
'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const TIMEOUT_MS = 90_000;

function run(script) {
  return new Promise((resolve, reject) => {
    const worker = spawn(process.execPath, [path.join(__dirname, script)], {
      cwd: __dirname,
      env: process.env,
      stdio: ['ignore', 'inherit', 'inherit']
    });
    let finished = false;
    const timer = setTimeout(() => {
      if (!finished) worker.kill('SIGKILL');
    }, TIMEOUT_MS);

    worker.on('error', (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(error);
    });
    worker.on('close', (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (code === 0) resolve(script);
      else reject(new Error(script + ' exited with ' + (signal || code)));
    });
  });
}

(async () => {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT || !process.env.TELEGRAM_BOT_TOKEN) {
    console.error('Missing Railway variables FIREBASE_SERVICE_ACCOUNT or TELEGRAM_BOT_TOKEN.');
    process.exit(1);
  }
  const outcomes = await Promise.allSettled([
    run('send-reminders.js'),
    run('telegram-reminders.js'),
    run('send-email-reminders.js')
  ]);
  const failures = outcomes.filter(result => result.status === 'rejected');
  if (failures.length) {
    failures.forEach(result => console.error('Natija reminder worker failed:', result.reason.message));
    process.exit(1);
  }
  console.log('Natija scheduled reminder run completed successfully.');
  process.exit(0);
})().catch(error => {
  console.error('Natija scheduled run failed:', error.message);
  process.exit(1);
});
