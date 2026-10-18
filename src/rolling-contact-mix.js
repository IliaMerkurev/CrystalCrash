// One bounded audio mix from actual supporting table contacts, never proximity.
export function rollingContactMix(world, colliderMetadata, bodies, speedScale=1){
 let energy=0,weightedSpeed=0,count=0;
 const scale=Math.max(0,Math.min(1,Number.isFinite(speedScale)?speedScale:1));
 for(const body of bodies){
  if(!body?.isValid()||!body.isDynamic())continue;
  const collider=body.collider(0);if(!collider)continue;
  let grounded=false;
  world.contactPairsWith(collider,other=>{
   if(grounded||colliderMetadata.get(other.handle)?.kind!=='table')return;
   world.contactPair(collider,other,manifold=>{
    if(manifold.numSolverContacts()>0&&Math.abs(manifold.normal().y)>.65)grounded=true;
   });
  });
  if(!grounded)continue;
  const v=body.linvel(),speed=Math.hypot(v.x,v.z)*scale;if(speed<.12)continue;
  const weight=Math.min(1,speed/12);energy+=weight;weightedSpeed+=speed*weight;count++;
 }
 return {speed:energy?Math.min(30,weightedSpeed/energy):0,intensity:Math.min(1,Math.sqrt(energy)*.65),count};
}
