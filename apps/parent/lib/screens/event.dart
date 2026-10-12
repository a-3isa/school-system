import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../api.dart';
import '../strings.dart';
import '../theme.dart';
import '../widgets.dart';

/// One school event: when and where, what it is, and its photos (tap one to see it full size).
class EventScreen extends StatefulWidget {
  const EventScreen({super.key, required this.api, required this.eventId});
  final Api api;
  final String eventId;

  @override
  State<EventScreen> createState() => _EventScreenState();
}

class _EventScreenState extends State<EventScreen> {
  Map<String, dynamic>? _event;
  String? _error;

  @override
  void initState() {
    super.initState();
    widget.api.event(widget.eventId).then((e) {
      if (mounted) setState(() => _event = e);
    }).catchError((Object e) {
      if (mounted) setState(() => _error = S.of(context).apiError(e));
    });
  }

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    final e = _event;
    String? when;
    if (e != null) {
      final start = e['startsAt'] as String;
      final end = e['endsAt'] as String;
      final day = dateCairo(start);
      final lastDay = dateCairo(end);
      final span = day == lastDay ? s.dayLine(day) : '${s.dayLine(day)} – ${s.dayLine(lastDay)}';
      when = e['allDay'] == true ? span : '$span · ${ltr('${timeCairo(start)}–${timeCairo(end)}')}';
    }
    final photos = ((e?['photos'] as List?) ?? const []).cast<Map<String, dynamic>>();
    return FormPage(
      title: e?['title'] as String? ?? s.eventPhotos,
      sub: when,
      onBack: () => Navigator.of(context).pop(),
      children: [
        if (_error != null) ErrorBox(_error!),
        if (e == null && _error == null) const Center(child: CircularProgressIndicator()),
        if (e != null) ...[
          if ((e['place'] as String?)?.isNotEmpty == true) Row(children: [Icon(Icons.place_outlined, size: 18, color: c.ink2), const SizedBox(width: 6), Expanded(child: Text(e['place'] as String, style: const TextStyle(fontSize: 15)))]),
          if ((e['description'] as String?)?.isNotEmpty == true) ...[const SizedBox(height: 12), Text(e['description'] as String, style: const TextStyle(fontSize: 15, height: 1.5))],
          if (photos.isNotEmpty) ...[
            const SizedBox(height: 18),
            Text(s.eventPhotos, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: c.ink2)),
            const SizedBox(height: 8),
            GridView.count(
              crossAxisCount: 3,
              mainAxisSpacing: 6,
              crossAxisSpacing: 6,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              children: [for (final p in photos) _Photo(api: widget.api, eventId: widget.eventId, photo: p)],
            ),
          ],
        ],
      ],
    );
  }
}

/// A photo fetched with the login token: a small tile, and the full picture when tapped.
class _Photo extends StatefulWidget {
  const _Photo({required this.api, required this.eventId, required this.photo});
  final Api api;
  final String eventId;
  final Map<String, dynamic> photo;

  @override
  State<_Photo> createState() => _PhotoState();
}

class _PhotoState extends State<_Photo> {
  Uint8List? _bytes;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    widget.api.bytes('/events/${widget.eventId}/photos/${widget.photo['id']}').then((b) {
      if (mounted) setState(() => b == null ? _failed = true : _bytes = b);
    });
  }

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    final caption = widget.photo['caption'] as String?;
    return Semantics(
      label: caption == null || caption.isEmpty ? s.photoOpen : caption,
      button: true,
      child: GestureDetector(
        onTap: _bytes == null
            ? null
            : () => Navigator.of(context).push(MaterialPageRoute(
                  builder: (_) => Scaffold(
                    backgroundColor: Colors.black,
                    appBar: AppBar(backgroundColor: Colors.black, foregroundColor: Colors.white, title: caption == null ? null : Text(caption, style: const TextStyle(fontSize: 15))),
                    body: Center(child: InteractiveViewer(child: Image.memory(_bytes!))),
                  ),
                )),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(6),
          child: Container(
            color: c.sunk,
            child: _bytes != null
                ? Image.memory(_bytes!, fit: BoxFit.cover)
                : Center(child: _failed ? Icon(Icons.broken_image_outlined, color: c.ink3) : const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))),
          ),
        ),
      ),
    );
  }
}
