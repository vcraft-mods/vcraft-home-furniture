/**
 * Vcraft ホーム家具 - 整合性チェッカー
 *
 * Minecraft を起動せずに「ゲーム内で静かに壊れる」種類のバグを検出する。
 *   node tools/validate.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BP = path.join(ROOT, 'HomeBP');
const RP = path.join(ROOT, 'HomeRP');
const NS = 'vcraft';

const errors = [];
const warnings = [];
const fail = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

function walk(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, ext));
    else if (!ext || entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}

/* ------------------------------------------------------------ JSON を全部読む */

const json = new Map();
for (const file of [...walk(BP, '.json'), ...walk(RP, '.json')]) {
  const text = fs.readFileSync(file, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) fail(rel(file), 'BOM 付きで保存されている（Minecraft が読み込みに失敗する）');
  try {
    json.set(file, JSON.parse(text));
  } catch (e) {
    fail(rel(file), `JSON構文エラー: ${e.message}`);
  }
}
const get = (file) => json.get(file);
const bpFiles = (sub) => walk(path.join(BP, sub), '.json').filter((f) => json.has(f));
const rpFiles = (sub) => walk(path.join(RP, sub), '.json').filter((f) => json.has(f));

function pngSize(file) {
  if (!fs.existsSync(file)) return null;
  const head = Buffer.alloc(24);
  const fd = fs.openSync(file, 'r');
  fs.readSync(fd, head, 0, 24, 0);
  fs.closeSync(fd);
  if (head.toString('ascii', 1, 4) !== 'PNG') return null;
  return { w: head.readUInt32BE(16), h: head.readUInt32BE(20) };
}

/* ------------------------------------------------------------- 1. マニフェスト */

const bpManifest = get(path.join(BP, 'manifest.json'));
const rpManifest = get(path.join(RP, 'manifest.json'));
const uuids = new Map();

for (const [name, manifest] of [['HomeBP', bpManifest], ['HomeRP', rpManifest]]) {
  if (!manifest) { fail(name, 'manifest.json が読めない'); continue; }
  for (const id of [manifest.header?.uuid, ...(manifest.modules ?? []).map((m) => m.uuid)]) {
    if (!id) { fail(name, 'UUID が未設定のモジュールがある'); continue; }
    if (uuids.has(id)) fail(name, `UUID ${id} が ${uuids.get(id)} と重複している`);
    else uuids.set(id, name);
  }
  if (!fs.existsSync(path.join(ROOT, name, 'pack_icon.png'))) warn(name, 'pack_icon.png が無い');
}

