import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../api.dart';
import '../socket.dart';
import '../strings.dart';
import '../theme.dart';
import 'account.dart';
import 'day.dart';
import 'messages.dart';
import 'notifications.dart';
import 'school.dart';

/// What every tab shares: the parent's children and their notifications,
/// refreshed every minute while the app is open.
class HomeData extends ChangeNotifier {
  HomeData(this.api, [this.me = const {}]);
  final Api api;
  /// The signed-in parent, with their school's name.
  final Map<String, dynamic> me;
  /// The school's crest image, once it has loaded (null: initials instead).
  Uint8List? crest;
  List<Map<String, dynamic>> children = [];
  List<Map<String, dynamic>> notifications = [];
  String? error;
  bool loaded = false;
  /// The child every tab is showing.
  String? childId;
  /// Urgent messages from the school that the parent hasn't confirmed yet.
  List<Map<String, dynamic>> emergencies = [];
  ChatSocket? _chat;
  /// The live connection for chat, opened the first time it is needed.
  ChatSocket get chat => _chat ??= chatSocketFactory(api);

  @override
  void dispose() {
    _chat?.dispose();
    super.dispose();
  }

  int get unread => notifications.where((n) => n['readAt'] == null).length;

  void selectChild(String id) {
    if (id == childId) return;
    childId = id;
    notifyListeners();
  }

  /// Does the school have this module and, if given, the feature inside it?
  /// (`/auth/me` lists the modules and each one's feature switches.)
  bool has(String module, [String? feature]) {
    final modules = (me['modules'] as List?)?.cast<String>() ?? const <String>[];
    if (!modules.contains(module)) return false;
    if (feature == null) return true;
    final features = me['features'] as Map?;
    return (features?[module] as Map?)?[feature] == true;
  }

  Map<String, dynamic>? child(String? id) {
    for (final c in children) {
      if (c['id'] == id) return c;
    }
    return null;
  }

  Future<void> loadCrest() async {
    if (me['schoolLogo'] != true) return;
    crest = await api.crest();
    notifyListeners();
  }

  /// The school's name in the app's language.
  String schoolName(bool arabic) =>
      ((arabic ? me['schoolNameAr'] : null) as String?)?.trim().isNotEmpty == true ? me['schoolNameAr'] as String : (me['schoolName'] as String? ?? '');

  Future<void> load() async {
    try {
      final results = await Future.wait([api.children(), api.notifications()]);
      children = results[0].cast<Map<String, dynamic>>();
      notifications = results[1].cast<Map<String, dynamic>>();
      // Start on the first child, and move on if the chosen one is gone.
      if (child(childId) == null) childId = children.isEmpty ? null : children.first['id'] as String;
      error = null;
    } catch (e) {
      error = e.toString();
    }
    // An urgent message stays on top until it is confirmed; not being able to ask never blocks the rest.
    if (has('messaging')) {
      try {
        emergencies = (await api.emergencies()).cast<Map<String, dynamic>>();
      } catch (_) {}
    }
    loaded = true;
    notifyListeners();
  }

  Future<void> acknowledge(String id) async {
    await api.acknowledge(id);
    await load();
  }

  Future<void> markRead(Iterable<String> ids) async {
    await Future.wait(ids.map(api.markRead));
    await load();
  }
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.api, required this.me, required this.onSignOut});
  final Api api;
  final Map<String, dynamic> me;
  final VoidCallback onSignOut;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  late final HomeData _data = HomeData(widget.api, widget.me);
  String _tab = 'day';
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _data.load();
    _data.loadCrest();
    _timer = Timer.periodic(const Duration(minutes: 1), (_) => _data.load());
  }

  @override
  void dispose() {
    _timer?.cancel();
    _data.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    return ListenableBuilder(
      listenable: _data,
      builder: (context, _) {
        // The tabs this school has: Messages and School appear only with their modules.
        final tabs = <_Tab>[
          _Tab('day', s.tabDay, Icons.wb_sunny_outlined, DayTab(api: widget.api, data: _data)),
          if (_data.has('messaging')) _Tab('messages', s.tabMessages, Icons.forum_outlined, MessagesTab(api: widget.api, data: _data)),
          if (hasSchoolTab(_data)) _Tab('school', s.tabSchool, Icons.school_outlined, SchoolTab(api: widget.api, data: _data)),
          _Tab('notifs', s.tabNotifs, Icons.notifications_none, NotificationsTab(data: _data), badge: _data.unread),
          _Tab('account', s.tabAccount, Icons.person_outline, AccountTab(api: widget.api, me: widget.me, onSignOut: widget.onSignOut)),
        ];
        final index = tabs.indexWhere((t) => t.key == _tab).clamp(0, tabs.length - 1);
        return Scaffold(
          body: SafeArea(bottom: false, child: IndexedStack(index: index, children: [for (final t in tabs) t.body])),
          bottomNavigationBar: DecoratedBox(
            decoration: BoxDecoration(border: Border(top: BorderSide(color: c.line))),
            child: NavigationBarTheme(
              data: NavigationBarThemeData(
                backgroundColor: c.surface,
                surfaceTintColor: Colors.transparent,
                indicatorColor: c.primary.withValues(alpha: .12),
                labelTextStyle: WidgetStateProperty.resolveWith((states) => TextStyle(
                      fontSize: 12,
                      fontWeight: states.contains(WidgetState.selected) ? FontWeight.w600 : FontWeight.w500,
                      color: states.contains(WidgetState.selected) ? c.primary : c.ink2,
                    )),
                iconTheme: WidgetStateProperty.resolveWith((states) => IconThemeData(color: states.contains(WidgetState.selected) ? c.primary : c.ink2)),
              ),
              child: NavigationBar(
                selectedIndex: index,
                height: 64,
                onDestinationSelected: (i) => setState(() => _tab = tabs[i].key),
                destinations: [
                  for (final t in tabs)
                    NavigationDestination(
                      icon: t.badge > 0 ? Badge(label: Text('${t.badge}'), child: Icon(t.icon)) : Icon(t.icon),
                      label: t.label,
                    ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

class _Tab {
  const _Tab(this.key, this.label, this.icon, this.body, {this.badge = 0});
  final String key;
  final String label;
  final IconData icon;
  final Widget body;
  final int badge;
}
