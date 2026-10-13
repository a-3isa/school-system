import 'package:flutter/material.dart';

import '../api.dart';
import '../settings.dart';
import '../strings.dart';
import '../theme.dart';
import '../widgets.dart';

/// The parent's details, the language, and changing the mobile number.
class AccountTab extends StatefulWidget {
  const AccountTab({super.key, required this.api, required this.me, required this.onSignOut});
  final Api api;
  final Map<String, dynamic> me;
  final VoidCallback onSignOut;

  @override
  State<AccountTab> createState() => _AccountTabState();
}

class _AccountTabState extends State<AccountTab> {
  late String? _phone = widget.me['phone'] as String?;
  late bool _checked = widget.me['phoneVerifiedAt'] != null;
  String? _error;
  bool _busy = false;

  Future<void> _changeMobile() async {
    final phone = await Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => ChangeMobile(api: widget.api)));
    if (phone != null && mounted) {
      setState(() {
        _phone = phone;
        _checked = true;
      });
    }
  }

  Future<void> _signOutEverywhere() async {
    final s = S.of(context);
    final sure = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        content: Text(s.signOutAllAsk),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: Text(s.staySignedIn)),
          TextButton(onPressed: () => Navigator.of(ctx).pop(true), child: Text(s.yesSignOutAll)),
        ],
      ),
    );
    if (sure != true || !mounted) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.api.signOutEverywhere();
      widget.onSignOut();
    } catch (e) {
      // Stay signed in: saying "signed out" when the other devices were not would be untrue.
      if (mounted) setState(() => _error = s.apiError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    final settings = Settings.of(context);
    Widget row(String label, Widget value) => Container(
          padding: const EdgeInsets.symmetric(vertical: 14),
          decoration: BoxDecoration(border: Border(bottom: BorderSide(color: c.line))),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label, style: TextStyle(fontSize: 12, color: c.ink2, fontWeight: FontWeight.w600)),
            const SizedBox(height: 2),
            value,
          ]),
        );
    const value = TextStyle(fontSize: 16, fontWeight: FontWeight.w500);

    return LayoutBuilder(
      builder: (context, box) => SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
        child: ConstrainedBox(
          constraints: BoxConstraints(minHeight: box.maxHeight - 32),
          child: IntrinsicHeight(
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Text(s.tabAccount, style: Brand.display(context, size: 24)),
              const SizedBox(height: 18),
              Divider(color: c.line, height: 1),
              row(s.name, Text(widget.me['name'] as String? ?? '', style: value)),
              row(s.email, Text(ltr(widget.me['email'] as String? ?? ''), style: value)),
              row(
                s.mobile,
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(_phone == null ? s.notSet : ltr(prettyPhone(_phone!)), style: value.copyWith(fontFeatures: const [FontFeature.tabularFigures()])),
                  const SizedBox(height: 6),
                  if (_phone != null)
                    _checked
                        ? StatusPill(label: s.checkedWa, fg: c.pFg, bg: c.pBg, glyph: '✓')
                        : StatusPill(label: s.notChecked, fg: c.lFg, bg: c.lBg, glyph: '!'),
                  const SizedBox(height: 8),
                  OutlinedButton(onPressed: _changeMobile, child: Text(s.changeMobile)),
                ]),
              ),
              Container(
                padding: const EdgeInsets.symmetric(vertical: 10),
                decoration: BoxDecoration(border: Border(bottom: BorderSide(color: c.line))),
                child: Row(children: [
                  Expanded(child: Text(s.language, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500))),
                  _LangSwitch(lang: settings.lang, onPick: settings.setLang),
                ]),
              ),
              const Spacer(),
              const SizedBox(height: 24),
              if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 10), child: Text(_error!, style: TextStyle(color: c.aFg, fontSize: 14))),
              OutlinedButton(
                onPressed: widget.onSignOut,
                style: OutlinedButton.styleFrom(foregroundColor: c.aFg),
                child: Text(s.signOut),
              ),
              const SizedBox(height: 8),
              OutlinedButton(
                onPressed: _busy ? null : _signOutEverywhere,
                child: Text(s.signOutAll),
              ),
            ]),
          ),
        ),
      ),
    );
  }
}

