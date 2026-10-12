import 'package:flutter/material.dart';

import '../api.dart';
import '../strings.dart';
import '../theme.dart';
import '../widgets.dart';
import 'home.dart';

/// The clubs open to a child's year group: places left, the fee, and joining (or the waiting list) in one tap.
/// A club that meets at the same time as another the child is in is still joinable, with a note.
class ClubsScreen extends StatefulWidget {
  const ClubsScreen({super.key, required this.api, required this.data});
  final Api api;
  final HomeData data;

  @override
  State<ClubsScreen> createState() => _ClubsScreenState();
}

class _ClubsScreenState extends State<ClubsScreen> {
  late String? _childId = widget.data.childId;
  List<Map<String, dynamic>>? _clubs;
  String? _error;
  String? _busyId;
  /// A clash found when joining, by club, shown as a note on that club.
  final Map<String, String> _clash = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final id = _childId;
    if (id == null) return;
    try {
      final clubs = await widget.api.clubs(id);
      if (!mounted || id != _childId) return;
      setState(() {
        _clubs = clubs;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() => _error = S.of(context).apiError(e));
    }
  }

  Future<void> _join(Map<String, dynamic> club) async {
    final id = _childId!;
    setState(() {
      _busyId = club['id'] as String;
      _error = null;
    });
    try {
      final res = await widget.api.joinClub(id, club['id'] as String);
      final clash = res['clash'] as Map<String, dynamic>?;
      if (mounted && clash != null) {
        final s = S.of(context);
        _clash[club['id'] as String] = s.isAr && (clash['nameAr'] as String?)?.isNotEmpty == true ? clash['nameAr'] as String : clash['name'] as String;
      }
      await _load();
    } catch (e) {
      if (mounted) setState(() => _error = S.of(context).apiError(e));
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  Future<void> _leave(Map<String, dynamic> club) async {
    final s = S.of(context);
    final child = widget.data.child(_childId);
    final sure = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        content: Text(s.leaveClubAsk(child?['firstName'] as String? ?? '', s.clubName(club))),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: Text(s.keepClub)),
          TextButton(onPressed: () => Navigator.of(context).pop(true), child: Text(s.yesLeave)),
        ],
      ),
    );
    if (sure != true || !mounted) return;
    setState(() {
      _busyId = club['id'] as String;
      _error = null;
    });
    try {
      await widget.api.leaveClub(_childId!, club['id'] as String);
      _clash.remove(club['id']);
      await _load();
    } catch (e) {
      if (mounted) setState(() => _error = s.apiError(e));
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final kids = widget.data.children;
    final childName = widget.data.child(_childId)?['firstName'] as String? ?? '';
    final clubs = _clubs;
    final joined = clubs?.where((c) => c['status'] != null).toList() ?? const <Map<String, dynamic>>[];
    final open = clubs?.where((c) => c['status'] == null).toList() ?? const <Map<String, dynamic>>[];

    Widget section(String title, List<Map<String, dynamic>> list) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Padding(padding: const EdgeInsets.only(top: 8, bottom: 8), child: Text(title, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: context.c.ink2))),
          for (final c in list) ...[
            _ClubCard(club: c, busy: _busyId == c['id'], clash: _clash[c['id']], onJoin: () => _join(c), onLeave: () => _leave(c)),
            const SizedBox(height: 10),
          ],
        ]);

    return FormPage(
      title: s.clubsTitle,
      sub: s.clubsSub,
      onBack: () => Navigator.of(context).pop(),
      children: [
        if (kids.length > 1)
          ChildSwitch(
            kids: kids,
            selected: _childId,
            onPick: (id) {
              setState(() {
                _childId = id;
                _clubs = null;
              });
              _load();
            },
          ),
        if (_error != null) ErrorBox(_error!),
        if (clubs == null && _error == null) const Center(child: CircularProgressIndicator()),
        if (clubs != null && clubs.isEmpty) EmptyState(icon: Icons.groups_outlined, title: s.noClubs),
        if (joined.isNotEmpty) section(s.joinedClubs, joined),
        if (open.isNotEmpty) section(s.openTo(childName), open),
      ],
    );
  }
}

class _ClubCard extends StatelessWidget {
  const _ClubCard({required this.club, required this.busy, required this.clash, required this.onJoin, required this.onLeave});
  final Map<String, dynamic> club;
  final bool busy;
  final String? clash;
  final VoidCallback onJoin;
  final VoidCallback onLeave;

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    final status = club['status'] as String?;
    final places = club['places'] as int? ?? 0;
    final fee = club['fee'] as int?;
    final supervisor = club['supervisor'] as Map<String, dynamic>?;
    final room = club['room'] as String?;
    final description = club['description'] as String?;

    return Panel(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(s.clubName(club), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
        const SizedBox(height: 2),
        Text(s.clubMeets(s.daysLine(club['days'] as List), club['startTime'] as String, club['endTime'] as String), style: TextStyle(fontSize: 14, color: c.ink2)),
        if (supervisor != null || room != null)
          Text([if (supervisor != null) s.staffName(supervisor), if (room != null) room].join(' · '), style: TextStyle(fontSize: 13, color: c.ink3)),
        if (description != null && description.isNotEmpty) ...[
          const SizedBox(height: 6),
          Text(description, style: const TextStyle(fontSize: 14, height: 1.45)),
        ],
        const SizedBox(height: 8),
        Wrap(spacing: 12, runSpacing: 4, children: [
          Text(s.placesLeft(places), style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: places == 0 ? c.lFg : c.pFg)),
          if (fee != null) Text(s.feePerTerm(fee), style: TextStyle(fontSize: 13, color: c.ink2)),
          if (club['paid'] == true) Text('✓ ${s.paidTag}', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: c.pFg)),
        ]),
        if (status == 'WAITLISTED') ...[
          const SizedBox(height: 8),
          Text('· ${s.waitlistNumber(club['waitlistPosition'] as int? ?? 1)}', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: c.lFg)),
        ],
        if (clash != null) ...[
          const SizedBox(height: 10),
          Notice(title: s.clubClash(clash!), fg: c.lFg, bg: c.lBg),
        ],
        const SizedBox(height: 12),
        if (status == null)
          club['signupOpen'] == true
              ? FilledButton(onPressed: busy ? null : onJoin, child: Text(places == 0 ? s.joinWaitlist : s.joinClub))
              : Text(s.signupClosedClub, style: TextStyle(fontSize: 14, color: c.ink3))
        else
          OutlinedButton(onPressed: busy ? null : onLeave, child: Text(s.leaveClub)),
      ]),
    );
  }
}
