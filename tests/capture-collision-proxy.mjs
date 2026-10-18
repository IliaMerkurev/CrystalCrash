import test from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import {CaptureCollisionProxy} from '../src/capture-collision-proxy.js';
await RAPIER.init();
function fixture(run){
 const world=new RAPIER.World({x:0,y:0,z:0}),colliders=new Map(),blocks=new Map(),manager=new CaptureCollisionProxy({RAPIER,world,colliders});
 const b=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(1,2,3));
 const cs=[-.6,.6].map(x=>world.createCollider(RAPIER.ColliderDesc.cuboid(.15,.5,.3).setTranslation(x,0,0).setMass(x<0?2:3).setCollisionGroups(0x0004001f).setSolverGroups(0x0004001f).setFriction(.65),b));
 const o={id:1,kind:'block',b,cs,origin:{id:1}};blocks.set(1,o);cs.forEach(c=>colliders.set(c.handle,o));
 const target={id:1,body:b,handle:b.handle};const hole={active:true,blocks,point:{x:1,y:2,z:3},radius:20,targets:[target]},well={...hole,kind:'tornado'};
 try{run({world,colliders,blocks,manager,o,hole,well});}finally{manager.reset();world.free();}
}
const approx=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);
const props=b=>({mass:b.mass(),com:{...b.localCom()},inertia:{...b.principalInertia()},frame:{...b.principalInertiaLocalFrame()}});
function assertProps(a,b){for(const k of Object.keys(a))if(typeof a[k]==='number')approx(a[k],b[k]);else for(const j of Object.keys(a[k]))approx(a[k][j],b[k][j]);}
test('capture preserves body, precise geometry, mass, COM, inertia and solver groups',()=>fixture(({manager,o,world,blocks,hole,colliders})=>{
 const before=props(o.b),cs=[...o.cs];manager.sync([hole],blocks);const e=manager.entries.get(o);assert(e);assert.equal(world.bodies.len(),1);assert.equal(world.colliders.len(),3);assert.deepEqual(o.cs,cs);assert.equal(colliders.get(e.proxy.handle),o);assert.equal(e.proxy.mass(),0);assertProps(before,props(o.b));
 assert.equal(e.proxy.collisionGroups(),0x00040005);assert.equal(e.proxy.solverGroups(),0x00040005);approx(e.proxy.halfExtents().x,.75);
 for(const c of cs){assert.equal(c.collisionGroups(),0x00040012);assert.equal(c.solverGroups(),0x0004001f);}
 manager.reset();assert.equal(world.colliders.len(),2);for(const c of cs)assert.equal(c.collisionGroups(),0x0004001f);assertProps(before,props(o.b));
}));
test('shared ownership, friction mirroring, final restoration, and idempotent release',()=>fixture(({manager,o,blocks,hole,well,world})=>{
 o.cs.forEach(c=>{c.setFriction(0);c.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min);});manager.sync([hole,well],blocks);const proxy=manager.entries.get(o).proxy;
 assert.equal(manager.entries.get(o).owners.size,2);assert.equal(proxy.friction(),0);assert.equal(proxy.frictionCombineRule(),RAPIER.CoefficientCombineRule.Min);
 manager.sync([null,well],blocks);assert.equal(manager.entries.get(o).proxy,proxy);assert.equal(manager.entries.get(o).owners.size,1);
 o.cs.forEach(c=>c.setFriction(.65));manager.sync([],blocks);assert.equal(world.colliders.len(),2);approx(o.cs[0].friction(),.65);manager.release(o);manager.reset();
}));
test('stale bodies, inactive fields, range exit and destroyed-body cleanup are safe',()=>fixture(({manager,o,blocks,hole,world})=>{
 manager.sync([{...hole,targets:[{...hole.targets[0],handle:123}]}],blocks);assert.equal(manager.entries.size,0);
 manager.sync([{...hole,active:false}],blocks);assert.equal(manager.entries.size,0);
 manager.sync([hole],blocks);o.b.setTranslation({x:100,y:2,z:3},true);manager.sync([hole],blocks);assert.equal(manager.entries.size,0);
 o.b.setTranslation({x:1,y:2,z:3},true);manager.sync([hole],blocks);world.removeRigidBody(o.b);blocks.delete(o.id);manager.sync([],blocks);assert.equal(manager.entries.size,0);
}));
test('ball and echo cross visible gap; environment contacts coarse proxy',()=>fixture(({manager,o,blocks,hole,world})=>{
 manager.sync([hole],blocks);world.step();
 // A ray through the open center must not hit the proxy for either ball group.
 for(const membership of [2,16]){
  const groups=(membership<<16)|4;
  assert.equal(world.castRay(new RAPIER.Ray({x:1,y:2,z:1},{x:0,y:0,z:1}),5,true,undefined,groups),null);
  const hit=world.castRay(new RAPIER.Ray({x:1.6,y:2,z:1},{x:0,y:0,z:1}),5,true,undefined,groups);assert(hit);assert.ok(o.cs.includes(hit.collider));
 }
 const environmentHit=world.castRay(new RAPIER.Ray({x:1,y:2,z:1},{x:0,y:0,z:1}),5,true,undefined,0x00040004);assert.equal(environmentHit.collider,manager.entries.get(o).proxy);
}));
test('new cluster replacing a captured body is not captured through stale identity',()=>fixture(({manager,o,blocks,hole,world})=>{
 manager.sync([hole],blocks);const replacement={...o,b:world.createRigidBody(RAPIER.RigidBodyDesc.dynamic())};blocks.set(o.id,replacement);manager.sync([hole],blocks);assert.equal(manager.entries.size,0);for(const c of o.cs)assert.equal(c.collisionGroups(),0x0004001f);
}));
test('convex bounds and shifted mass distribution remain unchanged',()=>fixture(({manager,o,world,blocks,hole})=>{
 for(const c of o.cs)world.removeCollider(c,true);
 const points=new Float32Array([-1,0,0,-.2,0,0,-1,.7,0,-1,0,.4]);
 const c=world.createCollider(RAPIER.ColliderDesc.convexHull(points).setMass(3).setTranslation(.1,.2,.3).setCollisionGroups(0x0004001f),o.b);o.cs=[c];o.b.recomputeMassPropertiesFromColliders();const before=props(o.b);
 manager.sync([hole],blocks);const proxy=manager.entries.get(o).proxy;approx(proxy.halfExtents().x,.4);approx(proxy.translationWrtParent().x,-.5);assertProps(before,props(o.b));
 manager.release(o);assertProps(before,props(o.b));
}));
test('stepped main and extra balls bounce off precise panels and traverse missing glass',()=>{
 for(const membership of [2,16])for(const panel of [false,true])fixture(({manager,o,blocks,hole,world})=>{
  o.cs.forEach(c=>c.setRestitution(1));manager.sync([hole],blocks);
  const b=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(panel?1.6:1,2,1).setLinvel(0,0,6).setCcdEnabled(true));
  const c=world.createCollider(RAPIER.ColliderDesc.ball(.08).setMass(.05).setRestitution(1).setCollisionGroups((membership<<16)|4).setSolverGroups((membership<<16)|4).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),b);
  const queue=new RAPIER.EventQueue(true),hits=[];world.timestep=1/90;
  for(let i=0;i<60;i++){world.step(queue);queue.drainCollisionEvents((a,d,start)=>{if(start&&(a===c.handle||d===c.handle))hits.push(a===c.handle?d:a);});}
  if(panel){assert.ok(b.linvel().z<0,'ball bounces off surviving panel');assert.ok(hits.some(h=>o.cs.some(c=>c.handle===h)));}
  else{assert.ok(b.translation().z>4.5,'ball travels through missing center');assert.equal(hits.length,0);}
  assert.ok(!hits.includes(manager.entries.get(o).proxy.handle));queue.free();
 });
});
test('repeated captures/reset preserve counts and velocity; release restores precise environmental contacts',()=>fixture(({manager,o,blocks,hole,world,colliders})=>{
 o.b.setLinvel({x:.1,y:.2,z:.3},true);o.b.setAngvel({x:.3,y:.2,z:.1},true);const before=props(o.b),v={...o.b.linvel()},av={...o.b.angvel()};
 for(let i=0;i<30;i++){manager.sync([hole],blocks);assert.equal(world.colliders.len(),3);manager.reset();assert.equal(world.colliders.len(),2);assert.equal(world.bodies.len(),1);assert.equal(colliders.size,2);}
 assertProps(before,props(o.b));assert.deepEqual({...o.b.linvel()},v);assert.deepEqual({...o.b.angvel()},av);
 o.b.setLinvel({x:0,y:0,z:0},true);o.b.setAngvel({x:0,y:0,z:0},true);
 const environment=world.createRigidBody(RAPIER.RigidBodyDesc.fixed());const ec=world.createCollider(RAPIER.ColliderDesc.cuboid(.12,.12,.12).setTranslation(1.6,2,3).setCollisionGroups(0x00010004),environment);
 world.step();let contact=false;for(const c of o.cs)world.contactPair(c,ec,m=>{if(m.numContacts())contact=true;});assert.ok(contact,'released original panels contact environment');
}));
test('direct-hit replacement releases old proxy before body removal; new cluster stays precise until recaptured',()=>fixture(({manager,o,blocks,hole,world,colliders})=>{
 manager.sync([hole],blocks);manager.release(o);assert.equal(world.colliders.len(),2);assert.equal(colliders.size,2);for(const c of o.cs)colliders.delete(c.handle);world.removeRigidBody(o.b);
 const b=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(1,2,3));const c=world.createCollider(RAPIER.ColliderDesc.cuboid(.1,.3,.2).setCollisionGroups(0x0004001f),b),next={id:2,kind:'block',b,cs:[c],origin:o.origin};blocks.delete(o.id);blocks.set(next.id,next);colliders.set(c.handle,next);
 manager.sync([hole],blocks);assert.equal(manager.entries.size,0);assert.equal(c.collisionGroups(),0x0004001f);assert.equal(world.colliders.len(),1);
 hole.targets=[{id:next.id,body:b,handle:b.handle}];manager.sync([hole],blocks);assert.equal(manager.entries.size,1);assert.equal(world.colliders.len(),2);manager.reset();assert.equal(world.colliders.len(),1);assert.equal(world.bodies.len(),1);
}));
