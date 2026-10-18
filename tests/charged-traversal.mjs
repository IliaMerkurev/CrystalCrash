import test from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import {ChargedTraversal,sphereOverlapsShell} from '../src/charged-traversal.js';
import {shellPanels} from '../src/glass-shell.js';
await RAPIER.init();
const DT=1/90,MAIN=0x00020017,EXTRA=0x00100017,STRUCTURE=0x0004001f;
function fixture(run){
 const world=new RAPIER.World({x:0,y:0,z:0}),queue=new RAPIER.EventQueue(true);world.timestep=DT;
 const tracker=new ChargedTraversal(),blocks=new Map(),charged=new Set(),balls=[],colliderOrigins=new Map();let serial=0;
 const cube=({id=++serial,z=0,x=0,y=0,yaw=0,panels=false,origin=null}={})=>{
  origin??={id};const b=world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x,y,z).setRotation({x:0,y:Math.sin(yaw/2),z:0,w:Math.cos(yaw/2)}));
  const descs=panels?shellPanels(.88,.88,.88,.025).map(p=>RAPIER.ColliderDesc.cuboid(...p.size.map(n=>n/2)).setTranslation(...p.p)):[RAPIER.ColliderDesc.cuboid(.44,.44,.44)];
  const cs=descs.map(d=>world.createCollider(d.setCollisionGroups(STRUCTURE).setSolverGroups(STRUCTURE).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),b));
  for(const c of cs)colliderOrigins.set(c.handle,origin);
  const o={id,b,cs,kind:'block',origin,sx:.88,sy:.88,sz:.88};blocks.set(id,o);return o;
 };
 const ball=({z=-3,x=0,speed=48,groups=MAIN}={})=>{
  const b=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x,0,z).setLinvel(0,0,speed).setCcdEnabled(true)),c=world.createCollider(RAPIER.ColliderDesc.ball(.38).setDensity(groups===MAIN?7:2).setCollisionGroups(groups).setSolverGroups(groups).setRestitution(.7).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),b);
  balls.push(b);charged.add(b);return {b,c,groups};
 };
 const sync=()=>tracker.sync(balls,blocks,b=>charged.has(b));
 const step=(onEvent=()=>{})=>{
  tracker.advance(DT);sync();
  for(const b of balls)if(b.isValid()&&b.isDynamic()){const c=b.collider(0),group=c.collisionGroups();c.setSolverGroups(tracker.isPassing(b)?group&~4:group);}
  world.step(queue);queue.drainCollisionEvents((a,b,start)=>{if(!start)return;const o=colliderOrigins.get(a)||colliderOrigins.get(b),hitBall=balls.find(body=>body.isValid()&&(body.collider(0).handle===a||body.collider(0).handle===b));if(o&&hitBall)onEvent(hitBall,o,a,b);});
 };
 try{run({world,queue,tracker,blocks,charged,balls,cube,ball,sync,step});}finally{queue.free();world.free();}
}
for(const groups of [MAIN,EXTRA])for(const speed of [48,60])for(const panels of [false,true])for(const yaw of [0,Math.PI/4])test(`real Rapier ghost: groups ${groups.toString(16)}, ${speed}/s, ${panels?'six panels':'solid intact'}, yaw ${yaw}`,()=>fixture(({tracker,cube,ball,step})=>{
 const o=cube({panels,yaw}),shot=ball({groups,speed});let events=0,claims=0;
 for(let i=0;i<16;i++)step((body,origin)=>{events++;if(tracker.claim(body,origin.id))claims++;});
 assert(events>0,'collision events still reach gameplay with structure solver excluded');
 if(panels)assert(events>=2,'entry and exit panels each emit a collision start');
 assert.equal(claims,1,'entry/exit panels and repeated contacts grant one normal hit');
 assert(shot.b.translation().z>3,'ball exits the glass volume');
 assert(Math.abs(shot.b.linvel().z-speed)<.001,'glass does not rebound or slow the charged ball');
 assert.equal(tracker.protected(o.origin.id),true,'recent exit still guards environmental support damage');
}));

test('separate later traversal can hit again after the sphere fully exits',()=>fixture(({tracker,cube,ball,step})=>{
 const o=cube({panels:true}),shot=ball();let claims=0;
 const hit=(b,origin)=>{if(tracker.claim(b,origin.id))claims++;};
 for(let i=0;i<14;i++)step(hit);assert.equal(claims,1);
 shot.b.setLinvel({x:0,y:0,z:-48},true);
 for(let i=0;i<14;i++)step(hit);assert.equal(claims,2);assert(shot.b.translation().z< -1);
}));

test('main and extra balls claim the same original independently',()=>fixture(({tracker,cube,ball,sync})=>{
 const o=cube(),main=ball({z:0}),extra=ball({z:0,groups:EXTRA});sync();
 assert.equal(tracker.claim(main.b,o.origin.id),true);assert.equal(tracker.claim(extra.b,o.origin.id),true);
 assert.equal(tracker.claim(main.b,o.origin.id),false);assert.equal(tracker.claim(extra.b,o.origin.id),false);
 tracker.forget(main.b);assert.equal(tracker.isPassing(main.b),false);assert.equal(tracker.protected(o.origin.id),true);
 tracker.forget(extra.b);assert.equal(tracker.protected(o.origin.id),false);
}));

