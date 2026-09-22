// The committed standalone page (dist/index.html) must be self-contained: styles, scripts,
// Leaflet and every logo in assets/ inlined, so that it works from disk and as an email attachment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const dist = await readFile(new URL('../../dist/index.html', import.meta.url), 'utf8');
const source = await readFile(new URL('../../index.html', import.meta.url), 'utf8');

test('the standalone build inlines the logos and references no local file', () => {
  const localRefs = [...dist.matchAll(/(?:src|href)=["'](?:assets|css|js|vendor)\/[^"']*|url\(["']?(?:assets|vendor)\/[^"')]*/g)].map((m) => m[0]);
  assert.deepEqual(localRefs, [], 'local file references left in dist');
  assert.match(dist, /<img class="logo logo-cbre" src="data:image\/png;base64,/);
  assert.match(dist, /<img class="logo logo-multicare" src="data:image\/svg\+xml;base64,/);
  assert.equal((dist.match(/data:image\/png;base64,/g) || []).length >= 3, true, 'three CBRE logo images (header, exhibit header, footer)');
});

test('every logo the page references exists in assets/ and the print button reads Print Exhibit', async () => {
  const files = new Set(await readdir(new URL('../../assets/', import.meta.url)));
  const refs = [...source.matchAll(/src="assets\/([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(refs.filter((f) => !files.has(f)), []);
  assert.deepEqual([...new Set(refs)].sort(), ['cbre-logo-green.png', 'cbre-logo-white.png', 'multicare-logo-white.svg', 'multicare-logo.svg']);
  assert.match(source, />Print Exhibit<\/button>/);
  assert.match(dist, />Print Exhibit<\/button>/);
});

// Guards against a committed dist built before an asset was replaced: each logo the source
// references must appear in dist as the base64 of the file that is in assets/ today.
test('the inlined logos match the current files in assets/', async () => {
  const refs = [...new Set([...source.matchAll(/src="assets\/([^"]+)"/g)].map((m) => m[1]))];
  assert.ok(refs.length >= 4);
  for (const file of refs) {
    const b64 = (await readFile(new URL(`../../assets/${file}`, import.meta.url))).toString('base64');
    assert.ok(dist.includes(`base64,${b64}`), `dist/index.html does not carry the current assets/${file}; run npm run build:single`);
  }
});
