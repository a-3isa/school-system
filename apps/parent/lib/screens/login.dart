import 'package:flutter/material.dart';

import '../api.dart';
import '../theme.dart';

enum _Mode { signIn, signUp, forgot, code }

/// Parents sign in with the email the school registered and their own
/// password. New parents create the account here: a 6-digit code is sent to
/// that email to prove it's theirs, then they choose a password. Forgot
/// password works the same way.
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
  final _code = TextEditingController();
  _Mode _mode = _Mode.signIn;
  bool _newAccount = false; // the code step came from "Create account"
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
        _code.clear();
        _password.clear();
      });

  Future<void> _submit() async {
    final email = _email.text.trim();
    switch (_mode) {
      case _Mode.signIn:
        return _run(() async {
          await widget.api.login(email, _password.text);
          widget.onSignedIn();
        });
      case _Mode.signUp:
        return _run(() async {
          await widget.api.signup(email);
          _newAccount = true;
          _go(_Mode.code);
        });
      case _Mode.forgot:
        return _run(() async {
          await widget.api.forgotPassword(email);
          _newAccount = false;
          _go(_Mode.code);
        });
      case _Mode.code:
        return _run(() async {
          await widget.api.setPassword(email, _code.text.trim(), _password.text);
          widget.onSignedIn();
        });
    }
  }

  @override
  Widget build(BuildContext context) {
    final title = switch (_mode) {
      _Mode.signIn => 'Your child’s day, as it happens.',
      _Mode.signUp => 'Create your account',
      _Mode.forgot => 'Forgot your password?',
      _Mode.code => _newAccount ? 'Check your email' : 'Choose a new password',
    };
    final hint = switch (_mode) {
      _Mode.signIn => 'Sign in with the email you gave the school.',
      _Mode.signUp => 'Use the email you gave the school when you registered your child. We’ll send a code to it.',
      _Mode.forgot => 'We’ll send a code to your email.',
      _Mode.code => 'If the school registered this email, a 6-digit code is on its way. It works for 15 minutes. '
          'If nothing arrives, ask the school to check your email address.',
    };
    final button = switch (_mode) {
      _Mode.signIn => 'Sign in',
      _Mode.signUp || _Mode.forgot => 'Send me a code',
      _Mode.code => _newAccount ? 'Create account' : 'Save and sign in',
    };

    return Scaffold(
      body: SafeArea(
        child: AutofillGroup(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(24, 48, 24, 24),
            children: [
              Text(title, style: Theme.of(context).textTheme.headlineMedium),
              const SizedBox(height: 8),
              Text(hint, style: const TextStyle(color: Brand.muted, fontSize: 15)),
              const SizedBox(height: 32),
              if (_error != null) ...[
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(color: Brand.alertBg, borderRadius: BorderRadius.circular(12)),
                  child: Text(_error!, style: const TextStyle(color: Brand.alert)),
                ),
                const SizedBox(height: 16),
              ],
              TextField(
                controller: _email,
                enabled: _mode != _Mode.code,
                keyboardType: TextInputType.emailAddress,
                autofillHints: const [AutofillHints.email],
                decoration: const InputDecoration(labelText: 'Email'),
              ),
              const SizedBox(height: 12),
              if (_mode == _Mode.code) ...[
                TextField(
                  controller: _code,
                  keyboardType: TextInputType.number,
                  autofillHints: const [AutofillHints.oneTimeCode],
                  maxLength: 6,
                  decoration: const InputDecoration(labelText: 'Code from the email'),
                ),
                const SizedBox(height: 4),
              ],
              if (_mode == _Mode.signIn || _mode == _Mode.code) ...[
                TextField(
                  controller: _password,
                  obscureText: true,
                  autofillHints: [_mode == _Mode.signIn ? AutofillHints.password : AutofillHints.newPassword],
                  decoration: InputDecoration(labelText: _mode == _Mode.signIn ? 'Password' : 'Choose a password (8 characters or more)'),
                  onSubmitted: (_) => _submit(),
                ),
                const SizedBox(height: 20),
              ],
              FilledButton(onPressed: _busy ? null : _submit, child: Text(_busy ? 'One moment…' : button)),
              const SizedBox(height: 8),
              if (_mode == _Mode.signIn) ...[
                TextButton(onPressed: _busy ? null : () => _go(_Mode.signUp), child: const Text('New here? Create your account')),
                TextButton(onPressed: _busy ? null : () => _go(_Mode.forgot), child: const Text('Forgot password?')),
              ] else
                TextButton(onPressed: _busy ? null : () => _go(_Mode.signIn), child: const Text('Back to sign in')),
            ],
          ),
        ),
      ),
    );
  }
}
