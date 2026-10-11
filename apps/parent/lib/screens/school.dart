import 'package:flutter/material.dart';

import '../api.dart';
import '../strings.dart';
import '../theme.dart';
import '../widgets.dart';
import 'behaviour.dart';
import 'grades.dart';
import 'home.dart';
import 'meetings.dart';

/// One way into a part of school life. A tile shows only when the school has
/// the module (or feature) and the app has a screen for it.
class _Tile {
  const _Tile(this.key, this.icon, this.label, this.on);
  final String key;
  final IconData icon;
  final String Function(S) label;
  final bool Function(HomeData) on;
}

final _tiles = <_Tile>[
  _Tile('grades', Icons.grade_outlined, (s) => s.tileGrades, (d) => d.has('academics')),
  _Tile('behaviour', Icons.emoji_events_outlined, (s) => s.tileBehaviour, (d) => d.has('behavior')),
  _Tile('clubs', Icons.groups_outlined, (s) => s.tileClubs, (d) => d.has('activities')),
  _Tile('trips', Icons.directions_bus_outlined, (s) => s.tileTrips, (d) => d.has('activities', 'trips')),
  _Tile('calendar', Icons.calendar_month_outlined, (s) => s.tileCalendar, (d) => d.has('activities', 'events')),
  _Tile('meetings', Icons.event_outlined, (s) => s.tileMeetings, (d) => d.has('messaging', 'meetings')),
];

/// The screen behind each tile, by its key. Each feature adds its own when it is built.
final Map<String, Widget Function(Api, HomeData)> _screens = {
  'grades': (api, data) => GradesScreen(api: api, data: data),
  'behaviour': (api, data) => BehaviourScreen(api: api, data: data),
  'meetings': (api, data) => MeetingsScreen(api: api, data: data),
};

/// Whether the school has anything for the School tab at all.
bool hasSchoolTab(HomeData data) => _tiles.any((t) => t.on(data));

/// The hub for grades, behaviour, clubs, trips, the calendar and meetings.
class SchoolTab extends StatelessWidget {
  const SchoolTab({super.key, required this.api, required this.data});
  final Api api;
  final HomeData data;

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    final open = _tiles.where((t) => t.on(data) && _screens.containsKey(t.key)).toList();
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 10, 20, 24),
      children: [
        Text(s.tabSchool, style: Brand.display(context, size: 24)),
        const SizedBox(height: 14),
        if (open.isEmpty) EmptyState(icon: Icons.school_outlined, title: s.schoolNothingYet),
        for (final t in open) ...[
          Panel(
            padding: EdgeInsets.zero,
            // The panel paints the background, so the tile gets its own Material for the touch ripple.
            child: Material(
              type: MaterialType.transparency,
              child: ListTile(
                leading: Icon(t.icon, color: c.primary),
                title: Text(t.label(s), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                trailing: Icon(Icons.chevron_right, color: c.ink3),
                onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => _screens[t.key]!(api, data))),
              ),
            ),
          ),
          const SizedBox(height: 10),
        ],
      ],
    );
  }
}
