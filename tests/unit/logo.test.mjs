// The two variants of each logo must be the same artwork: the reversed file is derived from
// the colour file by scripts/reverse-logo.mjs, so a replaced logo cannot leave a stale pair.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodePng, knockOutBackground, reverse, trim } from '../../scripts/reverse-logo.mjs';

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
  for (const name of ['multicare-logo.png', 'multicare-logo-white.png', 'multicare-symbol.png', 'cbre-logo-green.png', 'cbre-logo-white.png']) {
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

const count = (img, pred) => {
  let n = 0;
  for (let i = 0; i < img.data.length; i += 4) if (pred(img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3])) n += 1;
  return n;
};

// The map marker for MultiCare-occupied parcels: the symbol the user supplied on white,
// with that background knocked out.
test('the map symbol is the MultiCare symbol on transparency, its cross kept white and no white fringe', async () => {
  const s = await asset('multicare-symbol.png');
  const alphaAt = (x, y) => s.data[(y * s.width + x) * 4 + 3];
  // the rounded and slanted corners of the symbol are background
  for (const [x, y] of [[0, 0], [s.width - 1, 0], [0, s.height - 1], [s.width - 1, s.height - 1]]) assert.equal(alphaAt(x, y), 0, `corner ${x},${y} is not transparent`);
  // blue ink (MultiCare blue, as supplied) and the opaque white cross
  assert.ok(count(s, (r, g, b, a) => a === 255 && r < 20 && g > 90 && g < 120 && b > 160 && b < 190) > 30_000);
  assert.ok(count(s, (r, g, b, a) => a === 255 && Math.min(r, g, b) >= 240) > 5_000);
  // no semi-transparent light pixel: the white matte was un-blended from the rim, not left as a halo
  assert.equal(count(s, (r, g, b, a) => a > 0 && a < 255 && Math.min(r, g, b) > 200), 0);
  // the aspect ratio of the MultiCare symbol
  assert.ok(Math.abs(s.width / s.height - 1.38) < 0.03, `aspect ${s.width / s.height}`);
  // re-running the knockout on the published symbol changes nothing
  assert.ok(knockOutBackground(s).data.equals(s.data));
});

test('knocking out a white background keeps enclosed white, un-blends the rim and leaves transparent artwork alone', () => {
  // 11x11: white background, a blue square ring from 2 to 8, white enclosed at the centre,
  // and a half-blended rim pixel on the ring's outer edge
  const w = 11;
  const h = 11;
  const data = Buffer.alloc(w * h * 4, 255);
  const set = (x, y, rgba) => data.set(rgba, (y * w + x) * 4);
  for (let y = 2; y <= 8; y++) for (let x = 2; x <= 8; x++) if (x < 4 || x > 6 || y < 4 || y > 6) set(x, y, [0, 104, 179, 255]);
  set(1, 5, [128, 180, 217, 255]); // 50% blue over white
  const out = knockOutBackground({ width: w, height: h, data });
  const px = (x, y) => [...out.data.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)];
  assert.deepEqual(px(0, 0), [0, 0, 0, 0]); // background
  assert.deepEqual(px(5, 5), [255, 255, 255, 255]); // enclosed white stays
  assert.deepEqual(px(3, 3), [0, 104, 179, 255]); // ink stays
  const rim = px(1, 5);
  assert.ok(Math.abs(rim[3] - 128) <= 2, `rim alpha ${rim[3]}`);
  assert.ok(rim[0] <= 2 && Math.abs(rim[1] - 104) <= 3 && Math.abs(rim[2] - 179) <= 3, `rim colour ${rim}`);
  // artwork already on transparency (the MultiCare logo) is returned unchanged
  const clear = { width: 3, height: 3, data: Buffer.alloc(36, 0) };
  clear.data.set([0, 104, 179, 255], 16);
  assert.equal(knockOutBackground(clear), clear);
});

test('the colour logo is untouched by the background knockout', async () => {
  const colour = await asset('multicare-logo.png');
  assert.ok(knockOutBackground(colour).data.equals(colour.data));
});
