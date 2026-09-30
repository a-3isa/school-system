# Parent app (Flutter)

What a parent sees: their child's day (arrival through the gate, then each lesson's
attendance) and notifications. One shared app for every school.

```bash
cd apps/parent
flutter pub get
flutter run --dart-define=API_URL=http://<your-computer-ip>:3000/api     # phone or emulator
flutter build web --no-web-resources-cdn --dart-define=API_URL=...       # web build
flutter test
```

First sign-in asks the parent to agree to tracking (decision H39); nothing else is shown
until they do.

Not done yet: sign-in codes by WhatsApp (parents use a password the school sets for
now), real push notifications through Firebase (the Notifications tab lists them), and
Arabic.
