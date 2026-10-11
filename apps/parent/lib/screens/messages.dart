import 'dart:async';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../api.dart';
import '../strings.dart';
import '../theme.dart';
import '../widgets.dart';
import 'home.dart';

const _maxBytes = 5 * 1024 * 1024;

/// What the school sent: announcements and polls, and the parent's conversations with teachers.
class MessagesTab extends StatefulWidget {
  const MessagesTab({super.key, required this.api, required this.data});
  final Api api;
  final HomeData data;

  @override
  State<MessagesTab> createState() => _MessagesTabState();
}

class _MessagesTabState extends State<MessagesTab> {
  String _segment = 'news';
  List<Map<String, dynamic>> _announcements = [];
  List<Map<String, dynamic>> _polls = [];
  List<Map<String, dynamic>> _threads = [];
  bool _loaded = false;
  String? _error;
  Timer? _timer;
  StreamSubscription<Map<String, dynamic>>? _live;

  bool get _chat => widget.data.has('messaging', 'chat');
  bool get _pollsOn => widget.data.has('messaging', 'polls');

  @override
  void initState() {
    super.initState();
    _load();
    _timer = Timer.periodic(const Duration(minutes: 1), (_) => _load());
    // A new message changes the list at once, without waiting for the minute.
    if (_chat) _live = widget.data.chat.messages.listen((_) => _load());
  }

  @override
  void dispose() {
    _timer?.cancel();
    _live?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final r = await Future.wait<List<dynamic>>([
        widget.api.announcements(),
        _pollsOn ? widget.api.polls() : Future.value(const <dynamic>[]),
        _chat ? widget.api.threads() : Future.value(const <dynamic>[]),
      ]);
      if (!mounted) return;
      setState(() {
        _announcements = r[0].cast<Map<String, dynamic>>();
        _polls = r[1].cast<Map<String, dynamic>>();
        _threads = r[2].cast<Map<String, dynamic>>();
        _loaded = true;
        _error = null;
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _loaded = true;
        });
      }
    }
  }

  int get _unreadChats => _threads.fold(0, (n, t) => n + (t['unread'] as int? ?? 0));
  int get _unreadNews => _announcements.where((a) => a['readAt'] == null).length;

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final items = <(String, String, Map<String, dynamic>)>[
      for (final a in _announcements) ('a', (a['sentAt'] as String?) ?? '', a),
      for (final p in _polls) ('p', (p['createdAt'] as String?) ?? '', p),
    ]..sort((x, y) => y.$2.compareTo(x.$2));

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 10, 20, 24),
        children: [
          Text(s.tabMessages, style: Brand.display(context, size: 24)),
          const SizedBox(height: 12),
          if (_chat) ...[
            _Segments(
              selected: _segment,
              onPick: (v) => setState(() => _segment = v),
              items: [('news', s.newsTab, _unreadNews), ('chats', s.chatsTab, _unreadChats)],
            ),
            const SizedBox(height: 14),
          ],
          if (_error != null) ...[ErrorBox(_error!), const SizedBox(height: 14)],
          if (!_loaded) const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator())),
          if (_loaded && (_segment == 'news' || !_chat)) ...[
            if (items.isEmpty && _error == null) EmptyState(icon: Icons.campaign_outlined, title: s.noNews),
            for (final (kind, _, item) in items) ...[
              if (kind == 'a')
                _AnnouncementCard(
                  a: item,
                  onTap: () async {
                    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => AnnouncementScreen(api: widget.api, a: item)));
                    await _load();
                  },
                )
              else
                _PollCard(key: ValueKey(item['id']), api: widget.api, poll: item, onVoted: _load),
              const SizedBox(height: 12),
            ],
          ],
          if (_loaded && _segment == 'chats' && _chat) ..._chats(context),
        ],
      ),
    );
  }

  List<Widget> _chats(BuildContext context) {
    final s = S.of(context);
    return [
      MainButton(
        label: s.newMessage,
        onPressed: () async {
          await Navigator.of(context).push(MaterialPageRoute(builder: (_) => NewChatScreen(api: widget.api, data: widget.data)));
          await _load();
        },
      ),
      const SizedBox(height: 14),
      if (_threads.isEmpty && _error == null) EmptyState(icon: Icons.forum_outlined, title: s.noChats),
      for (final t in _threads) ...[
        _ThreadTile(
          thread: t,
          onTap: () async {
            await Navigator.of(context).push(MaterialPageRoute(builder: (_) => ChatScreen(api: widget.api, data: widget.data, threadId: t['id'] as String)));
            await _load();
          },
        ),
        const SizedBox(height: 10),
      ],
    ];
  }
}

