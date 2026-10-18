import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {BonusController, BONUS_DEFS} from '../src/bonus-controller.js';
import {BonusWorld} from '../src/bonus-world.js';

const hit = (powers, id, time) => powers.consumeDirect(powers.capture(), id, time);

test('Pulse waits for first impact and repeatedly blasts for one shared 10-second timer', () => {
  const powers = new BonusController();
  powers.collect('pulse');
  powers.collect('heavy');
  powers.tick(100);
  assert.equal(powers.snapshotHUD().active.secondsLeft, 10);
  assert.equal(powers.snapshotHUD().active.remaining, null);
  assert.equal(powers.active.startedAt, null);
  const batch = powers.capture();
  const result = powers.consumeDirect(batch, 1, 100);
  assert.equal(result.damage, 3);
  assert.deepEqual(result.effect, {kind: 'pulse', originId: 1, radiusD: 4.4, maxTargets: Infinity, damage: 3});
  assert.equal(powers.active.kind, 'pulse');
  assert.equal(powers.queued.kind, 'heavy');
  const anotherBall = powers.consumeDirect(batch, 2, 100);
  assert.equal(anotherBall.damage, 3);
  assert.equal(anotherBall.effect.kind, 'pulse', 'every valid direct impact from any ball blasts');
  const repeatedOriginal = hit(powers, 1, 104);
  assert.equal(repeatedOriginal.damage, 3);
  assert.equal(repeatedOriginal.effect.kind, 'pulse', 'a separate impact on the same original blasts again');
  assert.equal(powers.active.startedAt, 100, 'later impacts cannot restart the shared timer');
  assert.equal(powers.snapshotHUD().active.secondsLeft, 6);
  powers.tick(104);
  powers.tick(104);
  assert.equal(powers.snapshotHUD().active.secondsLeft, 6, 'paused simulation time does not consume the buff');
  assert.equal(hit(powers, 1, 109.99).effect.kind, 'pulse');
  assert.equal(powers.active.kind, 'pulse');
  powers.tick(110);
  assert.equal(powers.active.kind, 'heavy', 'FIFO advances at the duration boundary without another impact');
  assert.equal(powers.queued, null);
  assert.equal(powers.consumeDirect(batch, 3, 110).damage, 1);
  assert.equal(powers.active.kind, 'heavy', 'a stale Pulse batch cannot spend the newly armed queue');
  assert.equal(hit(powers, 3, 110).damage, 3);
  assert.equal(powers.active, null);
});

test('Queued Pulse keeps its own full duration and the HUD shows seconds while ready/active', () => {
  const {world, controller} = makeWorld();
  controller.collect('heavy');
  controller.collect('pulse');
  controller.tick(50);
  world.updateHUD();
  assert.match(textOf(world.hud), /NEXT · Pulse · 10s/);
  const batch = controller.capture();
  controller.consumeDirect(batch, 1, 50);
  controller.consumeDirect(batch, 2, 50);
  assert.equal(controller.active.kind, 'pulse');
  assert.equal(controller.active.startedAt, null);
  world.updateHUD();
  assert.match(textOf(world.hud), /PULSE · HIT GLASS · 10s/);
  assert.equal(hit(controller, 3, 70).effect.kind, 'pulse');
  controller.tick(73);
  world.updateHUD();
  assert.match(textOf(world.hud), /PULSE · ACTIVE · 7s/);
  assert.match(controller.snapshotHUD().active.description, /10 seconds/);
  controller.tick(80);
  assert.equal(controller.active, null);
});

