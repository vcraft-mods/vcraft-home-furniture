/**
 * Vcraft ホーム家具 - .mcaddon（ZIP）を作る
 * 依存ライブラリなしで ZIP を組み立てる。
 *
 *   node tools/package.js                    → dist/VcraftHomeFurniture.mcaddon
 *   node tools/package.js path/to/out.mcaddon
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const PACKS = ['HomeBP', 'HomeRP'];

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

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

// 再実行しても同じバイト列になるよう日時は固定する
const DOS_TIME = 0;
const DOS_DATE = ((2024 - 1980) << 9) | (1 << 5) | 1;

/**
 * @param {string} outPath 出力先
 * @param {{noScripts?: boolean}} [options]
 *   noScripts: スクリプトモジュールを丸ごと外した診断用パックを作る。
 *   Minecraft はスクリプトモジュールの依存を1つでも解決できないとパック全体を
 *   読み込まないので、「家具が1つも出てこない」ときの切り分けに使う。
 */
function buildPackage(outPath, options = {}) {
  const files = [];
  for (const pack of PACKS) {
    const base = path.join(ROOT, pack);
    if (!fs.existsSync(base)) throw new Error(`${pack} が見つかりません`);
    for (const full of walk(base)) {
      const name = path.relative(ROOT, full).split(path.sep).join('/');
      if (options.noScripts && name.startsWith('HomeBP/scripts/')) continue;
      let data = fs.readFileSync(full);
      if (options.noScripts && name === 'HomeBP/manifest.json') {
        const manifest = JSON.parse(data.toString('utf8'));
        manifest.modules = manifest.modules.filter((m) => m.type !== 'script');
        manifest.dependencies = manifest.dependencies.filter((d) => !d.module_name);
        data = Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8');
      }
      files.push({ name, data });
    }
  }
  files.sort((a, b) => (a.name < b.name ? -1 : 1));

  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const compressed = zlib.deflateRawSync(file.data, { level: 9 });
    const useStore = compressed.length >= file.data.length;
    const payload = useStore ? file.data : compressed;
    const method = useStore ? 0 : 8;
    const crc = crc32(file.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // ファイル名は UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + payload.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  const resolved = path.resolve(ROOT, outPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, Buffer.concat([...locals, centralBuf, eocd]));
  return { path: resolved, files: files.length, bytes: fs.statSync(resolved).size };
}

module.exports = { buildPackage };

if (require.main === module) {
  const args = process.argv.slice(2);
  const noScripts = args.includes('--no-scripts');
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'HomeBP', 'manifest.json'), 'utf8')).header.version.join('.');
  const suffix = noScripts ? '-noscript' : '';
  const out = args.find((a) => !a.startsWith('--'))
    || path.join('dist', `VcraftHomeFurniture-v${version}${suffix}.mcaddon`);
  const result = buildPackage(out, { noScripts });
  console.log(
    `${path.relative(ROOT, result.path)} を作成しました` +
    `（${result.files} ファイル / ${(result.bytes / 1024).toFixed(1)} KB）` +
    (noScripts ? ' ※スクリプトなしの診断用' : '')
  );
}