/// Two choices side by side, the chosen one raised, with a count of what is unread.
class _Segments extends StatelessWidget {
  const _Segments({required this.selected, required this.onPick, required this.items});
  final String selected;
  final ValueChanged<String> onPick;
  final List<(String, String, int)> items;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(color: c.sunk, borderRadius: BorderRadius.circular(10)),
      child: Row(children: [
        for (final (key, label, unread) in items)
          Expanded(
            child: Semantics(
              selected: key == selected,
              button: true,
              child: GestureDetector(
                onTap: () => onPick(key),
                child: Container(
                  constraints: const BoxConstraints(minHeight: 44),
                  margin: const EdgeInsets.symmetric(horizontal: 2),
                  decoration: key == selected ? BoxDecoration(color: c.surface, borderRadius: BorderRadius.circular(7), border: Border.all(color: c.line)) : null,
                  alignment: Alignment.center,
                  child: Row(mainAxisSize: MainAxisSize.min, children: [
                    Text(label, style: TextStyle(fontSize: 15, fontWeight: key == selected ? FontWeight.w600 : FontWeight.w500, color: key == selected ? c.ink : c.ink2)),
                    if (unread > 0) ...[
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6),
                        decoration: BoxDecoration(color: c.primary, borderRadius: BorderRadius.circular(999)),
                        child: Text('$unread', style: TextStyle(color: c.onPrimary, fontSize: 11, fontWeight: FontWeight.w600)),
                      ),
                    ],
                  ]),
                ),
              ),
            ),
          ),
      ]),
    );
  }
}

class _AnnouncementCard extends StatelessWidget {
  const _AnnouncementCard({required this.a, required this.onTap});
  final Map<String, dynamic> a;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    final unread = a['readAt'] == null;
    final urgent = a['priority'] == 'EMERGENCY';
    return Semantics(
      button: true,
      label: unread ? s.unread : null,
      child: InkWell(
        borderRadius: BorderRadius.circular(Brand.panel),
        onTap: onTap,
        child: Panel(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              if (unread) ...[Container(width: 8, height: 8, decoration: BoxDecoration(color: c.primary, shape: BoxShape.circle)), const SizedBox(width: 8)],
              if (urgent) ...[StatusPill(label: s.urgent, fg: c.aFg, bg: c.aBg, glyph: '!'), const SizedBox(width: 8)],
              Expanded(child: Text(a['title'] as String, style: TextStyle(fontSize: 16, fontWeight: unread ? FontWeight.w700 : FontWeight.w600))),
            ]),
            const SizedBox(height: 6),
            Text(a['body'] as String, maxLines: 3, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 14, height: 1.45, color: c.ink2)),
            const SizedBox(height: 8),
            Text(s.dayLine(dateCairo(a['sentAt'] as String)), style: TextStyle(fontSize: 12, color: c.ink3)),
          ]),
        ),
      ),
    );
  }
}

/// An announcement in full. Opening it marks it read.
class AnnouncementScreen extends StatefulWidget {
  const AnnouncementScreen({super.key, required this.api, required this.a});
  final Api api;
  final Map<String, dynamic> a;

  @override
  State<AnnouncementScreen> createState() => _AnnouncementScreenState();
}

class _AnnouncementScreenState extends State<AnnouncementScreen> {
  Future<Uint8List?>? _file;

  @override
  void initState() {
    super.initState();
    final id = widget.a['id'] as String;
    if (widget.a['readAt'] == null) widget.api.readAnnouncement(id).catchError((_) {});
    if (widget.a['hasFile'] == true) _file = widget.api.bytes('/parent/announcements/$id/file');
  }

