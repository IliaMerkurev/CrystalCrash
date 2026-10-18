import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { SecondaryPowers } from '../src/secondary-powers.js';
import { BlackHoleImpactGuard } from '../src/blackhole-impact-guard.js';
await RAPIER.init();
function fixture(run){
 const world=new RAPIER.World({x:0,y:-18,z:0});world.timestep=1/90;
 const blocks=new Map(),history=new Map(),contacts=new Map(),guard=new BlackHoleImpactGuard();
 const powers=new SecondaryPowers({THREE,RAPIER,scene:new THREE.Scene(),world,colliders:new Map(),radius:.38});
 const cube=(id,x=0,y=2)=>{
  const b=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x,y,0).setCcdEnabled(true));
  const c=world.createCollider(RAPIER.ColliderDesc.cuboid(.25,.25,.25).setMass(1).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),b);
  const o={id,kind:'block',b,cs:[c],origin:{id,lastStrike:99},lastHit:99};blocks.set(id,o);return o;
 };
 const sync=()=>guard.sync(powers.blackHole,blocks,history,contacts);
 try{run({world,blocks,history,contacts,guard,powers,cube,sync});}finally{powers.dispose();world.free();}
}
test('only captured live originals are guarded; direct and explicit attacks stay caller-owned',()=>fixture(({cube,powers,blocks,guard,sync})=>{
 const a=cube(1),b=cube(2,20);powers.createBlackHole({x:0,y:2,z:0},0,blocks);sync();
 assert.equal(guard.has(1),true);assert.equal(guard.has(2),false);
 let hits=0;const damage=(o,direct)=>{if(!direct&&guard.has(o.origin.id))return false;hits++;return true;};
 assert.equal(damage(a,false),false);assert.equal(damage(a,true),true);assert.equal(damage(b,false),true);
 const explicitBonus=o=>{hits++;return o.origin.id;};assert.equal(explicitBonus(a),1);assert.equal(hits,3);
}));
test('release resets cooldowns and exact environmental groups only',()=>fixture(({cube,powers,blocks,guard,sync,history,contacts})=>{
 const a=cube(1),sibling=cube(11);sibling.origin=a.origin;
 powers.createBlackHole({x:0,y:2,z:0},0,blocks);sync();
 const groups=['cube1|table1','cube1|cube2','cube10|table1','ball|cube1','cube1|echo3','gate|cube1',null];
 groups.forEach((group,i)=>{history.set(group,{lastContact:99});contacts.set(i,{group});});
 powers.endBlackHole();sync();assert.equal(guard.has(1),false);
 assert.equal(a.origin.lastStrike,-Infinity);assert.equal(a.lastHit,-Infinity);assert.equal(sibling.lastHit,-Infinity);
 for(const group of ['cube10|table1','ball|cube1','cube1|echo3',null])assert.ok(history.has(group));
 for(const group of ['cube1|table1','cube1|cube2','gate|cube1'])assert.equal(history.has(group),false);
 assert.equal(contacts.size,4);
}));
test('range exit, invalid body, replacement and reset never retain stale protection',()=>fixture(({world,cube,powers,blocks,guard,sync})=>{
 const a=cube(1);powers.createBlackHole({x:0,y:2,z:0},0,blocks);sync();assert.ok(guard.has(1));
 a.b.setTranslation({x:30,y:2,z:0},true);sync();assert.equal(guard.has(1),false);
 a.b.setTranslation({x:0,y:2,z:0},true);sync();assert.ok(guard.has(1));
 const differentBlocks=new Map(blocks);guard.sync({...powers.blackHole,blocks:differentBlocks},blocks);assert.equal(guard.has(1),false);
 sync();const b=cube(2,20);powers.createBlackHole({x:20,y:2,z:0},1,blocks);sync();assert.equal(guard.has(1),false);assert.ok(guard.has(2));
 blocks.set(2,{...b,b:a.b});sync();assert.equal(guard.has(2),false);
 blocks.set(2,b);sync();assert.ok(guard.has(2));guard.reset();assert.equal(guard.has(2),false);
 sync();assert.ok(guard.has(2));world.removeRigidBody(b.b);sync();assert.equal(guard.has(2),false);
 powers.endBlackHole();sync();assert.equal(guard.protectedOrigins.size,0);
}));
test('real Rapier floor/cube impacts are harmless during pull; released cube can land normally',()=>fixture(({world,cube,powers,blocks,guard,sync})=>{
 const floor=world.createCollider(RAPIER.ColliderDesc.cuboid(10,.1,10).setTranslation(0,-.1,0));
 const a=cube(1,-.5,.8),b=cube(2,.5,.8);a.b.setLinvel({x:6,y:-5,z:0},true);b.b.setLinvel({x:-6,y:-5,z:0},true);
 powers.createBlackHole({x:0,y:2,z:0},0,blocks,{duration:3});
 const queue=new RAPIER.EventQueue(true);let protectedContacts=0,damages=0,landing=false;
 const byHandle=new Map([[a.cs[0].handle,a],[b.cs[0].handle,b]]);
 const drain=()=>queue.drainCollisionEvents((h1,h2,start)=>{if(!start)return;for(const h of [h1,h2]){const o=byHandle.get(h);if(!o)continue;if(guard.has(o.origin.id)){protectedContacts++;continue;}damages++;if(h1===floor.handle||h2===floor.handle)landing=true;}});
 for(let i=0;i<180;i++){powers.stepBlackHole(1/90,i/90);sync();world.step(queue);drain();}
 assert.ok(protectedContacts>0,'actual collision events occurred during pull');assert.equal(damages,0);
 powers.endBlackHole();sync();assert.equal(a.lastHit,-Infinity);assert.equal(a.origin.lastStrike,-Infinity);
 for(let i=0;i<270;i++){world.step(queue);drain();}
 assert.ok(landing,'gravity produces a fresh valid landing after release');assert.ok(damages>0);queue.free();
}));
test('overlapping Tornado and Black Hole retain immunity until final capture release',()=>fixture(({cube,powers,blocks,guard,history,contacts})=>{
 const a=cube(1),b=cube(2,1);powers.createBlackHole({x:0,y:2,z:0},0,blocks);
 const tornado={kind:'tornado',active:true,blocks,point:{x:0,y:0,z:0},range:.1,targets:[{id:a.id,body:a.b,handle:a.b.handle}]};
 guard.sync([powers.blackHole,tornado],blocks,history,contacts);assert(guard.has(1)&&guard.has(2));
 powers.endBlackHole();guard.sync([null,tornado],blocks,history,contacts);assert(guard.has(1));assert(!guard.has(2));
 a.lastHit=99;a.origin.lastStrike=99;history.set('cube1|table1',99);contacts.set('pair',{group:'cube1|cube2'});
 tornado.targets=[];guard.sync([null,tornado],blocks,history,contacts);assert(!guard.has(1));assert.equal(a.lastHit,-Infinity);assert.equal(a.origin.lastStrike,-Infinity);assert.equal(history.size,0);assert.equal(contacts.size,0);
}));
