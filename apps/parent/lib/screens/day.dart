import 'dart:async';

import 'package:flutter/material.dart';

import '../api.dart';
import '../strings.dart';
import '../theme.dart';
import '../widgets.dart';
import 'home.dart';

/// The selected child's day at a glance: when they came in, where they are
/// now, and each lesson with its attendance.
class DayTab extends StatefulWidget {
  const DayTab({super.key, required this.api, required this.data});
  final Api api;
  final HomeData data;

  @override
  State<DayTab> createState() => _DayTabState();
}

class _DayTabState extends State<DayTab> {
  String? _childId;
  Map<String, dynamic>? _day;
  String? _error;
  DateTime? _loadedAt;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    widget.data.addListener(_childrenChanged);
    _childrenChanged();
    _timer = Timer.periodic(const Duration(seconds: 30), (_) => _load());
  }

  @override
  void dispose() {
    widget.data.removeListener(_childrenChanged);
    _timer?.cancel();
    super.dispose();
  }

  void _childrenChanged() {
    final kids = widget.data.children;
    if (_childId == null && kids.isNotEmpty) {
      _childId = kids.first['id'] as String;
      _load();
    }
  }

  Future<void> _load() async {
    final id = _childId;
    if (id == null) return widget.data.load();
    try {
      final day = await widget.api.childToday(id, todayCairo());
      if (!mounted || id != _childId) return;
      setState(() {
        _day = day;
        _error = null;
        _loadedAt = DateTime.now();
      });
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
  }

  void _pick(String id) {
    if (id == _childId) return;
    setState(() {
      _childId = id;
      _day = null;
    });
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    final data = widget.data;
    final kids = data.children;

    if (!data.loaded) return const Center(child: CircularProgressIndicator());

    return RefreshIndicator(
      color: c.primary,
      onRefresh: () async {
        await data.load();
        await _load();
      },
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 10, 20, 24),
        children: [
          Row(children: [
            Expanded(child: Text(s.dayLine(todayCairo()), style: TextStyle(fontSize: 13, color: c.ink2))),
            if (_loadedAt != null) _Updated(at: _loadedAt!),
          ]),
          const SizedBox(height: 14),
          if (data.error != null && kids.isEmpty) ErrorBox(s.offline),
          if (kids.isEmpty && data.error == null) Padding(padding: const EdgeInsets.only(top: 24), child: Text(s.noChildren, style: TextStyle(color: c.ink2, fontSize: 15, height: 1.5))),
          if (kids.length > 1) ...[_ChildSwitch(kids: kids, selected: _childId, onPick: _pick), const SizedBox(height: 14)],
          if (kids.length == 1) ...[
            Text('${kids.first['firstName']}', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600)),
            if (kids.first['class']?['name'] != null) Text(ltr(kids.first['class']['name'] as String), style: TextStyle(fontSize: 13, color: c.ink2)),
            const SizedBox(height: 14),
          ],
          if (_error != null) ...[ErrorBox(_error!), const SizedBox(height: 14)],
          if (_day == null && kids.isNotEmpty && _error == null) const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator())),
          if (_day != null) ..._dayView(context, _day!),
        ],
      ),
    );
  }

  List<Widget> _dayView(BuildContext context, Map<String, dynamic> day) {
    final s = S.of(context);
    final c = context.c;
    final arrived = day['arrivedAt'] as String?;
    final left = day['leftAt'] as String?;
    final place = day['place'] as Map<String, dynamic>?;
    final lessons = (day['lessons'] as List).cast<Map<String, dynamic>>();
    final now = nowCairo();
    Map<String, dynamic>? current;
    for (final l in lessons) {
      if ((l['startTime'] as String).compareTo(now) <= 0 && now.compareTo(l['endTime'] as String) < 0) current = l;
    }
    final currentSubject = current?['subject'] as String?;
    final inCurrent = place != null && currentSubject != null && current?['room'] == place['name'];

    return [
      Semantics(
        container: true,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(arrived != null ? s.arrived : s.notArrived, style: TextStyle(fontSize: 13, color: c.ink2)),
          const SizedBox(height: 4),
          Text(arrived != null ? timeCairo(arrived) : '—',
              style: const TextStyle(fontSize: 34, fontWeight: FontWeight.w600, height: 1.05, letterSpacing: -.3, fontFeatures: [FontFeature.tabularFigures()])),
          if (arrived != null) ...[const SizedBox(height: 4), Text(s.throughGate, style: TextStyle(fontSize: 14, color: c.ink2))],
          if (left != null) ...[const SizedBox(height: 6), Text(s.leftAt(timeCairo(left)), style: TextStyle(fontSize: 14, color: c.lFg, fontWeight: FontWeight.w600))],
        ]),
      ),
      if (place != null) ...[
        const SizedBox(height: 14),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(color: c.pBg, borderRadius: BorderRadius.circular(10)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(inCurrent ? s.nowInLesson(currentSubject, place['name'] as String) : s.nowIn(place['name'] as String),
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: c.pFg)),
            const SizedBox(height: 3),
            Text(s.heardAt(timeCairo(place['heardAt'] as String)), style: TextStyle(fontSize: 13, height: 1.45, color: c.pFg)),
          ]),
        ),
      ],
      const SizedBox(height: 18),
      Text(s.lessons, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: c.ink2)),
      const SizedBox(height: 8),
      if (lessons.isEmpty) Text(s.noLessons, style: TextStyle(color: c.ink2)),
      for (final l in lessons) _LessonRow(lesson: l, now: now, current: identical(l, current), inRoom: inCurrent && identical(l, current)),
    ];
  }
}

