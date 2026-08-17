/**
 * Vcraft ホーム家具 - ジオメトリ / ブロック / レシピ / 言語ファイルの生成
 *   node tools/gen_content.js
 *
 * ブロックの向きが東西で逆になる場合は ROTATION の 90 と 270 を入れ替えて再実行する。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BP = path.join(ROOT, 'HomeBP');
const RP = path.join(ROOT, 'HomeRP');
const NS = 'vcraft';

const BLOCK_FORMAT = '1.21.0';
const RECIPE_FORMAT = '1.20.10';

function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}
function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

/* ======================================================== ジオメトリ用ヘルパ */

/**
 * 立方体1つ分の定義を作る。
 * UV はブロック空間の位置からそのまま 16x16 テクスチャに割り当てる
 * （バニラのブロックと同じ「テクスチャに沿った」貼り方になる）。
 * @param {number[]} origin [x,y,z]  x,z は -8〜8 / y は 0〜16
 * @param {number[]} size   [w,h,d]
 * @param {{mats?:Object, uv?:Object}} [opts] mats は面ごとのマテリアル名（'*' で全面）
 */
function cube(origin, size, opts = {}) {
  const [ox, oy, oz] = origin;
  const [sx, sy, sz] = size;
  const X = ox + 8;
  const Z = oz + 8;
  const top = 16 - (oy + sy);
  const mats = opts.mats ?? {};
  const face = (name, uv, uvSize) => {
    const out = { uv, uv_size: uvSize };
    const inst = mats[name] ?? mats['*'];
    if (inst) out.material_instance = inst;
    const override = opts.uv?.[name];
    return override ? { ...out, ...override } : out;
  };
  return {
    origin,
    size,
    uv: {
      north: face('north', [X, top], [sx, sy]),
      south: face('south', [X, top], [sx, sy]),
      east: face('east', [Z, top], [sz, sy]),
      west: face('west', [Z, top], [sz, sy]),
      up: face('up', [X, Z], [sx, sz]),
      down: face('down', [X, Z], [sx, sz]),
    },
  };
}

function geometry(name, cubes, bounds = { w: 2, h: 2, off: [0, 0.5, 0] }) {
  return {
    description: {
      identifier: `geometry.${NS}.${name}`,
      texture_width: 16,
      texture_height: 16,
      visible_bounds_width: bounds.w,
      visible_bounds_height: bounds.h,
      visible_bounds_offset: bounds.off,
    },
    bones: [{ name: 'root', pivot: [0, 0, 0], cubes }],
  };
}

/* ============================================================== ジオメトリ */

const FULL_FACE = { uv: [0, 0], uv_size: [16, 16] };

