import 'dart:async';

import 'package:flutter/material.dart';

import '../api.dart';
import '../strings.dart';
import '../theme.dart';
import 'account.dart';
import 'day.dart';
import 'notifications.dart';

/// What every tab shares: the parent's children and their notifications,
/// refreshed every minute while the app is open.
class HomeData extends ChangeNotifier {
  HomeData(this.api);
  final Api api;
  List<Map<String, dynamic>> children = [];
  List<Map<String, dynamic>> notifications = [];
  String? error;
  bool loaded = false;

  int get unread => notifications.where((n) => n['readAt'] == null).length;

  Map<String, dynamic>? child(String? id) {
    for (final c in children) {
      if (c['id'] == id) return c;
    }
    return null;
  }

  Future<void> load() async {
    try {
      final results = await Future.wait([api.children(), api.notifications()]);
      children = results[0].cast<Map<String, dynamic>>();
      notifications = results[1].cast<Map<String, dynamic>>();
      error = null;
    } catch (e) {
      error = e.toString();
    }
    loaded = true;
    notifyListeners();
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
  late final HomeData _data = HomeData(widget.api);
  int _tab = 0;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _data.load();
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
    return ListenableBuilder(
      listenable: _data,
      builder: (context, _) => Scaffold(
        body: SafeArea(
          bottom: false,
          child: IndexedStack(index: _tab, children: [
            DayTab(api: widget.api, data: _data),
            NotificationsTab(data: _data),
            AccountTab(api: widget.api, me: widget.me, onSignOut: widget.onSignOut),
          ]),
        ),
        bottomNavigationBar: _TabBar(
          index: _tab,
          onTap: (i) => setState(() => _tab = i),
          items: [(s.tabDay, 0), (s.tabNotifs, _data.unread), (s.tabAccount, 0)],
        ),
      ),
    );
  }
}

/// Three plain tabs: a short bar above the current one, and the unread count.
class _TabBar extends StatelessWidget {
  const _TabBar({required this.index, required this.onTap, required this.items});
  final int index;
  final ValueChanged<int> onTap;
  final List<(String, int)> items;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return Container(
      decoration: BoxDecoration(color: c.surface, border: Border(top: BorderSide(color: c.line))),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: 64,
          child: Row(children: [
            for (var i = 0; i < items.length; i++)
              Expanded(
                child: Semantics(
                  selected: i == index,
                  button: true,
                  child: InkWell(
                    onTap: () => onTap(i),
                    child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                      Container(width: 20, height: 3, decoration: BoxDecoration(color: i == index ? c.primary : Colors.transparent, borderRadius: BorderRadius.circular(2))),
                      const SizedBox(height: 6),
                      Row(mainAxisSize: MainAxisSize.min, children: [
                        Flexible(
                          child: Text(items[i].$1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(fontSize: 12, fontWeight: i == index ? FontWeight.w600 : FontWeight.w500, color: i == index ? c.primary : c.ink2)),
                        ),
                        if (items[i].$2 > 0) ...[
                          const SizedBox(width: 5),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6),
                            decoration: BoxDecoration(color: c.primary, borderRadius: BorderRadius.circular(999)),
                            child: Text('${items[i].$2}', style: TextStyle(color: c.onPrimary, fontSize: 11, fontWeight: FontWeight.w600)),
                          ),
                        ],
                      ]),
                    ]),
                  ),
                ),
              ),
          ]),
        ),
      ),
    );
  }
}
