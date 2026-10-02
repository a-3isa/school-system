import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// The platform API. Set the address at build time:
///   flutter run --dart-define=API_URL=https://api.example.com/api
const apiUrl = String.fromEnvironment('API_URL', defaultValue: 'http://localhost:3000/api');

class ApiException implements Exception {
  ApiException(this.status, this.message);
  final int status;
  final String message;
  @override
  String toString() => message;
}

/// Signed in with a staff account; the app is for parents.
class WrongRole implements Exception {}

class Api {
  /// [client] is for tests; the app uses a plain one.
  Api(this._prefs, [http.Client? client]) : _client = client ?? http.Client();

  final SharedPreferences _prefs;
  final http.Client _client;
  static const _tokenKey = 'token';

  String? get token => _prefs.getString(_tokenKey);
  bool get signedIn => token != null;

  Future<void> signOut() => _prefs.remove(_tokenKey);

  Future<dynamic> _send(String method, String path, [Object? body]) async {
    final uri = Uri.parse('$apiUrl$path');
    final headers = {
      'content-type': 'application/json',
      if (token != null) 'authorization': 'Bearer $token',
    };
    final req = http.Request(method, uri)..headers.addAll(headers);
    if (body != null) req.body = jsonEncode(body);
    final res = await http.Response.fromStream(await _client.send(req));
    final data = res.body.isEmpty ? null : jsonDecode(res.body);
    if (res.statusCode >= 400) {
      final msg = data is Map && data['message'] != null
          ? (data['message'] is List ? (data['message'] as List).join(' ') : data['message'].toString())
          : 'Something went wrong (${res.statusCode}).';
      if (res.statusCode == 401) await signOut();
      throw ApiException(res.statusCode, msg);
    }
    return data;
  }

  Future<dynamic> get(String path) => _send('GET', path);
  Future<dynamic> post(String path, [Object? body]) => _send('POST', path, body ?? {});

  Future<void> _keep(Map<String, dynamic> res) async {
    if (res['user']['role'] != 'PARENT') throw WrongRole();
    await _prefs.setString(_tokenKey, res['token'] as String);
  }

  /// Signs in with the email the school registered and the parent's password.
  Future<void> login(String email, String password) async =>
      _keep(await post('/auth/login', {'login': email, 'password': password}) as Map<String, dynamic>);

  /// Create account, step 1: a code to the email the school registered.
  Future<void> signup(String email) => post('/auth/signup', {'email': email});

  /// Step 2: the emailed code and the parent's mobile; a WhatsApp code goes to the mobile.
  /// Returns the ticket for step 3.
  Future<String> signupPhone(String email, String emailCode, String phone) async {
    final res = await post('/auth/signup/phone', {'email': email, 'emailCode': emailCode, 'phone': phone}) as Map<String, dynamic>;
    return res['ticket'] as String;
  }

  /// Send the WhatsApp code again, to the same or a corrected number. Returns a new ticket.
  Future<String> resendSignupPhone(String ticket, String phone) async {
    final res = await post('/auth/signup/resend', {'ticket': ticket, 'phone': phone}) as Map<String, dynamic>;
    return res['ticket'] as String;
  }

  /// Step 3: the WhatsApp code and a password; signs the parent in.
  Future<void> completeSignup(String ticket, String phoneCode, String password) async =>
      _keep(await post('/auth/signup/complete', {'ticket': ticket, 'phoneCode': phoneCode, 'password': password}) as Map<String, dynamic>);

  /// Forgot password: emails a code.
  Future<void> forgotPassword(String email) => post('/auth/password/forgot', {'email': email});

  /// The emailed code and a new password; signs the parent in.
  Future<void> resetPassword(String email, String code, String password) async =>
      _keep(await post('/auth/password/reset', {'email': email, 'code': code, 'password': password}) as Map<String, dynamic>);

