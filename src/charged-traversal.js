// Charged shots keep normal collision events but ignore structure solver forces.
// This module owns traversal identity only; the caller owns solver groups and
// ordinary Pierce priority. It never changes a body's velocity or colliders.
const validBody=body=>!!body&&typeof body.isValid==='function'&&body.isValid();
const freeBody=body=>validBody(body)&&(typeof body.isDynamic!=='function'||body.isDynamic());
const originId=origin=>origin&&typeof origin==='object'?origin.id:origin;
const values=collection=>collection?.values?.()||collection||[];

// A sphere against the cluster's original oriented shell volume, not individual
// fracture panels: leaving one panel does not finish a traversal of the cube.
export function sphereOverlapsShell(body,radius,block,padding=.04){
 if(!validBody(body)||!validBody(block?.b))return false;
 const sx=block.sx??block.origin?.sx,sy=block.sy??block.origin?.sy,sz=block.sz??block.origin?.sz;
 if(![sx,sy,sz,radius].every(Number.isFinite)||Math.min(sx,sy,sz)<=0||radius<0)return false;
 const p=body.translation(),c=block.b.translation(),q=block.b.rotation(),dx=p.x-c.x,dy=p.y-c.y,dz=p.z-c.z;
 // Rotate by the inverse of Rapier's normalized world quaternion.
 const tx=2*(-q.y*dz+q.z*dy),ty=2*(-q.z*dx+q.x*dz),tz=2*(-q.x*dy+q.y*dx);
 const x=dx+q.w*tx-q.y*tz+q.z*ty,y=dy+q.w*ty-q.z*tx+q.x*tz,z=dz+q.w*tz-q.x*ty+q.y*tx;
 const scale=Number.isFinite(block.frameScale)?Math.abs(block.frameScale):1,offset=block.frameOffset||{};
 const ex=Math.max(0,Math.abs(x-(offset.x||0))-sx*scale/2),ey=Math.max(0,Math.abs(y-(offset.y||0))-sy*scale/2),ez=Math.max(0,Math.abs(z-(offset.z||0))-sz*scale/2),r=radius+Math.max(0,padding);
 return ex*ex+ey*ey+ez*ez<=r*r;
}

/**
 * Call advance(dt) once per simulated step, then sync(bodies, blocks, isCharged)
 * before physics. Alternatively sync(..., dt) advances the clock itself; dt=0
 * is the default so additional pre-step syncs never consume grace time.
 *
 * bodies contains only free active balls, as raw Rapier bodies or {body,radius}
 * (also accepts {b,radius}). Missing/invalid/kinematic balls are forgotten.
 * isCharged receives the body. blocks is a Map or iterable of live clusters.
 *
 * isPassing(body)/ghost(body): use structure-excluding solver groups while true.
 * claim(body, originId): after validating a direct impact, accept exactly once
 * per traversal before applying its one normal hit. It can begin a visit from
 * a collision event even if pre-step geometry had not reached the shell yet.
 * protected(originId): suppress incidental environmental damage during the
 * visit and for releaseGrace seconds after its complete geometric exit.
 * forget(body)/reset(): immediate catch/park/removal/arena cleanup, including
 * any release grace owned by that ball. Neither API modifies ordinary Pierce.
 */
