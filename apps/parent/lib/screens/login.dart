import 'package:flutter/material.dart';

import '../api.dart';
import '../settings.dart';
import '../strings.dart';
import '../theme.dart';
import '../widgets.dart';

enum _Mode { signIn, create1, create2, create3, forgot1, forgot2 }

/// Parents sign in with the email the school registered and their own
/// password. Creating the account takes three short steps:
///   1. the email the school registered: a code is sent to it;
///   2. that code and their mobile: a code is sent to the mobile by WhatsApp;
///   3. the WhatsApp code and a password.
/// The checked mobile is saved for the school. Forgot password: a code by
/// email, then a new password.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.api, required this.onSignedIn});
  final Api api;
  final VoidCallback onSignedIn;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _emailCode = TextEditingController();
  final _phone = TextEditingController();
  final _phoneCode = TextEditingController();
  _Mode _mode = _Mode.signIn;
  /// Set once the WhatsApp code has gone out; step 2 then only fixes the number.
  String? _ticket;
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    for (final c in [_email, _password, _emailCode, _phone, _phoneCode]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _run(Future<void> Function() fn) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await fn();
    } on WrongRole {
      if (mounted) setState(() => _error = S.of(context).staffOnly);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _go(_Mode mode) => setState(() {
        _mode = mode;
        _error = null;
        if (mode == _Mode.signIn || mode == _Mode.create1 || mode == _Mode.forgot1) {
          _emailCode.clear();
          _phoneCode.clear();
          _password.clear();
          _ticket = null;
        }
      });

  String get _emailText => _email.text.trim();

  Future<void> _signIn() => _run(() async {
        await widget.api.login(_emailText, _password.text);
        widget.onSignedIn();
      });

  Future<void> _create1() => _run(() async {
        await widget.api.signup(_emailText);
        _go(_Mode.create2);
      });

  Future<void> _create2() => _run(() async {
        final phone = fullPhone(_phone.text);
        _ticket = _ticket == null
            ? await widget.api.signupPhone(_emailText, _emailCode.text.trim(), phone)
            : await widget.api.resendSignupPhone(_ticket!, phone);
        _phoneCode.clear();
        setState(() => _mode = _Mode.create3);
      });

  Future<void> _create3() => _run(() async {
        await widget.api.completeSignup(_ticket!, _phoneCode.text.trim(), _password.text);
        widget.onSignedIn();
      });

  Future<void> _forgot1() => _run(() async {
        await widget.api.forgotPassword(_emailText);
        _go(_Mode.forgot2);
      });

  Future<void> _forgot2() => _run(() async {
        await widget.api.resetPassword(_emailText, _emailCode.text.trim(), _password.text);
        widget.onSignedIn();
      });

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final error = _error == null ? <Widget>[] : [ErrorBox(_error!)];
    return AutofillGroup(
      child: switch (_mode) {
        _Mode.signIn => _SignIn(
            school: widget.api.lastSchool(s.isAr),
            email: _email,
            password: _password,
            error: _error,
            busy: _busy,
            onSignIn: _signIn,
            onForgot: () => _go(_Mode.forgot1),
            onCreate: () => _go(_Mode.create1),
          ),
        _Mode.create1 => FormPage(
            step: (1, 3),
            title: s.createAccount,
            sub: s.regEmail,
            onBack: () => _go(_Mode.signIn),
            children: [
              ...error,
              EmailField(controller: _email, label: s.email, autofocus: true, onSubmitted: (_) => _create1()),
              MainButton(label: s.sendMe, busy: _busy, onPressed: _create1),
            ],
          ),
        _Mode.create2 => FormPage(
            step: (2, 3),
            title: _ticket == null ? s.checkEmail : s.mobileWa,
            sub: _ticket == null ? s.codeSub : null,
            em: _ticket == null ? _emailText : null,
            onBack: () => _ticket == null ? _go(_Mode.create1) : setState(() => _mode = _Mode.create3),
            children: [
              ...error,
              if (_ticket == null) CodeField(controller: _emailCode, label: s.codeFromEmail, autofocus: true),
              PhoneField(controller: _phone, label: s.mobileWa, autofocus: _ticket != null),
              MainButton(label: s.sendWa, busy: _busy, onPressed: _create2),
              if (_ticket == null) HelpBox(title: s.noEmailT, text: s.noEmail),
            ],
          ),
        _Mode.create3 => FormPage(
            step: (3, 3),
            title: s.waTitle,
            sub: s.waSub,
            em: prettyPhone(fullPhone(_phone.text)),
            onBack: () => setState(() => _mode = _Mode.create2),
            children: [
              ...error,
              CodeField(controller: _phoneCode, label: s.waCode, autofocus: true),
              PasswordField(controller: _password, label: s.choosePw, isNew: true, onSubmitted: (_) => _create3()),
              MainButton(label: s.createBtn, busy: _busy, onPressed: _create3),
              TextButton(
                onPressed: _busy ? null : () => setState(() => _mode = _Mode.create2),
                child: Text(s.fixNumber, style: const TextStyle(fontSize: 14, height: 1.4)),
              ),
            ],
          ),
        _Mode.forgot1 => FormPage(
            step: (1, 2),
            title: s.resetTitle,
            sub: s.resetSub,
            onBack: () => _go(_Mode.signIn),
            children: [
              ...error,
              EmailField(controller: _email, label: s.email, autofocus: true, onSubmitted: (_) => _forgot1()),
              MainButton(label: s.sendMe, busy: _busy, onPressed: _forgot1),
            ],
          ),
        _Mode.forgot2 => FormPage(
            step: (2, 2),
            title: s.checkEmail,
            sub: s.codeSub,
            em: _emailText,
            onBack: () => _go(_Mode.forgot1),
            children: [
              ...error,
              CodeField(controller: _emailCode, label: s.codeFromEmail, autofocus: true),
              PasswordField(controller: _password, label: s.newPw, isNew: true, onSubmitted: (_) => _forgot2()),
              MainButton(label: s.resetBtn, busy: _busy, onPressed: _forgot2),
              HelpBox(title: s.noEmailT, text: s.noEmail, action: ResendLink(onResend: () => widget.api.forgotPassword(_emailText))),
            ],
          ),
      },
    );
  }
}