if (bpManifest && rpManifest) {
  const dep = (bpManifest.dependencies ?? []).find((d) => d.uuid);
  if (!dep) fail('HomeBP', 'RP への依存(dependencies)が書かれていない');
  else if (dep.uuid !== rpManifest.header.uuid) fail('HomeBP', `依存先UUID ${dep.uuid} が RP の header.uuid と一致しない`);
  else {
    // 統合版は UUID とバージョンの両方が一致する依存パックを探す。
    // ここがズレていると BP だけ丸ごと読み込まれず、家具が1つも出てこない。
    const want = (dep.version ?? []).join('.');
    const have = (rpManifest.header.version ?? []).join('.');
    if (want !== have) {
      fail('HomeBP/manifest.json',
        `依存に書いた RP のバージョン ${want} が HomeRP/manifest.json の header.version ${have} と一致しない`);
    }
  }

  // BP と RP のバージョンを揃える（片方だけ上げるとリリースの中身がちぐはぐになる）
  const bpVersion = (bpManifest.header?.version ?? []).join('.');
  const rpVersion = (rpManifest.header?.version ?? []).join('.');
  if (bpVersion !== rpVersion) fail('manifest', `HomeBP ${bpVersion} と HomeRP ${rpVersion} のバージョンが揃っていない`);

  // スクリプトがチャットに出すバージョン表記もマニフェストに合わせる
  const mainPath = path.join(BP, 'scripts', 'main.js');
  if (fs.existsSync(mainPath)) {
    const declared = fs.readFileSync(mainPath, 'utf8').match(/const\s+VERSION\s*=\s*'([^']+)'/);
    if (declared && declared[1] !== bpVersion) {
      fail('HomeBP/scripts/main.js', `VERSION '${declared[1]}' が manifest の ${bpVersion} と一致しない`);
    }
  }

  const script = (bpManifest.modules ?? []).find((m) => m.type === 'script');
  if (script && !fs.existsSync(path.join(BP, script.entry))) fail('HomeBP', `script entry "${script.entry}" が存在しない`);

  // @minecraft/server のバージョンと min_engine_version の整合
  const SERVER_API_MIN_ENGINE = {
    '1.17.0': [1, 21, 60], '1.18.0': [1, 21, 70], '1.19.0': [1, 21, 80],
    '2.0.0': [1, 21, 90], '2.1.0': [1, 21, 100],
  };
  const serverDep = (bpManifest.dependencies ?? []).find((d) => d.module_name === '@minecraft/server');
  if (script && !serverDep) fail('HomeBP', 'script モジュールがあるのに @minecraft/server 依存が無い');
  const required = serverDep && SERVER_API_MIN_ENGINE[serverDep.version];
  const declared = bpManifest.header?.min_engine_version;
  if (required && Array.isArray(declared)) {
    const smaller = declared[0] < required[0]
      || (declared[0] === required[0] && declared[1] < required[1])
      || (declared[0] === required[0] && declared[1] === required[1] && declared[2] < required[2]);
    if (smaller) fail('HomeBP/manifest.json', `@minecraft/server ${serverDep.version} は Minecraft ${required.join('.')} 以上が必要`);
  }
  // スクリプトが import しているモジュールが dependencies にあるか
  const scriptSource = walk(path.join(BP, 'scripts'), '.js').map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  for (const m of scriptSource.matchAll(/from\s+['"](@minecraft\/[^'"]+)['"]/g)) {
    if (!(bpManifest.dependencies ?? []).some((d) => d.module_name === m[1])) {
      fail('HomeBP/manifest.json', `スクリプトが import している ${m[1]} が dependencies に無い`);
    }
  }
}

/* --------------------------------------------------------- 2. テクスチャアトラス */

const terrainAtlas = new Map();
{
  const file = path.join(RP, 'textures', 'terrain_texture.json');
  const data = get(file);
  if (!data) fail('terrain_texture', 'textures/terrain_texture.json が読めない');
  else {
    for (const [key, value] of Object.entries(data.texture_data ?? {})) {
      let textures = value.textures;
      if (Array.isArray(textures)) textures = textures[0];
      if (typeof textures !== 'string') { fail('terrain_texture', `${key} の textures が文字列でない`); continue; }
      const png = path.join(RP, `${textures}.png`);
      if (!fs.existsSync(png)) { fail('terrain_texture', `${key} が参照する ${textures}.png が存在しない`); continue; }
      const size = pngSize(png);
      if (!size) fail('terrain_texture', `${textures}.png が PNG として読めない`);
      // ジオメトリ側が texture_width/height=16 で UV を組んでいるので 16 の倍数でないとズレる
      else if (size.w !== size.h || size.w % 16 !== 0) {
        fail('terrain_texture', `${textures}.png が ${size.w}x${size.h}（16の倍数の正方形にする）`);
      }
      terrainAtlas.set(key, png);
    }
  }
}
const usedTerrainTex = new Set();

/* ----------------------------------------------------------------- 3. ジオメトリ */

