// CPU lifecycle/resource tests. Visual appearance still requires browser/GPU QA.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TornadoVisual, TORNADO_VISUAL_LIMITS as LIMITS } from '../src/tornado-visual.js';
const make=()=>new TornadoVisual({THREE,scene:new THREE.Scene()});
const well=()=>({point:{x:1,y:2,z:3},range:4,born:10,expires:15,duration:5});
test('tornado activation follows the physical center and clears at expiry',()=>{
 const v=make(),w=well();assert.equal(v.group.visible,false);v.update(w,.016,10.2);
 assert.equal(v.active,true);assert.deepEqual(v.group.position.toArray(),[1,.04,3]);assert.equal(v.uniforms.strength.value,1);
 w.point.x=4;w.point.z=-2;v.update(w,.016,11);assert.deepEqual(v.group.position.toArray(),[4,.04,-2]);
 v.update(w,.016,14.9);assert.ok(v.uniforms.strength.value<.25);v.update(w,.016,15);
 assert.equal(v.active,false);assert.equal(v.group.visible,false);assert.equal(v.uniforms.strength.value,0);v.dispose();
});
test('repeated storms reuse geometry, material and instance pools with bounded draw calls',()=>{
 const v=make(),geometries=[...v.geometries],materials=[...v.materials],smokeArray=v.smoke.instanceMatrix.array,debrisArray=v.debris.instanceMatrix.array;
 assert.equal(v.meshes.length,LIMITS.drawCalls);assert.equal(v.smoke.count,LIMITS.smoke);assert.equal(v.debris.count,LIMITS.debris);
 for(let i=0;i<500;i++){const w=well();w.range=i%2?100:.01;v.update(w,.016,10.2+(i%450)/100);if(i%19===0)v.clear();}
 assert.deepEqual([...v.geometries],geometries);assert.deepEqual([...v.materials],materials);assert.equal(v.smoke.instanceMatrix.array,smokeArray);assert.equal(v.debris.instanceMatrix.array,debrisArray);
 assert.ok(v.group.scale.x>=.7&&v.group.scale.x<=1.1);assert.ok([...smokeArray,...debrisArray].every(Number.isFinite));v.dispose();
});
test('smoke and debris stay within the local storm bounds',()=>{
 const v=make(),m=new THREE.Matrix4(),p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();
 for(let t=0;t<5;t+=.17){v.update(well(),.17,10+t);for(const mesh of [v.smoke,v.debris])for(let i=0;i<mesh.count;i++){
  mesh.getMatrixAt(i,m);m.decompose(p,q,s);const radius=Math.max(s.x,s.y,s.z);
  assert.ok((Math.hypot(p.x,p.z)+radius)*1.1<LIMITS.maxRadius);assert.ok(p.y+radius<LIMITS.maxHeight);assert.ok(p.y-(mesh===v.smoke&&i<28?s.y:radius)>-.6);
 }}v.dispose();
});
test('warmup exposes every variant without releasing live shared geometry/materials',()=>{
 const v=make(),warm=v.warmupObjects();assert.equal(warm.children.length,LIMITS.drawCalls);
 let liveDisposed=0;for(const m of v.materials)m.addEventListener('dispose',()=>liveDisposed++);
 warm.children.forEach((clone,i)=>{
  assert.equal(clone.geometry,v.meshes[i].geometry);assert.notEqual(clone.material,v.meshes[i].material);assert.equal(clone.isInstancedMesh,v.meshes[i].isInstancedMesh);
  assert.equal(clone.visible,true);assert.equal(clone.userData.powerFXWarmupMaterial,true);
  if(clone.isInstancedMesh)clone.dispose();clone.material.dispose();
 });assert.equal(liveDisposed,0);assert.equal(v.group.visible,false);v.update(well(),.016,11);assert.equal(v.active,true);v.dispose();
});
test('clear is reusable and dispose releases resources once',()=>{
 const v=make();let geometries=0,materials=0;for(const g of v.geometries)g.addEventListener('dispose',()=>geometries++);for(const m of v.materials)m.addEventListener('dispose',()=>materials++);
 v.update(well(),.016,11);v.clear();v.clear();assert.equal(v.group.visible,false);v.update(well(),.016,12);assert.equal(v.active,true);
 v.dispose();v.dispose();assert.equal(geometries,v.geometries.size);assert.equal(materials,v.materials.size);assert.equal(v.group.parent,null);
 v.update(well(),.016,12);assert.equal(v.active,false);assert.equal(v.warmupObjects().children.length,0);
});
test('ribbons use broad triangle geometry and all smoke stays depth-tested',()=>{
 const v=make();for(const ribbon of v.ribbons){assert.ok(ribbon.geometry.index.count>1000);assert.equal(ribbon.isLine,undefined);assert.equal(ribbon.material.depthTest,true);assert.equal(ribbon.material.depthWrite,false);}
 assert.equal(v.smoke.material.depthTest,true);assert.equal(v.outer.material.depthTest,true);v.dispose();
});

