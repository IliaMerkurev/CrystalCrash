// A short velocity allowance, never a recurring force or permanent speed buff.
export class ChargedLaunches {
 constructor({duration=.75,settle=.25}={}){this.duration=duration;this.settle=settle;this.entries=new Map();}
 add(body,normalCap){if(body?.isValid()&&Number.isFinite(normalCap)&&normalCap>0)this.entries.set(body.handle,{body,normalCap,age:0});}
 update(dt){if(!Number.isFinite(dt)||dt<=0)return;for(const [id,e]of this.entries){const b=e.body;if(!b.isValid()||!b.isDynamic()){this.entries.delete(id);continue;}e.age+=dt;if(e.age<=this.duration)continue;const v=b.linvel(),speed=Math.hypot(v.x,v.z),t=Math.min(1,(e.age-this.duration)/this.settle),cap=e.normalCap*(2-t);if(speed>cap){const ratio=cap/speed;b.setLinvel({x:v.x*ratio,y:v.y,z:v.z*ratio},true);const w=b.angvel();b.setAngvel({x:w.x*ratio,y:w.y,z:w.z*ratio},true);}if(t>=1)this.entries.delete(id);}}
 forget(body){if(body)this.entries.delete(body.handle);}
 reset(){this.entries.clear();}
}
