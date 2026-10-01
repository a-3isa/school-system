import 'package:flutter/material.dart';

import '../api.dart';
import '../theme.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.api, required this.me, required this.onSignOut});
  final Api api;
  final Map<String, dynamic> me;
  final VoidCallback onSignOut;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _tab = 0;

  @override
  Widget build(BuildContext context) {
    final pages = [DayTab(api: widget.api), NotificationsTab(api: widget.api)];
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.me['schoolName'] ?? 'School', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
        actions: [IconButton(onPressed: widget.onSignOut, icon: const Icon(Icons.logout), tooltip: 'Sign out')],
      ),
      body: pages[_tab],
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        backgroundColor: Brand.surface,
        indicatorColor: Brand.okBg,
        onDestinationSelected: (i) => setState(() => _tab = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.today_outlined), selectedIcon: Icon(Icons.today), label: 'Today'),
          NavigationDestination(icon: Icon(Icons.notifications_outlined), selectedIcon: Icon(Icons.notifications), label: 'Notifications'),
        ],
      ),
    );
  }
}

/// The selected child's day: arrival, then each lesson's attendance.
class DayTab extends StatefulWidget {
  const DayTab({super.key, required this.api});
  final Api api;

  @override
  State<DayTab> createState() => _DayTabState();
}

class _DayTabState extends State<DayTab> {
  List<dynamic> _children = [];
  String? _childId;
  List<dynamic> _lessons = [];
  Map<String, dynamic>? _arrival;
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final kids = await widget.api.children();
      final id = _childId ?? (kids.isNotEmpty ? kids.first['id'] as String : null);
      final date = todayCairo();
      final lessons = id == null ? <dynamic>[] : await widget.api.childDay(id, date);
      final notes = await widget.api.notifications();
      final arrival = notes.cast<Map<String, dynamic>>().where((n) =>
          n['type'] == 'attendance.arrived' && n['data']?['studentId'] == id && n['data']?['date'] == date);
      setState(() {
        _children = kids;
        _childId = id;
        _lessons = lessons;
        _arrival = arrival.isEmpty ? null : arrival.first;
        _error = null;
      });
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading && _children.isEmpty) return const Center(child: CircularProgressIndicator());
    final child = _children.cast<Map<String, dynamic>?>().firstWhere((c) => c?['id'] == _childId, orElse: () => null);
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          if (_error != null) Text(_error!, style: const TextStyle(color: Brand.alert)),
          if (_children.length > 1)
            Wrap(spacing: 8, children: [
              for (final c in _children)
                ChoiceChip(
                  label: Text(c['firstName'] as String),
                  selected: c['id'] == _childId,
                  onSelected: (_) {
                    setState(() => _childId = c['id'] as String);
                    _load();
                  },
                ),
            ]),
          if (_children.isEmpty && _error == null)
            const Padding(padding: EdgeInsets.only(top: 40), child: Text('No children are linked to your account yet. Ask the school.')),
          if (child != null) ...[
            const SizedBox(height: 16),
            Text('${child['firstName']}’s day', style: Theme.of(context).textTheme.headlineMedium),
            Text(child['class']?['name'] != null ? 'Class ${child['class']['name']}' : '', style: const TextStyle(color: Brand.muted)),
            const SizedBox(height: 16),
            Card(
              child: Column(children: [
                _Moment(
                  time: _arrival?['data']?['time'] as String? ?? '—',
                  title: _arrival != null ? 'Arrived at school' : 'Not arrived yet',
                  done: _arrival != null,
                  icon: Icons.login,
                ),
                for (final l in _lessons)
                  _Moment(
                    time: l['startTime'] as String,
                    title: '${l['subject'] ?? 'Period ${l['period']}'}',
                    status: l['status'] as String,
                    done: true,
                    icon: Icons.menu_book_outlined,
                  ),
                if (_lessons.isEmpty)
                  const Padding(padding: EdgeInsets.all(16), child: Text('Lessons appear here as attendance is taken.', style: TextStyle(color: Brand.muted))),
              ]),
            ),
          ],
        ],
      ),
    );
  }
}

class _Moment extends StatelessWidget {
  const _Moment({required this.time, required this.title, required this.done, required this.icon, this.status});
  final String time;
  final String title;
  final String? status;
  final bool done;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final s = status == null ? null : statusStyle(status!);
    return ListTile(
      leading: CircleAvatar(
        backgroundColor: done ? Brand.ink : Brand.ground,
        foregroundColor: done ? Brand.ground : Brand.muted,
        child: Icon(icon, size: 18),
      ),
      title: Text(title, style: TextStyle(fontWeight: FontWeight.w600, color: done ? Brand.ink : Brand.muted)),
      subtitle: Text(time),
      trailing: s == null
          ? null
          : Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(color: s.bg, borderRadius: BorderRadius.circular(999)),
              child: Text(s.label, style: TextStyle(color: s.fg, fontWeight: FontWeight.w600, fontSize: 12)),
            ),
    );
  }
}

class NotificationsTab extends StatefulWidget {
  const NotificationsTab({super.key, required this.api});
  final Api api;

  @override
  State<NotificationsTab> createState() => _NotificationsTabState();
}

class _NotificationsTabState extends State<NotificationsTab> {
  List<dynamic> _items = [];
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final items = await widget.api.notifications();
      setState(() {
        _items = items;
        _error = null;
      });
    } catch (e) {
      setState(() => _error = e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: const EdgeInsets.all(20),
        itemCount: _items.isEmpty ? 1 : _items.length,
        separatorBuilder: (_, __) => const SizedBox(height: 8),
        itemBuilder: (context, i) {
          if (_items.isEmpty) return Text(_error ?? 'No notifications yet.', style: const TextStyle(color: Brand.muted));
          final n = _items[i] as Map<String, dynamic>;
          final unread = n['readAt'] == null;
          return Card(
            child: ListTile(
              onTap: unread
                  ? () async {
                      await widget.api.markRead(n['id'] as String);
                      _load();
                    }
                  : null,
              leading: unread ? const CircleAvatar(radius: 5, backgroundColor: Brand.clay) : const SizedBox(width: 10),
              title: Text(n['title'] as String, style: TextStyle(fontWeight: unread ? FontWeight.w700 : FontWeight.w500)),
              subtitle: Text('${n['body']}\n${timeCairo(n['createdAt'] as String)}'),
              isThreeLine: true,
            ),
          );
        },
      ),
    );
  }
}
