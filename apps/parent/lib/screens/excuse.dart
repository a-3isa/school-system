import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../api.dart';
import '../strings.dart';
import '../theme.dart';
import '../widgets.dart';

const _reasons = ['SICK', 'APPOINTMENT', 'FAMILY', 'OTHER'];

String _iso(DateTime d) => '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
DateTime _parse(String d) => DateTime(int.parse(d.substring(0, 4)), int.parse(d.substring(5, 7)), int.parse(d.substring(8, 10)));

/// The excuses a parent sent for one child, with what the school decided, and a button for a new one.
class ExcusesScreen extends StatefulWidget {
  const ExcusesScreen({super.key, required this.api, required this.child});
  final Api api;
  final Map<String, dynamic> child;

  @override
  State<ExcusesScreen> createState() => _ExcusesScreenState();
}

class _ExcusesScreenState extends State<ExcusesScreen> {
  List<Map<String, dynamic>>? _items;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final items = (await widget.api.excuses(widget.child['id'] as String)).cast<Map<String, dynamic>>();
      if (mounted) setState(() => _items = items);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
  }

  Future<void> _new() async {
    final sent = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => ExcuseScreen(api: widget.api, child: widget.child)));
    if (sent == true) await _load();
  }

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    final items = _items;
    return FormPage(
      title: s.excusesTitle,
      sub: s.excusesSub,
      onBack: () => Navigator.of(context).pop(),
      children: [
        MainButton(label: s.newExcuse, onPressed: _new),
        if (_error != null) ErrorBox(_error!),
        if (items == null && _error == null) const Center(child: CircularProgressIndicator()),
        if (items != null && items.isEmpty) Text(s.noExcuses, style: TextStyle(color: c.ink2, fontSize: 15)),
        if (items != null)
          for (final e in items) _ExcuseCard(excuse: e),
      ],
    );
  }
}

class _ExcuseCard extends StatelessWidget {
  const _ExcuseCard({required this.excuse});
  final Map<String, dynamic> excuse;

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    final status = excuse['status'] as String;
    final (fg, bg, glyph) = switch (status) {
      'APPROVED' => (c.pFg, c.pBg, '✓'),
      'REJECTED' => (c.aFg, c.aBg, '×'),
      _ => (c.eFg, c.eBg, '·'),
    };
    final note = excuse['note'] as String?;
    final decision = excuse['decisionNote'] as String?;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: c.surface, borderRadius: BorderRadius.circular(Brand.radius), border: Border.all(color: c.line)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text(s.excuseDays((excuse['fromDate'] as String).substring(0, 10), (excuse['toDate'] as String).substring(0, 10)), style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600))),
          StatusPill(label: s.excuseStatus(status), fg: fg, bg: bg, glyph: glyph),
        ]),
        const SizedBox(height: 6),
        Text(s.reason(excuse['reason'] as String), style: TextStyle(fontSize: 13, color: c.ink2)),
        if (note != null && note.isNotEmpty) ...[const SizedBox(height: 6), Text(note, style: const TextStyle(fontSize: 14, height: 1.4))],
        if (decision != null && decision.isNotEmpty) ...[
          const SizedBox(height: 8),
          Text(decision, style: TextStyle(fontSize: 14, height: 1.4, color: status == 'REJECTED' ? c.aFg : c.pFg, fontWeight: FontWeight.w500)),
        ],
      ]),
    );
  }
}

/// Writing an excuse: which days, why, a note, and an optional photo or PDF.
class ExcuseScreen extends StatefulWidget {
  const ExcuseScreen({super.key, required this.api, required this.child, this.date});
  final Api api;
  final Map<String, dynamic> child;
  /// The day to start from (today when the parent answers the "didn't come" question).
  final String? date;

  @override
  State<ExcuseScreen> createState() => _ExcuseScreenState();
}

class _ExcuseScreenState extends State<ExcuseScreen> {
  late String _from = widget.date ?? todayCairo();
  late String _to = widget.date ?? todayCairo();
  String _reason = 'SICK';
  final _note = TextEditingController();
  String? _fileName;
  Uint8List? _fileBytes;
  bool _busy = false;
  bool _sent = false;
  String? _error;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _pickDay(bool first) async {
    final today = _parse(todayCairo());
    final picked = await showDatePicker(
      context: context,
      initialDate: _parse(first ? _from : _to),
      firstDate: today.subtract(const Duration(days: 7)),
      lastDate: today.add(const Duration(days: 30)),
    );
    if (picked == null) return;
    setState(() {
      if (first) {
        _from = _iso(picked);
        if (_to.compareTo(_from) < 0) _to = _from;
      } else {
        _to = _iso(picked);
        if (_to.compareTo(_from) < 0) _from = _to;
      }
    });
  }

  Future<void> _pickFile() async {
    final file = await FilePicker.pickFile(type: FileType.custom, allowedExtensions: ['jpg', 'jpeg', 'png', 'webp', 'pdf']);
    if (file == null) return;
    final bytes = await file.readAsBytes();
    if (!mounted) return;
    setState(() {
      _fileName = file.name;
      _fileBytes = bytes;
    });
  }

  Future<void> _send() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.api.sendExcuse(widget.child['id'] as String, from: _from, to: _to, reason: _reason, note: _note.text, fileName: _fileName, fileBytes: _fileBytes);
      if (mounted) setState(() => _sent = true);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    if (_sent) {
      return FormPage(
        title: s.excuseSent,
        sub: s.excuseSentSub,
        children: [MainButton(label: s.done, onPressed: () => Navigator.of(context).pop(true))],
      );
    }
    Widget day(String label, String value, bool first) => Expanded(
          child: Labeled(
            label: label,
            child: OutlinedButton(
              onPressed: () => _pickDay(first),
              style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48), alignment: AlignmentDirectional.centerStart),
              child: Text(s.dayMonth(value)),
            ),
          ),
        );
    return FormPage(
      title: s.sendExcuse,
      sub: s.excuseFor(widget.child['firstName'] as String),
      onBack: () => Navigator.of(context).pop(false),
      children: [
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [day(s.fromDay, _from, true), const SizedBox(width: 12), day(s.toDay, _to, false)]),
        Text(s.excuseWindow, style: TextStyle(fontSize: 13, color: c.ink3, height: 1.45)),
        Labeled(
          label: s.reasonLabel,
          child: Wrap(spacing: 8, runSpacing: 8, children: [
            for (final r in _reasons) ChoiceChip(label: Text(s.reason(r)), selected: _reason == r, onSelected: (_) => setState(() => _reason = r)),
          ]),
        ),
        Labeled(
          label: s.noteLabel,
          help: s.noteHelp,
          child: TextField(controller: _note, maxLines: 3, maxLength: 1000, decoration: const InputDecoration(counterText: '')),
        ),
        Labeled(
          label: s.attach,
          help: s.attachHelp,
          child: Row(children: [
            Expanded(child: OutlinedButton(onPressed: _pickFile, child: Text(_fileName ?? s.attach, overflow: TextOverflow.ellipsis))),
            if (_fileName != null) TextButton(
              onPressed: () => setState(() {
                _fileName = null;
                _fileBytes = null;
              }),
              child: Text(s.removeFile),
            ),
          ]),
        ),
        if (_error != null) ErrorBox(_error!),
        MainButton(label: s.sendIt, busy: _busy, onPressed: _send),
      ],
    );
  }
}
