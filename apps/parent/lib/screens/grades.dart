import 'package:flutter/material.dart';

import '../api.dart';
import '../strings.dart';
import '../theme.dart';
import '../widgets.dart';
import 'home.dart';
import 'report_card.dart';

/// A child's marks: the overall result, each subject with its progress line,
/// the exams coming up and the report cards the school has published.
class GradesScreen extends StatefulWidget {
  const GradesScreen({super.key, required this.api, required this.data});
  final Api api;
  final HomeData data;

  @override
  State<GradesScreen> createState() => _GradesScreenState();
}

class _GradesScreenState extends State<GradesScreen> {
  late String? _childId = widget.data.childId;
  int? _term;
  Map<String, dynamic>? _grades;
  List<Map<String, dynamic>> _exams = const [];
  List<Map<String, dynamic>> _cards = const [];
  final Map<String, List<Map<String, dynamic>>> _trend = {};
  String? _error;
  // A reply that arrives after the parent has moved on is dropped.
  int _round = 0;

  @override
  void initState() {
    super.initState();
    _loadAll();
  }

  /// Marks, then the progress lines, for the chosen child and term.
  Future<void> _loadGrades() async {
    final id = _childId;
    if (id == null) return;
    final round = ++_round;
    try {
      final g = await widget.api.grades(id, _term);
      if (!mounted || round != _round) return;
      setState(() {
        _grades = g;
        _error = null;
      });
      for (final sub in (g['subjects'] as List).cast<Map<String, dynamic>>()) {
        widget.api.gradeTrend(id, sub['subjectId'] as String).then((points) {
          if (mounted && round == _round) setState(() => _trend[sub['subjectId'] as String] = points);
        }).catchError((_) {}); // a missing line is not worth an error
      }
    } catch (e) {
      if (mounted && round == _round) setState(() => _error = S.of(context).apiError(e));
    }
  }

  /// Everything for a child: the marks, the exam list and the report cards.
  Future<void> _loadAll() async {
    final id = _childId;
    if (id == null) return;
    await _loadGrades();
    try {
      final exams = await widget.api.exams(id);
      if (mounted && id == _childId) setState(() => _exams = exams);
    } catch (_) {}
    if (!widget.data.has('academics', 'reportCards')) return;
    try {
      final cards = await widget.api.reportCards(id);
      if (mounted && id == _childId) setState(() => _cards = cards);
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    final kids = widget.data.children;
    final g = _grades;
    final subjects = (g?['subjects'] as List?)?.cast<Map<String, dynamic>>() ?? const [];
    final overall = (g?['overall'] as Map?)?.cast<String, dynamic>();
    final term = _term ?? (g?['term'] as int?) ?? 1;
    final gender = widget.data.child(_childId)?['gender'] as String?;

    return FormPage(
      title: s.gradesTitle,
      sub: s.gradesSub,
      onBack: () => Navigator.of(context).pop(),
      children: [
        if (kids.length > 1)
          ChildSwitch(
            kids: kids,
            selected: _childId,
            onPick: (id) {
              setState(() {
                _childId = id;
                _term = null;
                _grades = null;
                _exams = const [];
                _cards = const [];
                _trend.clear();
              });
              _loadAll();
            },
          ),
        SegmentedButton<int>(
          segments: [ButtonSegment(value: 1, label: Text(s.termShort(1))), ButtonSegment(value: 2, label: Text(s.termShort(2)))],
          selected: {term},
          showSelectedIcon: false,
          onSelectionChanged: (v) {
            setState(() {
              _term = v.first;
              _grades = null;
              _trend.clear();
            });
            _loadGrades();
          },
        ),
        if (_error != null) ErrorBox(_error!),
        if (g == null && _error == null) const Center(child: CircularProgressIndicator()),
        if (g != null) ...[
          if (subjects.isEmpty)
            Panel(child: Text(s.noGrades, style: TextStyle(color: c.ink2, fontSize: 15, height: 1.5)))
          else ...[
            _OverallCard(overall: overall),
            for (final sub in subjects) _SubjectCard(key: ValueKey(sub['subjectId']), subject: sub, trend: _trend[sub['subjectId']]),
          ],
        ],
        _Section(title: s.upcomingExams, child: _exams.isEmpty ? Text(s.noUpcomingExams, style: TextStyle(color: c.ink2, fontSize: 15)) : Column(children: [for (final e in _exams) _ExamRow(exam: e)])),
        if (widget.data.has('academics', 'reportCards'))
          _Section(
            title: s.reportCardsTitle,
            child: _cards.isEmpty
                ? Text(s.noReportCards, style: TextStyle(color: c.ink2, fontSize: 15))
                : Column(children: [
                    for (final card in _cards)
                      Material(
                        type: MaterialType.transparency,
                        child: ListTile(
                          contentPadding: EdgeInsets.zero,
                          title: Text(s.reportCardFor(card['term'] as int, card['year'] as String? ?? ''), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                          subtitle: card['overall'] != null && card['overall']['percent'] != null
                              ? Text('${s.pct(card['overall']['percent'] as num)} · ${s.bandName((card['overall']['band'] as Map?)?.cast<String, dynamic>())}')
                              : null,
                          trailing: Icon(Icons.chevron_right, color: c.ink3),
                          onTap: () => Navigator.of(context).push(MaterialPageRoute(
                            builder: (_) => ReportCardScreen(api: widget.api, data: widget.data, childId: _childId!, cardId: card['id'] as String, gender: gender),
                          )),
                        ),
                      ),
                  ]),
          ),
      ],
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.child});
  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
      const SizedBox(height: 8),
      Panel(child: SizedBox(width: double.infinity, child: child)),
    ]);
  }
}

