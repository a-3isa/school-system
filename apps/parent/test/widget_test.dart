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
    expect(find.text('Email'), findsOneWidget);
    expect(find.text('Password'), findsOneWidget);
    expect(find.textContaining('WhatsApp'), findsNothing);
  });

  testWidgets('new parents create their account with the email the school registered', (tester) async {
    SharedPreferences.setMockInitialValues({});
    final api = Api(await SharedPreferences.getInstance());
    await tester.pumpWidget(ParentApp(api: api));
    await tester.pumpAndSettle();
    await tester.tap(find.text('New here? Create your account'));
    await tester.pumpAndSettle();
    expect(find.text('Create your account'), findsOneWidget);
    expect(find.text('Send me a code'), findsOneWidget);
    expect(find.text('Password'), findsNothing);
  });

  test('Cairo date and summer time', () {
    // 30 Sep 2026 22:30 UTC is already 1 Oct in Cairo (UTC+3 in summer).
    expect(todayCairo(DateTime.utc(2026, 9, 30, 22, 30)), '2026-10-01');
    expect(cairoOffset(DateTime.utc(2026, 12, 15)), 2);
    expect(timeCairo('2026-09-30T04:42:00.000Z'), '07:42');
  });
}
