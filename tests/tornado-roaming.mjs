import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {SecondaryPowers} from '../src/secondary-powers.js';
await RAPIER.init();
const bounds={top:-8,bottom:10,lowerZoneZ:5,tableHalf:()=>6};
function fixture(run){
 const world=new RAPIER.World({x:0,y:-9.81,z:0});world.timestep=1/120;
 const powers=new SecondaryPowers({THREE,RAPIER,scene:new THREE.Scene(),world,colliders:new Map(),radius:.38}),blocks=new Map();
 const cube=(id,x=1,y=.5,z=0,kind='block',origin=id)=>{
  const b=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x,y,z));
  const c=world.createCollider(RAPIER.ColliderDesc.cuboid(.2,.2,.2).setMass(1).setFriction(.8),b);
  const o={id,kind,b,cs:[c],origin:{id:origin}};blocks.set(id,o);return o;
 };
 const advance=(from,to)=>{for(let time=from+1/120;time<=to+1e-8;time+=1/120){powers.step(1/120,time,bounds);world.step();}};
 try{run({powers,world,blocks,cube,advance});}finally{powers.dispose();world.free();}
}
test('smooth upper-arena route moves, acquires new cubes, and keeps balls untouched',()=>fixture(({powers,blocks,cube,advance})=>{
 const ball=cube(2,0,.5,0,'ball'),well=powers.createWell({x:0,y:.5,z:0},0,blocks,{random:()=>.15});
 assert.equal(well.kind,'tornado');assert.equal(well.targets.length,0);
 let previous={...well.point},distance=0;
 for(let i=1;i<=300;i++){
  advance((i-1)/120,i/120);
  const moved=Math.hypot(well.point.x-previous.x,well.point.z-previous.z);assert.ok(moved<.05,'bounded smooth motion');distance+=moved;previous={...well.point};
  assert.ok(Math.abs(well.point.x)<6&&well.point.z>=-8&&well.point.z<5);
 }
 assert.ok(distance>5);assert.equal(ball.b.linvel().x,0);assert.equal(ball.b.linvel().z,0);
 const fresh=cube(3,well.point.x,.5,well.point.z);advance(2.5,2.55);assert.ok(well.targets.some(t=>t.body===fresh.b));
 assert.equal(powers.wellMesh.position.x,well.point.x);
}));
test('captures spin and lift, then ejects with finite impulse and removes guard identity',()=>fixture(({powers,blocks,cube,advance})=>{
 const block=cube(1),well=powers.createWell({x:0,y:.5,z:0},0,blocks,{random:()=>.5});
 const target=well.targets[0];assert.equal(target.body,block.b);assert.equal(block.cs[0].friction(),0);
 advance(0,.3);assert.ok(block.b.translation().y>.65,'cube rises');assert.ok(Math.abs(block.b.linvel().z)>1,'cube spins');
 advance(.3,1.2);assert.equal(well.targets.length,0,'released before contact guard sync');assert.ok(block.cs[0].friction()>.79);
 const v=block.b.linvel();assert.ok(Math.hypot(v.x,v.z)>4);assert.ok(Object.values(v).every(Number.isFinite));
 // The same original, even represented by a new fracture, is never recaptured.
 const sibling=cube(8,well.point.x,.5,well.point.z,'block',1);advance(1.2,1.3);assert.equal(well.targets.length,0);
 assert.equal(sibling.b.linvel().x,0);
}));
test('destroyed/replaced bodies release leases without acting on replacement identities',()=>fixture(({powers,world,blocks,cube,advance})=>{
 const block=cube(1),well=powers.createWell({x:0,y:.5,z:0},0,blocks,{random:()=>.5});
 world.removeRigidBody(block.b);blocks.delete(1);const replacement=cube(1);
 advance(0,.1);assert.equal(well.targets.length,0);assert.equal(powers.frictionLeases.size,0);assert.equal(replacement.b.linvel().x,0);
}));
test('friction owners overlap safely; expiry, replacement, clear, transition clean capture state',()=>fixture(({powers,blocks,cube,advance})=>{
 const block=cube(1),point={x:0,y:.5,z:0};
 const well=powers.createWell(point,0,blocks,{random:()=>.5});powers.createBlackHole(point,0,blocks);
 powers.endWell();assert.equal(well.active,false);assert.equal(well.targets.length,0);assert.equal(block.cs[0].friction(),0);
 powers.endBlackHole();assert.ok(block.cs[0].friction()>.79);
 const old=powers.createWell(point,0,blocks);powers.createWell(point,0,blocks,{duration:.1});assert.equal(old.active,false);
 advance(0,.11);assert.equal(powers.well,null);assert.equal(powers.frictionLeases.size,0);
 powers.createWell(point,.11,blocks);powers.clear();assert.equal(powers.well,null);assert.equal(powers.frictionLeases.size,0);
 powers.createWell(point,.11,blocks);powers.parkForTransition(point,bounds);assert.equal(powers.well,null);assert.equal(powers.frictionLeases.size,0);
}));