export class ChargedTraversal {
 constructor({radius=.38,padding=.04,releaseGrace=.15}={}){
  this.radius=radius;this.padding=padding;this.releaseGrace=Math.max(0,releaseGrace);
  this.entries=new Map();this.origins=new Map();this.time=0;this.frame=0;
 }
 advance(dt){
  if(!Number.isFinite(dt)||dt<=0)return;
  this.time+=dt;this.frame++;
  for(const [body,entry] of this.entries){
   if(!freeBody(body)){this.entries.delete(body);continue;}
   for(const [id,cooldown] of entry.cooldowns)if(cooldown.until<=this.time)entry.cooldowns.delete(id);
   if(!entry.charged&&!entry.visits.size&&!entry.cooldowns.size)this.entries.delete(body);
  }
 }
 sync(bodies,blocks,isCharged,dt=0){
  this.advance(dt);
  const candidates=[],live=new Set();
  for(const item of values(bodies)){
   const body=item?.body||item?.b||item;if(!freeBody(body)||live.has(body))continue;live.add(body);
   const charged=typeof isCharged==='function'?!!isCharged(body):!!isCharged;
   if(charged||this.entries.has(body))candidates.push({item,body,charged});
  }
  for(const body of this.entries.keys())if(!live.has(body))this.entries.delete(body);
  // The normal, uncharged game does no shell indexing or overlap work.
  if(!candidates.length){this.origins.clear();return;}
  const shells=new Map();
  for(const block of values(blocks)){
   if(!block?.origin||(block.kind&&block.kind!=='block')||!validBody(block.b))continue;
   const id=block.origin.id;if(id===undefined||id===null)continue;
   let group=shells.get(id);
   if(!group||group.origin!==block.origin){group={origin:block.origin,blocks:[]};shells.set(id,group);}
   group.blocks.push(block);
  }
  this.origins=new Map([...shells].map(([id,group])=>[id,group.origin]));
  for(const {item,body,charged} of candidates){
   let entry=this.entries.get(body);
   if(!entry){if(!charged)continue;entry={body,charged:true,passing:true,visits:new Map(),cooldowns:new Map()};this.entries.set(body,entry);}
   let radius=item?.radius;
   if(!Number.isFinite(radius)){const collider=body.numColliders?.()>0?body.collider(0):null;radius=typeof collider?.radius==='function'?collider.radius():this.radius;}
   if(!Number.isFinite(radius)||radius<0)radius=this.radius;
   const overlaps=new Set();
   for(const [id,group] of shells)if(group.blocks.some(block=>sphereOverlapsShell(body,radius,block,this.padding)))overlaps.add(id);
   // Add origins only while charge is active, or in the single sync where it
   // expires. After that, nearby cubes cannot prolong the exit-only ghost.
   if(charged||entry.charged)for(const id of overlaps){
    const origin=this.origins.get(id),prior=entry.visits.get(id);
    if(!prior||prior.origin!==origin)entry.visits.set(id,{origin,claimed:false,claimFrame:-Infinity});
   }
   for(const [id,visit] of entry.visits){
    if(this.origins.get(id)!==visit.origin){entry.visits.delete(id);entry.cooldowns.delete(id);continue;}
    // Keep a just-claimed event through the next whole pre-step sample. CCD or
    // a speculative contact can arrive just outside the geometric boundary.
    const firstOutsideSample=visit.claimed&&this.frame<=visit.claimFrame+1;
    if(overlaps.has(id)||firstOutsideSample)continue;
    entry.visits.delete(id);
    if(this.releaseGrace>0)entry.cooldowns.set(id,{origin:visit.origin,until:this.time+this.releaseGrace});
   }
   for(const [id,cooldown] of entry.cooldowns)if(cooldown.until<=this.time||this.origins.get(id)!==cooldown.origin)entry.cooldowns.delete(id);
   entry.charged=charged;entry.passing=charged||entry.visits.size>0;
   if(!entry.passing&&!entry.cooldowns.size)this.entries.delete(body);
  }
 }
 isPassing(body){return freeBody(body)&&!!this.entries.get(body)?.passing;}
 ghost(body){return this.isPassing(body);}
 claim(body,origin){
  if(!this.isPassing(body))return false;
  const id=originId(origin),liveOrigin=this.origins.get(id);
  if(!liveOrigin||(origin&&typeof origin==='object'&&origin!==liveOrigin))return false;
  const entry=this.entries.get(body);let visit=entry.visits.get(id);
  if(visit?.origin!==liveOrigin){entry.visits.delete(id);visit=null;}
  if(visit?.claimed||(!entry.charged&&!visit))return false;
  if(!visit){visit={origin:liveOrigin,claimed:false,claimFrame:-Infinity};entry.visits.set(id,visit);}
  visit.claimed=true;visit.claimFrame=this.frame;entry.cooldowns.delete(id);return true;
 }
 protected(origin){
  const id=originId(origin),liveOrigin=this.origins.get(id);
  if(!liveOrigin||(origin&&typeof origin==='object'&&origin!==liveOrigin))return false;
  for(const [body,entry] of this.entries){
   if(!freeBody(body))continue;
   if(entry.visits.get(id)?.origin===liveOrigin)return true;
   const cooldown=entry.cooldowns.get(id);if(cooldown?.origin===liveOrigin&&cooldown.until>this.time)return true;
  }
  return false;
 }
 forget(body){this.entries.delete(body);}
 reset(){this.entries.clear();this.origins.clear();this.time=0;this.frame=0;}
}
// A plural alias is useful beside ChargedLaunches and is the same controller.
export {ChargedTraversal as ChargedTraversals};
