import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'strings.dart';
import 'theme.dart';

/// Keeps a Latin value (a time, a class code, a phone number, an email) in its
/// own left-to-right island inside Arabic text, so it never runs backwards.
String ltr(String s) => '\u2066$s\u2069';

/// The full number from a field that shows "+20" in front: what the parent
/// typed if it starts with "+", otherwise Egypt's code and the digits without
/// the leading zero.
String fullPhone(String typed) {
  final t = typed.replaceAll(RegExp(r'[\s-]'), '');
  if (t.startsWith('+')) return t;
  return '+20${t.replaceFirst(RegExp(r'^0+'), '')}';
}

/// "+20 100 555 0192" from "+201005550192", for reading.
String prettyPhone(String phone) {
  final m = RegExp(r'^\+20(\d{3})(\d{3})(\d+)$').firstMatch(phone);
  return m == null ? phone : '+20 ${m[1]} ${m[2]} ${m[3]}';
}

TextStyle labelStyle(BuildContext context) => TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: context.c.ink);

/// The frame for every step-by-step screen: back, progress, title, then the fields.
class FormPage extends StatelessWidget {
  const FormPage({super.key, required this.title, this.sub, this.em, this.step, this.onBack, required this.children});
  final String title;
  final String? sub;
  /// The value the sub-line is about (an email or a number), in bold.
  final String? em;
  /// (current, total), or null for no step bar.
  final (int, int)? step;
  final VoidCallback? onBack;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final s = S.of(context);
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(24, 12, 24, 24),
          children: [
            if (onBack != null)
              Align(
                alignment: AlignmentDirectional.centerStart,
                child: TextButton.icon(
                  onPressed: onBack,
                  icon: Icon(Directionality.of(context) == TextDirection.rtl ? Icons.arrow_forward : Icons.arrow_back, size: 18),
                  label: Text(s.back),
                ),
              ),
            const SizedBox(height: 4),
            if (step != null) ...[
              StepBars(current: step!.$1, total: step!.$2),
              const SizedBox(height: 8),
              Text(s.stepOf(step!.$1, step!.$2), style: TextStyle(fontSize: 13, color: c.ink2, fontWeight: FontWeight.w600)),
              const SizedBox(height: 16),
            ],
            Text(title, style: const TextStyle(fontSize: 25, fontWeight: FontWeight.w600, height: 1.25)),
            if (sub != null) ...[
              const SizedBox(height: 8),
              Text.rich(
                TextSpan(children: [
                  TextSpan(text: sub),
                  if (em != null) TextSpan(text: ' ${ltr(em!)}', style: TextStyle(color: c.ink, fontWeight: FontWeight.w500)),
                ]),
                style: TextStyle(fontSize: 15, height: 1.5, color: c.ink2),
              ),
            ],
            const SizedBox(height: 16),
            for (final w in children) Padding(padding: const EdgeInsets.only(bottom: 16), child: w),
          ],
        ),
      ),
    );
  }
}

class StepBars extends StatelessWidget {
  const StepBars({super.key, required this.current, required this.total});
  final int current;
  final int total;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return ExcludeSemantics(
      child: Row(children: [
        for (var i = 0; i < total; i++) ...[
          if (i > 0) const SizedBox(width: 6),
          Expanded(child: Container(height: 4, decoration: BoxDecoration(color: i < current ? c.primary : c.line, borderRadius: BorderRadius.circular(2)))),
        ],
      ]),
    );
  }
}

/// A label above a field, with optional help underneath.
class Labeled extends StatelessWidget {
  const Labeled({super.key, required this.label, required this.child, this.help});
  final String label;
  final Widget child;
  final String? help;

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(label, style: labelStyle(context)),
      const SizedBox(height: 8),
      child,
      if (help != null) ...[const SizedBox(height: 6), Text(help!, style: TextStyle(fontSize: 13, color: context.c.ink3, height: 1.45))],
    ]);
  }
}

