/**
 * Vcraft ホーム家具 - 挙動スクリプト
 *
 *   椅子       : 右クリックで座る（スニーク中は座らない）
 *   タンス     : 27スロットの収納。壊すと中身がこぼれる
 *   竹のはしご : 中にいる間は登る。スニークでゆっくり降りる
 *   モダンPC   : 電源のオン/オフ と V-CRAFT OS メニュー
 *   シンク     : バケツ・瓶に水を汲む / 手を洗う（燃えていたら消火）
 *   ポテト銅像 : 触った回数で反応が変わる隠し要素
 */
import { world, system, ItemStack, EquipmentSlot } from '@minecraft/server';
import { ActionFormData, ModalFormData } from '@minecraft/server-ui';

const NS = 'vcraft';
const VERSION = '1.0.3';
const WOODS = [
  'oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak',
  'mangrove', 'cherry', 'pale_oak', 'crimson', 'warped', 'bamboo',
];

const CHAIRS = new Set(WOODS.map((w) => `${NS}:${w}_chair`));
const DRESSERS = new Set(WOODS.map((w) => `${NS}:${w}_dresser`));
const PCS = new Set([`${NS}:pc_black`, `${NS}:pc_white`]);
const LADDER = `${NS}:bamboo_ladder`;
const SINK = `${NS}:quartz_sink`;
const STATUE = `${NS}:potato_statue`;
const SEAT_ENTITY = `${NS}:seat`;
const STORAGE_ENTITY = `${NS}:storage`;

const PROP_POTATO = `${NS}:potato_touches`;
const PROP_MEMO = `${NS}:memo`;
const PROP_BORN = `${NS}:born`;

const t = (key) => ({ translate: key });
const center = (loc, y = 0.5) => ({ x: loc.x + 0.5, y: loc.y + y, z: loc.z + 0.5 });
const floorVec = (loc) => ({ x: Math.floor(loc.x), y: Math.floor(loc.y), z: Math.floor(loc.z) });

/* ==================================================== 右クリックの振り分け */

world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
  // 同じ操作で2回飛んでくることがあるので2回目は捨てる
  if (event.isFirstEvent === false) return;
  const { player, block } = event;
  if (player.isSneaking) return; // スニーク中はバニラの設置操作を邪魔しない

  const id = block.typeId;
  let handler;
  if (CHAIRS.has(id)) handler = sitDown;
  else if (DRESSERS.has(id)) handler = openDresser;
  else if (PCS.has(id)) handler = usePC;
  else if (id === SINK) handler = useSink;
  else if (id === STATUE) handler = touchStatue;
  if (!handler) return;

  event.cancel = true;
  const location = { ...block.location };
  const dimension = player.dimension;
  system.run(() => {
    try {
      const current = dimension.getBlock(location);
      if (current && current.typeId === id) handler(player, current);
    } catch (error) {
      console.warn(`[vcraft] ${id}: ${error}`);
    }
  });
});

/* ============================================================= 椅子に座る */

function sitDown(player, block) {
  if (player.getComponent('minecraft:riding')) return; // すでに何かに乗っている
  const seatPos = center(block.location, 0.3);
  const dimension = block.dimension;

  for (const entity of dimension.getEntities({ type: SEAT_ENTITY, location: seatPos, maxDistance: 0.6 })) {
    if ((entity.getComponent('minecraft:rideable')?.getRiders() ?? []).length > 0) return; // 先客あり
    entity.remove();
  }

  const seat = dimension.spawnEntity(SEAT_ENTITY, seatPos);
  seat.setDynamicProperty(PROP_BORN, system.currentTick);
  seat.getComponent('minecraft:rideable')?.addRider(player);
  dimension.playSound('step.wood', seatPos, { volume: 0.6, pitch: 1.2 });
}

// 空になった座席・壊された椅子の後始末
system.runInterval(() => {
  for (const id of ['overworld', 'nether', 'the_end']) {
    let dimension;
    try {
      dimension = world.getDimension(id);
    } catch {
      continue;
    }
    for (const seat of dimension.getEntities({ type: SEAT_ENTITY })) {
      const born = seat.getDynamicProperty(PROP_BORN);
      if (typeof born === 'number' && system.currentTick - born < 40) continue;
      const riders = seat.getComponent('minecraft:rideable')?.getRiders() ?? [];
      if (riders.length === 0) { seat.remove(); continue; }
      const under = dimension.getBlock(floorVec(seat.location));
      if (!under || !CHAIRS.has(under.typeId)) seat.remove(); // 椅子が壊された
    }
  }
}, 40);

/* ============================================================ タンスの収納 */