  static bool _isImage(Uint8List b) =>
      (b.length > 3 && b[0] == 0xff && b[1] == 0xd8) || (b.length > 4 && b[0] == 0x89 && b[1] == 0x50) || (b.length > 12 && b[0] == 0x52 && b[1] == 0x49);

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    final a = widget.a;
    return FormPage(
      title: a['title'] as String,
      sub: s.dayLine(dateCairo(a['sentAt'] as String)),
      onBack: () => Navigator.of(context).pop(),
      children: [
        Text(a['body'] as String, style: const TextStyle(fontSize: 16, height: 1.55)),
        if (_file != null)
          FutureBuilder<Uint8List?>(
            future: _file,
            builder: (context, snap) {
              if (snap.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
              final bytes = snap.data;
              if (bytes == null) return const SizedBox.shrink();
              return _isImage(bytes)
                  ? ClipRRect(borderRadius: BorderRadius.circular(Brand.radius), child: Image.memory(bytes, fit: BoxFit.contain))
                  : HelpBox(title: s.attachment, text: s.pdfAttachment);
            },
          ),
        if (a['priority'] == 'EMERGENCY') Text(s.urgent, style: TextStyle(color: c.aFg, fontWeight: FontWeight.w700)),
      ],
    );
  }
}

/// A question from the school: choose, answer, and see the result when the school allows it.
class _PollCard extends StatefulWidget {
  const _PollCard({super.key, required this.api, required this.poll, required this.onVoted});
  final Api api;
  final Map<String, dynamic> poll;
  final Future<void> Function() onVoted;

  @override
  State<_PollCard> createState() => _PollCardState();
}

class _PollCardState extends State<_PollCard> {
  final Set<String> _chosen = {};
  bool _busy = false;
  String? _error;

  Future<void> _send() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.api.vote(widget.poll['id'] as String, _chosen.toList());
      await widget.onVoted();
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    final p = widget.poll;
    final multiple = p['multiple'] == true;
    final open = p['open'] == true;
    final mine = (p['myVotes'] as List).cast<String>();
    final options = (p['options'] as List).cast<Map<String, dynamic>>();
    final showsResults = options.isNotEmpty && options.first.containsKey('votes');
    final voters = (p['voters'] as int?) ?? 0;
    final answering = open && mine.isEmpty;

    return Panel(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          StatusPill(label: s.poll, fg: c.lFg, bg: c.lBg, glyph: '?'),
          const SizedBox(width: 8),
          if (!open) Text(s.pollClosed, style: TextStyle(fontSize: 12, color: c.ink3)),
        ]),
        const SizedBox(height: 8),
        Text(p['question'] as String, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600, height: 1.4)),
        if (answering) Padding(padding: const EdgeInsets.only(top: 4), child: Text(multiple ? s.pickMany : s.pickOne, style: TextStyle(fontSize: 12, color: c.ink3))),
        const SizedBox(height: 10),
        for (final o in options)
          if (answering)
            _Choice(
              label: o['label'] as String,
              selected: _chosen.contains(o['id']),
              multiple: multiple,
              onTap: () => setState(() {
                final id = o['id'] as String;
                if (multiple) {
                  _chosen.contains(id) ? _chosen.remove(id) : _chosen.add(id);
                } else {
                  _chosen
                    ..clear()
                    ..add(id);
                }
              }),
            )
          else
            _ResultRow(label: o['label'] as String, mine: mine.contains(o['id']), votes: showsResults ? o['votes'] as int : null, voters: voters),
        if (answering) ...[
          if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: ErrorBox(_error!)),
          const SizedBox(height: 10),
          MainButton(label: s.sendAnswer, busy: _busy, onPressed: _chosen.isEmpty ? null : _send),
        ] else if (mine.isNotEmpty && !showsResults)
          Padding(padding: const EdgeInsets.only(top: 6), child: Text(s.thanksAnswer, style: TextStyle(fontSize: 14, color: c.pFg, fontWeight: FontWeight.w500))),
      ]),
    );
  }
}

