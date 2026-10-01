import 'package:flutter/material.dart';

import '../api.dart';
import '../theme.dart';

/// Asked once, before anything else (decision H39).
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

  Future<void> _agree() async {
    setState(() => _busy = true);
    try {
      await widget.api.consent();
      widget.onAgreed();
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    const points = [
      'Your child wears a strap. Gateways at the school gates and in classrooms hear it.',
      'That tells the school when your child arrives, which lessons they attend and when they leave.',
      'You get a notification when your child arrives, and if they are absent or leave early.',
      'Detailed signal and location data is deleted after one week. Attendance records are kept.',
    ];
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(24, 40, 24, 24),
          children: [
            Text('Before you start', style: Theme.of(context).textTheme.headlineMedium),
            const SizedBox(height: 16),
            for (final p in points)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Padding(padding: EdgeInsets.only(top: 7, right: 12), child: CircleAvatar(radius: 3, backgroundColor: Brand.clay)),
                  Expanded(child: Text(p, style: const TextStyle(fontSize: 15, height: 1.45))),
                ]),
              ),
            if (_error != null) Text(_error!, style: const TextStyle(color: Brand.alert)),
            const SizedBox(height: 16),
            FilledButton(onPressed: _busy ? null : _agree, child: const Text('I agree')),
            TextButton(onPressed: widget.onDecline, child: const Text('Not now, sign out')),
          ],
        ),
      ),
    );
  }
}
