/**
 * Vcraft ホーム家具 - サイト掲載用の画像を作る
 *
 * preview/img/ に出力済みのモデルレンダリングを並べて、
 * Vcraft サイト（arcana_addon/site/img/）に置くギャラリー画像を書き出す。
 *   node tools/preview.js && node tools/gen_site_images.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'preview', 'img');
// Vcraft のサイトは arcana_addon/site に置かれている（アドオン共通の1サイト）
const SITE_IMG = path.resolve(ROOT, '..', 'arcana_addon', 'site', 'img');

/* --------------------------------------------------------------- PNG 入出力 */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}
function decodePNG(file) {
  const buf = fs.readFileSync(file);
  let offset = 8, w = 0, h = 0;
  const idat = [];
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * 4;
  const out = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? out[y * stride + x - 4] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? out[(y - 1) * stride + x - 4] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = v & 0xff;
    }
  }
  return { w, h, data: out };
}

/* ------------------------------------------------------------------ 合成 */

const SCALE = 2;
const GAP = 8;

// 上から下へ色が変わる背景。Vcraft サイトのクリーム／グリーンに寄せる。
// top が null のときは背景を敷かない（ヒーローに重ねるので透過のままにする）。
function background(W, H, top, bottom) {
  const out = Buffer.alloc(W * H * 4);
  if (!top) return out;
  for (let y = 0; y < H; y++) {
    const k = y / (H - 1);
    const r = Math.round(top[0] + (bottom[0] - top[0]) * k);
    const g = Math.round(top[1] + (bottom[1] - top[1]) * k);
    const b = Math.round(top[2] + (bottom[2] - top[2]) * k);
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = 255;
    }
  }
  return out;
}

// 透明な余白を落として、中身だけの矩形にする
function crop(tile) {
  let minX = tile.w, maxX = -1, minY = tile.h, maxY = -1;
  for (let y = 0; y < tile.h; y++) {
    for (let x = 0; x < tile.w; x++) {
      if (tile.data[(y * tile.w + x) * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return tile;
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    tile.data.copy(data, y * w * 4, ((y + minY) * tile.w + minX) * 4, ((y + minY) * tile.w + minX + w) * 4);
  }
  return { w, h, data };
}

function compose(names, columns, file, top, bottom) {
  const tiles = names.map((n) => crop(decodePNG(path.join(SRC, `${n}.png`))));
  const cellW = Math.max(...tiles.map((t) => t.w)) * SCALE;
  const cellH = Math.max(...tiles.map((t) => t.h)) * SCALE;
  const rows = Math.ceil(tiles.length / columns);
  const W = columns * cellW + GAP * (columns + 1);
  const H = rows * cellH + GAP * (rows + 1);
  const out = background(W, H, top, bottom);

  tiles.forEach((tile, index) => {
    const tw = tile.w * SCALE;
    const th = tile.h * SCALE;
    // セルの中で下ぞろえ・左右中央にすると、家具が同じ床に並んで見える
    const ox = GAP + (index % columns) * (cellW + GAP) + ((cellW - tw) >> 1);
    const oy = GAP + ((index / columns) | 0) * (cellH + GAP) + (cellH - th);
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        const s = (((y / SCALE) | 0) * tile.w + ((x / SCALE) | 0)) * 4;
        if (tile.data[s + 3] === 0) continue;
        const d = ((oy + y) * W + ox + x) * 4;
        out[d] = tile.data[s]; out[d + 1] = tile.data[s + 1]; out[d + 2] = tile.data[s + 2];
        out[d + 3] = tile.data[s + 3]; // 透過背景のときはここで不透明にする
      }
    }
  });

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, encodePNG(W, H, out));
  return { W, H };
}

const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak',
  'mangrove', 'cherry', 'pale_oak', 'crimson', 'warped', 'bamboo'];

const JOBS = [
  // トップページのヒーローに置く1枚。飾りの図形の代わりに実物を見せるので背景は透過。
  ['hero-showcase', ['oak_chair', 'oak_dresser', 'pc_black',
    'quartz_sink', 'potato_statue', 'carpet_persian'], 3, null, null],
  ['shot-home-chairs', WOODS.map((w) => `${w}_chair`), 6, [246, 243, 236], [231, 234, 226]],
  ['shot-home-storage', [...WOODS.slice(0, 6).map((w) => `${w}_desk`), ...WOODS.slice(0, 6).map((w) => `${w}_dresser`)], 6, [244, 240, 233], [234, 228, 218]],
  ['shot-home-carpets', ['carpet_stripe', 'carpet_check', 'carpet_diamond', 'carpet_floral',
    'carpet_wave', 'carpet_frame', 'carpet_tatami', 'carpet_persian'], 4, [242, 244, 240], [226, 234, 228]],
  ['shot-home-gadgets', ['pc_black', 'pc_white', 'quartz_sink', 'potato_statue', 'bamboo_ladder'], 5, [238, 241, 245], [224, 230, 238]],
];

for (const [name, list, columns, top, bottom] of JOBS) {
  const { W, H } = compose(list, columns, path.join(SITE_IMG, `${name}.png`), top, bottom);
  console.log(`${name}.png (${W}x${H}) を ${path.relative(path.resolve(ROOT, '..'), SITE_IMG)} に出力しました`);
}
