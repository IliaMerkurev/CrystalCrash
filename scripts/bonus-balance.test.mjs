import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {BonusController, BONUS_DEFS} from '../src/bonus-controller.js';
import {BonusWorld} from '../src/bonus-world.js';
import {arenaDefinition, arenaBlocks, setArenaRunSeed} from '../src/arena-data.js';
import {BlackHoleLens} from '../src/blackhole-lens.js';

const hit = (powers, id, time) => powers.consumeDirect(powers.capture(), id, time);

test('Pulse activates on pickup and repeatedly blasts during its shared ten-second timer', () => {
  const powers = new BonusController();
  powers.tick(100);
  assert.equal(powers.collect('pulse').kind, 'pulse');
  assert.equal(powers.has('pulse'), true);
  assert.equal(powers.active.startedAt, 100);
  assert.equal(powers.snapshotHUD().active.secondsLeft, 10);
  const batch = powers.capture();
  for (const id of [1, 2]) {
    const result = powers.consumeDirect(batch, id, 100);
    assert.equal(result.damage, 3);
    assert.deepEqual(result.effects, [{kind: 'pulse', originId: id, radiusD: 4.4, maxTargets: Infinity, damage: 3}]);
  }
  assert.equal(hit(powers, 1, 104).effects[0].kind, 'pulse', 'later valid impacts may revisit an original');
  powers.tick(104); powers.tick(104);
  assert.equal(powers.snapshotHUD().active.secondsLeft, 6, 'paused simulation time does not consume the buff');
  powers.tick(110);
  assert.equal(powers.has('pulse'), false);
  assert.equal(hit(powers, 1, 110).damage, 1);
  assert.equal('queued' in powers.snapshotHUD(), false);
});

test('Timed buffs coexist and duplicates add remaining time without restarting other buffs', () => {
  const powers = new BonusController();
  powers.collect('pulse'); powers.collect('pierce'); powers.collect('frost');
  powers.freezeArena([40]);
  assert.equal(powers.attacks.size, 2);
  powers.tick(4);
  const pierceId = powers.attacks.get('pierce').id;
  powers.collect('pulse');
  const hud = Object.fromEntries(powers.snapshotHUD().activeEffects.map(a => [a.kind, a]));
  assert.equal(hud.pulse.secondsLeft, 16);
  assert.equal(hud.pierce.secondsLeft, 6);
  assert.equal(hud.frost, undefined, 'Frost has no timed ball buff');
  assert.equal(powers.frostMarks.get(40), Infinity);
  assert.equal(powers.attacks.get('pierce').id, pierceId);
  assert.equal(powers.active.kind, 'pulse');
  powers.tick(10);
  assert.equal(powers.has('pulse'), true);
  assert.equal(powers.has('frost'), false);
  assert.equal(powers.pierceExit, true);
  powers.finishPierceExit();
  assert.equal(powers.has('pulse'), true);
  powers.tick(20);
  assert.equal(powers.attacks.size, 0);
  assert.equal(powers.frostMarks.get(40), Infinity, 'ice remains when timed powers expire');
});

test('Simultaneous Pulse, arena Frost, Heavy and Pierce preserve max damage without ice consumption', () => {
  const powers = new BonusController();
  powers.collect('frost');
  powers.freezeArena([40, 41]);
  assert.equal(hit(powers, 40, 0).damage, 1);
  powers.collect('pulse'); powers.collect('heavy'); powers.collect('pierce');
  const batch = powers.capture();
  const result = powers.consumeDirect(batch, 40, 0);
  assert.equal(result.damage, 8, 'Frost reduces arena durability instead of adding direct-hit damage');
  assert.equal(result.pierced, true);
  assert.equal(result.frostConsumed, false);
  assert.equal(powers.frostMarks.get(40), Infinity);
  assert.deepEqual(result.effects.map(e => e.kind), ['pulse', 'heavy']);
  assert.equal(powers.has('heavy'), false);
  assert.equal(powers.consumeDirect(batch, 40, 0).damage, 0, 'Pierce deduplicates across all balls');
  const next = powers.consumeDirect(batch, 41, 0);
  assert.equal(next.damage, 8);
  assert.deepEqual(next.effects.map(e => e.kind), ['pulse']);
  assert.equal(powers.frostMarks.get(41), Infinity);
  assert.equal(next.suppressReflection, true);
});

