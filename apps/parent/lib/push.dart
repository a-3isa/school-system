import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import 'api.dart';
import 'firebase_options.dart';

/// Push notifications: the phone's address for the school's server to ring.
abstract class Push {
  /// Asks permission, registers this phone with the server, and keeps it registered.
  Future<void> start(Api api, String lang);

  /// The app's language changed, so pushes should be worded in it.
  Future<void> setLang(Api api, String lang);

  /// Forgets this phone on the server. Called before signing out, while the login still works.
  Future<void> stop(Api api);

  /// A push arrived while the app was open: refresh what it shows.
  Stream<void> get arrived;

  void dispose();
}

/// What the app uses where Firebase isn't available (the web build, tests): nothing happens.
class NoPush implements Push {
  @override
  Future<void> start(Api api, String lang) async {}
  @override
  Future<void> setLang(Api api, String lang) async {}
  @override
  Future<void> stop(Api api) async {}
  @override
  Stream<void> get arrived => const Stream.empty();
  @override
  void dispose() {}
}

/// Firebase Cloud Messaging. Anything that goes wrong here is swallowed: the
/// app works without push, and the notifications are still in its list.
class FirebasePush implements Push {
  final _arrived = StreamController<void>.broadcast();
  StreamSubscription<String>? _refresh;
  StreamSubscription<RemoteMessage>? _foreground;
  String? _token;
  String _lang = 'en';

  static bool _initialised = false;

  static Future<void> _init() async {
    if (_initialised) return;
    await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
    _initialised = true;
  }

  String get _platform => defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android';

  @override
  Stream<void> get arrived => _arrived.stream;

  @override
  Future<void> start(Api api, String lang) async {
    _lang = lang;
    try {
      await _init();
      final fm = FirebaseMessaging.instance;
      // Android 13 and iOS ask the parent; older Android just allows it.
      await fm.requestPermission();
      // On iOS a banner is shown even while the app is open.
      await fm.setForegroundNotificationPresentationOptions(alert: true, badge: true, sound: true);
      _token = await fm.getToken();
      if (_token != null) await api.registerDevice(_token!, _platform, _lang);
      // Firebase may hand the phone a new address at any time.
      _refresh ??= fm.onTokenRefresh.listen((t) {
        _token = t;
        api.registerDevice(t, _platform, _lang).catchError((_) {});
      });
      _foreground ??= FirebaseMessaging.onMessage.listen((_) => _arrived.add(null));
    } catch (_) {
      // No permission, no Google services, no network: the app carries on without push.
    }
  }

  @override
  Future<void> setLang(Api api, String lang) async {
    _lang = lang;
    final t = _token;
    if (t == null) return;
    try {
      await api.registerDevice(t, _platform, lang);
    } catch (_) {}
  }

  @override
  Future<void> stop(Api api) async {
    final t = _token;
    _token = null;
    await _refresh?.cancel();
    await _foreground?.cancel();
    _refresh = null;
    _foreground = null;
    if (t == null) return;
    try {
      await api.removeDevice(t);
      // A new address for whoever signs in next on this phone.
      await FirebaseMessaging.instance.deleteToken();
    } catch (_) {}
  }

  @override
  void dispose() {
    _refresh?.cancel();
    _foreground?.cancel();
    _arrived.close();
  }
}

/// The push the app uses. Only phones have Firebase set up; tests replace this.
Push Function() pushFactory = () => !kIsWeb && (defaultTargetPlatform == TargetPlatform.android || defaultTargetPlatform == TargetPlatform.iOS) ? FirebasePush() : NoPush();