const GEOMETRIES = [
  // ---------------------------------------------------------------- 椅子
  geometry('chair', [
    cube([-6, 0, -6], [2, 6, 2]),
    cube([4, 0, -6], [2, 6, 2]),
    cube([-6, 0, 4], [2, 6, 2]),
    cube([4, 0, 4], [2, 6, 2]),
    cube([-7, 6, -7], [14, 2, 14]),                 // 座面
    cube([-7, 8, 4], [2, 8, 2]),                    // 背もたれの柱
    cube([5, 8, 4], [2, 8, 2]),
    cube([-5, 10, 4.5], [10, 5, 1]),                // 背板
    cube([-7, 14.5, 3.5], [14, 1.5, 3]),            // 笠木
  ]),

  // ------------------------------------------------------------------ 机
  geometry('desk', [
    cube([-8, 13, -8], [16, 3, 16]),                // 天板
    cube([-7, 0, -7], [2, 13, 14]),                 // 左側板
    cube([5, 0, -7], [2, 13, 14]),                  // 右側板
    cube([-5, 3, 5], [10, 10, 2]),                  // 背板
    cube([-6, 8, -7.85], [12, 4, 0.55]),            // 引き出しの面
    cube([-2, 9.5, -7.95], [4, 1, 0.3], { mats: { '*': 'metal' } }),
  ]),

  // -------------------------------------------------------------- タンス
  geometry('dresser', [
    cube([-8, 0, -7], [16, 15, 15]),                // 本体
    cube([-8, 15, -8], [16, 1, 16]),                // 天板（前にせり出す）
    cube([-6.5, 0.75, -7.6], [13, 4, 0.6]),         // 引き出し 下
    cube([-6.5, 5.5, -7.6], [13, 4, 0.6]),          // 引き出し 中
    cube([-6.5, 10.25, -7.6], [13, 4, 0.6]),        // 引き出し 上
    cube([-2, 2.25, -7.95], [4, 1, 0.35], { mats: { '*': 'metal' } }),
    cube([-2, 7, -7.95], [4, 1, 0.35], { mats: { '*': 'metal' } }),
    cube([-2, 11.75, -7.95], [4, 1, 0.35], { mats: { '*': 'metal' } }),
  ]),

  // ---------------------------------------------------------- 竹のはしご
  geometry('ladder', [
    cube([-8, 0, 6.8], [16, 16, 0.2], {
      uv: { north: FULL_FACE, south: FULL_FACE },
    }),
  ], { w: 1.2, h: 1.2, off: [0, 0.5, 0] }),

  // -------------------------------------------------------- カーペット
  geometry('carpet', [
    cube([-8, 0, -8], [16, 1, 16]),
  ], { w: 1.1, h: 0.2, off: [0, 0.05, 0] }),

  // ---------------------------------------------------------------- PC
  geometry('pc', [
    cube([-6, 0, -7], [10, 1, 4], { mats: { '*': 'key' } }),      // キーボード
    cube([5, 0, -6], [2, 1, 3], { mats: { '*': 'key' } }),        // マウス
    cube([-6, 0, 0], [8, 1, 5]),                                  // モニター台
    cube([-3, 1, 2], [2, 3, 2]),                                  // 支柱
    cube([-7, 4, 2], [10, 7, 1]),                                 // モニター
    cube([-6.2, 4.8, 1.8], [8.4, 5.4, 0.2], {                     // 画面
      mats: { '*': 'screen' },
      uv: { north: FULL_FACE },
    }),
    cube([4, 0, 2], [4, 12, 5]),                                  // タワー
  ], { w: 1.2, h: 1.2, off: [0, 0.5, 0] }),

  // ------------------------------------------------------------ シンク
  geometry('sink', [
    cube([-8, 0, -8], [16, 7, 16], { mats: { up: 'top' } }),      // キャビネット
    cube([-6, 7, -6], [12, 1, 12], { mats: { '*': 'top' } }),     // 洗い場の底
    cube([-8, 7, -8], [16, 5, 2], { mats: { up: 'top' } }),       // 縁 手前
    cube([-8, 7, 6], [16, 5, 2], { mats: { up: 'top' } }),        // 縁 奥
    cube([-8, 7, -6], [2, 5, 12], { mats: { up: 'top' } }),       // 縁 左
    cube([6, 7, -6], [2, 5, 12], { mats: { up: 'top' } }),        // 縁 右
    cube([-6, 10.6, -6], [12, 0.2, 12], { mats: { '*': 'water' } }),
    cube([-1, 12, 6], [2, 4, 2], { mats: { '*': 'metal' } }),     // 蛇口の柱
    cube([-1, 14, 2], [2, 2, 4], { mats: { '*': 'metal' } }),     // 蛇口の首
    cube([-4, 12, 6.5], [1.5, 1, 1], { mats: { '*': 'metal' } }), // ハンドル
    cube([2.5, 12, 6.5], [1.5, 1, 1], { mats: { '*': 'metal' } }),
  ]),

  // ------------------------------------------------------ ポテトの銅像
  geometry('potato_statue', [
    cube([-7, 0, -7], [14, 2, 14], { mats: { '*': 'copper' } }),  // 台座
    cube([-6, 2, -6], [12, 1, 12], { mats: { '*': 'copper' } }),
    cube([-3, 0.5, -7.4], [6, 1, 0.4], { mats: { '*': 'copper' } }), // 銘板
    cube([-4.5, 3, -4.5], [9, 2, 9]),                             // いも 下
    cube([-5.5, 5, -5.5], [11, 6, 11], {                          // いも 中（顔）
      mats: { north: 'face' },
      uv: { north: FULL_FACE },
    }),
    cube([-4.5, 11, -4.5], [9, 2, 9]),                            // いも 上
    cube([-3, 13, -3], [6, 2, 6]),
    cube([-1, 15, -1], [2, 1, 2]),                                // 芽
  ]),

  // ----------------------------------------------- 座席／収納用の空モデル
  {
    description: {
      identifier: `geometry.${NS}.empty`,
      texture_width: 16,
      texture_height: 16,
      visible_bounds_width: 0.1,
      visible_bounds_height: 0.1,
      visible_bounds_offset: [0, 0, 0],
    },
    bones: [{ name: 'root', pivot: [0, 0, 0] }],
  },
];

