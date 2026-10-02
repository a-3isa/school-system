import 'package:flutter/widgets.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// The parent's choices that outlive a session: for now, the language.
class AppSettings extends ChangeNotifier {
  AppSettings(this._prefs) : _lang = _prefs.getString(_langKey) ?? _deviceLang();

  final SharedPreferences _prefs;
  static const _langKey = 'lang';
  String _lang;

  /// 'en' or 'ar'. A phone set to Arabic starts in Arabic.
  String get lang => _lang;

  Future<void> setLang(String lang) async {
    if (lang == _lang) return;
    _lang = lang;
    notifyListeners();
    await _prefs.setString(_langKey, lang);
  }

  static String _deviceLang() => WidgetsBinding.instance.platformDispatcher.locale.languageCode == 'ar' ? 'ar' : 'en';
}

/// Makes [AppSettings] reachable from any widget, rebuilding them when it changes.
class Settings extends InheritedNotifier<AppSettings> {
  const Settings({super.key, required AppSettings settings, required super.child}) : super(notifier: settings);

  static AppSettings of(BuildContext context) => context.dependOnInheritedWidgetOfExactType<Settings>()!.notifier!;
}