test('Pierce waits for first impact, hits unlimited distinct originals, then exits safely', () => {
  const powers = new BonusController();
  powers.collect('pierce');
  powers.collect('heavy');
  powers.tick(100);
  assert.equal(powers.snapshotHUD().active.secondsLeft, 10);
  assert.equal(powers.snapshotHUD().active.remaining, null);
  const batch = powers.capture();
  for (let id = 0; id < 100; id++) {
    const result = powers.consumeDirect(batch, id, 100 + id / 100);
    assert.equal(result.damage, 8);
    assert.equal(result.suppressReflection, true);
    assert.equal(result.pierceExit, false);
  }
  assert.equal(hit(powers, 1, 102).damage, 0, 'a previously hit original is not hit twice');
  powers.tick(109.99);
  assert.equal(powers.pierceExit, false);
  powers.tick(110);
  assert.equal(powers.pierceExit, true);
  assert.equal(hit(powers, 101, 110).damage, 0);
  assert.equal(powers.active.kind, 'pierce');
  assert.equal(powers.finishPierceExit(), true);
  assert.equal(powers.suppressReflection, false);
  assert.equal(powers.active.kind, 'heavy');
  assert.equal(powers.finishPierceExit(), false);
});

test('Frost marks without a hit cap for 10s, with per-impact brittle expiry', () => {
  const powers = new BonusController();
  powers.collect('frost');
  powers.collect('heavy');
  powers.tick(80);
  assert.equal(powers.snapshotHUD().active.secondsLeft, 10);
  for (let id = 0; id < 50; id++) {
    const result = hit(powers, id, 80 + id / 10);
    assert.equal(result.damage, 1);
    assert.equal(result.effect.kind, 'frost');
  }
  assert.equal(powers.active.kind, 'frost');
  assert.equal(powers.frostMarks.size, 50);
  const brittle = hit(powers, 0, 85);
  assert.equal(brittle.damage, 2);
  assert.equal(brittle.frostConsumed, true);
  assert.equal(brittle.effect, null);
  assert.equal(powers.frostMarks.has(0), false);
  assert.equal(hit(powers, 0, 86).effect.expiresAt, 96, 'a surviving original can be marked again');
  powers.tick(90);
  assert.equal(powers.active.kind, 'heavy');
  assert.equal(powers.frostMarks.has(49), true, 'later marks outlive activation until their own expiry');
  assert.equal(hit(powers, 49, 90).damage, 4, 'queued Heavy consumes brittle as one bonus damage');
  powers.tick(96);
  assert.equal(powers.frostMarks.size, 0);
});

test('Repeated Split shares normal FIFO slots and multiplies every live ball 1→3→9→27', () => {
  const powers = new BonusController();
  assert.equal(powers.collect('split').slot, 'active');
  assert.equal(powers.collect('split').slot, 'queued');
  assert.equal(powers.collect('split').accepted, false, 'only a full inventory rejects the pickup');
  const batch = powers.capture();
  const result = powers.consumeDirect(batch, 1, 5);
  let liveBalls = 1;
  const multiply = effect => {
    assert.equal(effect.sourceType, 'all-live-balls');
    liveBalls += liveBalls * effect.echoCount;
  };
  multiply(result.effect);
  assert.equal(liveBalls, 3);
  assert.equal(result.effect.persistent, true);
  assert.equal('duration' in result.effect, false);
  assert.equal('hitsPerEcho' in result.effect, false);
  assert.equal(powers.active.kind, 'split');
  assert.equal(powers.splitActive, true);
  assert.equal(powers.consumeDirect(batch, 2, 5).effect, null);
  assert.equal(powers.active.startedAt, null);
  assert.equal(powers.collect('split').slot, 'queued', 'live extra balls do not block collecting another Split');
  multiply(hit(powers, 3, 6).effect);
  assert.equal(liveBalls, 9);
  assert.equal(powers.active.kind, 'split');
  assert.equal(powers.collect('heavy').slot, 'queued');
  const third = hit(powers, 4, 7);
  multiply(third.effect);
  assert.equal(liveBalls, 27);
  assert.equal(powers.active.kind, 'heavy');
  assert.equal(powers.splitActivationId, third.effect.activationId);
  assert.equal(powers.collect('halo').accepted, true);
  powers.tick(1_000);
  assert.equal(powers.splitActive, true, 'live extra balls have no timer');
  assert.equal(powers.finishSplit(result.effect.activationId), true, 'the last surviving extra ball may belong to an older activation');
  assert.equal(powers.splitActive, false);
  assert.equal(powers.splitActivationId, null);
  assert.equal(powers.finishSplit(), false);
  assert.equal(powers.active.kind, 'heavy', 'ending extra balls does not advance FIFO');
  assert.equal(powers.collect('split').slot, 'queued');
  assert.equal(powers.collect('split').accepted, false);
});