test('charge expiry inside a shell retains the same visit until fully clear',()=>fixture(({tracker,cube,ball,charged,sync,step})=>{
 const o=cube({panels:true}),shot=ball({z:0,speed:0});sync();assert(tracker.claim(shot.b,o.origin.id));charged.delete(shot.b);
 for(let i=0;i<50;i++){step();assert(tracker.isPassing(shot.b));assert(tracker.protected(o.origin.id));assert.equal(tracker.claim(shot.b,o.origin.id),false);}
 shot.b.setLinvel({x:0,y:0,z:6},true);let rawContacts=0;
 for(let i=0;i<30;i++)step((body,origin)=>{rawContacts++;assert.equal(tracker.claim(body,origin.id),false);});
 assert(rawContacts>0,'exit panels produce actual contacts after charge expiry');assert(shot.b.translation().z>1.5);assert.equal(tracker.isPassing(shot.b),false);
 for(let i=0;i<20;i++)step();assert.equal(tracker.protected(o.origin.id),false,'release grace eventually expires');
}));

test('expiry extension is bounded to existing originals and adds no neighboring traversal',()=>fixture(({tracker,cube,ball,charged,sync})=>{
 const first=cube({id:1}),neighbor=cube({id:2,z:1.7}),shot=ball({z:0,speed:0});sync();assert(tracker.claim(shot.b,first.origin.id));charged.clear();tracker.advance(DT);sync();
 shot.b.setTranslation({x:0,y:0,z:1.2},true);tracker.advance(DT);sync();
 assert.equal(tracker.isPassing(shot.b),false,'only the old shell controls expiry exit');assert.equal(tracker.claim(shot.b,neighbor.origin.id),false);
}));

test('repeated sync in one step cannot consume release grace or first-event retention',()=>fixture(({tracker,cube,ball,sync})=>{
 const o=cube(),shot=ball({z:-2,speed:0});sync();assert(tracker.claim(shot.b,o.origin.id),'contact can claim before overlap is sampled');
 for(let i=0;i<20;i++)sync();assert.equal(tracker.claim(shot.b,o.origin.id),false);assert(tracker.protected(o.origin.id));
 tracker.advance(DT);for(let i=0;i<20;i++)sync();assert.equal(tracker.claim(shot.b,o.origin.id),false,'next full outside pre-step sample is retained');
 tracker.advance(DT);sync();assert.equal(tracker.claim(shot.b,o.origin.id),true,'a subsequent outside step releases the traversal');
}));

test('oriented shell volume contains the hollow interior and uses sphere corner distance',()=>fixture(({cube,ball})=>{
 const o=cube({yaw:Math.PI/4}),shot=ball({z:0,speed:0});assert(sphereOverlapsShell(shot.b,.38,o));
 shot.b.setTranslation({x:.9,y:0,z:0},true);assert(sphereOverlapsShell(shot.b,.38,o));
 shot.b.setTranslation({x:1.1,y:0,z:0},true);assert.equal(sphereOverlapsShell(shot.b,.38,o),false);
 shot.b.setTranslation({x:0,y:.9,z:.9},true);assert.equal(sphereOverlapsShell(shot.b,.38,o),false);
}));

test('fractured sibling replacement preserves one original visit',()=>fixture(({world,tracker,blocks,cube,ball,sync})=>{
 const original=cube(),shot=ball({z:0,speed:0});sync();assert(tracker.claim(shot.b,original.origin.id));
 blocks.delete(original.id);world.removeRigidBody(original.b);cube({id:10,origin:original.origin,panels:true});sync();assert.equal(tracker.claim(shot.b,original.origin.id),false);assert(tracker.protected(original.origin.id));
}));

test('catch, omitted balls, invalid handles, replaced originals and reset clean identity',()=>fixture(({world,tracker,blocks,balls,cube,ball,sync})=>{
 const o=cube(),shot=ball({z:0,speed:0});sync();assert(tracker.claim(shot.b,o.origin.id));
 shot.b.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased,true);sync();assert.equal(tracker.isPassing(shot.b),false);assert.equal(tracker.protected(o.origin.id),false);
 shot.b.setBodyType(RAPIER.RigidBodyType.Dynamic,true);sync();assert(tracker.claim(shot.b,o.origin.id));
 balls.length=0;sync();assert.equal(tracker.entries.size,0);balls.push(shot.b);sync();assert(tracker.claim(shot.b,o.origin.id));
 const oldOrigin=o.origin;o.origin={id:oldOrigin.id};sync();assert.equal(tracker.claim(shot.b,oldOrigin),false);assert(tracker.claim(shot.b,o.origin.id));
 world.removeRigidBody(shot.b);sync();assert.equal(tracker.entries.size,0);assert.equal(tracker.protected(o.origin.id),false);
 const replacement=ball({z:0,speed:0});sync();assert(tracker.claim(replacement.b,o.origin.id),'a reused handle never inherits a visit');tracker.reset();assert.equal(tracker.entries.size,0);assert.equal(tracker.isPassing(replacement.b),false);assert.equal(tracker.protected(o.origin.id),false);
}));

test('ordinary idle sync never scans blocks',()=>fixture(({tracker,ball,charged,balls})=>{
 ball();charged.clear();const blocks={values(){throw new Error('idle shell scan');}};
 tracker.sync(balls,blocks,()=>false);assert.equal(tracker.entries.size,0);
}));


test('terminal debris cannot retain an expired shell traversal',()=>fixture(({tracker,cube,ball,charged,sync})=>{
 const o=cube(),shot=ball({z:0,speed:0});sync();assert(tracker.claim(shot.b,o.origin.id));charged.clear();o.kind='fragment';
 tracker.advance(DT);sync();assert.equal(tracker.isPassing(shot.b),false);assert.equal(tracker.protected(o.origin.id),false);
}));