class _LessonRow extends StatelessWidget {
  const _LessonRow({required this.lesson, required this.now, required this.current, required this.inRoom});
  final Map<String, dynamic> lesson;
  final String now;
  final bool current;
  final bool inRoom;

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    final status = lesson['status'] as String?;
    final later = status == null && (lesson['startTime'] as String).compareTo(now) > 0;
    final Widget pill;
    if (status != null) {
      final st = c.status(status);
      pill = StatusPill(label: s.status(status), fg: st.fg, bg: st.bg, glyph: st.glyph);
    } else if (current) {
      pill = inRoom
          ? StatusPill(label: s.inLesson, fg: c.pFg, bg: c.pBg, glyph: '✓')
          : StatusPill(label: s.now, fg: c.primary, bg: c.unread, glyph: '•');
    } else if (later) {
      pill = StatusPill(label: s.later, fg: c.ink3, bg: Colors.transparent, glyph: '·', dashed: true);
    } else {
      pill = StatusPill(label: s.notMarked, fg: c.ink3, bg: Colors.transparent, glyph: '·', dashed: true);
    }
    final subject = lesson['subject'] as String? ?? s.period(lesson['period'] as int);
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 8),
      decoration: BoxDecoration(border: Border(top: BorderSide(color: c.line))),
      child: Row(children: [
        SizedBox(
          width: 44,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(s.p(lesson['period'] as int), style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700)),
            Text(lesson['startTime'] as String, style: TextStyle(fontSize: 11, color: c.ink3, fontFeatures: const [FontFeature.tabularFigures()])),
          ]),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(subject, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: later ? c.ink2 : c.ink)),
            if (lesson['room'] != null) Text(lesson['room'] as String, style: TextStyle(fontSize: 12, color: c.ink2)),
          ]),
        ),
        const SizedBox(width: 12),
        pill,
      ]),
    );
  }
}

/// Two children side by side; the chosen one is raised.
class _ChildSwitch extends StatelessWidget {
  const _ChildSwitch({required this.kids, required this.selected, required this.onPick});
  final List<Map<String, dynamic>> kids;
  final String? selected;
  final ValueChanged<String> onPick;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(color: c.sunk, borderRadius: BorderRadius.circular(10)),
      child: Row(children: [
        for (final k in kids)
          Expanded(
            child: Semantics(
              selected: k['id'] == selected,
              button: true,
              child: GestureDetector(
                onTap: () => onPick(k['id'] as String),
                child: Container(
                  constraints: const BoxConstraints(minHeight: 48),
                  margin: const EdgeInsets.symmetric(horizontal: 2),
                  decoration: k['id'] == selected
                      ? BoxDecoration(color: c.surface, borderRadius: BorderRadius.circular(7), border: Border.all(color: c.line))
                      : null,
                  alignment: Alignment.center,
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                    Text(k['firstName'] as String,
                        style: TextStyle(fontSize: 15, fontWeight: k['id'] == selected ? FontWeight.w600 : FontWeight.w500, color: k['id'] == selected ? c.ink : c.ink2)),
                    if (k['class']?['name'] != null) Text(ltr(k['class']['name'] as String), style: TextStyle(fontSize: 11, color: c.ink2)),
                  ]),
                ),
              ),
            ),
          ),
      ]),
    );
  }
}

/// "Updated just now", quietly, without moving anything.
class _Updated extends StatefulWidget {
  const _Updated({required this.at});
  final DateTime at;

  @override
  State<_Updated> createState() => _UpdatedState();
}

class _UpdatedState extends State<_Updated> {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 30), (_) => setState(() {}));
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    final min = DateTime.now().difference(widget.at).inMinutes;
    return Row(mainAxisSize: MainAxisSize.min, children: [
      Container(width: 6, height: 6, decoration: BoxDecoration(color: c.pFg, shape: BoxShape.circle)),
      const SizedBox(width: 6),
      Text(min < 1 ? s.justNow : s.minutesAgo(min), style: TextStyle(fontSize: 12, color: c.ink3)),
    ]);
  }
}
