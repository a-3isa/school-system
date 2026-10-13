// Test helper: finds every sentence the API can answer with, by reading its source, so a new message
// without an Arabic form fails a test instead of reaching a school in English. Not part of the app.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const API_SRC = join(__dirname, '..', '..', 'api', 'src');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (path.endsWith('.ts') && !path.endsWith('.spec.ts')) out.push(path);
  }
  return out;
}

/** The text between the bracket at `open` and its partner, skipping over strings. */
function balanced(src: string, open: number): string {
  let depth = 0;
  let quote = '';
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return '';
}

/** Every string literal in a piece of code, outermost only. */
function literals(code: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c !== "'" && c !== '"' && c !== '`') continue;
    let text = '';
    let depth = 0;
    i++;
    for (; i < code.length; i++) {
      const d = code[i];
      if (d === '\\') {
        text += code[++i];
        continue;
      }
      if (c === '`' && d === '$' && code[i + 1] === '{') {
        // A placeholder: keep it as ${…}, whatever is inside.
        let inner = '';
        i += 2;
        depth = 1;
        while (i < code.length && depth) {
          if (code[i] === '{') depth++;
          if (code[i] === '}') depth--;
          if (depth) inner += code[i];
          i++;
        }
        i--;
        text += '${' + inner + '}';
        continue;
      }
      if (d === c) break;
      text += d;
    }
    out.push(text);
  }
  return out;
}

export interface ServerMessage {
  file: string;
  text: string;
}

/** The first argument of `new XxxException(…)`, the conflict message of `mapPrismaError(e, …)`, the wording of form rules, and fixed sentences kept in constants. */
export function serverMessages(): ServerMessage[] {
  const found: ServerMessage[] = [];
  for (const path of sourceFiles(API_SRC)) {
    const src = readFileSync(path, 'utf8');
    const file = path.slice(API_SRC.length + 1).replace(/\\/g, '/');
    for (const m of src.matchAll(/new\s+\w*Exception\s*\(/g)) {
      const args = balanced(src, m.index! + m[0].length - 1);
      // Only the message: the first argument (a second one is a status code).
      let depth = 0;
      let cut = args.length;
      for (let i = 0; i < args.length; i++) {
        const c = args[i];
        if (c === "'" || c === '"' || c === '`') {
          const q = c;
          for (i++; i < args.length && args[i] !== q; i++) if (args[i] === '\\') i++;
        } else if ('([{'.includes(c)) depth++;
        else if (')]}'.includes(c)) depth--;
        else if (c === ',' && depth === 0) {
          cut = i;
          break;
        }
      }
      for (const text of literals(args.slice(0, cut))) if (/[A-Za-z]{3}/.test(text) && / /.test(text)) found.push({ file, text });
    }
    for (const m of src.matchAll(/mapPrismaError\s*\(/g)) {
      const args = balanced(src, m.index! + m[0].length - 1);
      const comma = args.indexOf(',');
      if (comma > 0) for (const text of literals(args.slice(comma + 1))) if (/ /.test(text)) found.push({ file, text });
    }
    // The wording of a rule on a form field: @IsEmail({}, { message: '…' }).
    for (const m of src.matchAll(/@Is\w+\s*\(/g)) {
      const args = balanced(src, m.index! + m[0].length - 1);
      const at = args.indexOf('message:');
      if (at >= 0) for (const text of literals(args.slice(at + 'message:'.length)).slice(0, 1)) found.push({ file, text });
    }
    for (const m of src.matchAll(/^(?:export )?const (?:[A-Z][A-Z_]+) = (['"`].*['"`]);$/gm)) {
      for (const text of literals(m[1])) if (/[.!?]$/.test(text)) found.push({ file, text });
    }
  }
  // The same sentence in several places is one sentence.
  const seen = new Set<string>();
  return found.filter((f) => !seen.has(f.text) && !!seen.add(f.text));
}

const GENERIC = ['5', 'Sample', '09:30'];

/** What a placeholder can hold at run time, judging by what is written in it. */
function candidates(expression: string): string[] {
  if (/\?\s*''\s*:\s*'s'/.test(expression)) return ['', 's']; // a plural ending
  if (/kind/i.test(expression)) return ['praise', 'concern', 'incident'];
  if (/gender/i.test(expression)) return ['boy', 'girl'];
  if (/relation/i.test(expression)) return ['mother', 'father', 'guardian'];
  if (/missing/.test(expression)) return ['student’s photo', 'birth certificate', 'student’s photo and birth certificate'];
  return GENERIC;
}

/** The ways a message with placeholders might read at run time: numbers, words and times in every position. */
export function fillings(text: string): string[] {
  const holes = text.match(/\$\{[^}]*\}/g) ?? [];
  if (!holes.length) return [text];
  let out = [text];
  for (const hole of holes) {
    const options = candidates(hole.slice(2, -1));
    out = out.flatMap((t) => options.map((o) => t.replace(hole, o)));
  }
  return out;
}
