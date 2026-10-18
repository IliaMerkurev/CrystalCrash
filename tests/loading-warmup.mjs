import assert from 'node:assert/strict';
import fs from 'node:fs';import vm from 'node:vm';
import * as THREE from 'three';import RAPIER from '@dimforge/rapier3d-compat';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {wallThickness,shellGeometry,plateGeometry} from '../src/glass-shell.js';
import {FractureTemplateCache} from '../src/fracture-template-cache.js';
import {intactShellColliderDesc} from '../src/intact-shell-collider.js';
import {GLASS,TUNE as C} from '../src/config.js';
const source=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
function code(name){const re=new RegExp('(?:async )?function '+name+'\\('),start=source.search(re);assert(start>=0,name);const tail=source.slice(start),next=tail.slice(10).search(/\n(?:async )?function /);return next<0?tail:tail.slice(0,next+10);}
await RAPIER.init();
const world=new RAPIER.World({x:0,y:-18,z:0}),scene=new THREE.Scene(),material=()=>new THREE.MeshPhysicalMaterial();let sounds=0,progress=0;
const ctx={THREE,RAPIER,GLASS,C,world,scene,wallThickness,shellGeometry,plateGeometry,mergeGeometries,intactShellColliderDesc,fractureTemplates:new FractureTemplateCache(),clamp:THREE.MathUtils.clamp,v3:(...a)=>new THREE.Vector3(...a),uid:0,rngState:123,tableHalf:()=>6,MID:0,elapsed:0,materials:Array.from({length:5},material),innerMaterials:Array.from({length:5},material),fractureMaterials:Array.from({length:5},material),debrisMaterials:Array.from({length:5},material),debrisMaterialPool:Array.from({length:5},()=>[]),originals:new Map(),blocks:new Map(),colliders:new Map(),fragments:[],dust:[],GROUP:{structure:0x0004001f,debris:0x00080001},blackHoleRelease:null,captureCollisionProxy:null,secondary:null,bonusWorld:null,registerEnvironmentMaterial:m=>m,audio:{play(){sounds++;}},updateSectionProgress(){progress++;}};
vm.createContext(ctx);
for(const n of ['rand','addBlock','removeCluster','dissolveDuration','meltLife','createDebris','disposeDebris','clusterChips','isResidual','splitCluster','awardOriginal','createLoadingFractureRehearsal'])vm.runInContext(code(n),ctx);
const original=ctx.addBlock(2,.44,-2,0),baseline={bodies:world.bodies.len(),colliders:world.colliders.len(),children:scene.children.length,uid:ctx.uid,rng:ctx.rngState};
for(let repeat=0;repeat<2;repeat++){
 const clean=ctx.createLoadingFractureRehearsal();assert.equal(ctx.originals.size,6);assert.equal(ctx.fragments.length,5);assert.equal(ctx.blocks.size,6);assert(world.colliders.len()>baseline.colliders+5);assert.equal(sounds,0);assert.equal(progress,0);assert.equal(ctx.dust.length,0);
 clean();assert.equal(world.bodies.len(),baseline.bodies);assert.equal(world.colliders.len(),baseline.colliders);assert.equal(scene.children.length,baseline.children);assert.equal(ctx.uid,baseline.uid);assert.equal(ctx.rngState,baseline.rng);assert.equal(ctx.blocks.get(original.id),original);assert.equal(ctx.originals.size,1);assert.equal(ctx.fragments.length,0);assert(ctx.debrisMaterialPool.every(p=>p.length===1));
}
// Actual rehearsal cleanup also runs if split creation throws midway.
const split=ctx.splitCluster;let calls=0;ctx.splitCluster=(...a)=>{if(++calls===3)throw Error('fixture failure');return split(...a);};assert.throws(()=>ctx.createLoadingFractureRehearsal(),/fixture/);ctx.splitCluster=split;assert.equal(world.bodies.len(),baseline.bodies);assert.equal(world.colliders.len(),baseline.colliders);assert.equal(ctx.originals.size,1);assert.equal(ctx.uid,baseline.uid);assert.equal(ctx.rngState,baseline.rng);
console.log('PASS real Rapier fracture rehearsal: five tiers, retained pools, no score/audio/dust/progress, repeated cleanup and failure cleanup');