test('Pierce timers start at pickup; exit blocks only penetrating balls and preserves other buffs', () => {
  const powers = new BonusController();
  powers.collect('pierce');
  const batch = powers.capture();
  for (let id = 0; id < 100; id++) assert.equal(powers.consumeDirect(batch, id, 0).damage, 8);
  assert.equal(hit(powers, 0, 1).damage, 0);
  powers.tick(5); powers.collect('pulse');
  powers.tick(10);
  assert.equal(powers.has('pierce'), true);
  assert.equal(powers.pierceExit, true);
  assert.equal(powers.suppressReflection, true);
  const exitBatch = powers.capture();
  assert.equal(powers.consumeDirect(exitBatch, 101, 10, {penetrating: true}).damage, 0);
  const outside = powers.consumeDirect(exitBatch, 101, 10, {penetrating: false});
  assert.equal(outside.damage, 3);
  assert.equal(outside.pierced, false);
  assert.equal(outside.effects[0].kind, 'pulse');
  assert.equal(powers.finishPierceExit(), true);
  assert.equal(powers.has('pierce'), false);
  assert.equal(powers.has('pulse'), true);
  assert.equal(powers.finishPierceExit(), false);
});

test('Frost freezes every arena original immediately, persists and cannot stack or add hit damage', () => {
  const powers = new BonusController();
  powers.tick(80);
  assert.equal(powers.collect('frost').effect.kind, 'frost');
  const ids = Array.from({length: 50}, (_, id) => id);
  assert.deepEqual(powers.freezeArena(ids), ids);
  assert.equal(powers.frostMarks.size, 50);
  const frozen = hit(powers, 0, 85);
  assert.equal(frozen.damage, 1);
  assert.equal(frozen.frostConsumed, false);
  assert.equal(frozen.effects.length, 0);
  assert.equal(powers.frostMarks.get(0), Infinity);
  assert.deepEqual(powers.tick(900).expiredFrostIds, []);
  assert.equal(powers.has('frost'), false);
  assert.equal(powers.frostMarks.has(49), true);
  powers.collect('frost');
  assert.deepEqual(powers.freezeArena(ids), []);
  powers.collect('heavy');
  assert.equal(hit(powers, 49, 900).damage, 3);
  assert.equal(powers.frostMarks.size, 50);
  powers.reset();
  assert.equal(powers.frostMarks.size, 0);
});

test('Heavy pickups accumulate charges while captured batches cannot spend later pickups', () => {
  const powers = new BonusController();
  const emptyBatch = powers.capture();
  powers.collect('heavy'); powers.collect('pulse');
  const late = powers.consumeDirect(emptyBatch, 1, 0);
  assert.equal(late.damage, 1);
  assert.deepEqual(late.effects, []);
  assert.equal(powers.attacks.get('heavy').remaining, 1);
  const oldBatch = powers.capture();
  powers.collect('heavy');
  const refreshed = powers.consumeDirect(oldBatch, 2, 0);
  assert.equal(refreshed.damage, 3, 'the previously captured Pulse still applies');
  assert.deepEqual(refreshed.effects.map(e => e.kind), ['pulse']);
  assert.equal(powers.attacks.get('heavy').remaining, 2);
  const fresh = powers.capture();
  assert.deepEqual(powers.consumeDirect(fresh, 3, 0).effects.map(e => e.kind), ['pulse', 'heavy']);
  assert.deepEqual(powers.consumeDirect(fresh, 4, 0).effects.map(e => e.kind), ['pulse', 'heavy']);
  assert.equal(powers.has('heavy'), false);
  assert.deepEqual(powers.consumeDirect(fresh, 5, 0).effects.map(e => e.kind), ['pulse']);
});

test('Repeated Split activates immediately and multiplies live sources 1→3→9→27', () => {
  const powers = new BonusController();
  powers.collect('pulse'); powers.collect('frost'); powers.collect('heavy');
  let live = 1, first;
  for (const expected of [3, 9, 27]) {
    const result = powers.collect('split');
    first ??= result.effect.activationId;
    assert.equal(result.accepted, true);
    assert.equal(result.kind, 'split');
    assert.equal(result.effect.sourceType, 'all-live-balls');
    assert.equal(result.effect.persistent, true);
    assert.equal(result.effect.originId, null);
    assert.equal('duration' in result.effect, false);
    live += live * result.effect.echoCount;
    assert.equal(live, expected);
    assert.equal(powers.attacks.size, 2, 'instant effects cannot displace active buffs');
  }
  assert.equal(powers.has('split'), true);
  assert.equal(powers.finishSplit(first), true);
  assert.equal(powers.has('split'), false);
  assert.equal(powers.attacks.size, 2);
});

