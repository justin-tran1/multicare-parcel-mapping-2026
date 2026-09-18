// Copies the Leaflet runtime from node_modules into vendor/ so the app runs
// with no CDN dependency (GitHub Pages, file://, or offline).
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'leaflet', 'dist');
const dest = join(root, 'vendor', 'leaflet');
mkdirSync(dest, { recursive: true });
for (const f of ['leaflet.js', 'leaflet.css']) cpSync(join(src, f), join(dest, f));
cpSync(join(src, 'images'), join(dest, 'images'), { recursive: true });
const pkg = JSON.parse(readFileSync(join(root, 'node_modules', 'leaflet', 'package.json'), 'utf8'));
writeFileSync(join(dest, 'VERSION'), `${pkg.version}\n`);
console.log(`vendored leaflet ${pkg.version} -> vendor/leaflet`);
