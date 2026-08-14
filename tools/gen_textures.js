/**
 * Vcraft ホーム家具 - テクスチャ生成
 * 依存ライブラリなしで PNG(RGBA8) を直接書き出す。バニラのアセットは一切使わない。
 *   node tools/gen_textures.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const RP = path.join(ROOT, 'HomeRP');
const BP = path.join(ROOT, 'HomeBP');
const BLOCKS = path.join(RP, 'textures', 'blocks');

/* ---------------------------------------------------------------- PNG 出力 */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

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
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ 描画 */

const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));

function hex(c) {
  if (Array.isArray(c)) return c;
  const s = c.replace('#', '');
  return [
    parseInt(s.slice(0, 2), 16),
    parseInt(s.slice(2, 4), 16),
    parseInt(s.slice(4, 6), 16),
    s.length >= 8 ? parseInt(s.slice(6, 8), 16) : 255,
  ];
}

// 明度を amount(-1..1) だけずらした色を返す
function shift(c, amount) {
  const [r, g, b, a] = hex(c);
  const t = amount >= 0 ? 255 : 0;
  const k = Math.abs(amount);
  return [clamp(r + (t - r) * k), clamp(g + (t - g) * k), clamp(b + (t - b) * k), a];
}

// 決定論的な擬似乱数（同じ入力なら常に同じテクスチャになる）
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const seedOf = (text) => {
  let h = 2166136261;
  for (const ch of text) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

class Canvas {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.data = Buffer.alloc(w * h * 4); // 全ピクセル透明で初期化
  }
  set(x, y, color) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const [r, g, b, a] = hex(color);
    const i = (y * this.w + x) * 4;
    this.data[i] = r; this.data[i + 1] = g; this.data[i + 2] = b; this.data[i + 3] = a;
  }
  rect(x, y, w, h, color) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, color);
  }
  // 枠線だけ描く
  frame(x, y, w, h, color) {
    for (let i = 0; i < w; i++) { this.set(x + i, y, color); this.set(x + i, y + h - 1, color); }
    for (let j = 0; j < h; j++) { this.set(x, y + j, color); this.set(x + w - 1, y + j, color); }
  }
  // ざらつきを載せて塗る
  noise(x, y, w, h, color, amount, seed) {
    const rand = rng(seed);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        this.set(x + i, y + j, shift(color, (rand() - 0.5) * 2 * amount));
      }
    }
  }
  save(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, encodePNG(this.w, this.h, this.data));
  }
}

// 文字グリッドのドット絵を描く。行数・桁数が揃っていなければ即エラーにする。
function drawGrid(canvas, rows, palette, ox = 0, oy = 0) {
  rows.forEach((row, y) => {
    if (row.length !== rows.length) {
      throw new Error(`グリッド行 ${y} の長さが ${row.length}（期待値 ${rows.length}）: "${row}"`);
    }
    [...row].forEach((ch, x) => {
      const c = palette[ch];
      if (c) canvas.set(x + ox, y + oy, c);
    });
  });
}

const written = [];
function save(canvas, dir, name) {
  canvas.save(path.join(dir, `${name}.png`));
  written.push(name);
}

/* ---------------------------------------------------------------- 木材 12種 */

const WOOD_COLORS = {
  oak:      { base: '#b08b4f', dark: '#8a6a38', light: '#c4a067' },
  spruce:   { base: '#7a5a34', dark: '#5c4426', light: '#8e6c42' },
  birch:    { base: '#c7b27c', dark: '#a8945f', light: '#d8c594' },
  jungle:   { base: '#a9765a', dark: '#855a43', light: '#be886b' },
  acacia:   { base: '#ba6337', dark: '#93482a', light: '#cd764a' },
  dark_oak: { base: '#4b3218', dark: '#362310', light: '#5d4022' },
  mangrove: { base: '#773b36', dark: '#5a2b28', light: '#8c4a44' },
  cherry:   { base: '#e3b0a5', dark: '#c48d83', light: '#f0c6bc' },
  pale_oak: { base: '#e3dcd2', dark: '#bfb7aa', light: '#f2ece4' },
  crimson:  { base: '#6a344b', dark: '#4e2537', light: '#7e4059' },
  warped:   { base: '#2c6d65', dark: '#1f514b', light: '#398177' },
  bamboo:   { base: '#c4b156', dark: '#a08f3e', light: '#d7c56e' },
};

