import {TransformControls} from 'three/addons/controls/TransformControls.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {validateProjectPreset as validatePreset} from '../src/authoring-project.js';
import {BONUS_DEFS} from '../src/bonus-controller.js';

/** Development-only adapter. This module is outside the production import graph. */
export async function connectCrystalEditor(host){
 const {THREE,scene,camera,renderer}=host,canvas=renderer.domElement;
 const listeners=new Set(),transformListeners=new Set();let selected=null,mode='edit',dragging=false,authorArena=host.section;
 const orbit=new OrbitControls(camera,canvas);orbit.target.set(0,1,(host.bounds.top+host.bounds.mid)/2);orbit.enableDamping=true;orbit.update();
 const gizmo=new TransformControls(camera,canvas);scene.add(gizmo.getHelper());
 const notify=event=>listeners.forEach(fn=>fn(event));
 const arenaKey=()=>String((host.section-1)%14+1);
 const find=id=>[...host.blocks.values()].find(o=>o.origin.authoredId===id);
 const base=id=>host.baseSpecs().find(s=>s[8]?.id===id);
 function objectDefaults(id){
  const o=find(id),b=base(id);if(!o||!b)throw Error('Unknown authored object: '+id);
  const p=o.b.translation(),r=new THREE.Euler().setFromQuaternion(new THREE.Quaternion().copy(o.b.rotation()));
  return {position:[p.x,p.y,host.normalizedZ(p.z)],rotation:[r.x,r.y,r.z],scale:[o.sx/b[4],o.sy/b[5],o.sz/b[6]]};
 }
 function objectDocument(id,doc=host.readVisualPreset()){
  doc.arenas[arenaKey()]??={objects:{}};doc.arenas[arenaKey()].objects[id]??=objectDefaults(id);
  return doc;
 }
 function select(id){selected=id;gizmo.detach();const o=find(id);if(o&&mode==='edit')gizmo.attach(o.mesh);notify({type:'selection',id});}
 function rebuild(){gizmo.detach();host.section=authorArena;host.rebuild();for(const o of host.blocks.values()){o.mesh.position.copy(o.b.translation());o.mesh.quaternion.copy(o.b.rotation());}if(selected)select(selected);notify({type:'scene'});}
 gizmo.addEventListener('dragging-changed',e=>{dragging=e.value;orbit.enabled=!e.value&&mode==='edit';});
 gizmo.addEventListener('mouseUp',()=>{
  if(!selected||mode!=='edit')return;const o=find(selected),b=base(selected);if(!o||!b)return;
  const doc=objectDocument(selected),value=doc.arenas[arenaKey()].objects[selected],m=o.mesh;
  value.position=[m.position.x,m.position.y,host.normalizedZ(m.position.z)];
  value.rotation=[m.rotation.x,m.rotation.y,m.rotation.z];value.scale=m.scale.toArray().map((n,i)=>n*[o.sx,o.sy,o.sz][i]/b[4+i]);
  try{const valid=validatePreset(doc);host.setVisualPreset(valid);rebuild();transformListeners.forEach(fn=>fn(valid));}
  catch(error){rebuild();notify({type:'error',message:error.message});}
 });
 const ray=new THREE.Raycaster(),pointer=new THREE.Vector2();let press;
 const onPointerDown=e=>{press={x:e.clientX,y:e.clientY};};
 const onPointerUp=e=>{
  if(mode!=='edit'||dragging||gizmo.axis||!press||Math.hypot(e.clientX-press.x,e.clientY-press.y)>4)return;
  const rect=canvas.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,1-(e.clientY-rect.top)/rect.height*2);ray.setFromCamera(pointer,camera);
  const hit=ray.intersectObjects([...host.blocks.values()].map(o=>o.mesh),false)[0];
  if(hit){const o=[...host.blocks.values()].find(o=>o.mesh===hit.object);select(o.origin.authoredId);}
 };
 canvas.addEventListener('pointerdown',onPointerDown);canvas.addEventListener('pointerup',onPointerUp);
 const field=(path,label,value,min,max,step=.01,type='number')=>({path,label,value,min,max,step,type});
 function fields(id){
  const p=host.readVisualPreset();
  if(id?.startsWith('material:glass:')){const i=Number(id.split(':')[2]);return Object.entries(p.materials.glass[i]).map(([key,v])=>field(['materials','glass',i,key],key,v,0,key==='envMapIntensity'?10:1,.01,key==='color'?'color':'number'));}
  if(id==='material:floor')return Object.entries(p.materials.floor).map(([key,v])=>field(['materials','floor',key],key,v,0,key==='envMapIntensity'?10:1,.01,key==='color'?'color':'number'));
  if(id==='lighting')return Object.entries(p.lighting).map(([key,v])=>field(['lighting',key],key,v,0,10,.05));
  if(id==='particles')return Object.entries(p.particles).map(([key,v])=>field(['particles',key],key,v,key==='intensity'?0:.25,3,.05));
  if(!find(id))return [];const d=objectDocument(id,p).arenas[arenaKey()].objects[id],out=[];
  for(const [key,min,max]of [['position',-6,20],['rotation',-Math.PI,Math.PI],['scale',.35,3]])d[key].forEach((v,i)=>out.push(field(['arenas',arenaKey(),'objects',id,key,i],key+' '+['X','Y','Z'][i],v,key==='position'?(i===1?0:i===2?-6.15:-6):min,key==='position'?(i===1?20:i===2?-.05:6):max,.01)));
  return out;
 }
 const api={
  projectLabel:'CrystalCrash',arenaCount:14,
  listEntities:()=>[...[...host.blocks.values()].filter(o=>o.origin.authoredId).map(o=>({id:o.origin.authoredId,label:o.origin.authoredId+' · T'+(o.type+1),type:'Cube',transform:true})),...Array.from({length:5},(_,i)=>({id:'material:glass:'+i,label:'Glass T'+(i+1),type:'Material',transform:false})),{id:'material:floor',label:'Floor coat',type:'Material',transform:false},{id:'lighting',label:'Scene lighting',type:'Lighting',transform:false},{id:'particles',label:'Bonus particle sun',type:'Particles',transform:false}],
  getObject:id=>find(id)?.mesh,documentFor:id=>find(id)?objectDocument(id):host.readVisualPreset(),readDocument:()=>host.readVisualPreset(),validateDocument:doc=>validatePreset(JSON.parse(JSON.stringify(doc))),
  applyDocument(doc){host.setVisualPreset(JSON.parse(JSON.stringify(doc)));rebuild();return host.readVisualPreset();},
  setMode(next){mode=next==='play'?'play':'edit';gizmo.detach();host.setOwnership(mode==='edit');rebuild();orbit.enabled=mode==='edit';if(mode==='edit'&&selected)select(selected);notify({type:'mode',mode});},
  setArena(n){if(!Number.isInteger(n)||n<1||n>14)throw Error('Arena must be 1–14');authorArena=n;host.section=n;rebuild();},
  fields,select,setTransformMode(value){if(['translate','rotate','scale'].includes(value))gizmo.setMode(value);},
  focus(id){const o=find(id);if(o){orbit.target.copy(o.mesh.position);orbit.update();}},
  effects:()=>Object.values(BONUS_DEFS).map(d=>({id:d.kind,label:d.name})),previewEffect:kind=>host.previewEffect(kind),
  subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
  onTransform(fn){transformListeners.add(fn);return()=>transformListeners.delete(fn);},
  dispose(){canvas.removeEventListener('pointerdown',onPointerDown);canvas.removeEventListener('pointerup',onPointerUp);gizmo.detach();scene.remove(gizmo.getHelper());gizmo.dispose();orbit.dispose();host.setTick(null);host.setResize(null);listeners.clear();transformListeners.clear();}
 };
 host.setResize(()=>{rebuild();orbit.update();});
 host.setOwnership(true);
 host.setTick(dt=>{if(mode==='edit'){orbit.update();host.animateEffects(dt);}});
 // Set initial meshes from their authored bodies before the first frame.
 for(const o of host.blocks.values()){o.mesh.position.copy(o.b.translation());o.mesh.quaternion.copy(o.b.rotation());}
 window.crystalEditorAPI=api;window.dispatchEvent(new Event('crystal-editor-ready'));return api;
}
