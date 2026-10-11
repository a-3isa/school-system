import 'dart:async';

import 'package:socket_io_client/socket_io_client.dart' as io;

import 'api.dart';

/// Live messages from the school. The server only pushes; everything is sent through [Api].
abstract class ChatSocket {
  /// A message arrived: `{threadId, message}`.
  Stream<Map<String, dynamic>> get messages;

  /// The other side opened a conversation: `{threadId, readerId, at}`.
  Stream<Map<String, dynamic>> get reads;

  /// Whether the live connection is up (it reconnects by itself).
  bool get connected;
  Stream<bool> get connection;
  void dispose();
}

class _LiveChatSocket implements ChatSocket {
  _LiveChatSocket(Api api) {
    _socket = io.io(
      Uri.parse(apiUrl).origin,
      io.OptionBuilder().setPath('/api/socket.io').setTransports(['websocket']).setAuth({'token': api.token}).build(),
    );
    _socket
      ..on('message', (d) => _messages.add(Map<String, dynamic>.from(d as Map)))
      ..on('read', (d) => _reads.add(Map<String, dynamic>.from(d as Map)))
      ..onConnect((_) => _set(true))
      ..onDisconnect((_) => _set(false));
  }

  late final io.Socket _socket;
  final _messages = StreamController<Map<String, dynamic>>.broadcast();
  final _reads = StreamController<Map<String, dynamic>>.broadcast();
  final _connection = StreamController<bool>.broadcast();
  bool _up = false;

  void _set(bool up) {
    _up = up;
    _connection.add(up);
  }

  @override
  Stream<Map<String, dynamic>> get messages => _messages.stream;
  @override
  Stream<Map<String, dynamic>> get reads => _reads.stream;
  @override
  bool get connected => _up;
  @override
  Stream<bool> get connection => _connection.stream;

  @override
  void dispose() {
    _socket.dispose();
    _messages.close();
    _reads.close();
    _connection.close();
  }
}

/// A connection that never connects: what tests use, and what the app falls back to, so nothing breaks when it can't connect.
class NoChatSocket implements ChatSocket {
  @override
  Stream<Map<String, dynamic>> get messages => const Stream.empty();
  @override
  Stream<Map<String, dynamic>> get reads => const Stream.empty();
  @override
  bool get connected => false;
  @override
  Stream<bool> get connection => const Stream.empty();
  @override
  void dispose() {}
}

/// Opens the live connection. Tests replace this so they use no network.
ChatSocket Function(Api) chatSocketFactory = (api) => _LiveChatSocket(api);