function storageOf(block, create) {
  const dimension = block.dimension;
  const pos = center(block.location);
  const found = dimension.getEntities({ type: STORAGE_ENTITY, location: pos, maxDistance: 0.5 });
  if (found.length > 0) return found[0];
  return create ? dimension.spawnEntity(STORAGE_ENTITY, pos) : undefined;
}

function itemLabel(item) {
  if (item.nameTag) return item.nameTag;
  return item.typeId
    .replace(/^[a-z_]+:/, '')
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function openDresser(player, block) {
  const container = storageOf(block, true)?.getComponent('minecraft:inventory')?.container;
  if (!container) return;
  player.playSound('random.chestopen', { volume: 0.6 });
  showDresser(player, { ...block.location }, container);
}

function showDresser(player, location, container) {
  const form = new ActionFormData().title(t('vcraft.ui.dresser.title')).body(t('vcraft.ui.dresser.body'));
  const slots = container.size;
  for (let i = 0; i < slots; i++) {
    const item = container.getItem(i);
    form.button(item
      ? `§f${itemLabel(item)}§r §7x${item.amount}`
      : { rawtext: [{ text: `§8${i + 1}. ` }, t('vcraft.ui.dresser.empty')] });
  }
  form.button(t('vcraft.ui.dresser.deposit'));
  form.button(t('vcraft.ui.close'));

  form.show(player).then((response) => {
    if (response.canceled || response.selection === undefined) return;
    const choice = response.selection;
    if (choice === slots + 1) {
      player.playSound('random.chestclosed', { volume: 0.6 });
      return;
    }
    if (choice === slots) depositAll(player, container);
    else swapSlot(player, container, choice);
    // フォームを閉じ切ってから開き直す
    system.runTimeout(() => {
      const block = player.dimension.getBlock(location);
      if (block && DRESSERS.has(block.typeId)) showDresser(player, location, container);
    }, 4);
  }).catch((error) => console.warn(`[vcraft] dresser: ${error}`));
}

function swapSlot(player, container, index) {
  const inventory = player.getComponent('minecraft:inventory')?.container;
  const equippable = player.getComponent('minecraft:equippable');
  if (!inventory || !equippable) return;

  const stored = container.getItem(index);
  if (stored) {
    const leftover = inventory.addItem(stored);
    container.setItem(index, leftover);
    player.playSound('random.pop', { volume: 0.4, pitch: 1.4 });
    return;
  }
  const held = equippable.getEquipment(EquipmentSlot.Mainhand);
  if (!held) return;
  container.setItem(index, held);
  equippable.setEquipment(EquipmentSlot.Mainhand, undefined);
  player.playSound('random.pop', { volume: 0.4, pitch: 0.9 });
}

function depositAll(player, container) {
  const inventory = player.getComponent('minecraft:inventory')?.container;
  if (!inventory) return;
  let moved = 0;
  for (let i = 9; i < inventory.size; i++) { // ホットバー(0-8)は手元に残す
    const item = inventory.getItem(i);
    if (!item) continue;
    const leftover = container.addItem(item);
    inventory.setItem(i, leftover);
    if (!leftover || leftover.amount !== item.amount) moved++;
  }
  if (moved === 0) player.onScreenDisplay.setActionBar(t('vcraft.ui.dresser.full'));
  else player.playSound('random.pop', { volume: 0.5, pitch: 0.8 });
}

function spillStorage(dimension, location) {
  const pos = center(location);
  for (const entity of dimension.getEntities({ type: STORAGE_ENTITY, location: pos, maxDistance: 0.5 })) {
    const container = entity.getComponent('minecraft:inventory')?.container;
    if (container) {
      for (let i = 0; i < container.size; i++) {
        const item = container.getItem(i);
        if (item) dimension.spawnItem(item, pos);
      }
    }
    entity.remove();
  }
}

world.afterEvents.playerBreakBlock.subscribe((event) => {
  if (!DRESSERS.has(event.brokenBlockPermutation.type.id)) return;
  spillStorage(event.dimension, event.block.location);
});

world.afterEvents.blockExplode.subscribe((event) => {
  if (!DRESSERS.has(event.explodedBlockPermutation.type.id)) return;
  spillStorage(event.dimension, event.block.location);
});

/* ============================================================ 竹のはしご */

const onLadder = new Set();

system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    let climbing = false;
    try {
      const feet = floorVec(player.location);
      const head = { ...feet, y: feet.y + 1 };
      climbing = player.dimension.getBlock(feet)?.typeId === LADDER
        || player.dimension.getBlock(head)?.typeId === LADDER;
    } catch {
      continue; // チャンク未読み込み
    }

    if (climbing) {
      onLadder.add(player.id);
      if (player.isSneaking) {
        player.removeEffect('levitation');
        player.addEffect('slow_falling', 20, { amplifier: 0, showParticles: false });
      } else {
        player.addEffect('levitation', 10, { amplifier: 1, showParticles: false });
      }
    } else if (onLadder.has(player.id)) {
      onLadder.delete(player.id);
      player.removeEffect('levitation');
      player.removeEffect('slow_falling');
    }
  }
}, 4);