class _LangSwitch extends StatelessWidget {
  const _LangSwitch({required this.lang, required this.onPick});
  final String lang;
  final ValueChanged<String> onPick;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    Widget option(String code, String label, String family) => Semantics(
          selected: lang == code,
          button: true,
          child: GestureDetector(
            onTap: () => onPick(code),
            child: Container(
              constraints: const BoxConstraints(minHeight: 36, minWidth: 64),
              alignment: Alignment.center,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              decoration: lang == code ? BoxDecoration(color: c.surface, borderRadius: BorderRadius.circular(4), border: Border.all(color: c.line)) : null,
              child: Text(label, style: TextStyle(fontFamily: family, fontSize: 14, fontWeight: FontWeight.w600, color: lang == code ? c.ink : c.ink2)),
            ),
          ),
        );
    return Container(
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(color: c.sunk, borderRadius: BorderRadius.circular(6)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        option('en', 'English', Brand.font),
        const SizedBox(width: 3),
        option('ar', 'العربية', 'IBMPlexSansArabic'),
      ]),
    );
  }
}

/// Change mobile: the new number, then the WhatsApp code, then done.
/// Pops with the new number once it's saved.
class ChangeMobile extends StatefulWidget {
  const ChangeMobile({super.key, required this.api});
  final Api api;

  @override
  State<ChangeMobile> createState() => _ChangeMobileState();
}

class _ChangeMobileState extends State<ChangeMobile> {
  final _phone = TextEditingController();
  final _code = TextEditingController();
  int _step = 1;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _phone.dispose();
    _code.dispose();
    super.dispose();
  }

  String get _number => fullPhone(_phone.text);

  Future<void> _run(Future<void> Function() fn) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await fn();
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _send() => _run(() async {
        await widget.api.requestPhoneChange(_number);
        _code.clear();
        setState(() => _step = 2);
      });

  Future<void> _confirm() => _run(() async {
        await widget.api.confirmPhoneChange(_number, _code.text.trim());
        setState(() => _step = 3);
      });

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    final error = _error == null ? <Widget>[] : [ErrorBox(_error!)];
    return switch (_step) {
      1 => FormPage(
          step: (1, 2),
          title: s.changeMobile,
          sub: s.newMobileSub,
          onBack: () => Navigator.of(context).pop(),
          children: [
            ...error,
            PhoneField(controller: _phone, label: s.newMobile, autofocus: true),
            MainButton(label: s.sendWa, busy: _busy, onPressed: _send),
          ],
        ),
      2 => FormPage(
          step: (2, 2),
          title: s.waTitle,
          sub: s.waSub,
          em: prettyPhone(_number),
          onBack: () => setState(() => _step = 1),
          children: [
            ...error,
            CodeField(controller: _code, label: s.waCode, autofocus: true),
            MainButton(label: s.confirm, busy: _busy, onPressed: _confirm),
            TextButton(onPressed: _busy ? null : () => setState(() => _step = 1), child: Text(s.fixNumber, style: const TextStyle(fontSize: 14, height: 1.4))),
          ],
        ),
      _ => FormPage(
          title: s.changeMobile,
          children: [
            Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Container(
                width: 52,
                height: 52,
                alignment: Alignment.center,
                decoration: BoxDecoration(color: c.pBg, shape: BoxShape.circle),
                child: Text('✓', style: TextStyle(color: c.pFg, fontSize: 24, fontWeight: FontWeight.w700)),
              ),
              const SizedBox(height: 12),
              Text.rich(
                TextSpan(children: [
                  TextSpan(text: '${s.doneA} '),
                  TextSpan(text: ltr(prettyPhone(_number)), style: const TextStyle(fontWeight: FontWeight.w700)),
                  const TextSpan(text: '.'),
                ]),
                style: const TextStyle(fontSize: 18, height: 1.5, fontWeight: FontWeight.w500),
              ),
              const SizedBox(height: 12),
              Text(s.doneC, style: TextStyle(fontSize: 15, color: c.ink2)),
            ]),
            MainButton(label: s.done, onPressed: () => Navigator.of(context).pop(_number)),
          ],
        ),
    };
  }
}