class _Choice extends StatelessWidget {
  const _Choice({required this.label, required this.selected, required this.multiple, required this.onTap});
  final String label;
  final bool selected;
  final bool multiple;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final icon = multiple ? (selected ? Icons.check_box : Icons.check_box_outline_blank) : (selected ? Icons.radio_button_checked : Icons.radio_button_unchecked);
    return Semantics(
      selected: selected,
      button: true,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 10),
          child: Row(children: [
            Icon(icon, color: selected ? c.primary : c.ink3),
            const SizedBox(width: 12),
            Expanded(child: Text(label, style: const TextStyle(fontSize: 15, height: 1.3))),
          ]),
        ),
      ),
    );
  }
}

class _ResultRow extends StatelessWidget {
  const _ResultRow({required this.label, required this.mine, required this.votes, required this.voters});
  final String label;
  final bool mine;
  final int? votes;
  final int voters;

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    final share = votes == null || voters == 0 ? 0.0 : votes! / voters;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          if (mine) ...[Icon(Icons.check, size: 16, color: c.pFg), const SizedBox(width: 6)],
          Expanded(child: Text(label, style: TextStyle(fontSize: 15, fontWeight: mine ? FontWeight.w600 : FontWeight.w400))),
          if (votes != null) Text(s.votesN(votes!), style: TextStyle(fontSize: 12, color: c.ink2)),
        ]),
        if (votes != null) ...[
          const SizedBox(height: 4),
          ClipRRect(borderRadius: BorderRadius.circular(3), child: LinearProgressIndicator(value: share, minHeight: 6, color: mine ? c.pFg : c.primary, backgroundColor: c.sunk)),
        ],
      ]),
    );
  }
}

class _ThreadTile extends StatelessWidget {
  const _ThreadTile({required this.thread, required this.onTap});
  final Map<String, dynamic> thread;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    final unread = thread['unread'] as int? ?? 0;
    final last = thread['last'] as Map<String, dynamic>?;
    final child = thread['student'] as Map<String, dynamic>;
    return InkWell(
      borderRadius: BorderRadius.circular(Brand.panel),
      onTap: onTap,
      child: Panel(
        child: Row(children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(s.staffName(thread['staff'] as Map<String, dynamic>), style: TextStyle(fontSize: 16, fontWeight: unread > 0 ? FontWeight.w700 : FontWeight.w600)),
              Text(s.aboutChild(child['firstName'] as String), style: TextStyle(fontSize: 12, color: c.ink3)),
              if (last != null) ...[
                const SizedBox(height: 4),
                Text(last['body'] as String, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 14, color: c.ink2)),
              ],
            ]),
          ),
          const SizedBox(width: 12),
          Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
            if (last != null) Text(timeCairo(last['createdAt'] as String), style: TextStyle(fontSize: 12, color: c.ink2)),
            if (unread > 0) ...[
              const SizedBox(height: 6),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 1),
                decoration: BoxDecoration(color: c.primary, borderRadius: BorderRadius.circular(999)),
                child: Text('$unread', style: TextStyle(color: c.onPrimary, fontSize: 11, fontWeight: FontWeight.w600)),
              ),
            ],
          ]),
        ]),
      ),
    );
  }
}

/// Who to write to about a child: their teachers, the class teacher and Student Affairs.
class NewChatScreen extends StatefulWidget {
  const NewChatScreen({super.key, required this.api, required this.data});
  final Api api;
  final HomeData data;

  @override
  State<NewChatScreen> createState() => _NewChatScreenState();
}

class _NewChatScreenState extends State<NewChatScreen> {
  late String? _childId = widget.data.childId;
  Future<Map<String, dynamic>>? _contacts;
  String? _error;

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  void _fetch() {
    final id = _childId;
    if (id != null) _contacts = widget.api.contacts(id);
  }

