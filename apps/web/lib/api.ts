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

/** The time now in Cairo as "HH:MM", to compare with period times. */
export function nowCairo(): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
}

/** Minutes since midnight for "HH:MM". */
export const minutes = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

export function timeCairo(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

/** Date and time in Cairo, e.g. "1 Oct 07:42". */
export function dateTimeCairo(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

/** Sends a file as multipart form data under the field name "file", with any other fields. */
export async function upload<T = any>(path: string, file: File, fields: Record<string, string> = {}, method: 'POST' | 'PUT' = 'POST'): Promise<T> {
  const token = getToken();
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append('file', file);
  const res = await fetch(`${API_URL}${path}`, { method, body: form, headers: token ? { authorization: `Bearer ${token}` } : {} });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, Array.isArray(data?.message) ? data.message.join(' ') : data?.message ?? `Upload failed (${res.status}).`);
  return data as T;
}

/** Fetches a file from the API with the login token, as an address an <img> or a new tab can use. */
export async function blobUrl(path: string): Promise<string> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError(res.status, `Couldn’t open the file (${res.status}).`);
  return URL.createObjectURL(await res.blob());
}

/** Downloads a file from the API (with the login token) and saves it. */
export async function download(path: string, filename: string) {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError(res.status, `Download failed (${res.status}).`);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** The moment a date and time (HH:MM) on a Cairo clock fall on, as a Date. Cairo is UTC+3 in summer time and UTC+2 otherwise. */
export function cairoInstant(date: string, hm: string): Date {
  const at = (offset: number) => new Date(Date.parse(`${date}T${hm}:00Z`) - offset * 3600_000);
  const reads = (d: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Africa/Cairo', dateStyle: 'short', timeStyle: 'short' }).format(d);
  return [3, 2].map(at).find((d) => reads(d) === `${date} ${hm}`) ?? at(2);
}
