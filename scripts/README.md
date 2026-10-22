# تنبيهات المهام عبر GitHub Actions (بديل مجاني لـ Blaze)

يشغّل GitHub Actions المجدول السكربت `send-reminders.js` كل ~5 دقائق، فيقرأ المهام
المستحقة من Firestore ويُرسل إشعار FCM لأجهزتك — فتصل الإشعارات **حتى والمتصفح مغلق**،
بدون الحاجة لخطة Blaze.

> ⚠️ **ملاحظة عن الدقة:** جدولة GitHub Actions غير دقيقة وقد تتأخر 5–15 دقيقة وقت
> الزحمة، وأقل تكرار متاح 5 دقائق. لو تحتاج دقة بالدقيقة استخدم بدلها Cloud Function
> (مجلد `functions/` + خطة Blaze). **لا تشغّل الطريقتين معًا** حتى لا يتكرر الإشعار.

## خطوة وحيدة مطلوبة منك: إضافة مفتاح الخدمة كـ Secret

### 1) نزّل مفتاح الخدمة (Service Account)
- Firebase Console ← **⚙️ Project settings** ← تبويب **Service accounts**.
- اضغط **Generate new private key** ← **Generate key** → سيُنزَّل ملف JSON.

> 🔒 هذا الملف **سري** (يحتوي مفتاحًا خاصًا). لا تضعه في الكود ولا ترفعه على GitHub أبدًا.
> مكانه الوحيد هو GitHub Secrets (مُشفَّر وآمن حتى في المستودعات العامة).

### 2) أضِفه كـ GitHub Secret
- افتح المستودع على GitHub ← **Settings** ← **Secrets and variables** ← **Actions**.
- اضغط **New repository secret**.
- **Name:** `FIREBASE_SERVICE_ACCOUNT`
- **Secret:** الصق **محتوى ملف JSON كاملًا** الذي نزّلته.
- **Add secret**.

### 3) جاهز ✅
- الجدول يعمل تلقائيًا كل 5 دقائق.
- **للاختبار فورًا:** المستودع ← تبويب **Actions** ← **Task Reminders** ← **Run workflow**.
  أضِف مهمة اليوم بوقت قريب، شغّل الـ workflow يدويًا، وتابع وصول الإشعار.

## كيف يعمل؟
- يقرأ كل مستند مستخدم في مجموعة `users`، ويحسب الوقت حسب منطقتك الزمنية (`tz`)
  التي يحفظها التطبيق تلقائيًا.
- يُرسل تذكير قبل الموعد (حسب `reminderMinutes`) وإشعارًا عند حلول الموعد.
- يمنع تكرار نفس الإشعار (حقل `pushed`)، ويزيل التوكنات غير الصالحة تلقائيًا.
- نافذة التقاط 30 دقيقة تعوّض تأخّر الجدولة فلا تُفوَّت مهمة.

## Telegram reminders (NatijaReminderBot)

Telegram integration runs alongside FCM in the existing Task Reminders GitHub Action every ~5 minutes, subject to GitHub schedule delays. The code does not require a Telegram paid subscription.

1. Create the Telegram bot `@NatijaReminderBot` in @BotFather and obtain its API token.
2. Go to the repository's **Settings > Secrets and variables > Actions > New repository secret**.
3. Add the secret **`TELEGRAM_BOT_TOKEN`**. Paste the **token value**, not the username, in the secret value field. Never put the token in public source code or in chat.
4. Keep `FIREBASE_SERVICE_ACCOUNT` configured. The existing `Task Reminders` GitHub Action uses both secrets.
5. Open Natija, sign in, choose **ربط Telegram / Connect Telegram** from the main menu, and tap **Start** in Telegram. Linking is processed by the next workflow run; allow scheduling delays.
6. Create a timed task with a reminder. Check the Telegram chat after the scheduled workflow runs.
7. To disconnect, choose **إلغاء ربط Telegram / Disconnect Telegram**; backend deletion takes effect during the next workflow run. Alternatively send `/stop` to the bot.

### Security and limitations
- Only the backend worker reads the Telegram Bot Token. Do not put it in `firebase-config.js` or `cloud.js`.
- Linking uses a 192-bit random one-time deep-link value valid for 30 minutes. Start links are account-specific; do not share them.
- `telegramLinks/{uid}` and `integrationState/telegram` are server-only Firestore collections under the default-deny rules; **publish the repository's Firestore rules**.
- Telegram chat IDs and delivery receipts stay in the private backend collection, not publicly editable user documents.
- The worker currently uses Telegram `getUpdates` polling; disable any Telegram webhook for this bot before using the polling flow.
- Delivery timing is best-effort and the GitHub schedule may be delayed. A process crash after sending but before storing the receipt could cause a duplicate alert.
- Existing FCM notifications remain enabled. Telegram notification delivery works only after the bot secret and Firebase service account are correctly configured.
- Bot uses the public `https://api.telegram.org` endpoints, so outbound access is necessary.

