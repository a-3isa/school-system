'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

/** Loads a GET endpoint; `reload()` fetches again after a change. */
export function useApi<T = any>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  /** When the data last arrived, for "Updated just now". */
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  // Only the latest request may set the data: an older one that answers late would show stale results.
  const latest = useRef(0);

  const reload = useCallback(async () => {
    if (!path) return;
    const call = ++latest.current;
    setLoading(true);
    try {
      const next = await api<T>(path);
      if (call !== latest.current) return;
      setData(next);
      setLoadedAt(Date.now());
      setError(null);
    } catch (e) {
      if (call === latest.current) setError((e as Error).message);
    } finally {
      if (call === latest.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, loadedAt, reload, setData };
}

/**
 * Calls `fn` every `ms` while `on` is true. It pauses while the tab is hidden, and on coming back
 * catches up at once if a call is overdue.
 */
export function useEvery(ms: number, fn: () => unknown, on = true) {
  useEffect(() => {
    if (!on) return;
    let last = Date.now();
    const run = () => {
      last = Date.now();
      void fn();
    };
    const t = setInterval(() => {
      if (!document.hidden) run();
    }, ms);
    const shown = () => {
      if (!document.hidden && Date.now() - last >= ms) run();
    };
    document.addEventListener('visibilitychange', shown);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', shown);
    };
  }, [ms, fn, on]);
}

/** `value`, once it has stopped changing for `ms`: a search sent when the typing pauses, not on every key. */
export function useDebounced<T>(value: T, ms = 250) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
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
