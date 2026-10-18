// CPU lifecycle/contract tests. Feathering and blend appearance need browser GPU QA.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {SoftContactShadows,SOFT_CONTACT_LIMITS as LIMITS} from '../src/soft-contact-shadows.js';
const make=()=>new SoftContactShadows({THREE,scene:new THREE.Scene()});
const ball=(x=0,y=.38,z=0)=>({p:{x,y,z},radius:.38});
const settings={enabled:true,top:-6,bottom:6,half:z=>6+(z+6)/12*2};
const readMatrix=(v,index=0)=>{const matrix=new THREE.Matrix4();v.mesh.getMatrixAt(index,matrix);return matrix;};
test('main ball, extras and cube clusters share one instanced draw',()=>{
 const v=make(),mesh=new THREE.Mesh(new THREE.BoxGeometry(.88,.88,.88));mesh.position.set(1,.44,2);
 v.update({...settings,balls:[ball(),ball(1)],blocks:new Map([[1,{mesh}]])});
 assert.equal(v.mesh.count,3);assert.equal(v.group.children.length,1);assert.equal(v.group.visible,true);
 assert.deepEqual(Array.from(v.mesh.geometry.attributes.contactShape.array.slice(0,3)),[0,0,1]);assert.equal(v.mesh.renderOrder,-9);
 assert.equal(v.material.isShaderMaterial,true);assert.equal(v.mesh.castShadow,false);assert.equal(v.material.depthWrite,false);assert.equal(v.material.map,undefined);
 assert.deepEqual(v.uniforms.tableBounds.value.toArray(),[-6,6,6,8]);
 assert.ok(Math.abs(readMatrix(v).elements[13]-.004)<1e-6);v.dispose();mesh.geometry.dispose();
});
test('explicit off clears every contact and does not inspect sources',()=>{
 const v=make();v.update({...settings,balls:[ball()]});const never={[Symbol.iterator](){throw Error('off must not read sources');}};
 v.update({...settings,enabled:false,balls:never,blocks:never});assert.equal(v.group.visible,false);assert.equal(v.mesh.count,0);
 v.update({...settings,balls:[ball()]});assert.equal(v.mesh.count,1);v.update();assert.equal(v.mesh.count,0);v.dispose();
});
test('altitude expands and fades balls, missing/invalid/off-table sources vanish',()=>{
 const v=make();v.update({...settings,balls:[ball()]});const groundScale=readMatrix(v).elements[0],groundOpacity=v.mesh.geometry.attributes.contactOpacity.getX(0);
 v.update({...settings,balls:[ball(0,2)]});assert.ok(readMatrix(v).elements[0]>groundScale);assert.ok(v.mesh.geometry.attributes.contactOpacity.getX(0)<groundOpacity);
 v.update({...settings,balls:[ball(0,9),ball(0,-1),ball(50),ball(0,.38,40),ball(NaN),{...ball(),removed:true},{...ball(),valid:false}]});assert.equal(v.mesh.count,0);
 assert.match(v.material.fragmentShader,/mix\(tableBounds.z,tableBounds.w,along\)/);assert.match(v.material.fragmentShader,/smoothstep\(0\.,\.055,edge\)/);assert.match(v.material.fragmentShader,/shadowShape\*\.72/);assert.match(v.material.fragmentShader,/exp\(-3.5\*r\*r\)/);assert.match(v.material.fragmentShader,/smoothstep\(\.45,1\.,r\)/);v.dispose();
});
test('geometry bounds are cached and actual cluster geometry overrides original cube sizes',()=>{
 const v=make(),geometry=new THREE.BoxGeometry(.2,.4,.6);let computes=0;const compute=geometry.computeBoundingBox.bind(geometry);geometry.computeBoundingBox=()=>{computes++;compute();};
 const mesh=new THREE.Mesh(geometry);mesh.position.set(1,.2,2);mesh.rotation.y=Math.PI/2;
 const block={mesh,sx:10,sy:10,sz:10,b:{setTranslation(){throw Error('physics mutation');}}};
 v.update({...settings,blocks:[block]});const m=readMatrix(v);assert.ok(Math.abs(m.elements[0]-(.6*.66+.08))<1e-6);assert.equal(m.elements[12],1);assert.equal(m.elements[14],2);
 for(let i=0;i<30;i++)v.update({...settings,blocks:[block]});assert.equal(computes,1);assert.equal(v.mesh.count,1);mesh.position.y=-2;v.update({...settings,blocks:[block]});assert.equal(v.mesh.count,0);v.dispose();geometry.dispose();
});
test('capacity grows geometrically once, preserves entries and is reused and bounded',()=>{
 const v=make(),material=v.material,old=v.mesh;let released=0;old.addEventListener('dispose',()=>released++);old.geometry.addEventListener('dispose',()=>released++);
 const balls=Array.from({length:140},(_,i)=>ball(i/100));v.update({...settings,balls});assert.equal(v.mesh.count,140);assert.equal(v.capacity,256);assert.equal(released,2);assert.equal(v.material,material);assert.equal(readMatrix(v,139).elements[12],Math.fround(1.39));
 const instanceArray=v.mesh.instanceMatrix.array,opacityArray=v.mesh.geometry.attributes.contactOpacity.array;
 for(let i=0;i<100;i++)v.update({...settings,balls});assert.equal(v.mesh.instanceMatrix.array,instanceArray);assert.equal(v.mesh.geometry.attributes.contactOpacity.array,opacityArray);
 v.update({...settings,balls:Array.from({length:LIMITS.maxCapacity+1},()=>ball())});assert.equal(v.mesh.count,LIMITS.maxCapacity);assert.equal(v.capacity,LIMITS.maxCapacity);assert.equal(v.group.children.length,1);v.dispose();
});
test('warmup cleanup and disposal never destroy live shared resources early',()=>{
 const v=make(),warm=v.warmupObjects(),clone=warm.children[0];assert.equal(clone.count,1);assert.equal(clone.geometry,v.mesh.geometry);assert.notEqual(clone.material,v.material);assert.equal(clone.userData.powerFXWarmupMaterial,true);
 let geometryDisposed=0,materialDisposed=0,instanceDisposed=0;v.mesh.geometry.addEventListener('dispose',()=>geometryDisposed++);v.material.addEventListener('dispose',()=>materialDisposed++);v.mesh.addEventListener('dispose',()=>instanceDisposed++);
 clone.dispose();clone.material.dispose();assert.equal(geometryDisposed+materialDisposed,0);assert.equal(v.group.visible,false);
 v.update({...settings,balls:[ball()]});assert.equal(v.mesh.count,1);v.dispose();v.dispose();v.update({...settings,balls:[ball()]});assert.equal(v.mesh.count,0);assert.deepEqual([geometryDisposed,materialDisposed,instanceDisposed],[1,1,1]);assert.equal(v.group.parent,null);
});
test('invalid bounds and empty updates hide stale instances',()=>{
 const v=make();for(const invalid of [{top:6,bottom:6},{half:NaN},{half:()=>-1},{bottom:Infinity}]){v.update({...settings,balls:[ball()]});v.update({...settings,...invalid,balls:[ball()]});assert.equal(v.mesh.count,0);}
 v.update({...settings});assert.equal(v.mesh.count,0);v.dispose();
});