class _SignIn extends StatelessWidget {
  const _SignIn({required this.school, required this.email, required this.password, required this.error, required this.busy, required this.onSignIn, required this.onForgot, required this.onCreate});
  /// The school this phone last signed in to, shown with its crest.
  final String? school;
  final TextEditingController email;
  final TextEditingController password;
  final String? error;
  final bool busy;
  final VoidCallback onSignIn;
  final VoidCallback onForgot;
  final VoidCallback onCreate;

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    final settings = Settings.of(context);
    return Scaffold(
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, box) => SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
            child: ConstrainedBox(
              constraints: BoxConstraints(minHeight: box.maxHeight - 32),
              child: IntrinsicHeight(
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Align(
                    alignment: AlignmentDirectional.centerEnd,
                    child: TextButton(
                      onPressed: () => settings.setLang(s.isAr ? 'en' : 'ar'),
                      child: Text(s.otherLanguage, style: TextStyle(fontFamily: s.isAr ? Brand.font : 'IBMPlexSansArabic')),
                    ),
                  ),
                  const SizedBox(height: 24),
                  Row(children: [
                    Crest(name: school ?? s.appName, width: 30),
                    const SizedBox(width: 10),
                    Expanded(child: Text(school ?? s.appName, style: Brand.display(context, size: 15, height: 1.25).copyWith(color: c.ink))),
                  ]),
                  const SizedBox(height: 8),
                  Text(s.signIn, style: Brand.display(context, size: 28, height: 1.2)),
                  const SizedBox(height: 18),
                  if (error != null) ...[ErrorBox(error!), const SizedBox(height: 18)],
                  EmailField(controller: email, label: s.email),
                  const SizedBox(height: 18),
                  PasswordField(controller: password, label: s.password, onSubmitted: (_) => onSignIn()),
                  const SizedBox(height: 18),
                  MainButton(label: s.signIn, busy: busy, onPressed: onSignIn),
                  Align(alignment: AlignmentDirectional.centerStart, child: TextButton(onPressed: busy ? null : onForgot, child: Text(s.forgot))),
                  const Spacer(),
                  const SizedBox(height: 24),
                  Divider(color: c.line, height: 1),
                  const SizedBox(height: 16),
                  Text(s.newHere, style: TextStyle(fontSize: 14, color: c.ink2)),
                  const SizedBox(height: 6),
                  OutlinedButton(onPressed: busy ? null : onCreate, child: Text(s.createAccount)),
                ]),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