const geometries = new Map();
for (const file of rpFiles('models')) {
  const list = get(file)['minecraft:geometry'];
  if (!Array.isArray(list)) continue;
  for (const geo of list) {
    const id = geo.description?.identifier;
    if (!id) { fail(rel(file), 'identifier の無いジオメトリがある'); continue; }
    if (geometries.has(id)) fail(rel(file), `ジオメトリ ${id} が重複定義されている`);

    const materials = new Set();
    let outOfBounds = 0;
    for (const bone of geo.bones ?? []) {
      for (const c of bone.cubes ?? []) {
        const [ox, oy, oz] = c.origin;
        const [sx, sy, sz] = c.size;
        // ブロック1個の描画範囲を大きく超えるとチラつき・カリング不具合の原因になる
        if (ox < -16 || oy < -16 || oz < -16 || ox + sx > 32 || oy + sy > 32 || oz + sz > 32) outOfBounds++;
        if (!c.uv || Array.isArray(c.uv)) { fail(rel(file), `${id}: 面ごとの UV になっていない立方体がある`); continue; }
        for (const [face, uv] of Object.entries(c.uv)) {
          if (uv.material_instance) materials.add(uv.material_instance);
          const [u, v] = uv.uv ?? [];
          const [uw, vh] = uv.uv_size ?? [];
          const tw = geo.description?.texture_width ?? 16;
          const th = geo.description?.texture_height ?? 16;
          if (u < 0 || v < 0 || u + Math.abs(uw) > tw + 0.001 || v + Math.abs(vh) > th + 0.001) {
            fail(rel(file), `${id}: ${face} 面の UV がテクスチャの外にはみ出している (${u},${v} +${uw}x${vh})`);
          }
        }
      }
    }
    if (outOfBounds) fail(rel(file), `${id}: ブロック範囲を大きく超える立方体が ${outOfBounds} 個ある`);

    geometries.set(id, { materials, tw: geo.description?.texture_width, th: geo.description?.texture_height, file });
  }
}

/* --------------------------------------------------- 4. レンダーコントローラー */

const renderControllers = new Set();
for (const file of rpFiles('render_controllers')) {
  for (const id of Object.keys(get(file).render_controllers ?? {})) renderControllers.add(id);
}

/* ------------------------------------------------------------------ 5. ブロック */

const VALID_CATEGORY = ['construction', 'equipment', 'items', 'nature', 'none'];
const blockIds = new Set();
const usedGeometries = new Set();

