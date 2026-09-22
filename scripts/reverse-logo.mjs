// Derives the reversed (white) variant of a logo from its full-colour PNG, so the same mark
// can sit on the CBRE-green bars and on the white exhibit footer.
//
//   node scripts/reverse-logo.mjs [source.png] [colour-out.png] [reversed-out.png]
//
// Defaults regenerate the MultiCare marks in place:
//   node scripts/reverse-logo.mjs assets/multicare-logo.png
//
// Both outputs are trimmed to the artwork so that the CSS, which sizes logos by height,
// gets the true aspect ratio. In the reversed variant the ink becomes white and anything
// knocked out of it (the cross inside the MultiCare symbol) becomes transparent, so the bar
// colour shows through. Fully transparent pixels stay transparent and antialiasing is kept.
//
// PNG support here is deliberately minimal: 8-bit non-interlaced images, which is what logo
// artwork is. It avoids a dependency for something run only when the artwork changes.
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** Decodes an 8-bit non-interlaced PNG to straight RGBA. */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let p = 8;
  let head = null;
  let palette = null;
  let alpha = null;
  const idat = [];
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') head = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
    else if (type === 'PLTE') palette = Buffer.from(data);
    else if (type === 'tRNS') alpha = Buffer.from(data);
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (!head) throw new Error('no IHDR');
  if (head.depth !== 8 || head.interlace !== 0) throw new Error(`unsupported PNG: ${head.depth}-bit, interlace ${head.interlace}`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[head.color];
  if (!channels) throw new Error(`unsupported colour type ${head.color}`);
  if (head.color === 3 && !palette) throw new Error('indexed PNG without a palette');

  const { width, height } = head;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  const planes = Buffer.alloc(stride * height);
  let q = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[q++];
    const line = raw.subarray(q, q + stride);
    q += stride;
    const cur = planes.subarray(y * stride, (y + 1) * stride);
    const prev = y ? planes.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      const v = line[x];
      let out;
      switch (filter) {
        case 0: out = v; break;
        case 1: out = v + a; break;
        case 2: out = v + b; break;
        case 3: out = v + ((a + b) >> 1); break;
        case 4: {
          const pa = Math.abs(b - c);
          const pb = Math.abs(a - c);
          const pc = Math.abs(a + b - 2 * c);
          out = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`unsupported filter ${filter}`);
      }
      cur[x] = out & 0xff;
    }
  }

  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, n = width * height; i < n; i++) {
    const s = i * channels;
    const d = i * 4;
    let r; let g; let b; let a = 255;
    switch (head.color) {
      case 0: r = g = b = planes[s]; break;
      case 2: [r, g, b] = [planes[s], planes[s + 1], planes[s + 2]]; break;
      case 3: {
        const idx = planes[s];
        [r, g, b] = [palette[idx * 3], palette[idx * 3 + 1], palette[idx * 3 + 2]];
        a = alpha && idx < alpha.length ? alpha[idx] : 255;
        break;
      }
      case 4: r = g = b = planes[s]; a = planes[s + 1]; break;
      default: [r, g, b, a] = [planes[s], planes[s + 1], planes[s + 2], planes[s + 3]];
    }
    rgba[d] = r; rgba[d + 1] = g; rgba[d + 2] = b; rgba[d + 3] = a;
  }
  return { width, height, data: rgba };
}

/** Encodes straight RGBA as an 8-bit PNG. */
export function encodePng({ width, height, data }) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none — logo artwork compresses well without it
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const chunk = (type, body) => {
    const out = Buffer.alloc(body.length + 12);
    out.writeUInt32BE(body.length, 0);
    out.write(type, 4, 'ascii');
    body.copy(out, 8);
    out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), body])), body.length + 8);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Crops away fully transparent margins. */
export function trim(img, threshold = 0) {
  const { width, height, data } = img;
  let x0 = width; let y0 = height; let x1 = -1; let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return img; // nothing but transparency: leave it alone
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    data.copy(out, y * w * 4, ((y + y0) * width + x0) * 4, ((y + y0) * width + x0 + w) * 4);
  }
  return { width: w, height: h, data: out };
}

/**
 * Turns the ink white and the knockouts transparent. Ink coverage is read from the channel
 * the ink darkens most, which is 0 for a solid ink pixel and 255 for a white knockout, so a
 * solid pixel becomes opaque white, a knocked-out one becomes fully transparent, and the
 * blend between them keeps its soft edge.
 */
export function reverse(img) {
  const { width, height } = img;
  const src = img.data;
  const out = Buffer.alloc(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const darkest = Math.min(src[i], src[i + 1], src[i + 2]);
    const coverage = 1 - darkest / 255;
    out[i] = 255; out[i + 1] = 255; out[i + 2] = 255;
    out[i + 3] = Math.round(src[i + 3] * coverage);
  }
  return { width, height, data: out };
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const [source = 'assets/multicare-logo.png', colourOut = source, reversedOut = source.replace(/\.png$/, '-white.png')] = process.argv.slice(2);
  const trimmed = trim(decodePng(readFileSync(source)));
  writeFileSync(colourOut, encodePng(trimmed));
  writeFileSync(reversedOut, encodePng(reverse(trimmed)));
  console.log(`wrote ${colourOut} and ${reversedOut} (${trimmed.width}x${trimmed.height})`);
}