/* ============================================================== モダンPC */

const DISCS = [
  'record.cat', 'record.blocks', 'record.chirp', 'record.far',
  'record.mall', 'record.mellohi', 'record.stal', 'record.strad', 'record.ward',
];

function setPower(block, on) {
  try {
    block.setPermutation(block.permutation.withState(`${NS}:powered`, on));
  } catch (error) {
    console.warn(`[vcraft] pc power: ${error}`);
  }
}

function usePC(player, block) {
  if (block.permutation.getState(`${NS}:powered`) !== true) {
    setPower(block, true);
    player.playSound('random.click', { pitch: 1.4 });
    player.playSound('beacon.activate', { volume: 0.35 });
    return;
  }
  showDesktop(player, { ...block.location });
}

function showDesktop(player, location) {
  new ActionFormData()
    .title('§lV-CRAFT OS')
    .body(t('vcraft.ui.pc.body'))
    .button(t('vcraft.ui.pc.status'))
    .button(t('vcraft.ui.pc.world'))
    .button(t('vcraft.ui.pc.memo'))
    .button(t('vcraft.ui.pc.music'))
    .button(t('vcraft.ui.pc.music_stop'))
    .button(t('vcraft.ui.pc.shutdown'))
    .button(t('vcraft.ui.close'))
    .show(player)
    .then((response) => {
      if (response.canceled || response.selection === undefined) return;
      switch (response.selection) {
        case 0: return showInfo(player, location, statusLines(player));
        case 1: return showInfo(player, location, worldLines());
        case 2: return showMemo(player, location);
        case 3: {
          const disc = DISCS[Math.floor(Math.random() * DISCS.length)];
          player.playSound(disc, { volume: 0.8 });
          return;
        }
        case 4: {
          player.runCommand('stopsound @s');
          return;
        }
        case 5: {
          const block = player.dimension.getBlock(location);
          if (block && PCS.has(block.typeId)) setPower(block, false);
          player.playSound('random.click', { pitch: 0.7 });
          return;
        }
        default: return;
      }
    })
    .catch((error) => console.warn(`[vcraft] pc: ${error}`));
}

const row = (key, value) => [t(key), { text: `§7: §f${value}\n` }];

function statusLines(player) {
  const health = player.getComponent('minecraft:health');
  const { x, y, z } = player.location;
  return {
    rawtext: [
      ...row('vcraft.ui.pc.label.player', player.name),
      ...row('vcraft.ui.pc.label.pos', `${Math.floor(x)}, ${Math.floor(y)}, ${Math.floor(z)}`),
      ...row('vcraft.ui.pc.label.dimension', player.dimension.id.replace('minecraft:', '')),
      ...row('vcraft.ui.pc.label.health', `${Math.round(health?.currentValue ?? 0)} / ${Math.round(health?.effectiveMax ?? 0)}`),
      ...row('vcraft.ui.pc.label.level', String(player.level)),
    ],
  };
}

function worldLines() {
  const ticks = world.getTimeOfDay();
  const hour = Math.floor((ticks / 1000 + 6) % 24);
  const minute = Math.floor(((ticks % 1000) / 1000) * 60);
  return {
    rawtext: [
      ...row('vcraft.ui.pc.label.day', String(world.getDay())),
      ...row('vcraft.ui.pc.label.time', `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`),
      ...row('vcraft.ui.pc.label.players', String(world.getAllPlayers().length)),
    ],
  };
}

function showInfo(player, location, body) {
  new ActionFormData()
    .title('§lV-CRAFT OS')
    .body(body)
    .button(t('vcraft.ui.back'))
    .button(t('vcraft.ui.close'))
    .show(player)
    .then((response) => {
      if (response.selection === 0) system.runTimeout(() => showDesktop(player, location), 4);
    })
    .catch((error) => console.warn(`[vcraft] pc info: ${error}`));
}

function showMemo(player, location) {
  const saved = player.getDynamicProperty(PROP_MEMO);
  const body = typeof saved === 'string' && saved.length > 0
    ? { rawtext: [{ text: `§7"§f${saved}§7"§r\n\n` }] }
    : { rawtext: [t('vcraft.ui.pc.memo.none'), { text: '\n\n' }] };

  const form = new ModalFormData().title(t('vcraft.ui.pc.memo'));
  // ModalFormData に body は無いので、ラベル代わりに現在のメモを見せる
  form.textField(body, t('vcraft.ui.pc.memo.placeholder'));
  form.show(player)
    .then((response) => {
      if (response.canceled || !response.formValues) return;
      const text = String(response.formValues[0] ?? '').trim();
      if (text.length === 0) {
        player.setDynamicProperty(PROP_MEMO, undefined);
        player.onScreenDisplay.setActionBar(t('vcraft.ui.pc.memo.cleared'));
      } else {
        player.setDynamicProperty(PROP_MEMO, text.slice(0, 200));
        player.onScreenDisplay.setActionBar(t('vcraft.ui.pc.memo.saved'));
      }
      system.runTimeout(() => showDesktop(player, location), 4);
    })
    .catch((error) => console.warn(`[vcraft] memo: ${error}`));
}

