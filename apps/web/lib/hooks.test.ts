import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.fn();
vi.mock('./api', () => ({ api: (...a: unknown[]) => api(...a) }));

import { useApi, useDebounced, useEvery } from './hooks';

let hidden = false;
const setHidden = (value: boolean) => {
  hidden = value;
  document.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(() => {
  vi.useFakeTimers();
  hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  api.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('useEvery', () => {
  it('calls on every interval while the tab is in view', () => {
    const fn = vi.fn();
    renderHook(() => useEvery(1000, fn));
    vi.advanceTimersByTime(3000);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('pauses while the tab is hidden and catches up once on coming back', () => {
    const fn = vi.fn();
    renderHook(() => useEvery(1000, fn));
    act(() => setHidden(true));
    vi.advanceTimersByTime(10_000);
    expect(fn).not.toHaveBeenCalled();
    act(() => setHidden(false));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not call early when the tab comes back before the interval is up', () => {
    const fn = vi.fn();
    renderHook(() => useEvery(1000, fn));
    vi.advanceTimersByTime(400);
    act(() => setHidden(true));
    act(() => setHidden(false));
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('useDebounced', () => {
  it('passes the value on only once the typing pauses', () => {
    const { result, rerender } = renderHook(({ v }) => useDebounced(v, 250), { initialProps: { v: '' } });
    rerender({ v: 'S' });
    vi.advanceTimersByTime(100);
    rerender({ v: 'Sa' });
    vi.advanceTimersByTime(100);
    expect(result.current).toBe('');
    act(() => void vi.advanceTimersByTime(250));
    expect(result.current).toBe('Sa');
  });
});

describe('useApi', () => {
  it('keeps the answer to the latest request when an older one answers later', async () => {
    let answer: Record<string, (v: unknown) => void> = {};
    api.mockImplementation((path: string) => new Promise((resolve) => (answer[path] = resolve)));
    const { result, rerender } = renderHook(({ path }) => useApi(path), { initialProps: { path: '/students?q=S' } });
    rerender({ path: '/students?q=Sal' });
    await act(async () => answer['/students?q=Sal'](['Salma']));
    await act(async () => answer['/students?q=S'](['Sara', 'Salma']));
    expect(result.current.data).toEqual(['Salma']);
    expect(result.current.loading).toBe(false);
    answer = {};
  });
});
