import test from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import {rollingContactMix} from '../src/rolling-contact-mix.js';
await RAPIER.init();
function fixture(run){const world=new RAPIER.World({x:0,y:-18,z:0});world.timestep=1/90;const metadata=new Map();const floor=world.createCollider(RAPIER.ColliderDesc.cuboid(20,.1,20).setTranslation(0,-.1,0));metadata.set(floor.handle,{kind:'table'});const make=(x,y)=>{const b=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x,y,0));world.createCollider(RAPIER.ColliderDesc.ball(.38).setFriction(0),b);return b;};try{run({world,metadata,make});}finally{world.free();}}
test('only actual grounded free balls contribute, with audible scaled speed',()=>fixture(({world,metadata,make})=>{
 const b=make(0,.38),air=make(5,5);for(let i=0;i<4;i++)world.step();b.setLinvel({x:10,y:0,z:0},true);air.setLinvel({x:20,y:0,z:0},true);
 const normal=rollingContactMix(world,metadata,[b,air]);assert.equal(normal.count,1);assert.equal(normal.speed,10);
 assert.equal(rollingContactMix(world,metadata,[b],.1).speed,1);assert.equal(rollingContactMix(world,metadata,[b],.3).speed,3);
 b.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased,true);assert.equal(rollingContactMix(world,metadata,[b]).count,0);
}));
test('many balls retain bounded mix, stationary and unsupported contacts stay quiet',()=>fixture(({world,metadata,make})=>{
 const bodies=Array.from({length:27},(_,i)=>make((i-13)*1.2,.38));for(let i=0;i<4;i++)world.step();for(const b of bodies)b.setLinvel({x:12,y:0,z:0},true);
 const mix=rollingContactMix(world,metadata,bodies);assert.equal(mix.count,27);assert.equal(mix.speed,12);assert(mix.intensity<=1);
 for(const b of bodies)b.setLinvel({x:0,y:0,z:0},true);assert.equal(rollingContactMix(world,metadata,bodies).intensity,0);
 metadata.clear();assert.equal(rollingContactMix(world,metadata,bodies).count,0);
}));
