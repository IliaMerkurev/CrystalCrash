import assert from 'node:assert/strict';
import * as THREE from 'three';
import {PowerFX} from '../src/power-fx.js';
const fx=new PowerFX({THREE,scene:new THREE.Scene(),radius:.38});const state={point:{x:0,y:2.8,z:-5},range:5.016,intensity:1,age:0},m=new THREE.Matrix4(),p=new THREE.Vector3();
const sample=()=>{fx.blackHoleParticles.getMatrixAt(0,m);p.setFromMatrixPosition(m);return {r:p.length(),direction:p.clone().normalize(),alpha:fx.blackHoleStreamAlpha.getX(0)};};
fx.syncBlackHole(state);let prior=sample(),direction=prior.direction,firstDrop=0,lastDrop=0;assert.equal(prior.alpha,0);const rotation=fx.blackHoleRings.map(r=>r.quaternion.clone());
for(let i=1;i<=99;i++){state.age=i*.01/(.48*6/3.5);fx.syncBlackHole(state);const next=sample();assert(next.r<prior.r);assert(next.direction.distanceTo(direction)<1e-5);if(i===1)firstDrop=prior.r-next.r;if(i===99)lastDrop=prior.r-next.r;prior=next;}
assert(lastDrop>firstDrop*5);assert(prior.r<.23);assert(prior.alpha<.1);fx.blackHoleRings.forEach((r,i)=>assert(r.quaternion.equals(rotation[i])));
fx.clear();assert(!fx.blackHoleRoot.visible);assert(fx.blackHoleStreamAlpha.array.every(x=>x===0));
console.log('PASS radial inward acceleration, fixed directions/rims, spawn/absorption fades and pooled reset');
