import 'package:flutter_test/flutter_test.dart';
import 'package:parent_app/api.dart';
import 'package:parent_app/main.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  testWidgets('shows sign-in when not signed in', (tester) async {
    SharedPreferences.setMockInitialValues({});
    final api = Api(await SharedPreferences.getInstance());
    await tester.pumpWidget(ParentApp(api: api));
    await tester.pumpAndSettle();
    expect(find.text('Sign in'), findsOneWidget);
    expect(find.text('Mobile number'), findsOneWidget);
  });

  test('Cairo date and summer time', () {
    // 30 Sep 2026 22:30 UTC is already 1 Oct in Cairo (UTC+3 in summer).
    expect(todayCairo(DateTime.utc(2026, 9, 30, 22, 30)), '2026-10-01');
    expect(cairoOffset(DateTime.utc(2026, 12, 15)), 2);
    expect(timeCairo('2026-09-30T04:42:00.000Z'), '07:42');
  });
}