class EmailField extends StatelessWidget {
  const EmailField({super.key, required this.controller, required this.label, this.help, this.onSubmitted, this.autofocus = false});
  final TextEditingController controller;
  final String label;
  final String? help;
  final ValueChanged<String>? onSubmitted;
  final bool autofocus;

  @override
  Widget build(BuildContext context) => Labeled(
        label: label,
        help: help,
        child: TextField(
          controller: controller,
          autofocus: autofocus,
          keyboardType: TextInputType.emailAddress,
          autofillHints: const [AutofillHints.email],
          textDirection: TextDirection.ltr,
          style: const TextStyle(fontSize: 16),
          onSubmitted: onSubmitted,
        ),
      );
}

class PasswordField extends StatelessWidget {
  const PasswordField({super.key, required this.controller, required this.label, this.isNew = false, this.onSubmitted});
  final TextEditingController controller;
  final String label;
  final bool isNew;
  final ValueChanged<String>? onSubmitted;

  @override
  Widget build(BuildContext context) => Labeled(
        label: label,
        help: isNew ? S.of(context).pwHelp : null,
        child: TextField(
          controller: controller,
          obscureText: true,
          autofillHints: [isNew ? AutofillHints.newPassword : AutofillHints.password],
          style: const TextStyle(fontSize: 16),
          onSubmitted: onSubmitted,
        ),
      );
}

/// A mobile number with Egypt's "+20" in front. Typing a number that starts
/// with "+" uses that country instead.
class PhoneField extends StatelessWidget {
  const PhoneField({super.key, required this.controller, required this.label, this.autofocus = false});
  final TextEditingController controller;
  final String label;
  final bool autofocus;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return Labeled(
      label: label,
      child: Directionality(
        textDirection: TextDirection.ltr,
        child: TextField(
          controller: controller,
          autofocus: autofocus,
          keyboardType: TextInputType.phone,
          autofillHints: const [AutofillHints.telephoneNumberNational],
          style: const TextStyle(fontSize: 17, fontFeatures: [FontFeature.tabularFigures()]),
          decoration: InputDecoration(
            hintText: '100 555 0192',
            prefixIcon: Container(
              width: 56,
              alignment: Alignment.center,
              margin: const EdgeInsets.only(right: 12),
              decoration: BoxDecoration(border: Border(right: BorderSide(color: c.line))),
              child: Text('+20', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w500, color: c.ink2)),
            ),
          ),
        ),
      ),
    );
  }
}

/// Six boxes for a 6-digit code. One hidden field takes the typing (and the
/// phone's one-time-code autofill); the boxes show it.
class CodeField extends StatefulWidget {
  const CodeField({super.key, required this.controller, required this.label, this.autofocus = false, this.onComplete});
  final TextEditingController controller;
  final String label;
  final bool autofocus;
  final VoidCallback? onComplete;

  @override
  State<CodeField> createState() => _CodeFieldState();
}

class _CodeFieldState extends State<CodeField> {
  final _focus = FocusNode();

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_changed);
    _focus.addListener(_changed);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_changed);
    _focus.dispose();
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
    if (widget.controller.text.length == 6 && _focus.hasFocus) widget.onComplete?.call();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final text = widget.controller.text;
    return Labeled(
      label: widget.label,
      child: Directionality(
        textDirection: TextDirection.ltr,
        child: Stack(children: [
          Row(children: [
            for (var i = 0; i < 6; i++) ...[
              if (i > 0) const SizedBox(width: 8),
              Expanded(
                child: Container(
                  height: 50,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: c.surface,
                    borderRadius: BorderRadius.circular(8),
                    border: _focus.hasFocus && i == text.length.clamp(0, 5)
                        ? Border.all(color: c.primary, width: 2)
                        : Border.all(color: c.line),
                  ),
                  child: Text(i < text.length ? text[i] : '', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w600, fontFeatures: [FontFeature.tabularFigures()])),
                ),
              ),
            ],
          ]),
          Positioned.fill(
            child: Opacity(
              opacity: 0,
              child: TextField(
                controller: widget.controller,
                focusNode: _focus,
                autofocus: widget.autofocus,
                keyboardType: TextInputType.number,
                autofillHints: const [AutofillHints.oneTimeCode],
                inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
                showCursor: false,
                enableInteractiveSelection: false,
                decoration: const InputDecoration(border: InputBorder.none, enabledBorder: InputBorder.none, focusedBorder: InputBorder.none, filled: false),
              ),
            ),
          ),
        ]),
      ),
    );
  }
}