  Future<void> _open(Map<String, dynamic> contact) async {
    try {
      final thread = await widget.api.startThread(_childId!, contact['id'] as String);
      if (!mounted) return;
      await Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => ChatScreen(api: widget.api, data: widget.data, threadId: thread['id'] as String)));
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    final kids = widget.data.children;
    final child = widget.data.child(_childId);
    return FormPage(
      title: s.newMessage,
      sub: child == null ? null : s.contactsFor(child['firstName'] as String),
      onBack: () => Navigator.of(context).pop(),
      children: [
        if (kids.length > 1)
          ChildSwitch(
            kids: kids,
            selected: _childId,
            onPick: (id) => setState(() {
              _childId = id;
              _fetch();
            }),
          ),
        if (_error != null) ErrorBox(_error!),
        if (_contacts != null)
          FutureBuilder<Map<String, dynamic>>(
            future: _contacts,
            builder: (context, snap) {
              if (snap.hasError) return ErrorBox(snap.error.toString());
              if (!snap.hasData) return const Center(child: CircularProgressIndicator());
              final list = (snap.data!['contacts'] as List).cast<Map<String, dynamic>>();
              if (list.isEmpty) return Text(s.noContacts, style: TextStyle(color: c.ink2, fontSize: 15));
              return Column(children: [
                for (final k in list) ...[
                  InkWell(
                    borderRadius: BorderRadius.circular(Brand.panel),
                    onTap: () => _open(k),
                    child: Panel(
                      child: Row(children: [
                        Expanded(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text(k['role'] == 'SCHOOL_ADMIN' ? s.studentAffairs : s.staffName(k), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                            Text(
                              [if (k['homeroom'] == true) s.classTeacher, ...(k['subjects'] as List).cast<String>()].join(' · '),
                              style: TextStyle(fontSize: 13, color: c.ink2),
                            ),
                          ]),
                        ),
                        Icon(Icons.chevron_right, color: c.ink3),
                      ]),
                    ),
                  ),
                  const SizedBox(height: 10),
                ],
              ]);
            },
          ),
      ],
    );
  }
}

