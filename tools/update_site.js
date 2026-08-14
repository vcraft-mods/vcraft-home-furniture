/**
 * Vcraft ホーム家具 - サイトの配布情報を更新する
 *
 * dist/ の .mcaddon を見て、詳細ページの
 * バージョン / ファイルサイズ / SHA-256 / ダウンロードURL を書き換える。
 *   node tools/package.js && node tools/update_site.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
// Vcraft のサイトは arcana_addon/site に置かれている（アドオン共通の1サイト）
const PAGE = path.resolve(ROOT, '..', 'arcana_addon', 'site', 'home-furniture.html');

const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'HomeBP', 'manifest.json'), 'utf8'))
  .header.version.join('.');
const file = path.join(ROOT, 'dist', `VcraftHomeFurniture-v${version}.mcaddon`);

if (!fs.existsSync(file)) {
  console.error(`${path.relative(ROOT, file)} がありません。先に node tools/package.js を実行してください。`);
  process.exit(1);
}
if (!fs.existsSync(PAGE)) {
  console.error(`${PAGE} がありません。`);
  process.exit(1);
}

const data = fs.readFileSync(file);
const sha256 = crypto.createHash('sha256').update(data).digest('hex').toUpperCase();
const size = `${Math.round(data.length / 1024)} KB`;

let html = fs.readFileSync(PAGE, 'utf8');
const before = html;
// ダウンロードボタンはページ内に複数あるので、すべて置き換える
const replacements = [
  [/(<span data-version>)[^<]*(<\/span>)/g, `$1${version}$2`],
  [/(<span data-size>)[^<]*(<\/span>)/g, `$1${size}$2`],
  [/(<code data-sha256>)[^<]*(<\/code>)/g, `$1${sha256}$2`],
  [/VcraftHomeFurniture-v[0-9.]+\.mcaddon/g, `VcraftHomeFurniture-v${version}.mcaddon`],
];
for (const [pattern, value] of replacements) {
  const found = pattern.test(html);
  pattern.lastIndex = 0; // /g 付きの正規表現は test() で位置が進むので戻す
  if (!found) {
    console.error(`ページ内に ${pattern} が見つかりません。`);
    process.exit(1);
  }
  html = html.replace(pattern, value);
}

if (html === before) {
  console.log('サイトの配布情報はすでに最新です。');
} else {
  fs.writeFileSync(PAGE, html, 'utf8');
  console.log(`home-furniture.html を更新しました（v${version} / ${size} / ${sha256.slice(0, 16)}…）`);
}
