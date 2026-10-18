// CPU-only synthetic comparison. No renderer, GPU, browser, frame pacing or
// visual-quality claim. Timings depend on this machine and Rapier version.
import {performance} from 'node:perf_hooks';
import RAPIER from '@dimforge/rapier3d-compat';
import {shellPanels,wallThickness,fractureFaces,plateGeometry} from '../src/glass-shell.js';
import {createGraph} from '../src/cluster-graph.js';
import {GLASS} from '../src/config.js';
import {intactShellColliderDesc} from '../src/intact-shell-collider.js';
import {FractureTemplateCache} from '../src/fracture-template-cache.js';
await RAPIER.init();
const median=values=>values.toSorted((a,b)=>a-b)[Math.floor(values.length/2)];
const rounded=n=>Math.round(n*1000)/1000;
const dispose=graph=>graph.cells.forEach(cell=>cell.geometry.dispose());
function stack(single){
 const world=new RAPIER.World({x:0,y:-9.81,z:0}),sx=.88,sy=.88,sz=.88,type=2,t=wallThickness(type),mass=sx*sy*sz*GLASS[type].density;
 const start=performance.now(),ground=world.createRigidBody(RAPIER.RigidBodyDesc.fixed());world.createCollider(RAPIER.ColliderDesc.cuboid(20,.1,20).setFriction(.65),ground);
 for(let y=0;y<6;y++)for(let z=0;z<5;z++)for(let x=0;x<5;x++){
  // No sleeping keeps both variants under the same sustained contact load.
  const b=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation((x-2)*1.25,.54+y*.89,(z-2)*1.25).setCanSleep(false).setLinearDamping(.12).setAngularDamping(.25).setCcdEnabled(true));
  const descriptors=single?[intactShellColliderDesc(RAPIER,sx,sy,sz,t,mass)]:shellPanels(sx,sy,sz,t).map(panel=>RAPIER.ColliderDesc.cuboid(...panel.size.map(n=>n/2)).setTranslation(...panel.p).setMass(mass/6));
  for(const d of descriptors)world.createCollider(d.setFriction(.65).setRestitution(.08),b);
 }
 const constructionMs=performance.now()-start;world.timestep=1/90;
 for(let i=0;i<60;i++)world.step();const times=[];
 for(let i=0;i<240;i++){const t0=performance.now();world.step();times.push(performance.now()-t0);}
 const result={bodies:world.bodies.len(),colliders:world.colliders.len(),constructionMs,meanStepMs:times.reduce((a,b)=>a+b,0)/times.length,medianStepMs:median(times),p95StepMs:times.toSorted((a,b)=>a-b)[Math.floor(times.length*.95)]};world.free();return result;
}
const six=[],one=[];for(let i=0;i<3;i++){// Alternate order to reduce warmup/order bias.
 if(i%2){one.push(stack(true));six.push(stack(false));}else{six.push(stack(false));one.push(stack(true));}
}
const summarize=runs=>Object.fromEntries(Object.keys(runs[0]).map(key=>[key,rounded(median(runs.map(r=>r[key])))]));
const shape={sx:.88,sy:.88,sz:.88,type:2},cache=new FractureTemplateCache({variantsPerShape:3});
for(let variant=0;variant<3;variant++)dispose(cache.instantiate({...shape,variant}));
let seed=123;const rand=()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;};
function fresh(){const graph=createGraph(fractureFaces(shape.sx,shape.sy,shape.sz,wallThickness(shape.type),rand));for(const c of graph.cells){c.geometry=plateGeometry(c.points,c.t);c.geometry.applyQuaternion(c.q);c.geometry.translate(c.pos.x,c.pos.y,c.pos.z);const hull=plateGeometry(c.points.map(p=>p.map(n=>n*.992)),c.t*.98);hull.applyQuaternion(c.q);hull.translate(c.pos.x,c.pos.y,c.pos.z);c.colliderPoints=hull.attributes.position.array.slice();hull.dispose();}return graph;}
const freshTimes=[],cachedTimes=[];
for(let run=0;run<5;run++)for(const cached of run%2?[true,false]:[false,true]){const t0=performance.now();for(let i=0;i<100;i++)dispose(cached?cache.instantiate({...shape,variant:i%3}):fresh());(cached?cachedTimes:freshTimes).push((performance.now()-t0)/100);}
const baseline=summarize(six),optimized=summarize(one),fracture={freshPerOriginMs:rounded(median(freshTimes)),warmCachedPerOriginMs:rounded(median(cachedTimes)),cache:cache.stats};
cache.dispose();
console.log(JSON.stringify({scope:'CPU-only, Rapier 150-block no-sleep stack; 60 warmup + 240 measured steps × 3 runs; fracture = median of 5 × 100 origins',sixPanel:baseline,singleCuboid:optimized,meanStepSpeedup:rounded(baseline.meanStepMs/optimized.meanStepMs),fracture},null,2));
