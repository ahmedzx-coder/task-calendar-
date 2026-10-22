/*
 * Natija reminders HTTP runner for Render Free Web Service.
 * Use an external scheduler such as cron-job.org to POST /run.
 * Never expose Firebase / Telegram credentials or CRON_SECRET in client code.
 */
'use strict';

const http = require('node:http');
const { timingSafeEqual } = require('node:crypto');
const { spawn } = require('node:child_process');
const path = require('node:path');

const port = Number(process.env.PORT || 10000);
const authSecret = process.env.CRON_SECRET || '';
const firebaseAccount = process.env.FIREBASE_SERVICE_ACCOUNT || '';
const telegramToken = process.env.TELEGRAM_BOT_TOKEN || '';

if (authSecret.length < 32 || !firebaseAccount || !telegramToken) {
  console.error('Missing configuration: CRON_SECRET (32+ chars), FIREBASE_SERVICE_ACCOUNT, or TELEGRAM_BOT_TOKEN.');
  process.exit(1);
}

let running = false;

function authorized(header) {
  if (typeof header !== 'string') return false;
  const expected = Buffer.from('Bearer ' + authSecret);
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function respond(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function runExistingWorker(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, script)], {
      cwd: __dirname,
      env: process.env,
      stdio: ['ignore', 'inherit', 'inherit']
    });
    const maxDuration = setTimeout(() => child.kill('SIGTERM'), 90000);
    child.once('error', error => {
      clearTimeout(maxDuration);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(maxDuration);
      if (code === 0) resolve();
      else reject(new Error(script + ' failed (code=' + code + ', signal=' + signal + ')'));
    });
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return respond(res, 200, { status: 'ok', service: 'natija-reminders' });
  }
  if (req.url !== '/run') return respond(res, 404, { error: 'not_found' });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return respond(res, 405, { error: 'method_not_allowed' });
  }
  if (!authorized(req.headers.authorization)) {
    return respond(res, 401, { error: 'unauthorized' });
  }
  if (running) return respond(res, 409, { error: 'previous_run_still_active' });

  running = true;
  try {
    const started = Date.now();
    console.log('Starting scheduled Natija reminders.');
    const results = await Promise.allSettled([
      runExistingWorker('send-reminders.js'),
      runExistingWorker('telegram-reminders.js')
    ]);
    const failed = results.map((result, index) => result.status === 'rejected'
      ? (index === 0 ? 'push' : 'telegram')
      : null).filter(Boolean);
    console.log('Scheduled reminders finished; failed workers:', failed.join(', ') || 'none');
    return respond(res, failed.length ? 500 : 200, {
      status: failed.length ? 'failed' : 'ok',
      elapsedSeconds: Math.round((Date.now() - started) / 1000),
      failed
    });
  } catch (error) {
    console.error('Unexpected reminder runner error:', error.message);
    return respond(res, 500, { status: 'failed' });
  } finally {
    running = false;
  }
});
server.requestTimeout = 120000;
server.listen(port, '0.0.0.0', () => {
  console.log('Natija reminder runner listening on port', port);
});
