import 'package:flutter/material.dart';

import '../api.dart';
import '../strings.dart';
import '../theme.dart';
import '../widgets.dart';
import 'home.dart';

/// Everything the school told the parent, newest first, grouped by day.
/// Unread ones are tinted with a dot; tapping one marks it read.
class NotificationsTab extends StatelessWidget {
  const NotificationsTab({super.key, required this.data, this.onOpen});
  final HomeData data;
  /// Tapping a notification takes the parent to what it is about.
  final void Function(String type, Map<String, dynamic> info)? onOpen;

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    final items = data.notifications;
    final today = todayCairo();
    final yesterday = todayCairo(clock().subtract(const Duration(days: 1)));
    final groups = <String, List<Map<String, dynamic>>>{};
    for (final n in items) {
      groups.putIfAbsent(dateCairo(n['createdAt'] as String), () => []).add(n);
    }
    String dayLabel(String d) => d == today ? s.today : d == yesterday ? s.yesterday : s.dayMonth(d);

    return RefreshIndicator(
      color: c.primary,
      onRefresh: data.load,
      child: ListView(
        padding: const EdgeInsets.only(bottom: 24),
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 12),
            child: Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
              Expanded(child: Text(s.tabNotifs, style: Brand.display(context, size: 24))),
              if (data.unread > 0)
                TextButton(
                  onPressed: () => data.markRead(items.where((n) => n['readAt'] == null).map((n) => n['id'] as String)),
                  child: Text(s.markAllRead, style: const TextStyle(fontSize: 13)),
                ),
            ]),
          ),
          if (data.error != null && items.isEmpty) Padding(padding: const EdgeInsets.symmetric(horizontal: 20), child: ErrorBox(s.offline)),
          if (data.loaded && data.error == null && items.isEmpty)
            Padding(padding: const EdgeInsets.symmetric(horizontal: 20), child: Text(s.noNotifs, style: TextStyle(color: c.ink2, fontSize: 15, height: 1.5))),
          for (final g in groups.entries) ...[
            Padding(padding: const EdgeInsets.fromLTRB(20, 10, 20, 6), child: Text(dayLabel(g.key), style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: c.ink2))),
            for (final n in g.value) _Row(n: n, data: data, onOpen: onOpen),
          ],
        ],
      ),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({required this.n, required this.data, this.onOpen});
  final Map<String, dynamic> n;
  final HomeData data;
  final void Function(String type, Map<String, dynamic> info)? onOpen;

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    final unread = n['readAt'] == null;
    final type = n['type'] as String;
    final info = (n['data'] as Map?)?.cast<String, dynamic>() ?? const <String, dynamic>{};
    final child = data.child(info['studentId'] as String?);
    final name = child?['firstName'] as String? ?? '';
    final (glyph, fg, bg) = switch (type) {
      'attendance.arrived' => ('→', c.pFg, c.pBg),
      'attendance.lessonPresent' || 'excuse.approved' => ('✓', c.pFg, c.pBg),
      'attendance.absentCheck' => ('?', c.lFg, c.lBg),
      'attendance.left' => ('←', c.eFg, c.eBg),
      'attendance.absent' || 'attendance.lessonAbsent' || 'excuse.rejected' => ('×', c.aFg, c.aBg),
      'announcement.emergency' || 'meeting.cancelled' => ('!', c.aFg, c.aBg),
      'announcement.new' || 'message.new' => ('✉', c.eFg, c.eBg),
      'poll.new' => ('?', c.lFg, c.lBg),
      'marks.published' => ('A', c.pFg, c.pBg),
      'reportCard.published' => ('▤', c.pFg, c.pBg),
      'behaviour.note' => switch (info['kind']) { 'PRAISE' => ('★', c.pFg, c.pBg), 'INCIDENT' => ('⚠', c.aFg, c.aBg), _ => ('!', c.lFg, c.lBg) },
      _ => ('i', c.eFg, c.eBg),
    };
    final text = child == null && !S.schoolNotificationTypes.contains(type)
        ? n['title'] as String
        : s.notification(type, name, info, n['title'] as String, child?['gender'] as String?);
    final who = child == null
        ? n['body'] as String
        : ltr([child['class']?['name'], '${child['firstName']} ${child['lastName']}'].whereType<String>().join(' · '));

    return Semantics(
      label: unread ? s.unread : null,
      child: InkWell(
        onTap: () {
          // A failed mark-as-read (no network) isn't worth interrupting the parent for.
          if (unread) data.markRead([n['id'] as String]).catchError((_) {});
          onOpen?.call(type, info);
        },
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
          decoration: BoxDecoration(color: unread ? c.unread : null, border: Border(top: BorderSide(color: c.line))),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Container(
              width: 28,
              height: 28,
              alignment: Alignment.center,
              decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(7)),
              child: ExcludeSemantics(child: Text(glyph, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: fg))),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(text, style: TextStyle(fontSize: 15, height: 1.4, fontWeight: unread ? FontWeight.w600 : FontWeight.w400)),
                const SizedBox(height: 2),
                Text(who, style: TextStyle(fontSize: 12, color: c.ink3)),
              ]),
            ),
            const SizedBox(width: 12),
            Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
              Text(timeCairo(n['createdAt'] as String), style: TextStyle(fontSize: 12, color: c.ink2, fontFeatures: const [FontFeature.tabularFigures()])),
              if (unread) ...[const SizedBox(height: 6), Container(width: 8, height: 8, decoration: BoxDecoration(color: c.primary, shape: BoxShape.circle))],
            ]),
          ]),
        ),
      ),
    );
  }
}