test('Arc, Frost, Tornado and Black Hole return immediate descriptors on every pickup', () => {
  const powers = new BonusController();
  powers.collect('pulse'); powers.collect('frost');
  assert.deepEqual(powers.collect('arc').effect, {kind: 'arc', originId: null, radiusD: 4.4, targetType: 'bottom-support-original', damage: 1});
  assert.deepEqual(powers.collect('frost').effect, {kind: 'frost', originId: null, persistent: true, targetType: 'all-current-originals', hitReduction: 1, minHits: 1});
  const tornado = powers.collect('gravity');
  assert.match(tornado.message, /Tornado activated/);
  assert.deepEqual(tornado.effect, {kind: 'gravity', originId: null, radiusD: 6, duration: 4, maxTargets: 12, accelerationD: 35, maxDeltaSpeedD: 24, targetType: 'intact-cube'});
  const hole = powers.collect('blackhole');
  assert.deepEqual(hole.effect, {kind: 'blackhole', originId: null, duration: 3, radiusD: 6.6, rampDuration: 1, acceleration: 50, speedCap: 14, maxTargets: 64});
  assert.equal('damage' in hole.effect, false);
  assert.equal(powers.collect('gravity').effect.kind, 'gravity');
  assert.equal(powers.collect('blackhole').effect.kind, 'blackhole');
  assert.equal(powers.attacks.size, 1);
  assert.equal(powers.has('pulse'), true);
  assert.equal(powers.has('frost'), false);
});

test('Automatic Bomb remains outside inventory with bounded blast tuning', () => {
  const def = BONUS_DEFS.bomb, powers = new BonusController();
  assert.equal(def.countdown, 3); assert.equal(def.radiusD, 4.4); assert.equal(def.damage, 8);
  assert.equal(def.maxBallSpeed, 30); assert.equal(def.kickSpeed, 22); assert.equal(def.color, 0xff9438);
  powers.collect('pulse'); powers.collect('frost'); powers.collect('heavy');
  const before = powers.snapshotHUD();
  assert.deepEqual(powers.collect('bomb'), {kind: 'bomb', accepted: false, message: 'Bomb is automatic and does not use inventory'});
  assert.deepEqual(powers.snapshotHUD(), before);
});

test('Retired IDs reject gracefully; reset removes every buff and invalidates old captures', () => {
  const powers = new BonusController();
  assert.equal(Object.keys(BONUS_DEFS).length, 9);
  for (const kind of ['halo', 'safetyHalo', 'safety-halo', 'safety_halo']) {
    assert.deepEqual(powers.collect(kind), {kind, accepted: false, message: 'Unknown power'});
  }
  assert.equal(typeof powers.consumeHalo, 'undefined');
  for (const kind of ['pulse', 'pierce', 'frost', 'heavy', 'split']) powers.collect(kind);
  powers.freezeArena([1, 2]);
  const stale = powers.capture();
  powers.reset();
  assert.equal(powers.consumeDirect(stale, 1, 0).damage, 0);
  assert.equal(powers.attacks.size, 0);
  assert.equal(powers.active, null);
  assert.equal(powers.splitActive, false);
  assert.equal(powers.frostMarks.size, 0);
  assert.equal('queued' in powers.snapshotHUD(), false);
  assert.equal('halo' in powers.snapshotHUD(), false);
});

function element() {
  return {children: [], attributes: {}, style: {setProperty() {}}, textContent: '',
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this.attributes[name] = value; }};
}
globalThis.document = {body: element(), createElement: element, createTextNode: text => ({textContent: text})};
const textOf = node => node.textContent + (node.children || []).map(textOf).join('');
function makeWorld() {
  const controller = new BonusController();
  const world = new BonusWorld({scene: new THREE.Scene(), controller, radius: .38,
    bounds: () => ({top: -10, mid: 0, bottom: 10, half: () => 5}), blocked: () => false,
    onSound() {}, onNotice() {}});
  return {world, controller};
}

