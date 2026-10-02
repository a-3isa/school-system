# Parent app (Flutter)

What a parent sees: their child's day (arrival through the gate, where the strap was
last heard, then every lesson with its attendance), notifications, and their account.
One shared app for every school, in English and Arabic (right to left), light and dark
as the phone is set.

```bash
cd apps/parent
flutter pub get
flutter run --dart-define=API_URL=http://<your-computer-ip>:3000/api     # phone or emulator
flutter build web --no-web-resources-cdn --dart-define=API_URL=...       # web build
flutter test
```

- **Sign in** with the email the school registered and a password. **Create your
  account** in three steps: a code to that email, then the mobile with a WhatsApp code,
  then a password. **Forgot password**: a code by email, then a new password.
- **First sign-in** asks the parent to agree to tracking (decision H39); nothing else is
  shown until they do.
- **Language**: follows the phone the first time; change it on the sign-in screen or under
  Account. It's remembered.
- **Fonts**: IBM Plex Sans and IBM Plex Sans Arabic are bundled in `assets/fonts`
  (SIL Open Font License, see `assets/fonts/OFL.txt`), so cheap phones don't download them.

Not done yet: real push notifications through Firebase (the Notifications tab lists them).
Names, subjects and rooms are shown as the school typed them.
