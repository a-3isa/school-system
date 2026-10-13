import 'package:flutter/material.dart';

import '../api.dart';
import '../strings.dart';
import '../theme.dart';
import '../widgets.dart';
import 'home.dart';

/// Meetings with a child's teachers: the ones booked, and the free times to book.
class MeetingsScreen extends StatefulWidget {
  const MeetingsScreen({super.key, required this.api, required this.data});
  final Api api;
  final HomeData data;

  @override
  State<MeetingsScreen> createState() => _MeetingsScreenState();
}

class _MeetingsScreenState extends State<MeetingsScreen> {
  late String? _childId = widget.data.childId;
  Map<String, dynamic>? _meetings;
  String? _error;
  String? _notice;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final id = _childId;
    if (id == null) return;
    try {
      final m = await widget.api.meetings(id);
      if (mounted) {
        setState(() {
          _meetings = m;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = S.of(context).apiError(e));
    }
  }

  Future<void> _book(Map<String, dynamic> slot) async {
    final s = S.of(context);
    final note = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _BookSheet(slot: slot),
    );
    if (note == null) return;
    try {
      await widget.api.bookMeeting(_childId!, slot['id'] as String, note: note);
      if (mounted) setState(() => _notice = s.meetingBooked);
    } catch (e) {
      if (mounted) setState(() => _error = S.of(context).apiError(e));
    }
    await _load();
  }

  Future<void> _cancel(Map<String, dynamic> slot) async {
    try {
      await widget.api.cancelMeeting(slot['id'] as String);
      if (mounted) setState(() => _notice = S.of(context).meetingCancelled);
    } catch (e) {
      if (mounted) setState(() => _error = S.of(context).apiError(e));
    }
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    final kids = widget.data.children;
    final m = _meetings;
    final booked = (m?['booked'] as List?)?.cast<Map<String, dynamic>>() ?? const [];
    final teachers = (m?['teachers'] as List?)?.cast<Map<String, dynamic>>() ?? const [];
    final anyFree = teachers.any((t) => (t['slots'] as List).isNotEmpty);

    return FormPage(
      title: s.meetingsTitle,
      onBack: () => Navigator.of(context).pop(),
      children: [
        if (kids.length > 1)
          ChildSwitch(
            kids: kids,
            selected: _childId,
            onPick: (id) {
              setState(() {
                _childId = id;
                _meetings = null;
                _notice = null;
              });
              _load();
            },
          ),
        if (_notice != null) Notice(title: _notice!, fg: c.pFg, bg: c.pBg),
        if (_error != null) ErrorBox(_error!),
        if (m == null && _error == null) const Center(child: CircularProgressIndicator()),
        if (m != null) ...[
          Text(s.yourMeetings, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
          if (booked.isEmpty) Text(s.noMeetings, style: TextStyle(color: c.ink2, fontSize: 15)),
          for (final b in booked)
            Panel(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(s.dayLine(dateCairo(b['startsAt'] as String)), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                const SizedBox(height: 2),
                Text(s.meetingAt(timeCairo(b['startsAt'] as String), b['place'] as String), style: TextStyle(fontSize: 14, color: c.ink2)),
                if (b['teacher'] != null) Text(s.staffName(b['teacher'] as Map<String, dynamic>), style: TextStyle(fontSize: 14, color: c.ink2)),
                const SizedBox(height: 8),
                OutlinedButton(onPressed: () => _cancel(b), child: Text(s.cancelMeeting)),
              ]),
            ),
          const SizedBox(height: 4),
          Text(s.freeTimes, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
          if (!anyFree) Text(s.noFreeTimes, style: TextStyle(color: c.ink2, fontSize: 15)),
          for (final t in teachers)
            if ((t['slots'] as List).isNotEmpty) _TeacherSlots(teacher: t['teacher'] as Map<String, dynamic>, slots: (t['slots'] as List).cast<Map<String, dynamic>>(), onPick: _book),
        ],
      ],
    );
  }
}

/// The note and the button to book one time. It owns its text field, so nothing is used after the sheet closes.
class _BookSheet extends StatefulWidget {
  const _BookSheet({required this.slot});
  final Map<String, dynamic> slot;

  @override
  State<_BookSheet> createState() => _BookSheetState();
}

class _BookSheetState extends State<_BookSheet> {
  final _note = TextEditingController();

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final startsAt = widget.slot['startsAt'] as String;
    return Padding(
      padding: EdgeInsets.fromLTRB(24, 20, 24, 20 + MediaQuery.of(context).viewInsets.bottom),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text('${s.dayLine(dateCairo(startsAt))} · ${ltr(timeCairo(startsAt))}', style: Brand.display(context, size: 20)),
        const SizedBox(height: 12),
        TextField(controller: _note, maxLength: 300, decoration: InputDecoration(labelText: s.meetingNote)),
        const SizedBox(height: 8),
        MainButton(label: s.bookThis, onPressed: () => Navigator.of(context).pop(_note.text)),
      ]),
    );
  }
}

class _TeacherSlots extends StatelessWidget {
  const _TeacherSlots({required this.teacher, required this.slots, required this.onPick});
  final Map<String, dynamic> teacher;
  final List<Map<String, dynamic>> slots;
  final ValueChanged<Map<String, dynamic>> onPick;

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    // Free times, one row of times for each day.
    final days = <String, List<Map<String, dynamic>>>{};
    for (final slot in slots) {
      (days[dateCairo(slot['startsAt'] as String)] ??= []).add(slot);
    }
    final subjects = [if (teacher['homeroom'] == true) s.classTeacher, ...(teacher['subjects'] as List).cast<String>()].join(' · ');
    return Panel(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(s.staffName(teacher), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
        if (subjects.isNotEmpty) Text(subjects, style: TextStyle(fontSize: 13, color: c.ink2)),
        for (final e in days.entries) ...[
          const SizedBox(height: 12),
          Text(s.dayLine(e.key), style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: c.ink2)),
          const SizedBox(height: 6),
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final slot in e.value) ActionChip(label: Text(ltr(timeCairo(slot['startsAt'] as String))), onPressed: () => onPick(slot)),
          ]),
        ],
      ]),
    );
  }
}
