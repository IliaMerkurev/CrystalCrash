import assert from 'node:assert/strict';
import * as THREE from 'three';
import {PowerFX} from '../src/power-fx.js';
const fx=new PowerFX({THREE,scene:new THREE.Scene(),radius:.38});
const origin=new THREE.Vector3(0,.3,0),matrix=new THREE.Matrix4(),position=new THREE.Vector3();
const geometry=fx.fire.geometry,smokeMaterial=fx.smoke.material;
assert.equal(fx.fire.count,16);assert.equal(fx.smoke.count,12);assert.equal(fx.particles.length,80);
assert.equal(fx.fire.geometry,fx.smoke.geometry);
assert.equal(fx.smoke.material.depthWrite,false);
fx.trigger('bomb',origin);fx.update(.05,null,null);
assert(fx.flash.visible&&fx.flash.material.opacity>0);
assert.equal(fx.rings.filter(r=>r.mesh.visible).length,0,'Bomb no longer draws geometric rings');
fx.fire.getMatrixAt(0,matrix);position.setFromMatrixPosition(matrix);const firstDistance=position.distanceTo(origin);
fx.update(.25,null,null);assert(!fx.flash.visible);assert(fx.fire.visible&&fx.smoke.visible);
fx.fire.getMatrixAt(0,matrix);position.setFromMatrixPosition(matrix);assert(position.distanceTo(origin)>firstDistance,'lobes expand outward');
assert(fx.smoke.material.opacity>0&&fx.smoke.material.opacity<.44,'restrained smoke');
const streak=fx.particles.find(p=>p.kind==='bomb'&&p.stretch>=18);assert(streak);assert(streak.p.distanceTo(streak.origin)>0);
for(let n=0;n<80;n++)fx.update(.02,null,null);
assert(!fx.fire.visible&&!fx.smoke.visible&&!fx.flash.visible,'all volume expires before 1.5 seconds');
assert(fx.alpha.array.every(a=>a===0),'embers expire');
for(let n=0;n<10;n++){fx.trigger('bomb',origin);fx.update(.02,null,null);}
assert.equal(fx.fire.geometry,geometry);assert.equal(fx.smoke.material,smokeMaterial);assert.equal(fx.fire.count,16);assert.equal(fx.smoke.count,12);
const warm=fx.warmupObjects();assert(warm.children.some(o=>o.material.customProgramCacheKey()==='bomb-flame-volume-v1'));assert(warm.children.some(o=>o.material.customProgramCacheKey()==='bomb-smoke-volume-v1'));
for(const m of [fx.fire.material,fx.smoke.material]){const shader={uniforms:{},vertexShader:'#include <begin_vertex>',fragmentShader:'#include <color_fragment>'};m.onBeforeCompile(shader);assert(shader.uniforms.bombPhase);assert(shader.fragmentShader.includes('float bnoise'));assert(shader.vertexShader.includes('bombLocal=position'));}
fx.clear();assert(!fx.fire.visible&&!fx.smoke.visible&&!fx.flash.visible);assert.equal(fx.smoke.material.opacity,0);assert.equal(fx.bombAge,1.45);
fx.trigger('pulse',origin);assert(fx.rings.some(r=>r.mesh.visible),'other powers retain rings');
console.log('PASS Bomb: bounded pools, irregular shared geometry, expansion, flash/fire/smoke phases, restrained opacity, radial streaks, lifetime, warmup variants, reuse, reset, other-power rings');
