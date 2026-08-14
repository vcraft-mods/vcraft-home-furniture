/**
 * Vcraft ホーム家具 - モデル/テクスチャのプレビュー生成
 *
 * ジオメトリと terrain_texture の対応を実際に等角投影でラスタライズして
 * 「インベントリに出るアイコンがどう見えるか」を HTML で確認できるようにする。
 *   node tools/preview.js  →  preview/index.html
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const BP = path.join(ROOT, 'HomeBP');
const RP = path.join(ROOT, 'HomeRP');
const OUT = path.join(ROOT, 'preview');

const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

/* -------------------------------------------------------------- PNG 入出力 */

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

// RGBA8 の PNG を読む（このリポジトリが生成したものだけを対象にする）
function decodePNG(file) {
  const buf = fs.readFileSync(file);
  let offset = 8;
  let w = 0, h = 0;
  const idat = [];
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6) throw new Error(`${file}: RGBA8 以外は未対応`);
    } else if (type === 'IDAT') idat.push(data);
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

/* ------------------------------------------------------------- 等角投影描画 */

const COS30 = Math.cos(Math.PI / 6);
const SCALE = 5;
// カメラは (+X, +Y, -Z) 側。手前に見えるのは east / up / north の3面。
const project = (x, y, z) => ({ sx: (x + z) * COS30, sy: (x - z) * 0.5 - y, depth: x + y - z });

const SHADE = { up: 1.0, down: 0.55, north: 0.86, south: 0.86, east: 0.68, west: 0.68 };

// 面ごとの (u方向, v方向) を 3D の軸に対応させる
function faceCorners(origin, size, face) {
  const [ox, oy, oz] = origin;
  const [sx, sy, sz] = size;
  switch (face) {
    case 'north': return { p: [ox, oy + sy, oz], du: [sx, 0, 0], dv: [0, -sy, 0], n: [0, 0, -1] };
    case 'south': return { p: [ox, oy + sy, oz + sz], du: [sx, 0, 0], dv: [0, -sy, 0], n: [0, 0, 1] };
    case 'west': return { p: [ox, oy + sy, oz], du: [0, 0, sz], dv: [0, -sy, 0], n: [-1, 0, 0] };
    case 'east': return { p: [ox + sx, oy + sy, oz], du: [0, 0, sz], dv: [0, -sy, 0], n: [1, 0, 0] };
    case 'up': return { p: [ox, oy + sy, oz], du: [sx, 0, 0], dv: [0, 0, sz], n: [0, 1, 0] };
    case 'down': return { p: [ox, oy, oz], du: [sx, 0, 0], dv: [0, 0, sz], n: [0, -1, 0] };
    default: return null;
  }
}