test('Section reset preserves all simultaneous buffs and timers while clearing loose pickups', () => {
  const {world, controller} = makeWorld();
  controller.tick(20);
  for (const kind of ['split', 'pulse', 'frost', 'pierce', 'heavy']) controller.collect(kind);
  controller.tick(23);
  const before = controller.snapshotHUD();
  world.release({id: 40, bonus: 'pulse'});
  assert.equal(world.pickups.length, 1);
  world.reset({preservePowers: true});
  assert.deepEqual(controller.snapshotHUD(), before);
  assert.equal(world.pickups.length, 0);
  for (const effect of controller.snapshotHUD().activeEffects) {
    assert.equal(effect.secondsLeft, effect.kind === 'heavy' ? null : 7);
  }
  world.reset({run: true});
  assert.equal(controller.active, null);
  assert.equal(controller.attacks.size, 0);
  assert.equal(controller.splitActive, false);
});

test('HUD and accents display timed buffs, Heavy and Split without a Frost ball timer or accent', () => {
  const {world, controller} = makeWorld();
  for (const kind of ['split', 'pulse', 'pierce', 'frost', 'heavy']) controller.collect(kind);
  world.updateHUD();
  controller.freezeArena([55]);
  for (const name of ['PULSE', 'PIERCE']) assert.match(textOf(world.hud), new RegExp(name + ' · ACTIVE · 10s'));
  assert.doesNotMatch(textOf(world.hud), /FROST · ACTIVE/);
  assert.match(textOf(world.hud), /HEAVY HIT/);
  assert.match(textOf(world.hud), /SPLIT · EXTRA BALLS LIVE/);
  assert.doesNotMatch(textOf(world.hud), /NEXT ·|HIT GLASS/);
  controller.collect('heavy');
  world.updateHUD();
  assert.match(textOf(world.hud), /HEAVY HIT · 2 HITS/);
  hit(controller, 55, 0);
  world.updateHUD();
  assert.match(textOf(world.hud), /HEAVY HIT · 1 NEXT HIT/);
  controller.tick(3);
  world.updateHUD();
  for (const name of ['PULSE', 'PIERCE']) assert.match(textOf(world.hud), new RegExp(name + ' · ACTIVE · 7s'));
  world.render(new THREE.PerspectiveCamera(), new THREE.Vector3());
  for (const kind of ['pulse', 'pierce', 'heavy', 'split']) assert.equal(world.accents[kind].visible, true);
  assert.equal(world.accents.frost.visible, false);
  assert.equal(controller.frostMarks.get(55), Infinity);
  controller.tick(10);
  world.updateHUD();
  assert.match(textOf(world.hud), /PIERCE · EXITING/);
  assert.doesNotMatch(textOf(world.hud), /PULSE|FROST/);
  controller.finishPierceExit();
  assert.equal(controller.has('heavy'), true);
  assert.equal(controller.splitActive, true);
});

test('Arc links all 64 targets with finite jagged forks with bounded volumetric glow', () => {
  const {world} = makeWorld();
  const origin = new THREE.Vector3(0, .5, 0);
  const targets = Array.from({length: 64}, (_, i) => new THREE.Vector3((i % 8) - 4, .5, -1 - Math.floor(i / 8)));
  assert.equal(world.arcTargets(origin, targets), 64);
  assert.equal(world.arcs.filter(f => f.mesh.visible).length, 1);
  const fx = world.arcs[0], geometry = fx.mesh.geometry, positions = geometry.attributes.position;
  assert.equal(geometry.drawRange.count, 64 * 24);
  assert.equal(positions.count, 64 * 24);
  assert.ok([...positions.array].every(Number.isFinite));
  assert.equal(fx.core.count,64*12);assert.equal(fx.halo.count,64*12);assert.equal(fx.impacts.count,64);assert.ok([...fx.core.instanceMatrix.array].every(Number.isFinite));assert.ok([...fx.halo.instanceMatrix.array].every(Number.isFinite));
  for (let i = 0; i < 64; i++) {
    const start = new THREE.Vector3().fromBufferAttribute(positions, i * 24);
    const end = new THREE.Vector3().fromBufferAttribute(positions, i * 24 + 15);
    assert.ok(start.distanceTo(origin) < 1e-6);
    assert.ok(end.distanceTo(targets[i]) < 1e-6);
  }
  assert.equal(world.arcTargets(origin, [...targets, origin]), 65);
  assert.equal(world.arc([origin, targets[0], targets[1]]), 2);
  world.update(.8, origin, new THREE.Vector3(), false, new Map());
  assert.equal(world.arcs.filter(f => f.mesh.visible).length, 0);
});