// 横板が4段並んだ板材テクスチャ
function plankTexture(name, c) {
  const cv = new Canvas(16, 16);
  const rand = rng(seedOf(name));
  const seams = [5, 11, 2, 13];
  for (let row = 0; row < 4; row++) {
    const y0 = row * 4;
    const tint = (row % 2 === 0 ? 0.03 : -0.03);
    for (let y = y0; y < y0 + 4; y++) {
      for (let x = 0; x < 16; x++) {
        const grain = rand() < 0.16 ? (rand() < 0.5 ? -0.09 : 0.07) : 0;
        cv.set(x, y, shift(c.base, tint + grain + (rand() - 0.5) * 0.05));
      }
    }
    // 板の下端の影
    for (let x = 0; x < 16; x++) cv.set(x, y0 + 3, shift(c.dark, -0.06));
    // 上端のハイライト
    for (let x = 0; x < 16; x++) if (rand() < 0.55) cv.set(x, y0, shift(c.light, 0.04));
    // 木口の継ぎ目
    const seam = seams[row];
    for (let y = y0; y < y0 + 3; y++) cv.set(seam, y, c.dark);
  }
  return cv;
}

for (const [wood, c] of Object.entries(WOOD_COLORS)) {
  save(plankTexture(`vc_planks_${wood}`, c), BLOCKS, `vc_planks_${wood}`);
}

/* ------------------------------------------------------------ 素材テクスチャ */

// 金属（取っ手・蛇口）: 縦にヘアラインが入ったダークスチール
{
  const cv = new Canvas(16, 16);
  const rand = rng(seedOf('metal'));
  for (let x = 0; x < 16; x++) {
    const streak = (rand() - 0.5) * 0.22;
    for (let y = 0; y < 16; y++) cv.set(x, y, shift('#6e727a', streak + (rand() - 0.5) * 0.06));
  }
  for (let y = 0; y < 16; y++) { cv.set(0, y, '#43464c'); cv.set(15, y, '#43464c'); }
  save(cv, BLOCKS, 'vc_metal');
}

// クォーツ（側面 / 上面）
{
  for (const [name, base, lines] of [['vc_quartz_side', '#e6e3dc', true], ['vc_quartz_top', '#eeece6', false]]) {
    const cv = new Canvas(16, 16);
    cv.noise(0, 0, 16, 16, base, 0.05, seedOf(name));
    if (lines) for (let y = 0; y < 16; y++) { cv.set(3, y, shift(base, -0.07)); cv.set(11, y, shift(base, -0.05)); }
    const rand = rng(seedOf(name + 'x'));
    for (let i = 0; i < 10; i++) cv.set(rand() * 16, rand() * 16, shift(base, 0.10));
    save(cv, BLOCKS, name);
  }
}

// 銅（台座）
{
  const cv = new Canvas(16, 16);
  cv.noise(0, 0, 16, 16, '#c1793f', 0.10, seedOf('copper'));
  cv.frame(0, 0, 16, 16, '#96592b');
  cv.frame(3, 3, 10, 10, shift('#c1793f', 0.10));
  save(cv, BLOCKS, 'vc_copper');
}

// 水面（半透明）
{
  const cv = new Canvas(16, 16);
  const rand = rng(seedOf('water'));
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const wave = Math.sin((x + y * 0.7) * 0.8) * 0.08;
      const [r, g, b] = shift('#3f7fd6', wave + (rand() - 0.5) * 0.05);
      cv.set(x, y, [r, g, b, 190]);
    }
  }
  save(cv, BLOCKS, 'vc_water');
}

// じゃがいも（本体 / 顔）
{
  const base = '#c99a5c', dark = '#a3773d', spot = '#7d5828', hi = '#ddb47a';
  const body = new Canvas(16, 16);
  body.noise(0, 0, 16, 16, base, 0.10, seedOf('potato'));
  const rand = rng(seedOf('potato-spot'));
  for (let i = 0; i < 22; i++) {
    const x = Math.floor(rand() * 16), y = Math.floor(rand() * 16);
    body.set(x, y, spot);
    if (rand() < 0.5) body.set(x + 1, y, dark);
  }
  for (let i = 0; i < 14; i++) body.set(Math.floor(rand() * 16), Math.floor(rand() * 16), hi);
  save(body, BLOCKS, 'vc_potato');

  const face = new Canvas(16, 16);
  face.data = Buffer.from(body.data); // 同じ肌の上に顔を描く
  const eye = '#2a1b0c';
  face.rect(4, 5, 2, 3, eye);
  face.rect(10, 5, 2, 3, eye);
  face.set(4, 5, hi); face.set(10, 5, hi);
  for (const [x, y] of [[5, 11], [6, 12], [7, 12], [8, 12], [9, 12], [10, 11]]) face.set(x, y, eye);
  face.set(3, 9, '#d98d8d'); face.set(12, 9, '#d98d8d'); // ほっぺ
  save(face, BLOCKS, 'vc_potato_face');
}

