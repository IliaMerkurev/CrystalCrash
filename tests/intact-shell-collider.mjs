import test from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import {shellPanels,wallThickness} from '../src/glass-shell.js';
import {intactShellMassProperties,intactShellColliderDesc} from '../src/intact-shell-collider.js';
import {GLASS} from '../src/config.js';
await RAPIER.init();
const approx=(a,b,label)=>assert.ok(Math.abs(a-b)<=2e-6*Math.max(1,Math.abs(a),Math.abs(b)),`${label}: ${a} != ${b}`);
const vector=(a,b,label)=>{for(const axis of ['x','y','z'])approx(a[axis],b[axis],`${label}.${axis}`);};

for(const dims of [[.88,.88,.88],[2.8,.33,.88],[.4,1.7,.65],[.22,.25,.3]])for(let type=0;type<5;type++)test(`single collider matches six-panel Rapier mass and inertia: ${dims}, tier ${type}`,()=>{
 const [sx,sy,sz]=dims,t=wallThickness(type),mass=sx*sy*sz*GLASS[type].density,world=new RAPIER.World({x:0,y:0,z:0});
 try{
  const rotation={x:.2,y:.3,z:-.1,w:Math.sqrt(.86)},old=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setRotation(rotation)),next=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setRotation(rotation));
  for(const panel of shellPanels(sx,sy,sz,t))world.createCollider(RAPIER.ColliderDesc.cuboid(...panel.size.map(n=>n/2)).setTranslation(...panel.p).setMass(mass/6),old);
  const c=world.createCollider(intactShellColliderDesc(RAPIER,sx,sy,sz,t,mass),next);
  old.recomputeMassPropertiesFromColliders();next.recomputeMassPropertiesFromColliders();
  assert.equal(old.numColliders(),6);assert.equal(next.numColliders(),1);
  approx(old.mass(),next.mass(),'mass');vector(old.localCom(),next.localCom(),'COM');
  // Rapier may permute eigenvalues and rotate the principal frame when
  // combining six bodies. Compare the spectrum AND the actual world tensor.
  const oldPrincipal=Object.values(old.principalInertia()).sort((a,b)=>a-b),nextPrincipal=Object.values(next.principalInertia()).sort((a,b)=>a-b);oldPrincipal.forEach((value,i)=>approx(value,nextPrincipal[i],'principal inertia spectrum'));
  const a=old.effectiveWorldInvInertia(),b=next.effectiveWorldInvInertia();for(const key of ['m11','m12','m13','m22','m23','m33'])approx(a[key],b[key],`world inverse inertia.${key}`);
  vector(c.halfExtents(),{x:sx/2,y:sy/2,z:sz/2},'outer bounds');
  old.applyImpulse({x:.35,y:-.27,z:.19},true);next.applyImpulse({x:.35,y:-.27,z:.19},true);
  old.applyTorqueImpulse({x:.13,y:.2,z:-.17},true);next.applyTorqueImpulse({x:.13,y:.2,z:-.17},true);
  vector(old.linvel(),next.linvel(),'impulse velocity');vector(old.angvel(),next.angvel(),'torque velocity');
 }finally{world.free();}
});

test('analytical properties retain shell inertia rather than solid cuboid inertia',()=>{
 const p=intactShellMassProperties(1,1,1,.04,6);assert.deepEqual(p.centerOfMass,{x:0,y:0,z:0});assert.ok(p.principalAngularInertia.x>1.3);assert.ok(p.principalAngularInertia.y>1.3);assert.ok(p.principalAngularInertia.z>1.3);
});
test('invalid shell inputs are rejected before creating physics objects',()=>{
 for(const args of [[0,1,1,.04,1],[1,1,1,.5,1],[1,1,1,.04,-1],[1,NaN,1,.04,1]])assert.throws(()=>intactShellMassProperties(...args),RangeError);
});

for(const [name,groups,density] of [['main',0x00020017,7],['extra',0x00100005,2]])for(const speed of [24,30])for(const yaw of [0,Math.PI/4])test(`${name} ball CCD hits intact cuboid at ${speed} units/s, yaw ${yaw}`,()=>{
 const world=new RAPIER.World({x:0,y:0,z:0}),queue=new RAPIER.EventQueue(true);world.timestep=1/90;
 try{
  // Holding the target fixed isolates the collision envelope/CCD from target
  // recoil; dynamic-body impulse equivalence is covered separately above.
  const target=world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setRotation({x:0,y:Math.sin(yaw/2),z:0,w:Math.cos(yaw/2)}));
  const box=world.createCollider(intactShellColliderDesc(RAPIER,.88,.88,.88,.025,.88**3*.7).setCollisionGroups(0x0004001f).setSolverGroups(0x0004001f).setFriction(.65).setRestitution(.08).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),target);
  const ball=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0,0,-3).setLinvel(0,0,speed).setCcdEnabled(true));
  const sphere=world.createCollider(RAPIER.ColliderDesc.ball(.38).setDensity(density).setCollisionGroups(groups).setSolverGroups(groups).setFriction(.16).setRestitution(.7).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),ball);
  let hits=0;
  for(let i=0;i<30;i++){
   world.step(queue);queue.drainCollisionEvents((a,b,start)=>{if(start&&((a===box.handle&&b===sphere.handle)||(b===box.handle&&a===sphere.handle)))hits++;});
   assert.ok(ball.translation().z<-.44,'the fast ball never crosses through the intact block');
  }
  assert.equal(hits,1,'a single collision event reaches gameplay');assert.ok(ball.linvel().z<0,'ball rebounds off the intact exterior');
 }finally{queue.free();world.free();}
});
