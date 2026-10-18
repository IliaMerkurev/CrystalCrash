// Secondary physical effects own their bodies and simple, shared visual resources.
// Call step before world.step, and render after world.step. All times are seconds.
export class SecondaryPowers {
 constructor({THREE,RAPIER,scene,world,colliders,radius,tableGroup=1,structureGroup=4,onEchoHit,onFinishSplit}) {
  Object.assign(this,{THREE,RAPIER,scene,world,colliders,radius,onEchoHit,onFinishSplit});
  this.echoRadius=radius;this.echoes=[];this.liveEchoes=new Set();this.echoSerial=0;this.splitActivations=new Set();this.echoCapacity=0;this.echoInstances=null;this.transitionAnchor=null;this.stagedAnchor=null;this.time=0;this.catchDuration=1;this.well=null;this.blackHole=null;this.frictionLeases=new Map();this.marks=new Map();this.markPool=[];this.transitionParked=false;
  const membership=g=>g>0xffff?(g>>>16):g;
  this.echoGroups=(16<<16)|(membership(tableGroup)|membership(structureGroup)|2|16);
  this.echoGeometry=new THREE.SphereGeometry(this.echoRadius,32,24);
  // Use the main ball's polished steel response, with a pink metal tint.
  this.echoMaterial=new THREE.MeshStandardMaterial({color:0xF27ED2,metalness:1,roughness:.095,envMapIntensity:2.4});
  this.ensureEchoCapacity(32);
  this.ringGeometry=new THREE.TorusGeometry(1,.025,4,48);
  this.wellMaterial=new THREE.MeshBasicMaterial({color:0x7887FF,transparent:true,opacity:.7,depthWrite:false});
  this.iceMaterial=new THREE.MeshBasicMaterial({color:0xB8E9F5,transparent:true,opacity:.8,depthWrite:false});
  this.frostGeometry=new THREE.BoxGeometry(1,1,1);this.frostMaterial=new THREE.MeshBasicMaterial({color:0xb8e9f5,transparent:true,opacity:.16,depthWrite:false});
  // Five shared, low-poly arcs form a tall, widening Tornado funnel.
  this.wellGeometry=new THREE.TorusGeometry(1,.018,4,48,Math.PI*1.65);
  this.wellMesh=new THREE.Group();this.wellRings=[];
  for(let i=0;i<5;i++){
   const ring=new THREE.Mesh(this.wellGeometry,this.wellMaterial);
   ring.rotation.x=-Math.PI/2;ring.rotation.z=i*1.35;ring.position.y=i*.625;
   ring.userData.radius=.15+i*.1125;ring.scale.setScalar(ring.userData.radius);
   this.wellRings.push(ring);this.wellMesh.add(ring);
  }
  // A translucent shell gives the vortex volume; broad triangle ribbons stay
  // readable at gameplay camera distance without relying on GPU line width.
  const funnelProfile=[];
  for(let i=0;i<=12;i++){const t=i/12;funnelProfile.push(new THREE.Vector2(.15+.45*t**1.25,t*2.5));}
  this.wellFunnelGeometry=new THREE.LatheGeometry(funnelProfile,40);
  this.wellFunnelMaterial=new THREE.MeshBasicMaterial({color:0x7887FF,transparent:true,opacity:.18,depthWrite:false,side:THREE.DoubleSide});
  this.wellFunnelMaterial.forceSinglePass=true;
  this.wellFunnel=new THREE.Mesh(this.wellFunnelGeometry,this.wellFunnelMaterial);
  this.wellMesh.add(this.wellFunnel);
  const ribbonPositions=[],ribbonIndices=[],segments=112;
  for(let i=0;i<=segments;i++){
   const t=i/segments,angle=t*Math.PI*3.4,width=(.14+.08*t)*Math.min(1,.12+Math.sin(Math.PI*t)*4);
   for(const side of [-1,1]){
    const y=Math.max(0,Math.min(2.5,t*2.5+side*width*.5)),height=y/2.5,r=.162+.45*height**1.25;
    ribbonPositions.push(Math.cos(angle)*r,y,Math.sin(angle)*r);
   }
   if(i<segments){const n=i*2;ribbonIndices.push(n,n+1,n+2,n+1,n+3,n+2);}
  }
  this.wellRibbonGeometry=new THREE.BufferGeometry();
  this.wellRibbonGeometry.setAttribute('position',new THREE.Float32BufferAttribute(ribbonPositions,3));
  this.wellRibbonGeometry.setIndex(ribbonIndices);this.wellRibbonGeometry.computeVertexNormals();
  this.wellRibbonMaterial=new THREE.MeshBasicMaterial({color:0x7887FF,transparent:true,opacity:.76,depthWrite:false,side:THREE.DoubleSide});
  this.wellRibbonMaterial.forceSinglePass=true;
  this.wellRibbons=[];
  for(let i=0;i<3;i++){
   const ribbon=new THREE.Mesh(this.wellRibbonGeometry,this.wellRibbonMaterial);
   ribbon.rotation.y=i*Math.PI*2/3;this.wellRibbons.push(ribbon);this.wellMesh.add(ribbon);
  }
  this.wellMesh.visible=false;scene.add(this.wellMesh);
 }
 ensureEchoCapacity(count) {
  if(count<=this.echoCapacity)return;
  let capacity=Math.max(32,this.echoCapacity);while(capacity<count)capacity*=2;
  const mesh=new this.THREE.InstancedMesh(this.echoGeometry,this.echoMaterial,capacity);
  mesh.instanceMatrix.setUsage(this.THREE.DynamicDrawUsage);mesh.frustumCulled=false;mesh.count=this.echoes.length;
  this.echoInstances?.removeFromParent();this.echoInstances?.dispose();
  this.echoInstances=mesh;this.echoCapacity=capacity;this.scene.add(mesh);
 }
 spawnSplit(effect,point,incoming,now,sources,bounds=null) {
  // Compatibility for the original (point, velocity, now, effect) call shape.
  if(typeof incoming==='number') [effect,point,incoming,now]=[now||{},effect,point,incoming];
  effect=effect||{};
  const activationId=effect.activationId??effect.id;
  if(activationId!=null&&this.splitActivations.has(activationId))return false;
  // Copy every source before creating any body. New children never join this
  // activation's snapshot, even if the caller supplied a mutable collection.
  const initial=sources??[{position:point,velocity:incoming},...this.echoes.filter(e=>this.isValid(e)).map(e=>({position:e.b.translation(),velocity:e.b.linvel()}))];
  const snapshot=initial.map(source=>({position:{...source.position},velocity:{...source.velocity},radius:Number.isFinite(source.radius)&&source.radius>0?source.radius:this.radius})).filter(source=>
   ['x','y','z'].every(axis=>Number.isFinite(source.position[axis]))&&['x','z'].every(axis=>Number.isFinite(source.velocity[axis])));
  if(!snapshot.length)return false;
  if(activationId!=null)this.splitActivations.add(activationId);
  this.ensureEchoCapacity(this.echoes.length+snapshot.length*2);
  this.time=now;
  const {THREE,RAPIER}=this,r=this.echoRadius,axis=new THREE.Vector3(0,1,0);
  // Sphere separation uses true radii and a local spatial hash, not one search
  // over every body for each candidate. Sources and newly spawned children all
  // occupy space, so enabling ball-to-ball collision never starts interpenetrated.
  const occupied=new Map(),maxRadius=snapshot.reduce((largest,source)=>Math.max(largest,source.radius),Math.max(this.radius,r)),cell=2*maxRadius+.1,gap=.035;
  const key=(x,y,z)=>`${x},${y},${z}`;
  const occupy=(position,radius)=>{const k=key(Math.floor(position.x/cell),Math.floor(position.y/cell),Math.floor(position.z/cell));if(!occupied.has(k))occupied.set(k,[]);occupied.get(k).push({position:{...position},radius});};
  for(const source of snapshot)occupy(source.position,source.radius);
  for(const echo of this.echoes)if(this.isValid(echo))occupy(echo.b.translation(),r);
  const low=Number.isFinite(bounds?.top)?bounds.top+r+.12:-Infinity,high=Number.isFinite(bounds?.bottom)?bounds.bottom-r-.12:Infinity;
  const halfAt=z=>typeof bounds?.tableHalf==='function'?bounds.tableHalf(z):(bounds?.halfWidth??bounds?.half??Infinity);
  const free=p=>{
   if(p.z<low||p.z>high||Math.abs(p.x)>halfAt(p.z)-r-.26||p.y<r+.03)return false;
   const cx=Math.floor(p.x/cell),cy=Math.floor(p.y/cell),cz=Math.floor(p.z/cell);
   for(let x=cx-1;x<=cx+1;x++)for(let y=cy-1;y<=cy+1;y++)for(let z=cz-1;z<=cz+1;z++)for(const other of occupied.get(key(x,y,z))||[]){
    const distance=(p.x-other.position.x)**2+(p.y-other.position.y)**2+(p.z-other.position.z)**2;
    if(distance<(r+other.radius+gap)**2)return false;
   }
   return true;
  };
  const place=desired=>{
   const base=desired.clone();base.z=Math.max(low,Math.min(high,base.z));const limit=Math.max(0,halfAt(base.z)-r-.26);base.x=Math.max(-limit,Math.min(limit,base.x));base.y=Math.max(r+.03,base.y);
   const spacing=2*r+gap;
   // No count/search cap: a finite population always leaves a free height layer.
   for(let shell=0;;shell++)for(let up=0;up<=shell;up++)for(let x=-shell;x<=shell;x++)for(let z=-shell;z<=shell;z++){
    if(Math.max(Math.abs(x),Math.abs(z),up)!==shell)continue;
    const candidate=new THREE.Vector3(base.x+x*spacing,base.y+up*spacing,base.z+z*spacing);
    if(free(candidate))return candidate;
   }
  };
  const angle=Number.isFinite(effect.angleDegrees)?effect.angleDegrees*Math.PI/180:Math.PI/10;
  for(const origin of snapshot){
   const source=new THREE.Vector3(origin.velocity.x,origin.velocity.y||0,origin.velocity.z);
   // Reflections can be weak after an impact: launch both children decisively.
   const speed=Math.min(30,Math.max(16,source.length()*1.2));if(source.lengthSq()<1e-8)source.set(0,0,-1);
   source.normalize().multiplyScalar(speed);
   for(const side of [-1,1]) {
    const velocity=source.clone().applyAxisAngle(axis,side*angle),direction=velocity.clone().normalize();
    const tangent=new THREE.Vector3(-source.z,0,source.x);if(tangent.lengthSq()<1e-8)tangent.set(1,0,0);tangent.normalize();
    const desired=new THREE.Vector3().copy(origin.position).addScaledVector(direction,origin.radius+r+.08).addScaledVector(tangent,-side*(r+.08));
    const p=place(desired);occupy(p,r);
    const b=this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x,p.y,p.z).setCcdEnabled(true).setLinearDamping(.035).setAngularDamping(.12));
    const c=this.world.createCollider(RAPIER.ColliderDesc.ball(r).setCollisionGroups(this.echoGroups).setSolverGroups(this.echoGroups).setDensity(2).setFriction(.16).setRestitution(.7).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),b);
    const mass=b.mass();b.applyImpulse({x:velocity.x*mass,y:velocity.y*mass,z:velocity.z*mass},true);
    // Keep the per-ball transform API without allocating a draw call per ball.
    const mesh=new THREE.Object3D();mesh.position.copy(p);
    const echo={id:++this.echoSerial,index:this.echoes.length,b,c,mesh,hitCount:0,born:now,activationId,removed:false,valid:true,isHeld:false,heldPoint:null,transitionParked:false,staged:false,inLowerZone:false,catchUntil:null,returning:false,launching:false,launchGraceUntil:null,impulseGraceUntil:null};
    this.echoes.push(echo);this.liveEchoes.add(echo);this.colliders.set(c.handle,{kind:'echo',echo});
   }
  }
  this.render();return true;
 }
 isValid(echo) {return !!echo&&echo.valid&&!echo.removed&&this.liveEchoes.has(echo)&&echo.b.isValid();}
 isHeld(echo) {return this.isValid(echo)&&echo.isHeld;}
 // Parent calls this only after a successful, distinct structure impact.
 // Echoes have no hit allowance or timer: only falling off the arena loses one.
 hit(echo) {
  if(!this.isValid(echo))return false;
  echo.hitCount++;this.onEchoHit?.(echo);return true;
 }
 holdEcho(echo) {
  if(!this.isValid(echo)||echo.transitionParked||echo.staged)return false;
  if(echo.isHeld)return true;
  echo.heldPoint={...echo.b.translation()};echo.isHeld=true;echo.catchUntil=null;echo.returning=false;echo.launching=false;echo.impulseGraceUntil=null;
  echo.b.resetForces(true);echo.b.resetTorques(true);
  echo.b.setLinvel({x:0,y:0,z:0},true);echo.b.setAngvel({x:0,y:0,z:0},true);
  echo.b.setBodyType(this.RAPIER.RigidBodyType.KinematicPositionBased,true);
  echo.b.setTranslation(echo.heldPoint,true);echo.b.setNextKinematicTranslation(echo.heldPoint);
  return true;
 }
 releaseEcho(echo,velocity={x:0,y:0,z:0}) {
  if(!this.isValid(echo)||echo.transitionParked||echo.staged)return false;
  echo.isHeld=false;echo.heldPoint=null;echo.inLowerZone=true;echo.catchUntil=this.time+this.catchDuration;echo.returning=false;echo.launching=true;echo.launchGraceUntil=echo.catchUntil;echo.impulseGraceUntil=null;
  echo.b.setBodyType(this.RAPIER.RigidBodyType.Dynamic,true);
  echo.b.resetForces(true);echo.b.resetTorques(true);echo.b.setAngvel({x:0,y:0,z:0},true);
  echo.b.setLinvel({x:velocity.x||0,y:velocity.y||0,z:velocity.z||0},true);
  return true;
 }
 grantImpulseGrace(echo,seconds=.6,now=this.time) {
  if(!this.isValid(echo)||echo.isHeld||echo.staged||echo.transitionParked||!echo.b.isDynamic())return false;
  echo.impulseGraceUntil=Math.max(echo.impulseGraceUntil??-Infinity,now+Math.max(0,seconds));
  return true;
 }
 blastEcho(echo,velocity,now=this.time,seconds=.6) {
  if(!this.grantImpulseGrace(echo,seconds,now))return false;
  echo.b.setLinvel({x:velocity.x||0,y:velocity.y||0,z:velocity.z||0},true);
  return true;
 }
 parkForTransition(mainPoint,bounds=null) {
  this.endWell();this.endBlackHole();this.transitionParked=true;this.stagedAnchor=null;
  for(const echo of this.echoes){
   echo.staged=false;this.holdEcho(echo);echo.transitionParked=true;echo.isHeld=true;
   echo.c.setCollisionGroups(0);echo.c.setSolverGroups(0);
  }
  this.followTransition(mainPoint,Infinity,bounds);
 }
 transitionFormation(mainPoint,bounds,count) {
  const r=this.echoRadius,spacing=this.radius+r+.12,edge=r+.26;
  const lower=bounds?.lowerZoneZ??bounds?.mid,upper=bounds?.bottom??bounds?.lossZ;
  const lowerZone=Number.isFinite(lower)&&Number.isFinite(upper)&&mainPoint.z>=lower&&mainPoint.z<=upper;
  const reach=Math.max(2,Math.ceil(Math.sqrt(count+1)/2))*spacing;
  let low=lowerZone?lower+r+.1:mainPoint.z-reach,high=lowerZone?upper-r-.1:mainPoint.z+reach;
  if(high<low)low=high=(low+high)/2;
  const anchorZ=Math.max(low,Math.min(high,mainPoint.z)),points=[];
  const rows=[];for(let row=Math.ceil((low-anchorZ)/spacing);row<=Math.floor((high-anchorZ)/spacing);row++)rows.push(row);
  rows.sort((a,b)=>Math.abs(a)-Math.abs(b)||a-b);
  const floor=[];
  for(const row of rows){
   const z=anchorZ+row*spacing,half=typeof bounds?.tableHalf==='function'?bounds.tableHalf(z):(bounds?.halfWidth??bounds?.half??6.25);
   const limit=Math.max(0,half-edge),anchorX=Math.max(-limit,Math.min(limit,mainPoint.x));
   const columns=[];for(let col=Math.ceil((-limit-anchorX)/spacing);col<=Math.floor((limit-anchorX)/spacing);col++)columns.push(col);
   columns.sort((a,b)=>Math.abs(a)-Math.abs(b)||a-b);
   for(const col of columns)floor.push({x:anchorX+col*spacing,z});
  }
  floor.sort((a,b)=>{const delta=((a.x-mainPoint.x)**2+(a.z-mainPoint.z)**2)-((b.x-mainPoint.x)**2+(b.z-mainPoint.z)**2);return Math.abs(delta)<1e-8?0:delta;});
  // Ordinary groups fit in rows on the lower deck. Extremely large populations
  // use separated height layers rather than overlapping or dropping any balls.
  for(let layer=0;points.length<count;layer++){
   const y=Math.max(r+.03,mainPoint.y)+layer*spacing;
   for(const point of floor){
    if(Math.hypot(point.x-mainPoint.x,y-mainPoint.y,point.z-mainPoint.z)<this.radius+r+.08)continue;
    points.push({x:point.x,y,z:point.z});if(points.length===count)break;
   }
  }
  return points;
 }
 followTransition(mainPoint,dt=1/90,bounds=null) {
  if(!this.transitionParked||!mainPoint)return;
  const follow=Number.isFinite(dt)?1-Math.exp(-18*Math.max(0,dt)):1;
  if(!this.transitionAnchor)this.transitionAnchor={...mainPoint};
  for(const axis of ['x','y','z'])this.transitionAnchor[axis]+=(mainPoint[axis]-this.transitionAnchor[axis])*follow;
  // Ease the group anchor, not each ball independently, so rows stay separated.
  const positions=this.transitionFormation(this.transitionAnchor,bounds,this.echoes.length);
  this.echoes.forEach((echo,index)=>{
   if(!this.isValid(echo))return;
   const p=positions[index];echo.heldPoint=p;echo.b.setTranslation(p,true);echo.b.setNextKinematicTranslation(p);
   echo.b.setLinvel({x:0,y:0,z:0},true);echo.b.setAngvel({x:0,y:0,z:0},true);echo.mesh.position.copy(p);
  });
  this.render();
 }
 resumeAfterTransition(now) {
  if(!this.transitionParked)return;
  this.time=now;this.transitionParked=false;this.stagedAnchor=this.transitionAnchor?{...this.transitionAnchor}:null;this.transitionAnchor=null;
  for(const echo of this.echoes){
   if(!this.isValid(echo))continue;
   echo.transitionParked=false;echo.staged=true;echo.isHeld=true;echo.catchUntil=null;echo.returning=false;echo.launching=false;
   echo.c.setCollisionGroups(this.echoGroups);echo.c.setSolverGroups(this.echoGroups);
   // Keep the transferred formation kinematic until the first MAIN launch.
   echo.heldPoint={...echo.b.translation()};echo.b.setNextKinematicTranslation(echo.heldPoint);
   echo.b.resetForces(true);echo.b.resetTorques(true);echo.b.setLinvel({x:0,y:0,z:0},true);echo.b.setAngvel({x:0,y:0,z:0},true);
  }
 }
 launchStaged(velocity) {
  const group=this.echoes.filter(echo=>this.isValid(echo)&&echo.staged);
  const source=new this.THREE.Vector3(velocity?.x||0,velocity?.y||0,velocity?.z||0);
  if(!group.length||source.lengthSq()<1e-8)return 0;
  const center=this.stagedAnchor||group[0].b.translation(),right=new this.THREE.Vector3(-source.z,0,source.x).normalize();
  const lateral=group.map(echo=>{const p=echo.b.translation();return (p.x-center.x)*right.x+(p.z-center.z)*right.z;});
  const extent=lateral.reduce((largest,offset)=>Math.max(largest,Math.abs(offset)),1);
  group.forEach((echo,index)=>{
   const shot=source.clone().applyAxisAngle(new this.THREE.Vector3(0,1,0),-.1*lateral[index]/extent);
   echo.staged=false;this.releaseEcho(echo,shot);
  });
  this.stagedAnchor=null;return group.length;
 }
 removeEcho(echo,notify=true) {
  if(!this.liveEchoes.has(echo))return;
  const last=this.echoes.pop();if(last!==echo){this.echoes[echo.index]=last;last.index=echo.index;}
  this.liveEchoes.delete(echo);echo.index=-1;echo.removed=true;echo.valid=false;echo.isHeld=false;echo.staged=false;echo.heldPoint=null;echo.catchUntil=null;echo.returning=false;
  this.colliders.delete(echo.c.handle);if(echo.b.isValid())this.world.removeRigidBody(echo.b);echo.mesh.removeFromParent();
  this.echoInstances.count=this.echoes.length;
  if(notify&&!this.echoes.length)this.onFinishSplit?.();
 }
 intact(o) {
  return o?.kind==='block'&&o.origin?.clusters?.size===1&&o.ids?.length===o.origin?.graph?.cells?.length&&!(o.damage>0)&&!(o.stage>0);
 }
 playable(o) {return o?.kind==='block'&&o.b?.isValid()&&o.b.isDynamic()&&o.cs?.length>0;}
 acquireFriction(cs,owner) {
  const leases=[];
  for(const c of cs){
   if(!c.isValid())continue;
   let lease=this.frictionLeases.get(c);
   if(!lease){lease={collider:c,handle:c.handle,friction:c.friction(),rule:c.frictionCombineRule(),owners:new Set()};this.frictionLeases.set(c,lease);}
   lease.owners.add(owner);leases.push(lease);c.setFriction(0);c.setFrictionCombineRule(this.RAPIER.CoefficientCombineRule.Min);
  }
  return leases;
 }
 releaseFriction(leases,owner) {
  for(const lease of leases||[]){
   lease.owners.delete(owner);if(lease.owners.size)continue;
   const c=this.world.getCollider(lease.handle);
   if(c&&c===lease.collider&&c.isValid()){c.setFriction(lease.friction);c.setFrictionCombineRule(lease.rule);}
   this.frictionLeases.delete(lease.collider);
  }
 }
 createBlackHole(point,now,blocks,config={}) {
  this.endBlackHole();
  const value=(key,fallback)=>Number.isFinite(config[key])?Math.max(0,config[key]):fallback;
  const diameter=this.radius*2,duration=value('duration',3.5),radius=value('radiusD',6.6)*diameter;
  const hole={point:{x:point.x,y:point.y,z:point.z},radius,range:radius,born:now,expires:now+duration,duration,
   age:0,intensity:0,active:true,rampDuration:value('rampDuration',7/6),acceleration:value('acceleration',50),maxSpeed:value('speedCap',value('maxSpeed',14)),
   settleRadius:value('settleRadiusD',.25)*diameter,maxTargets:Math.floor(value('maxTargets',64)),targets:[],blocks,nextCapture:now};
  this.blackHole=hole;this.captureBlackHoleTargets(hole);return hole;
 }
 captureBlackHoleTargets(hole) {
  const bodies=new Set(hole.targets.map(target=>target.body)),available=Math.max(0,hole.maxTargets-hole.targets.length);
  if(!available)return;
  const candidates=[...hole.blocks.values()].filter(o=>this.playable(o)&&!bodies.has(o.b)).map(o=>{
   const p=o.b.worldCom();return {o,distance:Math.hypot(p.x-hole.point.x,p.y-hole.point.y,p.z-hole.point.z)};
  }).filter(target=>target.distance<=hole.radius).sort((a,b)=>a.distance-b.distance).slice(0,available);
  for(const {o}of candidates){
   const target={id:o.id,handle:o.b.handle,body:o.b};target.friction=this.acquireFriction(o.cs,target);hole.targets.push(target);
  }
 }
 stepBlackHole(dt,now) {
  const hole=this.blackHole;if(!hole)return;
  dt=Math.max(0,Math.min(dt,.1));hole.age=Math.max(0,now-hole.born);
  if(now>=hole.expires){this.endBlackHole();return;}
  const ramp=hole.rampDuration>0?Math.max(0,Math.min(1,hole.age/hole.rampDuration)):1;
  hole.intensity=ramp*ramp*(3-2*ramp);
  hole.targets=hole.targets.filter(target=>{
   const o=hole.blocks.get(target.id);let valid=this.playable(o)&&o.b===target.body&&o.b.handle===target.handle;
   if(valid){const p=o.b.worldCom();valid=Math.hypot(p.x-hole.point.x,p.y-hole.point.y,p.z-hole.point.z)<=hole.radius;}
   if(!valid)this.releaseFriction(target.friction,target);return valid;
  });
  // Refill destroyed/replaced clusters at a bounded cadence; a fractured cube's
  // surviving playable structure can remain in the field without touching debris.
  if(now>=hole.nextCapture){this.captureBlackHoleTargets(hole);hole.nextCapture=now+.2;}
  if(hole.intensity<=0||dt===0)return;
  const acceleration=hole.acceleration*hole.intensity;
  for(const target of hole.targets){
   const o=hole.blocks.get(target.id),p=o.b.worldCom(),dx=hole.point.x-p.x,dy=hole.point.y-p.y,dz=hole.point.z-p.z,distance=Math.hypot(dx,dy,dz);
   const desiredSpeed=Math.min(hole.maxSpeed*hole.intensity,Math.sqrt(2*acceleration*Math.max(0,distance-hole.settleRadius)));
   const toward=distance>1e-6?desiredSpeed/distance:0,v=o.b.linvel();
   const ax=dx*toward-v.x,ay=dy*toward-v.y,az=dz*toward-v.z,change=Math.hypot(ax,ay,az);
   if(change<1e-8)continue;
   const dv=Math.min(change,acceleration*dt),scale=dv*o.b.mass()/change;
   o.b.applyImpulse({x:ax*scale,y:ay*scale,z:az*scale},true);
  }
 }
 endBlackHole() {
  if(!this.blackHole)return;
  for(const target of this.blackHole.targets)this.releaseFriction(target.friction,target);
  this.blackHole.active=false;this.blackHole.intensity=0;this.blackHole=null;
 }
 createWell(point,now,blocks,config={}) {
  this.endWell();
  const value=(key,fallback)=>Number.isFinite(config[key])?Math.max(0,config[key]):fallback;
  const diameter=this.radius*2,range=value('radiusD',6)*diameter,duration=value('duration',4),budget=value('maxDeltaSpeedD',24)*diameter;
  const targets=[...blocks.values()].filter(o=>this.playable(o)).map(o=>{
   const p=o.b.worldCom();return {o,d:Math.hypot(p.x-point.x,p.y-point.y,p.z-point.z)};
  }).filter(t=>t.d<=range).sort((a,b)=>a.d-b.d).slice(0,Math.floor(value('maxTargets',12))).map(({o})=>{
   const p=o.b.worldCom(),orbitRadius=Math.max(diameter*.45,Math.hypot(p.x-point.x,p.z-point.z));
   // Leave enough of the finite impulse budget for four seconds of centripetal
   // steering. Every cube keeps its own starting radius instead of seeking center.
   const orbitSpeed=Math.min(budget*.4,diameter*4,Math.sqrt(orbitRadius*budget/(Math.max(.1,duration)*1.5)));
   return {id:o.id,handle:o.b.handle,body:o.b,remaining:budget,orbitRadius,orbitSpeed};
  });
  for(const target of targets){const o=blocks.get(target.id);target.friction=this.acquireFriction(o.cs,target);}
  this.well={point:{x:point.x,y:point.y,z:point.z},born:now,expires:now+duration,duration,targets,blocks,acceleration:value('accelerationD',35)*diameter,range};
  this.wellMesh.position.set(point.x,.035,point.z);this.wellMesh.scale.set(range,1,range);this.wellMaterial.opacity=.7;this.wellFunnelMaterial.opacity=.18;this.wellRibbonMaterial.opacity=.76;this.wellMesh.visible=duration>0&&range>0;
  return this.well;
 }
 step(dt,now,bounds={}) {
  dt=Math.max(0,Math.min(dt,.1));this.time=now;this.catchDuration=Math.max(0,bounds.lowerCatchDuration??1);
  for(const echo of [...this.echoes]) {
   if(!this.isValid(echo)){this.removeEcho(echo);continue;}
   if(echo.isHeld||echo.transitionParked||echo.staged){
    // Kinematic bodies are immune to gravity and collision forces while aiming.
    echo.b.resetForces(true);echo.b.resetTorques(true);echo.b.setLinvel({x:0,y:0,z:0},true);echo.b.setAngvel({x:0,y:0,z:0},true);
    if(echo.heldPoint){echo.b.setTranslation(echo.heldPoint,true);echo.b.setNextKinematicTranslation(echo.heldPoint);}
    continue;
   }
   const p=echo.b.translation(),half=typeof bounds.tableHalf==='function'?bounds.tableHalf(p.z):(bounds.halfWidth??bounds.half??7);
   const bottom=bounds.bottom??bounds.BOTTOM??bounds.lossZ??Infinity,top=bounds.top??bounds.TOP??-Infinity;
   if(p.y<(bounds.fallY??-2)||p.z>bottom+this.echoRadius||p.z<top-2||Math.abs(p.x)>half+this.echoRadius*3){this.removeEcho(echo);continue;}
   echo.b.resetForces(true);
   if(now<(echo.impulseGraceUntil??-Infinity))continue;
   const line=bounds.lowerZoneZ??bottom-3.2,hysteresis=Math.max(0,bounds.lowerZoneHysteresis??Math.max(.3,this.echoRadius*1.5));
   if(echo.inLowerZone&&p.z<line-hysteresis){echo.inLowerZone=false;echo.catchUntil=null;echo.returning=false;echo.launching=false;}
   if(!echo.inLowerZone&&p.z>=line){
    echo.inLowerZone=true;echo.catchUntil=now+this.catchDuration;echo.returning=false;
    const v=echo.b.linvel(),scale=Math.max(0,Math.min(1,bounds.lowerZoneSpeedScale??.32));
    echo.b.setLinvel({x:v.x*scale,y:v.y,z:v.z*scale},true);
   }
   if(echo.launching&&now<echo.launchGraceUntil)continue;
   if(echo.inLowerZone){
    if(!echo.launching&&echo.catchUntil!==null&&now<echo.catchUntil){
     const v=echo.b.linvel(),speed=Math.hypot(v.x,v.z),limit=Math.max(0,bounds.lowerCatchSpeed??2.8);
     if(speed>limit){const scale=limit/speed;echo.b.setLinvel({x:v.x*scale,y:v.y,z:v.z*scale},true);}
    }else{
     echo.returning=true;const acceleration=Math.max(0,bounds.lowerReturnAcceleration??8);
     echo.b.applyImpulse({x:0,y:0,z:acceleration*echo.b.mass()*dt},true);
    }
   }else{
    const v=echo.b.linvel();
    if(Math.hypot(v.x,v.z)<(bounds.upperStallSpeed??3)){
     const acceleration=Math.max(0,bounds.upperStallAcceleration??3.2);
     echo.b.applyImpulse({x:0,y:0,z:acceleration*echo.b.mass()*dt},true);
    }
   }
   // These are downward anti-stall/return impulses, never pointer attraction.
  }
  this.stepBlackHole(dt,now);
  const well=this.well;if(!well)return;
  if(now>=well.expires){this.endWell();return;}
  for(const target of well.targets){
   const o=well.blocks.get(target.id);if(!this.playable(o)||o.b!==target.body||o.b.handle!==target.handle||target.remaining<=0)continue;
   const p=o.b.worldCom(),dx=p.x-well.point.x,dz=p.z-well.point.z,distance=Math.hypot(dx,dz);
   const rx=distance>1e-6?dx/distance:1,rz=distance>1e-6?dz/distance:0;
   const radial=Math.max(-target.orbitSpeed*.35,Math.min(target.orbitSpeed*.35,(target.orbitRadius-distance)*1.5)),v=o.b.linvel();
   // Tangential velocity plus a weak correction toward the ORIGINAL orbit radius.
   // Vertical motion is untouched; only Black Hole owns central pull and lift.
   const ax=-rz*target.orbitSpeed+rx*radial-v.x,ay=0,az=rx*target.orbitSpeed+rz*radial-v.z,change=Math.hypot(ax,az);
   if(change<1e-6)continue;
   const dv=Math.min(target.remaining,well.acceleration*dt,change),scale=dv*o.b.mass()/change;
   o.b.applyImpulse({x:ax*scale,y:ay*scale,z:az*scale},true);target.remaining-=dv;
  }
  const age=Math.max(0,Math.min(1,(now-well.born)/Math.max(.001,well.duration)));
  this.wellMaterial.opacity=.7*(1-age*.75);
  const fade=1-age*.75;
  this.wellFunnelMaterial.opacity=.18*fade;this.wellRibbonMaterial.opacity=.76*fade;
  for(let i=0;i<this.wellRibbons.length;i++)this.wellRibbons[i].rotation.y=i*Math.PI*2/3-(now-well.born)*2.4;
  this.wellRings.forEach((ring,index)=>{
   ring.rotation.z=index*1.35+(now-well.born)*(1.8+index*.35);
   ring.scale.setScalar(ring.userData.radius*(.94+.06*Math.sin((now-well.born)*5-index)));
  });
 }
 // markMap keys are original IDs; values may be any active mark metadata.
 syncMarks(markMap,blocks) {
  const wanted=new Set(Array.isArray(markMap)?markMap.map(mark=>mark.originId):markMap.keys());
  for(const [id,mesh]of this.marks)if(!wanted.has(id)){mesh.visible=false;this.markPool.push(mesh);this.marks.delete(id);}
  for(const id of wanted){
   let largest=null;for(const o of blocks.values())if(o.origin?.id===id&&(!largest||(o.ids?.length||0)>(largest.ids?.length||0)))largest=o;
   if(!largest){const mesh=this.marks.get(id);if(mesh){mesh.visible=false;this.markPool.push(mesh);this.marks.delete(id);}continue;}
   let mesh=this.marks.get(id);if(!mesh){mesh=this.markPool.pop();if(!mesh){mesh=new this.THREE.Group();const ring=new this.THREE.Mesh(this.ringGeometry,this.iceMaterial);ring.rotation.x=Math.PI/2;ring.scale.setScalar(.72);const veil=new this.THREE.Mesh(this.frostGeometry,this.frostMaterial);veil.scale.setScalar(1.025);mesh.add(ring,veil);}this.scene.add(mesh);this.marks.set(id,mesh);}
   mesh.visible=true;mesh.position.copy(largest.b.translation());mesh.quaternion.copy(largest.b.rotation());mesh.scale.set(largest.sx,largest.sy,largest.sz);
  }
 }
 remap(fn){
  for(const echo of this.echoes){
   if(!this.isValid(echo))continue;
   const p=new this.THREE.Vector3().copy(echo.b.translation());fn(p);echo.b.setTranslation(p,true);echo.mesh.position.copy(p);
   if(echo.isHeld||echo.transitionParked||echo.staged){echo.heldPoint={x:p.x,y:p.y,z:p.z};echo.b.setNextKinematicTranslation(p);}
  }
  if(this.stagedAnchor){const p=new this.THREE.Vector3().copy(this.stagedAnchor);fn(p);this.stagedAnchor={x:p.x,y:p.y,z:p.z};}
  if(this.transitionAnchor){const p=new this.THREE.Vector3().copy(this.transitionAnchor);fn(p);this.transitionAnchor={x:p.x,y:p.y,z:p.z};}
  if(this.blackHole){const p=new this.THREE.Vector3().copy(this.blackHole.point);fn(p);Object.assign(this.blackHole.point,p);}
  if(this.well){const p=new this.THREE.Vector3().copy(this.well.point);fn(p);Object.assign(this.well.point,p);this.wellMesh.position.set(p.x,.035,p.z);}
 }
 render() {
  for(let index=0;index<this.echoes.length;index++){
   const echo=this.echoes[index];echo.mesh.position.copy(echo.b.translation());echo.mesh.quaternion.copy(echo.b.rotation());echo.mesh.updateMatrix();
   this.echoInstances.setMatrixAt(index,echo.mesh.matrix);
  }
  this.echoInstances.count=this.echoes.length;this.echoInstances.instanceMatrix.needsUpdate=true;
 }
 warmupObjects() {
  const group=new this.THREE.Group();group.add(new this.THREE.InstancedMesh(this.echoGeometry,this.echoMaterial,1),new this.THREE.Mesh(this.ringGeometry,this.wellMaterial),new this.THREE.Mesh(this.wellFunnelGeometry,this.wellFunnelMaterial),new this.THREE.Mesh(this.wellRibbonGeometry,this.wellRibbonMaterial),new this.THREE.Mesh(this.ringGeometry,this.iceMaterial),new this.THREE.Mesh(this.frostGeometry,this.frostMaterial));return group;
 }
 endWell(){
  if(this.well)for(const target of this.well.targets)this.releaseFriction(target.friction,target);
  this.well=null;this.wellMesh.visible=false;
 }
 clear() {
  for(const echo of [...this.echoes])this.removeEcho(echo,false);this.transitionParked=false;this.transitionAnchor=null;this.stagedAnchor=null;this.time=0;this.splitActivations.clear();this.endWell();this.endBlackHole();
  for(const mesh of this.marks.values()){mesh.visible=false;this.markPool.push(mesh);}this.marks.clear();
 }
 dispose() {this.clear();this.echoInstances.removeFromParent();this.echoInstances.dispose();this.wellMesh.removeFromParent();for(const mesh of this.markPool)mesh.removeFromParent();this.markPool.length=0;this.echoGeometry.dispose();this.ringGeometry.dispose();this.wellGeometry.dispose();this.wellFunnelGeometry.dispose();this.wellRibbonGeometry.dispose();this.wellFunnelMaterial.dispose();this.wellRibbonMaterial.dispose();this.echoMaterial.dispose();this.wellMaterial.dispose();this.iceMaterial.dispose();this.frostGeometry.dispose();this.frostMaterial.dispose();}
}