test('Arc covers all 110 targets in distinct pooled chunks even when the pool is full', () => {
  const {world} = makeWorld();
  const origin = new THREE.Vector3(0, .5, 0);
  const targets = Array.from({length: 110}, (_, i) => new THREE.Vector3((i % 11) - 5, .5, -1 - Math.floor(i / 11)));
  const meshes = world.arcs.map(f => f.mesh), sceneCount = world.scene.children.length;
  for (const fx of world.arcs) { fx.mesh.visible = true; fx.age = 0; fx.mesh.material.color.set(0xffffff); }
  assert.equal(world.arcTargets(origin, targets), 110);
  assert.deepEqual(world.arcs.map(f => f.mesh), meshes, 'no pool expansion or replacement meshes');
  assert.equal(world.scene.children.length, sceneCount);
  const chunks = world.arcs.filter(f => f.mesh.material.color.getHex() === 0xb68cff);
  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks.map(f => f.mesh.geometry.drawRange.count), [64 * 24, 46 * 24]);
  let targetIndex = 0;
  for (const {mesh} of chunks) {
    const positions = mesh.geometry.attributes.position;
    assert.ok([...positions.array].every(Number.isFinite));
    for (let vertex = 0; vertex < mesh.geometry.drawRange.count; vertex += 24) {
      const start = new THREE.Vector3().fromBufferAttribute(positions, vertex);
      const end = new THREE.Vector3().fromBufferAttribute(positions, vertex + 15);
      assert.ok(start.distanceTo(origin) < 1e-6);
      assert.ok(end.distanceTo(targets[targetIndex++]) < 1e-6);
    }
  }
  assert.equal(targetIndex, 110);
});

 test('Released pickups double model scale, rest above floor and collect at wider tolerance',()=>{
 for(const kind of Object.keys(BONUS_DEFS).filter(kind=>!BONUS_DEFS[kind].automatic)){const {world}=makeWorld();let activated;world.onActivate=result=>{activated=result;assert.equal(world.pickups.length,0,'remove before dispatch');};world.release({id:1,bonus:kind});const item=world.pickups[0];assert.equal(item.scale,.38*2*1.3);assert(item.height>=.1);item.landed=true;item.p.set(0,item.height,1);world.update(.4,new THREE.Vector3(1,item.height,1),new THREE.Vector3(1,0,0),true,new Map());assert.equal(world.pickups.length,0,kind+' collects one world unit away');assert.equal(activated.kind,kind);assert.equal(activated.accepted,true);}
 });

test('Simultaneous main and extra pickup contact awards the item exactly once',()=>{const {world,controller}=makeWorld();world.release({id:9,bonus:'pulse'});const item=world.pickups[0];item.landed=true;item.p.set(0,item.height,1);const p=item.p.clone(),v=new THREE.Vector3(1,0,0);let count=0;const collect=controller.collect.bind(controller);controller.collect=kind=>{count++;return collect(kind);};world.update(.01,p,v,true,new Map(),[{id:12,p:p.clone(),v},{id:13,p:p.clone(),v}]);assert.equal(count,1);assert.equal(world.pickups.length,0);assert.equal(controller.active.kind,'pulse');assert.equal('queued' in controller.snapshotHUD(),false);});
test('Extra pickup sweeps keep independent histories and cannot bridge between balls',()=>{const {world,controller}=makeWorld();world.release({id:9,bonus:'heavy'});const item=world.pickups[0];item.landed=true;item.p.set(0,item.height,1);const v=new THREE.Vector3(1,0,0),main=new THREE.Vector3(0,.38,8);world.update(.01,main,v,false,new Map(),[{id:12,p:new THREE.Vector3(-3,item.height,1),v},{id:13,p:new THREE.Vector3(3,item.height,1),v}]);world.update(.01,main,v,false,new Map(),[{id:12,p:new THREE.Vector3(-2.8,item.height,1),v},{id:13,p:new THREE.Vector3(2.8,item.height,1),v}]);assert.equal(world.pickups.length,1);world.update(.01,main,v,false,new Map(),[{id:12,p:item.p.clone(),v}]);assert.equal(world.pickups.length,0);assert.equal(controller.active.kind,'heavy');});

