// Only environmental collision damage is guarded. Callers keep direct ball and
// explicit bonus damage on their normal paths. Sync after field simulation and
// before processing physics contacts so expiry restores landing damage promptly.
export class BlackHoleImpactGuard {
 constructor(){this.protectedOrigins=new Map();}
 has(originId){return this.protectedOrigins.has(originId);}
 sync(fields,blocks,impactHistory,strikeContacts){
  const next=new Map();
  for(const hole of (Array.isArray(fields)?fields:[fields])){
  if(hole?.active!==false&&hole?.blocks===blocks){
   for(const target of hole.targets||[]){
    const o=blocks.get(target.id),body=o?.b;
    if(o?.kind!=='block'||!o.origin||body!==target.body||!body?.isValid()||!body.isDynamic()||!o.cs?.length)continue;
    if(target.handle!==undefined&&body.handle!==target.handle)continue;
    const p=body.worldCom(),range=hole.radius??hole.range;
    if(hole.kind!=='tornado'&&hole.kind!=='capture-release'&&(!hole.point||!Number.isFinite(range)||Math.hypot(p.x-hole.point.x,p.y-hole.point.y,p.z-hole.point.z)>range))continue;
    next.set(o.origin.id,o.origin);
   }
  }
  }
  this.releaseMissing(next,blocks,impactHistory,strikeContacts);
  this.protectedOrigins=next;
 }
 releaseMissing(next,blocks,impactHistory,strikeContacts){
  const released=new Set();
  for(const [id,origin] of this.protectedOrigins){
   if(next.get(id)===origin)continue;
   released.add('cube'+id);origin.lastStrike=-Infinity;
   for(const o of blocks?.values()||[])if(o.origin===origin&&o.b?.isValid())o.lastHit=-Infinity;
  }
  if(!released.size)return;
  const environmental=group=>{
   if(typeof group!=='string')return false;
   const parts=group.split('|');
   return !parts.some(p=>p==='ball'||p.startsWith('echo'))&&parts.some(p=>released.has(p));
  };
  for(const [group] of impactHistory||[])if(environmental(group))impactHistory.delete(group);
  for(const [key,pair] of strikeContacts||[])if(environmental(pair.group))strikeContacts.delete(key);
 }
 reset(blocks,impactHistory,strikeContacts){
  this.releaseMissing(new Map(),blocks,impactHistory,strikeContacts);
  this.protectedOrigins.clear();
 }
}