/// One conversation, live while the connection is up and refreshed every 30 seconds when it isn't.
class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key, required this.api, required this.data, required this.threadId});
  final Api api;
  final HomeData data;
  final String threadId;

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  Map<String, dynamic>? _thread;
  Map<String, dynamic>? _hours;
  List<Map<String, dynamic>> _messages = []; // oldest first
  bool _more = false;
  bool _first = true;
  String? _error;
  bool _busy = false;
  final _text = TextEditingController();
  String? _fileName;
  Uint8List? _fileBytes;
  Timer? _timer;
  final _subs = <StreamSubscription<dynamic>>[];
  final _scroll = ScrollController();

  String get _id => widget.threadId;
  String? get _me => widget.data.me['id'] as String?;

  @override
  void initState() {
    super.initState();
    _load();
    _timer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (!widget.data.chat.connected) _load();
    });
    _subs.add(widget.data.chat.messages.listen((e) {
      if (e['threadId'] != _id) return;
      final m = Map<String, dynamic>.from(e['message'] as Map);
      if (!mounted) return;
      setState(() => _merge([m]));
      if (m['senderId'] != _me) widget.api.readThread(_id).catchError((_) {});
    }));
    _subs.add(widget.data.chat.reads.listen((e) {
      if (e['threadId'] != _id || !mounted) return;
      setState(() => _messages = [for (final m in _messages) m['senderId'] == _me && m['readAt'] == null ? {...m, 'readAt': e['at']} : m]);
    }));
  }

  @override
  void dispose() {
    _timer?.cancel();
    for (final s in _subs) {
      s.cancel();
    }
    _text.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _merge(List<Map<String, dynamic>> incoming) {
    final byId = {for (final m in _messages) m['id'] as String: m};
    for (final m in incoming) {
      byId[m['id'] as String] = m;
    }
    _messages = byId.values.toList()..sort((a, b) => (a['createdAt'] as String).compareTo(b['createdAt'] as String));
  }

  Future<void> _load() async {
    try {
      if (_thread == null) {
        _thread = await widget.api.thread(_id);
        final kid = (_thread!['student'] as Map)['id'] as String;
        _hours = await widget.api.contacts(kid).then<Map<String, dynamic>?>((c) => c).catchError((_) => null);
      }
      final rows = (await widget.api.messages(_id)).cast<Map<String, dynamic>>();
      if (!mounted) return;
      setState(() {
        _merge(rows);
        if (_first) _more = rows.length == 50;
        _first = false;
        _error = null;
      });
      widget.api.readThread(_id).catchError((_) {});
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
  }

  Future<void> _older() async {
    final rows = (await widget.api.messages(_id, before: _messages.first['createdAt'] as String)).cast<Map<String, dynamic>>();
    if (!mounted) return;
    setState(() {
      _merge(rows);
      _more = rows.length == 50;
    });
  }

  Future<void> _pick() async {
    final file = await FilePicker.pickFile(type: FileType.custom, allowedExtensions: ['jpg', 'jpeg', 'png', 'webp', 'pdf']);
    if (file == null) return;
    final bytes = await file.readAsBytes();
    if (!mounted) return;
    if (bytes.length > _maxBytes) {
      setState(() => _error = S.of(context).fileTooBig);
      return;
    }
    setState(() {
      _fileName = file.name;
      _fileBytes = bytes;
    });
  }

  Future<void> _send() async {
    final body = _text.text.trim();
    if (body.isEmpty && _fileBytes == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final sent = await widget.api.sendMessage(_id, body, fileName: _fileName, fileBytes: _fileBytes);
      if (!mounted) return;
      setState(() {
        _merge([sent]);
        _text.clear();
        _fileName = null;
        _fileBytes = null;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    final t = _thread;
    final staff = t?['staff'] as Map<String, dynamic>?;
    final child = t?['student'] as Map<String, dynamic>?;
    return Scaffold(
      appBar: AppBar(
        backgroundColor: c.surface,
        surfaceTintColor: Colors.transparent,
        title: staff == null
            ? null
            : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(staff['role'] == 'SCHOOL_ADMIN' ? s.studentAffairs : s.staffName(staff), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                Text(
                  [if (child != null) s.aboutChild(child['firstName'] as String), if (_hours != null) s.officeHours(_hours!['chatFrom'] as String, _hours!['chatTo'] as String)].join(' · '),
                  style: TextStyle(fontSize: 12, color: c.ink2),
                ),
              ]),
      ),
      body: SafeArea(
        child: Column(children: [
          if (_error != null) Padding(padding: const EdgeInsets.all(12), child: ErrorBox(_error!)),
          Expanded(
            child: ListView(
              controller: _scroll,
              padding: const EdgeInsets.all(16),
              children: [
                if (_more) Center(child: TextButton(onPressed: _older, child: Text(s.earlier))),
                for (final m in _messages) _Bubble(m: m, mine: m['senderId'] == _me),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
            decoration: BoxDecoration(color: c.surface, border: Border(top: BorderSide(color: c.line))),
            child: Column(children: [
              if (_fileBytes != null)
                Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: InputChip(
                    label: Text(_fileName ?? s.attachment),
                    onDeleted: () => setState(() {
                      _fileName = null;
                      _fileBytes = null;
                    }),
                  ),
                ),
              Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
                IconButton(tooltip: s.attach, onPressed: _pick, icon: const Icon(Icons.attach_file)),
                Expanded(
                  child: TextField(
                    controller: _text,
                    minLines: 1,
                    maxLines: 5,
                    maxLength: 2000,
                    decoration: InputDecoration(hintText: s.typeMessage, counterText: ''),
                    onSubmitted: (_) => _send(),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton.filled(tooltip: s.send, onPressed: _busy ? null : _send, icon: const Icon(Icons.send)),
              ]),
            ]),
          ),
        ]),
      ),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.m, required this.mine});
  final Map<String, dynamic> m;
  final bool mine;

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    final body = m['body'] as String? ?? '';
    return Align(
      alignment: mine ? AlignmentDirectional.centerEnd : AlignmentDirectional.centerStart,
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * .78),
        decoration: BoxDecoration(
          color: mine ? c.unread : c.surface,
          borderRadius: BorderRadius.circular(Brand.radius),
          border: Border.all(color: c.line),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (body.isNotEmpty) Text(body, style: const TextStyle(fontSize: 15, height: 1.4)),
          if (m['hasFile'] == true) Text('📎 ${s.attachment}', style: TextStyle(fontSize: 13, color: c.ink2)),
          const SizedBox(height: 2),
          Text(
            '${timeCairo(m['createdAt'] as String)}${mine && m['readAt'] != null ? ' · ${s.seen}' : ''}',
            style: TextStyle(fontSize: 11, color: c.ink3),
          ),
        ]),
      ),
    );
  }
}