/* ================================================================ シンク */

function consumeHeld(equippable, held) {
  if (held.amount > 1) {
    held.amount -= 1;
    equippable.setEquipment(EquipmentSlot.Mainhand, held);
  } else {
    equippable.setEquipment(EquipmentSlot.Mainhand, undefined);
  }
}

function giveItem(player, item) {
  const leftover = player.getComponent('minecraft:inventory')?.container?.addItem(item);
  if (leftover) player.dimension.spawnItem(leftover, player.location);
}

function useSink(player, block) {
  const dimension = block.dimension;
  const spout = center(block.location, 0.95);
  const equippable = player.getComponent('minecraft:equippable');
  const held = equippable?.getEquipment(EquipmentSlot.Mainhand);

  dimension.playSound('bucket.fill_water', spout, { volume: 0.8 });
  try {
    dimension.spawnParticle('minecraft:water_splash_particle_manual', spout);
  } catch {
    /* パーティクルIDが無い環境でも音だけで成立させる */
  }

  if (held?.typeId === 'minecraft:bucket' && equippable) {
    consumeHeld(equippable, held);
    giveItem(player, new ItemStack('minecraft:water_bucket', 1));
    player.onScreenDisplay.setActionBar(t('vcraft.msg.sink.bucket'));
    return;
  }
  if (held?.typeId === 'minecraft:glass_bottle' && equippable) {
    consumeHeld(equippable, held);
    player.runCommand('give @s potion 1 0'); // 水入り瓶はデータ値が必要なのでコマンドで渡す
    player.onScreenDisplay.setActionBar(t('vcraft.msg.sink.bottle'));
    return;
  }
  player.extinguishFire(true);
  player.onScreenDisplay.setActionBar(t('vcraft.msg.sink.wash'));
}

/* ================================================== ポテトの銅像（隠し要素） */

function touchStatue(player, block) {
  const dimension = block.dimension;
  const pos = center(block.location, 1.0);
  const equippable = player.getComponent('minecraft:equippable');
  const held = equippable?.getEquipment(EquipmentSlot.Mainhand);

  // 毒ポテトを供えると焼きポテトになって返ってくる
  if (held?.typeId === 'minecraft:poisonous_potato' && equippable) {
    consumeHeld(equippable, held);
    giveItem(player, new ItemStack('minecraft:baked_potato', 3));
    dimension.playSound('beacon.power', pos, { volume: 0.8 });
    player.sendMessage(t('vcraft.msg.statue.secret'));
    return;
  }

  const previous = player.getDynamicProperty(PROP_POTATO);
  const count = (typeof previous === 'number' ? previous : 0) + 1;
  player.setDynamicProperty(PROP_POTATO, count);

  dimension.playSound('random.pop', pos, { volume: 0.7, pitch: 0.7 + (count % 9) * 0.07 });
  player.onScreenDisplay.setActionBar(`§6🥔 §f${count}`);

  if (count % 10 === 0) {
    giveItem(player, new ItemStack('minecraft:potato', 1));
    dimension.playSound('random.levelup', pos, { volume: 0.5 });
    player.sendMessage(t('vcraft.msg.statue.reward'));
  }
  if (count === 64) {
    giveItem(player, new ItemStack('minecraft:golden_apple', 1));
    dimension.playSound('random.totem', pos, { volume: 0.7 });
  }
}

/* ============================================ 読み込めているかを見えるようにする */

// ワールドに入ったとき、ビヘイビアーパックが動いているかを本人に伝える。
// このメッセージが出ない = BP が有効になっていない（家具も出てこない）。
world.afterEvents.playerSpawn.subscribe((event) => {
  if (!event.initialSpawn) return;
  event.player.sendMessage(
    `§a[Vcraft]§r ホーム家具 §7v${VERSION}§r を読み込みました（ブロック49種）。\n`
    + '§7クリエイティブの「建材 / Construction」タブの一番下、'
    + 'または検索タブで §fchair§7 / §fdesk§7 / §fdresser§7 / §fcarpet§7 と入力すると出てきます。'
  );
});

console.warn(`[vcraft] ホーム家具アドオン v${VERSION} を読み込みました。`);