test('Different balls use one contact snapshot, shared Pierce deduplication and shared Frost marks', () => {
  const powers = new BonusController();
  powers.collect('pierce');
  powers.collect('frost');
  const sharedPierceBatch = powers.capture();
  const mainHit = powers.consumeDirect(sharedPierceBatch, 40, 0);
  const extraSameOriginal = powers.consumeDirect(sharedPierceBatch, 40, 0);
  const extraOtherOriginal = powers.consumeDirect(sharedPierceBatch, 41, 0);
  assert.equal(mainHit.damage, 8);
  assert.equal(extraSameOriginal.damage, 0);
  assert.equal(extraOtherOriginal.damage, 8);
  for (const result of [mainHit, extraSameOriginal, extraOtherOriginal]) assert.equal(result.suppressReflection, true);
  powers.tick(10);
  assert.equal(powers.consumeDirect(powers.capture(), 42, 10).damage, 0);
  powers.finishPierceExit();
  const sharedFrostBatch = powers.capture();
  assert.equal(powers.consumeDirect(sharedFrostBatch, 43, 10).effect.kind, 'frost');
  const anotherBallHit = powers.consumeDirect(sharedFrostBatch, 43, 10);
  assert.equal(anotherBallHit.damage, 2);
  assert.equal(anotherBallHit.frostConsumed, true);
  assert.equal(powers.frostMarks.has(43), false);
});

test('Arc and Tornado describe the strengthened effects while gravity keeps its internal ID', () => {
  const powers = new BonusController();
  powers.collect('arc');
  assert.deepEqual(hit(powers, 10, 1).effect, {kind: 'arc', originId: 10, radiusD: 4.4, targetType: 'bottom-support-original', damage: 1});
  assert.equal(powers.active, null, 'Arc remains one discharge');
  assert.equal(BONUS_DEFS.arc.arenaWide, undefined);
  assert.match(BONUS_DEFS.arc.description, /chaining within 4\.4 ball diameters/);
  assert.equal(powers.collect('gravity').message, 'Tornado ready');
  assert.equal(powers.snapshotHUD().active.name, 'Tornado');
  assert.equal(powers.snapshotHUD().active.kind, 'gravity');
  assert.match(powers.snapshotHUD().active.description, /Spins nearby cubes.*4 seconds/);
  assert.deepEqual(hit(powers, 11, 2).effect, {kind: 'gravity', originId: 11, radiusD: 6, duration: 4, maxTargets: 12, accelerationD: 35, maxDeltaSpeedD: 24, targetType: 'intact-cube'});
  assert.equal(BONUS_DEFS.split.duration, undefined);
  assert.equal(BONUS_DEFS.split.hitsPerEcho, undefined);
});

test('Bomb has bounded automatic floor-effect tuning and never occupies inventory', () => {
  const def = BONUS_DEFS.bomb;
  assert.equal(def.kind, 'bomb');
  assert.equal(def.name, 'Bomb');
  assert.equal(def.color, 0xff9438);
  assert.equal(def.colorCss, '#FF9438');
  assert.equal(def.automatic, true);
  assert.equal(def.countdown, 5);
  assert.equal(def.radiusD, 4.4);
  assert.equal(def.damage, 8);
  assert.equal(def.maxBallSpeed, 30);
  assert.equal(def.kickSpeed, 22);
  const powers = new BonusController();
  const rejection = {accepted: false, slot: null, message: 'Bomb is automatic and does not use inventory'};
  assert.deepEqual(powers.collect('bomb'), rejection);
  assert.equal(powers.active, null);
  assert.equal(powers.queued, null);
  powers.collect('pulse');
  powers.collect('heavy');
  powers.collect('halo');
  const before = powers.snapshotHUD();
  assert.deepEqual(powers.collect('bomb'), rejection);
  assert.deepEqual(powers.snapshotHUD(), before, 'automatic bombs cannot replace powers or spend Halo');
});

