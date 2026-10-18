import * as THREE from 'three';
import {createBonusVisuals} from './bonus-visuals.js';
import {BONUS_DEFS} from './bonus-controller.js';

const ARC_MAX_LINKS=64,ARC_SEGMENTS_PER_LINK=12;

// Container cores, collectible meshes and a small reusable effect pool.
// Pickups are visual bodies with analytic floor contact, never bumpers.
export class BonusWorld {
 constructor({scene,controller,radius,bounds,blocked,onSound,onNotice}) {
  Object.assign(this,{scene,controller,radius,bounds,blocked,onSound,onNotice});
  this.visuals=createBonusVisuals(THREE);this.icons={pulse:"◎",pierce:"➤",arc:"ϟ",halo:"∩",frost:"❄",split:"∴",gravity:"◉",heavy:"▾"};this.cores=new Map();this.pickups=[];this.time=0;this.seen=new Set();this.lastBall=null;this.collectorHistory=new Map();this.tip=null;this.tipAge=0;this.pendingTips=[];this.shadowGeometry=new THREE.CircleGeometry(.23,20);this.shadowMaterial=new THREE.MeshBasicMaterial({color:0x02050a,transparent:true,opacity:.3,depthWrite:false});
  this.label=document.createElement('div');this.label.className='power-tip';document.body.appendChild(this.label);
  this.hud=document.createElement('div');this.hud.id='power-hud';this.hud.setAttribute('aria-live','polite');document.body.appendChild(this.hud);this.hudKey='';
  this.accents={};for(const kind of Object.keys(BONUS_DEFS)){const m=this.visuals.createBallAccent(kind);m.visible=false;m.scale.setScalar(radius*2);scene.add(m);this.accents[kind]=m;}
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
 warmupObjects(){const group=this.visuals.warmupObjects();for(const fx of [...this.rings,...this.arcs]){const m=fx.mesh.clone();m.visible=true;m.traverse(o=>{if(o.isInstancedMesh){o.count=1;o.setMatrixAt(0,new THREE.Matrix4().makeScale(.05,.05,.05));o.instanceMatrix.needsUpdate=true;}});group.add(m);}return group;}
 teach(key,text,point){if(this.seen.has(key)||this.pendingTips.some(t=>t.key===key))return;const tip={key,text,point};if(this.tipAge>0){this.pendingTips.push(tip);return;}this.seen.add(key);this.tip=tip;this.tipAge=3;}
 feedback(text,point){const arc=text.startsWith('ARC STORM');this.tip={key:'feedback',text,screenY:arc?.58:null,point:()=>this.currentBall||point};this.tipAge=arc?1.25:2.7;}
 attach(origin){if(!origin.bonus)return;const mesh=this.visuals.createCore(origin.bonus);if(origin.bonusPose){mesh.position.copy(origin.bonusPose.p);mesh.quaternion.copy(origin.bonusPose.q);}this.scene.add(mesh);this.cores.set(origin.id,{origin,mesh});}
 dismiss(key){this.pendingTips=this.pendingTips.filter(t=>t.key!==key);if(this.tip?.key===key){this.tip=null;this.tipAge=0;}}
 capturePose(origin,body){origin.bonusPose={p:new THREE.Vector3().copy(body.translation()),q:new THREE.Quaternion().copy(body.rotation()),v:new THREE.Vector3().copy(body.linvel())};}
 release(origin){if(!origin.bonus||origin.bonusReleased)return;origin.bonusReleased=true;this.dismiss('container');const core=this.cores.get(origin.id);if(core){this.cores.delete(origin.id);}
  const kind=origin.bonus,mesh=this.visuals.createModel(kind),scale=this.radius*2*1.3;mesh.scale.setScalar(scale);const box=new THREE.Box3().setFromObject(mesh),height=Math.max(.1,-box.min.y+.012),pose=origin.bonusPose;
  const p=pose?.p.clone()||new THREE.Vector3(0,1,this.bounds().mid-1),v=pose?.v.clone().multiplyScalar(.18)||new THREE.Vector3();v.clampLength(0,1.4);v.y=Math.max(v.y,.25);
  const aura=this.visuals.createPickupAura(kind);mesh.add(aura);
  const shadow=new THREE.Mesh(this.shadowGeometry,this.shadowMaterial);shadow.rotation.x=-Math.PI/2;shadow.position.set(p.x,.007,p.z);this.scene.add(shadow);const item={kind,mesh,shadow,aura,releasedCore:core?.mesh||null,p,v,height,scale,landed:false,bounced:false,blockedFor:0,noticeAt:-10,returning:0};this.pickups.push(item);this.scene.add(mesh);mesh.position.copy(p);this.onSound('release');
  if(!this.safe(p))this.returnItem(item);
 }
 safe(p){const b=this.bounds();return p.z>b.top+.8&&p.z<b.bottom-this.radius*3&&Math.abs(p.x)<b.half(p.z)-.7&&p.y>-.5;}
 safePoints(){const b=this.bounds(),span=b.bottom-b.mid;return [[0,b.mid+.75],[-.9,b.mid+span*.18],[.9,b.mid+span*.18],[0,b.mid+span*.35]].map(([x,z])=>new THREE.Vector3(x,.8,Math.min(z,b.bottom-this.radius*3.2)));}
 returnItem(item){const points=this.safePoints().filter(p=>!this.blocked(p,.42));if(!points.length)return;points.sort((a,b)=>a.distanceToSquared(item.p)-b.distanceToSquared(item.p));item.from=item.p.clone();item.to=points[0];this.arc([item.from,item.to],BONUS_DEFS[item.kind].color);item.returning=.32;item.landed=false;item.bounced=false;item.blockedFor=0;item.v.set(0,0,0);}
 // Section changes discard uncollected physical items, but can retain ready powers,
 // active timers, FIFO, Halo and the independent live Split state.
 reset({run=false,preservePowers=false}={}){for(const {mesh}of this.cores.values()){this.scene.remove(mesh);this.visuals.releaseInstance(mesh);}this.cores.clear();for(const p of this.pickups){this.disposeReleasedCore(p);this.scene.remove(p.mesh);this.visuals.releaseInstance(p.mesh);this.scene.remove(p.shadow);}this.pickups.length=0;if(!preservePowers)this.controller.reset();this.lastBall=null;this.collectorHistory.clear();this.currentBall=null;this.tip=null;this.tipAge=0;this.pendingTips.length=0;this.label.style.opacity=0;this.activeId=null;this.hudKey='';for(const fx of [...this.rings,...this.arcs])fx.mesh.visible=false;if(run)this.seen.clear();this.updateHUD();}
 disposeReleasedCore(item){if(item.releasedCore){this.scene.remove(item.releasedCore);this.visuals.releaseInstance(item.releasedCore);item.releasedCore=null;}}
 remap(fn){for(const p of this.pickups){fn(p.p);if(p.from)fn(p.from);if(p.to)fn(p.to);}this.lastBall=null;this.collectorHistory.clear();}
 pulse(point,radius,color=0xffb44a){const fx=this.rings.find(f=>!f.mesh.visible)||this.rings[0];fx.mesh.position.copy(point);fx.mesh.position.y=Math.max(.035,point.y);fx.max=radius;fx.age=0;fx.duration=.48;fx.mesh.material.color.set(color);fx.mesh.visible=true;}
 arc(points,color=0xb68cff){return this.drawArcs(points.slice(0,ARC_MAX_LINKS).map((a,i)=>[a,points[i+1]]).filter(([,b])=>b),color);}
 arcTargets(origin,targets,color=0xb68cff){
  // Reserve distinct pool entries before drawing, so a saturated pool never
  // overwrites the first chunk with the second chunk of the same activation.
  const pool=[...this.arcs].sort((a,b)=>Number(a.mesh.visible)-Number(b.mesh.visible)||b.age-a.age);let drawn=0;
  for(let i=0;i<pool.length&&drawn<targets.length;i++){const links=targets.slice(drawn,drawn+ARC_MAX_LINKS).map(target=>[origin,target]);drawn+=this.drawArcs(links,color,pool[i]);}
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
 update(dt,ballPoint,ballVelocity,canCollect,clusters,extraCollectors=[]){this.time+=dt;this.currentBall=ballPoint;const collectors=[...(canCollect?[{id:'main',p:ballPoint,v:ballVelocity}]:[]),...extraCollectors].filter(c=>c.v.lengthSq()>.04);
  for(const {origin,mesh}of this.cores.values()){let largest=null;for(const id of origin.clusters){const o=clusters.get(id);if(o&&(!largest||o.ids.length>largest.ids.length))largest=o;}if(largest){this.capturePose(origin,largest.b);mesh.position.copy(largest.b.translation());mesh.quaternion.copy(largest.b.rotation());this.visuals.animateCore(mesh,this.time);}}
  if(this.cores.size){const first=this.cores.values().next().value;this.teach('container','Break it to release a power',()=>first.mesh.position);}
  for(let i=this.pickups.length-1;i>=0;i--){const item=this.pickups[i];
   if(item.returning>0){item.returning=Math.max(0,item.returning-dt);const t=1-item.returning/.32;item.p.lerpVectors(item.from,item.to,t*t*(3-2*t));item.p.y+=Math.sin(t*Math.PI)*.25;}
   else if(!item.landed){item.v.y-=18*dt;item.p.addScaledVector(item.v,dt);if(!this.safe(item.p)){this.returnItem(item);continue;}if(item.p.y<=item.height){item.p.y=item.height;if(!item.bounced&&item.v.y<-.5){item.v.y=Math.min(1.1,-item.v.y*.13);item.v.x*=.2;item.v.z*=.2;item.bounced=true;}else{item.v.set(0,0,0);item.landed=true;this.onSound('land');this.pulse(item.p,.36,BONUS_DEFS[item.kind].color);this.teach('pickup','Hit the pickup',()=>item.p);}}}
   else{if(this.blocked(item.p,.35))item.blockedFor+=dt;else item.blockedFor=0;if(item.blockedFor>2){this.returnItem(item);continue;}
    const collector=collectors.find(c=>{const start=this.collectorHistory.get(c.id)||c.p,delta=new THREE.Vector3().subVectors(c.p,start),t=delta.lengthSq()>0?THREE.MathUtils.clamp(new THREE.Vector3().subVectors(item.p,start).dot(delta)/delta.lengthSq(),0,1):0;return start.clone().addScaledVector(delta,t).distanceTo(item.p)<this.radius*3.6;});
    if(collector){const result=this.controller.collect(item.kind);if(result.accepted){this.dismiss('pickup');this.disposeReleasedCore(item);this.scene.remove(item.mesh);this.visuals.releaseInstance(item.mesh);this.scene.remove(item.shadow);this.pickups.splice(i,1);this.onSound('pickup');this.onNotice(result.message);this.pulse(collector.p,.55,BONUS_DEFS[item.kind].color);this.feedback(result.slot==='queued'?`${BONUS_DEFS[item.kind].name.toUpperCase()} QUEUED · Use active power first`:item.kind==='halo'?'HALO READY · Saves your next fall':`${BONUS_DEFS[item.kind].name.toUpperCase()} READY · HIT GLASS`,ballPoint);this.teach('power-'+item.kind,BONUS_DEFS[item.kind].description,()=>this.currentBall);this.updateHUD();continue;}if(this.time-item.noticeAt>.75){this.onNotice(result.message);item.noticeAt=this.time;}}
   }
   item.mesh.position.copy(item.p);item.shadow.position.set(item.p.x,.007,item.p.z);item.shadow.visible=this.safe(item.p);item.shadow.scale.setScalar(2/Math.max(1,item.p.y*.7));item.mesh.rotation.y=Math.sin(this.time*.7)*.16;const born=Math.min(1,(this.time-(item.spawnTime??(item.spawnTime=this.time)))/.38);item.mesh.scale.setScalar(item.scale*(1-Math.pow(1-born,3)));this.visuals.animateCore(item.aura,this.time);if(item.releasedCore){item.releasedCore.position.copy(item.p);item.releasedCore.scale.setScalar(Math.pow(1-born,2));this.visuals.animateCore(item.releasedCore,this.time);if(born>=1)this.disposeReleasedCore(item);}
  }
  this.lastBall=canCollect?ballPoint.clone():null;this.collectorHistory=new Map(collectors.map(c=>[c.id,c.p.clone()]));
  for(const fx of this.rings){if(!fx.mesh.visible)continue;fx.age+=dt;const t=fx.age/fx.duration;if(t>=1){fx.mesh.visible=false;continue;}fx.mesh.scale.setScalar(.05+fx.max*t);fx.mesh.material.opacity=(1-t)*.85;}
  for(const fx of this.arcs){if(!fx.mesh.visible)continue;fx.age+=dt;const fade=Math.max(0,1-fx.age/fx.duration),restrike=.68+.32*Math.pow(Math.cos(fx.age*29),2);fx.mesh.material.opacity=fade*restrike;fx.core.material.opacity=fade*restrike*.95;fx.halo.material.opacity=fade*restrike*.28;fx.impacts.material.opacity=fade*(.45+.4*Math.pow(Math.cos(fx.age*38),2));if(fx.age>=fx.duration)fx.mesh.visible=false;}
  this.tipAge-=dt;if(this.tipAge<=0&&this.pendingTips.length){const next=this.pendingTips.shift();this.seen.add(next.key);this.tip=next;this.tipAge=3;}this.updateHUD();
 }
 updateHUD(){const h=this.controller.snapshotHUD(),key=[this.controller.active?.id,h.active?.kind,h.active?.exiting,h.active?.started,h.active?.secondsLeft===null?null:Math.ceil(h.active?.secondsLeft),h.queued?.kind,h.halo,h.splitActive].join('|');if(key===this.hudKey)return;const activeId=this.controller.active?.id;if(activeId&&activeId!==this.activeId&&this.activeId){this.pendingTips.unshift({key:'ready-'+activeId,text:`${BONUS_DEFS[h.active.kind].name.toUpperCase()} READY · HIT GLASS`,point:()=>this.currentBall});}this.activeId=activeId;this.hudKey=key;this.hud.replaceChildren();const add=(kind,text,cls='')=>{const el=document.createElement('span');el.className='power-slot '+cls;el.title=BONUS_DEFS[kind].description;el.setAttribute('aria-label',`${text}. ${BONUS_DEFS[kind].description}`);el.style.setProperty('--power',`#${BONUS_DEFS[kind].color.toString(16).padStart(6,'0')}`);const icon=document.createElement('b');icon.className='power-icon';icon.textContent=this.icons[kind];el.append(icon,document.createTextNode(text));this.hud.appendChild(el);};
  if(h.active){const a=h.active,status=a.exiting?'EXITING':a.started?(a.kind==='frost'?'MARKING':'ACTIVE'):'HIT GLASS',timer=a.secondsLeft!==null&&!a.exiting?` · ${Math.ceil(a.secondsLeft)}s`:'';add(a.kind,`${a.name.toUpperCase()} · ${status}${timer}`);}
  if(h.queued)add(h.queued.kind,`NEXT · ${h.queued.name}${h.queued.secondsLeft!==null?' · '+Math.ceil(h.queued.secondsLeft)+'s':''}`,'queued');if(h.splitActive)add('split','SPLIT · EXTRA BALLS LIVE');if(h.halo)add('halo','HALO · 1 SAVE');
 }
 render(camera,ballPoint){const h=this.controller.snapshotHUD();for(const [kind,mesh]of Object.entries(this.accents)){mesh.visible=kind==='halo'?h.halo:kind==='split'?(h.splitActive||h.active?.kind==='split'):h.active?.kind===kind;mesh.position.copy(ballPoint);mesh.rotation.y=this.time*.6;if(kind==='pierce'||kind==='frost'){const duration=BONUS_DEFS[kind].duration,fraction=h.active?.kind===kind?Math.max(0,h.active.secondsLeft)/duration:0;mesh.userData.charges?.forEach((segment,i,all)=>segment.visible=i/all.length<fraction);}}
  if(this.tip&&this.tipAge>0){const point=typeof this.tip.point==='function'?this.tip.point():this.tip.point;if(point){const p=point.clone().add(new THREE.Vector3(0,.5,0));p.z+=this.scene.position.z;p.project(camera);this.label.textContent=this.tip.text;this.label.style.left=`${THREE.MathUtils.clamp((p.x+1)*innerWidth/2,85,innerWidth-85)}px`;this.label.style.top=`${this.tip.screenY?innerHeight*this.tip.screenY:THREE.MathUtils.clamp((1-p.y)*innerHeight/2,100,innerHeight-110)}px`;this.label.style.opacity=p.z<1?1:0;}}else this.label.style.opacity=0;
 }
}