writeJSON(path.join(RP, 'models', 'blocks', 'furniture.geo.json'), {
  format_version: '1.12.0',
  'minecraft:geometry': GEOMETRIES,
});

/* ============================================================ 素材データ */

const WOODS = [
  { id: 'oak', ja: 'オーク', en: 'Oak', planks: 'minecraft:oak_planks', map: '#b08b4f' },
  { id: 'spruce', ja: 'トウヒ', en: 'Spruce', planks: 'minecraft:spruce_planks', map: '#7a5a34' },
  { id: 'birch', ja: 'シラカバ', en: 'Birch', planks: 'minecraft:birch_planks', map: '#c7b27c' },
  { id: 'jungle', ja: 'ジャングル', en: 'Jungle', planks: 'minecraft:jungle_planks', map: '#a9765a' },
  { id: 'acacia', ja: 'アカシア', en: 'Acacia', planks: 'minecraft:acacia_planks', map: '#ba6337' },
  { id: 'dark_oak', ja: 'ダークオーク', en: 'Dark Oak', planks: 'minecraft:dark_oak_planks', map: '#4b3218' },
  { id: 'mangrove', ja: 'マングローブ', en: 'Mangrove', planks: 'minecraft:mangrove_planks', map: '#773b36' },
  { id: 'cherry', ja: 'サクラ', en: 'Cherry', planks: 'minecraft:cherry_planks', map: '#e3b0a5' },
  { id: 'pale_oak', ja: '淡いオーク', en: 'Pale Oak', planks: 'minecraft:pale_oak_planks', map: '#e3dcd2' },
  { id: 'crimson', ja: '真紅', en: 'Crimson', planks: 'minecraft:crimson_planks', map: '#6a344b' },
  { id: 'warped', ja: '歪んだ', en: 'Warped', planks: 'minecraft:warped_planks', map: '#2c6d65' },
  { id: 'bamboo', ja: '竹', en: 'Bamboo', planks: 'minecraft:bamboo_planks', map: '#c4b156' },
];

const CARPETS = [
  { id: 'stripe', ja: 'ストライプ', en: 'Striped', dye: 'minecraft:red_dye', map: '#b8352f' },
  { id: 'check', ja: '市松模様', en: 'Checkered', dye: 'minecraft:black_dye', map: '#37373d' },
  { id: 'diamond', ja: 'ダイヤ柄', en: 'Diamond', dye: 'minecraft:blue_dye', map: '#27407c' },
  { id: 'floral', ja: '花柄', en: 'Floral', dye: 'minecraft:pink_dye', map: '#e4d8bf' },
  { id: 'wave', ja: '波模様', en: 'Wave', dye: 'minecraft:light_blue_dye', map: '#2f7fa8' },
  { id: 'frame', ja: '額縁模様', en: 'Bordered', dye: 'minecraft:green_dye', map: '#2b6440' },
  { id: 'tatami', ja: '畳風', en: 'Tatami', dye: 'minecraft:lime_dye', map: '#9aa860' },
  { id: 'persian', ja: 'ペルシャ風', en: 'Persian', dye: 'minecraft:orange_dye', map: '#8b2b30' },
];

/* ====================================================== ブロック定義の部品 */

// cardinal_direction → モデルの Y 回転
const ROTATION = { north: 0, east: 90, south: 180, west: 270 };

function directional() {
  return {
    traits: {
      'minecraft:placement_direction': {
        enabled_states: ['minecraft:cardinal_direction'],
        y_rotation_offset: 180,
      },
    },
  };
}

function rotationPermutations(extra = () => ({})) {
  return Object.entries(ROTATION).map(([dir, deg]) => ({
    condition: `q.block_state('minecraft:cardinal_direction') == '${dir}'`,
    components: { 'minecraft:transformation': { rotation: [0, deg, 0] }, ...extra(dir) },
  }));
}

