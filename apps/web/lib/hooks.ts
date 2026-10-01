'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

/** Loads a GET endpoint; `reload()` fetches again after a change. */
export function useApi<T = any>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  /** When the data last arrived, for "Updated just now". */
  const [loadedAt, setLoadedAt] = useState<number | null>(null);

  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api<T>(path));
      setLoadedAt(Date.now());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, loadedAt, reload, setData };
}

/** Calls `fn` every `ms` while `on` is true. */
export function useEvery(ms: number, fn: () => unknown, on = true) {
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => void fn(), ms);
    return () => clearInterval(t);
  }, [ms, fn, on]);
}

/** Runs an action, reporting failures; returns true when it worked. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, setError };
}
