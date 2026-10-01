import 'package:flutter/material.dart';

import '../api.dart';
import '../theme.dart';

/// Sign in with the mobile number the school has: a code arrives on WhatsApp.
/// A password (set by the school) still works as a fallback.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.api, required this.onSignedIn});
  final Api api;
  final VoidCallback onSignedIn;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _phone = TextEditingController();
  final _code = TextEditingController();
  final _password = TextEditingController();
  bool _codeSent = false;
  bool _usePassword = false;
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

  Future<void> _sendCode() => _run(() async {
        await widget.api.requestCode(_phone.text.trim());
        setState(() => _codeSent = true);
      });

  Future<void> _verify() => _run(() async {
        await widget.api.verifyCode(_phone.text.trim(), _code.text.trim());
        widget.onSignedIn();
      });

  Future<void> _passwordLogin() => _run(() async {
        await widget.api.login(_phone.text.trim(), _password.text);
        widget.onSignedIn();
      });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(24, 48, 24, 24),
          children: [
            Text('Your child’s day, as it happens.', style: Theme.of(context).textTheme.headlineMedium),
            const SizedBox(height: 8),
            const Text('Sign in with the mobile number you gave the school.', style: TextStyle(color: Brand.muted, fontSize: 15)),
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
              controller: _phone,
              enabled: !_codeSent,
              keyboardType: TextInputType.phone,
              autofillHints: const [AutofillHints.telephoneNumber],
              decoration: const InputDecoration(labelText: 'Mobile number', hintText: '+201001234567'),
            ),
            const SizedBox(height: 12),
            if (_usePassword) ...[
              TextField(
                controller: _password,
                obscureText: true,
                autofillHints: const [AutofillHints.password],
                decoration: const InputDecoration(labelText: 'Password'),
                onSubmitted: (_) => _passwordLogin(),
              ),
              const SizedBox(height: 20),
              FilledButton(onPressed: _busy ? null : _passwordLogin, child: Text(_busy ? 'Signing in…' : 'Sign in')),
            ] else if (_codeSent) ...[
              const Text('We sent a 6-digit code to your WhatsApp.', style: TextStyle(color: Brand.muted)),
              const SizedBox(height: 12),
              TextField(
                controller: _code,
                keyboardType: TextInputType.number,
                autofillHints: const [AutofillHints.oneTimeCode],
                maxLength: 6,
                decoration: const InputDecoration(labelText: 'Code'),
                onSubmitted: (_) => _verify(),
              ),
              const SizedBox(height: 8),
              FilledButton(onPressed: _busy ? null : _verify, child: Text(_busy ? 'Checking…' : 'Sign in')),
              TextButton(onPressed: _busy ? null : () => setState(() => _codeSent = false), child: const Text('Change number or send again')),
            ] else
              FilledButton(onPressed: _busy ? null : _sendCode, child: Text(_busy ? 'Sending…' : 'Send code by WhatsApp')),
            const SizedBox(height: 8),
            TextButton(
              onPressed: () => setState(() {
                _usePassword = !_usePassword;
                _error = null;
              }),
              child: Text(_usePassword ? 'Use a WhatsApp code instead' : 'Sign in with a password instead'),
            ),
          ],
        ),
      ),
    );
  }
}
