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
