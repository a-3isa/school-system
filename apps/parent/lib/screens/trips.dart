import 'package:flutter/material.dart';

import '../api.dart';
import '../strings.dart';
import '../theme.dart';
import '../widgets.dart';
import 'home.dart';

/// School trips for a child's class: what the trip is, and the permission slip a parent signs with their full name.
class TripsScreen extends StatefulWidget {
  const TripsScreen({super.key, required this.api, required this.data, this.openTripId});
  final Api api;
  final HomeData data;
  /// A trip to open straight away (from a notification).
  final String? openTripId;

  @override
  State<TripsScreen> createState() => _TripsScreenState();
}

class _TripsScreenState extends State<TripsScreen> {
  late String? _childId = widget.data.childId;
  List<Map<String, dynamic>>? _trips;
  String? _error;
  bool _opened = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final id = _childId;
    if (id == null) return;
    try {
      final trips = await widget.api.trips(id);
      if (!mounted || id != _childId) return;
      setState(() {
        _trips = trips;
        _error = null;
      });
      final want = widget.openTripId;
      if (want != null && !_opened) {
        _opened = true;
        final trip = trips.where((t) => t['id'] == want).firstOrNull;
        if (trip != null) _open(trip);
      }
    } catch (e) {
      if (mounted) setState(() => _error = S.of(context).apiError(e));
    }
  }

  Future<void> _open(Map<String, dynamic> trip) async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => TripScreen(api: widget.api, data: widget.data, childId: _childId!, trip: trip)));
    if (mounted) _load();
  }

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final kids = widget.data.children;
    final trips = _trips;
    return FormPage(
      title: s.tileTrips,
      sub: s.tripsSub,
      onBack: () => Navigator.of(context).pop(),
      children: [
        if (kids.length > 1)
          ChildSwitch(
            kids: kids,
            selected: _childId,
            onPick: (id) {
              setState(() {
                _childId = id;
                _trips = null;
              });
              _load();
            },
          ),
        if (_error != null) ErrorBox(_error!),
        if (trips == null && _error == null) const Center(child: CircularProgressIndicator()),
        if (trips != null && trips.isEmpty) EmptyState(icon: Icons.directions_bus_outlined, title: s.noTrips),
        for (final t in trips ?? const <Map<String, dynamic>>[]) ...[
          _TripRow(trip: t, onTap: () => _open(t)),
          const SizedBox(height: 10),
        ],
      ],
    );
  }
}

class _TripRow extends StatelessWidget {
  const _TripRow({required this.trip, required this.onTap});
  final Map<String, dynamic> trip;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    final status = trip['status'] as String;
    final mine = trip['myConsent'] as Map<String, dynamic>?;
    final cancelled = status == 'CANCELLED';
    final (label, fg) = cancelled
        ? (s.tripCancelledNote, c.ink3)
        : mine != null
            ? ('✓ ${s.tripAnsweredTag}', c.pFg)
            : trip['canAnswer'] == true
                ? ('! ${s.tripNeedsAnswer}', c.lFg)
                : ('', c.ink3);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(Brand.panel),
      child: Opacity(
        opacity: cancelled ? .6 : 1,
        child: Panel(
          child: Row(children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(trip['title'] as String, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                const SizedBox(height: 2),
                Text('${s.dayLine((trip['date'] as String).substring(0, 10))} · ${trip['destination']}', style: TextStyle(fontSize: 14, color: c.ink2)),
                if (label.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Text(label, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: fg)),
                ],
              ]),
            ),
            Icon(Icons.chevron_right, color: c.ink3),
          ]),
        ),
      ),
    );
  }
}

/// One trip, and the permission slip: the declaration, a field for the parent's full name as their signature, and Yes or No.
class TripScreen extends StatefulWidget {
  const TripScreen({super.key, required this.api, required this.data, required this.childId, required this.trip});
  final Api api;
  final HomeData data;
  final String childId;
  final Map<String, dynamic> trip;

  @override
  State<TripScreen> createState() => _TripScreenState();
}

