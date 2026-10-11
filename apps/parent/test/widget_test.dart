import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:parent_app/api.dart';
import 'package:parent_app/main.dart';
import 'package:parent_app/push.dart';
import 'package:parent_app/screens/home.dart';
import 'package:parent_app/settings.dart';
import 'package:parent_app/socket.dart';
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
    '/parent/announcements': [],
    '/parent/announcements/emergency': [],
    '/parent/polls': [],
    '/parent/threads': [],
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
    var body = routes[req.url.path.replaceFirst('/api', '')];
    if (body is Object Function(http.Request)) body = body(req);
    return body == null ? http.Response('{"message":"Not found"}', 404) : http.Response(jsonEncode(body), 200, headers: {'content-type': 'application/json; charset=utf-8'});
  });
}

/// A live connection the test can push messages through.
class FakeChatSocket implements ChatSocket {
  final _messages = StreamController<Map<String, dynamic>>.broadcast();
  final _reads = StreamController<Map<String, dynamic>>.broadcast();
  void push(Map<String, dynamic> e) => _messages.add(e);
  void pushRead(Map<String, dynamic> e) => _reads.add(e);
  @override
  Stream<Map<String, dynamic>> get messages => _messages.stream;
  @override
  Stream<Map<String, dynamic>> get reads => _reads.stream;
  @override
  bool get connected => true;
  @override
  Stream<bool> get connection => const Stream.empty();
  @override
  void dispose() {}
}

/// A push layer the test can watch and trigger.
class FakePush implements Push {
  final started = <String>[];
  final langs = <String>[];
  var stopped = 0;
  final _arrived = StreamController<void>.broadcast();
  final _opened = StreamController<Map<String, dynamic>>.broadcast();
  Map<String, dynamic>? launch;
  void arrive() => _arrived.add(null);
  void tap(Map<String, dynamic> data) => _opened.add(data);
  @override
  Future<void> start(Api api, String lang) async => started.add(lang);
  @override
  Future<void> setLang(Api api, String lang) async => langs.add(lang);
  @override
  Future<void> stop(Api api) async => stopped++;
  @override
  Stream<void> get arrived => _arrived.stream;
  @override
  Stream<Map<String, dynamic>> get opened => _opened.stream;
  @override
  Future<Map<String, dynamic>?> takeLaunch() async {
    final l = launch;
    launch = null;
    return l;
  }
  @override
  void dispose() {}
}