const woodParts = (wood) => ({
  'minecraft:destructible_by_mining': { seconds_to_destroy: 1.5 },
  'minecraft:destructible_by_explosion': { explosion_resistance: 2 },
  'minecraft:flammable': { catch_chance_modifier: 5, destroy_chance_modifier: 20 },
  'minecraft:map_color': wood.map,
});

const blockFiles = [];
const recipeFiles = [];
const langJA = [];
const langEN = [];
const terrain = {};
const blocksJson = { format_version: [1, 1, 0] };
const allBlockIds = [];

function texture(shortName) {
  terrain[shortName] = { textures: `textures/blocks/${shortName}` };
  return shortName;
}

function addBlock({ name, geo, materials, components, description, permutations, sound, ja, en }) {
  const identifier = `${NS}:${name}`;
  allBlockIds.push(identifier);
  const def = {
    format_version: BLOCK_FORMAT,
    'minecraft:block': {
      description: {
        identifier,
        menu_category: { category: 'construction' },
        ...(description ?? {}),
      },
      components: {
        // display_name は「文字列」で渡す。{ value: ... } と書くと統合版が
        // "minecraft:display_name: invalid string" でブロックごと弾く
        'minecraft:display_name': `tile.${identifier}.name`,
        'minecraft:geometry': `geometry.${NS}.${geo}`,
        'minecraft:material_instances': materials,
        ...components,
      },
    },
  };
  if (permutations) def['minecraft:block'].permutations = permutations;
  blockFiles.push([`${name}.json`, def]);
  blocksJson[identifier] = { sound: sound ?? 'wood' };
  langJA.push([`tile.${identifier}.name`, ja]);
  langEN.push([`tile.${identifier}.name`, en]);
  return identifier;
}

function addShaped(name, pattern, key, result, count = 1) {
  recipeFiles.push([`${name}.json`, {
    format_version: RECIPE_FORMAT,
    'minecraft:recipe_shaped': {
      description: { identifier: `${NS}:${name}` },
      tags: ['crafting_table'],
      pattern,
      key,
      unlock: Object.values(key).map((v) => ({ item: v.item })),
      result: { item: result, count },
    },
  }]);
}

function addShapeless(name, ingredients, result, count = 1) {
  recipeFiles.push([`${name}.json`, {
    format_version: RECIPE_FORMAT,
    'minecraft:recipe_shapeless': {
      description: { identifier: `${NS}:${name}` },
      tags: ['crafting_table'],
      ingredients: ingredients.map((item) => ({ item })),
      unlock: ingredients.map((item) => ({ item })),
      result: { item: result, count },
    },
  }]);
}

/* ============================================================ ブロック生成 */

/* -------------------------------------------------------- 1. 竹のはしご */
addBlock({
  name: 'bamboo_ladder',
  geo: 'ladder',
  ja: '竹のはしご',
  en: 'Bamboo Ladder',
  materials: { '*': { texture: texture('vc_bamboo_ladder'), render_method: 'alpha_test', face_dimming: false, ambient_occlusion: false } },
  description: directional(),
  permutations: rotationPermutations(),
  components: {
    'minecraft:collision_box': false,
    'minecraft:selection_box': { origin: [-8, 0, -8], size: [16, 16, 16] },
    'minecraft:destructible_by_mining': { seconds_to_destroy: 0.4 },
    'minecraft:destructible_by_explosion': { explosion_resistance: 0.5 },
    'minecraft:light_dampening': 0,
    'minecraft:flammable': { catch_chance_modifier: 5, destroy_chance_modifier: 30 },
    'minecraft:map_color': '#a89440',
  },
});
addShaped('bamboo_ladder', ['B B', 'BBB', 'B B'], { B: { item: 'minecraft:bamboo' } }, `${NS}:bamboo_ladder`, 3);