for (const file of bpFiles('blocks')) {
  const def = get(file)['minecraft:block'];
  if (!def) { fail(rel(file), 'minecraft:block がない'); continue; }
  const id = def.description?.identifier;
  if (!id) { fail(rel(file), 'identifier がない'); continue; }
  if (blockIds.has(id)) fail(rel(file), `ブロック ${id} が重複定義されている`);
  blockIds.add(id);

  const comps = def.components ?? {};
  const cat = def.description?.menu_category?.category;
  if (!cat) fail(rel(file), 'menu_category が無い（クリエイティブに出てこない）');
  else if (!VALID_CATEGORY.includes(cat)) fail(rel(file), `menu_category.category "${cat}" は無効`);

  // ---- ジオメトリ
  const geoId = typeof comps['minecraft:geometry'] === 'string'
    ? comps['minecraft:geometry']
    : comps['minecraft:geometry']?.identifier;
  if (!geoId) fail(rel(file), 'minecraft:geometry が無い');
  else if (!geoId.startsWith('minecraft:')) {
    if (!geometries.has(geoId)) fail(rel(file), `ジオメトリ "${geoId}" が RP に存在しない`);
    else usedGeometries.add(geoId);
  }

  // ---- マテリアルインスタンス（基本 + 各パーミュテーション）
  const instanceSets = [comps['minecraft:material_instances']];
  for (const perm of def.permutations ?? []) {
    if (perm.components?.['minecraft:material_instances']) instanceSets.push(perm.components['minecraft:material_instances']);
  }
  if (!instanceSets[0]) fail(rel(file), 'minecraft:material_instances が無い（真っ黒／紫になる）');

  for (const instances of instanceSets) {
    if (!instances) continue;
    if (!instances['*']) fail(rel(file), 'material_instances に "*" が無い（未指定の面が描画されない）');
    for (const [name, inst] of Object.entries(instances)) {
      if (!inst.texture) { fail(rel(file), `material_instances.${name} に texture がない`); continue; }
      if (!terrainAtlas.has(inst.texture)) fail(rel(file), `texture "${inst.texture}" が terrain_texture.json に登録されていない`);
      else usedTerrainTex.add(inst.texture);
      const METHODS = ['opaque', 'alpha_test', 'blend', 'double_sided', 'alpha_test_single_sided', 'blend_to_opaque'];
      if (inst.render_method && !METHODS.includes(inst.render_method)) {
        fail(rel(file), `render_method "${inst.render_method}" は無効`);
      }
    }
    // ジオメトリ側が使っている名前が全部そろっているか
    const needed = geometries.get(geoId)?.materials ?? new Set();
    for (const name of needed) {
      if (name !== '*' && !instances[name]) {
        fail(rel(file), `ジオメトリが使う material_instance "${name}" が定義されていない（その面が描画されない）`);
      }
    }
    for (const name of Object.keys(instances)) {
      if (name !== '*' && !needed.has(name)) warn(rel(file), `material_instance "${name}" をジオメトリが使っていない`);
    }
  }

  // ---- ブロックステート／パーミュテーション
  const declaredStates = new Set(Object.keys(def.description?.states ?? {}));
  const traits = def.description?.traits ?? {};
  if (traits['minecraft:placement_direction']) {
    for (const s of traits['minecraft:placement_direction'].enabled_states ?? []) declaredStates.add(s);
    const offset = traits['minecraft:placement_direction'].y_rotation_offset;
    if (offset != null && ![0, 90, 180, 270].includes(offset)) fail(rel(file), `y_rotation_offset ${offset} は 0/90/180/270 のみ`);
  }
  if (traits['minecraft:placement_position']) {
    for (const s of traits['minecraft:placement_position'].enabled_states ?? []) declaredStates.add(s);
  }
  for (const perm of def.permutations ?? []) {
    if (typeof perm.condition !== 'string') { fail(rel(file), 'permutation に condition が無い'); continue; }
    for (const m of perm.condition.matchAll(/block_state\(\s*'([^']+)'\s*\)/g)) {
      if (!declaredStates.has(m[1])) fail(rel(file), `permutation が未宣言のステート "${m[1]}" を参照している`);
    }
  }

  // ---- 当たり判定
  for (const key of ['minecraft:collision_box', 'minecraft:selection_box']) {
    const box = comps[key];
    if (!box || box === true || box === false) continue;
    const [ox, oy, oz] = box.origin ?? [];
    const [sx, sy, sz] = box.size ?? [];
    if ([ox, oy, oz, sx, sy, sz].some((v) => typeof v !== 'number')) { fail(rel(file), `${key} の origin/size が不正`); continue; }
    if (ox < -8 || oz < -8 || ox + sx > 8 || oz + sz > 8) fail(rel(file), `${key} の X/Z が -8〜8 の外に出ている`);
    if (oy < 0 || oy + sy > 16) fail(rel(file), `${key} の Y が 0〜16 の外に出ている`);
  }

  const light = comps['minecraft:light_emission'];
  if (light != null && (!Number.isInteger(light) || light < 0 || light > 15)) {
    fail(rel(file), `light_emission は 0〜15 の整数（現在 ${light}）`);
  }
  if (!comps['minecraft:destructible_by_mining']) warn(rel(file), 'destructible_by_mining が無い（壊せないブロックになる）');

  // display_name は文字列でなければならない。{ value: ... } と書くと統合版が
  // "minecraft:display_name: invalid string" を出してブロックごと登録に失敗する
  const displayName = comps['minecraft:display_name'];
  if (displayName === undefined) warn(rel(file), 'display_name が無い');
  else if (typeof displayName !== 'string') {
    fail(rel(file), 'display_name は文字列で書く（{ "value": ... } は統合版が受け付けない）');
  }
}

for (const geoId of geometries.keys()) {
  if (geoId.endsWith('.empty')) continue;
  if (!usedGeometries.has(geoId)) warn('models', `ジオメトリ ${geoId} はどのブロックからも使われていない`);
}

/* -------------------------------------------------------------- 6. エンティティ */