/// A band's name in a small tinted label.
class _BandChip extends StatelessWidget {
  const _BandChip(this.band);
  final Map<String, dynamic>? band;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: c.eBg, borderRadius: BorderRadius.circular(4)),
      child: Text(S.of(context).bandName(band), style: TextStyle(color: c.eFg, fontSize: 13, fontWeight: FontWeight.w600)),
    );
  }
}

class _OverallCard extends StatelessWidget {
  const _OverallCard({required this.overall});
  final Map<String, dynamic>? overall;

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    final p = overall?['percent'] as num?;
    final gpa = overall?['gpa'] as num?;
    return Panel(
      child: Semantics(
        container: true,
        label: '${s.overallGrade}: ${p == null ? s.noMarkYet : s.pct(p)}',
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(s.overallGrade, style: TextStyle(fontSize: 13, color: c.ink2, fontWeight: FontWeight.w600)),
          const SizedBox(height: 4),
          Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
            Text(p == null ? '—' : s.pct(p), textDirection: TextDirection.ltr, style: Brand.display(context, size: 36, weight: FontWeight.w700)),
            const SizedBox(width: 12),
            if (p != null) _BandChip((overall?['band'] as Map?)?.cast<String, dynamic>()),
          ]),
          if (gpa != null) ...[const SizedBox(height: 4), Text(s.gpa(gpa), style: TextStyle(fontSize: 14, color: c.ink2))],
        ]),
      ),
    );
  }
}

/// One subject: its percentage and band, a progress line over the year, and (on a tap) each published mark.
class _SubjectCard extends StatefulWidget {
  const _SubjectCard({super.key, required this.subject, required this.trend});
  final Map<String, dynamic> subject;
  final List<Map<String, dynamic>>? trend;

  @override
  State<_SubjectCard> createState() => _SubjectCardState();
}

class _SubjectCardState extends State<_SubjectCard> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    final sub = widget.subject;
    final p = sub['percent'] as num?;
    final assessments = (sub['assessments'] as List).cast<Map<String, dynamic>>();
    final points = widget.trend;
    return Panel(
      padding: EdgeInsets.zero,
      child: InkWell(
        borderRadius: BorderRadius.circular(Brand.panel),
        onTap: () => setState(() => _open = !_open),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(child: Text(s.subjectName(sub), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600))),
              Text(p == null ? '—' : s.pct(p), textDirection: TextDirection.ltr, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
              const SizedBox(width: 8),
              if (p != null) _BandChip((sub['band'] as Map?)?.cast<String, dynamic>()),
              Icon(_open ? Icons.expand_less : Icons.expand_more, color: c.ink3),
            ]),
            const SizedBox(height: 10),
            if (points != null && points.length >= 2)
              Semantics(
                label: '${s.progressLine}: ${points.map((e) => s.pct(e['percent'] as num)).join(', ')}',
                excludeSemantics: true,
                child: SizedBox(height: 44, width: double.infinity, child: CustomPaint(painter: _TrendPainter([for (final e in points) (e['percent'] as num).toDouble()], c.primary, c.line))),
              )
            else
              Text(s.noTrend, style: TextStyle(fontSize: 12, color: c.ink3)),
            if (_open) ...[
              const SizedBox(height: 10),
              for (final a in assessments) _AssessmentRow(a: a),
            ],
          ]),
        ),
      ),
    );
  }
}