const log=[],light={visible:true},fill={visible:true};let target=null,quality=0,fail=false,cleaned=0;
const instance=()=>new THREE.InstancedMesh(new THREE.BoxGeometry(.1,.1,.1),material(),2);
Object.assign(ctx,{ball:original.b,ballMesh:new THREE.Mesh(new THREE.SphereGeometry(.38),material()),canvas:{style:{visibility:''}},camera:new THREE.PerspectiveCamera(),railLights:[light],effectiveAreaLights:()=>false,performanceSettings:{fillLighting:false},dustMeshes:[instance()],glints:instance(),particleGlow:instance(),gatePanelGroup:{visible:false},previewGroup:{userData:{full:{visible:false}}},powerFX:null,tornadoVisual:null,softContacts:null,qaPower:null,location:{search:''},arenaOffset:0,performance:{now:()=>log.length},blackHoleLens:null,blastLens:null,renderQuality:{auto:true,calibrate(){log.push('calibrate');}},applyMaterialOptions(){log.push('materials');},applyRenderQuality(){quality++;log.push('quality');},createLoadingFractureRehearsal(){log.push('rehearse');return()=>{cleaned++;};},renderer:{getDrawingBufferSize:v=>v.set(100,100),getRenderTarget:()=>target,setRenderTarget:t=>{target=t;},async compileAsync(){assert(!light.visible&&!fill.visible);log.push(target?'compile-target':'compile-screen');if(fail)throw Error('compile failure');},render(){assert(!light.visible&&!fill.visible);log.push(target?'draw-target':'draw-screen');},getContext:()=>({finish(){log.push('finish');}})}});
scene.userData.fillLights=[fill];class Lens{constructor(){log.push('lens-init');}async warm(){log.push('lens-compile');}render(){log.push('lens-copy-draw');}trigger(){}update(){}clear(){log.push('lens-clear');}}
ctx.BlackHoleLens=ctx.BlastLens=Lens;vm.runInContext(code('warmGlassShaders'),ctx);
const counts=[ctx.dustMeshes[0],ctx.glints,ctx.particleGlow].map(m=>m.count),children=scene.children.length;
await ctx.warmGlassShaders();assert.equal(quality,2);assert(log.indexOf('calibrate')<log.indexOf('compile-screen'));assert(log.indexOf('compile-screen')<log.indexOf('lens-copy-draw'));assert.equal(log.filter(x=>x==='lens-copy-draw').length,2);assert.equal(log.at(-1),'draw-screen');assert.equal(ctx.canvas.style.visibility,'');assert(light.visible&&fill.visible);assert.equal(target,null);assert.equal(scene.children.length,children);assert.equal(cleaned,1);assert.deepEqual([ctx.dustMeshes[0],ctx.glints,ctx.particleGlow].map(m=>m.count),counts);
fail=true;await assert.rejects(ctx.warmGlassShaders(),/compile failure/);assert(light.visible&&fill.visible);assert.equal(ctx.canvas.style.visibility,'');assert.equal(target,null);assert.equal(scene.children.length,children);assert.equal(cleaned,2);
const boot=source.slice(source.indexOf('try{await RAPIER.init()'));assert(boot.indexOf('await environmentReady')<boot.indexOf('await warmGlassShaders()'));assert(boot.indexOf('await warmGlassShaders()')<boot.indexOf("$('play').disabled=false"));
console.log('PASS selected-light async scope, final-quality screen draw, lens first copy, cleanup/settings/count restoration, failure restoration and awaited PLAY ordering');
ctx.fractureTemplates.dispose();world.free();