test('Black Hole triggers one force-only effect and immediately advances the shared FIFO', () => {
  const powers = new BonusController();
  assert.equal(powers.collect('blackhole').slot, 'active');
  assert.equal(powers.snapshotHUD().active.name, 'Black Hole');
  assert.equal(powers.snapshotHUD().active.remaining, 1);
  assert.equal(powers.snapshotHUD().active.secondsLeft, null, 'the six-second world effect does not hold the inventory slot');
  powers.collect('heavy');
  const batch = powers.capture();
  const result = powers.consumeDirect(batch, 15, 12);
  assert.equal(result.damage, 1, 'the triggering ball retains its ordinary direct impact');
  assert.deepEqual(result.effect, {kind: 'blackhole', originId: 15, duration: 6, radiusD: 8,
    rampDuration: 2, acceleration: 50, speedCap: 14, maxTargets: 64});
  assert.equal('damage' in result.effect, false, 'Black Hole itself does not directly damage targets');
  assert.equal(result.consumed, true);
  assert.equal(powers.active.kind, 'heavy');
  const sameBatch = powers.consumeDirect(batch, 16, 12);
  assert.equal(sameBatch.damage, 1);
  assert.equal(sameBatch.effect, null);
  assert.equal(powers.active.kind, 'heavy');
  assert.equal(hit(powers, 17, 12.1).damage, 3);
  assert.equal(powers.active, null);
});