## Render Web Service + cron-job.org (recommended when GitHub scheduled workflows are unreliable)

A free Render **Web Service** is not a free always-on Background Worker. The service can sleep after inactivity, so an external scheduler requests it periodically. Execution is best effort; cold starts or provider delays may cause late notifications.

### Render setup
1. Create a Render **Web Service** linked to this repository. Do **not** choose Background Worker.
2. Runtime: **Node**. Set **Root Directory** to `scripts`.
3. Build command: `npm install --no-audit --no-fund`.
4. Start command: `npm start` (runs `scripts/http-runner.js`).
5. Set these **Environment** values in Render's dashboard (never commit them):
   - `FIREBASE_SERVICE_ACCOUNT`: full JSON service account data from Firebase.
   - `TELEGRAM_BOT_TOKEN`: the BotFather HTTP API token.
   - `CRON_SECRET`: a unique random string at least 32 characters long; generate with a password manager.
6. Deploy. Visit `https://YOUR-SERVICE.onrender.com/health` and expect `{"status":"ok","service":"natija-reminders"}`. This public health endpoint does **not** execute reminders.

### External scheduler setup
1. At https://cron-job.org create a recurring request to `https://YOUR-SERVICE.onrender.com/run`.
2. HTTP method: **POST**. Interval: every **2 minutes**.
3. Add HTTP request header `Authorization: Bearer YOUR_CRON_SECRET` with the **same** secret as Render. Never add the secret as a URL query parameter.
4. A `200` JSON response with `status: ok` means both workers completed. `401` means wrong secret; `409` means a previous run is active; `500` means at least one worker failed.
5. Create a task in Natija, verify bot linking, then check cron-job.org execution history and Render Logs.

### Migration checklist
- **Only after Render + cron-job.org are confirmed working**, disable the GitHub Actions scheduled event in `.github/workflows/reminders.yml` to avoid duplicate sends and competing Telegram `getUpdates` calls. The manual `workflow_dispatch` can remain for emergency diagnosis.
- Cloud Functions on a one-minute schedule is an alternative when predictable timing matters more than remaining on a free hosting tier.
- A failed request can have already sent a message before the receipt was saved; retries may duplicate the message. Existing scripts track sent reminders in Firestore.
- Telegram's chat ID, Firebase service account, and bot token must stay server side.

## Railway Cron Jobs (alternative to GitHub Actions)

Railway supports scheduled services that run briefly and exit. This is a better fit for timed reminders than keeping an HTTP server running continuously. **A Railway Cron Job can run no more frequently than every 5 minutes, and exact-minute timing is not guaranteed.**

1. Connect the repository `ahmedzx-coder/task-calendar-` to Railway as a **new service**.
2. Open service **Settings** and set **Root Directory** to `/scripts`. Railway can build the existing Dockerfile in that folder.
3. In **Variables**, provide these values privately:
   - `FIREBASE_SERVICE_ACCOUNT`: full Firebase Admin JSON service account credentials.
   - `TELEGRAM_BOT_TOKEN`: private BotFather API token. **Do not put it in public source code.**
4. Under **Settings → Deploy**, set **Custom Start Command** to `node run-once.js`.
5. Under **Settings → Cron Schedule**, set `*/5 * * * *` (UTC). **Do not generate a public domain** for the cron service.
6. Deploy, review the service's **Cron Runs** and logs, and create a timed Natija task for a real Telegram delivery test.
7. After Railway has delivered a reminder **automatically**, remove the `schedule` trigger from GitHub's `.github/workflows/reminders.yml` to prevent double notifications and competing bot polling. Keep `workflow_dispatch` if you need an emergency manual test.

The Dockerfile still defaults to the HTTP runner (for the existing Fly/Render approach), so Railway requires the `node run-once.js` **Custom Start Command** override. Scheduled Railway jobs start, execute Firebase push and Telegram reminders, and exit with success or failure; they never need to listen on a port.

**Cost:** Railway's Free plan includes only $1 of monthly usage credit after a time-limited trial; this is not an unlimited free server. The final cost depends on usage and Railway's account rules. See https://docs.railway.com/pricing/plans and https://docs.railway.com/cron-jobs.
