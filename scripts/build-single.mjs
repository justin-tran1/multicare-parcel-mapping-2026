// Builds dist/index.html: a single self-contained page (Leaflet, styles, app code and
// bundled data inlined) that can be opened from disk, emailed, or published as-is.
import { build } from 'esbuild';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const safe = (s) => s.replace(/<\/(script|style)/gi, '<\\/$1');

const MIME = { '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const assetPath = (file) => join(root, 'assets', file);
/** Inlines every assets/ reference (HTML src or CSS url) as a data URI so the page works from disk. */
const inlineAssets = (text) => text.replace(/(src=|url\()(["']?)assets\/([^"')\s>]+)\2/g, (m, pre, q, file) => {
  if (!existsSync(assetPath(file))) throw new Error(`build-single: missing asset ${file}`);
  const mime = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
  return `${pre}${q}data:${mime};base64,${readFileSync(assetPath(file)).toString('base64')}${q}`;
});

const bundle = await build({
  entryPoints: [join(root, 'js/app.js')],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: false,
  write: false,
  legalComments: 'none',
});
const appJs = bundle.outputFiles[0].text;

const leafletCss = read('vendor/leaflet/leaflet.css').replace(/url\((["']?)images\/([^"')]+)\1\)/g, (m, q, file) => {
  const b64 = readFileSync(join(root, 'vendor/leaflet/images', file)).toString('base64');
  return `url(data:image/png;base64,${b64})`;
});

const dataScripts = ['wa_counties', 'multicare_locations']
  .map((name) => `<script type="application/json" id="data-${name}">${safe(read(`data/${name}.json`))}</script>`)
  .join('\n');

let html = inlineAssets(read('index.html'));
const replaceOnce = (needle, replacement) => {
  if (!html.includes(needle)) throw new Error(`build-single: could not find ${needle}`);
  html = html.replace(needle, () => replacement);
};
replaceOnce('<link rel="stylesheet" href="vendor/leaflet/leaflet.css">', `<style>${safe(leafletCss)}</style>`);
replaceOnce('<link rel="stylesheet" href="css/app.css">', `<style>${safe(inlineAssets(read('css/app.css')))}</style>`);
replaceOnce('<script src="vendor/leaflet/leaflet.js"></script>', `<script>${safe(read('vendor/leaflet/leaflet.js'))}</script>`);
replaceOnce('<script type="module" src="js/app.js"></script>', `${dataScripts}\n<script>${safe(appJs)}</script>`);

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/index.html'), html);
console.log(`wrote dist/index.html (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);