const bpEntities = new Map();
for (const file of bpFiles('entities')) {
  const def = get(file)['minecraft:entity'];
  if (!def) { fail(rel(file), 'minecraft:entity がない'); continue; }
  const id = def.description?.identifier;
  if (!id) { fail(rel(file), 'identifier がない'); continue; }
  if (bpEntities.has(id)) fail(rel(file), `エンティティ ${id} が重複定義されている`);
  const comps = def.components ?? {};
  bpEntities.set(id, { file, comps, def });

  for (const required of ['minecraft:physics', 'minecraft:collision_box', 'minecraft:health']) {
    if (!comps[required]) fail(rel(file), `${required} が無い`);
  }
  if (comps['minecraft:despawn'] && comps['minecraft:persistent']) {
    fail(rel(file), 'despawn と persistent が両方付いている');
  }
  // 家具の中身用エンティティなので、動く必要はないが消えられても困る
  if (!comps['minecraft:persistent']) warn(rel(file), 'persistent が無い（離れると消える可能性がある）');
  if (def.description.is_spawnable) warn(rel(file), 'is_spawnable が true（クリエイティブにスポーンエッグが出てしまう）');
}

const rpEntities = new Set();
for (const file of rpFiles('entity')) {
  const desc = get(file)['minecraft:client_entity']?.description;
  if (!desc) { fail(rel(file), 'minecraft:client_entity がない'); continue; }
  rpEntities.add(desc.identifier);
  if (!bpEntities.has(desc.identifier)) fail(rel(file), `対応する BP エンティティ ${desc.identifier} が無い`);

  for (const [key, texture] of Object.entries(desc.textures ?? {})) {
    if (!fs.existsSync(path.join(RP, `${texture}.png`))) fail(rel(file), `テクスチャ ${texture}.png が存在しない (${key})`);
  }
  for (const [key, geoId] of Object.entries(desc.geometry ?? {})) {
    if (!geometries.has(geoId)) fail(rel(file), `ジオメトリ ${geoId} が存在しない (${key})`);
  }
  for (const controller of desc.render_controllers ?? []) {
    const name = typeof controller === 'string' ? controller : Object.keys(controller)[0];
    if (!renderControllers.has(name)) fail(rel(file), `レンダーコントローラー ${name} が存在しない`);
  }
  if (!(desc.render_controllers ?? []).length) fail(rel(file), 'render_controllers が空（描画されない）');
}
for (const id of bpEntities.keys()) {
  if (!rpEntities.has(id)) fail('HomeRP/entity', `BP の ${id} に対応するクライアント定義が無い`);
}

/* -------------------------------------------------------------------- 7. レシピ */

const recipeIds = new Set();
const craftable = new Set();
for (const file of bpFiles('recipes')) {
  const data = get(file);
  const shaped = data['minecraft:recipe_shaped'];
  const recipe = shaped ?? data['minecraft:recipe_shapeless'];
  if (!recipe) { fail(rel(file), 'レシピ本体がない'); continue; }

  const id = recipe.description?.identifier;
  if (!id) fail(rel(file), 'description.identifier が無い');
  else if (recipeIds.has(id)) fail(rel(file), `レシピID ${id} が重複している`);
  else recipeIds.add(id);

  const refs = [];
  if (shaped) {
    const { pattern = [], key = {} } = shaped;
    if (pattern.length === 0 || pattern.length > 3) fail(rel(file), 'pattern の行数が 1〜3 でない');
    const widths = new Set(pattern.map((r) => r.length));
    if (widths.size > 1) fail(rel(file), 'pattern の行ごとの桁数が揃っていない');
    if ([...widths][0] > 3) fail(rel(file), 'pattern の桁数が 3 を超えている');
    const used = new Set(pattern.join('').replace(/ /g, '').split(''));
    for (const ch of used) if (!key[ch]) fail(rel(file), `pattern の "${ch}" が key に無い`);
    for (const ch of Object.keys(key)) if (!used.has(ch)) fail(rel(file), `key の "${ch}" が pattern で未使用`);
    refs.push(...Object.values(key).map((v) => v.item));
  } else {
    const ingredients = recipe.ingredients ?? [];
    if (ingredients.length === 0 || ingredients.length > 9) fail(rel(file), 'ingredients の数が 1〜9 でない');
    refs.push(...ingredients.map((v) => v.item));
  }

  const result = recipe.result?.item;
  refs.push(result);
  if (result?.startsWith(`${NS}:`)) craftable.add(result);
  for (const item of refs) {
    if (!item) { fail(rel(file), 'item が未指定の材料がある'); continue; }
    if (!item.includes(':')) fail(rel(file), `"${item}" に名前空間が無い`);
    if (item.startsWith(`${NS}:`) && !blockIds.has(item)) fail(rel(file), `未定義のブロック ${item} を参照している`);
  }
  if (!(recipe.tags ?? []).length) fail(rel(file), 'tags が無い（どの作業台でも作れない）');
}
for (const id of blockIds) {
  if (!craftable.has(id)) warn('recipes', `${id} のレシピが無い（クリエイティブ専用になる）`);
}

