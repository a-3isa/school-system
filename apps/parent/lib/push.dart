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

  /// The parent tapped a push while the app was in the background: its data (type, child, ids…).
  Stream<Map<String, dynamic>> get opened;

  /// The push the parent tapped to start the app, once (null when it wasn't started that way). Waits for [start] to finish.
  Future<Map<String, dynamic>?> takeLaunch();

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
  Stream<Map<String, dynamic>> get opened => const Stream.empty();
  @override
  Future<Map<String, dynamic>?> takeLaunch() async => null;
  @override
  void dispose() {}
}

/// Firebase Cloud Messaging. Anything that goes wrong here is swallowed: the
/// app works without push, and the notifications are still in its list.
class FirebasePush implements Push {
  final _arrived = StreamController<void>.broadcast();
  final _opened = StreamController<Map<String, dynamic>>.broadcast();
  StreamSubscription<String>? _refresh;
  StreamSubscription<RemoteMessage>? _foreground;
  StreamSubscription<RemoteMessage>? _tapped;
  Map<String, dynamic>? _launch;
  final _ready = Completer<void>();
  String? _token;
  String _lang = 'en';

  static bool _initialised = false;

  static Future<void> _init() async {
    if (_initialised) return;
    await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
    _initialised = true;
  }

  String get _platform => kIsWeb ? 'web' : (defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android');

  @override
  Stream<void> get arrived => _arrived.stream;

  @override
  Stream<Map<String, dynamic>> get opened => _opened.stream;

  @override
  Future<Map<String, dynamic>?> takeLaunch() async {
    // The tap that started the app is known once start() has asked Firebase for it; don't wait forever.
    await _ready.future.timeout(const Duration(seconds: 8), onTimeout: () {});
    final l = _launch;
    _launch = null;
    return l;
  }

  @override
  Future<void> start(Api api, String lang) async {
    _lang = lang;
    try {
      await _init();
      final fm = FirebaseMessaging.instance;
      // Android 13, iOS and browsers ask the parent; older Android just allows it.
      await fm.requestPermission();
      try {
        // On iOS a banner is shown even while the app is open (the web has no such setting).
        await fm.setForegroundNotificationPresentationOptions(alert: true, badge: true, sound: true);
      } catch (_) {}
      _token = await fm.getToken();
      if (_token != null) await api.registerDevice(_token!, _platform, _lang);
      // Firebase may hand the phone a new address at any time.
      _refresh ??= fm.onTokenRefresh.listen((t) {
        _token = t;
        api.registerDevice(t, _platform, _lang).catchError((_) {});
      });
      _foreground ??= FirebaseMessaging.onMessage.listen((m) {
        if (kDebugMode) debugPrint('Push arrived while the app is open: ${m.data['type']}');
        _arrived.add(null);
      });
      // A tap on a push shows what it is about: while the app is in the background, or when the tap started it.
      _tapped ??= FirebaseMessaging.onMessageOpenedApp.listen((m) => _opened.add(Map<String, dynamic>.from(m.data)));
      final launch = await fm.getInitialMessage();
      if (launch != null) _launch = Map<String, dynamic>.from(launch.data);
    } catch (e) {
      // No permission, no Google services, no network: the app carries on without push.
      if (kDebugMode) debugPrint('Push could not start: $e');
    } finally {
      if (!_ready.isCompleted) _ready.complete();
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
    await _tapped?.cancel();
    _refresh = null;
    _foreground = null;
    _tapped = null;
    _launch = null;
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
    _tapped?.cancel();
    _arrived.close();
    _opened.close();
  }
}

/// The push the app uses: phones and browsers have Firebase set up; tests replace this.
Push Function() pushFactory = () => kIsWeb || defaultTargetPlatform == TargetPlatform.android || defaultTargetPlatform == TargetPlatform.iOS ? FirebasePush() : NoPush();
