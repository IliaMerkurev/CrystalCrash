// Returning balls park during the active field. Outgoing launches can escape
// the lower zone; held/transition balls are never moved by this safety rule.
export class BlackHoleBallSafety {
 constructor(){this.previous=new Map();}
 reset(){this.previous.clear();}
 shouldPark(body,{active,eligible,mid}){
  if(!active||!eligible){this.previous.delete(body.handle);return false;}
  const p=body.translation(),old=this.previous.get(body.handle);this.previous.set(body.handle,p.z);
  return p.z>=mid&&(old<mid||body.linvel().z>=0);
 }
 prune(bodies){const ids=new Set(bodies.map(b=>b.handle));for(const id of this.previous.keys())if(!ids.has(id))this.previous.delete(id);}
}
