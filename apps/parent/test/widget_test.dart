import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:parent_app/api.dart';
import 'package:parent_app/main.dart';
import 'package:parent_app/screens/home.dart';
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
MockClient school({bool straps = false, bool consented = true, bool arrived = true, Map<String, Object?> today_ = const {}, Map<String, Object?> me_ = const {}, Map<String, Object> more = const {}, List<String>? log}) {
  final today = todayCairo();
  final routes = <String, Object>{
    '/auth/me': {'id': 'u1', 'name': 'Dina Farouk', 'email': 'dina.farouk@gmail.com', 'phone': '+201005550192', 'phoneVerifiedAt': '2026-09-01T08:00:00.000Z', 'consentAt': consented ? '2026-09-01T08:00:00.000Z' : null, 'straps': straps, 'role': 'PARENT', ...me_},
    '/parent/children': [
      {'id': 's1', 'firstName': 'Salma', 'lastName': 'Gamal', 'class': {'id': 'c1', 'name': '4-A'}},
    ],
    '/parent/children/s1/today': {
      'date': today,
      'arrivedAt': arrived ? '${today}T04:42:00.000Z' : null,
      'leftAt': null,
      'place': null,
      ...today_,
      'lessons': [
        {'period': 1, 'startTime': '00:00', 'endTime': '00:01', 'subject': 'English', 'room': 'Room 204', 'status': 'PRESENT'},
        {'period': 2, 'startTime': '00:01', 'endTime': '00:02', 'subject': 'Math', 'room': 'Room 204', 'status': 'ABSENT'},
        {'period': 6, 'startTime': '23:58', 'endTime': '23:59', 'subject': 'Art', 'room': 'Room 204', 'status': null},
      ],
    },
    '/parent/children/s1/excuses': [
      {'id': 'x1', 'studentId': 's1', 'fromDate': '2026-09-28T00:00:00.000Z', 'toDate': '2026-09-29T00:00:00.000Z', 'reason': 'SICK', 'note': 'Fever', 'status': 'APPROVED', 'decisionNote': 'Get well soon.', 'hasFile': true},
      {'id': 'x2', 'studentId': 's1', 'fromDate': '2026-09-20T00:00:00.000Z', 'toDate': '2026-09-20T00:00:00.000Z', 'reason': 'FAMILY', 'note': null, 'status': 'REJECTED', 'decisionNote': 'Please send a note.', 'hasFile': false},
    ],
    '/parent/children/s1/absence-check': {'answer': 'KNOWS', 'alerted': false},
    '/notifications': [
      {'id': 'n1', 'type': 'attendance.lessonAbsent', 'title': 'Salma was absent from Math in Room 204', 'body': '…', 'readAt': null, 'createdAt': DateTime.now().toUtc().toIso8601String(),
        'data': {'studentId': 's1', 'date': today, 'subject': 'Math', 'room': 'Room 204'}},
      {'id': 'n2', 'type': 'attendance.arrived', 'title': 'Salma arrived at school', 'body': '…', 'readAt': '2026-10-01T05:00:00.000Z', 'createdAt': DateTime.now().toUtc().toIso8601String(),
        'data': {'studentId': 's1', 'date': today, 'time': '07:42'}},
    ],
  };
  routes.addAll(more);
  return MockClient((req) async {
    log?.add('${req.method} ${req.url.path.replaceFirst('/api', '')} ${req.body}');
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

  testWidgets('a school without smart bands never asks for tracking consent or shows an arrival', (tester) async {
    clock = () => DateTime.utc(2026, 10, 1, 7);
    addTearDown(() => clock = DateTime.now);
    await start(tester, {'lang': 'en', 'token': 't'}, school(consented: false, arrived: false));
    expect(find.text('I agree'), findsNothing);
    expect(find.text('Not yet arrived'), findsNothing);
    expect(find.text('Math'), findsOneWidget); // straight to the child's day
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('a school with smart bands asks for consent first', (tester) async {
    await start(tester, {'lang': 'en', 'token': 't'}, school(straps: true, consented: false));
    expect(find.text('I agree'), findsOneWidget);
    expect(find.text('Math'), findsNothing);
  });

  testWidgets('with smart bands, a child who has not arrived says so', (tester) async {
    clock = () => DateTime.utc(2026, 10, 1, 7);
    addTearDown(() => clock = DateTime.now);
    await start(tester, {'lang': 'en', 'token': 't'}, school(straps: true, arrived: false));
    expect(find.text('Not yet arrived'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });

  Future<void> dayWith(WidgetTester tester, Map<String, Object?> extra, {List<String>? log}) async {
    clock = () => DateTime.utc(2026, 10, 1, 7);
    addTearDown(() => clock = DateTime.now);
    await start(tester, {'lang': 'en', 'token': 't'}, school(today_: extra, log: log));
  }

  testWidgets('asks whether the parent knows when the child didn’t come, and No tells the school', (tester) async {
    final log = <String>[];
    await dayWith(tester, {'check': {'askedAt': '2026-10-01T05:00:00.000Z', 'answer': null, 'alerted': false}}, log: log);
    expect(find.text('Salma didn’t come to school today'), findsOneWidget);
    expect(find.text('Yes, I know'), findsOneWidget);
    await tester.tap(find.text('No, I don’t'));
    await tester.pumpAndSettle();
    expect(log.where((l) => l.startsWith('POST /parent/children/s1/absence-check')).single, contains('"knows":false'));
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('Yes opens the excuse form for today', (tester) async {
    final log = <String>[];
    await dayWith(tester, {'check': {'askedAt': '2026-10-01T05:00:00.000Z', 'answer': null, 'alerted': false}}, log: log);
    await tester.tap(find.text('Yes, I know'));
    await tester.pumpAndSettle();
    expect(log.any((l) => l.contains('"knows":true')), isTrue);
    expect(find.text('Send an excuse'), findsOneWidget);
    expect(find.text('Illness'), findsOneWidget);
    expect(find.text('Send the excuse', skipOffstage: false), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('after No, the parent is told the school will call', (tester) async {
    await dayWith(tester, {'check': {'askedAt': '2026-10-01T05:00:00.000Z', 'answer': 'DOESNT_KNOW', 'alerted': true}});
    expect(find.textContaining('will call you'), findsOneWidget);
    expect(find.text('Yes, I know'), findsNothing);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('shows where the excuse stands: waiting, accepted, or not accepted with a way to send another', (tester) async {
    await dayWith(tester, {'excuse': {'id': 'x', 'status': 'PENDING', 'reason': 'SICK', 'decisionNote': null}});
    expect(find.textContaining('waiting for the school'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    await dayWith(tester, {'excuse': {'id': 'x', 'status': 'APPROVED', 'reason': 'SICK', 'decisionNote': null}});
    expect(find.text('The school accepted your excuse.'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    await dayWith(tester, {'excuse': {'id': 'x', 'status': 'REJECTED', 'reason': 'SICK', 'decisionNote': 'We need a doctor’s note.'}});
    expect(find.textContaining('did not accept the excuse. We need a doctor’s note.'), findsOneWidget);
    expect(find.text('Send a new excuse'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('lists the excuses sent, with the school’s decision', (tester) async {
    await dayWith(tester, {});
    await tester.tap(find.text('Excuses'));
    await tester.pumpAndSettle();
    expect(find.text('Accepted'), findsOneWidget);
    expect(find.text('Not accepted'), findsOneWidget);
    expect(find.text('Get well soon.'), findsOneWidget);
    expect(find.text('Please send a note.'), findsOneWidget);
    expect(find.text('New excuse'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('the question reads well in Arabic, agreeing with the child’s gender', (tester) async {
    expect(S.ar.didntCome('سلمى', 'FEMALE'), 'لم تحضر سلمى إلى المدرسة اليوم');
    expect(S.ar.didntCome('عمر', 'MALE'), 'لم يحضر عمر إلى المدرسة اليوم');
    expect(S.ar.notification('attendance.absentCheck', 'سلمى', {}, '', 'FEMALE'), contains('هل تعلمون السبب'));
    expect(S.en.notification('excuse.rejected', 'Salma', {}, ''), 'The school did not accept Salma’s excuse');
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

  group('tabs by module', () {
    Map<String, Object?> meWith(List<String> modules, [Map<String, Object?> features = const {}]) => {'modules': modules, 'features': features};

    testWidgets('a school with only attendance shows Today, Notifications and Account', (tester) async {
      clock = () => DateTime.utc(2026, 10, 1, 7);
      addTearDown(() => clock = DateTime.now);
      await start(tester, {'lang': 'en', 'token': 't'}, school(me_: meWith(['core', 'attendance'])));
      expect(find.text('Today'), findsOneWidget);
      expect(find.text('Notifications'), findsOneWidget);
      expect(find.text('Account'), findsOneWidget);
      expect(find.text('Messages'), findsNothing);
      expect(find.text('School'), findsNothing);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('messaging and academics add Messages and School', (tester) async {
      clock = () => DateTime.utc(2026, 10, 1, 7);
      addTearDown(() => clock = DateTime.now);
      await start(tester, {'lang': 'en', 'token': 't'}, school(me_: meWith(['core', 'attendance', 'messaging', 'academics'])));
      for (final label in ['Today', 'Messages', 'School', 'Notifications', 'Account']) {
        expect(find.text(label), findsOneWidget, reason: label);
      }
      await tester.tap(find.text('Messages'));
      await tester.pumpAndSettle();
      expect(find.text('Messages from the school will appear here.'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('the tabs speak Arabic', (tester) async {
      clock = () => DateTime.utc(2026, 10, 1, 7);
      addTearDown(() => clock = DateTime.now);
      await start(tester, {'lang': 'ar', 'token': 't'}, school(me_: meWith(['core', 'messaging'])));
      for (final label in ['اليوم', 'الرسائل', 'الإشعارات', 'الحساب']) {
        expect(find.text(label), findsOneWidget, reason: label);
      }
      await tester.pumpWidget(const SizedBox());
    });
  });

  group('HomeData', () {
    Future<HomeData> loaded({Map<String, dynamic> me = const {}}) async {
      SharedPreferences.setMockInitialValues({'lang': 'en', 'token': 't'});
      final api = Api(await SharedPreferences.getInstance(), school(more: {
        '/parent/children': [
          {'id': 's1', 'firstName': 'Salma', 'class': {'name': '4-A'}},
          {'id': 's2', 'firstName': 'Omar', 'class': {'name': '2-B'}},
        ],
      }));
      final data = HomeData(api, me);
      await data.load();
      return data;
    }

    test('starts on the first child, and every tab sees a change of child', () async {
      final data = await loaded();
      expect(data.childId, 's1');
      var told = 0;
      data.addListener(() => told++);
      data.selectChild('s2');
      data.selectChild('s2'); // already chosen: nobody is told again
      expect(data.childId, 's2');
      expect(told, 1);
      await data.load(); // a refresh keeps the choice
      expect(data.childId, 's2');
    });

    test('knows the school’s modules and their features', () async {
      final data = await loaded(me: {
        'modules': ['core', 'messaging'],
        'features': {'messaging': {'chat': true, 'polls': false}},
      });
      expect(data.has('messaging'), isTrue);
      expect(data.has('messaging', 'chat'), isTrue);
      expect(data.has('messaging', 'polls'), isFalse);
      expect(data.has('messaging', 'meetings'), isFalse);
      expect(data.has('academics'), isFalse);
      expect((await loaded()).has('messaging'), isFalse);
    });
  });
}
