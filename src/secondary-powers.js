// Secondary physical effects own their bodies and simple, shared visual resources.
// Call step before world.step, and render after world.step. All times are seconds.
export class SecondaryPowers {
 constructor({THREE,RAPIER,scene,world,colliders,radius,tableGroup=1,structureGroup=4,onEchoHit,onFinishSplit}) {
  Object.assign(this,{THREE,RAPIER,scene,world,colliders,radius,onEchoHit,onFinishSplit});
  this.echoRadius=radius*.65;this.echoes=[];this.well=null;this.marks=new Map();this.markPool=[];
  const membership=g=>g>0xffff?(g>>>16):g;
  this.echoGroups=(16<<16)|(membership(tableGroup)|membership(structureGroup));
  this.echoGeometry=new THREE.SphereGeometry(this.echoRadius,20,14);
  this.echoMaterial=new THREE.MeshStandardMaterial({color:0xF27ED2,emissive:0xF27ED2,emissiveIntensity:.5,metalness:.7,roughness:.18});
  this.ringGeometry=new THREE.TorusGeometry(1,.025,4,48);
  this.wellMaterial=new THREE.MeshBasicMaterial({color:0x7887FF,transparent:true,opacity:.7,depthWrite:false});
  this.iceMaterial=new THREE.MeshBasicMaterial({color:0xB8E9F5,transparent:true,opacity:.8,depthWrite:false});
  this.wellMesh=new THREE.Mesh(this.ringGeometry,this.wellMaterial);this.wellMesh.rotation.x=-Math.PI/2;this.wellMesh.visible=false;scene.add(this.wellMesh);
 }
 spawnSplit(point,reflectedVelocity,now,effect={}) {
  if(this.echoes.length)return false;
  const {THREE,RAPIER}=this,r=this.echoRadius;
  const source=new THREE.Vector3(reflectedVelocity.x,reflectedVelocity.y||0,reflectedVelocity.z);
  const speed=Math.min(24,Math.max(2,source.length()));if(source.lengthSq()<1e-8)source.set(0,0,-1);
  source.normalize().multiplyScalar(speed);
  for(const side of [-1,1]) {
   const velocity=source.clone().applyAxisAngle(new THREE.Vector3(0,1,0),side*Math.PI/10);
   const direction=velocity.clone().normalize(),p=new THREE.Vector3(point.x,Math.max(r+.03,point.y),point.z).addScaledVector(direction,r+this.radius*.25);
   const b=this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x,p.y,p.z).setCcdEnabled(true).setLinearDamping(.035).setAngularDamping(.12));
   const c=this.world.createCollider(RAPIER.ColliderDesc.ball(r).setCollisionGroups(this.echoGroups).setSolverGroups(this.echoGroups).setDensity(2).setFriction(.16).setRestitution(.7).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),b);
   b.setLinvel(velocity,true);const mesh=new THREE.Mesh(this.echoGeometry,this.echoMaterial);mesh.position.copy(p);this.scene.add(mesh);
   const echo={b,c,mesh,hits:4,born:now,expires:now+10,activationId:effect.activationId??effect.id,removed:false};this.echoes.push(echo);this.colliders.set(c.handle,{kind:'echo',echo});
  }
  return true;
 }
 // Parent calls this only after a successful, distinct structure impact.
 hit(echo) {
  if(!echo||echo.removed||!this.echoes.includes(echo))return false;
  echo.hits--;this.onEchoHit?.(echo);if(echo.hits<=0)this.removeEcho(echo);return true;
 }
 removeEcho(echo,notify=true) {
  const index=this.echoes.indexOf(echo);if(index<0)return;
  this.echoes.splice(index,1);echo.removed=true;this.colliders.delete(echo.c.handle);this.world.removeRigidBody(echo.b);echo.mesh.removeFromParent();
  if(notify&&!this.echoes.length)this.onFinishSplit?.(echo.activationId);
 }
 intact(o) {
  return o?.kind==='block'&&o.origin?.clusters?.size===1&&o.ids?.length===o.origin?.graph?.cells?.length&&!(o.damage>0)&&!(o.stage>0);
 }
 createWell(point,now,blocks,config={}) {
  // The impulse budget is a bound on cumulative added speed, not resultant speed.
  const diameter=this.radius*2,range=(config.radiusD??3)*diameter;
  const targets=[...blocks.values()].filter(o=>this.intact(o)).map(o=>({o,d:Math.hypot(o.b.translation().x-point.x,o.b.translation().y-point.y,o.b.translation().z-point.z)})).filter(t=>t.d<=range).sort((a,b)=>a.d-b.d).slice(0,4).map(({o})=>({id:o.id,handle:o.b.handle,remaining:diameter*2}));
  this.well={point:{x:point.x,y:point.y,z:point.z},born:now,expires:now+2,targets,blocks,acceleration:Math.min(diameter*2,Math.max(0,(config.accelerationD??2)*diameter)),range};
  this.wellMesh.position.set(point.x,.035,point.z);this.wellMesh.scale.setScalar(Math.max(diameter,range*.35));this.wellMesh.visible=true;return this.well;
 }
 step(dt,now,bounds={},returnAcceleration=null) {
  dt=Math.max(0,Math.min(dt,.1));
  for(const echo of [...this.echoes]) {
   const p=echo.b.translation(),half=typeof bounds.tableHalf==='function'?bounds.tableHalf(p.z):(bounds.halfWidth??bounds.half??7);
   const bottom=bounds.bottom??bounds.BOTTOM??bounds.lossZ??Infinity,top=bounds.top??bounds.TOP??-Infinity;
   if(now>=echo.expires||p.y<(bounds.fallY??-2)||p.z>bottom+this.echoRadius||p.z<top-2||Math.abs(p.x)>half+this.echoRadius*3){this.removeEcho(echo);continue;}
   echo.b.resetForces(true);
   const a=typeof returnAcceleration==='function'?returnAcceleration(echo,p):returnAcceleration;
   if(a){const mass=echo.b.mass();echo.b.applyImpulse({x:(a.x||0)*mass*dt,y:(a.y||0)*mass*dt,z:(a.z||0)*mass*dt},true);}
  }
  const well=this.well;if(!well)return;
  if(now>=well.expires){this.well=null;this.wellMesh.visible=false;return;}
  for(const target of well.targets){
   const o=well.blocks.get(target.id);if(!this.intact(o)||o.b.handle!==target.handle||target.remaining<=0)continue;
   const p=o.b.translation(),dx=well.point.x-p.x,dy=well.point.y-p.y,dz=well.point.z-p.z,distance=Math.hypot(dx,dy,dz);if(distance<.01)continue;
   const dv=Math.min(target.remaining,well.acceleration*dt),scale=dv*o.b.mass()/distance;
   o.b.applyImpulse({x:dx*scale,y:dy*scale,z:dz*scale},true);target.remaining-=dv;
  }
  const age=(now-well.born)/2;this.wellMaterial.opacity=.7*(1-age);this.wellMesh.rotation.z=age*Math.PI;
 }
 // markMap keys are original IDs; values may be any active mark metadata.
 syncMarks(markMap,blocks) {
  const wanted=new Set(Array.isArray(markMap)?markMap.map(mark=>mark.originId):markMap.keys());
  for(const [id,mesh]of this.marks)if(!wanted.has(id)){mesh.visible=false;this.markPool.push(mesh);this.marks.delete(id);}
  for(const id of wanted){
   let largest=null;for(const o of blocks.values())if(o.origin?.id===id&&(!largest||(o.ids?.length||0)>(largest.ids?.length||0)))largest=o;
   if(!largest){const mesh=this.marks.get(id);if(mesh){mesh.visible=false;this.markPool.push(mesh);this.marks.delete(id);}continue;}
   let mesh=this.marks.get(id);if(!mesh){mesh=this.markPool.pop()||new this.THREE.Mesh(this.ringGeometry,this.iceMaterial);this.scene.add(mesh);this.marks.set(id,mesh);}
   mesh.visible=true;mesh.position.copy(largest.b.translation());mesh.quaternion.copy(largest.b.rotation());mesh.rotateX(Math.PI/2);mesh.scale.set(Math.max(.18,largest.sx*.72),Math.max(.18,largest.sz*.72),1);
  }
 }
 remap(fn){for(const echo of this.echoes){const p=new this.THREE.Vector3().copy(echo.b.translation());fn(p);echo.b.setTranslation(p,true);echo.mesh.position.copy(p);}if(this.well){const p=new this.THREE.Vector3().copy(this.well.point);fn(p);Object.assign(this.well.point,p);this.wellMesh.position.set(p.x,.035,p.z);}}
 render() {for(const echo of this.echoes){echo.mesh.position.copy(echo.b.translation());echo.mesh.quaternion.copy(echo.b.rotation());}}
 warmupObjects() {
  const group=new this.THREE.Group();group.add(new this.THREE.Mesh(this.echoGeometry,this.echoMaterial),new this.THREE.Mesh(this.ringGeometry,this.wellMaterial),new this.THREE.Mesh(this.ringGeometry,this.iceMaterial));return group;
 }
 clear() {
  for(const echo of [...this.echoes])this.removeEcho(echo,false);this.well=null;this.wellMesh.visible=false;
  for(const mesh of this.marks.values()){mesh.visible=false;this.markPool.push(mesh);}this.marks.clear();
 }
 dispose() {this.clear();this.wellMesh.removeFromParent();for(const mesh of this.markPool)mesh.removeFromParent();this.markPool.length=0;this.echoGeometry.dispose();this.ringGeometry.dispose();this.echoMaterial.dispose();this.wellMaterial.dispose();this.iceMaterial.dispose();}
}