class _AssessmentRow extends StatelessWidget {
  const _AssessmentRow({required this.a});
  final Map<String, dynamic> a;

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    final absent = a['absent'] == true;
    final excused = a['excused'] == true;
    final comment = a['comment'] as String?;
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 8),
      decoration: BoxDecoration(border: Border(top: BorderSide(color: c.line))),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text(a['title'] as String, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500))),
          if (absent)
            Text(excused ? '– ${s.status('EXCUSED')}' : '✕ ${s.status('ABSENT')}', style: TextStyle(fontSize: 14, color: excused ? c.eFg : c.aFg, fontWeight: FontWeight.w600))
          else if (a['score'] != null)
            Text(s.scoreOf(a['score'] as num, a['maxScore'] as num), textDirection: TextDirection.ltr, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
        ]),
        Text('${s.assessmentKind(a['kind'] as String)} · ${s.dayMonth(a['date'] as String)}', style: TextStyle(fontSize: 13, color: c.ink2)),
        if (comment != null && comment.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 4), child: Text(comment, style: TextStyle(fontSize: 14, color: c.ink2, height: 1.4))),
      ]),
    );
  }
}

class _ExamRow extends StatelessWidget {
  const _ExamRow({required this.exam});
  final Map<String, dynamic> exam;

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    final room = exam['room'] as String?;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('${s.subjectName(exam, name: 'subject', nameAr: 'subjectAr')} · ${s.assessmentKind(exam['kind'] as String)}', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
        const SizedBox(height: 2),
        Text(s.dayLine(exam['date'] as String), style: TextStyle(fontSize: 14, color: c.ink2)),
        Text('${ltr('${exam['startTime']}–${exam['endTime']}')}${room != null ? ' · $room' : ''}', style: TextStyle(fontSize: 14, color: c.ink2)),
      ]),
    );
  }
}

/// A thin line through each mark, with a dot on every mark. The height fits the range of the marks (at least 20 points), so a small change still shows.
class _TrendPainter extends CustomPainter {
  _TrendPainter(this.values, this.stroke, this.hairline);
  final List<double> values;
  final Color stroke, hairline;

  @override
  void paint(Canvas canvas, Size size) {
    const pad = 5.0;
    final w = size.width - pad * 2;
    final h = size.height - pad * 2;
    canvas.drawLine(Offset(0, size.height - 0.5), Offset(size.width, size.height - 0.5), Paint()..color = hairline..strokeWidth = 1);
    var lo = values.reduce((a, b) => a < b ? a : b) - 8;
    var hi = values.reduce((a, b) => a > b ? a : b) + 8;
    if (hi - lo < 20) {
      final mid = (hi + lo) / 2;
      lo = mid - 10;
      hi = mid + 10;
    }
    Offset at(int i) => Offset(pad + w * i / (values.length - 1), pad + h * (1 - (values[i] - lo) / (hi - lo)));
    final path = Path()..moveTo(at(0).dx, at(0).dy);
    for (var i = 1; i < values.length; i++) {
      path.lineTo(at(i).dx, at(i).dy);
    }
    canvas.drawPath(path, Paint()..color = stroke..style = PaintingStyle.stroke..strokeWidth = 1.6..strokeJoin = StrokeJoin.round);
    final dot = Paint()..color = stroke;
    for (var i = 0; i < values.length; i++) {
      canvas.drawCircle(at(i), 3, dot);
    }
  }

  @override
  bool shouldRepaint(_TrendPainter old) => old.values != values || old.stroke != stroke;
}