  /// Change mobile: a WhatsApp code to the new number, then confirm it.
  Future<void> requestPhoneChange(String phone) => post('/auth/phone', {'phone': phone});
  Future<void> confirmPhoneChange(String phone, String code) => post('/auth/phone/verify', {'phone': phone, 'code': code});

  Future<Map<String, dynamic>> me() async {
    final me = await get('/auth/me') as Map<String, dynamic>;
    // Remembered so the sign-in screen can show the school next time.
    if (me['schoolName'] is String) await _prefs.setString(_schoolKey, me['schoolName'] as String);
    if (me['schoolNameAr'] is String) await _prefs.setString(_schoolArKey, me['schoolNameAr'] as String);
    return me;
  }

  static const _schoolKey = 'schoolName', _schoolArKey = 'schoolNameAr';

  /// The school this phone last signed in to, in the app's language, if any.
  String? lastSchool(bool arabic) => (arabic ? _prefs.getString(_schoolArKey) : null) ?? _prefs.getString(_schoolKey);

  /// The school's crest image, or null when the school hasn't uploaded one.
  Future<Uint8List?> crest() async {
    try {
      final res = await _client.get(Uri.parse('$apiUrl/school/logo'), headers: {if (token != null) 'authorization': 'Bearer $token'});
      return res.statusCode == 200 && res.bodyBytes.isNotEmpty ? res.bodyBytes : null;
    } catch (_) {
      return null;
    }
  }
  Future<void> consent() => post('/parent/consent');
  Future<List<dynamic>> children() async => await get('/parent/children') as List<dynamic>;
  Future<List<dynamic>> childDay(String id, String date) async => await get('/parent/children/$id/attendance?date=$date') as List<dynamic>;
  /// The child's whole day: arrival, where the strap was heard in the last minute, and every lesson.
  Future<Map<String, dynamic>> childToday(String id, String date) async => await get('/parent/children/$id/today?date=$date') as Map<String, dynamic>;
  Future<List<dynamic>> notifications() async => await get('/notifications') as List<dynamic>;
  Future<void> markRead(String id) => post('/notifications/$id/read');
}

/// Today's date in Cairo as YYYY-MM-DD (Egypt is UTC+2, or UTC+3 in summer time).
String todayCairo([DateTime? now]) {
  final utc = (now ?? DateTime.now()).toUtc();
  final offset = cairoOffset(utc);
  final local = utc.add(Duration(hours: offset));
  return '${local.year.toString().padLeft(4, '0')}-${local.month.toString().padLeft(2, '0')}-${local.day.toString().padLeft(2, '0')}';
}

/// Cairo's offset from UTC: +3 from the last Friday of April to the last
/// Thursday of October, otherwise +2.
int cairoOffset(DateTime utc) {
  DateTime lastWeekday(int year, int month, int weekday) {
    var d = DateTime.utc(year, month + 1, 0);
    while (d.weekday != weekday) {
      d = d.subtract(const Duration(days: 1));
    }
    return d;
  }

  final start = lastWeekday(utc.year, 4, DateTime.friday);
  final end = lastWeekday(utc.year, 10, DateTime.thursday).add(const Duration(days: 1));
  return (utc.isAfter(start) && utc.isBefore(end)) ? 3 : 2;
}

/// HH:mm in Cairo for an ISO timestamp.
String timeCairo(String iso) {
  final utc = DateTime.parse(iso).toUtc();
  final local = utc.add(Duration(hours: cairoOffset(utc)));
  return '${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';
}

/// The time now in Cairo as HH:mm, to compare with period times.
String nowCairo([DateTime? now]) {
  final utc = (now ?? DateTime.now()).toUtc();
  final local = utc.add(Duration(hours: cairoOffset(utc)));
  return '${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';
}

/// The hour now in Cairo (0–23), for the greeting.
int nowCairoHour([DateTime? now]) => int.parse(nowCairo(now).substring(0, 2));

/// The Cairo date (YYYY-MM-DD) of an ISO timestamp.
String dateCairo(String iso) => todayCairo(DateTime.parse(iso));
