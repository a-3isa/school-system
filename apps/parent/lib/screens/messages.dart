import 'package:flutter/material.dart';

import '../api.dart';
import '../strings.dart';
import '../theme.dart';
import '../widgets.dart';
import 'home.dart';

/// Announcements, polls and conversations with the school.
class MessagesTab extends StatelessWidget {
  const MessagesTab({super.key, required this.api, required this.data});
  final Api api;
  final HomeData data;

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 10, 20, 24),
      children: [
        Text(s.tabMessages, style: Brand.display(context, size: 24)),
        EmptyState(icon: Icons.forum_outlined, title: s.messagesSoon),
      ],
    );
  }
}
