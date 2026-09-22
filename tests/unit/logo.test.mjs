// The two variants of each logo must be the same artwork: the reversed file is derived from
// the colour file by scripts/reverse-logo.mjs, so a replaced logo cannot leave a stale pair.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodePng, reverse, trim } from '../../scripts/reverse-logo.mjs';

const asset = async (name) => decodePng(await readFile(new URL(`../../assets/${name}`, import.meta.url)));

test('the reversed MultiCare mark is the current colour mark, in white', async () => {
  const colour = await asset('multicare-logo.png');
  const white = await asset('multicare-logo-white.png');
  const expected = reverse(colour);
  // Pixels, not file bytes: the assets may be re-compressed or optimised, but they must stay
  // the same artwork. A stale reversed file fails here.
  assert.equal(white.width, expected.width);
  assert.equal(white.height, expected.height);
  assert.ok(white.data.equals(expected.data), 'run node scripts/reverse-logo.mjs assets/multicare-logo.png');
});

test('both marks are trimmed to the artwork and carry no opaque background', async () => {
  for (const name of ['multicare-logo.png', 'multicare-logo-white.png', 'cbre-logo-green.png', 'cbre-logo-white.png']) {
    const img = await asset(name);
    const trimmed = trim(img);
    assert.equal(trimmed.width, img.width, `${name} has transparent margins`);
    assert.equal(trimmed.height, img.height, `${name} has transparent margins`);
    const corner = (x, y) => img.data[(y * img.width + x) * 4 + 3];
    assert.equal(corner(0, 0) < 255 || corner(img.width - 1, img.height - 1) < 255, true, `${name} looks like it has a filled background`);
  }
});

test('the MultiCare marks carry the brand blue and its reversed white, with the cross knocked out', async () => {
  const colour = await asset('multicare-logo.png');
  const white = await asset('multicare-logo-white.png');
  const count = (img, pred) => {
    let n = 0;
    for (let i = 0; i < img.data.length; i += 4) if (pred(img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3])) n += 1;
    return n;
  };
  // MultiCare blue #0068B3 covers the wordmark and the symbol
  assert.ok(count(colour, (r, g, b, a) => a === 255 && r === 0x00 && g === 0x68 && b === 0xB3) > 50_000);
  // the cross inside the symbol is white in the colour mark and knocked out of the reversed one
  assert.ok(count(colour, (r, g, b, a) => a === 255 && r === 255 && g === 255 && b === 255) > 1_000);
  assert.equal(count(white, (r, g, b, a) => a > 0 && (r !== 255 || g !== 255 || b !== 255)), 0, 'the reversed mark is white only');
  assert.ok(count(white, (r, g, b, a) => a === 255) > 50_000);
});
