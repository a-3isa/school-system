import 'package:flutter/material.dart';

import '../api.dart';
import '../strings.dart';
import '../theme.dart';
import '../widgets.dart';
import 'event.dart';
import 'home.dart';
import 'trips.dart';

/// A month of everything dated: school events, the children's trips and exams, their clubs, holidays and the break,
/// as an agenda grouped by day. With more than one child it can show one child or all of them.
class CalendarScreen extends StatefulWidget {
  const CalendarScreen({super.key, required this.api, required this.data});
  final Api api;
  final HomeData data;

  @override
  State<CalendarScreen> createState() => _CalendarScreenState();
}

class _CalendarScreenState extends State<CalendarScreen> {
  /// The first day of the month shown, YYYY-MM-DD.
  late String _month = '${todayCairo().substring(0, 7)}-01';
  /// One child, or null for all of them.
  String? _childId;
  Map<String, dynamic>? _calendar;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  String _shift(int months) {
    final d = DateTime.parse(_month);
    final m = DateTime(d.year, d.month + months, 1);
    return '${m.year}-${m.month.toString().padLeft(2, '0')}-01';
  }

  Future<void> _load() async {
    final month = _month;
    final child = _childId;
    final d = DateTime.parse(month);
    final last = DateTime(d.year, d.month + 1, 0).day;
    try {
      final cal = await widget.api.calendar(month, '${month.substring(0, 8)}${last.toString().padLeft(2, '0')}', childId: child);
      if (!mounted || month != _month || child != _childId) return;
      setState(() {
        _calendar = cal;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() => _error = S.of(context).apiError(e));
    }
  }

  void _go(int months) {
    setState(() {
      _month = _shift(months);
      _calendar = null;
    });
    _load();
  }

  void _tap(Map<String, dynamic> item) {
    final nav = Navigator.of(context);
    switch (item['kind']) {
      case 'EVENT':
        nav.push(MaterialPageRoute(builder: (_) => EventScreen(api: widget.api, eventId: item['id'] as String)));
      case 'TRIP' when widget.data.has('activities', 'trips'):
        nav.push(MaterialPageRoute(builder: (_) => TripsScreen(api: widget.api, data: widget.data, openTripId: item['id'] as String)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    final kids = widget.data.children;
    final items = ((_calendar?['items'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final days = <String, List<Map<String, dynamic>>>{};
    for (final i in items) {
      days.putIfAbsent(i['date'] as String, () => []).add(i);
    }
    final isRtl = Directionality.of(context) == TextDirection.rtl;

    return FormPage(
      title: s.calendarTitle,
      sub: s.calendarSub,
      onBack: () => Navigator.of(context).pop(),
      children: [
        if (kids.length > 1) ...[
          ChildSwitch(
            kids: [
              {'id': '', 'firstName': s.allChildren, 'class': null},
              ...kids,
            ],
            selected: _childId ?? '',
            onPick: (id) {
              setState(() {
                _childId = id.isEmpty ? null : id;
                _calendar = null;
              });
              _load();
            },
          ),
          const SizedBox(height: 14),
        ],
        Row(children: [
          IconButton(tooltip: s.previousMonth, onPressed: () => _go(-1), icon: Icon(isRtl ? Icons.chevron_right : Icons.chevron_left)),
          Expanded(child: Text(s.monthYear(_month), textAlign: TextAlign.center, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600))),
          IconButton(tooltip: s.nextMonth, onPressed: () => _go(1), icon: Icon(isRtl ? Icons.chevron_left : Icons.chevron_right)),
        ]),
        const SizedBox(height: 8),
        if (_error != null) ErrorBox(_error!),
        if (_calendar == null && _error == null) const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator())),
        if (_calendar != null && items.isEmpty) EmptyState(icon: Icons.calendar_month_outlined, title: s.nothingPlanned),
        for (final entry in days.entries) ...[
          Padding(padding: const EdgeInsets.only(top: 10, bottom: 6), child: Text(s.dayLine(entry.key), style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: c.ink2))),
          Panel(
            padding: EdgeInsets.zero,
            child: Column(children: [
              for (final (i, item) in entry.value.indexed)
                _Item(
                  item: item,
                  first: i == 0,
                  child: item['studentId'] != null && _childId == null && kids.length > 1 ? (widget.data.child(item['studentId'] as String?)?['firstName'] as String?) : null,
                  onTap: () => _tap(item),
                ),
            ]),
          ),
        ],
      ],
    );
  }
}

class _Item extends StatelessWidget {
  const _Item({required this.item, required this.first, required this.child, required this.onTap});
  final Map<String, dynamic> item;
  final bool first;
  final String? child;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    final kind = item['kind'] as String;
    // Each kind has a glyph as well as a colour, so it reads without colour.
    final (glyph, fg) = switch (kind) {
      'EVENT' => ('★', c.eFg),
      'TRIP' => ('↗', c.tFg),
      'EXAM' => ('✎', c.lFg),
      'CLUB' => ('●', c.pFg),
      _ => ('○', c.ink3),
    };
    final muted = kind == 'HOLIDAY' || kind == 'BREAK';
    final title = s.isAr && (item['titleAr'] as String?)?.isNotEmpty == true ? item['titleAr'] as String : item['title'] as String;
    final start = item['start'] as String?;
    final end = item['end'] as String?;
    final until = item['until'] as String?;
    final when = start != null ? ltr(end != null ? '$start–$end' : start) : until != null ? s.untilDate(until) : (kind == 'EVENT' ? s.allDayLabel : null);
    final tappable = kind == 'EVENT' || kind == 'TRIP';

    return Semantics(
      label: '${s.calendarKind(kind)}: $title',
      button: tappable,
      child: InkWell(
        onTap: tappable ? onTap : null,
        child: Container(
          constraints: const BoxConstraints(minHeight: 52),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: first ? null : BoxDecoration(border: Border(top: BorderSide(color: c.line))),
          child: Row(children: [
            ExcludeSemantics(child: SizedBox(width: 24, child: Text(glyph, style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: fg)))),
            const SizedBox(width: 8),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(title, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: muted ? c.ink2 : c.ink)),
                if (when != null || child != null)
                  Text([if (when != null) when, if (child != null) child].join(' · '), style: TextStyle(fontSize: 13, color: c.ink2)),
              ]),
            ),
            if (tappable) Icon(Icons.chevron_right, color: c.ink3),
          ]),
        ),
      ),
    );
  }
}
