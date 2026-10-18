import {Box3,Quaternion,Vector3} from 'three';

// Precise glass remains hittable by both main and extra balls. Only contacts
// with the environment use the temporary, massless bounding proxy.
const BALLS=0x12,ENVIRONMENT=0x5,STRUCTURE=0x4;
export class CaptureCollisionProxy {
 constructor({RAPIER,world,colliders}){this.RAPIER=RAPIER;this.world=world;this.colliders=colliders;this.entries=new Map();}
 bounds(o){
  const box=new Box3(),point=new Vector3();let complete=true;
  for(const c of o.cs){
   if(!c.isValid()){complete=false;break;}
   const p=c.translationWrtParent(),r=c.rotationWrtParent();if(!p||!r){complete=false;break;}
   const q=new Quaternion(r.x,r.y,r.z,r.w),add=(x,y,z)=>box.expandByPoint(point.set(x,y,z).applyQuaternion(q).add(p));
   if(c.shapeType()===this.RAPIER.ShapeType.Cuboid){const h=c.halfExtents();for(const x of [-h.x,h.x])for(const y of [-h.y,h.y])for(const z of [-h.z,h.z])add(x,y,z);}
   else if(c.shapeType()===this.RAPIER.ShapeType.ConvexPolyhedron){const v=c.vertices();if(!v?.length){complete=false;break;}for(let i=0;i<v.length;i+=3)add(v[i],v[i+1],v[i+2]);}
   else{complete=false;break;}
  }
  if(!complete||box.isEmpty()){
   const g=o.mesh?.geometry;if(!g)return null;g.computeBoundingBox();if(!g.boundingBox)return null;box.copy(g.boundingBox);
  }
  if(box.isEmpty()||![...box.min.toArray(),...box.max.toArray()].every(Number.isFinite))return null;
  return {center:box.getCenter(new Vector3()),half:box.getSize(new Vector3()).multiplyScalar(.5)};
 }
 sync(fields,blocks){
  const desired=new Map();
  for(const field of (Array.isArray(fields)?fields:[fields])){
   if(!field||field.active===false||field.blocks!==blocks)continue;
   for(const target of field.targets||[]){
    const o=blocks.get(target.id),b=o?.b;
    if(o?.kind!=='block'||!b?.isValid()||!b.isDynamic()||b!==target.body||target.handle!==undefined&&target.handle!==b.handle||!o.cs?.length||o.cs.some(c=>!c.isValid()))continue;
    if(field.kind!=='tornado'&&field.kind!=='capture-release'){
     const p=b.worldCom(),range=field.radius??field.range;
     if(!field.point||!Number.isFinite(range)||Math.hypot(p.x-field.point.x,p.y-field.point.y,p.z-field.point.z)>range)continue;
    }
    let owners=desired.get(o);if(!owners)desired.set(o,owners=new Set());owners.add(field);
   }
  }
  for(const [o,entry] of this.entries)if(!desired.has(o)||entry.body!==o.b||!entry.proxy.isValid()||entry.originals.length!==o.cs?.length||entry.originals.some(({collider},i)=>collider!==o.cs[i]))this.release(o);
  for(const [o,owners] of desired){
   let entry=this.entries.get(o);
   if(!entry){
    const bounds=this.bounds(o);if(!bounds)continue;
    const {center,half}=bounds;
    const desc=this.RAPIER.ColliderDesc.cuboid(Math.max(.001,half.x),Math.max(.001,half.y),Math.max(.001,half.z))
     .setTranslation(center.x,center.y,center.z).setMass(0).setCollisionGroups((STRUCTURE<<16)|ENVIRONMENT)
     .setSolverGroups((STRUCTURE<<16)|ENVIRONMENT).setRestitution(o.cs[0].restitution()).setActiveEvents(this.RAPIER.ActiveEvents.COLLISION_EVENTS);
    const proxy=this.world.createCollider(desc,o.b),originals=o.cs.map(collider=>({collider,groups:collider.collisionGroups()}));
    entry={body:o.b,proxy,originals,owners};this.entries.set(o,entry);this.colliders.set(proxy.handle,o);
    for(const {collider,groups} of originals)collider.setCollisionGroups(((groups>>>16)<<16)|((groups&0xffff)&BALLS));
   }
   entry.owners=owners;
   // SecondaryPowers owns restoration of the original friction leases. Mirror
   // their current value without participating in or disturbing that lifecycle.
   entry.proxy.setFriction(o.cs[0].friction());entry.proxy.setFrictionCombineRule(o.cs[0].frictionCombineRule());
  }
 }
 release(o){
  const entry=this.entries.get(o);if(!entry)return;
  this.entries.delete(o);
  for(const {collider,groups} of entry.originals)if(collider.isValid()&&this.world.getCollider(collider.handle)===collider)collider.setCollisionGroups(groups);
  if(this.colliders.get(entry.proxy.handle)===o)this.colliders.delete(entry.proxy.handle);
  if(entry.proxy.isValid()&&this.world.getCollider(entry.proxy.handle)===entry.proxy)this.world.removeCollider(entry.proxy,true);
 }
 reset(){for(const o of [...this.entries.keys()])this.release(o);}
}
