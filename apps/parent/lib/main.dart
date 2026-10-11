import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';
import 'push.dart';
import 'screens/consent.dart';
import 'screens/home.dart';
import 'screens/login.dart';
import 'settings.dart';
import 'theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final prefs = await SharedPreferences.getInstance();
  runApp(ParentApp(api: Api(prefs), settings: AppSettings(prefs)));
}

/// English or Arabic (right to left), light or dark as the phone is set.
class ParentApp extends StatelessWidget {
  const ParentApp({super.key, required this.api, required this.settings});
  final Api api;
  final AppSettings settings;

  @override
  Widget build(BuildContext context) {
    return Settings(
      settings: settings,
      child: ListenableBuilder(
        listenable: settings,
        builder: (context, _) {
          final arabic = settings.lang == 'ar';
          return MaterialApp(
            title: arabic ? 'المدرسة' : 'School',
            debugShowCheckedModeBanner: false,
            locale: Locale(settings.lang),
            supportedLocales: const [Locale('en'), Locale('ar')],
            localizationsDelegates: GlobalMaterialLocalizations.delegates,
            theme: Brand.theme(Brightness.light, arabic: arabic),
            darkTheme: Brand.theme(Brightness.dark, arabic: arabic),
            themeMode: ThemeMode.system,
            home: Gate(api: api),
          );
        },
      ),
    );
  }
}

/// Decides the first screen: sign in, the tracking consent, or the child's day.
class Gate extends StatefulWidget {
  const Gate({super.key, required this.api});
  final Api api;

  @override
  State<Gate> createState() => _GateState();
}

class _GateState extends State<Gate> {
  Map<String, dynamic>? _me;
  bool _loading = true;
  final Push _push = pushFactory();
  bool _pushOn = false;
  String? _lang;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // A parent who switches language gets their pushes in it.
    final lang = Settings.of(context).lang;
    if (_lang != null && lang != _lang && _pushOn) _push.setLang(widget.api, lang);
    _lang = lang;
  }

  @override
  void dispose() {
    _push.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    Map<String, dynamic>? me;
    if (widget.api.signedIn) {
      try {
        me = await widget.api.me();
      } catch (_) {
        me = null;
      }
    }
    if (mounted) {
      setState(() {
        _me = me;
        _loading = false;
      });
    }
  }

  /// A signed-in parent who is past the consent screen gets pushes: start once per sign-in.
  void _startPush(String lang) {
    if (_pushOn) return;
    _pushOn = true;
    _push.start(widget.api, lang);
  }

  Future<void> _signOut() async {
    // While the login still works, forget this phone, so it stops ringing for this parent.
    if (_pushOn) await _push.stop(widget.api);
    _pushOn = false;
    await widget.api.signOut();
    setState(() => _me = null);
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    final me = _me;
    if (me == null) return LoginScreen(api: widget.api, onSignedIn: _load);
    // Tracking consent only matters at a school that subscribes to smart bands; others have nothing to consent to.
    if (me['straps'] == true && me['consentAt'] == null) return ConsentScreen(api: widget.api, onAgreed: _load, onDecline: _signOut);
    _startPush(Settings.of(context).lang);
    return HomeScreen(api: widget.api, me: me, onSignOut: _signOut, push: _push);
  }
}