test('Halo remains independent and reset clears all powers and stale contact tokens', () => {
  const powers = new BonusController();
  powers.collect('split');
  hit(powers, 0, 1);
  powers.collect('pierce');
  powers.collect('arc');
  powers.collect('halo');
  assert.equal(powers.collect('halo').accepted, false);
  assert.equal(powers.consumeHalo(), true);
  assert.equal(powers.consumeHalo(), false);
  const stale = powers.capture();
  powers.reset();
  assert.equal(powers.consumeDirect(stale, 100, 2).damage, 0);
  assert.equal(powers.active, null);
  assert.equal(powers.queued, null);
  assert.equal(powers.halo, false);
  assert.equal(powers.splitActive, false);
  assert.equal(powers.splitActivationId, null);
  assert.equal(powers.frostMarks.size, 0);
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

test('Section reset preserves powers/FIFO/Halo and timers, while clearing physical pickups', () => {
  const {world, controller} = makeWorld();
  controller.collect('split');
  hit(controller, 1, 1);
  controller.collect('frost');
  hit(controller, 2, 20);
  controller.collect('pierce');
  controller.collect('halo');
  controller.tick(23);
  const before = controller.snapshotHUD();
  world.release({id: 40, bonus: 'pulse'});
  assert.equal(world.pickups.length, 1);
  world.reset({preservePowers: true});
  assert.deepEqual(controller.snapshotHUD(), before);
  assert.equal(world.pickups.length, 0);
  controller.tick(23);
  assert.equal(controller.snapshotHUD().active.secondsLeft, 7);
  world.reset({run: true});
  assert.equal(controller.active, null);
  assert.equal(controller.queued, null);
  assert.equal(controller.halo, false);
  assert.equal(controller.splitActive, false);
});

test('HUD uses timed seconds and persistent Split text rather than spent charges', () => {
  const {world, controller} = makeWorld();
  controller.collect('split');
  hit(controller, 1, 0);
  controller.collect('pierce');
  controller.collect('frost');
  world.updateHUD();
  assert.match(textOf(world.hud), /PIERCE · HIT GLASS · 10s/);
  assert.match(textOf(world.hud), /NEXT · Frost · 10s/);
  assert.match(textOf(world.hud), /SPLIT · EXTRA BALLS LIVE/);
  assert.doesNotMatch(textOf(world.hud), /SPLIT[^∩]*10s/);
  hit(controller, 2, 0);
  controller.tick(3);
  world.updateHUD();
  assert.match(textOf(world.hud), /PIERCE · ACTIVE · 7s/);
  controller.tick(10);
  world.updateHUD();
  assert.match(textOf(world.hud), /PIERCE · EXITING/);
  controller.finishPierceExit();
  hit(controller, 3, 10);
  controller.tick(12);
  world.updateHUD();
  assert.match(textOf(world.hud), /FROST · MARKING · 8s/);
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
 for(const kind of Object.keys(BONUS_DEFS).filter(kind=>!BONUS_DEFS[kind].automatic)){const {world,controller}=makeWorld();world.release({id:1,bonus:kind});const item=world.pickups[0];assert.equal(item.scale,.38*2*1.3);assert(item.height>=.1);item.landed=true;item.p.set(0,item.height,1);world.update(.4,new THREE.Vector3(1,item.height,1),new THREE.Vector3(1,0,0),true,new Map());assert.equal(world.pickups.length,0,kind+' collects one world unit away');assert(controller.active||controller.halo);}
 });

test('Simultaneous main and extra pickup contact awards the item exactly once',()=>{const {world,controller}=makeWorld();world.release({id:9,bonus:'pulse'});const item=world.pickups[0];item.landed=true;item.p.set(0,item.height,1);const p=item.p.clone(),v=new THREE.Vector3(1,0,0);let count=0;const collect=controller.collect.bind(controller);controller.collect=kind=>{count++;return collect(kind);};world.update(.01,p,v,true,new Map(),[{id:12,p:p.clone(),v},{id:13,p:p.clone(),v}]);assert.equal(count,1);assert.equal(world.pickups.length,0);assert.equal(controller.active.kind,'pulse');assert.equal(controller.queued,null);});
test('Extra pickup sweeps keep independent histories and cannot bridge between balls',()=>{const {world,controller}=makeWorld();world.release({id:9,bonus:'heavy'});const item=world.pickups[0];item.landed=true;item.p.set(0,item.height,1);const v=new THREE.Vector3(1,0,0),main=new THREE.Vector3(0,.38,8);world.update(.01,main,v,false,new Map(),[{id:12,p:new THREE.Vector3(-3,item.height,1),v},{id:13,p:new THREE.Vector3(3,item.height,1),v}]);world.update(.01,main,v,false,new Map(),[{id:12,p:new THREE.Vector3(-2.8,item.height,1),v},{id:13,p:new THREE.Vector3(2.8,item.height,1),v}]);assert.equal(world.pickups.length,1);world.update(.01,main,v,false,new Map(),[{id:12,p:item.p.clone(),v}]);assert.equal(world.pickups.length,0);assert.equal(controller.active.kind,'heavy');});

test('Automatic Bomb starts five-second fuse only on landing, pauses and explodes exactly once',()=>{
 const {world,controller}=makeWorld();let explosions=0;world.onBomb=()=>explosions++;
 world.release({id:'bomb-check',bonus:'bomb',bonusPose:{p:new THREE.Vector3(0,2,-2),q:new THREE.Quaternion(),v:new THREE.Vector3()}});
 const item=world.pickups[0],ball=new THREE.Vector3(0,.38,-2),velocity=new THREE.Vector3(0,0,10);
 for(let i=0;i<300&&!item.landed;i++){world.update(.01,ball,velocity,true,new Map());assert.equal(item.fuseRemaining,5);}
 assert(item.landed);assert(item.timerRing);assert.equal(controller.active,null);
 for(let i=0;i<100;i++)world.update(.01,ball,velocity,true,new Map(),[],true);
 assert.equal(item.fuseRemaining,5);assert.equal(explosions,0);
 for(let i=0;i<499;i++)world.update(.01,ball,velocity,true,new Map());
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
