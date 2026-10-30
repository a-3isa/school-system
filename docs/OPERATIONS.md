# Running it for real

What has to be set, and done by hand, before the platform serves a school. Nothing here is needed to develop or test it on your own computer; `docs/TESTING.md` covers that.

## Before the first school: the server's settings

Set these in the server's environment (or `apps/api/.env`). Names are the same as in `apps/api/.env.example`.

| Setting | What to put | If it is missing |
|---|---|---|
| `NODE_ENV` | `production`. The checks below that refuse to start, and the broker's secret, only apply when this is set. | The API runs in development mode: it starts without them, and answers the broker's checks without a secret. |
| `JWT_SECRET` | A random value of at least 32 characters. Keep it secret and never change it casually: changing it signs everyone out. | The API refuses to start. In production it also refuses one shorter than 32 characters. |
| `CORS_ORIGINS` | The web addresses of the dashboard and the parent web app, comma-separated, for example `https://school.example.com,https://parents.example.com`. | The API refuses to start in production. |
| `DATABASE_URL` | The production Postgres. | Nothing works. |
| `MQTT_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD` | The broker the readers publish to, and the API's own account on it. Set both the name and the password, or neither. | Readers can only use the HTTP route. |
| `MQTT_HOOK_SECRET` | A random value. Put the same value in the broker's HTTP authentication and authorisation sources as the header `x-hook-secret` (see `firmware/gateway/README.md`). | In production the API refuses the broker's checks, so no reader can connect. |
| `CHAT_ADAPTER` | `postgres` as soon as more than one API server runs, so a chat message reaches a phone connected to any of them. | Live chat only reaches phones connected to the same server. |
| `FIREBASE_SERVICE_ACCOUNT` | The path to the service account key file, or the JSON itself. See `docs/PUSH.md`. | No push notifications; the app's list still works. |
| `SMTP_URL`, `EMAIL_FROM` | An email account to send from. | Sign-up and password codes are only written in the server log. |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_OTP_TEMPLATE` | A WhatsApp Business account with an approved code template. | Mobile codes are only written in the server log. |

Run the API behind HTTPS only. More than one API server is fine: wrong passwords are counted in the database, and `CHAT_ADAPTER=postgres` shares live chat.

## Restrict the Firebase keys (your task in the Google Cloud console)

The keys in `apps/parent/lib/firebase_options.dart` and `apps/parent/android/app/google-services.json` are public identifiers: they ship inside every copy of the app, so they are committed. That also means anyone can copy them and call Google's services as if they were the app, which can cost money or use up the quota. Restricting each key to the one app it belongs to, and to the few Google services the app uses, stops that.

Do this once, in the Google Cloud console for the project `school-platform-eg`: **APIs & Services › Credentials**. There is one key for each app (Android, iOS, web). For each:

1. Open the key and choose **Application restrictions**.
   - **Android key:** *Android apps*, then add the package name `school.platform.parent_app` with the SHA-1 fingerprint of the key that signs the app. Add the debug key's fingerprint as well while testing (`cd apps/parent/android && ./gradlew signingReport`), and the Play Store signing key's fingerprint once the app is published (Play Console › App integrity).
   - **iOS key:** *iOS apps*, then add the bundle ID `school.platform.parentApp`.
   - **Web key:** *Websites*, then add the parent web app's address (the same one you put in `CORS_ORIGINS`) and, while testing, `http://localhost:*`.
2. Under **API restrictions**, choose *Restrict key* and tick only what that app needs: **Firebase Installations API**, **Firebase Cloud Messaging API** (and **FCM Registration API**). Leave everything else unticked.
3. Save. Keys take a few minutes to change. Then install the app on a phone and sign in; if registering for push now fails with "API key not valid", a restriction is too tight: the console's *Credentials* page and the app's log say which service was refused.

Do not restrict the **service account** key the same way: it belongs to the server, it is a secret, and it is kept out of the repository (`docs/PUSH.md`).

## Things that are not done yet

- A production server, domain, HTTPS and MQTT broker (see `docs/SYSTEM.md`).
- The Apple push key and the iPhone capability (`docs/PUSH.md`).
- A full Content-Security-Policy for the dashboard. It needs a nonce for each page in Next.js; the other protective headers are already sent.