function renderBlock(cubes, textureFor, W = 180, H = 180) {
  const rgba = Buffer.alloc(W * H * 4);
  const zbuf = new Float64Array(W * H).fill(-1e9);

  // 実際に描かれる範囲を先に測って中央に置く（下端で切れるのを防ぐ）
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const cube of cubes) {
    const [ox, oy, oz] = cube.origin;
    const [sx, sy, sz] = cube.size;
    for (const x of [ox, ox + sx]) {
      for (const y of [oy, oy + sy]) {
        for (const z of [oz, oz + sz]) {
          const q = project(x, y, z);
          minX = Math.min(minX, q.sx); maxX = Math.max(maxX, q.sx);
          minY = Math.min(minY, q.sy); maxY = Math.max(maxY, q.sy);
        }
      }
    }
  }
  const cx = W / 2 - ((minX + maxX) / 2) * SCALE;
  const cy = H / 2 - ((minY + maxY) / 2) * SCALE;

  for (const cube of cubes) {
    for (const [face, uvDef] of Object.entries(cube.uv ?? {})) {
      const geo = faceCorners(cube.origin, cube.size, face);
      if (!geo) continue;
      // カメラ方向 (1,1,-1) と法線の内積が正の面だけ描く
      if (geo.n[0] + geo.n[1] - geo.n[2] <= 0) continue;

      const tex = textureFor(uvDef.material_instance ?? '*');
      if (!tex) continue;
      const [u0, v0] = uvDef.uv;
      const [uw, vh] = uvDef.uv_size;
      const shade = SHADE[face];

      // 投影後のサイズから十分な密度でサンプリングする
      const a = project(...geo.p);
      const b = project(geo.p[0] + geo.du[0], geo.p[1] + geo.du[1], geo.p[2] + geo.du[2]);
      const c = project(geo.p[0] + geo.dv[0], geo.p[1] + geo.dv[1], geo.p[2] + geo.dv[2]);
      const lenU = Math.hypot(b.sx - a.sx, b.sy - a.sy) * SCALE;
      const lenV = Math.hypot(c.sx - a.sx, c.sy - a.sy) * SCALE;
      const stepsU = Math.max(2, Math.ceil(lenU * 3));
      const stepsV = Math.max(2, Math.ceil(lenV * 3));

      for (let i = 0; i < stepsU; i++) {
        const fu = (i + 0.5) / stepsU;
        for (let j = 0; j < stepsV; j++) {
          const fv = (j + 0.5) / stepsV;
          const x = geo.p[0] + geo.du[0] * fu + geo.dv[0] * fv;
          const y = geo.p[1] + geo.du[1] * fu + geo.dv[1] * fv;
          const z = geo.p[2] + geo.du[2] * fu + geo.dv[2] * fv;
          const q = project(x, y, z);
          const px = Math.round(cx + q.sx * SCALE);
          const py = Math.round(cy + q.sy * SCALE);
          if (px < 0 || py < 0 || px >= W || py >= H) continue;
          const idx = py * W + px;
          if (q.depth <= zbuf[idx]) continue;

          const tu = Math.min(tex.w - 1, Math.max(0, Math.floor((u0 + uw * fu) * (tex.w / 16))));
          const tv = Math.min(tex.h - 1, Math.max(0, Math.floor((v0 + vh * fv) * (tex.h / 16))));
          const t = (tv * tex.w + tu) * 4;
          if (tex.data[t + 3] < 128) continue;

          zbuf[idx] = q.depth;
          rgba[idx * 4] = Math.min(255, tex.data[t] * shade);
          rgba[idx * 4 + 1] = Math.min(255, tex.data[t + 1] * shade);
          rgba[idx * 4 + 2] = Math.min(255, tex.data[t + 2] * shade);
          rgba[idx * 4 + 3] = 255;
        }
      }
    }
  }
  return { w: W, h: H, data: rgba };
}

// 全ブロックを1枚にまとめたコンタクトシート（目視チェック用）
function contactSheet(tiles, columns = 8) {
  const tw = tiles[0].w, th = tiles[0].h;
  const rows = Math.ceil(tiles.length / columns);
  const W = tw * columns, H = th * rows;
  const out = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const x = i % W, y = (i / W) | 0;
    const checker = ((x / 16 | 0) + (y / 16 | 0)) % 2 ? 226 : 244;
    out[i * 4] = checker; out[i * 4 + 1] = checker; out[i * 4 + 2] = checker; out[i * 4 + 3] = 255;
  }
  tiles.forEach((tile, index) => {
    const ox = (index % columns) * tw;
    const oy = ((index / columns) | 0) * th;
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        const s = (y * tw + x) * 4;
        if (tile.data[s + 3] === 0) continue;
        const d = ((oy + y) * W + ox + x) * 4;
        out[d] = tile.data[s]; out[d + 1] = tile.data[s + 1];
        out[d + 2] = tile.data[s + 2]; out[d + 3] = 255;
      }
    }
  });
  return encodePNG(W, H, out);
}

/* ------------------------------------------------------------------- 実行 */

const geoFile = readJSON(path.join(RP, 'models', 'blocks', 'furniture.geo.json'));
const geometries = new Map();
for (const geo of geoFile['minecraft:geometry']) {
  geometries.set(geo.description.identifier, (geo.bones ?? []).flatMap((b) => b.cubes ?? []));
}

const atlas = readJSON(path.join(RP, 'textures', 'terrain_texture.json')).texture_data;
const textures = new Map();
for (const [key, value] of Object.entries(atlas)) {
  textures.set(key, decodePNG(path.join(RP, `${value.textures}.png`)));
}

const lang = new Map();
for (const line of fs.readFileSync(path.join(RP, 'texts', 'ja_JP.lang'), 'utf8').split(/\r?\n/)) {
  const eq = line.indexOf('=');
  if (eq > 0) lang.set(line.slice(0, eq), line.slice(eq + 1));
}

fs.mkdirSync(path.join(OUT, 'img'), { recursive: true });
const cards = [];
const tiles = [];

