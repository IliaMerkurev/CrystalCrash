import test from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import {CaptureCollisionProxy} from '../src/capture-collision-proxy.js';
import {BlackHoleRelease} from '../src/blackhole-release.js';
import {BlackHoleImpactGuard} from '../src/blackhole-impact-guard.js';
import {SecondaryPowers} from '../src/secondary-powers.js';
await RAPIER.init();
function fixture(run,n=16){const world=new RAPIER.World({x:0,y:0,z:0}),blocks=new Map(),colliders=new Map();
 const proxyManager=new CaptureCollisionProxy({RAPIER,world,colliders}),release=new BlackHoleRelease({proxyManager});
 for(let i=0;i<n;i++){const b=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(2,i*.2,0));const c=world.createCollider(RAPIER.ColliderDesc.cuboid(.1,.1,.1).setMass(2).setCollisionGroups(0x0004001f),b);const o={id:i,kind:'block',b,cs:[c],origin:{id:i}};blocks.set(i,o);colliders.set(c.handle,o);}
 const hole={active:true,expires:3,point:{x:0,y:0,z:0},radius:100,blocks,targets:[...blocks.values()].reverse().map(o=>({id:o.id,body:o.b,handle:o.b.handle}))};
 try{run({world,blocks,colliders,proxyManager,release,hole});}finally{release.reset();proxyManager.reset();world.free();}
}
test('natural expiry applies modest radial kick once per valid cube, never balls',()=>fixture(({blocks,release,hole})=>{
 const ball=blocks.get(0);ball.kind='ball';hole.targets.push(hole.targets[0]);release.beginNaturalExpiry(hole,2.99);assert.equal(release.pending.size,0);
 release.beginNaturalExpiry(hole,3);assert.equal(release.pending.size,15);assert.equal(ball.b.linvel().x,0);
 for(const o of [...blocks.values()].slice(1)){assert.ok(Math.abs(o.b.linvel().x-.9)<1e-6);assert.equal(o.b.linvel().y,0);}
 release.beginNaturalExpiry(hole,4);assert.ok(Math.abs(blocks.get(1).b.linvel().x-.9)<1e-6);
}));
test('bottom-first batches of eight every .15 simulation seconds, bounded even for equal heights',()=>fixture(({release,hole,blocks})=>{
 release.beginNaturalExpiry(hole,3);assert.equal(release.step(3,blocks).targets.length,64);assert.equal(release.step(3.149,blocks).targets.length,64);
 const field=release.step(3.15,blocks);assert.equal(field.targets.length,56);assert.ok(field.targets.every(t=>t.id>=8));
 assert.equal(release.step(3.15,blocks).targets.length,56);assert.equal(release.step(3.3,blocks).targets.length,48);
 for(let i=3;i<=8;i++)release.step(3+i*.15,blocks);assert.equal(release.pending.size,0);
} ,64));
test('same-height crowds and long simulation jumps never restore more than eight per step',()=>fixture(({release,hole,blocks})=>{
 for(const o of blocks.values())o.b.setTranslation({x:2,y:1,z:0},true);
 release.beginNaturalExpiry(hole,3);release.step(30,blocks);assert.equal(release.pending.size,56);release.step(30,blocks);assert.equal(release.pending.size,56);release.step(30.15,blocks);assert.equal(release.pending.size,48);
},64));
test('retained collision and damage ownership survives radius exit and overlapping Tornado',()=>fixture(({release,hole,blocks,proxyManager})=>{
 const guard=new BlackHoleImpactGuard(),tornado={...hole,kind:'tornado',targets:[hole.targets.find(t=>t.id===0)]};proxyManager.sync([hole,tornado],blocks);release.beginNaturalExpiry(hole,3);hole.active=false;
 blocks.get(8).b.setTranslation({x:200,y:2,z:0},true);
 let field=release.step(3,blocks),fields=[tornado,field];guard.sync(fields,blocks,new Map(),new Map());proxyManager.sync(fields,blocks);assert.ok(guard.has(8));assert.ok(proxyManager.entries.has(blocks.get(8)));
 field=release.step(3.15,blocks);fields=[tornado,field];guard.sync(fields,blocks,new Map(),new Map());proxyManager.sync(fields,blocks);assert.ok(proxyManager.entries.has(blocks.get(0)));assert.ok(guard.has(0));assert.ok(!guard.has(1));assert.equal(blocks.get(1).cs[0].collisionGroups(),0x0004001f);
 release.step(3.3,blocks);guard.sync([tornado],blocks,new Map(),new Map());proxyManager.sync([tornado],blocks);assert.equal(proxyManager.entries.size,1);
}));
test('deletion, fracture replacement and reset clean retained owners immediately',()=>fixture(({release,hole,blocks,proxyManager,world})=>{
 proxyManager.sync([hole],blocks);release.beginNaturalExpiry(hole,3);release.step(3,blocks);const o=blocks.get(0);release.release(o);proxyManager.release(o);world.removeRigidBody(o.b);blocks.delete(o.id);assert.equal(release.pending.size,15);
 const removed=blocks.get(1);world.removeRigidBody(removed.b);blocks.delete(removed.id);release.step(3.01,blocks);assert.equal(release.pending.size,14);
 release.reset();proxyManager.reset();assert.equal(release.step(4,blocks),null);assert.equal(proxyManager.entries.size,0);assert.equal(world.colliders.len(),14);
}));
test('secondary callback runs only on natural expiry, before friction/target cleanup',()=>fixture(({release,hole,blocks,world})=>{
 const powers=Object.create(SecondaryPowers.prototype);Object.assign(powers,{world,RAPIER,radius:.38,frictionLeases:new Map(),blackHole:hole,onBlackHoleExpire:(h,now)=>{assert.equal(h.active,true);assert.equal(powers.blackHole,h);release.beginNaturalExpiry(h,now);}});
 for(const target of hole.targets)target.friction=powers.acquireFriction(blocks.get(target.id).cs,target);
 powers.stepBlackHole(1/90,3);assert.equal(powers.blackHole,null);assert.equal(release.pending.size,16);assert.equal(powers.frictionLeases.size,0);const v=blocks.get(0).b.linvel().x;powers.stepBlackHole(1/90,4);assert.equal(blocks.get(0).b.linvel().x,v);
 release.reset();powers.blackHole={...hole,active:true};powers.endBlackHole();assert.equal(release.pending.size,0);assert.equal(blocks.get(0).b.linvel().x,v);
}));

test('release schedule follows running physics independently of paused power clock',()=>fixture(({release,hole,blocks})=>{
 release.beginNaturalExpiry(hole,2.9,40);assert.equal(release.pending.size,0,'expiry still uses power clock');
 release.beginNaturalExpiry(hole,3,40);assert.equal(release.pending.size,16);
 assert.equal(release.step(40.149,blocks).targets.length,16);
 assert.equal(release.step(40.15,blocks).targets.length,8);
 assert.equal(release.step(40.30,blocks),null,'physics advances restoration while power clock remains 3');
}));
