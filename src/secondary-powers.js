// Secondary physical effects own their bodies and simple, shared visual resources.
// Call step before world.step, and render after world.step. All times are seconds.
export class SecondaryPowers {
 constructor({THREE,RAPIER,scene,world,colliders,radius,tableGroup=1,structureGroup=4,onEchoHit,onFinishSplit}) {
  Object.assign(this,{THREE,RAPIER,scene,world,colliders,radius,onEchoHit,onFinishSplit});
  this.echoRadius=radius*.65;this.echoes=[];this.well=null;this.marks=new Map();this.markPool=[];this.transitionParked=false;
  const membership=g=>g>0xffff?(g>>>16):g;
  this.echoGroups=(16<<16)|(membership(tableGroup)|membership(structureGroup));
  this.echoGeometry=new THREE.SphereGeometry(this.echoRadius,20,14);
  this.echoMaterial=new THREE.MeshStandardMaterial({color:0xF27ED2,emissive:0xF27ED2,emissiveIntensity:.5,metalness:.7,roughness:.18});
  this.ringGeometry=new THREE.TorusGeometry(1,.025,4,48);
  this.wellMaterial=new THREE.MeshBasicMaterial({color:0x7887FF,transparent:true,opacity:.7,depthWrite:false});
  this.iceMaterial=new THREE.MeshBasicMaterial({color:0xB8E9F5,transparent:true,opacity:.8,depthWrite:false});
  this.frostGeometry=new THREE.BoxGeometry(1,1,1);this.frostMaterial=new THREE.MeshBasicMaterial({color:0xb8e9f5,transparent:true,opacity:.16,depthWrite:false});
  // Five shared, low-poly arcs show the full attraction area and an inward vortex.
  this.wellGeometry=new THREE.TorusGeometry(1,.018,4,48,Math.PI*1.65);
  this.wellMesh=new THREE.Group();this.wellRings=[];
  for(let i=0;i<5;i++){
   const ring=new THREE.Mesh(this.wellGeometry,this.wellMaterial);
   ring.rotation.x=-Math.PI/2;ring.rotation.z=i*1.35;ring.position.y=i*.018;
   ring.userData.radius=.2+i*.2;ring.scale.setScalar(ring.userData.radius);
   this.wellRings.push(ring);this.wellMesh.add(ring);
  }
  this.wellMesh.visible=false;scene.add(this.wellMesh);
 }
 spawnSplit(point,reflectedVelocity,now,effect={}) {
  if(this.echoes.length)return false;
  const {THREE,RAPIER}=this,r=this.echoRadius;
  const source=new THREE.Vector3(reflectedVelocity.x,reflectedVelocity.y||0,reflectedVelocity.z);
  // Reflections can be weak after an impact: launch both echoes decisively.
  const speed=Math.min(30,Math.max(16,source.length()*1.2));if(source.lengthSq()<1e-8)source.set(0,0,-1);
  source.normalize().multiplyScalar(speed);
  const angle=Number.isFinite(effect.angleDegrees)?effect.angleDegrees*Math.PI/180:Math.PI/10;
  for(const side of [-1,1]) {
   const velocity=source.clone().applyAxisAngle(new THREE.Vector3(0,1,0),side*angle);
   const direction=velocity.clone().normalize(),p=new THREE.Vector3(point.x,Math.max(r+.03,point.y),point.z).addScaledVector(direction,r+this.radius*.25);
   const b=this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x,p.y,p.z).setCcdEnabled(true).setLinearDamping(.035).setAngularDamping(.12));
   const c=this.world.createCollider(RAPIER.ColliderDesc.ball(r).setCollisionGroups(this.echoGroups).setSolverGroups(this.echoGroups).setDensity(2).setFriction(.16).setRestitution(.7).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),b);
   // Use a real launch impulse so the launch respects each physical ball's mass.
   const mass=b.mass();b.applyImpulse({x:velocity.x*mass,y:velocity.y*mass,z:velocity.z*mass},true);
   const mesh=new THREE.Mesh(this.echoGeometry,this.echoMaterial);mesh.position.copy(p);this.scene.add(mesh);
   const echo={b,c,mesh,hitCount:0,born:now,activationId:effect.activationId??effect.id,removed:false,valid:true,isHeld:false,heldPoint:null,transitionParked:false,inLowerZone:false};
   this.echoes.push(echo);this.colliders.set(c.handle,{kind:'echo',echo});
  }
  return true;
 }
 isValid(echo) {return !!echo&&echo.valid&&!echo.removed&&this.echoes.includes(echo)&&echo.b.isValid();}
 isHeld(echo) {return this.isValid(echo)&&echo.isHeld;}
 // Parent calls this only after a successful, distinct structure impact.
 // Echoes have no hit allowance or timer: only falling off the arena loses one.
 hit(echo) {
  if(!this.isValid(echo))return false;
  echo.hitCount++;this.onEchoHit?.(echo);return true;
 }
 holdEcho(echo) {
  if(!this.isValid(echo)||echo.transitionParked)return false;
  if(echo.isHeld)return true;
  echo.heldPoint={...echo.b.translation()};echo.isHeld=true;
  echo.b.resetForces(true);echo.b.resetTorques(true);
  echo.b.setLinvel({x:0,y:0,z:0},true);echo.b.setAngvel({x:0,y:0,z:0},true);
  echo.b.setBodyType(this.RAPIER.RigidBodyType.KinematicPositionBased,true);
  echo.b.setTranslation(echo.heldPoint,true);echo.b.setNextKinematicTranslation(echo.heldPoint);
  return true;
 }
 releaseEcho(echo,velocity={x:0,y:0,z:0}) {
  if(!this.isValid(echo)||echo.transitionParked)return false;
  echo.isHeld=false;echo.heldPoint=null;echo.inLowerZone=true;
  echo.b.setBodyType(this.RAPIER.RigidBodyType.Dynamic,true);
  echo.b.resetForces(true);echo.b.resetTorques(true);echo.b.setAngvel({x:0,y:0,z:0},true);
  echo.b.setLinvel({x:velocity.x||0,y:velocity.y||0,z:velocity.z||0},true);
  return true;
 }
 parkForTransition(mainPoint) {
  this.endWell();this.transitionParked=true;
  for(const echo of this.echoes){
   this.holdEcho(echo);echo.transitionParked=true;echo.isHeld=true;
   echo.c.setCollisionGroups(0);echo.c.setSolverGroups(0);
  }
  this.followTransition(mainPoint,Infinity);
 }
 followTransition(mainPoint,dt=1/90) {
  if(!this.transitionParked||!mainPoint)return;
  const spacing=this.radius+this.echoRadius+.12;
  this.echoes.forEach((echo,index)=>{
   if(!this.isValid(echo))return;
   // The pair sits immediately beside the main ball with no mutual overlap.
   const side=index%2===0?-1:1,row=Math.floor(index/2);
   const p={x:mainPoint.x+side*spacing,y:Math.max(this.echoRadius+.03,mainPoint.y),z:mainPoint.z+row*(this.echoRadius*2+.12)};
   const follow=Number.isFinite(dt)?1-Math.exp(-18*Math.max(0,dt)):1;
   if(echo.heldPoint&&follow<1){p.x=echo.heldPoint.x+(p.x-echo.heldPoint.x)*follow;p.y=echo.heldPoint.y+(p.y-echo.heldPoint.y)*follow;p.z=echo.heldPoint.z+(p.z-echo.heldPoint.z)*follow;}
   echo.heldPoint=p;echo.b.setTranslation(p,true);echo.b.setNextKinematicTranslation(p);
   echo.b.setLinvel({x:0,y:0,z:0},true);echo.b.setAngvel({x:0,y:0,z:0},true);echo.mesh.position.copy(p);
  });
 }
 resumeAfterTransition(now) {
  this.transitionParked=false;
  for(const echo of this.echoes){
   if(!this.isValid(echo))continue;
   echo.transitionParked=false;echo.c.setCollisionGroups(this.echoGroups);echo.c.setSolverGroups(this.echoGroups);
   // Start catchable beside the main ball, not with stale pre-travel momentum.
   this.releaseEcho(echo);echo.inLowerZone=true;
  }
 }
 removeEcho(echo,notify=true) {
  const index=this.echoes.indexOf(echo);if(index<0)return;
  this.echoes.splice(index,1);echo.removed=true;echo.valid=false;echo.isHeld=false;echo.heldPoint=null;
  this.colliders.delete(echo.c.handle);if(echo.b.isValid())this.world.removeRigidBody(echo.b);echo.mesh.removeFromParent();
  if(notify&&!this.echoes.length)this.onFinishSplit?.(echo.activationId);
 }
 intact(o) {
  return o?.kind==='block'&&o.origin?.clusters?.size===1&&o.ids?.length===o.origin?.graph?.cells?.length&&!(o.damage>0)&&!(o.stage>0);
 }
 playable(o) {return o?.kind==='block'&&o.b?.isValid()&&o.b.isDynamic()&&o.cs?.length>0;}
 createWell(point,now,blocks,config={}) {
  this.endWell();
  const value=(key,fallback)=>Number.isFinite(config[key])?Math.max(0,config[key]):fallback;
  const diameter=this.radius*2,range=value('radiusD',6)*diameter,duration=value('duration',4),budget=value('maxDeltaSpeedD',24)*diameter;
  const targets=[...blocks.values()].filter(o=>this.playable(o)).map(o=>{
   const p=o.b.worldCom();return {o,d:Math.hypot(p.x-point.x,p.y-point.y,p.z-point.z)};
  }).filter(t=>t.d<=range).sort((a,b)=>a.d-b.d).slice(0,Math.floor(value('maxTargets',12))).map(({o})=>({id:o.id,handle:o.b.handle,body:o.b,remaining:budget,approachSpeed:budget*.4}));
  for(const target of targets){
   const o=blocks.get(target.id);
   // Min + zero removes floor-contact friction only for attracted structures.
   // Keep actual collider identities so removed/reused handles are never restored.
   target.friction=o.cs.map(c=>({collider:c,handle:c.handle,friction:c.friction(),rule:c.frictionCombineRule()}));
   for(const c of o.cs){c.setFriction(0);c.setFrictionCombineRule(this.RAPIER.CoefficientCombineRule.Min);}
  }
  this.well={point:{x:point.x,y:point.y,z:point.z},born:now,expires:now+duration,duration,targets,blocks,acceleration:value('accelerationD',35)*diameter,settleRadius:diameter*.14,range};
  this.wellMesh.position.set(point.x,.035,point.z);this.wellMesh.scale.setScalar(range);this.wellMaterial.opacity=.7;this.wellMesh.visible=duration>0&&range>0;
  return this.well;
 }
 step(dt,now,bounds={}) {
  dt=Math.max(0,Math.min(dt,.1));
  for(const echo of [...this.echoes]) {
   if(!this.isValid(echo)){this.removeEcho(echo);continue;}
   if(echo.isHeld||echo.transitionParked){
    // Kinematic bodies are immune to gravity and collision forces while aiming.
    echo.b.resetForces(true);echo.b.resetTorques(true);echo.b.setLinvel({x:0,y:0,z:0},true);echo.b.setAngvel({x:0,y:0,z:0},true);
    if(echo.heldPoint){echo.b.setTranslation(echo.heldPoint,true);echo.b.setNextKinematicTranslation(echo.heldPoint);}
    continue;
   }
   const p=echo.b.translation(),half=typeof bounds.tableHalf==='function'?bounds.tableHalf(p.z):(bounds.halfWidth??bounds.half??7);
   const bottom=bounds.bottom??bounds.BOTTOM??bounds.lossZ??Infinity,top=bounds.top??bounds.TOP??-Infinity;
   if(p.y<(bounds.fallY??-2)||p.z>bottom+this.echoRadius||p.z<top-2||Math.abs(p.x)>half+this.echoRadius*3){this.removeEcho(echo);continue;}
   echo.b.resetForces(true);
   const inLowerZone=p.z>=(bounds.lowerZoneZ??bottom-3.2);
   if(inLowerZone&&!echo.inLowerZone){
    const v=echo.b.linvel(),scale=Math.max(0,Math.min(1,bounds.lowerZoneSpeedScale??.32));
    echo.b.setLinvel({x:v.x*scale,y:v.y,z:v.z*scale},true);
   }
   echo.inLowerZone=inLowerZone;
   // Deliberately no return, pointer-attraction, or magnetic acceleration.
  }
  const well=this.well;if(!well)return;
  if(now>=well.expires){this.endWell();return;}
  for(const target of well.targets){
   const o=well.blocks.get(target.id);if(!this.playable(o)||o.b!==target.body||o.b.handle!==target.handle||target.remaining<=0)continue;
   const p=o.b.worldCom(),dx=well.point.x-p.x,dy=well.point.y-p.y,dz=well.point.z-p.z,distance=Math.hypot(dx,dy,dz);
   // Arrive at the well rather than spending the whole impulse budget speeding
   // through it. Reserve braking headroom and reduce desired speed near center.
   const speed=Math.min(target.approachSpeed,Math.sqrt(2*well.acceleration*Math.max(0,distance-well.settleRadius)));
   const toward=distance>1e-6?speed/distance:0,v=o.b.linvel();
   const ax=dx*toward-v.x,ay=dy*toward-v.y,az=dz*toward-v.z,change=Math.hypot(ax,ay,az);
   if(change<1e-6)continue;
   const dv=Math.min(target.remaining,well.acceleration*dt,change),scale=dv*o.b.mass()/change;
   o.b.applyImpulse({x:ax*scale,y:ay*scale,z:az*scale},true);target.remaining-=dv;
  }
  const age=Math.max(0,Math.min(1,(now-well.born)/Math.max(.001,well.duration)));
  this.wellMaterial.opacity=.7*(1-age*.75);
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
   if(echo.isHeld||echo.transitionParked){echo.heldPoint={x:p.x,y:p.y,z:p.z};echo.b.setNextKinematicTranslation(p);}
  }
  if(this.well){const p=new this.THREE.Vector3().copy(this.well.point);fn(p);Object.assign(this.well.point,p);this.wellMesh.position.set(p.x,.035,p.z);}
 }
 render() {for(const echo of this.echoes){echo.mesh.position.copy(echo.b.translation());echo.mesh.quaternion.copy(echo.b.rotation());}}
 warmupObjects() {
  const group=new this.THREE.Group();group.add(new this.THREE.Mesh(this.echoGeometry,this.echoMaterial),new this.THREE.Mesh(this.ringGeometry,this.wellMaterial),new this.THREE.Mesh(this.ringGeometry,this.iceMaterial),new this.THREE.Mesh(this.frostGeometry,this.frostMaterial));return group;
 }
 endWell(){
  if(this.well)for(const target of this.well.targets)for(const saved of target.friction||[]){
   const c=this.world.getCollider(saved.handle);
   if(c&&c===saved.collider&&c.isValid()){c.setFriction(saved.friction);c.setFrictionCombineRule(saved.rule);}
  }
  this.well=null;this.wellMesh.visible=false;
 }
 clear() {
  for(const echo of [...this.echoes])this.removeEcho(echo,false);this.transitionParked=false;this.endWell();
  for(const mesh of this.marks.values()){mesh.visible=false;this.markPool.push(mesh);}this.marks.clear();
 }
 dispose() {this.clear();this.wellMesh.removeFromParent();for(const mesh of this.markPool)mesh.removeFromParent();this.markPool.length=0;this.echoGeometry.dispose();this.ringGeometry.dispose();this.wellGeometry.dispose();this.echoMaterial.dispose();this.wellMaterial.dispose();this.iceMaterial.dispose();this.frostGeometry.dispose();this.frostMaterial.dispose();}
}