/* ----------------------------------------------------------------- 8. blocks.json */

const blocksJson = get(path.join(RP, 'blocks.json'));
if (blocksJson) {
  for (const key of Object.keys(blocksJson)) {
    if (key === 'format_version') continue;
    if (!blockIds.has(key)) fail('HomeRP/blocks.json', `未定義のブロック ${key} が登録されている`);
  }
  for (const id of blockIds) {
    if (!(id in blocksJson)) warn('HomeRP/blocks.json', `${id} の設定が無い（設置音がデフォルトになる）`);
  }
}

/* --------------------------------------------------------------- 9. スクリプト */

const scriptFiles = walk(path.join(BP, 'scripts'), '.js');
const scriptSource = scriptFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');

const { execFileSync } = require('child_process');
const os = require('os');

for (const file of scriptFiles) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    if (!fs.existsSync(path.resolve(path.dirname(file), m[1]))) fail(rel(file), `import 先 "${m[1]}" が存在しない`);
  }
  // ES モジュールとして構文が通るか（Minecraft はエラーを静かに握りつぶすので手前で見る）
  const temp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vcraft-')), 'check.mjs');
  fs.writeFileSync(temp, src, 'utf8');
  try {
    execFileSync(process.execPath, ['--check', temp], { stdio: 'pipe' });
  } catch (e) {
    fail(rel(file), `構文エラー: ${String(e.stderr ?? e.message).split('\n').find((l) => l.includes('Error')) ?? e.message}`);
  } finally {
    fs.rmSync(path.dirname(temp), { recursive: true, force: true });
  }
}

// スクリプトが名指ししているブロック／エンティティが実在するか
const scriptBlockIds = new Set();
for (const m of scriptSource.matchAll(/\$\{NS\}:([a-z_]+)/g)) scriptBlockIds.add(`${NS}:${m[1]}`);
for (const m of scriptSource.matchAll(/['"`]vcraft:([a-z_]+)['"`]/g)) scriptBlockIds.add(`${NS}:${m[1]}`);
for (const id of scriptBlockIds) {
  if (blockIds.has(id) || bpEntities.has(id)) continue;
  if (id.startsWith(`${NS}:potato_touches`) || id.startsWith(`${NS}:memo`) || id.startsWith(`${NS}:born`) || id.startsWith(`${NS}:powered`)) continue;
  fail('scripts/main.js', `存在しない ID "${id}" を参照している`);
}
// WOODS 配列から組み立てているIDも実在チェック
{
  const woodsMatch = scriptSource.match(/const WOODS = \[([\s\S]*?)\];/);
  const woods = woodsMatch ? [...woodsMatch[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]) : [];
  if (woods.length === 0) fail('scripts/main.js', 'WOODS 配列を読み取れない');
  for (const wood of woods) {
    for (const kind of ['chair', 'dresser']) {
      const id = `${NS}:${wood}_${kind}`;
      if (!blockIds.has(id)) fail('scripts/main.js', `WOODS から作られる ${id} が存在しない`);
    }
  }
}

/* -------------------------------------------------------------- 10. 言語ファイル */

function readLang(file) {
  const map = new Map();
  if (!fs.existsSync(file)) { fail(rel(file), 'ファイルが無い'); return map; }
  const text = fs.readFileSync(file, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) fail(rel(file), 'BOM 付きで保存されている');
  text.split(/\r?\n/).forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq < 0) { fail(rel(file), `${i + 1}行目に "=" が無い: ${trimmed}`); return; }
    const key = trimmed.slice(0, eq);
    if (map.has(key)) fail(rel(file), `キー "${key}" が重複している`);
    map.set(key, trimmed.slice(eq + 1));
  });
  return map;
}

