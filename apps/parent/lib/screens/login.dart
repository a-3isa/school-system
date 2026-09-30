import 'package:flutter/material.dart';

import '../api.dart';
import '../theme.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.api, required this.onSignedIn});
  final Api api;
  final VoidCallback onSignedIn;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _phone = TextEditingController();
  final _password = TextEditingController();
  String? _error;
  bool _busy = false;

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.api.login(_phone.text.trim(), _password.text);
      widget.onSignedIn();
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

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
              keyboardType: TextInputType.phone,
              autofillHints: const [AutofillHints.telephoneNumber],
              decoration: const InputDecoration(labelText: 'Mobile number', hintText: '+2010…'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _password,
              obscureText: true,
              autofillHints: const [AutofillHints.password],
              decoration: const InputDecoration(labelText: 'Password'),
              onSubmitted: (_) => _submit(),
            ),
            const SizedBox(height: 20),
            FilledButton(onPressed: _busy ? null : _submit, child: Text(_busy ? 'Signing in…' : 'Sign in')),
            const SizedBox(height: 12),
            const Text('Codes by WhatsApp are coming soon. Until then the school gives you a password.',
                style: TextStyle(color: Brand.muted, fontSize: 13)),
          ],
        ),
      ),
    );
  }
}
