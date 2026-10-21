// Charged launches boost speed and mass/inertia; damage and contact solving stay normal.
export class ChargedLaunches {
 constructor({duration=.75,settle=.25,massMultiplier=3}={}){this.duration=duration;this.settle=settle;this.massMultiplier=massMultiplier;this.entries=new Map();}
 add(body,normalCap){if(!body?.isValid()||!Number.isFinite(normalCap)||normalCap<=0)return;this.forget(body);const colliders=[];for(let i=0;i<body.numColliders();i++){const c=body.collider(i),density=c.density();colliders.push({c,density});c.setDensity(density*this.massMultiplier);}body.recomputeMassPropertiesFromColliders();this.entries.set(body.handle,{body,normalCap,age:0,colliders});}
 restore(e){if(!e.body.isValid())return;for(const {c,density}of e.colliders)if(c.isValid())c.setDensity(density);e.body.recomputeMassPropertiesFromColliders();}
 update(dt){if(!Number.isFinite(dt)||dt<=0)return;for(const [id,e]of this.entries){const b=e.body;if(!b.isValid()||!b.isDynamic()){this.restore(e);this.entries.delete(id);continue;}e.age+=dt;if(e.age<=this.duration)continue;
 const v=b.linvel(),speed=Math.hypot(v.x,v.z),t=Math.min(1,(e.age-this.duration)/this.settle),cap=e.normalCap*(2-t);if(speed>cap){const ratio=cap/speed;b.setLinvel({x:v.x*ratio,y:v.y,z:v.z*ratio},true);const w=b.angvel();b.setAngvel({x:w.x*ratio,y:w.y,z:w.z*ratio},true);}if(t>=1){this.restore(e);this.entries.delete(id);}}}
 forget(body){const e=body&&this.entries.get(body.handle);if(e){this.restore(e);this.entries.delete(body.handle);}}
 reset(){for(const e of this.entries.values())this.restore(e);this.entries.clear();}
}
