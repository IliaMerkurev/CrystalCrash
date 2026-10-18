// node --test tests/frost-shells.mjs
// Real Three.js geometry and scene graphs exercise shell ownership and lifecycle.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {SecondaryPowers} from '../src/secondary-powers.js';

function setup() {
 const scene=new THREE.Scene(),blocks=new Map(),owned=new Set();
 const powers=new SecondaryPowers({THREE,RAPIER:{},scene,world:{},colliders:new Map(),radius:.38});
 function block(id,originId,options={}) {
  const geometry=options.geometry??new THREE.BoxGeometry(.9,.9,.9);
  const material=options.material??new THREE.MeshPhysicalMaterial({color:options.color??0xdd4621,transmission:.3,roughness:.13});
  owned.add(geometry);for(const mat of Array.isArray(material)?material:[material])owned.add(mat);
  const mesh=new THREE.Mesh(geometry,material);mesh.position.set(id*.12,.45,-2);
  scene.add(mesh);
  const o={id,kind:options.kind??'block',origin:{id:originId},mesh,b:{isValid:()=>true}};
  blocks.set(id,o);return o;
 }
 function dispose() {powers.dispose();for(const resource of owned)resource.dispose();}
 return {scene,blocks,powers,owned,block,dispose};
}
const matrixNear=(a,b)=>a.elements.forEach((n,i)=>assert.ok(Math.abs(n-b.elements[i])<1e-10,`matrix component ${i}`));
const disposals=resource=>{let count=0;resource.addEventListener('dispose',()=>count++);return ()=>count;};

// A lone thin, off-center fragment cannot be represented by a complete cube.
function partialFace() {
 const geometry=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([
  -.45,-.45,.45, .14,-.45,.45, -.19,.31,.45,
  -.45,-.45,.44, -.19,.31,.44, .14,-.45,.44,
 ],3));
 geometry.computeVertexNormals();return geometry;
}

test('every surviving cluster of every marked origin gets its exact visible geometry',()=>{
 const t=setup();
 try {
  const whole=t.block(1,101),partA=t.block(2,102,{geometry:partialFace()}),partB=t.block(3,102,{geometry:new THREE.BoxGeometry(.11,.48,.34).translate(.39,.13,-.18)});
  t.block(4,103);t.block(5,102,{kind:'fragment'});
  const marked=new Map([[101,Infinity],[102,Infinity]]);
  t.powers.syncMarks(marked,t.blocks);
  assert.equal(t.powers.marks.size,3,'all clusters, not only the largest surviving one');
  for(const o of [whole,partA,partB]) {
   const shell=t.powers.marks.get(o.id);
   assert(shell.visible);assert.equal(shell.parent,o.mesh);assert.equal(shell.geometry,o.mesh.geometry);
   assert.equal(shell.children.length,1);assert(shell.children[0].isLineSegments);
   assert.notEqual(shell.children[0].geometry,t.powers.frostEdgeGeometry,'real fragment outlines replace warmup box edges');
   assert.deepEqual(shell.scale.toArray(),[1,1,1],'ice does not expand the physical-looking object');
  }
  assert.equal(t.powers.marks.has(4),false);assert.equal(t.powers.marks.has(5),false);
  assert.equal(t.powers.marks.get(2).geometry.attributes.position.count,6,'missing faces remain missing');
  t.powers.time=1e8;t.powers.syncMarks(marked,t.blocks);
  assert.equal(t.powers.marks.size,3,'round-long marks do not expire in the visual layer');
  t.powers.syncMarks([{originId:102,expires:Infinity}],t.blocks);
  assert.equal(t.powers.marks.size,2,'HUD snapshot arrays retain the same origin semantics');
 } finally {t.dispose();}
});

