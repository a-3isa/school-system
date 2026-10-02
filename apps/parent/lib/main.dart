import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';
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

  @override
  void initState() {
    super.initState();
    _load();
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

  Future<void> _signOut() async {
    await widget.api.signOut();
    setState(() => _me = null);
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    final me = _me;
    if (me == null) return LoginScreen(api: widget.api, onSignedIn: _load);
    if (me['consentAt'] == null) return ConsentScreen(api: widget.api, onAgreed: _load, onDecline: _signOut);
    return HomeScreen(api: widget.api, me: me, onSignOut: _signOut);
  }
}
