// Thin client for the platform API. The login token lives in localStorage.

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api';
const TOKEN_KEY = 'sp-token';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message.join(' ') : data?.message ?? `Request failed (${res.status}).`;
    if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/login')) {
      setToken(null);
      window.location.href = '/login';
    }
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export const post = <T = any>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body ?? {} });
export const put = <T = any>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body: body ?? {} });
export const patch = <T = any>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body: body ?? {} });
export const del = <T = any>(path: string) => api<T>(path, { method: 'DELETE' });

/** Today's date as YYYY-MM-DD in Cairo (the product's market). */
export function todayCairo(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
}

export function timeCairo(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

/** Date and time in Cairo, e.g. "1 Oct 07:42". */
export function dateTimeCairo(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}