void main() {
  setUp(() => pushFactory = () => NoPush());
  // No test opens a real connection.
  setUp(() => chatSocketFactory = (_) => NoChatSocket());

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
      expect(find.text('Nothing from the school yet.'), findsOneWidget);
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

  group('messaging', () {
    const all = {
      'messaging': {'chat': true, 'polls': true, 'meetings': true},
    };
    Map<String, Object?> messagingMe() => {
          'modules': ['core', 'attendance', 'messaging'],
          'features': all,
        };
    const hana = {'id': 't1', 'name': 'Hana Nabil', 'honorific': 'MS', 'role': 'TEACHER'};
    const salma = {'id': 's1', 'firstName': 'Salma', 'class': {'name': '4-A'}};
    final at = '2026-10-01T07:30:00.000Z';

    Future<void> openMessages(WidgetTester tester, MockClient client) async {
      clock = () => DateTime.utc(2026, 10, 1, 7);
      addTearDown(() => clock = DateTime.now);
      await start(tester, {'lang': 'en', 'token': 't'}, client);
      await tester.tap(find.text('Messages'));
      await tester.pumpAndSettle();
    }

    testWidgets('the news feed shows announcements and polls, and a vote sends the chosen answer', (tester) async {
      final log = <String>[];
      await openMessages(
        tester,
        school(
          log: log,
          me_: messagingMe(),
          more: {
            '/parent/announcements': [
              {'id': 'a1', 'title': 'Sports day', 'body': 'Please send trainers on Sunday.', 'priority': 'NORMAL', 'sentAt': at, 'readAt': null, 'hasFile': false},
            ],
            '/parent/polls': [
              {'id': 'p1', 'question': 'Which lunch?', 'multiple': false, 'open': true, 'myVotes': [], 'createdAt': '2026-10-01T06:00:00.000Z', 'options': [
                {'id': 'o1', 'label': 'Pasta'},
                {'id': 'o2', 'label': 'Rice'},
              ]},
            ],
          },
        ),
      );
      expect(find.text('Sports day'), findsOneWidget);
      expect(find.text('Which lunch?'), findsOneWidget);
      expect(find.text('Send my answer'), findsOneWidget);
      await tester.tap(find.text('Rice'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Send my answer'));
      await tester.tap(find.text('Send my answer'));
      await tester.pumpAndSettle();
      expect(log.where((l) => l.startsWith('POST /parent/polls/p1/vote')).single, contains('"optionIds":["o2"]'));
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('a poll the parent answered thanks them, or shows the result when the school allows it', (tester) async {
      await openMessages(
        tester,
        school(
          me_: messagingMe(),
          more: {
            '/parent/polls': [
              {'id': 'p1', 'question': 'Thanks?', 'multiple': false, 'open': true, 'myVotes': ['o1'], 'createdAt': at, 'options': [{'id': 'o1', 'label': 'Yes'}]},
              {'id': 'p2', 'question': 'Result?', 'multiple': false, 'open': false, 'myVotes': ['o1'], 'voters': 4, 'createdAt': '2026-10-01T06:00:00.000Z', 'options': [
                {'id': 'o1', 'label': 'Pasta', 'votes': 3},
                {'id': 'o2', 'label': 'Rice', 'votes': 1},
              ]},
            ],
          },
        ),
      );
      expect(find.text('Thank you. Your answer has been received.'), findsOneWidget);
      expect(find.text('3 votes'), findsOneWidget);
      expect(find.text('1 vote'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('an urgent message stays on top of Today until the parent confirms it', (tester) async {
      clock = () => DateTime.utc(2026, 10, 1, 7);
      addTearDown(() => clock = DateTime.now);
      final log = <String>[];
      var confirmed = false;
      await start(
        tester,
        {'lang': 'en', 'token': 't'},
        school(
          log: log,
          me_: messagingMe(),
          more: {
            '/parent/announcements/emergency': (http.Request _) => confirmed ? <Object>[] : [{'id': 'e1', 'title': 'Early closing', 'body': 'School closes at 11:00.', 'priority': 'EMERGENCY'}],
            '/parent/announcements/e1/acknowledge': (http.Request _) {
              confirmed = true;
              return {'ok': true};
            },
          },
        ),
      );
      expect(find.text('Urgent: Early closing'), findsOneWidget);
      await tester.tap(find.text('I have read this'));
      await tester.pumpAndSettle();
      expect(log.where((l) => l.startsWith('POST /parent/announcements/e1/acknowledge')), hasLength(1));
      expect(find.text('Urgent: Early closing'), findsNothing);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('conversations: open one, send a message, and see a live reply arrive', (tester) async {
      final socket = FakeChatSocket();
      chatSocketFactory = (_) => socket;
      final log = <String>[];
      Map<String, Object?> message(String id, String sender, String body) => {'id': id, 'threadId': 'th1', 'senderId': sender, 'body': body, 'hasFile': false, 'createdAt': at, 'readAt': null};
      await openMessages(
        tester,
        school(
          log: log,
          me_: messagingMe(),
          more: {
            '/parent/threads': [
              {'id': 'th1', 'student': salma, 'staff': hana, 'unread': 1, 'last': {'body': 'Salma did well today', 'createdAt': at, 'mine': false}},
            ],
            '/threads/th1': {'id': 'th1', 'student': salma, 'staff': hana, 'canReply': true},
            '/threads/th1/messages': (http.Request r) => r.method == 'POST' ? message('m2', 'u1', 'Thank you') : [message('m1', 't1', 'Salma did well today')],
            '/parent/children/s1/contacts': {'contacts': [hana], 'chatFrom': '08:00', 'chatTo': '15:00'},
            '/threads/th1/read': {'read': 1},
          },
        ),
      );
      await tester.tap(find.text('Conversations'));
      await tester.pumpAndSettle();
      expect(find.text('Ms. Hana Nabil'), findsOneWidget);
      expect(find.text('Salma did well today'), findsOneWidget);

      await tester.tap(find.text('Ms. Hana Nabil'));
      await tester.pumpAndSettle();
      expect(find.text('About Salma · Usually replies between 08:00 and 15:00'), findsOneWidget);
      expect(find.text('Salma did well today'), findsOneWidget);

      await tester.enterText(find.byType(TextField), 'Thank you');
      await tester.tap(find.byTooltip('Send'));
      await tester.pumpAndSettle();
      expect(log.where((l) => l.startsWith('POST /threads/th1/messages')).single, contains('"body":"Thank you"'));
      expect(find.text('Thank you'), findsOneWidget);

      socket.push({'threadId': 'th1', 'message': message('m3', 't1', 'You are welcome')});
      await tester.pumpAndSettle();
      expect(find.text('You are welcome'), findsOneWidget);
      // The teacher opening the thread marks the parent's messages as seen.
      socket.pushRead({'threadId': 'th1', 'readerId': 't1', 'at': at});
      await tester.pumpAndSettle();
      expect(find.textContaining('Seen'), findsWidgets);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('a new message starts from the child’s teachers and Student Affairs', (tester) async {
      final log = <String>[];
      await openMessages(
        tester,
        school(
          log: log,
          me_: messagingMe(),
          more: {
            '/parent/children/s1/contacts': {
              'contacts': [
                {...hana, 'subjects': ['Math'], 'homeroom': true},
                {'id': 'a1', 'name': 'Admin', 'role': 'SCHOOL_ADMIN', 'subjects': [], 'homeroom': false},
              ],
              'chatFrom': '08:00',
              'chatTo': '15:00',
            },
            '/parent/children/s1/threads': {'id': 'th9', 'student': salma, 'staff': hana, 'unread': 0, 'last': null},
            '/threads/th9': {'id': 'th9', 'student': salma, 'staff': hana, 'canReply': true},
            '/threads/th9/messages': <Object>[],
            '/threads/th9/read': {'read': 0},
          },
        ),
      );
      await tester.tap(find.text('Conversations'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('New message'));
      await tester.pumpAndSettle();
      expect(find.text('Who would you like to write to about Salma?'), findsOneWidget);
      expect(find.text('Ms. Hana Nabil'), findsOneWidget);
      expect(find.text('Class teacher · Math'), findsOneWidget);
      expect(find.text('Student Affairs'), findsOneWidget);
      await tester.tap(find.text('Ms. Hana Nabil'));
      await tester.pumpAndSettle();
      expect(log.where((l) => l.startsWith('POST /parent/children/s1/threads')).single, contains('"staffId":"t1"'));
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('meetings: free times are offered by teacher and day, and booking sends the slot', (tester) async {
      final log = <String>[];
      await openMessages(
        tester,
        school(
          log: log,
          me_: messagingMe(),
          more: {
            '/parent/children/s1/meetings': {
              'booked': [],
              'teachers': [
                {'teacher': {...hana, 'subjects': ['Math'], 'homeroom': false}, 'slots': [
                  {'id': 'sl1', 'startsAt': '2026-10-04T11:00:00.000Z', 'endsAt': '2026-10-04T11:20:00.000Z', 'place': 'Room 204'},
                ]},
              ],
            },
            '/parent/children/s1/meetings/sl1/book': {'id': 'sl1'},
          },
        ),
      );
      await tester.tap(find.text('School'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Meetings'));
      await tester.pumpAndSettle();
      expect(find.text('Ms. Hana Nabil'), findsOneWidget);
      expect(find.text('Sunday 4 October'), findsOneWidget);
      await tester.tap(find.byType(ActionChip));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'About homework');
      await tester.tap(find.text('Book this time'));
      await tester.pumpAndSettle();
      final post = log.where((l) => l.startsWith('POST /parent/children/s1/meetings/sl1/book')).single;
      expect(post, contains('"note":"About homework"'));
      expect(find.text('Your meeting is booked.'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    });

    test('notifications read well in Arabic, including the school-wide ones', () {
      expect(S.ar.notification('announcement.new', '', {'title': 'يوم رياضي'}, 'x'), 'جديد من المدرسة: يوم رياضي');
      expect(S.ar.notification('announcement.emergency', '', {'title': 'إغلاق مبكر'}, 'x'), 'عاجل من المدرسة: إغلاق مبكر');
      expect(S.ar.notification('poll.new', '', {'question': 'ما الغداء؟'}, 'x'), 'تودّ المدرسة معرفة رأيكم: ما الغداء؟');
      expect(S.ar.notification('message.new', 'Layla', {'from': 'مس Hana'}, 'x', 'FEMALE'), 'رسالة جديدة من مس Hana بشأن Layla');
      expect(S.en.notification('message.new', 'Salma', {'from': 'Ms. Hana Nabil'}, 'x'), 'New message from Ms. Hana Nabil about Salma');
      expect(S.en.notification('meeting.cancelled', '', {'teacher': 'Ms. Hana Nabil', 'date': '2026-10-04', 'time': '14:00'}, 'x'),
          'Your meeting with Ms. Hana Nabil on Sunday 4 October at 14:00 was cancelled');
      expect(S.ar.votesN(1), 'صوت واحد');
      expect(S.ar.votesN(2), 'صوتان');
      expect(S.ar.votesN(5), '5 أصوات');
      expect(S.ar.votesN(11), '11 صوتًا');
      expect(S.ar.staffName({'name': 'Hana Nabil', 'honorific': 'MS'}), 'مس Hana Nabil');
    });
  });

  group('behaviour', () {
    late FakePush push;
    setUp(() {
      push = FakePush();
      pushFactory = () => push;
    });

    const hana = {'name': 'Hana Nabil', 'honorific': 'MS'};
    const at = '2026-10-01T07:30:00.000Z'; // 1 October, 10:30 in Cairo
    Map<String, Object?> behaviourMe({bool merits = true}) => {
          'modules': ['core', 'attendance', 'behavior'],
          'features': {
            'behavior': {'merits': merits},
          },
        };
    Map<String, Object?> note(String id, String kind, String category, String text, {int? points, bool read = false, String? severity, String? action}) =>
        {'id': id, 'kind': kind, 'category': category, 'text': text, 'points': points, 'severity': severity, 'actionTaken': action, 'occurredAt': at, 'author': hana, 'read': read};
    Map<String, Object> routes({bool merits = true}) => {
          '/parent/children': [
            {'id': 's1', 'firstName': 'Salma', 'lastName': 'Gamal', 'gender': 'FEMALE', 'class': {'id': 'c1', 'name': '4-A'}},
          ],
          '/parent/children/s1/behaviour': {
            'notes': [
              note('b1', 'PRAISE', 'KINDNESS', 'Helped a classmate carry her books.', points: 2),
              note('b2', 'CONCERN', 'HOMEWORK', 'Maths homework was not handed in.', points: -1, read: true),
              note('b3', 'INCIDENT', 'BULLYING', 'Words were exchanged in the playground.', severity: 'MODERATE', action: 'We spoke with both children.'),
            ],
            'totals': {'praise': 1, 'concern': 2, if (merits) 'points': 1},
          },
          '/parent/children/s1/behaviour/b1/read': {'ok': true},
          '/parent/children/s1/behaviour/b3/read': {'ok': true},
        };

    Future<void> openBehaviour(WidgetTester tester, String lang, {bool merits = true, List<String>? log}) async {
      clock = () => DateTime.utc(2026, 10, 1, 7);
      addTearDown(() => clock = DateTime.now);
      tester.view.physicalSize = const Size(800, 1800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await start(tester, {'lang': lang, 'token': 't'}, school(me_: behaviourMe(merits: merits), more: routes(merits: merits), log: log));
      await tester.tap(find.text(lang == 'ar' ? 'المدرسة' : 'School'));
      await tester.pumpAndSettle();
      await tester.tap(find.text(lang == 'ar' ? 'السلوك' : 'Behaviour'));
      await tester.pumpAndSettle();
    }

    testWidgets('the timeline gives each kind a shape and a word, with the totals and merit points', (tester) async {
      await openBehaviour(tester, 'en');
      expect(find.text('★ Praise'), findsOneWidget);
      expect(find.text('! Note'), findsOneWidget);
      expect(find.text('⚠ From Student Affairs'), findsOneWidget);
      expect(find.text('★ 1'), findsOneWidget); // praise total
      expect(find.text('! 2'), findsOneWidget); // concerns and incidents together
      expect(find.text('◆ +1'), findsOneWidget); // merit points
      expect(find.text('+2'), findsOneWidget);
      expect(find.text('−1'), findsOneWidget);
      expect(find.text('Helped a classmate carry her books.'), findsOneWidget);
      expect(find.text('Moderate'), findsOneWidget);
      expect(find.text('What the school did: We spoke with both children.'), findsOneWidget);
      expect(find.text('Ms. Hana Nabil · 1 October'), findsNWidgets(3));
      expect(find.text('• New'), findsNWidgets(2)); // b1 and b3 were not yet read
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('a school that keeps no merit points shows none', (tester) async {
      await openBehaviour(tester, 'en', merits: false);
      expect(find.textContaining('◆'), findsNothing);
      expect(find.text('Merit points'), findsNothing);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('opening the screen marks the unread notes as read, and only those', (tester) async {
      final log = <String>[];
      await openBehaviour(tester, 'en', log: log);
      expect(log.where((l) => l.startsWith('POST /parent/children/s1/behaviour/b1/read')), hasLength(1));
      expect(log.where((l) => l.startsWith('POST /parent/children/s1/behaviour/b3/read')), hasLength(1));
      expect(log.where((l) => l.contains('/behaviour/b2/read')), isEmpty);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('reads well in Arabic', (tester) async {
      await openBehaviour(tester, 'ar');
      expect(find.text('★ ثناء'), findsOneWidget);
      expect(find.text('⚠ من شؤون الطلبة'), findsOneWidget);
      expect(find.text('للمتابعة'), findsOneWidget);
      expect(find.text('نقاط التميز'), findsOneWidget);
      expect(find.text('متوسطة'), findsOneWidget);
      expect(find.text('ما اتخذته المدرسة: We spoke with both children.'), findsOneWidget);
      expect(find.text('مس Hana Nabil · 1 أكتوبر'), findsNWidgets(3));
      expect(find.text(S.ar.behaviourPointsN(2)), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('a tap on a push about a note opens the behaviour screen', (tester) async {
      clock = () => DateTime.utc(2026, 10, 1, 7);
      addTearDown(() => clock = DateTime.now);
      tester.view.physicalSize = const Size(800, 1800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await start(tester, {'lang': 'en', 'token': 't'}, school(me_: behaviourMe(), more: routes()));
      push.tap({'type': 'behaviour.note', 'studentId': 's1', 'kind': 'PRAISE'});
      await tester.pumpAndSettle();
      expect(find.text('This school year'), findsOneWidget);
      expect(find.text('Helped a classmate carry her books.'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('a note in the notification list reads by kind and opens the screen', (tester) async {
      clock = () => DateTime.utc(2026, 10, 1, 7);
      addTearDown(() => clock = DateTime.now);
      tester.view.physicalSize = const Size(800, 1800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final notes = [
        {'id': 'n1', 'type': 'behaviour.note', 'title': 'English title', 'body': '…', 'readAt': null, 'createdAt': DateTime.now().toUtc().toIso8601String(), 'data': {'studentId': 's1', 'kind': 'PRAISE'}},
      ];
      await start(tester, {'lang': 'en', 'token': 't'}, school(me_: behaviourMe(), more: {...routes(), '/notifications': notes, '/notifications/n1/read': {'ok': true}}));
      await tester.tap(find.text('Notifications'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Well done! A note of praise for Salma'));
      await tester.pumpAndSettle();
      expect(find.text('This school year'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    });

    test('the notification sentence follows the kind of note, in both languages', () {
      expect(S.en.notification('behaviour.note', 'Salma', {'kind': 'PRAISE'}, 'x', 'FEMALE'), 'Well done! A note of praise for Salma');
      expect(S.en.notification('behaviour.note', 'Salma', {'kind': 'CONCERN'}, 'x'), 'A note from school about Salma');
      expect(S.en.notification('behaviour.note', 'Salma', {'kind': 'INCIDENT'}, 'x'), 'Student Affairs has written to you about Salma');
      expect(S.ar.notification('behaviour.note', 'سلمى', {'kind': 'PRAISE'}, 'x', 'FEMALE'), 'أحسنتم! ثناء من المدرسة على سلمى');
      expect(S.ar.notification('behaviour.note', 'سلمى', {'kind': 'CONCERN'}, 'x'), 'ملاحظة من المدرسة بشأن سلمى');
      expect(S.ar.notification('behaviour.note', 'سلمى', {'kind': 'INCIDENT'}, 'x'), 'تواصلت شؤون الطلبة معكم بشأن سلمى');
    });
  });

  group('grades', () {
    late FakePush push;
    setUp(() {
      push = FakePush();
      pushFactory = () => push;
    });

    Map<String, Object?> academicsMe({bool reportCards = true}) => {
          'modules': ['core', 'attendance', 'academics'],
          'features': {
            'academics': {'reportCards': reportCards},
          },
        };
    const good = {'min': 65, 'label': 'Good', 'labelAr': 'جيد'};
    const veryGood = {'min': 75, 'label': 'Very good', 'labelAr': 'جيد جدًا'};
    const excellent = {'min': 85, 'label': 'Excellent', 'labelAr': 'ممتاز'};
    Map<String, Object?> termOne() => {
          'year': {'id': 'y1', 'name': '2026/2027'},
          'term': 1,
          'subjects': [
            {
              'subjectId': 'm', 'name': 'Math', 'nameAr': 'الرياضيات', 'percent': 67.5, 'band': good,
              'assessments': [
                {'id': 'a1', 'title': 'Unit 1 quiz', 'kind': 'QUIZ', 'date': '2026-10-01', 'score': 18, 'maxScore': 20, 'absent': false, 'excused': false, 'comment': 'Well done'},
                {'id': 'a2', 'title': 'Unit 1 project', 'kind': 'PROJECT', 'date': '2026-10-02', 'score': null, 'maxScore': 100, 'absent': true, 'excused': true, 'comment': null},
              ],
            },
            {
              'subjectId': 's', 'name': 'Science', 'percent': 90, 'band': excellent,
              'assessments': [
                {'id': 'a3', 'title': 'Water cycle quiz', 'kind': 'QUIZ', 'date': '2026-10-03', 'score': 18, 'maxScore': 20, 'absent': false, 'excused': false, 'comment': null},
              ],
            },
          ],
          'overall': {'percent': 78.8, 'band': veryGood},
        };
    Map<String, Object?> snapshot() => {
          'student': {'id': 's1', 'name': 'Layla Hussein', 'nameAr': 'ليلى حسين', 'code': '2026-0001', 'gender': 'FEMALE'},
          'class': {'name': '4/1', 'gradeName': 'Primary 4', 'system': null},
          'year': {'name': '2026/2027'},
          'term': 1,
          'subjects': [
            {'subjectId': 'm', 'name': 'Math', 'nameAr': 'الرياضيات', 'percent': 84.6, 'band': veryGood, 'comment': 'A confident start to the year.', 'teacher': 'Ms. Hana Nabil'},
            {'subjectId': 'e', 'name': 'English', 'percent': null, 'band': null, 'comment': null, 'teacher': null},
          ],
          'overall': {'percent': 84.6, 'band': veryGood},
          'attendance': {'present': 17, 'late': 1, 'absent': 2, 'excused': 0, 'onTrip': 0, 'days': 20},
          'classTeacherComment': 'A kind and helpful member of the class.',
          'classTeacher': 'Ms. Hana Nabil',
          'principalComment': 'We are proud of your progress.',
          'principalName': 'Dr. Amal Fawzy',
          'school': {'name': 'Nile Valley Language School', 'nameAr': 'مدرسة وادي النيل للغات'},
          'issuedAt': '2026-10-11T18:00:00.000Z',
        };
    Map<String, Object> routes({List<String>? terms}) => {
          '/parent/children': [
            {'id': 's1', 'firstName': 'Layla', 'lastName': 'Hussein', 'gender': 'FEMALE', 'class': {'id': 'c1', 'name': '4/1'}},
          ],
          '/parent/children/s1/grades': (http.Request r) {
            terms?.add(r.url.queryParameters['term'] ?? '');
            return r.url.queryParameters['term'] == '2' ? {'year': {'id': 'y1', 'name': '2026/2027'}, 'term': 2, 'subjects': [], 'overall': {'percent': null, 'band': null}} : termOne();
          },
          '/parent/children/s1/grades/trend': (http.Request r) => r.url.queryParameters['subjectId'] == 'm'
              ? [{'date': '2026-10-01', 'percent': 90}, {'date': '2026-10-02', 'percent': 45}]
              : [{'date': '2026-10-03', 'percent': 90}],
          '/parent/children/s1/exams': [
            {'id': 'x1', 'subject': 'Math', 'subjectAr': 'الرياضيات', 'title': 'Maths midterm', 'kind': 'MIDTERM', 'date': '2026-10-18', 'startTime': '09:00', 'endTime': '10:30', 'room': 'Room 204'},
          ],
          '/parent/children/s1/report-cards': [
            {'id': 'rc1', 'year': '2026/2027', 'term': 1, 'publishedAt': '2026-10-11T18:00:00.000Z', 'overall': {'percent': 84.6, 'band': veryGood}},
          ],
          '/parent/children/s1/report-cards/rc1': {'id': 'rc1', 'term': 1, 'publishedAt': '2026-10-11T18:00:00.000Z', 'snapshot': snapshot()},
        };

    Future<void> openGrades(WidgetTester tester, String lang, {List<String>? terms, bool reportCards = true}) async {
      clock = () => DateTime.utc(2026, 10, 11, 7);
      addTearDown(() => clock = DateTime.now);
      tester.view.physicalSize = const Size(800, 2400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await start(tester, {'lang': lang, 'token': 't'}, school(me_: academicsMe(reportCards: reportCards), more: routes(terms: terms)));
      await tester.tap(find.text(lang == 'ar' ? 'المدرسة' : 'School'));
      await tester.pumpAndSettle();
      await tester.tap(find.text(lang == 'ar' ? 'الدرجات' : 'Grades'));
      await tester.pumpAndSettle();
    }

    testWidgets('shows the overall result and each subject with its percentage and band', (tester) async {
      await openGrades(tester, 'en');
      expect(find.text('Overall'), findsOneWidget);
      expect(find.text('78.8%'), findsOneWidget);
      expect(find.text('Very good'), findsOneWidget);
      expect(find.text('67.5%'), findsOneWidget);
      expect(find.text('Good'), findsOneWidget);
      expect(find.text('90%'), findsOneWidget);
      expect(find.text('Excellent'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('draws a progress line from two marks and says when there are fewer', (tester) async {
      await openGrades(tester, 'en');
      expect(find.byWidgetPredicate((w) => w is CustomPaint && w.painter.runtimeType.toString() == '_TrendPainter'), findsOneWidget); // Math has two marks
      expect(find.text(S.en.noTrend), findsOneWidget); // Science has one
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('a subject opens to show each published mark, an excused absence and the teacher’s comment', (tester) async {
      await openGrades(tester, 'en');
      expect(find.text('Unit 1 quiz'), findsNothing);
      await tester.tap(find.text('Math'));
      await tester.pumpAndSettle();
      expect(find.text('Unit 1 quiz'), findsOneWidget);
      expect(find.text('18 / 20'), findsOneWidget);
      expect(find.text('Well done'), findsOneWidget);
      expect(find.text('Quiz · 1 October'), findsOneWidget);
      expect(find.text('– Excused'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('switching the term asks for that term and says when nothing is published', (tester) async {
      final terms = <String>[];
      await openGrades(tester, 'en', terms: terms);
      await tester.tap(find.text('Term 2'));
      await tester.pumpAndSettle();
      expect(terms.last, '2');
      expect(find.text(S.en.noGrades), findsOneWidget);
      expect(find.text('Math'), findsNothing);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('lists the exams coming up with the time in order', (tester) async {
      await openGrades(tester, 'en');
      expect(find.text('Upcoming exams'), findsOneWidget);
      expect(find.text('Math · Midterm exam'), findsOneWidget);
      expect(find.text('Sunday 18 October'), findsOneWidget);
      expect(find.text('${ltr('09:00–10:30')} · Room 204'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('a school with report cards switched off shows none', (tester) async {
      await openGrades(tester, 'en', reportCards: false);
      expect(find.text('Report cards'), findsNothing);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('opens a report card in Arabic for a girl: crest name, her name, bands, comments and days', (tester) async {
      await openGrades(tester, 'ar');
      expect(find.text(S.ar.pct(78.8)), findsOneWidget);
      expect(find.text('ممتاز'), findsOneWidget);
      expect(find.text('الامتحانات القادمة'), findsOneWidget);
      expect(find.text('الشهادات'), findsOneWidget);
      expect(find.text('الرياضيات'), findsOneWidget); // the subject in Arabic, not «Math»
      expect(find.text('Math'), findsNothing);
      expect(find.text('الرياضيات · امتحان منتصف الفصل'), findsOneWidget);
      await tester.tap(find.text(S.ar.reportCardFor(1, '2026/2027')));
      await tester.pumpAndSettle();
      expect(find.text('شهادة الفصل الدراسي'), findsOneWidget);
      expect(find.text('مدرسة وادي النيل للغات'), findsOneWidget);
      expect(find.text('ليلى حسين'), findsOneWidget);
      expect(find.text('جيد جدًا'), findsWidgets);
      expect(find.text('الرياضيات'), findsOneWidget); // the subject's Arabic name on the card
      expect(find.text('مس Hana Nabil'), findsOneWidget); // under it
      expect(find.text('A confident start to the year.'), findsOneWidget);
      expect(find.textContaining('الحضور: 20 يومًا، الغياب: يومان'), findsOneWidget);
      expect(find.text('رائد الفصل: مس Hana Nabil'), findsOneWidget);
      expect(find.text('مدير المدرسة: د. Amal Fawzy'), findsOneWidget);
      expect(find.text(S.ar.noMarkYet), findsOneWidget); // English has no mark yet
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('a tap on a push about a new mark opens the grades', (tester) async {
      clock = () => DateTime.utc(2026, 10, 11, 7);
      addTearDown(() => clock = DateTime.now);
      tester.view.physicalSize = const Size(800, 2400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await start(tester, {'lang': 'en', 'token': 't'}, school(me_: academicsMe(), more: routes()));
      push.tap({'type': 'marks.published', 'studentId': 's1', 'subject': 'Math', 'title': 'Unit 1 quiz'});
      await tester.pumpAndSettle();
      expect(find.text(S.en.gradesSub), findsOneWidget);
      expect(find.text('67.5%'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('a tap on a push about a report card opens the grades, where the card is listed', (tester) async {
      clock = () => DateTime.utc(2026, 10, 11, 7);
      addTearDown(() => clock = DateTime.now);
      tester.view.physicalSize = const Size(800, 2400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await start(tester, {'lang': 'en', 'token': 't'}, school(me_: academicsMe(), more: routes()));
      push.tap({'type': 'reportCard.published', 'studentId': 's1', 'term': 1});
      await tester.pumpAndSettle();
      expect(find.text('Term 1 · 2026/2027'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    });

    test('notifications about marks and report cards read well in both languages', () {
      final mark = {'subject': 'Math', 'title': 'Unit 1 quiz'};
      expect(S.en.notification('marks.published', 'Salma', mark, 'x'), 'New mark for Salma in Math: Unit 1 quiz');
      expect(S.ar.notification('marks.published', 'سلمى', {'subject': 'الرياضيات', 'title': 'اختبار الوحدة'}, 'x'), 'درجة جديدة لـسلمى في الرياضيات: اختبار الوحدة');
      expect(S.en.notification('reportCard.published', 'Salma', {'term': 2}, 'x'), 'Salma’s report card for term 2 is ready');
      expect(S.ar.notification('reportCard.published', 'سلمى', {'term': 1}, 'x'), 'صدرت شهادة سلمى عن الفصل الدراسي الأول');
      expect(S.ar.notification('reportCard.published', 'سلمى', {'term': 2}, 'x'), 'صدرت شهادة سلمى عن الفصل الدراسي الثاني');
      expect(S.ar.notification('marks.published', 'سلمى', {'subject': 'Math', 'subjectAr': 'الرياضيات', 'title': 'اختبار'}, 'x'), 'درجة جديدة لـسلمى في الرياضيات: اختبار');
      expect(S.ar.notification('marks.published', 'سلمى', {'subject': 'Math', 'subjectAr': null, 'title': 'اختبار'}, 'x'), 'درجة جديدة لـسلمى في Math: اختبار'); // no Arabic name yet
      expect(S.en.notification('marks.published', 'Salma', {}, 'English title'), 'English title'); // no subject: the server’s words
    });

    test('numbers, scores and titles are formatted for each language', () {
      expect(S.en.pct(90), '90%');
      expect(S.en.pct(67.5), '67.5%');
      expect(S.ar.pct(67.5), ltr('67.5%'));
      expect(S.en.scoreOf(17.5, 20), '17.5 / 20');
      expect(S.ar.scoreOf(18, 20), ltr('18 / 20'));
      expect(S.ar.titledName('Ms. Hana Nabil'), 'مس Hana Nabil');
      expect(S.ar.titledName('Hana Nabil'), 'Hana Nabil');
      expect(S.en.titledName('Dr. Amal Fawzy'), 'Dr. Amal Fawzy');
      expect(S.ar.attendanceLine(20, 0), 'الحضور: 20 يومًا، الغياب: 0 يوم');
      expect(S.ar.attendanceLine(1, 2), 'الحضور: يوم واحد، الغياب: يومان');
      expect(S.en.attendanceLine(1, 3), 'Attendance: 1 day, absent 3');
      expect(S.ar.bandName({'label': 'Good', 'labelAr': 'جيد'}), 'جيد');
      expect(S.en.bandName(null), '—');
    });
  });

  group('push notifications', () {
    late FakePush push;
    setUp(() {
      push = FakePush();
      pushFactory = () => push;
    });

    testWidgets('a signed-in parent is registered for push, in the language of the app', (tester) async {
      clock = () => DateTime.utc(2026, 10, 1, 7);
      addTearDown(() => clock = DateTime.now);
      await start(tester, {'lang': 'ar', 'token': 't'}, school());
      expect(push.started, ['ar']);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('nobody is registered while the tracking consent is still waiting', (tester) async {
      await start(tester, {'lang': 'en', 'token': 't'}, school(straps: true, consented: false));
      expect(find.text('I agree'), findsOneWidget);
      expect(push.started, isEmpty);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('nobody is registered before signing in', (tester) async {
      await start(tester, {'lang': 'en'});
      expect(push.started, isEmpty);
    });

    testWidgets('switching language tells the server, so pushes are worded in it', (tester) async {
      clock = () => DateTime.utc(2026, 10, 1, 7);
      addTearDown(() => clock = DateTime.now);
      SharedPreferences.setMockInitialValues({'lang': 'en', 'token': 't'});
      final prefs = await SharedPreferences.getInstance();
      final settings = AppSettings(prefs);
      await tester.pumpWidget(ParentApp(api: Api(prefs, school()), settings: settings));
      await tester.pumpAndSettle();
      expect(push.langs, isEmpty);
      await settings.setLang('ar');
      await tester.pumpAndSettle();
      expect(push.langs, ['ar']);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('signing out forgets the phone first', (tester) async {
      clock = () => DateTime.utc(2026, 10, 1, 7);
      addTearDown(() => clock = DateTime.now);
      await start(tester, {'lang': 'en', 'token': 't'}, school());
      await tester.tap(find.text('Account'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Sign out'));
      await tester.tap(find.text('Sign out'));
      await tester.pumpAndSettle();
      expect(push.stopped, 1);
      expect(find.text('Sign in'), findsWidgets); // back to the sign-in screen
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('a push that arrives while the app is open refreshes what it shows', (tester) async {
      clock = () => DateTime.utc(2026, 10, 1, 7);
      addTearDown(() => clock = DateTime.now);
      final log = <String>[];
      await start(tester, {'lang': 'en', 'token': 't'}, school(log: log));
      int loads() => log.where((l) => l.startsWith('GET /notifications')).length;
      final before = loads();
      push.arrive();
      await tester.pumpAndSettle();
      expect(loads(), before + 1);
      await tester.pumpWidget(const SizedBox());
    });

    test('the phone is registered and forgotten through the API', () async {
      SharedPreferences.setMockInitialValues({'token': 't'});
      final log = <String>[];
      final api = Api(
        await SharedPreferences.getInstance(),
        MockClient((req) async {
          log.add('${req.method} ${req.url.path.replaceFirst('/api', '')} ${req.body}');
          return http.Response('{"ok":true}', 200, headers: {'content-type': 'application/json'});
        }),
      );
      await api.registerDevice('abc:def', 'android', 'ar');
      await api.removeDevice('abc:def');
      expect(log[0], 'POST /notifications/devices {"token":"abc:def","platform":"android","lang":"ar"}');
      expect(log[1], startsWith('DELETE /notifications/devices/abc%3Adef'));
    });

    group('tapping a notification', () {
      const hana = {'id': 't1', 'name': 'Hana Nabil', 'honorific': 'MS', 'role': 'TEACHER'};
      const salma = {'id': 's1', 'firstName': 'Salma', 'class': {'name': '4-A'}};
      final at = '2026-10-01T07:30:00.000Z';
      Map<String, Object?> messagingMe() => {
            'modules': ['core', 'attendance', 'messaging'],
            'features': {
              'messaging': {'chat': true, 'polls': true, 'meetings': true},
            },
          };
      Map<String, Object?> note(String id, String type, Map<String, Object?> data) => {'id': id, 'type': type, 'title': 'English title', 'body': '…', 'readAt': null, 'createdAt': DateTime.now().toUtc().toIso8601String(), 'data': data};
      Map<String, Object> routes({List<Map<String, Object?>> notes = const []}) => {
            '/notifications': notes,
            '/parent/announcements': [
              {'id': 'a1', 'title': 'Sports day', 'body': 'Please send trainers.', 'priority': 'NORMAL', 'sentAt': at, 'readAt': null, 'hasFile': false},
            ],
            '/parent/threads': [],
            '/threads/th1': {'id': 'th1', 'student': salma, 'staff': hana, 'canReply': true},
            '/threads/th1/messages': [],
            '/threads/th1/read': {'read': 0},
            '/parent/children/s1/contacts': {'contacts': [hana], 'chatFrom': '08:00', 'chatTo': '15:00'},
            '/parent/children/s1/meetings': {'booked': [], 'teachers': []},
            '/notifications/n1/read': {'ok': true},
            '/notifications/n9/read': {'ok': true},
          };

      Future<void> open(WidgetTester tester, {List<Map<String, Object?>> notes = const [], List<String>? log}) async {
        clock = () => DateTime.utc(2026, 10, 1, 7);
        addTearDown(() => clock = DateTime.now);
        await start(tester, {'lang': 'en', 'token': 't'}, school(me_: messagingMe(), more: routes(notes: notes), log: log));
      }

      testWidgets('a notification in the list opens what it is about', (tester) async {
        await open(tester, notes: [note('n1', 'excuse.approved', {'studentId': 's1'})]);
        await tester.tap(find.text('Notifications'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('The school accepted Salma’s excuse'));
        await tester.pumpAndSettle();
        expect(find.text(S.en.excusesSub), findsOneWidget); // the excuses screen
        await tester.pumpWidget(const SizedBox());
      });

      testWidgets('an attendance notification goes back to the child’s day', (tester) async {
        await open(tester, notes: [note('n1', 'attendance.arrived', {'studentId': 's1'})]);
        await tester.tap(find.text('Notifications'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Salma arrived safely at school'));
        await tester.pumpAndSettle();
        expect(find.text('Today’s lessons'), findsOneWidget);
        await tester.pumpWidget(const SizedBox());
      });

      testWidgets('a tap on a push about a message opens that conversation, and marks the push read', (tester) async {
        final log = <String>[];
        await open(tester, log: log);
        push.tap({'type': 'message.new', 'threadId': 'th1', 'studentId': 's1', 'notificationId': 'n9', 'from': 'Ms. Hana Nabil'});
        await tester.pumpAndSettle();
        expect(find.text('Ms. Hana Nabil'), findsOneWidget); // the conversation's header
        expect(log.where((l) => l.startsWith('POST /notifications/n9/read')), hasLength(1));
        await tester.pumpWidget(const SizedBox());
      });

      testWidgets('a tap on a push about an announcement opens it', (tester) async {
        await open(tester);
        push.tap({'type': 'announcement.new', 'announcementId': 'a1'});
        await tester.pumpAndSettle();
        expect(find.text('Please send trainers.'), findsWidgets);
        expect(find.text('Sports day'), findsWidgets);
        await tester.pumpWidget(const SizedBox());
      });

      testWidgets('the push that started the app is opened once the app is ready', (tester) async {
        push.launch = {'type': 'meeting.cancelled', 'studentId': 's1', 'teacher': 'Ms. Hana Nabil', 'date': '2026-10-04', 'time': '14:00'};
        await open(tester);
        expect(find.text('Parent meetings'), findsOneWidget);
        expect(push.launch, isNull); // used once
        await tester.pumpWidget(const SizedBox());
      });

      testWidgets('a push the app doesn’t know a screen for lands on the notification list', (tester) async {
        await open(tester);
        push.tap({'type': 'something.new'});
        await tester.pumpAndSettle();
        expect(find.text('No notifications yet.'), findsNothing); // the list is on screen (it is titled)
        expect(find.text('Notifications'), findsWidgets);
        await tester.pumpWidget(const SizedBox());
      });
    });
  });
}
