/**
 * Prepares a static, offline-packaged copy of the Natija frontend.
 * Reads originals from the repository; NEVER edits the live web version.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(appDir, '..');
const www = path.join(appDir, 'www');
fs.rmSync(www, { force: true, recursive: true });
fs.mkdirSync(www, { recursive: true });

const files = [
  'index.html', 'cloud.js', 'firebase-config.js',
  'manifest.json', 'onboarding.js', 'onboarding.css',
  'sw.js', 'firebase-messaging-sw.js'
];
for (const file of files) {
  fs.copyFileSync(path.join(repoRoot, file), path.join(www, file));
}
fs.cpSync(path.join(repoRoot, 'icons'), path.join(www, 'icons'), { recursive: true });

// Firebase's Web push messaging/service workers aren't supported by an
// Android WebView. Do not request incompatible browser push permissions.
const cloudFile = path.join(www, 'cloud.js');
let cloud = fs.readFileSync(cloudFile, 'utf8');
const supportCheck = "function notifySupported() { return ('Notification' in window) && ('serviceWorker' in navigator); }";
if (!cloud.includes(supportCheck)) {
  throw new Error('Cloud notification support signature changed; review native adapter before packaging');
}
cloud = cloud.replace(
  supportCheck,
  "function notifySupported() { return !(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) && ('Notification' in window) && ('serviceWorker' in navigator); }"
);

// Firebase Web SDK OAuth popups are unsupported inside the embedded WebView.
// Native Google Sign-in will require an Android Firebase app registration,
// google-services.json and a native authentication bridge.
// For now email/password Firebase sign-in remains functional. The only
// changed script is the local Android asset copy.
const popup = "auth.signInWithPopup(provider).catch(function (e) { setMsg(mapErr(e), 'err'); });";
if (!cloud.includes(popup)) {
  throw new Error('Google login handler changed; review native authentication before packaging');
}
cloud = cloud.replace(popup,
  "setMsg(T('تسجيل الدخول باستخدام Google يحتاج إعداد Android Native إضافي. استخدم الإيميل وكلمة المرور في نسخة التجربة.', 'Google sign-in needs native Android setup. For this beta, sign in with email and password.'), 'err');");
fs.writeFileSync(cloudFile, cloud);

const htmlFile = path.join(www, 'index.html');
let html = fs.readFileSync(htmlFile, 'utf8');
// Ensure backend push-setup isn't presented as working for Android WebView.
// Telegram/email reminders continue through the existing Firebase account.
html = html.replace(
  '<button id="notifyEnableBtn" class="menu-item">',
  '<button id="notifyEnableBtn" class="menu-item hidden" aria-hidden="true" disabled>'
);
fs.writeFileSync(htmlFile, html);

const required = ['index.html', 'cloud.js', 'firebase-config.js', 'onboarding.js', 'icons/icon-192.png'];
for (const file of required) {
  if (!fs.existsSync(path.join(www, file))) throw new Error('Missing packaged asset: ' + file);
}
console.log('Prepared offline Android assets in ' + www);
console.log('The original GitHub Pages files remain untouched.');