test('shells preserve colored glass materials and follow final mesh transforms without lag',()=>{
 const t=setup();
 try {
  const materials=[new THREE.MeshBasicMaterial({color:0xf06731}),new THREE.MeshPhysicalMaterial({color:0x48bd7a,transmission:.5})];
  const o=t.block(1,20,{material:materials}),colors=materials.map(m=>m.color.clone());
  t.powers.syncMarks(new Map([[20,Infinity]]),t.blocks);const shell=t.powers.marks.get(1);
  t.scene.position.z=-24;o.mesh.position.set(2,3,-5);o.mesh.rotation.set(.7,1.1,-.4);o.mesh.scale.set(.8,1.2,.7);
  t.scene.updateMatrixWorld(true);matrixNear(shell.matrixWorld,o.mesh.matrixWorld);matrixNear(shell.children[0].matrixWorld,o.mesh.matrixWorld);
  assert.equal(o.mesh.material,materials);materials.forEach((m,i)=>assert(m.color.equals(colors[i])));
  assert.equal(shell.material,t.powers.frostMaterial);assert.equal(shell.material.transparent,true);
  assert.equal(shell.material.depthWrite,false);assert.equal(shell.material.depthTest,true);
  assert.equal(shell.material.polygonOffset,true,'coincident surface uses depth bias rather than oversized geometry');
  assert.match(shell.material.fragmentShader,/float alpha=clamp\(0\.065/,'the base coat remains translucent');
  assert.match(shell.material.fragmentShader,/crystal\*0\.38/,'crystals have stronger local frost');
  assert.match(shell.material.fragmentShader,/rim\*0\.24/,'silhouette gets an icy highlight');
  assert.equal(shell.children[0].material,t.powers.iceMaterial);
  assert(t.powers.iceMaterial.opacity>.6,'real ice edges read clearly');
  assert.equal(shell.material.side,THREE.FrontSide,'one transparent surface pass keeps the glass readable');
 } finally {t.dispose();}
});

test('fracturing removes old shells and immediately covers all replacement clusters',()=>{
 const t=setup();
 try {
  const original=t.block(1,20),ownerDisposals=disposals(original.mesh.geometry);
  const marked=new Map([[20,Infinity]]);t.powers.syncMarks(marked,t.blocks);
  const oldShell=t.powers.marks.get(1),oldEdges=oldShell.children[0].geometry,edgeDisposals=disposals(oldEdges);
  original.mesh.removeFromParent();t.blocks.delete(1);
  const a=t.block(2,20,{geometry:partialFace()}),b=t.block(3,20,{geometry:partialFace()});
  t.powers.syncMarks(marked,t.blocks);
  assert.deepEqual([...t.powers.marks.keys()],[2,3]);assert.equal(edgeDisposals(),1);
  assert.equal(oldShell.parent,null);assert.equal(oldShell.visible,false);
  assert.equal(oldShell.geometry,t.powers.frostGeometry,'pool does not retain deleted source geometry');
  assert.equal(t.powers.marks.get(a.id).geometry,a.mesh.geometry);assert.equal(t.powers.marks.get(b.id).geometry,b.mesh.geometry);
  assert.equal(ownerDisposals(),0,'only the structure owner can dispose its geometry');
  original.mesh.geometry.dispose();t.owned.delete(original.mesh.geometry);assert.equal(ownerDisposals(),1);
  t.powers.syncMarks(new Map(),t.blocks);assert.equal(t.powers.marks.size,0);assert.equal(t.powers.frostEdges.size,0);
 } finally {t.dispose();}
});

test('geometry replacement and in-place chips refresh owned edges without owning glass buffers',()=>{
 const t=setup();
 try {
  const o=t.block(1,20),marked=new Map([[20,Infinity]]),original=o.mesh.geometry,originalDisposals=disposals(original);
  t.powers.syncMarks(marked,t.blocks);const shell=t.powers.marks.get(1);
  const firstEdges=shell.children[0].geometry,firstDisposals=disposals(firstEdges);
  const replacement=partialFace();t.owned.add(replacement);o.mesh.geometry=replacement;
  t.powers.syncMarks(marked,t.blocks);
  assert.equal(t.powers.marks.get(1),shell);assert.equal(shell.geometry,replacement);
  assert.equal(firstDisposals(),1);assert.equal(originalDisposals(),0);assert.equal(t.powers.frostEdges.has(original),false);
  const nextEdges=shell.children[0].geometry,nextDisposals=disposals(nextEdges),position=replacement.attributes.position;
  position.setXYZ(0,-.2,-.35,.45);position.needsUpdate=true;replacement.computeVertexNormals();
  t.powers.syncMarks(marked,t.blocks);assert.equal(shell.geometry,replacement);
  assert.notEqual(shell.children[0].geometry,nextEdges);assert.equal(nextDisposals(),1);
  const unchanged=shell.children[0].geometry;t.powers.syncMarks(marked,t.blocks);assert.equal(shell.children[0].geometry,unchanged,'no per-frame outline rebuild');
  const newMesh=new THREE.Mesh(replacement,o.mesh.material);t.scene.add(newMesh);o.mesh=newMesh;t.powers.syncMarks(marked,t.blocks);
  assert.equal(shell.parent,newMesh,'a replacement visible mesh is followed even when cluster ID and geometry remain stable');
 } finally {t.dispose();}
});

test('pooled shells share materials and refcount outlines without leaking borrowed resources',()=>{
 const t=setup();
 const shared=new THREE.BoxGeometry(.8,.8,.8),sharedDisposals=disposals(shared);
 try {
  t.block(1,20,{geometry:shared});t.block(2,20,{geometry:shared});
  const marked=new Map([[20,Infinity]]);t.powers.syncMarks(marked,t.blocks);
  const shells=new Set(t.powers.marks.values()),[a,b]=shells;
  assert.equal(a.material,b.material);assert.equal(a.children[0].material,b.children[0].material);
  assert.equal(a.children[0].geometry,b.children[0].geometry);assert.equal(t.powers.frostEdges.size,1);
  const sharedEdges=a.children[0].geometry,edgeDisposals=disposals(sharedEdges);
  t.blocks.delete(1);t.powers.syncMarks(marked,t.blocks);assert.equal(edgeDisposals(),0,'other cluster still needs the shared outline');
  t.powers.clear();assert.equal(edgeDisposals(),1);assert.equal(t.powers.frostEdges.size,0);assert.equal(t.powers.markPool.length,2);
  const newBlock=t.block(3,20,{geometry:partialFace()});
  for(let i=0;i<20;i++) {
   t.powers.syncMarks(marked,t.blocks);assert.equal(t.powers.marks.size,2);
   for(const shell of t.powers.marks.values())assert(shells.has(shell),'shell nodes are reused');
   t.powers.clear();assert.equal(t.powers.frostEdges.size,0);assert.equal(newBlock.mesh.children.length,0);
   for(const shell of t.powers.markPool) {assert.equal(shell.parent,null);assert.equal(shell.geometry,t.powers.frostGeometry);assert.equal(shell.userData.frostSource,undefined);}
  }
  assert.equal(sharedDisposals(),0);
 } finally {t.dispose();}
 assert.equal(sharedDisposals(),1,'the test fixture, not frost disposal, owns the source geometry');
});


test('owner recursive disposal detaches a single cluster without disposing shared frost resources',()=>{
 const t=setup();
 try {
  const a=t.block(1,20),b=t.block(2,20),marked=new Map([[20,Infinity]]);
  t.powers.syncMarks(marked,t.blocks);
  const frostMaterialDisposals=disposals(t.powers.frostMaterial),iceMaterialDisposals=disposals(t.powers.iceMaterial);
  const ownerDisposals=disposals(a.mesh.geometry),outlineDisposals=disposals(t.powers.marks.get(1).children[0].geometry);
  assert.equal(t.powers.detachFrostCluster(a.id),true);
  assert.equal(t.powers.detachFrostCluster(a.id),false,'repeated removal cannot pool or dispose twice');
  // Mirrors main.removeCluster after its detachFrostCluster integration call.
  a.mesh.traverse(x=>{x.geometry?.dispose();if(x!==a.mesh)x.material?.dispose();});
  t.owned.delete(a.mesh.geometry);a.mesh.removeFromParent();t.blocks.delete(a.id);
  assert.equal(ownerDisposals(),1);assert.equal(outlineDisposals(),1);
  assert.equal(frostMaterialDisposals(),0);assert.equal(iceMaterialDisposals(),0);
  assert.equal(t.powers.marks.size,1);assert.equal(t.powers.marks.get(2).parent,b.mesh);
  assert.equal(t.powers.marks.get(2).visible,true);
  t.powers.clear();assert.equal(b.mesh.children.length,0);
  b.mesh.traverse(x=>{x.geometry?.dispose();if(x!==b.mesh)x.material?.dispose();});
  t.owned.delete(b.mesh.geometry);
  assert.equal(frostMaterialDisposals(),0);assert.equal(iceMaterialDisposals(),0);
 } finally {t.dispose();}
});

test('startup warmup includes both live shader variants and shared resources dispose exactly once',()=>{
 const t=setup(),resources=[t.powers.frostGeometry,t.powers.frostEdgeGeometry,t.powers.frostMaterial,t.powers.iceMaterial];
 const counts=resources.map(disposals),warm=t.powers.warmupObjects(),warmed=new Set();
 warm.traverse(o=>{if(o.geometry)warmed.add(o.geometry);if(o.material)warmed.add(o.material);});
 for(const resource of resources)assert(warmed.has(resource));
 assert(warm.children.some(o=>o.isMesh&&o.material===t.powers.frostMaterial));
 assert(warm.children.some(o=>o.isLineSegments&&o.material===t.powers.iceMaterial));
 const defines={...t.powers.frostMaterial.defines};
 t.block(1,20);t.powers.syncMarks(new Map([[20,Infinity]]),t.blocks);
 assert.deepEqual(t.powers.frostMaterial.defines,defines,'pickup requires no new shader defines');
 warm.clear();counts.forEach(count=>assert.equal(count(),0,'warmup detaches without disposing live shared resources'));
 t.dispose();counts.forEach(count=>assert.equal(count(),1));
 assert.equal(t.powers.markPool.length,0);assert.equal(t.powers.frostEdges.size,0);
});
