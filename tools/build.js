/**
 * Vcraft ホーム家具 - 一括ビルド
 *   node tools/build.js
 *
 * テクスチャ生成 → コンテンツ生成 → 検証 → プレビュー → .mcaddon 作成 を順に行う。
 * 検証でエラーが出たらパッケージは作らずに止める。
 */
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');

const TOOLS = __dirname;
const steps = ['gen_textures.js', 'gen_content.js', 'validate.js', 'preview.js', 'package.js'];

for (const step of steps) {
  console.log(`\n──── ${step}`);
  try {
    execFileSync(process.execPath, [path.join(TOOLS, step)], { stdio: 'inherit' });
  } catch {
    console.error(`\n${step} で失敗しました。ここで中断します。`);
    process.exit(1);
  }
}
console.log('\n完了しました。');