/* ------------------------------------------- 2-4. 木材ごとの椅子/机/タンス */
for (const wood of WOODS) {
  const tex = texture(`vc_planks_${wood.id}`);
  texture('vc_metal');

  // 椅子（竹の椅子もここに含まれる）
  addBlock({
    name: `${wood.id}_chair`,
    geo: 'chair',
    ja: `${wood.ja}の椅子`,
    en: `${wood.en} Chair`,
    materials: { '*': { texture: tex, render_method: 'opaque' } },
    description: directional(),
    permutations: rotationPermutations(),
    components: {
      ...woodParts(wood),
      'minecraft:collision_box': { origin: [-7, 0, -7], size: [14, 8, 14] },
      'minecraft:selection_box': { origin: [-7, 0, -7], size: [14, 16, 14] },
    },
  });
  addShaped(`${wood.id}_chair`, ['P  ', 'PPP', 'P P'], { P: { item: wood.planks } }, `${NS}:${wood.id}_chair`);

  // 机
  addBlock({
    name: `${wood.id}_desk`,
    geo: 'desk',
    ja: `${wood.ja}の机`,
    en: `${wood.en} Desk`,
    materials: {
      '*': { texture: tex, render_method: 'opaque' },
      metal: { texture: 'vc_metal', render_method: 'opaque' },
    },
    description: directional(),
    permutations: rotationPermutations(),
    components: {
      ...woodParts(wood),
      'minecraft:collision_box': { origin: [-8, 0, -8], size: [16, 16, 16] },
      'minecraft:selection_box': { origin: [-8, 0, -8], size: [16, 16, 16] },
    },
  });
  addShaped(`${wood.id}_desk`, ['PPP', 'P P', 'P P'], { P: { item: wood.planks } }, `${NS}:${wood.id}_desk`);

  // タンス（チェスト機能つき）
  addBlock({
    name: `${wood.id}_dresser`,
    geo: 'dresser',
    ja: `${wood.ja}のタンス`,
    en: `${wood.en} Dresser`,
    materials: {
      '*': { texture: tex, render_method: 'opaque' },
      metal: { texture: 'vc_metal', render_method: 'opaque' },
    },
    description: directional(),
    permutations: rotationPermutations(),
    components: {
      ...woodParts(wood),
      'minecraft:destructible_by_mining': { seconds_to_destroy: 2.0 },
      'minecraft:collision_box': { origin: [-8, 0, -8], size: [16, 16, 16] },
      'minecraft:selection_box': { origin: [-8, 0, -8], size: [16, 16, 16] },
    },
  });
  addShaped(
    `${wood.id}_dresser`,
    ['PPP', 'PCP', 'PPP'],
    { P: { item: wood.planks }, C: { item: 'minecraft:chest' } },
    `${NS}:${wood.id}_dresser`
  );
}

/* --------------------------------------------------- 5. 模様付きカーペット */
for (const carpet of CARPETS) {
  const tex = texture(`vc_carpet_${carpet.id}`);
  addBlock({
    name: `carpet_${carpet.id}`,
    geo: 'carpet',
    ja: `${carpet.ja}のカーペット`,
    en: `${carpet.en} Carpet`,
    sound: 'cloth',
    materials: { '*': { texture: tex, render_method: 'opaque' } },
    components: {
      'minecraft:collision_box': { origin: [-8, 0, -8], size: [16, 1, 16] },
      'minecraft:selection_box': { origin: [-8, 0, -8], size: [16, 1, 16] },
      'minecraft:destructible_by_mining': { seconds_to_destroy: 0.2 },
      'minecraft:destructible_by_explosion': { explosion_resistance: 0.4 },
      'minecraft:flammable': { catch_chance_modifier: 30, destroy_chance_modifier: 60 },
      'minecraft:light_dampening': 0,
      'minecraft:map_color': carpet.map,
    },
  });
  addShapeless(`carpet_${carpet.id}`, ['minecraft:white_carpet', carpet.dye], `${NS}:carpet_${carpet.id}`);
}

