import 'package:flutter/material.dart';

import '../api.dart';
import '../strings.dart';
import '../theme.dart';
import '../widgets.dart';

/// Asked once, before anything else (decision H39): what the strap does and doesn't do.
class ConsentScreen extends StatefulWidget {
  const ConsentScreen({super.key, required this.api, required this.onAgreed, required this.onDecline});
  final Api api;
  final VoidCallback onAgreed;
  final VoidCallback onDecline;

  @override
  State<ConsentScreen> createState() => _ConsentScreenState();
}

class _ConsentScreenState extends State<ConsentScreen> {
  bool _busy = false;
  String? _error;
  String? _child;
  String? _gender;

  @override
  void initState() {
    super.initState();
    // Name the child when there's one, so the sentence is about them.
    widget.api.children().then((kids) {
      if (mounted && kids.length == 1) {
        setState(() {
          _child = kids.first['firstName'] as String?;
          _gender = kids.first['gender'] as String?;
        });
      }
    }).catchError((_) {});
  }

  Future<void> _agree() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.api.consent();
      widget.onAgreed();
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
    final rows = [('✓', c.pFg, s.c1(_gender)), ('✓', c.pFg, s.c2), ('×', c.aFg, s.c3), ('–', c.ink2, s.c4)];
    return Scaffold(
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, box) => SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(24, 40, 24, 24),
            child: ConstrainedBox(
              constraints: BoxConstraints(minHeight: box.maxHeight - 64),
              child: IntrinsicHeight(
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Text(s.oneTime, style: TextStyle(fontSize: 13, color: c.ink2, fontWeight: FontWeight.w600)),
                  const SizedBox(height: 8),
                  Text(s.consentTitle, style: Brand.display(context, size: 26)),
                  const SizedBox(height: 18),
                  Text(s.consentBody(_child, _gender), style: TextStyle(fontSize: 15, height: 1.55, color: c.ink2)),
                  const SizedBox(height: 18),
                  Divider(color: c.line, height: 1),
                  for (final (glyph, color, text) in rows)
                    Container(
                      padding: const EdgeInsets.symmetric(vertical: 11),
                      decoration: BoxDecoration(border: Border(bottom: BorderSide(color: c.line))),
                      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        SizedBox(width: 22, child: ExcludeSemantics(child: Text(glyph, style: TextStyle(fontWeight: FontWeight.w700, color: color)))),
                        const SizedBox(width: 10),
                        Expanded(child: Text(text, style: const TextStyle(fontSize: 14, height: 1.45))),
                      ]),
                    ),
                  if (_error != null) ...[const SizedBox(height: 16), ErrorBox(_error!)],
                  const Spacer(),
                  const SizedBox(height: 24),
                  MainButton(label: s.agree, busy: _busy, onPressed: _agree),
                  const SizedBox(height: 8),
                  OutlinedButton(onPressed: _busy ? null : widget.onDecline, child: Text(s.notNow, style: const TextStyle(fontWeight: FontWeight.w500))),
                ]),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