/* -------------------------------------------------------------------- PC */

// ケース（黒 / 白）: 薄いパネルラインとスリット
for (const [name, base, line] of [['vc_pc_black', '#1e1f23', '#2e3037'], ['vc_pc_white', '#ececed', '#d2d3d6']]) {
  const cv = new Canvas(16, 16);
  cv.noise(0, 0, 16, 16, base, 0.03, seedOf(name));
  cv.frame(0, 0, 16, 16, shift(base, base === '#1e1f23' ? 0.06 : -0.08));
  for (let y = 3; y < 13; y += 3) for (let x = 3; x < 13; x++) cv.set(x, y, line);
  save(cv, BLOCKS, name);
}

// キーボード / マウス面
for (const [name, base, key] of [['vc_pc_key_black', '#232429', '#3c3e46'], ['vc_pc_key_white', '#e2e2e5', '#bfc0c6']]) {
  const cv = new Canvas(16, 16);
  cv.noise(0, 0, 16, 16, base, 0.03, seedOf(name));
  for (let y = 2; y < 15; y += 3) for (let x = 1; x < 15; x += 2) cv.rect(x, y, 1, 2, key);
  save(cv, BLOCKS, name);
}

// 画面（起動中）: モダンなデスクトップ風
{
  const cv = new Canvas(16, 16);
  cv.rect(0, 0, 16, 16, '#1c2331');
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    cv.set(x, y, shift('#1c2331', (y / 16) * 0.18)); // 上が暗いグラデーション壁紙
  }
  cv.rect(2, 2, 9, 7, '#39445c');       // ウィンドウ
  cv.rect(2, 2, 9, 2, '#5b6d90');       // タイトルバー
  cv.set(9, 3, '#ff6b6b'); cv.set(8, 3, '#ffd166'); cv.set(7, 3, '#6bd39a');
  for (let y = 5; y < 8; y++) for (let x = 3; x < 10; x += 2) cv.set(x, y, '#8ea3c8');
  cv.rect(12, 3, 3, 3, '#4ec3ad');      // アイコン
  cv.rect(12, 7, 3, 3, '#e0a44e');
  cv.rect(0, 13, 16, 3, '#151a24');     // タスクバー
  cv.rect(1, 14, 2, 1, '#4cc2ff');
  cv.rect(4, 14, 1, 1, '#8ea3c8');
  cv.rect(6, 14, 1, 1, '#8ea3c8');
  cv.rect(13, 14, 2, 1, '#4a5468');
  save(cv, BLOCKS, 'vc_pc_screen_on');
}

// 画面（電源オフ）
{
  const cv = new Canvas(16, 16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    cv.set(x, y, shift('#0d1013', (x + y) / 64 * 0.10));
  }
  cv.set(14, 14, '#5a2020'); // 待機ランプ
  save(cv, BLOCKS, 'vc_pc_screen_off');
}

/* ------------------------------------------------------------- 竹のはしご */

{
  const cv = new Canvas(16, 16); // 背景は透明のまま
  const lightB = '#cbb85f', midB = '#a89440', darkB = '#7c6a28', node = '#6a5a20';
  for (const x0 of [1, 12]) {          // 縦の支柱
    for (let y = 0; y < 16; y++) {
      cv.set(x0, y, darkB);
      cv.set(x0 + 1, y, midB);
      cv.set(x0 + 2, y, y % 5 === 2 ? midB : lightB);
    }
    for (const y of [2, 7, 12]) {      // 竹の節
      cv.set(x0, y, node); cv.set(x0 + 1, y, node); cv.set(x0 + 2, y, node);
    }
  }
  for (const y of [1, 5, 9, 13]) {     // 横棒
    for (let x = 3; x < 13; x++) {
      cv.set(x, y, midB);
      cv.set(x, y + 1, darkB);
    }
    cv.set(3, y, darkB); cv.set(12, y, darkB);
  }
  save(cv, BLOCKS, 'vc_bamboo_ladder');
}

/* -------------------------------------------------------- 模様付きカーペット */