test('polished storm keeps gold filaments batched and cyan edges feathered',()=>{
 const v=make();assert.equal(v.ribbons.length,4);
 assert.equal(v.ribbons[3].geometry.index.count,v.ribbons[0].geometry.index.count*2);
 assert.match(v.ribbons[0].material.fragmentShader,/shoulder=exp/);
 assert.match(v.ribbons[0].material.fragmentShader,/smoothstep\(.45,1.,cross\)/);
 const gold=new THREE.Color();v.debris.getColorAt(0,gold);assert.ok(gold.r>1);assert.ok(gold.g>gold.b);
 for(const mesh of v.meshes){assert.equal(mesh.material.depthWrite,false);if(mesh.material.side===THREE.DoubleSide)assert.equal(mesh.material.forceSinglePass,true);}
 v.dispose();
});
test('ground skirt stays local and low, with fixed warmup and resource budget',()=>{
 const v=make(),flow=v.groundFlow,g=flow.geometry;g.computeBoundingBox();
 assert.ok(g.boundingBox.max.y<.0001);assert.ok(g.boundingBox.min.y>-.0001);
 assert.ok(g.boundingBox.max.x<=2.051);assert.ok(flow.position.y<.04);
 v.update(well(),.016,12);const m=new THREE.Matrix4(),p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();
 for(let i=0;i<28;i++){v.smoke.getMatrixAt(i,m);m.decompose(p,q,s);assert.ok(p.y+s.y<.24);assert.ok(s.x>s.y*7);}
 assert.equal(v.meshes.length,9);assert.equal(v.smoke.count,80);assert.equal(v.debris.count,44);
 let triangles=0;for(const mesh of v.meshes)triangles+=(mesh.geometry.index?mesh.geometry.index.count:mesh.geometry.attributes.position.count)/3*(mesh.isInstancedMesh?mesh.count:1);
 assert.ok(triangles<28000,`triangle budget: ${triangles}`);
 const warm=v.warmupObjects();assert.ok(warm.children.some(x=>x.geometry===g));
 for(const clone of warm.children){if(clone.isInstancedMesh)clone.dispose();clone.material.dispose();}v.dispose();
});

test('floor spiral is exactly 2.5x smaller without changing the main funnel',()=>{
 const v=make(),w=well();v.update(w,.016,11);
 assert.equal(LIMITS.groundScale,.4);assert.deepEqual(v.groundFlow.scale.toArray(),[.4,1,.4]);
 v.groundFlow.geometry.computeBoundingSphere();const originalRadius=v.groundFlow.geometry.boundingSphere.radius;
 assert.ok(Math.abs(originalRadius-2.05)<.00001);
 assert.ok(Math.abs(originalRadius*v.groundFlow.scale.x-.82)<.00001);
 assert.deepEqual(v.group.scale.toArray(),[1,1,1]);assert.deepEqual(v.outer.scale.toArray(),[1,1,1]);
 assert.equal(LIMITS.height,4.7);assert.equal(v.outer.geometry.parameters.height,4.7);
 v.dispose();
});
test('ground skirt and all funnel ribbons track every roaming center and stay grounded',()=>{
 const v=make(),w=well(),p=new THREE.Vector3(),matrix=new THREE.Matrix4();
 // Even a stale local spawn offset must not keep the floor flow behind.
 v.groundFlow.position.set(7,3,-9);
 for(let i=0;i<30;i++){
  w.point.x=1+i*.11;w.point.z=3-i*.17;w.point.y=2+i*.3;
  v.update(w,i%2?.016:0,10.2+i*.08);v.group.updateMatrixWorld(true);
  v.groundFlow.getWorldPosition(p);
  assert.ok(Math.abs(p.x-w.point.x)<1e-9);assert.ok(Math.abs(p.z-w.point.z)<1e-9);assert.ok(Math.abs(p.y-.065)<1e-9);
  for(const ribbon of v.ribbons){ribbon.getWorldPosition(p);assert.equal(p.x,w.point.x);assert.equal(p.z,w.point.z);assert.equal(p.y,.04);}
  // Ground smoke also belongs to the same moving frame, with no spawn-space instances.
  v.smoke.getMatrixAt(0,matrix);p.setFromMatrixPosition(matrix);const localX=p.x,localZ=p.z;p.applyMatrix4(v.smoke.matrixWorld);
  assert.ok(Math.abs(p.x-(w.point.x+localX*v.group.scale.x))<1e-9);
  assert.ok(Math.abs(p.z-(w.point.z+localZ*v.group.scale.z))<1e-9);
  assert.ok(p.y<.25);
 }
 v.clear();assert.equal(v.group.visible,false);v.dispose();
});

test('small moving skirt uses feathered local glow without extra passes',()=>{
 const v=make(),material=v.groundFlow.material;
 assert.equal(material.blending,THREE.AdditiveBlending);assert.equal(material.depthTest,true);assert.equal(material.depthWrite,false);
 assert.match(material.fragmentShader,/halo=exp/);assert.match(material.fragmentShader,/smoothstep\(.95,2.05,r\)/);
 assert.equal(material.uniforms,v.uniforms);assert.equal(v.meshes.length,9);
 v.dispose();
});