/// A quiet box that says what to do when something doesn't arrive.
class HelpBox extends StatelessWidget {
  const HelpBox({super.key, required this.title, required this.text, this.action});
  final String title;
  final String text;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(color: c.sunk, borderRadius: BorderRadius.circular(10)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(title, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, height: 1.5)),
        const SizedBox(height: 4),
        Text(text, style: TextStyle(fontSize: 13, color: c.ink2, height: 1.5)),
        if (action != null) action!,
      ]),
    );
  }
}

class ErrorBox extends StatelessWidget {
  const ErrorBox(this.message, {super.key});
  final String message;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return Semantics(
      liveRegion: true,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(color: c.aBg, borderRadius: BorderRadius.circular(10)),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('×', style: TextStyle(color: c.aFg, fontWeight: FontWeight.w700)),
          const SizedBox(width: 10),
          Expanded(child: Text(message, style: TextStyle(color: c.aFg, fontSize: 14, height: 1.45))),
        ]),
      ),
    );
  }
}

/// The main button; shows "One moment…" while busy.
class MainButton extends StatelessWidget {
  const MainButton({super.key, required this.label, required this.onPressed, this.busy = false});
  final String label;
  final VoidCallback? onPressed;
  final bool busy;

  @override
  Widget build(BuildContext context) => FilledButton(onPressed: busy ? null : onPressed, child: Text(busy ? S.of(context).oneMoment : label));
}

/// A status with its glyph and word, so it reads without colour.
class StatusPill extends StatelessWidget {
  const StatusPill({super.key, required this.label, required this.fg, required this.bg, required this.glyph, this.dashed = false});
  final String label;
  final Color fg;
  final Color bg;
  final String glyph;
  final bool dashed;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsetsDirectional.fromSTEB(7, 3, 9, 3),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(999),
        border: dashed ? Border.all(color: context.c.line) : null,
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        ExcludeSemantics(child: Text(glyph, style: TextStyle(fontSize: 10, color: fg, fontWeight: FontWeight.w700))),
        const SizedBox(width: 5),
        Text(label, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: fg)),
      ]),
    );
  }
}

/// A one-minute countdown for "Send a new code", then a button.
class ResendLink extends StatefulWidget {
  const ResendLink({super.key, required this.onResend});
  final Future<void> Function() onResend;

  @override
  State<ResendLink> createState() => _ResendLinkState();
}

class _ResendLinkState extends State<ResendLink> {
  static const _wait = 30;
  int _left = _wait;
  bool _sent = false;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _start();
  }

  void _start() {
    _timer?.cancel();
    _left = _wait;
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      setState(() => _left--);
      if (_left <= 0) t.cancel();
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    if (_left > 0) {
      return Padding(
        padding: const EdgeInsets.only(top: 6),
        child: Text(s.resendIn('0:${_left.toString().padLeft(2, '0')}'),
            style: TextStyle(color: context.c.ink2, fontWeight: FontWeight.w600, fontSize: 13, fontFeatures: const [FontFeature.tabularFigures()])),
      );
    }
    return TextButton(
      onPressed: () async {
        await widget.onResend();
        if (!mounted) return;
        setState(() => _sent = true);
        _start();
      },
      child: Text(_sent ? '${s.codeSent} ${s.resendNow}' : s.resendNow, style: const TextStyle(fontSize: 13)),
    );
  }
}