const CARPETS = {
  // 赤白ストライプ
  vc_carpet_stripe: {
    palette: { a: '#b8352f', b: '#d24b43', c: '#f2eadc', d: '#dcd2c0' },
    rows: [
      'aabbccddaabbccdd', 'aabbccddaabbccdd', 'aabbccddaabbccdd', 'aabbccddaabbccdd',
      'aabbccddaabbccdd', 'aabbccddaabbccdd', 'aabbccddaabbccdd', 'aabbccddaabbccdd',
      'aabbccddaabbccdd', 'aabbccddaabbccdd', 'aabbccddaabbccdd', 'aabbccddaabbccdd',
      'aabbccddaabbccdd', 'aabbccddaabbccdd', 'aabbccddaabbccdd', 'aabbccddaabbccdd',
    ],
  },
  // モノトーンの市松
  vc_carpet_check: {
    palette: { a: '#26262a', b: '#37373d', c: '#eceae4', d: '#d6d3ca' },
    rows: [
      'aaaabbbbccccdddd', 'aaaabbbbccccdddd', 'aaaabbbbccccdddd', 'aaaabbbbccccdddd',
      'ccccddddaaaabbbb', 'ccccddddaaaabbbb', 'ccccddddaaaabbbb', 'ccccddddaaaabbbb',
      'aaaabbbbccccdddd', 'aaaabbbbccccdddd', 'aaaabbbbccccdddd', 'aaaabbbbccccdddd',
      'ccccddddaaaabbbb', 'ccccddddaaaabbbb', 'ccccddddaaaabbbb', 'ccccddddaaaabbbb',
    ],
  },
  // 藍色のダイヤ柄
  vc_carpet_diamond: {
    palette: { a: '#1f3566', b: '#27407c', c: '#c8ab5c', d: '#e8d79a' },
    rows: [
      'aabbaabbaabbaabb', 'abbcbbaabbcbbaab', 'bbcdcbbaabcdcbba', 'bcdddcbaabcdddcb',
      'bbcdcbbaabcdcbba', 'abbcbbaabbcbbaab', 'aabbaabbaabbaabb', 'bbaabbaabbaabbaa',
      'aabbaabbaabbaabb', 'abbcbbaabbcbbaab', 'bbcdcbbaabcdcbba', 'bcdddcbaabcdddcb',
      'bbcdcbbaabcdcbba', 'abbcbbaabbcbbaab', 'aabbaabbaabbaabb', 'bbaabbaabbaabbaa',
    ],
  },
  // 生成り地に小花
  vc_carpet_floral: {
    palette: { a: '#efe6d3', b: '#e4d8bf', c: '#d4738f', d: '#f0a6ba', e: '#7fa561' },
    rows: [
      'aabaabaabaabaaba', 'abadcdabaabadcda', 'aadcdcdaaaadcdcd', 'abadcdabaabadcda',
      'aabeabaabaabeaba', 'abaabaabaabaabaa', 'aabaabadcdabaaba', 'baabaadcdcdaabaa',
      'aabaabadcdabaaba', 'abaabaabeabaabaa', 'aabaabaabaabaaba', 'adcdabaabadcdaba',
      'dcdcdaaaadcdcdaa', 'adcdabaabadcdaba', 'aabeabaabaabeaba', 'abaabaabaabaabaa',
    ],
  },
  // 青い波柄
  vc_carpet_wave: {
    palette: { a: '#123a52', b: '#1b5273', c: '#2f7fa8', d: '#8fd0e6' },
    rows: [
      'aaabbbcccbbbaaab', 'aabbbcccdcccbbbaa'.slice(0, 16), 'abbbcccdccbbbaaab', 'bbbcccdccbbbaaabb',
      'bbcccdccbbbaaabbb', 'bcccdccbbbaaabbbc'.slice(0, 16), 'cccdccbbbaaabbbcc', 'ccdccbbbaaabbbccc',
      'cdccbbbaaabbbcccd', 'dccbbbaaabbbcccdc', 'ccbbbaaabbbcccdcc', 'cbbbaaabbbcccdccb',
      'bbbaaabbbcccdccbb', 'bbaaabbbcccdccbbb', 'baaabbbcccdccbbba', 'aaabbbcccdccbbbaa',
    ].map((r) => r.slice(0, 16).padEnd(16, 'a')),
  },
  // 深緑の額縁模様
  vc_carpet_frame: {
    palette: { a: '#1f4a30', b: '#2b6440', c: '#c9a44c', d: '#efe0b0' },
    rows: [
      'cccccccccccccccc', 'cddddddddddddddc', 'cdaaaaaaaaaaaadc', 'cdabbbbbbbbbbadc',
      'cdabccccccccbadc', 'cdabcaaaaaacbadc', 'cdabcabbbbacbadc', 'cdabcabddbacbadc',
      'cdabcabddbacbadc', 'cdabcabbbbacbadc', 'cdabcaaaaaacbadc', 'cdabccccccccbadc',
      'cdabbbbbbbbbbadc', 'cdaaaaaaaaaaaadc', 'cddddddddddddddc', 'cccccccccccccccc',
    ],
  },
  // 畳風（縁付き）
  vc_carpet_tatami: {
    palette: { a: '#9aa860', b: '#8b9954', c: '#2c2a26', d: '#b3a04a' },
    rows: [
      'cccccccccccccccc', 'cdddddddddddddddc'.slice(0, 16), 'caaaaaaabbbbbbbc', 'cababababbabababc'.slice(0, 16),
      'caaaaaaabbbbbbbc', 'cababababbabababc'.slice(0, 16), 'caaaaaaabbbbbbbc', 'cbbbbbbbaaaaaaac',
      'cbabababaabababac'.slice(0, 16), 'cbbbbbbbaaaaaaac', 'cbabababaabababac'.slice(0, 16), 'cbbbbbbbaaaaaaac',
      'caaaaaaabbbbbbbc', 'cababababbabababc'.slice(0, 16), 'cddddddddddddddc', 'cccccccccccccccc',
    ].map((r) => r.slice(0, 16).padEnd(16, 'a')),
  },
  // ペルシャ絨毯風
  vc_carpet_persian: {
    palette: { a: '#6d1d24', b: '#8b2b30', c: '#d8b25a', d: '#f0e0b4', e: '#26506b' },
    rows: [
      'cccccccccccccccc', 'caaaaaaaaaaaaaac', 'cabbbbbbbbbbbbac', 'cabceeeeeeeecbac',
      'cabcedddddddecac'.slice(0, 16), 'cabcedcccccdecac'.slice(0, 16), 'cabcedcaaacdecac'.slice(0, 16), 'cabcedcadacdecac'.slice(0, 16),
      'cabcedcadacdecac'.slice(0, 16), 'cabcedcaaacdecac'.slice(0, 16), 'cabcedcccccdecac'.slice(0, 16), 'cabcedddddddecac'.slice(0, 16),
      'cabceeeeeeeecbac', 'cabbbbbbbbbbbbac', 'caaaaaaaaaaaaaac', 'cccccccccccccccc',
    ].map((r) => r.slice(0, 16).padEnd(16, 'a')),
  },
};

