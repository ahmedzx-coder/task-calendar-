# Natija Android — isolated test APK

This experimental Android build lives only on branch \`android-apk-test\`. **It does not modify or deploy the main GitHub Pages website.** It packages a local copy of Natija's web assets using Capacitor 8.

## Download an APK without paying Google Play

1. Visit the GitHub repository → **Actions** → **Natija Android APK (test)**.
2. Open the latest **successful** run on branch \`android-apk-test\`.
3. Under **Artifacts**, download \`Natija-Android-debug-APK\`.
4. Unzip it, transfer \`Natija-debug.apk\` to the Android phone, and install it. Android may ask to temporarily allow installation from your browser or Files app.
5. Keep Android's **Play Protect** enabled and install only the APK downloaded from your own GitHub Actions run.

This debug APK is for personal testing; it is not a Play Store release, and debug signing may change between builds (in which case uninstalling an older build might be required before installing a newer one).

## Current test scope

- **Built into APK (not loaded from GitHub Pages):** UI, Arabic/English, calendar, task add/edit, onboarding, statistics and offline task data.
- **Firebase Email/Password:** Uses the existing Natija Firebase account/project and online Firestore sync; sign in with an email/password account or create one.
- **Telegram/Gmail:** Existing cloud-side reminders keep working for the same Firebase user when linked/opted in. Delays depend on the current cron-job.org / GitHub Actions reminder service.
- **Not yet supported in this first debug build:** native Android Google account OAuth (web popups are incompatible with embedded WebViews), native background push notification registration, and Play Store distribution. The web app remains unchanged; these require separate Android integrations and Firebase configuration.
- **No account secret is embedded:** the existing \`firebase-config.js\` includes Firebase's public web configuration. GitHub Secrets for Gmail and Telegram never enter the APK.
- **Internet:** Google fonts and Firebase require internet initially; after task data sync, UI and locally cached tasks remain available without a connection (cloud changes then sync when online).

## Development on Windows

Requires Node 22+, Java 21, Android Studio / Android SDK, according to Capacitor 8 requirements.

\`\`\`powershell
git checkout android-apk-test
cd android-app
npm install
npm run android:init
npx cap open android
\`\`\`

Build a debug APK from Android Studio or:

\`\`\`powershell
npm run android:build
\`\`\`

Do not merge \`android-apk-test\` into \`main\` until the Android release is ready and tested. To update bundled web assets from the branch, run \`npm run android:sync\`; the command only rebuilds \`android-app/www\` and the Android project.

## Follow-on tasks before publishing

- Register a new **Android app** in Firebase Console with package ID \`com.natija.tasks\`.
- Add the Android OAuth SHA fingerprints and \`google-services.json\` and integrate a maintained native Google login provider.
- Implement native notifications with Android 13+ permission handling, and test scheduled/FCM alerts while backgrounded and after a reboot.
- Add account deletion, privacy policy and Play Data Safety disclosures; prepare signed release AAB and stable keystore.
- Test on physical Android phones in Arabic and English, light and dark themes.