test('Nine-type arena pool retains 1/2/2 counts and caps powerful later arenas at 2–3', () => {
  const expectedKinds = ['pulse', 'pierce', 'arc', 'frost', 'split', 'gravity', 'heavy', 'bomb', 'blackhole'].sort();
  assert.deepEqual(Object.keys(BONUS_DEFS).sort(), expectedKinds);
  const seen = new Set();
  try {
    for (const seed of [0, 1, 0xffffffff, 0x00c57a11]) {
      setArenaRunSeed(seed);
      assert.deepEqual(arenaDefinition(1).bonuses, ['pulse']);
      for (let level = 2; level <= 120; level++) {
        const bonuses = arenaDefinition(level).bonuses;
        assert.ok(bonuses.length >= 2 && bonuses.length <= 5);
        if (level <= 3) assert.equal(bonuses.length, 2);
        if (level === 2) assert.ok(bonuses.includes('bomb'));
        const powerful = bonuses.filter(kind => kind === 'gravity' || kind === 'blackhole');
        assert.ok(powerful.length <= 1, 'Tornado and Black Hole cannot share an arena');
        if (powerful.length) assert.ok(bonuses.length <= 3);
        assert.equal(new Set(bonuses).size, bonuses.length);
        assert.deepEqual(arenaDefinition(level).bonuses, bonuses, 'preview cannot reroll the selection');
        for (const kind of bonuses) { assert.ok(expectedKinds.includes(kind)); seen.add(kind); }
      }
      for (const level of [1, 2, 3, 6, 8, 10, 14, 28, 42]) {
        const bonuses = arenaBlocks(level).map(spec => spec[7]).filter(Boolean);
        assert.deepEqual(bonuses.sort(), arenaDefinition(level).bonuses.sort());
        assert.ok(!bonuses.includes('halo'));
      }
    }
  } finally { setArenaRunSeed(0x00c57a11); }
  assert.deepEqual([...seen].sort(), expectedKinds);
});

test('Legacy fall-protection metadata produces no pickup, accent or HUD entry', () => {
  const {world, controller} = makeWorld();
  for (const bonus of ['halo', 'safetyHalo', 'safety-halo', 'safety_halo']) {
    const origin = {id: 99, bonus};
    assert.doesNotThrow(() => world.attach(origin));
    assert.doesNotThrow(() => world.release(origin));
  }
  assert.equal(world.cores.size, 0);
  assert.equal(world.pickups.length, 0);
  assert.equal(world.accents.halo, undefined);
  controller.collect('pulse');
  world.updateHUD();
  assert.doesNotMatch(textOf(world.hud), /HALO|SAVE/i);
});

function lensRenderer(error = null) {
  const calls = {copies: 0, renders: 0, errors: 0};
  const renderer = {autoClear: true,
    getDrawingBufferSize(size) { return size.set(320, 640); }, initTexture() {},
    copyFramebufferToTexture() { calls.copies++; },
    render() { calls.renders++; }, compileAsync: async () => {}};
  if (error !== null) renderer.getContext = () => ({NO_ERROR: 0, getError() { calls.errors++; return error; }});
  return {renderer, calls};
}

test('Black Hole lens copies display-encoded RGBA8 without a second color-space conversion', () => {
  const {renderer, calls} = lensRenderer();
  const lens = new BlackHoleLens(renderer);
  assert.equal(lens.texture.colorSpace, THREE.NoColorSpace);
  assert.equal(lens.texture.format, THREE.RGBAFormat);
  assert.equal(lens.texture.type, THREE.UnsignedByteType);
  assert.doesNotMatch(lens.material.fragmentShader, /colorspace_fragment/);
  const camera = new THREE.PerspectiveCamera(45, .5, .1, 100);
  camera.updateMatrixWorld();
  lens.render(camera, {intensity: 1, point: new THREE.Vector3(0, 0, -5), range: 4});
  assert.equal(calls.copies, 1);
  assert.equal(calls.renders, 1, 'context validation is optional for lightweight renderer adapters');
  assert.equal(renderer.autoClear, true);
  lens.dispose();
});

test('Black Hole lens skips post-draw after a copy GL error and warns only once', () => {
  const {renderer, calls} = lensRenderer(0x0502);
  const lens = new BlackHoleLens(renderer);
  const camera = new THREE.PerspectiveCamera(45, .5, .1, 100);
  camera.updateMatrixWorld();
  const state = {intensity: 1, point: new THREE.Vector3(0, 0, -5), range: 4};
  const warnings = [], warn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try { lens.render(camera, state); lens.render(camera, state); lens.render(camera, state); }
  finally { console.warn = warn; lens.dispose(); }
  assert.equal(calls.copies, 1);
  assert.equal(calls.errors, 1);
  assert.equal(calls.renders, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0][0], /Black Hole lens/);
  assert.equal(warnings[0][1], 0x0502);
  assert.equal(renderer.autoClear, true);
});