/* ------------------------------------------------------------- 6. PC 2色 */
for (const pc of [
  { id: 'black', ja: 'ブラック', en: 'Black', case: 'vc_pc_black', key: 'vc_pc_key_black', craft: 'minecraft:black_concrete', map: '#1e1f23' },
  { id: 'white', ja: 'ホワイト', en: 'White', case: 'vc_pc_white', key: 'vc_pc_key_white', craft: 'minecraft:white_concrete', map: '#ececed' },
]) {
  texture(pc.case); texture(pc.key); texture('vc_pc_screen_on'); texture('vc_pc_screen_off');
  addBlock({
    name: `pc_${pc.id}`,
    geo: 'pc',
    ja: `モダンPC（${pc.ja}）`,
    en: `Modern PC (${pc.en})`,
    sound: 'stone',
    materials: {
      '*': { texture: pc.case, render_method: 'opaque' },
      key: { texture: pc.key, render_method: 'opaque' },
      screen: { texture: 'vc_pc_screen_off', render_method: 'opaque' },
    },
    description: {
      ...directional(),
      states: { [`${NS}:powered`]: [false, true] },
    },
    permutations: [
      ...rotationPermutations(),
      {
        condition: `q.block_state('${NS}:powered') == true`,
        components: {
          'minecraft:material_instances': {
            '*': { texture: pc.case, render_method: 'opaque' },
            key: { texture: pc.key, render_method: 'opaque' },
            screen: { texture: 'vc_pc_screen_on', render_method: 'opaque' },
          },
          'minecraft:light_emission': 7,
        },
      },
    ],
    components: {
      'minecraft:collision_box': { origin: [-8, 0, -8], size: [16, 12, 16] },
      'minecraft:selection_box': { origin: [-8, 0, -8], size: [16, 12, 16] },
      'minecraft:destructible_by_mining': { seconds_to_destroy: 1.0 },
      'minecraft:destructible_by_explosion': { explosion_resistance: 2 },
      'minecraft:map_color': pc.map,
    },
  });
  addShaped(
    `pc_${pc.id}`,
    ['CCC', 'CGC', 'CRC'],
    { C: { item: pc.craft }, G: { item: 'minecraft:glass_pane' }, R: { item: 'minecraft:redstone' } },
    `${NS}:pc_${pc.id}`
  );
}

/* ------------------------------------------------------ 7. クォーツのシンク */
texture('vc_quartz_side'); texture('vc_quartz_top'); texture('vc_water');
addBlock({
  name: 'quartz_sink',
  geo: 'sink',
  ja: 'クォーツのシンク',
  en: 'Quartz Sink',
  sound: 'stone',
  materials: {
    '*': { texture: 'vc_quartz_side', render_method: 'opaque' },
    top: { texture: 'vc_quartz_top', render_method: 'opaque' },
    metal: { texture: 'vc_metal', render_method: 'opaque' },
    water: { texture: 'vc_water', render_method: 'blend' },
  },
  description: directional(),
  permutations: rotationPermutations(),
  components: {
    'minecraft:collision_box': { origin: [-8, 0, -8], size: [16, 12, 16] },
    'minecraft:selection_box': { origin: [-8, 0, -8], size: [16, 16, 16] },
    'minecraft:destructible_by_mining': { seconds_to_destroy: 1.2 },
    'minecraft:destructible_by_explosion': { explosion_resistance: 3 },
    'minecraft:map_color': '#e6e3dc',
  },
});
addShaped(
  'quartz_sink',
  ['QIQ', 'Q Q', 'QQQ'],
  { Q: { item: 'minecraft:quartz_block' }, I: { item: 'minecraft:iron_ingot' } },
  `${NS}:quartz_sink`
);

/* ------------------------------------------------- 8. ポテトの銅像（隠し要素） */
texture('vc_potato'); texture('vc_potato_face'); texture('vc_copper');
addBlock({
  name: 'potato_statue',
  geo: 'potato_statue',
  ja: 'ポテトの銅像',
  en: 'Potato Statue',
  sound: 'stone',
  materials: {
    '*': { texture: 'vc_potato', render_method: 'opaque' },
    face: { texture: 'vc_potato_face', render_method: 'opaque' },
    copper: { texture: 'vc_copper', render_method: 'opaque' },
  },
  description: directional(),
  permutations: rotationPermutations(),
  components: {
    'minecraft:collision_box': { origin: [-7, 0, -7], size: [14, 16, 14] },
    'minecraft:selection_box': { origin: [-7, 0, -7], size: [14, 16, 14] },
    'minecraft:destructible_by_mining': { seconds_to_destroy: 2.5 },
    'minecraft:destructible_by_explosion': { explosion_resistance: 6 },
    'minecraft:map_color': '#c1793f',
  },
});
addShaped(
  'potato_statue',
  ['PPP', 'PCP', 'PPP'],
  { P: { item: 'minecraft:potato' }, C: { item: 'minecraft:copper_block' } },
  `${NS}:potato_statue`
);

