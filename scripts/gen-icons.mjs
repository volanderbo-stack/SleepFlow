// Generates PWA PNG icons (crescent moon on a night gradient) without external deps.
// Usage: node scripts/gen-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const smooth = (edge, d, aa) => Math.min(1, Math.max(0, (edge - d) / aa + 0.5));
const STARS = [
  [0.24, 0.26, 0.012],
  [0.78, 0.22, 0.009],
  [0.7, 0.72, 0.008],
  [0.2, 0.7, 0.007],
];

/** @param {number} size @param {number} scale moon scale (smaller for maskable safe zone) */
function draw(size, scale) {
  const px = Buffer.alloc(size * size * 4);
  const aa = 1.2 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      // background: radial gradient indigo -> night blue
      const g = Math.min(1, Math.hypot(u - 0.35, v - 0.3) / 0.9);
      let r = 0x2a * (1 - g) + 0x0b * g;
      let gg = 0x24 * (1 - g) + 0x10 * g;
      let b = 0x6b * (1 - g) + 0x20 * g;
      // crescent: big circle minus offset circle
      const cx = 0.5, cy = 0.5, R = 0.27 * scale;
      const d1 = Math.hypot(u - cx, v - cy);
      const d2 = Math.hypot(u - (cx + 0.13 * scale), v - (cy - 0.1 * scale));
      const moon = smooth(R, d1, aa) * (1 - smooth(R * 0.86, d2, aa));
      r = r * (1 - moon) + 0xee * moon;
      gg = gg * (1 - moon) + 0xe8 * moon;
      b = b * (1 - moon) + 0xff * moon;
      for (const [sx, sy, sr] of STARS) {
        const s = smooth(sr * scale, Math.hypot(u - (0.5 + (sx - 0.5) * scale), v - (0.5 + (sy - 0.5) * scale)), aa);
        r = r * (1 - s) + 0x7d * s;
        gg = gg * (1 - s) + 0xe3 * s;
        b = b * (1 - s) + 0xe0 * s;
      }
      const i = (y * size + x) * 4;
      px[i] = Math.round(r);
      px[i + 1] = Math.round(gg);
      px[i + 2] = Math.round(b);
      px[i + 3] = 255;
    }
  }
  return encodePng(size, px);
}

writeFileSync(join(outDir, 'icon-192.png'), draw(192, 1));
writeFileSync(join(outDir, 'icon-512.png'), draw(512, 1));
writeFileSync(join(outDir, 'icon-512-maskable.png'), draw(512, 0.78));
writeFileSync(join(outDir, 'apple-touch-icon.png'), draw(180, 0.9));
console.log('Icons written to', outDir);
