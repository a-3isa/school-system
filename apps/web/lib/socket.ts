'use client';
import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { API_URL, getToken } from './api';

// One live connection for the whole dashboard, opened when the first screen that
// wants it appears and closed when the last one goes. The server only ever pushes
// to it; everything is written through the ordinary API.
let shared: Socket | null = null;
let users = 0;

function acquire(): Socket {
  if (!shared) {
    shared = io(new URL(API_URL).origin, { path: '/api/socket.io', auth: { token: getToken() }, transports: ['websocket'] });
  }
  users++;
  return shared;
}

function release() {
  users = Math.max(0, users - 1);
  if (users === 0 && shared) {
    shared.close();
    shared = null;
  }
}

/** Is the live connection up right now? (It reconnects by itself.) */
export function useChatConnected(on = true) {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (!on) return;
    const s = acquire();
    const up = () => setConnected(true);
    const down = () => setConnected(false);
    s.on('connect', up);
    s.on('disconnect', down);
    setConnected(s.connected);
    return () => {
      s.off('connect', up);
      s.off('disconnect', down);
      release();
    };
  }, [on]);
  return connected;
}

/** Calls `handler` whenever the server pushes this event (a new message, or a thread read by the other side). */
export function useChatEvent<T = any>(event: 'message' | 'read', handler: (payload: T) => void, on = true) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (!on) return;
    const s = acquire();
    const f = (payload: T) => latest.current(payload);
    s.on(event, f);
    return () => {
      s.off(event, f);
      release();
    };
  }, [event, on]);
}