/* ============================================================ 書き出し */

// 古い生成物を消してから書き直す（ブロック名を変えたときのゴミ対策）
for (const dir of [path.join(BP, 'blocks'), path.join(BP, 'recipes')]) {
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f));
}
for (const [file, data] of blockFiles) writeJSON(path.join(BP, 'blocks', file), data);
for (const [file, data] of recipeFiles) writeJSON(path.join(BP, 'recipes', file), data);

writeJSON(path.join(RP, 'textures', 'terrain_texture.json'), {
  resource_pack_name: 'vcraft_home',
  texture_name: 'atlas.terrain',
  padding: 8,
  num_mip_levels: 4,
  texture_data: terrain,
});
writeJSON(path.join(RP, 'blocks.json'), blocksJson);

/* -------------------------------------------------------------- エンティティ */

const PROP_BASE = {
  'minecraft:type_family': { family: ['vcraft_prop', 'inanimate'] },
  'minecraft:collision_box': { width: 0.05, height: 0.05 },
  'minecraft:physics': { has_gravity: false, has_collision: false },
  'minecraft:health': { value: 1, max: 1 },
  'minecraft:damage_sensor': { triggers: [{ cause: 'all', deals_damage: false }] },
  'minecraft:fire_immune': true,
  'minecraft:knockback_resistance': { value: 1000 },
  'minecraft:pushable': { is_pushable: false, is_pushable_by_piston: false },
  'minecraft:persistent': {},
};

writeJSON(path.join(BP, 'entities', 'seat.json'), {
  format_version: '1.21.0',
  'minecraft:entity': {
    description: { identifier: `${NS}:seat`, is_spawnable: false, is_summonable: true },
    components: {
      ...PROP_BASE,
      'minecraft:rideable': {
        seat_count: 1,
        family_types: ['player'],
        pull_in_entities: false,
        interact_text: 'action.interact.ride',
        seats: { position: [0, 0, 0], lock_rider_rotation: 181 },
      },
    },
  },
});

writeJSON(path.join(BP, 'entities', 'storage.json'), {
  format_version: '1.21.0',
  'minecraft:entity': {
    description: { identifier: `${NS}:storage`, is_spawnable: false, is_summonable: true },
    components: {
      ...PROP_BASE,
      'minecraft:inventory': {
        container_type: 'container',
        inventory_size: 27,
        can_be_siphoned_from: false,
        private: false,
      },
    },
  },
});

for (const id of ['seat', 'storage']) {
  writeJSON(path.join(RP, 'entity', `${id}.entity.json`), {
    format_version: '1.10.0',
    'minecraft:client_entity': {
      description: {
        identifier: `${NS}:${id}`,
        materials: { default: 'entity_alphatest' },
        textures: { default: 'textures/entity/vc_empty' },
        geometry: { default: `geometry.${NS}.empty` },
        render_controllers: [`controller.render.${NS}_empty`],
      },
    },
  });
}

writeJSON(path.join(RP, 'render_controllers', 'vcraft.render_controllers.json'), {
  format_version: '1.10.0',
  render_controllers: {
    [`controller.render.${NS}_empty`]: {
      geometry: 'Geometry.default',
      materials: [{ '*': 'Material.default' }],
      textures: ['Texture.default'],
    },
  },
});

/* ------------------------------------------------------------ 言語ファイル */