test('Automatic Bomb starts three-second fuse only on landing, pauses and explodes exactly once',()=>{
 const {world,controller}=makeWorld();let explosions=0;world.onBomb=()=>explosions++;
 world.release({id:'bomb-check',bonus:'bomb',bonusPose:{p:new THREE.Vector3(0,2,-2),q:new THREE.Quaternion(),v:new THREE.Vector3()}});
 const item=world.pickups[0],ball=new THREE.Vector3(0,.38,-2),velocity=new THREE.Vector3(0,0,10);
 for(let i=0;i<300&&!item.landed;i++){world.update(.01,ball,velocity,true,new Map());assert.equal(item.fuseRemaining,3);}
 assert(item.landed);assert(item.timerRing);assert.equal(controller.active,null);
 for(let i=0;i<100;i++)world.update(.01,ball,velocity,true,new Map(),[],true);
 assert.equal(item.fuseRemaining,3);assert.equal(explosions,0);
 for(let i=0;i<299;i++)world.update(.01,ball,velocity,true,new Map());
 assert.equal(explosions,0);assert(item.fuseRemaining<.011);
 world.update(.011,ball,velocity,true,new Map());assert.equal(explosions,1);assert.equal(world.pickups.length,0);assert.equal(item.timerRing,null);
 world.update(1,ball,velocity,true,new Map());assert.equal(explosions,1);
});

test('New automatic/model kinds have finite geometry and fixed-budget Bomb/Black Hole feedback',async()=>{
 const {PowerFX}=await import('../src/power-fx.js');const {world}=makeWorld();
 for(const kind of ['bomb','blackhole','gravity']){const model=world.visuals.createModel(kind);world.visuals.animateCore(model,2);model.traverse(o=>{if(o.geometry?.attributes.position)assert([...o.geometry.attributes.position.array].every(Number.isFinite));});world.visuals.releaseInstance(model);}
 const fx=new PowerFX({THREE,scene:new THREE.Scene(),radius:.38});fx.trigger('bomb',new THREE.Vector3());fx.syncBlackHole({point:{x:0,y:2.8,z:-5},range:6.08,intensity:.5,age:1});fx.update(.1,new THREE.Vector3(),null);fx.syncBlackHole(null);fx.clear();assert(fx.warmupObjects().children.length>0);
});

test('Black Hole lens adds one bounded post draw and restores renderer state',async()=>{
 const {BlackHoleLens}=await import('../src/blackhole-lens.js');let copies=0,draws=0;const renderer={autoClear:true,getDrawingBufferSize:s=>s.set(800,600),initTexture(){},compileAsync:async()=>{},copyFramebufferToTexture(){copies++;},render(){draws++;}};
 const lens=new BlackHoleLens(renderer),camera=new THREE.PerspectiveCamera(42,4/3,.1,100);camera.position.set(0,8,12);camera.lookAt(0,1,0);camera.updateMatrixWorld();await lens.warm();lens.render(camera,null);assert.equal(draws,0);lens.render(camera,{point:{x:0,y:2.8,z:0},range:6.08,intensity:.5});assert.equal(copies,1);assert.equal(draws,1);assert.equal(renderer.autoClear,true);assert(lens.material.uniforms.radius.value>0);renderer.render=()=>{throw Error('draw failed');};assert.throws(()=>lens.render(camera,{point:{x:0,y:2.8,z:0},range:6.08,intensity:1}));assert.equal(renderer.autoClear,true);lens.dispose();
});

 test('Activation clears legacy readiness tips but preserves unrelated guidance',()=>{
 const {world}=makeWorld();world.tip={key:'ready-12',text:'BLACK HOLE READY · HIT GLASS'};world.tipAge=3;world.pendingTips=[{key:'power-blackhole',text:'Black Hole ready'},{key:'power-pulse',text:'PULSE · ACTIVE'}];world.dismissReadiness('blackhole');assert.equal(world.tip,null);assert.equal(world.pendingTips.length,1);world.feedback('BLACK HOLE · PULL BUILDING',new THREE.Vector3());assert.equal(world.tip.screenY,.58);assert.equal(world.tipAge,1.25);
 });
