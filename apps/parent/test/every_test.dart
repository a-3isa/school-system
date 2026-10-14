import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:parent_app/every.dart';

void main() {
  void goTo(WidgetTester tester, List<AppLifecycleState> states) {
    for (final s in states) {
      tester.binding.handleAppLifecycleStateChanged(s);
    }
  }

  testWidgets('refreshes only while the app is in front, and catches up on coming back', (tester) async {
    var calls = 0;
    final every = Every(const Duration(seconds: 30), () => calls++);
    await tester.pump(const Duration(seconds: 61));
    expect(calls, 2);

    goTo(tester, [AppLifecycleState.inactive, AppLifecycleState.hidden, AppLifecycleState.paused]);
    await tester.pump(const Duration(minutes: 10));
    expect(calls, 2); // nothing while the phone is in the pocket

    goTo(tester, [AppLifecycleState.hidden, AppLifecycleState.inactive, AppLifecycleState.resumed]);
    expect(calls, 3); // one refresh at once, not twenty
    every.cancel();
  });

  testWidgets('does not refresh a tab out of view, and refreshes it when it is shown', (tester) async {
    var calls = 0;
    var showing = false;
    final every = Every(const Duration(seconds: 30), () => calls++, active: () => showing);
    await tester.pump(const Duration(minutes: 2));
    expect(calls, 0);

    every.check(); // still out of view
    expect(calls, 0);
    showing = true;
    every.check();
    expect(calls, 1);
    every.check(); // nothing more was skipped
    expect(calls, 1);
    every.cancel();
  });
}