const UI = [
  ['pack.name', 'Vcraft: ホーム家具', 'Vcraft: Home Furniture'],
  ['pack.description', '竹のはしご・全木材の椅子/机/タンス・模様付きカーペット・モダンPC・クォーツのシンク。', 'Bamboo ladder, chairs/desks/dressers for every wood, patterned carpets, a modern PC and a quartz sink.'],
  ['vcraft.ui.close', '閉じる', 'Close'],
  ['vcraft.ui.back', '戻る', 'Back'],
  ['vcraft.ui.dresser.title', 'タンス', 'Dresser'],
  ['vcraft.ui.dresser.body', 'アイテムの入ったスロットを選ぶと取り出し、空きスロットを選ぶと手に持っているアイテムをしまいます。', 'Pick a filled slot to take it out, or an empty slot to store the item in your hand.'],
  ['vcraft.ui.dresser.empty', '空き', 'Empty'],
  ['vcraft.ui.dresser.deposit', 'ホットバー以外をまとめてしまう', 'Store everything but the hotbar'],
  ['vcraft.ui.dresser.full', 'タンスがいっぱいです', 'The dresser is full'],
  ['vcraft.ui.pc.body', 'V-CRAFT OS へようこそ。', 'Welcome to V-CRAFT OS.'],
  ['vcraft.ui.pc.status', 'ステータス', 'Status'],
  ['vcraft.ui.pc.world', 'ワールド情報', 'World info'],
  ['vcraft.ui.pc.memo', 'メモ帳', 'Notepad'],
  ['vcraft.ui.pc.music', 'ミュージック', 'Music'],
  ['vcraft.ui.pc.music_stop', '音楽を止める', 'Stop the music'],
  ['vcraft.ui.pc.shutdown', '電源を切る', 'Shut down'],
  ['vcraft.ui.pc.memo.placeholder', '空のまま保存すると消去します', 'Save it empty to clear the note'],
  ['vcraft.ui.pc.memo.saved', 'メモを保存しました', 'Note saved'],
  ['vcraft.ui.pc.memo.cleared', 'メモを消去しました', 'Note cleared'],
  ['vcraft.ui.pc.memo.none', 'まだメモはありません。', 'No notes yet.'],
  ['vcraft.ui.pc.label.player', 'プレイヤー', 'Player'],
  ['vcraft.ui.pc.label.pos', '座標', 'Position'],
  ['vcraft.ui.pc.label.dimension', 'ディメンション', 'Dimension'],
  ['vcraft.ui.pc.label.health', '体力', 'Health'],
  ['vcraft.ui.pc.label.level', 'レベル', 'Level'],
  ['vcraft.ui.pc.label.day', '経過日数', 'Day'],
  ['vcraft.ui.pc.label.time', '時刻', 'Time'],
  ['vcraft.ui.pc.label.players', 'ログイン中', 'Players online'],
  ['vcraft.msg.sink.bucket', 'バケツに水を汲んだ。', 'Filled the bucket with water.'],
  ['vcraft.msg.sink.bottle', '瓶に水を入れた。', 'Filled a bottle with water.'],
  ['vcraft.msg.sink.wash', '手を洗った。さっぱり。', 'Washed your hands. Refreshing.'],
  ['vcraft.msg.statue.reward', 'ポテトの神が微笑んだ。', 'The Potato God smiles upon you.'],
  ['vcraft.msg.statue.secret', '…銅像がまばたきした気がする。', '...you could swear the statue just blinked.'],
];

const blockLines = (list) => list.map(([k, v]) => `${k}=${v}`).join('\n');

// パック一覧では BP と RP が並ぶ。同じ名前だと「片方だけ有効にしている」事故に
// 気づけないので、名前の末尾に [BP] / [RP] を足して区別できるようにする。
const tagged = (rows, tag, col) =>
  rows.map(([k, ja, en]) => {
    const v = col === 'ja' ? ja : en;
    return `${k}=${k === 'pack.name' ? `${v} ${tag}` : v}`;
  }).join('\n');

writeText(
  path.join(RP, 'texts', 'ja_JP.lang'),
  `${tagged(UI, '[RP]', 'ja')}\n${blockLines(langJA)}\n`
);
writeText(
  path.join(RP, 'texts', 'en_US.lang'),
  `${tagged(UI, '[RP]', 'en')}\n${blockLines(langEN)}\n`
);
writeJSON(path.join(RP, 'texts', 'languages.json'), ['en_US', 'ja_JP']);

const packOnly = UI.filter(([k]) => k.startsWith('pack.'));
writeText(path.join(BP, 'texts', 'ja_JP.lang'), `${tagged(packOnly, '[BP]', 'ja')}\n`);
writeText(path.join(BP, 'texts', 'en_US.lang'), `${tagged(packOnly, '[BP]', 'en')}\n`);
writeJSON(path.join(BP, 'texts', 'languages.json'), ['en_US', 'ja_JP']);

console.log(
  `ブロック ${blockFiles.length} 種 / レシピ ${recipeFiles.length} 種 / ` +
  `ジオメトリ ${GEOMETRIES.length} 個 / テクスチャ登録 ${Object.keys(terrain).length} 件 を出力しました。`
);
