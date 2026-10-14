// What each dashboard page makes the browser download, from the last `next build`: the JavaScript loaded
// before the page can run (gzipped, as served), the stylesheet, and the bundled fonts.
//
//   node scripts/bundle-report.mjs            # the table
//   node scripts/bundle-report.mjs --check    # also fail if a page or the fonts are over bundle-budget.json
//   node scripts/bundle-report.mjs --json out.json
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const next = join(root, '.next');
const app = JSON.parse(readFileSync(join(next, 'app-build-manifest.json'), 'utf8')).pages;
const build = JSON.parse(readFileSync(join(next, 'build-manifest.json'), 'utf8'));

const gz = new Map();
const size = (file) => {
  if (!gz.has(file)) gz.set(file, gzipSync(readFileSync(join(next, file))).length);
  return gz.get(file);
};
const kb = (b) => Math.round(b / 102.4) / 10;

const shared = [...(build.rootMainFiles ?? []), ...(build.polyfillFiles ?? [])].filter((f) => !f.includes('polyfill'));
const rows = [];
for (const key of Object.keys(app).filter((k) => k.endsWith('/page'))) {
  // A page loads its own chunks and those of every layout above it.
  const parts = key.split('/').slice(0, -1);
  const layouts = parts.map((_, i) => `${parts.slice(0, i + 1).join('/') || ''}/layout`);
  const files = new Set([...shared, ...layouts.flatMap((l) => app[l] ?? []), ...app[key]]);
  const js = [...files].filter((f) => f.endsWith('.js'));
  const css = [...files].filter((f) => f.endsWith('.css'));
  const route = key.replace(/\/page$/, '').replace(/\/\([^)]+\)/g, '') || '/';
  rows.push({ route, firstLoadKB: kb(js.reduce((n, f) => n + size(f), 0)), cssKB: kb(css.reduce((n, f) => n + size(f), 0)) });
}
rows.sort((a, b) => b.firstLoadKB - a.firstLoadKB);

const fontDir = join(root, 'public', 'fonts');
const fonts = readdirSync(fontDir)
  .filter((f) => /\.(woff2?|ttf|otf)$/.test(f))
  .map((f) => ({ file: f, kb: kb(statSync(join(fontDir, f)).size) }));
const fontKB = Math.round(fonts.reduce((n, f) => n + f.kb, 0));

console.table(rows);
console.table(fonts);
console.log(`Largest page: ${rows[0].route} ${rows[0].firstLoadKB} kB of JavaScript. Fonts in public/fonts: ${fontKB} kB in ${fonts.length} files.`);

const out = process.argv.indexOf('--json');
if (out > 0) writeFileSync(process.argv[out + 1], JSON.stringify({ rows, fonts, fontKB }, null, 2));

if (process.argv.includes('--check')) {
  const budget = JSON.parse(readFileSync(join(root, 'bundle-budget.json'), 'utf8'));
  const over = rows.filter((r) => r.firstLoadKB > budget.firstLoadKB).map((r) => `${r.route} loads ${r.firstLoadKB} kB of JavaScript (budget ${budget.firstLoadKB} kB)`);
  if (fontKB > budget.fontsKB) over.push(`The fonts are ${fontKB} kB (budget ${budget.fontsKB} kB)`);
  if (over.length) {
    console.error(`Over the bundle budget in bundle-budget.json:\n  ${over.join('\n  ')}`);
    process.exit(1);
  }
  console.log('Within the bundle budget.');
}
