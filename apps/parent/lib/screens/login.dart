import 'package:flutter/material.dart';

import '../api.dart';
import '../theme.dart';

enum _Mode { signIn, signUpEmail, signUpPhone, signUpFinish, forgot, reset }

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
  final _phone = TextEditingController(text: '+20');
  final _phoneCode = TextEditingController();
  _Mode _mode = _Mode.signIn;
  String? _ticket;
  String? _error;
  bool _busy = false;

  Future<void> _run(Future<void> Function() fn) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await fn();
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _go(_Mode mode) => setState(() {
        _mode = mode;
        _error = null;
        if (mode == _Mode.signIn || mode == _Mode.signUpEmail || mode == _Mode.forgot) {
          _emailCode.clear();
          _phoneCode.clear();
          _password.clear();
          _ticket = null;
        }
      });

  Future<void> _submit() {
    final email = _email.text.trim();
    return switch (_mode) {
      _Mode.signIn => _run(() async {
          await widget.api.login(email, _password.text);
          widget.onSignedIn();
        }),
      _Mode.signUpEmail => _run(() async {
          await widget.api.signup(email);
          _go(_Mode.signUpPhone);
        }),
      _Mode.signUpPhone => _run(() async {
          _ticket = await widget.api.signupPhone(email, _emailCode.text.trim(), _phone.text.replaceAll(' ', ''));
          _go(_Mode.signUpFinish);
        }),
      _Mode.signUpFinish => _run(() async {
          await widget.api.completeSignup(_ticket!, _phoneCode.text.trim(), _password.text);
          widget.onSignedIn();
        }),
      _Mode.forgot => _run(() async {
          await widget.api.forgotPassword(email);
          _go(_Mode.reset);
        }),
      _Mode.reset => _run(() async {
          await widget.api.resetPassword(email, _emailCode.text.trim(), _password.text);
          widget.onSignedIn();
        }),
    };
  }

  Future<void> _resend() => _run(() async {
        _ticket = await widget.api.resendSignupPhone(_ticket!, _phone.text.replaceAll(' ', ''));
        _phoneCode.clear();
        setState(() {});
      });

  Widget _field(TextEditingController c, String label, {TextInputType? type, bool secret = false, Iterable<String>? hints, int? maxLength, bool enabled = true}) =>
      Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: TextField(
          controller: c,
          enabled: enabled,
          keyboardType: type,
          obscureText: secret,
          autofillHints: hints,
          maxLength: maxLength,
          decoration: InputDecoration(labelText: label),
          onSubmitted: (_) => _submit(),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final step = switch (_mode) {
      _Mode.signUpEmail => 'Step 1 of 3',
      _Mode.signUpPhone => 'Step 2 of 3',
      _Mode.signUpFinish => 'Step 3 of 3',
      _ => null,
    };
    final title = switch (_mode) {
      _Mode.signIn => 'Your child’s day, as it happens.',
      _Mode.signUpEmail => 'Create your account',
      _Mode.signUpPhone => 'Your mobile number',
      _Mode.signUpFinish => 'Check WhatsApp',
      _Mode.forgot => 'Forgot your password?',
      _Mode.reset => 'Choose a new password',
    };
    final hint = switch (_mode) {
      _Mode.signIn => 'Sign in with the email you gave the school.',
      _Mode.signUpEmail => 'Use the email you gave the school when you registered your child. We’ll send a code to it.',
      _Mode.signUpPhone => 'If the school registered ${_email.text.trim()}, a 6-digit code is on its way there (it works for 15 minutes; '
          'if nothing arrives, ask the school to check your email). Type it below with your mobile number: we’ll check the number on WhatsApp.',
      _Mode.signUpFinish => 'We sent a 6-digit code to ${_phone.text} on WhatsApp. Type it below and choose your password.',
      _Mode.forgot => 'We’ll send a code to your email.',
      _Mode.reset => 'If ${_email.text.trim()} has an account, a 6-digit code is on its way. It works for 15 minutes.',
    };
    final button = switch (_mode) {
      _Mode.signIn => 'Sign in',
      _Mode.signUpEmail || _Mode.forgot => 'Send me a code',
      _Mode.signUpPhone => 'Send a WhatsApp code',
      _Mode.signUpFinish => 'Create account',
      _Mode.reset => 'Save and sign in',
    };

    return Scaffold(
      body: SafeArea(
        child: AutofillGroup(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(24, 48, 24, 24),
            children: [
              if (step != null) Text(step.toUpperCase(), style: const TextStyle(color: Brand.muted, fontSize: 12, fontWeight: FontWeight.w600, letterSpacing: 0.8)),
              Text(title, style: Theme.of(context).textTheme.headlineMedium),
              const SizedBox(height: 8),
              Text(hint, style: const TextStyle(color: Brand.muted, fontSize: 15)),
              const SizedBox(height: 28),
              if (_error != null) ...[
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(color: Brand.alertBg, borderRadius: BorderRadius.circular(12)),
                  child: Text(_error!, style: const TextStyle(color: Brand.alert)),
                ),
                const SizedBox(height: 16),
              ],
              _field(_email, 'Email', type: TextInputType.emailAddress, hints: const [AutofillHints.email], enabled: _mode == _Mode.signIn || _mode == _Mode.signUpEmail || _mode == _Mode.forgot),
              if (_mode == _Mode.signUpPhone || _mode == _Mode.reset)
                _field(_emailCode, 'Code from the email', type: TextInputType.number, hints: const [AutofillHints.oneTimeCode], maxLength: 6),
              if (_mode == _Mode.signUpPhone || _mode == _Mode.signUpFinish)
                _field(_phone, 'Mobile number (with country code)', type: TextInputType.phone, hints: const [AutofillHints.telephoneNumber]),
              if (_mode == _Mode.signUpFinish)
                _field(_phoneCode, 'Code from WhatsApp', type: TextInputType.number, hints: const [AutofillHints.oneTimeCode], maxLength: 6),
              if (_mode == _Mode.signIn) _field(_password, 'Password', secret: true, hints: const [AutofillHints.password]),
              if (_mode == _Mode.signUpFinish || _mode == _Mode.reset)
                _field(_password, 'Choose a password (8 characters or more)', secret: true, hints: const [AutofillHints.newPassword]),
              const SizedBox(height: 8),
              FilledButton(onPressed: _busy ? null : _submit, child: Text(_busy ? 'One moment…' : button)),
              const SizedBox(height: 8),
              if (_mode == _Mode.signIn) ...[
                TextButton(onPressed: _busy ? null : () => _go(_Mode.signUpEmail), child: const Text('New here? Create your account')),
                TextButton(onPressed: _busy ? null : () => _go(_Mode.forgot), child: const Text('Forgot password?')),
              ] else ...[
                if (_mode == _Mode.signUpFinish)
                  TextButton(onPressed: _busy ? null : _resend, child: const Text('No code, or wrong number? Fix the number and send again')),
                TextButton(onPressed: _busy ? null : () => _go(_Mode.signIn), child: const Text('Back to sign in')),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
