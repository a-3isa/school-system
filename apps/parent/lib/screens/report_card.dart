import 'package:flutter/material.dart';

import '../api.dart';
import '../strings.dart';
import '../theme.dart';
import '../widgets.dart';
import 'home.dart';

/// A published report card, laid out like the page the school prints: the crest,
/// the student, a row for each subject, the overall result, attendance and comments.
class ReportCardScreen extends StatefulWidget {
  const ReportCardScreen({super.key, required this.api, required this.data, required this.childId, required this.cardId, this.gender});
  final Api api;
  final HomeData data;
  final String childId;
  final String cardId;
  final String? gender;

  @override
  State<ReportCardScreen> createState() => _ReportCardScreenState();
}

class _ReportCardScreenState extends State<ReportCardScreen> {
  Map<String, dynamic>? _card;
  String? _error;

  @override
  void initState() {
    super.initState();
    widget.api.reportCard(widget.childId, widget.cardId).then((c) {
      if (mounted) setState(() => _card = c);
    }).catchError((Object e) {
      if (mounted) setState(() => _error = S.of(context).apiError(e));
    });
  }

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    final snap = (_card?['snapshot'] as Map?)?.cast<String, dynamic>();

    return FormPage(
      title: s.reportCard,
      sub: snap == null ? null : s.reportCardFor(snap['term'] as int, (snap['year'] as Map)['name'] as String),
      onBack: () => Navigator.of(context).pop(),
      children: [
        if (_error != null) ErrorBox(_error!),
        if (snap == null && _error == null) const Center(child: CircularProgressIndicator()),
        if (snap != null) ..._sheet(context, s, c, snap),
      ],
    );
  }

  List<Widget> _sheet(BuildContext context, S s, Palette c, Map<String, dynamic> snap) {
    final school = (snap['school'] as Map).cast<String, dynamic>();
    final student = (snap['student'] as Map).cast<String, dynamic>();
    final cls = (snap['class'] as Map).cast<String, dynamic>();
    final subjects = (snap['subjects'] as List).cast<Map<String, dynamic>>();
    final overall = (snap['overall'] as Map).cast<String, dynamic>();
    final att = (snap['attendance'] as Map).cast<String, dynamic>();
    final schoolName = (s.isAr && (school['nameAr'] as String?)?.isNotEmpty == true ? school['nameAr'] : school['name']) as String;
    final studentName = (s.isAr && (student['nameAr'] as String?)?.isNotEmpty == true ? student['nameAr'] : student['name']) as String;
    final classTeacher = snap['classTeacher'] as String?;
    final principalName = snap['principalName'] as String?;

    Widget fact(String label, String value) => SizedBox(
          width: 150,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label, style: TextStyle(fontSize: 12, color: c.ink3, fontWeight: FontWeight.w600)),
            Text(value, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
          ]),
        );

    Widget commentBox(String title, String? text, String? who) => Panel(
          child: SizedBox(
            width: double.infinity,
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(title, style: TextStyle(fontSize: 12, color: c.ink3, fontWeight: FontWeight.w600)),
              const SizedBox(height: 6),
              if (text != null && text.isNotEmpty) Text(text, style: const TextStyle(fontSize: 15, height: 1.5)),
              if (who != null && who.isNotEmpty) ...[const SizedBox(height: 10), Text(who, style: TextStyle(fontSize: 13, color: c.ink2))],
            ]),
          ),
        );

    return [
      Row(children: [
        Crest(name: schoolName, image: widget.data.crest, width: 40),
        const SizedBox(width: 12),
        Expanded(child: Text(schoolName, style: Brand.display(context, size: 19))),
      ]),
      Panel(
        child: Wrap(spacing: 16, runSpacing: 12, children: [
          fact(s.name, studentName),
          fact(s.studentIdLabel, ltr(student['code'] as String)),
          fact(s.classLabel, ltr(cls['name'] as String)),
          fact(s.yearGroupLabel, cls['gradeName'] as String),
          fact(s.yearLabel, ltr((snap['year'] as Map)['name'] as String)),
          fact(s.termLabel, s.termLong(snap['term'] as int)),
        ]),
      ),
      Panel(
        padding: EdgeInsets.zero,
        child: Column(children: [
          for (final (i, sub) in subjects.indexed)
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(border: i == 0 ? null : Border(top: BorderSide(color: c.line))),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Expanded(child: Text(s.subjectName(sub), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600))),
                  if (sub['percent'] != null) ...[
                    Text(s.pct(sub['percent'] as num), textDirection: TextDirection.ltr, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                    const SizedBox(width: 8),
                    Text(s.bandName((sub['band'] as Map?)?.cast<String, dynamic>()), style: TextStyle(fontSize: 14, color: c.eFg, fontWeight: FontWeight.w600)),
                  ] else
                    Text(s.noMarkYet, style: TextStyle(fontSize: 13, color: c.ink3)),
                ]),
                if (sub['teacher'] != null) Text(s.titledName(sub['teacher'] as String), style: TextStyle(fontSize: 13, color: c.ink2)),
                if ((sub['comment'] as String?)?.isNotEmpty == true) Padding(padding: const EdgeInsets.only(top: 6), child: Text(sub['comment'] as String, style: const TextStyle(fontSize: 14, height: 1.45))),
              ]),
            ),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(color: c.sunk, border: Border(top: BorderSide(color: c.line)), borderRadius: BorderRadius.vertical(bottom: Radius.circular(Brand.panel))),
            child: Row(children: [
              Expanded(child: Text(s.overallGrade, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700))),
              if (overall['percent'] != null) ...[
                Text(s.pct(overall['percent'] as num), textDirection: TextDirection.ltr, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                const SizedBox(width: 8),
                Text(s.bandName((overall['band'] as Map?)?.cast<String, dynamic>()), style: TextStyle(fontSize: 14, color: c.eFg, fontWeight: FontWeight.w700)),
              ],
            ]),
          ),
        ]),
      ),
      if (overall['gpa'] != null) Text(s.gpa(overall['gpa'] as num), style: TextStyle(fontSize: 14, color: c.ink2)),
      Text('${s.attendanceLine(att['days'] as int, att['absent'] as int)}\n${s.attendanceDetail(att['present'] as int, att['late'] as int, att['excused'] as int)}', style: TextStyle(fontSize: 14, color: c.ink2, height: 1.5)),
      commentBox(s.classTeacherComment, snap['classTeacherComment'] as String?, classTeacher == null ? s.classTeacherLabel : '${s.classTeacherLabel}: ${s.titledName(classTeacher)}'),
      commentBox(s.principalComment, snap['principalComment'] as String?, principalName == null ? s.principalLabel : '${s.principalLabel}: ${s.titledName(principalName)}'),
      Text(s.issuedOn((snap['issuedAt'] as String).substring(0, 10)), textAlign: TextAlign.center, style: TextStyle(fontSize: 12, color: c.ink3)),
    ];
  }
}