for (const [name, def] of Object.entries(CARPETS)) {
  const cv = new Canvas(16, 16);
  drawGrid(cv, def.rows, def.palette);
  // わずかなざらつきで布らしさを出す
  const rand = rng(seedOf(name));
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (rand() < 0.18) {
        const i = (y * 16 + x) * 4;
        const c = [cv.data[i], cv.data[i + 1], cv.data[i + 2], cv.data[i + 3]];
        cv.set(x, y, shift(c, (rand() - 0.5) * 0.12));
      }
    }
  }
  save(cv, BLOCKS, name);
}

/* ------------------------------------------------------ エンティティ用 透明 */

{
  const cv = new Canvas(16, 16); // 全ピクセル透明
  cv.save(path.join(RP, 'textures', 'entity', 'vc_empty.png'));
  written.push('entity/vc_empty');
}

/* ------------------------------------------------------------- パックアイコン */

{
  const ART = {
    palette: {
      '.': '#2b6a4f', o: '#1e5240', w: '#b08b4f', d: '#8a6a38', l: '#c4a067',
      s: '#e6e3dc', k: '#1e1f23', c: '#4cc2ff', r: '#b8352f',
    },
    rows: [
      '................', '.....wwwwww.....', '.....wddddw.....', '.....wllllw.....',
      '.....wddddw.....', '.....wllllw.....', '....wwwwwwww....', '...wwllllllww...',
      '...wwwwwwwwww...', '...wd..ss..dw...', '...wd.skcks.dw..'.slice(0, 16), '...wd.skcks.dw..'.slice(0, 16),
      '...wd..ss..dw...', '...w...rr...w...', '...w........w...', '................',
    ].map((r) => r.slice(0, 16).padEnd(16, '.')),
  };
  for (const [dir, name] of [[BP, 'pack_icon'], [RP, 'pack_icon']]) {
    const small = new Canvas(16, 16);
    small.rect(0, 0, 16, 16, '#2b6a4f');
    drawGrid(small, ART.rows, ART.palette);
    const big = new Canvas(128, 128);
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        const i = (Math.floor(y / 8) * 16 + Math.floor(x / 8)) * 4;
        big.set(x, y, [small.data[i], small.data[i + 1], small.data[i + 2], small.data[i + 3]]);
      }
    }
    big.save(path.join(dir, `${name}.png`));
  }
  written.push('pack_icon x2');
}

console.log(`テクスチャを ${written.length} 件出力しました。`);
