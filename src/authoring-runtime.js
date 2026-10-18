import * as THREE from 'three';
import savedPreset from './presets/crystal-crash.json' with {type:'json'};
import {validateProjectPreset as validatePreset} from './authoring-project.js';
let current=validatePreset(savedPreset);
export const getParticleSettings=()=>current.particles;
export const readVisualPreset=()=>structuredClone(current);
export const setVisualPreset=value=>(current=validatePreset(value),readVisualPreset());
export function applyMaterialPreset(material,settings){
 for(const [key,value] of Object.entries(settings)){if(key==='color')material.color.set(value);else material[key]=value;}
}
export function authoredArena(specs,level,{layoutZ,bounds}){
 const arena=String((Math.max(1,Math.floor(level))-1)%14+1),objects=current.arenas[arena]?.objects||{};
 return specs.map((base,index)=>{
  const s=base.slice(),id=s[8]?.id||`legacy:${index}`,edit=objects[id];
  const rotation=edit?.rotation||[0,s[4]===s[5]&&s[5]===s[6]?Math.PI/4:0,0];
  if(edit){s[0]=edit.position[0];s[1]=edit.position[1];s[2]=layoutZ(edit.position[2]);for(let i=0;i<3;i++)s[4+i]*=edit.scale[i];}
  const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),m=new THREE.Matrix4().makeRotationFromQuaternion(q).elements;
  const half=s.slice(4,7).map(v=>v/2),extent=[0,1,2].map(row=>half.reduce((sum,h,col)=>sum+Math.abs(m[col*4+row])*h,0));
  // Shared visual/collider spawn pose: authoring cannot put targets through rails/floor/gate.
  s[2]=THREE.MathUtils.clamp(s[2],bounds.top+extent[2]+.22,bounds.mid-extent[2]-.12);
  const limit=Math.max(0,Math.min(bounds.half(s[2]-extent[2]),bounds.half(s[2]+extent[2]))-extent[0]-.34);
  s[0]=THREE.MathUtils.clamp(s[0],-limit,limit);s[1]=Math.max(s[1],extent[1]+.015);
  s[8]={id,rotation,extent};return s;
 });
}