class _TripScreenState extends State<TripScreen> {
  late Map<String, dynamic> _trip = widget.trip;
  final _name = TextEditingController();
  final _note = TextEditingController();
  bool _changing = false;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _answer(String decision) async {
    final s = S.of(context);
    if (_name.text.trim().length < 3) {
      setState(() => _error = s.slipNeedsName);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.api.answerTrip(widget.childId, _trip['id'] as String, decision, _name.text.trim(), _note.text);
      final fresh = (await widget.api.trips(widget.childId)).where((t) => t['id'] == _trip['id']).firstOrNull;
      if (!mounted) return;
      setState(() {
        if (fresh != null) _trip = fresh;
        _changing = false;
      });
    } catch (e) {
      if (mounted) setState(() => _error = s.apiError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    final child = widget.data.child(widget.childId);
    final name = child?['firstName'] as String? ?? '';
    final status = _trip['status'] as String;
    final mine = _trip['myConsent'] as Map<String, dynamic>?;
    final canAnswer = _trip['canAnswer'] == true;
    final fee = _trip['fee'] as int?;
    final description = _trip['description'] as String?;
    final by = _trip['consentBy'] as String;

    Widget fact(String label, String value) => Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SizedBox(width: 92, child: Text(label, style: TextStyle(fontSize: 13, color: c.ink2))),
            Expanded(child: Text(value, style: const TextStyle(fontSize: 15, height: 1.35))),
          ]),
        );

    return FormPage(
      title: _trip['title'] as String,
      sub: _trip['destination'] as String,
      onBack: () => Navigator.of(context).pop(),
      children: [
        Panel(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            fact(s.tripWhen, s.dayLine((_trip['date'] as String).substring(0, 10))),
            fact('', s.tripTimes(_trip['departTime'] as String, _trip['returnTime'] as String)),
            if (fee != null) fact(s.tripFeeLabel, s.tripFeeEgp(fee) + (_trip['paid'] == true ? ' · ✓ ${s.paidTag}' : '')),
            if (description != null && description.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 4), child: Text(description, style: const TextStyle(fontSize: 14, height: 1.45))),
          ]),
        ),
        const SizedBox(height: 14),
        if (status == 'CANCELLED')
          Notice(title: s.tripCancelledNote, fg: c.aFg, bg: c.aBg)
        else ...[
          Text(s.permissionSlip, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: c.ink2)),
          const SizedBox(height: 8),
          if (mine != null && !_changing)
            Notice(
              title: (mine['decision'] == 'GIVEN' ? s.answeredGiven : s.answeredDeclined)(s.dayMonth(dateCairo(mine['at'] as String)), timeCairo(mine['at'] as String), mine['signedName'] as String),
              fg: mine['decision'] == 'GIVEN' ? c.pFg : c.lFg,
              bg: mine['decision'] == 'GIVEN' ? c.pBg : c.lBg,
              actions: canAnswer ? [OutlinedButton(onPressed: () => setState(() => _changing = true), child: Text(s.changeAnswer))] : const [],
            )
          else if (canAnswer) ...[
            Text(s.slipDeclaration(name, child?['gender'] as String?), style: const TextStyle(fontSize: 15, height: 1.5)),
            const SizedBox(height: 12),
            Labeled(
              label: s.signName,
              child: TextField(controller: _name, textCapitalization: TextCapitalization.words, autofillHints: const [AutofillHints.name], decoration: const InputDecoration()),
            ),
            const SizedBox(height: 12),
            Labeled(label: s.slipNote, child: TextField(controller: _note, minLines: 2, maxLines: 4, decoration: const InputDecoration())),
            const SizedBox(height: 8),
            Text(s.answerBy(s.dayMonth(dateCairo(by)), timeCairo(by)), style: TextStyle(fontSize: 13, color: c.ink2)),
            if (_error != null) ...[const SizedBox(height: 10), ErrorBox(_error!)],
            const SizedBox(height: 14),
            FilledButton(onPressed: _busy ? null : () => _answer('GIVEN'), child: Text(s.givePermission)),
            const SizedBox(height: 8),
            OutlinedButton(onPressed: _busy ? null : () => _answer('DECLINED'), child: Text(s.declinePermission)),
            if (_changing) TextButton(onPressed: () => setState(() => _changing = false), child: Text(s.keepClub)),
          ] else
            Notice(title: s.tripAnswersClosed, fg: c.eFg, bg: c.eBg),
        ],
      ],
    );
  }
}
