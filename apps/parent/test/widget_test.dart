import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:parent_app/api.dart';
import 'package:parent_app/main.dart';
import 'package:parent_app/settings.dart';
import 'package:parent_app/strings.dart';
import 'package:parent_app/widgets.dart';
import 'package:shared_preferences/shared_preferences.dart';

Future<void> start(WidgetTester tester, Map<String, Object> prefs, [http.Client? client]) async {
  SharedPreferences.setMockInitialValues(prefs);
  final p = await SharedPreferences.getInstance();
  await tester.pumpWidget(ParentApp(api: Api(p, client), settings: AppSettings(p)));
  await tester.pumpAndSettle();
}

/// A signed-in parent of Salma (4-A) on a school day.
MockClient school() {
  final today = todayCairo();
  final routes = <String, Object>{
    '/auth/me': {'id': 'u1', 'name': 'Dina Farouk', 'email': 'dina.farouk@gmail.com', 'phone': '+201005550192', 'phoneVerifiedAt': '2026-09-01T08:00:00.000Z', 'consentAt': '2026-09-01T08:00:00.000Z', 'role': 'PARENT'},
    '/parent/children': [
      {'id': 's1', 'firstName': 'Salma', 'lastName': 'Gamal', 'class': {'id': 'c1', 'name': '4-A'}},
    ],
    '/parent/children/s1/today': {
      'date': today,
      'arrivedAt': '${today}T04:42:00.000Z',
      'leftAt': null,
      'place': null,
      'lessons': [
        {'period': 1, 'startTime': '00:00', 'endTime': '00:01', 'subject': 'English', 'room': 'Room 204', 'status': 'PRESENT'},
        {'period': 2, 'startTime': '00:01', 'endTime': '00:02', 'subject': 'Math', 'room': 'Room 204', 'status': 'ABSENT'},
        {'period': 6, 'startTime': '23:58', 'endTime': '23:59', 'subject': 'Art', 'room': 'Room 204', 'status': null},
      ],
    },
    '/notifications': [
      {'id': 'n1', 'type': 'attendance.lessonAbsent', 'title': 'Salma was absent from Math in Room 204', 'body': '…', 'readAt': null, 'createdAt': DateTime.now().toUtc().toIso8601String(),
        'data': {'studentId': 's1', 'date': today, 'subject': 'Math', 'room': 'Room 204'}},
      {'id': 'n2', 'type': 'attendance.arrived', 'title': 'Salma arrived at school', 'body': '…', 'readAt': '2026-10-01T05:00:00.000Z', 'createdAt': DateTime.now().toUtc().toIso8601String(),
        'data': {'studentId': 's1', 'date': today, 'time': '07:42'}},
    ],
  };
  return MockClient((req) async {
    final body = routes[req.url.path.replaceFirst('/api', '')];
    return body == null ? http.Response('{"message":"Not found"}', 404) : http.Response(jsonEncode(body), 200, headers: {'content-type': 'application/json; charset=utf-8'});
  });
}

void main() {
  testWidgets('shows sign-in when not signed in', (tester) async {
    await start(tester, {'lang': 'en'});
    expect(find.text('Sign in'), findsNWidgets(2)); // the title and the button
    expect(find.text('Email'), findsOneWidget);
    expect(find.text('Password'), findsOneWidget);
    expect(find.text('Activate your account'), findsOneWidget);
  });

  testWidgets('new parents create their account in three steps, starting with the email the school registered', (tester) async {
    await start(tester, {'lang': 'en'});
    await tester.ensureVisible(find.text('Activate your account'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Activate your account'));
    await tester.pumpAndSettle();
    expect(find.text('Step 1 of 3'), findsOneWidget);
    expect(find.text('Send me a code'), findsOneWidget);
    expect(find.text('Password'), findsNothing);
  });

  testWidgets('switches to Arabic, right to left, and remembers it', (tester) async {
    await start(tester, {'lang': 'en'});
    await tester.tap(find.text('عربي'));
    await tester.pumpAndSettle();
    expect(find.text('تسجيل الدخول'), findsNWidgets(2));
    expect(Directionality.of(tester.element(find.text('البريد الإلكتروني'))), TextDirection.rtl);
    expect((await SharedPreferences.getInstance()).getString('lang'), 'ar');
  });

  testWidgets('shows the child’s day: arrival, and every lesson with its status', (tester) async {
    // 10:00 in Cairo: periods 1 and 2 are over, period 6 is still to come.
    clock = () => DateTime.utc(2026, 10, 1, 7);
    addTearDown(() => clock = DateTime.now);
    await start(tester, {'lang': 'en', 'token': 't'}, school());
    expect(find.text('Arrived safely at school'), findsOneWidget);
    expect(find.text('07:42'), findsOneWidget);
    expect(find.text('Math'), findsOneWidget);
    expect(find.text('Present'), findsOneWidget);
    expect(find.text('Absent'), findsOneWidget);
    expect(find.text('Later'), findsOneWidget);
    await tester.pumpWidget(const SizedBox()); // stop the refresh timers
  });

  testWidgets('notifications read well in Arabic and show the unread count', (tester) async {
    await start(tester, {'lang': 'ar', 'token': 't'}, school());
    expect(find.text('1'), findsOneWidget); // unread badge on the tab
    await tester.tap(find.text('الإشعارات'));
    await tester.pumpAndSettle();
    expect(find.text('غياب Salma عن حصة Math في Room 204. وتتابع شؤون الطلبة الأمر.'), findsOneWidget);
    expect(find.text('وصول Salma إلى المدرسة بالسلامة'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });

  test('Arabic agrees with the child’s gender', () {
    expect(S.ar.notification('attendance.arrived', 'سلمى', {}, '', 'FEMALE'), 'وصلت سلمى المدرسة بالسلامة');
    expect(S.ar.notification('attendance.arrived', 'عمر', {}, '', 'MALE'), 'وصل عمر المدرسة بالسلامة');
    expect(S.ar.notification('attendance.left', 'نور', {}, ''), 'انصراف نور من المدرسة مبكرًا'); // gender not recorded
    expect(S.en.notification('attendance.absent', 'Omar', {}, '', 'MALE'), 'Omar is absent today');
  });

  test('phone numbers', () {
    expect(fullPhone('0100 555 0192'), '+201005550192');
    expect(fullPhone('+966 50 123 4567'), '+966501234567');
    expect(prettyPhone('+201005550192'), '+20 100 555 0192');
  });

  test('dates in both languages', () {
    expect(S.en.dayLine('2026-10-01'), 'Thursday 1 October');
    expect(S.ar.dayLine('2026-10-01'), 'الخميس 1 أكتوبر');
  });

  test('Cairo date and summer time', () {
    // 30 Sep 2026 22:30 UTC is already 1 Oct in Cairo (UTC+3 in summer).
    expect(todayCairo(DateTime.utc(2026, 9, 30, 22, 30)), '2026-10-01');
    expect(cairoOffset(DateTime.utc(2026, 12, 15)), 2);
    expect(timeCairo('2026-09-30T04:42:00.000Z'), '07:42');
    expect(nowCairo(DateTime.utc(2026, 10, 1, 7, 11)), '10:11');
  });
}
