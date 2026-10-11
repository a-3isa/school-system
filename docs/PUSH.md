# Push notifications (Firebase)

Parents' phones are rung through Firebase Cloud Messaging. This is how it is set up and how to run it.

## How it works

1. The parent app asks the parent's permission, gets this phone's address from Firebase, and tells the server (`POST /api/notifications/devices`) with the app's language. It does this again at every start, when Firebase changes the address, and when the parent switches language. Signing out forgets the phone.
2. Every notification the system writes is saved first. Once a minute the server (`NotificationsService.flush`) sends the unsent ones to each parent's phones, worded in the language that phone's app is in, and agreeing with the child's gender in Arabic. The wording is in `apps/api/src/notifications/push-text.ts` and says the same as the app's own list (`S.notification` in `apps/parent/lib/strings.dart`): change both together.
3. A phone that no longer has the app is forgotten. A notification that fails because Firebase can't be reached is tried again, and let go after a day. Staff get no push (they have no app).

Nothing is sent without credentials: the notifications are still saved and show in the app.

## The Firebase project

| | |
|---|---|
| Project | `school-platform-eg` ("School Platform"), Spark (free) plan |
| Android app | `school.platform.parent_app` |
| iOS app | `school.platform.parentApp` |
| Console | https://console.firebase.google.com/project/school-platform-eg |

The app's own settings are in `apps/parent/lib/firebase_options.dart` and `apps/parent/android/app/google-services.json`. They are public identifiers (they ship inside every copy of the app), so they are committed. Run `flutterfire configure --project=school-platform-eg --platforms=android,ios` again if an app is added or renamed.

## The server's key

The server sends with a **service account** that can only send messages (`school-platform-push@school-platform-eg.iam.gserviceaccount.com`, role *Firebase Cloud Messaging Admin*). Its key is a secret: **never commit it**.

- Set `FIREBASE_SERVICE_ACCOUNT` in `apps/api/.env` to the path of the key's JSON file (or to the JSON itself on a host that only has environment variables). On a Windows development machine keep it outside the repository, for example `%USERPROFILE%\.school-platform\firebase-service-account.json`.
- To rotate the key: create a new one (`gcloud iam service-accounts keys create <file> --iam-account school-platform-push@school-platform-eg.iam.gserviceaccount.com --project school-platform-eg`), switch the server to it, then delete the old one (`gcloud iam service-accounts keys delete <key-id> --iam-account …`).
- To check the key without a phone, send a dry run to a made-up token; Firebase should answer that the token is invalid (not "permission denied").

## Still to do by hand

- **iPhone push needs Apple.** In the Firebase console (Project settings › Cloud Messaging) upload an **APNs authentication key** from your Apple developer account. On a Mac, open `apps/parent/ios/Runner.xcworkspace` in Xcode and add the **Push Notifications** capability to the Runner target. Without these, iPhones get no push (Android works without them).
- **Android needs a real phone or emulator to try.** Install the app, sign in, and press a notification trigger (for example mark a child absent). The Android toolchain on this machine still needs `flutter doctor --android-licenses`.
- **Production.** Put `FIREBASE_SERVICE_ACCOUNT` on the production server when it exists.

## Not done

- Tapping a push opens the app but doesn't jump to the right screen yet.
- The web build of the parent app doesn't get push (it has no Firebase configuration).
