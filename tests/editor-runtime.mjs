import assert from 'node:assert/strict';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {arenaBlocks} from '../src/arena-data.js';
import {readVisualPreset,setVisualPreset,authoredArena} from '../src/authoring-runtime.js';
import {validateProjectPreset} from '../src/authoring-project.js';
import {shellPanels,shellGeometry,wallThickness} from '../src/glass-shell.js';
const options={layoutZ:z=>z*3,bounds:{top:-18.45,mid:0,half:()=>6.25}};
for(let n=1;n<=14;n++){
 const a=arenaBlocks(n),b=arenaBlocks(n,{...options});
 assert.equal(new Set(a.map(s=>s[8].id)).size,a.length);
 assert.deepEqual(a.map(s=>s[8].id).sort(),b.map(s=>s[8].id).sort());
}
const p=readVisualPreset(),id=arenaBlocks(1)[0][8].id;
p.arenas['1']={objects:{[id]:{position:[1,2,-3],rotation:[.2,.4,.1],scale:[1.2,.8,1.5]}}};
setVisualPreset(JSON.parse(JSON.stringify(p)));
const s=authoredArena(arenaBlocks(1,options),1,options).find(s=>s[8].id===id);
assert.equal(s[0],1);assert.equal(s[1],2);assert.equal(s[2],-9);assert.deepEqual(s.slice(4,7),[.88*1.2,.88*.8,.88*1.5]);
await RAPIER.init();const world=new RAPIER.World({x:0,y:-18,z:0});
const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(...s[8].rotation));
const body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(...s.slice(0,3)).setRotation(q));
const panels=shellPanels(...s.slice(4,7),wallThickness(s[3]));
for(const panel of panels)world.createCollider(RAPIER.ColliderDesc.cuboid(...panel.size.map(v=>v/2)).setTranslation(...panel.p),body);
assert.equal(body.numColliders(),6);assert(Math.abs(body.rotation().y-q.y)<1e-6);
const mesh=new THREE.Mesh(shellGeometry(...s.slice(4,7),wallThickness(s[3])));mesh.position.set(...s.slice(0,3));mesh.quaternion.copy(q);mesh.updateMatrixWorld();const bounds=new THREE.Box3().setFromObject(mesh);
for(const panel of panels)for(const sx of [-1,1])for(const sy of [-1,1])for(const sz of [-1,1]){
 const v=new THREE.Vector3(...panel.p).add(new THREE.Vector3(sx*panel.size[0]/2,sy*panel.size[1]/2,sz*panel.size[2]/2)).applyQuaternion(q).add(mesh.position);
 assert(bounds.clone().expandByScalar(.001).containsPoint(v));
}
assert.throws(()=>validateProjectPreset({...p,arenas:{'1':{objects:{bogus:p.arenas['1'].objects[id]}}}}));
world.free();mesh.geometry.dispose();console.log('PASS 14 stable arena ID sets, preset roundtrip/runtime transform, 6 real Rapier wall colliders match mesh pose/bounds, unknown ID rejection');
setVisualPreset(readVisualPreset());
for(const depth of [3,6.15,10,18])for(let level=1;level<=14;level++){
 const opt={layoutZ:z=>z*depth/6.15,bounds:{top:-depth,mid:0,half:()=>6.25}};
 const blank=readVisualPreset();blank.arenas={};setVisualPreset(blank);
 const base=arenaBlocks(level,opt),actual=authoredArena(base,level,opt);
 assert.deepEqual(actual.map(s=>s.slice(0,8)),base.map(s=>s.slice(0,8)));
}
console.log('PASS untouched layouts preserved at four depths across all 14 arenas');
