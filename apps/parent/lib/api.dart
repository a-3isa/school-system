import 'dart:convert';

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

class Api {
  Api(this._prefs);

  final SharedPreferences _prefs;
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
    final res = await http.Response.fromStream(await req.send());
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
    if (res['user']['role'] != 'PARENT') {
      throw ApiException(403, 'This app is for parents. Staff use the school dashboard.');
    }
    await _prefs.setString(_tokenKey, res['token'] as String);
  }

  /// Signs in with the email the school registered and the parent's password.
  Future<void> login(String email, String password) async =>
      _keep(await post('/auth/login', {'login': email, 'password': password}) as Map<String, dynamic>);

  /// Create account: emails a code if the school registered this email.
  Future<void> signup(String email) => post('/auth/signup', {'email': email});

  /// Forgot password: emails a code.
  Future<void> forgotPassword(String email) => post('/auth/password/forgot', {'email': email});

  /// The emailed code and a new password; signs the parent in.
  Future<void> setPassword(String email, String code, String password) async =>
      _keep(await post('/auth/password/set', {'email': email, 'code': code, 'password': password}) as Map<String, dynamic>);

  Future<Map<String, dynamic>> me() async => await get('/auth/me') as Map<String, dynamic>;
  Future<void> consent() => post('/parent/consent');
  Future<List<dynamic>> children() async => await get('/parent/children') as List<dynamic>;
  Future<List<dynamic>> childDay(String id, String date) async => await get('/parent/children/$id/attendance?date=$date') as List<dynamic>;
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
