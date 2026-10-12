import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../api.dart';
import '../push.dart';
import '../socket.dart';
import '../strings.dart';
import '../theme.dart';
import 'account.dart';
import 'day.dart';
import 'excuse.dart';
import 'behaviour.dart';
import 'clubs.dart';
import 'event.dart';
import 'grades.dart';
import 'meetings.dart';
import 'messages.dart';
import 'notifications.dart';
import 'school.dart';
import 'trips.dart';

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
  /// An announcement that a tapped notification asks the Messages tab to open.
  String? openAnnouncementId;

  void openAnnouncement(String id) {
    openAnnouncementId = id;
    notifyListeners();
  }
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
  const HomeScreen({super.key, required this.api, required this.me, required this.onSignOut, this.push});
  final Api api;
  /// Tells the screen when a push arrives while the app is open, so it refreshes.
  final Push? push;
  final Map<String, dynamic> me;
  final VoidCallback onSignOut;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  late final HomeData _data = HomeData(widget.api, widget.me);
  String _tab = 'day';
  Timer? _timer;
  StreamSubscription<void>? _pushed;
  StreamSubscription<Map<String, dynamic>>? _tapped;

  @override
  void initState() {
    super.initState();
    // The children are known once this has loaded, so a tap that started the app can be shown properly.
    _data.load().then((_) async {
      final launch = await widget.push?.takeLaunch();
      if (launch != null && mounted) _openPush(launch);
    });
    _data.loadCrest();
    _timer = Timer.periodic(const Duration(minutes: 1), (_) => _data.load());
    _pushed = widget.push?.arrived.listen((_) => _data.load());
    _tapped = widget.push?.opened.listen(_openPush);
  }

  /// A tapped push: mark it read and show what it is about.
  void _openPush(Map<String, dynamic> data) {
    final id = data['notificationId'] as String?;
    if (id != null) _data.markRead([id]).catchError((_) {});
    _open(data['type'] as String? ?? '', data);
  }

  /// Takes the parent to what a notification is about: the child's day, their excuses,
  /// a conversation, the news, or a meeting. Anything else lands on the notification list.
  Future<void> _open(String type, Map<String, dynamic> info) async {
    if (!mounted) return;
    final child = _data.child(info['studentId'] as String?);
    if (child != null) _data.selectChild(child['id'] as String);
    void go(String tab) => setState(() => _tab = tab);
    final nav = Navigator.of(context);

    if (type.startsWith('attendance.') || type == 'announcement.emergency') return go('day'); // the urgent message is pinned there
    if ((type == 'excuse.approved' || type == 'excuse.rejected') && child != null) {
      await nav.push(MaterialPageRoute(builder: (_) => ExcusesScreen(api: widget.api, child: child)));
      return;
    }
    if (type == 'message.new' && info['threadId'] is String && _data.has('messaging', 'chat')) {
      await nav.push(MaterialPageRoute(builder: (_) => ChatScreen(api: widget.api, data: _data, threadId: info['threadId'] as String)));
      return;
    }
    if (type == 'announcement.new' && _data.has('messaging')) {
      if (info['announcementId'] is String) _data.openAnnouncement(info['announcementId'] as String);
      return go('messages');
    }
    if (type == 'poll.new' && _data.has('messaging')) return go('messages');
    if ((type == 'marks.published' || type == 'reportCard.published') && _data.has('academics')) {
      await nav.push(MaterialPageRoute(builder: (_) => GradesScreen(api: widget.api, data: _data)));
      return;
    }
    if (type == 'behaviour.note' && _data.has('behavior')) {
      await nav.push(MaterialPageRoute(builder: (_) => BehaviourScreen(api: widget.api, data: _data)));
      return;
    }
    if (type == 'activity.promoted' && _data.has('activities')) {
      await nav.push(MaterialPageRoute(builder: (_) => ClubsScreen(api: widget.api, data: _data)));
      return;
    }
    if (type.startsWith('trip.') && _data.has('activities', 'trips')) {
      await nav.push(MaterialPageRoute(builder: (_) => TripsScreen(api: widget.api, data: _data, openTripId: type == 'trip.cancelled' ? null : info['tripId'] as String?)));
      return;
    }
    if (type == 'event.new' && info['eventId'] is String && _data.has('activities', 'events')) {
      await nav.push(MaterialPageRoute(builder: (_) => EventScreen(api: widget.api, eventId: info['eventId'] as String)));
      return;
    }
    if (type == 'meeting.cancelled' && _data.has('messaging', 'meetings')) {
      await nav.push(MaterialPageRoute(builder: (_) => MeetingsScreen(api: widget.api, data: _data)));
      return;
    }
    go('notifs');
  }

  @override
  void dispose() {
    _timer?.cancel();
    _pushed?.cancel();
    _tapped?.cancel();
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
          _Tab('notifs', s.tabNotifs, Icons.notifications_none, NotificationsTab(data: _data, onOpen: _open), badge: _data.unread),
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
