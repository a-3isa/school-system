import 'dart:async';

import 'package:flutter/widgets.dart';

/// Calls [run] every [period], but only while the app is in front and [active] says the screen is
/// showing (a tab kept alive behind another one isn't). A call skipped meanwhile is made once, as soon
/// as both are true again, so coming back to the app shows fresh data at once.
class Every with WidgetsBindingObserver {
  Every(Duration period, this.run, {bool Function()? active}) : _active = active ?? _always {
    final state = WidgetsBinding.instance.lifecycleState;
    _inFront = state == null || state == AppLifecycleState.resumed;
    WidgetsBinding.instance.addObserver(this);
    _timer = Timer.periodic(period, (_) => _tick());
  }

  static bool _always() => true;
  final void Function() run;
  final bool Function() _active;
  late final Timer _timer;
  late bool _inFront;
  bool _due = false;

  bool get _showing => _inFront && _active();

  void _tick() {
    if (_showing) {
      _due = false;
      run();
    } else {
      _due = true;
    }
  }

  /// Makes the skipped call, if there is one and the screen is showing now (e.g. its tab was chosen).
  void check() {
    if (!_due || !_showing) return;
    _due = false;
    run();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _inFront = state == AppLifecycleState.resumed;
    check();
  }

  void cancel() {
    _timer.cancel();
    WidgetsBinding.instance.removeObserver(this);
  }
}
