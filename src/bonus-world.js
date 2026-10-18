import { bombLandingPoint } from './bomb-placement.js';
import * as THREE from 'three';
import {createBonusVisuals} from './bonus-visuals.js';
import {BONUS_DEFS} from './bonus-controller.js';

const ARC_MAX_LINKS=64,ARC_SEGMENTS_PER_LINK=12;

// Container cores, collectible meshes and a small reusable effect pool.
// Pickups are visual bodies with analytic floor contact, never bumpers.
export class BonusWorld {
 constructor({scene,controller,radius,bounds,blocked,onSound,onNotice,onBomb=()=>{},onActivate=()=>{}}) {
  Object.assign(this,{scene,controller,radius,bounds,blocked,onSound,onNotice,onBomb,onActivate});
  this.visuals=createBonusVisuals(THREE);this.icons={pulse:"◎",pierce:"➤",arc:"ϟ",frost:"❄",split:"∴",gravity:"◉",heavy:"▾",bomb:"●",blackhole:"◉"};this.cores=new Map();this.pickups=[];this.time=0;this.seen=new Set();this.lastBall=null;this.collectorHistory=new Map();this.tip=null;this.tipAge=0;this.pendingTips=[];this.shadowGeometry=new THREE.CircleGeometry(.23,20);this.shadowMaterial=new THREE.MeshBasicMaterial({color:0x02050a,transparent:true,opacity:.3,depthWrite:false});
  this.label=document.createElement('div');this.label.className='power-tip';document.body.appendChild(this.label);
  this.hud=document.createElement('div');this.hud.id='power-hud';this.hud.setAttribute('aria-live','polite');document.body.appendChild(this.hud);this.hudKey='';
  this.accents={};for(const kind of Object.keys(BONUS_DEFS)){const m=this.visuals.createBallAccent(kind);m.visible=false;m.scale.setScalar(radius*2);scene.add(m);this.accents[kind]=m;}
  this.extraPulse=this.visuals.createPulseAccentBatch();scene.add(this.extraPulse);
  this.pulseRootMatrix=new THREE.Matrix4();this.pulseBandMatrices=[new THREE.Matrix4(),new THREE.Matrix4()];this.pulseInstanceMatrix=new THREE.Matrix4();
  this.bombTimerGeometry=new THREE.RingGeometry(.64,.7,80,1);this.bombTimerMaterial=new THREE.MeshBasicMaterial({color:0xff9438,transparent:true,opacity:.95,depthWrite:false,toneMapped:false});
  this.rings=Array.from({length:4},()=>{const m=new THREE.Mesh(new THREE.TorusGeometry(1,.018,5,64),new THREE.MeshBasicMaterial({color:0xffb44a,transparent:true,opacity:0,depthWrite:false,toneMapped:false}));m.rotation.x=-Math.PI/2;m.visible=false;scene.add(m);return {mesh:m,age:0,duration:.5,max:1};});
  // Each pooled LineSegments mesh holds 64 links; large arena bursts use chunks.
  // A branch has eight jagged trunk segments and two short forks: one draw per chunk.
  this.arcTubeGeometry=new THREE.CylinderGeometry(1,1,1,5,1,true);this.arcImpactGeometry=new THREE.IcosahedronGeometry(1,1);
  this.arcDummy=new THREE.Object3D();this.arcDirection=new THREE.Vector3();this.arcUp=new THREE.Vector3(0,1,0);
  this.arcs=Array.from({length:4},()=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(ARC_MAX_LINKS*ARC_SEGMENTS_PER_LINK*6),3));g.setDrawRange(0,0);const m=new THREE.LineSegments(g,new THREE.LineBasicMaterial({color:0xeee1ff,transparent:true,opacity:0,depthWrite:false,toneMapped:false}));
   const make=(geometry,count,color,opacity)=>{const mesh=new THREE.InstancedMesh(geometry,new THREE.MeshBasicMaterial({color,transparent:true,opacity,depthWrite:false,toneMapped:false,blending:THREE.AdditiveBlending}),count);mesh.count=0;mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);m.add(mesh);return mesh;};
   const core=make(this.arcTubeGeometry,ARC_MAX_LINKS*ARC_SEGMENTS_PER_LINK,0xcdb4ff,.95),halo=make(this.arcTubeGeometry,ARC_MAX_LINKS*ARC_SEGMENTS_PER_LINK,0x7946ff,.22),impacts=make(this.arcImpactGeometry,ARC_MAX_LINKS,0xb58bff,.75);
   m.visible=false;scene.add(m);return {mesh:m,core,halo,impacts,age:0,duration:.72};});
 }
 warmupObjects(){const group=this.visuals.warmupObjects();group.add(new THREE.Mesh(this.bombTimerGeometry,this.bombTimerMaterial));for(const fx of [...this.rings,...this.arcs]){const m=fx.mesh.clone();m.visible=true;m.traverse(o=>{if(o.isInstancedMesh){o.count=1;o.setMatrixAt(0,new THREE.Matrix4().makeScale(.05,.05,.05));o.instanceMatrix.needsUpdate=true;}});group.add(m);}return group;}
 teach(key,text,point){if(this.seen.has(key)||this.pendingTips.some(t=>t.key===key))return;const tip={key,text,point};if(this.tipAge>0){this.pendingTips.push(tip);return;}this.seen.add(key);this.tip=tip;this.tipAge=3;}
 feedback(text,point){const activation=/^(ARC |BLACK HOLE |TORNADO |BOMB |PULSE |PIERCE |SPLIT |HEAVY |FROST |ARENA FROZEN |BRITTLE )/.test(text);this.tip={key:'feedback',text,screenY:activation?.58:null,point:()=>this.currentBall||point};this.tipAge=activation?1.25:2.7;}
 dismissReadiness(kind){const name=BONUS_DEFS[kind]?.name.toUpperCase();const stale=t=>t&&(t.key==='power-'+kind||(t.text?.toUpperCase().includes(name)&&/READY|HIT GLASS/.test(t.text.toUpperCase())));this.pendingTips=this.pendingTips.filter(t=>!stale(t));if(stale(this.tip)){this.tip=null;this.tipAge=0;}}
 attach(origin){if(!Object.prototype.hasOwnProperty.call(BONUS_DEFS,origin.bonus))return;const mesh=this.visuals.createCore(origin.bonus);if(origin.bonusPose){mesh.position.copy(origin.bonusPose.p);mesh.quaternion.copy(origin.bonusPose.q);}this.scene.add(mesh);this.cores.set(origin.id,{origin,mesh});}
 dismiss(key){this.pendingTips=this.pendingTips.filter(t=>t.key!==key);if(this.tip?.key===key){this.tip=null;this.tipAge=0;}}
 capturePose(origin,body){origin.bonusPose={p:new THREE.Vector3().copy(body.translation()),q:new THREE.Quaternion().copy(body.rotation()),v:new THREE.Vector3().copy(body.linvel())};}
 release(origin){if(!Object.prototype.hasOwnProperty.call(BONUS_DEFS,origin.bonus)||origin.bonusReleased)return;origin.bonusReleased=true;this.dismiss('container');const core=this.cores.get(origin.id);if(core){this.cores.delete(origin.id);}
  const kind=origin.bonus,mesh=this.visuals.createModel(kind),scale=this.radius*2*1.3;mesh.scale.setScalar(scale);const box=new THREE.Box3().setFromObject(mesh),height=Math.max(.1,-box.min.y+.012),pose=origin.bonusPose;
  const p=pose?.p.clone()||new THREE.Vector3(0,1,this.bounds().mid-1),v=pose?.v.clone().multiplyScalar(.18)||new THREE.Vector3();v.clampLength(0,1.4);v.y=Math.max(v.y,.25);if(kind==='bomb'){v.x=0;v.z=0;}
  const aura=this.visuals.createPickupAura(kind);mesh.add(aura);
  const shadow=new THREE.Mesh(this.shadowGeometry,this.shadowMaterial);shadow.rotation.x=-Math.PI/2;shadow.position.set(p.x,.007,p.z);this.scene.add(shadow);const item={kind,cleanupNoScore:!!origin.cleanupNoScore,mesh,shadow,aura,releasedCore:core?.mesh||null,p,v,height,scale,landed:false,bounced:false,blockedFor:0,noticeAt:-10,returning:0};this.pickups.push(item);this.scene.add(mesh);mesh.position.copy(p);this.onSound('release');
  if(kind==='bomb'){item.fuseRemaining=BONUS_DEFS.bomb.countdown;item.timerRing=new THREE.Mesh(this.bombTimerGeometry.clone(),this.bombTimerMaterial);item.timerRing.rotation.x=-Math.PI/2;item.timerRing.visible=false;this.scene.add(item.timerRing);}
  if(!this.safe(p))this.returnItem(item);
 }
 safe(p){const b=this.bounds();return p.z>b.top+.8&&p.z<b.bottom-this.radius*3&&Math.abs(p.x)<b.half(p.z)-.7&&p.y>-.5;}
 safePoints(){const b=this.bounds(),span=b.bottom-b.mid;return [[0,b.mid+.75],[-.9,b.mid+span*.18],[.9,b.mid+span*.18],[0,b.mid+span*.35]].map(([x,z])=>new THREE.Vector3(x,.8,Math.min(z,b.bottom-this.radius*3.2)));}
 returnItem(item){if(item.kind==='bomb'){const landing=bombLandingPoint(item.p,this.bounds());item.from=item.p.clone();item.to=new THREE.Vector3(landing.x,Math.max(item.height,Math.min(item.p.y,.8)),landing.z);item.returning=.32;item.v.set(0,0,0);item.landed=false;item.bounced=false;item.blockedFor=0;return;}const points=this.safePoints().filter(p=>!this.blocked(p,.42));if(!points.length)return;points.sort((a,b)=>a.distanceToSquared(item.p)-b.distanceToSquared(item.p));item.from=item.p.clone();item.to=points[0];this.arc([item.from,item.to],BONUS_DEFS[item.kind].color);item.returning=.32;item.landed=false;item.bounced=false;item.blockedFor=0;item.v.set(0,0,0);}
 // Section changes discard uncollected physical items, but can retain independent
 // active timers, the armed Heavy strike and live Split state.
 reset({run=false,preservePowers=false}={}){for(const {mesh}of this.cores.values()){this.scene.remove(mesh);this.visuals.releaseInstance(mesh);}this.cores.clear();for(const p of this.pickups){this.disposeReleasedCore(p);this.scene.remove(p.mesh);this.visuals.releaseInstance(p.mesh);this.scene.remove(p.shadow);this.disposeTimer(p);}this.pickups.length=0;if(!preservePowers)this.controller.reset();this.lastBall=null;this.collectorHistory.clear();this.currentBall=null;this.tip=null;this.tipAge=0;this.pendingTips.length=0;this.label.style.opacity=0;this.activeId=null;this.hudKey='';for(const fx of [...this.rings,...this.arcs])fx.mesh.visible=false;this.clearExtraPulse();if(run)this.seen.clear();this.updateHUD();}
 clearExtraPulse(){this.extraPulse.visible=false;const data=this.extraPulse.userData.pulseBatch;data.core.count=data.halo.count=data.aura.count=0;}
 ensureExtraPulseCapacity(count){const old=this.extraPulse,data=old.userData.pulseBatch;if(count<=data.capacity)return;let capacity=data.capacity;while(capacity<count)capacity*=2;this.extraPulse=this.visuals.createPulseAccentBatch(capacity);this.scene.add(this.extraPulse);old.removeFromParent();this.visuals.releaseInstance(old);}
 renderExtraPulse(extraBalls){
  if(!this.accents.pulse.visible||!extraBalls.length){this.clearExtraPulse();return;}
  this.ensureExtraPulseCapacity(extraBalls.length);
  const data=this.extraPulse.userData.pulseBatch,template=this.accents.pulse,animation=template.userData.pulseAnimation,matrix=this.pulseInstanceMatrix;
  template.updateMatrix();this.pulseRootMatrix.copy(template.matrix).setPosition(0,0,0);
  for(let i=0;i<2;i++){animation.bands[i].updateMatrix();this.pulseBandMatrices[i].multiplyMatrices(this.pulseRootMatrix,animation.bands[i].matrix);}
  const auraDiameter=this.radius*2*animation.aura.scale.x;let count=0;
  for(const echo of extraBalls){
   if(!echo||echo.removed||echo.valid===false||!echo.b||typeof echo.b.translation!=='function'||(typeof echo.b.isValid==='function'&&!echo.b.isValid()))continue;
   const p=echo.b.translation();if(!Number.isFinite(p.x)||!Number.isFinite(p.y)||!Number.isFinite(p.z))continue;
   for(let band=0;band<2;band++){matrix.copy(this.pulseBandMatrices[band]).setPosition(p.x,p.y,p.z);data.core.setMatrixAt(count*2+band,matrix);data.halo.setMatrixAt(count*2+band,matrix);}
   matrix.makeScale(auraDiameter,auraDiameter,1).setPosition(p.x,p.y,p.z);data.aura.setMatrixAt(count++,matrix);
  }
  data.core.count=data.halo.count=count*2;data.aura.count=count;this.extraPulse.visible=count>0;
  for(const object of [data.core,data.halo,data.aura])object.instanceMatrix.needsUpdate=true;
 }
 dispose(){
  if(this.disposed)return;this.disposed=true;this.reset();
  for(const accent of Object.values(this.accents))accent.removeFromParent();
  this.extraPulse.removeFromParent();this.visuals.releaseInstance(this.extraPulse);
  const geometries=new Set([this.shadowGeometry,this.bombTimerGeometry,this.arcTubeGeometry,this.arcImpactGeometry]),materials=new Set([this.shadowMaterial,this.bombTimerMaterial]);
  for(const fx of [...this.rings,...this.arcs]){fx.mesh.removeFromParent();fx.mesh.traverse(object=>{if(object.geometry)geometries.add(object.geometry);if(object.material)materials.add(object.material);});this.visuals.releaseInstance(fx.mesh);}
  for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose();this.visuals.dispose();this.label.remove?.();this.hud.remove?.();
 }
 clearAutomatic(){for(let i=this.pickups.length-1;i>=0;i--){const item=this.pickups[i];if(!BONUS_DEFS[item.kind].automatic)continue;this.pickups.splice(i,1);this.disposeReleasedCore(item);this.disposeTimer(item);item.mesh.removeFromParent();this.visuals.releaseInstance(item.mesh);item.shadow.removeFromParent();}}
 disposeTimer(item){if(item.timerRing){item.timerRing.removeFromParent();item.timerRing.geometry.dispose();item.timerRing=null;}}
 disposeReleasedCore(item){if(item.releasedCore){this.scene.remove(item.releasedCore);this.visuals.releaseInstance(item.releasedCore);item.releasedCore=null;}}
 remap(fn){for(const p of this.pickups){fn(p.p);if(p.from)fn(p.from);if(p.to)fn(p.to);}this.lastBall=null;this.collectorHistory.clear();}
 pulse(point,radius,color=0xffb44a){const fx=this.rings.find(f=>!f.mesh.visible)||this.rings[0];fx.mesh.position.copy(point);fx.mesh.position.y=Math.max(.035,point.y);fx.max=radius;fx.age=0;fx.duration=.48;fx.mesh.material.color.set(color);fx.mesh.visible=true;}
 arc(points,color=0xb68cff){return this.drawArcs(points.slice(0,ARC_MAX_LINKS).map((a,i)=>[a,points[i+1]]).filter(([,b])=>b),color);}
 arcTargets(origin,targets,color=0xb68cff){return this.arcLinks(targets.map(target=>[origin,target]),color);}
 arcLinks(links,color=0xb68cff){
  // Reserve distinct pool entries before drawing, so a saturated pool never
  // overwrites the first chunk with the second chunk of the same activation.
  const pool=[...this.arcs].sort((a,b)=>Number(a.mesh.visible)-Number(b.mesh.visible)||b.age-a.age);let drawn=0;
  for(let i=0;i<pool.length&&drawn<links.length;i++){drawn+=this.drawArcs(links.slice(drawn,drawn+ARC_MAX_LINKS),color,pool[i]);}
  return drawn;
 }
 drawArcs(links,color,slot=null){if(!links.length)return 0;const fx=slot||this.arcs.find(f=>!f.mesh.visible)||this.arcs.reduce((oldest,f)=>f.age>oldest.age?f:oldest),data=fx.mesh.geometry.attributes.position;let vertex=0,instance=0;const dummy=this.arcDummy,dir=this.arcDirection;const segment=(a,b)=>{data.setXYZ(vertex++,a.x,a.y,a.z);data.setXYZ(vertex++,b.x,b.y,b.z);dir.subVectors(b,a);const length=dir.length();dummy.position.copy(a).add(b).multiplyScalar(.5);dummy.quaternion.setFromUnitVectors(this.arcUp,dir.normalize());dummy.scale.set(.025,length,.025);dummy.updateMatrix();fx.core.setMatrixAt(instance,dummy.matrix);dummy.scale.set(.105,length,.105);dummy.updateMatrix();fx.halo.setMatrixAt(instance++,dummy.matrix);};
  for(let i=0;i<Math.min(links.length,ARC_MAX_LINKS);i++){const [a,b]=links[i],distance=new THREE.Vector3().subVectors(b,a).length(),jitter=Math.min(.28,.06+distance*.032),height=Math.min(.85,.12+distance*.055),points=[];
   for(let j=0;j<=8;j++){const t=j/8,p=new THREE.Vector3().lerpVectors(a,b,t);if(j>0&&j<8){p.x+=Math.sin(j*7.1+i*2.3)*jitter;p.y+=Math.sin(t*Math.PI)*height+Math.cos(j*5.2+i)*jitter*.65;p.z+=Math.cos(j*6.3+i*3.1)*jitter;}points.push(p);if(j)segment(points[j-1],p);}
   dummy.position.copy(b);dummy.quaternion.identity();dummy.scale.setScalar(.18);dummy.updateMatrix();fx.impacts.setMatrixAt(i,dummy.matrix);
   for(const j of [3,6]){const root=points[j],sign=j===3?1:-1,mid=root.clone().add(new THREE.Vector3(sign*jitter*1.5,height*.3,jitter*.65)),end=mid.clone().add(new THREE.Vector3(sign*jitter*.65,-height*.12,-jitter*1.2));segment(root,mid);segment(mid,end);}
  }
  fx.core.count=fx.halo.count=instance;fx.impacts.count=Math.min(links.length,ARC_MAX_LINKS);for(const mesh of [fx.core,fx.halo,fx.impacts])mesh.instanceMatrix.needsUpdate=true;fx.core.material.color.set(color).lerp(new THREE.Color(0xffffff),.45);fx.halo.material.color.set(color);fx.impacts.material.color.set(color);
  data.needsUpdate=true;fx.mesh.geometry.setDrawRange(0,vertex);fx.mesh.geometry.computeBoundingSphere();fx.mesh.material.color.set(color);fx.mesh.material.opacity=1;fx.age=0;fx.mesh.visible=true;return Math.min(links.length,ARC_MAX_LINKS);
 }
 update(dt,ballPoint,ballVelocity,canCollect,clusters,extraCollectors=[],effectsPaused=false){this.time+=dt;this.currentBall=ballPoint;const collectors=[...(canCollect?[{id:'main',p:ballPoint,v:ballVelocity}]:[]),...extraCollectors].filter(c=>c.v.lengthSq()>.04).map(c=>({...c,p:new THREE.Vector3().copy(c.p),v:new THREE.Vector3().copy(c.v)}));
  // Snapshot both lists: activation may spawn balls, release pickups or clear the world.
  // New entities wait until the next sweep, and an item can only activate once.
  const pickupSweep=this.pickups.slice();
  for(const {origin,mesh}of this.cores.values()){let largest=null;for(const id of origin.clusters){const o=clusters.get(id);if(o&&(!largest||o.ids.length>largest.ids.length))largest=o;}if(largest){this.capturePose(origin,largest.b);mesh.position.copy(largest.b.translation());mesh.quaternion.copy(largest.b.rotation());this.visuals.animateCore(mesh,this.time);}}
  if(this.cores.size){const first=this.cores.values().next().value;this.teach('container','Break it to release a power',()=>first.mesh.position);}
  for(let n=pickupSweep.length-1;n>=0;n--){const item=pickupSweep[n],i=this.pickups.indexOf(item);if(i<0)continue;
   if(item.returning>0){item.returning=Math.max(0,item.returning-dt);const t=1-item.returning/.32;item.p.lerpVectors(item.from,item.to,t*t*(3-2*t));item.p.y+=Math.sin(t*Math.PI)*.25;}
   else if(!item.landed){item.v.y-=18*dt;item.p.addScaledVector(item.v,dt);if(!this.safe(item.p)){this.returnItem(item);continue;}if(item.p.y<=item.height){item.p.y=item.height;if(!item.bounced&&item.v.y<-.5){item.v.y=Math.min(1.1,-item.v.y*.13);item.v.x*=.2;item.v.z*=.2;item.bounced=true;}else{item.v.set(0,0,0);item.landed=true;this.onSound('land');this.pulse(item.p,.36,BONUS_DEFS[item.kind].color);this.teach(item.kind==='bomb'?'bomb-fuse':'pickup',item.kind==='bomb'?'Bomb armed · 3 seconds':'Collect to activate',()=>item.p);}}}
   else if(item.kind==='bomb'){
    if(!effectsPaused)item.fuseRemaining=Math.max(0,item.fuseRemaining-dt);
    item.timerRing.visible=true;item.timerRing.position.set(item.p.x,.035,item.p.z);item.timerRing.geometry.setDrawRange(0,Math.ceil(item.timerRing.geometry.index.count*item.fuseRemaining/BONUS_DEFS.bomb.countdown/3)*3);
    if(item.fuseRemaining<=0){const at=item.p.clone();this.pickups.splice(i,1);this.disposeReleasedCore(item);this.disposeTimer(item);this.scene.remove(item.mesh);this.visuals.releaseInstance(item.mesh);this.scene.remove(item.shadow);this.onBomb(at,{cleanupNoScore:item.cleanupNoScore});continue;}
   }else{if(this.blocked(item.p,.35))item.blockedFor+=dt;else item.blockedFor=0;if(item.blockedFor>2){this.returnItem(item);continue;}
    const collector=collectors.find(c=>{const start=this.collectorHistory.get(c.id)||c.p,delta=new THREE.Vector3().subVectors(c.p,start),t=delta.lengthSq()>0?THREE.MathUtils.clamp(new THREE.Vector3().subVectors(item.p,start).dot(delta)/delta.lengthSq(),0,1):0;return start.clone().addScaledVector(delta,t).distanceTo(item.p)<this.radius*3.6;});
    if(collector){const result=this.controller.collect(item.kind);if(result.accepted){
     this.dismiss('pickup');this.dismissReadiness(item.kind);this.disposeReleasedCore(item);this.scene.remove(item.mesh);this.visuals.releaseInstance(item.mesh);this.scene.remove(item.shadow);this.pickups.splice(i,1);
     const name=BONUS_DEFS[item.kind].name.toUpperCase(),status=item.kind==='heavy'?'ARMED · NEXT HIT':['pulse','pierce'].includes(item.kind)?'ACTIVE':'ACTIVATED';
     this.onSound('pickup');this.pulse(collector.p,.55,BONUS_DEFS[item.kind].color);
     const previousTip=this.tip;
     // Removed before dispatch: reentrant collection, Split creation and section
     // changes cannot activate this same pickup or its new children twice.
     this.onActivate({...result,kind:item.kind},collector.p.clone(),collector);
     // Main owns richer activation captions. Supply a fallback only if it did not.
     if(this.tip===previousTip)this.feedback(`${name} · ${status}`,collector.p);
     this.updateHUD();continue;
    }if(this.time-item.noticeAt>.75){this.onNotice(result.message);item.noticeAt=this.time;}}
   }
   item.mesh.position.copy(item.p);item.shadow.position.set(item.p.x,.007,item.p.z);item.shadow.visible=this.safe(item.p);item.shadow.scale.setScalar(2/Math.max(1,item.p.y*.7));item.mesh.rotation.y=Math.sin(this.time*.7)*.16;const born=Math.min(1,(this.time-(item.spawnTime??(item.spawnTime=this.time)))/.38);item.mesh.scale.setScalar(item.scale*(1-Math.pow(1-born,3)));this.visuals.animateCore(item.aura,this.time);if(item.kind==='bomb')this.visuals.animateCore(item.mesh,this.time);if(item.releasedCore){item.releasedCore.position.copy(item.p);item.releasedCore.scale.setScalar(Math.pow(1-born,2));this.visuals.animateCore(item.releasedCore,this.time);if(born>=1)this.disposeReleasedCore(item);}
  }
  this.lastBall=canCollect?ballPoint.clone():null;this.collectorHistory=new Map(collectors.map(c=>[c.id,c.p.clone()]));
  for(const fx of this.rings){if(!fx.mesh.visible)continue;fx.age+=dt;const t=fx.age/fx.duration;if(t>=1){fx.mesh.visible=false;continue;}fx.mesh.scale.setScalar(.05+fx.max*t);fx.mesh.material.opacity=(1-t)*.85;}
  for(const fx of this.arcs){if(!fx.mesh.visible)continue;fx.age+=dt;const fade=Math.max(0,1-fx.age/fx.duration),restrike=.68+.32*Math.pow(Math.cos(fx.age*29),2);fx.mesh.material.opacity=fade*restrike;fx.core.material.opacity=fade*restrike*.95;fx.halo.material.opacity=fade*restrike*.28;fx.impacts.material.opacity=fade*(.45+.4*Math.pow(Math.cos(fx.age*38),2));if(fx.age>=fx.duration)fx.mesh.visible=false;}
  this.tipAge-=dt;if(this.tipAge<=0&&this.pendingTips.length){const next=this.pendingTips.shift();this.seen.add(next.key);this.tip=next;this.tipAge=3;}this.updateHUD();
 }
 updateHUD(){
  const h=this.controller.snapshotHUD(),effects=h.activeEffects||[];
  const entries=effects.filter(a=>BONUS_DEFS[a.kind]);
  const heavy=h.heavy||h.heavyArmed;
  if(heavy&&!entries.some(a=>a.kind==='heavy'))entries.push(typeof heavy==='object'?{...heavy,kind:'heavy'}:{kind:'heavy',name:BONUS_DEFS.heavy.name,secondsLeft:null});
  const key=entries.map(a=>[a.kind,a.exiting,a.remaining??a.charges??'',Number.isFinite(a.secondsLeft)?Math.ceil(a.secondsLeft):''].join(':')).join('|')+'|split:'+Boolean(h.splitActive);
  if(key===this.hudKey)return;this.hudKey=key;this.hud.replaceChildren();
  const add=(kind,text)=>{const def=BONUS_DEFS[kind],el=document.createElement('span');el.className='power-slot';el.title=def.description;el.setAttribute('aria-label',`${text}. ${def.description}`);el.style.setProperty('--power',`#${def.color.toString(16).padStart(6,'0')}`);const icon=document.createElement('b');icon.className='power-icon';icon.textContent=this.icons[kind];el.append(icon,document.createTextNode(text));this.hud.appendChild(el);};
  for(const a of entries){const hits=Math.max(1,a.remaining??a.charges??1),status=a.kind==='heavy'?(hits===1?'1 NEXT HIT':`${hits} HITS`):a.exiting?'EXITING':'ACTIVE',timer=Number.isFinite(a.secondsLeft)&&!a.exiting?` · ${Math.ceil(Math.max(0,a.secondsLeft))}s`:'';add(a.kind,`${(a.name||BONUS_DEFS[a.kind].name).toUpperCase()} · ${status}${timer}`);}
  if(h.splitActive&&!entries.some(a=>a.kind==='split'))add('split','SPLIT · EXTRA BALLS LIVE');
 }
 render(camera,ballPoint,extraBalls=[]){const h=this.controller.snapshotHUD(),active=new Map((h.activeEffects||[]).map(a=>[a.kind,a]));if((h.heavy||h.heavyArmed)&&!active.has('heavy'))active.set('heavy',{kind:'heavy'});
  for(const [kind,mesh]of Object.entries(this.accents)){const a=active.get(kind);mesh.visible=kind==='split'?(Boolean(h.splitActive)||Boolean(a)):Boolean(a);mesh.position.copy(ballPoint);mesh.rotation.y=this.time*.6;if(mesh.visible)this.visuals.animateBallAccent(mesh,this.time);if(kind==='pierce'||kind==='frost'){const duration=BONUS_DEFS[kind].duration,fraction=a?Math.max(0,Number.isFinite(a.secondsLeft)?a.secondsLeft:duration)/duration:0;mesh.userData.charges?.forEach((segment,i,all)=>segment.visible=i/all.length<fraction);}}
  this.renderExtraPulse(extraBalls);
  if(this.tip&&this.tipAge>0){const point=typeof this.tip.point==='function'?this.tip.point():this.tip.point;if(point){const p=point.clone().add(new THREE.Vector3(0,.5,0));p.z+=this.scene.position.z;p.project(camera);this.label.textContent=this.tip.text;this.label.style.left=`${THREE.MathUtils.clamp((p.x+1)*innerWidth/2,85,innerWidth-85)}px`;this.label.style.top=`${this.tip.screenY?innerHeight*this.tip.screenY:THREE.MathUtils.clamp((1-p.y)*innerHeight/2,100,innerHeight-110)}px`;this.label.style.opacity=p.z<1?1:0;}}else this.label.style.opacity=0;
 }
}
