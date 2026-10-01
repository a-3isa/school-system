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
    final pages = [DayTab(api: widget.api), NotificationsTab(api: widget.api), AccountTab(api: widget.api, me: widget.me, onSignOut: widget.onSignOut)];
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
          NavigationDestination(icon: Icon(Icons.person_outline), selectedIcon: Icon(Icons.person), label: 'Account'),
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

/// The parent's details, and changing the mobile number (checked with a WhatsApp code).
class AccountTab extends StatefulWidget {
  const AccountTab({super.key, required this.api, required this.me, required this.onSignOut});
  final Api api;
  final Map<String, dynamic> me;
  final VoidCallback onSignOut;

  @override
  State<AccountTab> createState() => _AccountTabState();
}

class _AccountTabState extends State<AccountTab> {
  late String? _phone = widget.me['phone'] as String?;
  late bool _checked = widget.me['phoneVerifiedAt'] != null;
  final _newPhone = TextEditingController(text: '+20');
  final _code = TextEditingController();
  bool _changing = false;
  bool _codeSent = false;
  bool _busy = false;
  String? _error;
  String? _done;

  Future<void> _run(Future<void> Function() fn) async {
    setState(() {
      _busy = true;
      _error = null;
      _done = null;
    });
    try {
      await fn();
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _send() => _run(() async {
        await widget.api.requestPhoneChange(_newPhone.text.replaceAll(' ', ''));
        setState(() => _codeSent = true);
      });

  Future<void> _confirm() => _run(() async {
        final phone = _newPhone.text.replaceAll(' ', '');
        await widget.api.confirmPhoneChange(phone, _code.text.trim());
        setState(() {
          _phone = phone;
          _checked = true;
          _changing = false;
          _codeSent = false;
          _code.clear();
          _done = 'Your mobile is now $phone. The school has been told.';
        });
      });

  @override
  Widget build(BuildContext context) {
    final me = widget.me;
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Text(me['name'] as String? ?? '', style: Theme.of(context).textTheme.headlineMedium),
        const SizedBox(height: 4),
        Text(me['email'] as String? ?? '', style: const TextStyle(color: Brand.muted)),
        const SizedBox(height: 24),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Mobile', style: TextStyle(color: Brand.muted, fontSize: 13)),
                const SizedBox(height: 4),
                Text(_phone ?? 'Not set', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
                const SizedBox(height: 4),
                Text(_checked ? 'Checked on WhatsApp' : 'Not checked yet', style: TextStyle(color: _checked ? Brand.ok : Brand.muted, fontSize: 13)),
                if (_done != null) ...[const SizedBox(height: 12), Text(_done!, style: const TextStyle(color: Brand.ok))],
                if (_error != null) ...[const SizedBox(height: 12), Text(_error!, style: const TextStyle(color: Brand.alert))],
                const SizedBox(height: 12),
                if (!_changing)
                  OutlinedButton(onPressed: () => setState(() => _changing = true), child: const Text('Change mobile'))
                else ...[
                  TextField(
                    controller: _newPhone,
                    enabled: !_codeSent,
                    keyboardType: TextInputType.phone,
                    decoration: const InputDecoration(labelText: 'New mobile (with country code)'),
                  ),
                  if (_codeSent) ...[
                    const SizedBox(height: 8),
                    TextField(
                      controller: _code,
                      keyboardType: TextInputType.number,
                      maxLength: 6,
                      decoration: const InputDecoration(labelText: 'Code from WhatsApp'),
                    ),
                  ],
                  const SizedBox(height: 8),
                  FilledButton(
                    onPressed: _busy ? null : (_codeSent ? _confirm : _send),
                    child: Text(_busy ? 'One moment…' : _codeSent ? 'Save new mobile' : 'Send a WhatsApp code'),
                  ),
                  TextButton(
                    onPressed: _busy ? null : () => setState(() { _changing = false; _codeSent = false; _error = null; }),
                    child: const Text('Cancel'),
                  ),
                ],
              ],
            ),
          ),
        ),
        const SizedBox(height: 24),
        OutlinedButton.icon(onPressed: widget.onSignOut, icon: const Icon(Icons.logout), label: const Text('Sign out')),
      ],
    );
  }
}