const langs = {
  'HomeRP/en_US': readLang(path.join(RP, 'texts', 'en_US.lang')),
  'HomeRP/ja_JP': readLang(path.join(RP, 'texts', 'ja_JP.lang')),
  'HomeBP/en_US': readLang(path.join(BP, 'texts', 'en_US.lang')),
  'HomeBP/ja_JP': readLang(path.join(BP, 'texts', 'ja_JP.lang')),
};

for (const [pack, dir] of [['HomeBP', BP], ['HomeRP', RP]]) {
  const list = get(path.join(dir, 'texts', 'languages.json'));
  if (!Array.isArray(list)) { fail(pack, 'texts/languages.json が配列でない'); continue; }
  for (const code of list) {
    if (!fs.existsSync(path.join(dir, 'texts', `${code}.lang`))) fail(pack, `${code}.lang が無い`);
  }
}

const requiredKeys = new Set(['pack.name', 'pack.description']);
for (const file of bpFiles('blocks')) {
  const name = get(file)['minecraft:block']?.components?.['minecraft:display_name'];
  if (typeof name === 'string') requiredKeys.add(name);
}
// スクリプトが使う翻訳キー（t('...') / row('...') / translate: '...' すべて拾う）
for (const m of scriptSource.matchAll(/'(vcraft\.[a-z_.]+)'/g)) requiredKeys.add(m[1]);
for (const m of scriptSource.matchAll(/translate:\s*'([^']+)'/g)) requiredKeys.add(m[1]);

for (const key of requiredKeys) {
  const missing = Object.entries(langs)
    .filter(([pack]) => (key.startsWith('pack.') ? true : pack.startsWith('HomeRP')))
    .filter(([, map]) => !map.has(key))
    .map(([pack]) => pack);
  if (missing.length) fail('lang', `キー "${key}" が ${missing.join(', ')} に無い`);
}
const jaKeys = new Set(langs['HomeRP/ja_JP'].keys());
for (const key of langs['HomeRP/en_US'].keys()) if (!jaKeys.has(key)) fail('lang', `"${key}" が ja_JP に無い`);
for (const key of jaKeys) if (!langs['HomeRP/en_US'].has(key)) fail('lang', `"${key}" が en_US に無い`);
// 未使用の翻訳キー（display_name / UI どちらでも参照されていないもの）
for (const key of jaKeys) {
  if (key.startsWith('pack.')) continue;
  if (!requiredKeys.has(key)) warn('lang', `"${key}" はどこからも参照されていない`);
}

/* ---------------------------------------------------------- 11. 未使用テクスチャ */

for (const key of terrainAtlas.keys()) {
  if (!usedTerrainTex.has(key)) warn('terrain_texture', `"${key}" はどのブロックからも参照されていない`);
}
for (const png of walk(path.join(RP, 'textures', 'blocks'), '.png')) {
  const short = path.basename(png, '.png');
  if (!terrainAtlas.has(short)) warn('textures/blocks', `${rel(png)} が terrain_texture.json に登録されていない`);
}

/* ------------------------------------------------------------------- 結果 */

const line = '─'.repeat(64);
if (warnings.length) {
  console.log(`\n${line}\n警告 ${warnings.length} 件\n${line}`);
  warnings.forEach((w, i) => console.log(`  W${String(i + 1).padStart(2, '0')}  ${w}`));
}
if (errors.length) {
  console.log(`\n${line}\nエラー ${errors.length} 件\n${line}`);
  errors.forEach((e, i) => console.log(`  E${String(i + 1).padStart(2, '0')}  ${e}`));
  process.exitCode = 1;
} else {
  console.log(`\n✔ エラーはありません（ブロック ${blockIds.size} / レシピ ${recipeIds.size} / ジオメトリ ${geometries.size}）`);
}
