import 'package:flutter/material.dart';

import '../api.dart';
import '../strings.dart';
import '../theme.dart';
import '../widgets.dart';
import 'home.dart';

/// What teachers and Student Affairs have written about a child: praise, notes to
/// follow up, and (when the school keeps them) merit points. Opening it marks the
/// notes as read, so the school can see parents have had them.
class BehaviourScreen extends StatefulWidget {
  const BehaviourScreen({super.key, required this.api, required this.data});
  final Api api;
  final HomeData data;

  @override
  State<BehaviourScreen> createState() => _BehaviourScreenState();
}

class _BehaviourScreenState extends State<BehaviourScreen> {
  late String? _childId = widget.data.childId;
  Map<String, dynamic>? _behaviour;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final id = _childId;
    if (id == null) return;
    try {
      final b = await widget.api.behaviour(id);
      if (!mounted || id != _childId) return;
      setState(() {
        _behaviour = b;
        _error = null;
      });
      // Seeing the notes is reading them. A failure (no network) isn't worth interrupting the parent for.
      for (final n in (b['notes'] as List).cast<Map<String, dynamic>>().where((n) => n['read'] != true)) {
        widget.api.readBehaviourNote(id, n['id'] as String).catchError((_) {});
      }
    } catch (e) {
      if (mounted) setState(() => _error = S.of(context).apiError(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    final kids = widget.data.children;
    final b = _behaviour;
    final notes = (b?['notes'] as List?)?.cast<Map<String, dynamic>>() ?? const [];
    final totals = (b?['totals'] as Map?)?.cast<String, dynamic>() ?? const <String, dynamic>{};
    final points = totals['points'] as int?;

    return FormPage(
      title: s.behaviourTitle,
      sub: s.behaviourThisYear,
      onBack: () => Navigator.of(context).pop(),
      children: [
        if (kids.length > 1)
          ChildSwitch(
            kids: kids,
            selected: _childId,
            onPick: (id) {
              setState(() {
                _childId = id;
                _behaviour = null;
              });
              _load();
            },
          ),
        if (_error != null) ErrorBox(_error!),
        if (b == null && _error == null) const Center(child: CircularProgressIndicator()),
        if (b != null) ...[
          Row(children: [
            Expanded(child: _Total(glyph: '★', label: s.behaviourPraise, value: '${totals['praise'] ?? 0}', fg: c.pFg, bg: c.pBg)),
            const SizedBox(width: 8),
            Expanded(child: _Total(glyph: '!', label: s.behaviourConcerns, value: '${totals['concern'] ?? 0}', fg: c.lFg, bg: c.lBg)),
            if (points != null) ...[
              const SizedBox(width: 8),
              Expanded(child: _Total(glyph: '◆', label: s.behaviourPoints, value: s.behaviourPointsN(points), fg: c.eFg, bg: c.eBg)),
            ],
          ]),
          if (notes.isEmpty) EmptyState(icon: Icons.emoji_events_outlined, title: s.noBehaviour),
          for (final n in notes) _NoteCard(note: n),
        ],
      ],
    );
  }
}

class _Total extends StatelessWidget {
  const _Total({required this.glyph, required this.label, required this.value, required this.fg, required this.bg});
  final String glyph, label, value;
  final Color fg, bg;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: '$label: $value',
      excludeSemantics: true,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
        decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(10)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('$glyph $value', style: TextStyle(color: fg, fontSize: 20, fontWeight: FontWeight.w700)),
          const SizedBox(height: 2),
          Text(label, style: TextStyle(color: fg, fontSize: 13)),
        ]),
      ),
    );
  }
}

class _NoteCard extends StatelessWidget {
  const _NoteCard({required this.note});
  final Map<String, dynamic> note;

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    final kind = note['kind'] as String;
    // Each kind has a shape as well as a colour, so it reads without colour.
    final (glyph, fg, bg) = switch (kind) {
      'PRAISE' => ('★', c.pFg, c.pBg),
      'INCIDENT' => ('⚠', c.aFg, c.aBg),
      _ => ('!', c.lFg, c.lBg),
    };
    final points = note['points'] as int?;
    final severity = note['severity'] as String?;
    final action = note['actionTaken'] as String?;
    final author = note['author'] as Map<String, dynamic>?;
    final date = s.dayMonth(dateCairo(note['occurredAt'] as String));

    return Panel(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Wrap(spacing: 8, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(4)),
            child: Text('$glyph ${s.behaviourKind(kind)}', style: TextStyle(color: fg, fontSize: 13, fontWeight: FontWeight.w600)),
          ),
          Text(s.behaviourCategory(note['category'] as String), style: TextStyle(color: c.ink2, fontSize: 13)),
          if (severity != null) Text(s.behaviourSeverity(severity), style: TextStyle(color: c.ink2, fontSize: 13)),
          if (points != null && points != 0)
            Semantics(
              label: '${s.behaviourPoints}: ${s.behaviourPointsN(points)}',
              excludeSemantics: true,
              child: Text(s.behaviourPointsN(points), style: TextStyle(color: points > 0 ? c.pFg : c.lFg, fontSize: 13, fontWeight: FontWeight.w700)),
            ),
          if (note['read'] != true) Text('• ${s.behaviourNew}', style: TextStyle(color: c.primary, fontSize: 13, fontWeight: FontWeight.w600)),
        ]),
        const SizedBox(height: 8),
        Text(note['text'] as String, style: const TextStyle(fontSize: 15, height: 1.45)),
        if (action != null && action.isNotEmpty) ...[
          const SizedBox(height: 6),
          Text('${s.behaviourAction}: $action', style: TextStyle(color: c.ink2, fontSize: 14, height: 1.4)),
        ],
        const SizedBox(height: 8),
        Text(
          author == null ? date : '${s.staffName(author)} · $date',
          style: TextStyle(color: c.ink3, fontSize: 13),
        ),
      ]),
    );
  }
}