for (const file of fs.readdirSync(path.join(BP, 'blocks')).sort()) {
  const def = readJSON(path.join(BP, 'blocks', file))['minecraft:block'];
  const id = def.description.identifier;
  const geoId = def.components['minecraft:geometry'];
  const cubes = geometries.get(geoId);
  if (!cubes) continue;

  // PC は電源オンの見た目（パーミュテーション側）で確認したい
  let instances = def.components['minecraft:material_instances'];
  for (const perm of def.permutations ?? []) {
    if (perm.condition.includes('powered') && perm.components?.['minecraft:material_instances']) {
      instances = perm.components['minecraft:material_instances'];
    }
  }
  const textureFor = (name) => {
    const inst = instances[name] ?? instances['*'];
    return inst ? textures.get(inst.texture) : undefined;
  };

  const tile = renderBlock(cubes, textureFor);
  const name = id.replace('vcraft:', '');
  fs.writeFileSync(path.join(OUT, 'img', `${name}.png`), encodePNG(tile.w, tile.h, tile.data));
  tiles.push(tile);
  cards.push({
    id,
    label: lang.get(`tile.${id}.name`) ?? id,
    img: `img/${name}.png`,
    geo: geoId.replace('geometry.vcraft.', ''),
  });
}

const texCards = [...textures.keys()].sort().map((key) => ({
  key,
  img: `../HomeRP/${atlas[key].textures}.png`,
}));

const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vcraft ホーム家具 プレビュー</title>
<style>
  :root { color-scheme: light dark; --bg:#f6f6f4; --fg:#1a1a1a; --card:#fff; --line:#e2e2dd; --muted:#6b6b66; }
  @media (prefers-color-scheme: dark) { :root { --bg:#16181c; --fg:#eceef2; --card:#20242a; --line:#2f353d; --muted:#98a0ad; } }
  * { box-sizing: border-box; }
  body { margin:0; padding:28px; background:var(--bg); color:var(--fg);
         font-family: "Segoe UI", "Yu Gothic UI", system-ui, sans-serif; }
  h1 { font-size:20px; margin:0 0 4px; }
  h2 { font-size:15px; margin:32px 0 12px; padding-bottom:6px; border-bottom:1px solid var(--line); }
  p.lead { margin:0 0 8px; color:var(--muted); font-size:13px; }
  .grid { display:grid; gap:12px; grid-template-columns:repeat(auto-fill,minmax(132px,1fr)); }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:10px 8px; text-align:center; }
  .card img { width:100%; max-width:112px; height:auto; image-rendering:pixelated; display:block; margin:0 auto 6px; }
  .card b { display:block; font-size:12px; font-weight:600; }
  .card span { display:block; font-size:10px; color:var(--muted); margin-top:2px; word-break:break-all; }
  .tex { display:grid; gap:10px; grid-template-columns:repeat(auto-fill,minmax(96px,1fr)); }
  .tex figure { margin:0; background:var(--card); border:1px solid var(--line); border-radius:8px; padding:8px; text-align:center; }
  .tex img { width:64px; height:64px; image-rendering:pixelated;
             background:repeating-conic-gradient(#bbb 0 25%, #fff 0 50%) 0 0/12px 12px; }
  .tex figcaption { font-size:10px; color:var(--muted); margin-top:6px; word-break:break-all; }
</style></head><body>
<h1>Vcraft ホーム家具 — モデル / テクスチャ確認</h1>
<p class="lead">ブロックのジオメトリと material_instances を実際に等角投影で描画したもの。
インベントリのアイコンはこの見た目がそのまま使われる。</p>

<h2>ブロック ${cards.length} 種</h2>
<div class="grid">
${cards.map((c) => `  <div class="card"><img src="${c.img}" alt="${c.id}"><b>${c.label}</b><span>${c.id}<br>geo: ${c.geo}</span></div>`).join('\n')}
</div>

<h2>テクスチャ ${texCards.length} 枚</h2>
<div class="tex">
${texCards.map((t) => `  <figure><img src="${t.img}" alt="${t.key}"><figcaption>${t.key}</figcaption></figure>`).join('\n')}
</div>
</body></html>
`;

fs.writeFileSync(path.join(OUT, 'index.html'), html, 'utf8');
fs.writeFileSync(path.join(OUT, 'contact_sheet.png'), contactSheet(tiles));
console.log(`preview/index.html と contact_sheet.png を作成しました（ブロック ${cards.length} / テクスチャ ${texCards.length}）`);
