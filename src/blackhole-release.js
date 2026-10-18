import {Quaternion,Vector3} from 'three';

// Natural expiry retains collision/damage ownership, never attraction or VFX.
export class BlackHoleRelease {
 constructor({proxyManager,batchSize=8,interval=.15,kickSpeed=.9}={}){
  this.proxyManager=proxyManager;this.batchSize=Math.max(1,Math.min(8,Math.floor(batchSize)||8));this.interval=Math.max(.15,interval||.15);this.kickSpeed=Math.max(0,Math.min(2,kickSpeed));
  this.pending=new Map();this.handled=new WeakSet();this.nextReleaseAt=null;this.field=null;
 }
 valid(o,target,blocks){return blocks?.get(target.id)===o&&o?.kind==='block'&&o.b===target.body&&o.b?.isValid()&&o.b.isDynamic()&&(target.handle===undefined||o.b.handle===target.handle)&&o.cs?.length&&o.cs.every(c=>c.isValid());}
 bottom(o){
  const bounds=this.proxyManager?.bounds(o);if(!bounds)return o.b.worldCom().y;
  const q=new Quaternion().copy(o.b.rotation()),p=new Vector3(),translation=o.b.translation();let bottom=Infinity;
  for(const x of [-bounds.half.x,bounds.half.x])for(const y of [-bounds.half.y,bounds.half.y])for(const z of [-bounds.half.z,bounds.half.z])bottom=Math.min(bottom,p.set(x,y,z).add(bounds.center).applyQuaternion(q).y+translation.y);
  return bottom;
 }
 beginNaturalExpiry(hole,now,releaseTime=now){
  if(!hole||this.handled.has(hole)||hole.active===false||!Number.isFinite(now)||!Number.isFinite(hole.expires)||now<hole.expires||!hole.blocks||!hole.point)return;
  this.handled.add(hole);const bodies=new Set();let added=false;
  for(const target of hole.targets||[]){
   const o=hole.blocks.get(target.id);if(!this.valid(o,target,hole.blocks)||bodies.has(o.b))continue;
   const p=o.b.worldCom(),range=hole.radius??hole.range;
   if(!Number.isFinite(range)||Math.hypot(p.x-hole.point.x,p.y-hole.point.y,p.z-hole.point.z)>range)continue;
   bodies.add(o.b);
   // A horizontal radial nudge leaves vertical landing dynamics intact. At the
   // exact axis there is no radial direction, so choose a stable body direction.
   const dx=p.x-hole.point.x,dz=p.z-hole.point.z,d=Math.hypot(dx,dz),angle=(Number(o.id)||0)*2.399963229728653;
   const mass=o.b.mass(),speed=this.kickSpeed;
   o.b.applyImpulse({x:(d>1e-6?dx/d:Math.cos(angle))*speed*mass,y:0,z:(d>1e-6?dz/d:Math.sin(angle))*speed*mass},true);
   this.pending.set(o,{o,target:{id:o.id,body:o.b,handle:o.b.handle},blocks:hole.blocks,height:this.bottom(o)});added=true;
  }
  if(added&&this.nextReleaseAt===null)this.nextReleaseAt=(Number.isFinite(releaseTime)?releaseTime:now)+this.interval;
 }
 step(now,blocks){
  for(const [o,item] of this.pending)if(item.blocks!==blocks||!this.valid(o,item.target,blocks))this.pending.delete(o);
  if(this.pending.size&&Number.isFinite(now)&&now+1e-9>=this.nextReleaseAt){
   // One bounded batch per step, even after a long pause. Never catch up all
   // missed intervals in a single expensive restoration frame.
   const sorted=[...this.pending.values()].sort((a,b)=>a.height-b.height||a.o.id-b.o.id);
   for(const item of sorted.slice(0,this.batchSize))this.pending.delete(item.o);
   this.nextReleaseAt=this.pending.size?now+this.interval:null;
  }
  if(!this.pending.size){this.nextReleaseAt=null;this.field=null;return null;}
  this.field={kind:'capture-release',releaseOnly:true,active:true,blocks,targets:[...this.pending.values()].map(item=>item.target)};
  return this.field;
 }
 release(o){this.pending.delete(o);if(this.field)this.field.targets=this.field.targets.filter(target=>target.body!==o.b);if(!this.pending.size){this.nextReleaseAt=null;this.field=null;}}
 reset(){this.pending.clear();this.nextReleaseAt=null;this.field=null;}
}
