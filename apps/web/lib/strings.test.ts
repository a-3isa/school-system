import { describe, expect, it } from 'vitest';
import { ar, en } from './strings';

type Tree = { [key: string]: unknown };
// Some keys have dots in them (audit.actions['guardian.add']), so paths use another separator.
const SEP = ' > ';

/** Every place in a dictionary, as a path, with what is there. */
function walk(node: unknown, path: string[] = []): { path: string; node: unknown }[] {
  const here = { path: path.join(SEP), node };
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    return [here, ...Object.entries(node as Tree).flatMap(([k, v]) => walk(v, [...path, k]))];
  }
  return [here];
}
const at = (root: unknown, path: string) => path.split(SEP).filter(Boolean).reduce<unknown>((n, k) => (n as Tree | undefined)?.[k], root);
const kind = (n: unknown) => (typeof n === 'function' ? 'function' : Array.isArray(n) ? 'array' : n === null ? 'null' : typeof n);

describe('the dashboard’s words', () => {
  const places = walk(en).filter((p) => p.path);

  it('has every English word in Arabic, and nothing in Arabic that English lacks', () => {
    const arabicOnly = walk(ar).filter((p) => p.path && at(en, p.path) === undefined).map((p) => p.path);
    const missing = places.filter((p) => at(ar, p.path) === undefined).map((p) => p.path);
    expect({ missing, arabicOnly }).toEqual({ missing: [], arabicOnly: [] });
  });

  it('keeps the same kind of thing in each place: text, function, list or group', () => {
    const different = places.filter((p) => kind(at(ar, p.path)) !== kind(p.node)).map((p) => `${p.path}: ${kind(p.node)} / ${kind(at(ar, p.path))}`);
    expect(different).toEqual([]);
  });

  it('takes the same number of arguments in both languages', () => {
    const different = places
      .filter((p) => typeof p.node === 'function')
      .filter((p) => (at(ar, p.path) as (...a: unknown[]) => unknown).length !== (p.node as (...a: unknown[]) => unknown).length)
      .map((p) => p.path);
    expect(different).toEqual([]);
  });

  it('has lists of the same length (weekdays, months)', () => {
    const different = places.filter((p) => Array.isArray(p.node) && (at(ar, p.path) as unknown[])?.length !== (p.node as unknown[]).length).map((p) => p.path);
    expect(different).toEqual([]);
  });
});
