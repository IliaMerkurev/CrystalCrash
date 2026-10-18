// Headless production-path regression: real arena data, Three.js resources and
// Rapier bodies, with only the DOM/audio/renderer-facing UI surfaces stubbed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {GLASS,TUNE} from '../src/config.js';
import {RenderQuality,QUALITY_TIERS} from '../src/render-quality.js';
import {intactShellColliderDesc} from '../src/intact-shell-collider.js';
import {FractureTemplateCache} from '../src/fracture-template-cache.js';
import {createGraph} from '../src/cluster-graph.js';
import {wallThickness,shellPanels,shellGeometry,plateGeometry,fractureFaces,voronoiCells} from '../src/glass-shell.js';
import {arenaDefinition,arenaBlocks,setArenaRunSeed} from '../src/arena-data.js';
import {BonusController,BONUS_DEFS} from '../src/bonus-controller.js';
import {BonusWorld} from '../src/bonus-world.js';
import {SecondaryPowers} from '../src/secondary-powers.js';
import {CameraFX} from '../src/camera-fx.js';
import {BallTimeScale} from '../src/ball-time-scale.js';
import {AimTimeScale} from '../src/aim-time-scale.js';
import {BlackHoleImpactGuard} from '../src/blackhole-impact-guard.js';
import {CaptureCollisionProxy} from '../src/capture-collision-proxy.js';
import {BlackHoleRelease} from '../src/blackhole-release.js';

const source=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
function code(name){
 const start=source.indexOf('function '+name+'(');assert(start>=0,name);
 let depth=0,quote=null,comment=null,escaped=false;
 for(let i=source.indexOf('{',start);i<source.length;i++){
  const c=source[i],n=source[i+1];
  if(comment==='line'){if(c==='\n')comment=null;continue;}
  if(comment==='block'){if(c==='*'&&n==='/'){comment=null;i++;}continue;}
  if(quote){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c===quote)quote=null;continue;}
  if(c==='/'&&n==='/'){comment='line';i++;continue;}
  if(c==='/'&&n==='*'){comment='block';i++;continue;}
  if(c==='"'||c==="'"||c==='`'){quote=c;continue;}
  if(c==='{')depth++;else if(c==='}'&&!--depth)return source.slice(start,i+1);
 }
 assert.fail('Unterminated production function '+name);
}
class Element{
 constructor(tag='div'){this.tagName=tag;this.children=[];this.style={setProperty(){}};this.attributes={};this.events={};this.classList={toggle(){},add(){},remove(){}};this.value='';this.textContent='';}
 append(...children){this.children.push(...children);}
 appendChild(child){this.append(child);return child;}
 replaceChildren(...children){this.children=[...children];}
 setAttribute(key,value){this.attributes[key]=value;}
 addEventListener(name,fn){this.events[name]=fn;}
}
const body=new Element('body'),elements=new Map(['bonus-test','score','combo','toast','hint','section'].map(id=>[id,new Element()]));
const document={body,createElement:tag=>new Element(tag),createTextNode:text=>text};
const previousDocument=globalThis.document;globalThis.document=document;
await RAPIER.init();
const v3=(...n)=>new THREE.Vector3(...n),powers=new BonusController(),scene=new THREE.Scene();
let effectsCleared=0,notices=[],windowEvents={};
const context={tutorialEvent(){},tutorial:null,
 QUALITY_TIERS,renderQuality:new RenderQuality(),REFLECTION_RES:1024,applyRenderQuality(){},intactShellColliderDesc,fractureTemplates:new FractureTemplateCache(),BlackHoleRelease,CaptureCollisionProxy,THREE,RAPIER,GLASS,BONUS_DEFS,createGraph,wallThickness,shellPanels,shellGeometry,plateGeometry,fractureFaces,voronoiCells,
 arenaDefinition,arenaBlocks,document,window:{addEventListener:(name,fn)=>windowEvents[name]=fn},$ :id=>elements.get(id),
 v3,clamp:THREE.MathUtils.clamp,C:{...TUNE},GROUP:{table:0x0001001f,ball:0x00020017,structure:0x0004001f,debris:0x00080005},
 scene,powers,camera:new THREE.PerspectiveCamera(42,390/844,.1,100),cameraBase:v3(0,15,17),
 heavyBallMaterial:null,ballLandingAudio:{reset(){}},cameraFX:new CameraFX(),ballTimeScale:new BallTimeScale(),aimTimeScale:new AimTimeScale(),holeImpactGuard:new BlackHoleImpactGuard(),
 blastLens:null,frostScreenMask:null,tornadoVisual:null,powerFX:{clear(){effectsCleared++;}},audio:{play(){},setMusicPlaying(){}},canvas:{hasPointerCapture:()=>false},
 blocks:new Map(),originals:new Map(),colliders:new Map(),fragments:[],dust:[],dustMeshes:[{count:5}],glints:{count:5},particleGlow:{count:5},
 previousVel:new Map(),impactHistory:new Map(),strikeContacts:new Map(),arenaBodies:[],railLights:[],railGreen:new THREE.Color(0x24ff75),railProgress:{value:0},
 materials:GLASS.map(g=>new THREE.MeshPhysicalMaterial({color:g.color})),innerMaterials:GLASS.map(g=>new THREE.MeshPhysicalMaterial({color:g.color})),debrisMaterialPool:Array.from({length:5},()=>[]),
 gatePanels:[],gatePanelGroup:null,gateWave:null,gateMesh:null,gateBody:null,previewGroup:null,previewCores:[],
 gateOpen:false,gateReady:false,gateReveal:0,TOP:-9,MID:0,BOTTOM:7,NEAR_HALF:6.25,STRIDE:17.2,TRAVEL:1.35,GATE_WIDTH:12.3,GATE_HEIGHT:1.5,GATE_DEPTH:.18,
 heldPosition:v3(),repositionFrom:v3(),targetRing:{visible:false},aimLine:{visible:false},
 uid:0,rngState:123,section:1,score:0,chain:0,comboTime:0,powerTime:0,accumulator:0,transition:0,repositionTime:0,missTimer:0,slow:0,
 arenaOffset:0,aimShift:0,aimBlend:0,travelFrom:0,drag:null,state:'READY',toastTime:0,elapsed:0,clearDelay:0,
 qaPower:'bomb',started:true,paused:false,bonusTestOpen:false,bonusTestPanel:null,blackHoleLookPoint:null,reduced:false,
 tell:(message)=>notices.push(message),tableHalf:()=>6.25,
};
vm.createContext(context);
for(const name of ['rand','layoutZ','fixed','arenaPhysics','setupPhysics','addBlock','removeCluster','disposeDebris','resetBall','sectionBlocks','generateSection','closeGate','makePreview','cancelDrag','updateRailLighting','updateAimCamera','loadTestArena','setupBonusTestMenu','syncModalBlur'])vm.runInContext(code(name),context);
context.setupPhysics();
context.bonusWorld=new BonusWorld({scene,controller:powers,radius:context.C.ballRadius,bounds:()=>({top:context.TOP,mid:0,bottom:7,half:context.tableHalf}),blocked:()=>false,onSound(){},onNotice(){},onActivate(){}});
context.secondary=new SecondaryPowers({THREE,RAPIER,scene,world:context.world,colliders:context.colliders,radius:context.C.ballRadius,tableGroup:context.GROUP.table,structureGroup:context.GROUP.structure});
setArenaRunSeed(123456789);
const seededBefore=[2,14].map(level=>arenaBlocks(level));
context.generateSection();assert.equal(context.blocks.size,6,'starts in an actual QA fixture');
const baselineBodies=context.arenaBodies.length+1;
context.setupBonusTestMenu();
const descendants=root=>[root,...root.children.filter(x=>typeof x==='object').flatMap(descendants)];
const find=id=>descendants(body).find(el=>el.id===id);
const select=find('test-arena-select'),load=find('test-arena-load'),note=find('test-arena-note');
assert.equal(select.children.length,14);assert(select.children.every((option,i)=>option.value===String(i+1)&&option.textContent.includes(arenaDefinition(i+1).name)));
assert.match(note.textContent,/Load resets arena and effects/);assert.match(note.textContent,/Score resets to 0/);
elements.get('bonus-test').onclick();assert(context.bonusTestOpen);assert.equal(select.value,'1');
select.value='14';assert.equal(context.section,1);assert.equal(context.blocks.size,6);assert.equal(context.qaPower,'bomb');assert.equal(select.onchange,undefined,'selection does not load an arena');
windowEvents.keydown({key:'Escape',preventDefault(){}});assert(!context.bonusTestOpen);assert.equal(context.section,1,'dismiss does not load');
for(const value of [0,15,-1,2.5,'invalid',Infinity])assert.equal(context.loadTestArena(value),false);
assert.equal(context.blocks.size,6,'invalid input has no side effects');

let serial=0;
function dirtyScene(){
 const first=context.blocks.values().next().value;
 const crack=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial());first.mesh.add(crack);
 const tracked=[first.mesh.geometry,crack.geometry,crack.material,...first.origin.graph.cells.map(cell=>cell.geometry)];
 const disposed=new Set();for(const resource of tracked)resource.addEventListener('dispose',()=>disposed.add(resource));
 const fragment={type:0,mesh:new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial())};scene.add(fragment.mesh);context.fragments.push(fragment);context.dust.push({});
 context.bonusWorld.release({id:'test-bomb-'+(++serial),bonus:'bomb',bonusPose:{p:v3(0,1,3),q:new THREE.Quaternion(),v:v3()}});
 context.bonusWorld.release({id:'test-pickup-'+serial,bonus:'pierce',bonusPose:{p:v3(1,1,3),q:new THREE.Quaternion(),v:v3()}});
 const oldPickups=[...context.bonusWorld.pickups],timer=oldPickups.find(p=>p.kind==='bomb').timerRing;
 context.bonusWorld.rings[0].mesh.visible=true;context.bonusWorld.arcs[0].mesh.visible=true;
 context.bonusWorld.pendingTips.push({key:'stale'});context.bonusWorld.tip={key:'stale'};context.bonusWorld.tipAge=10;
 powers.collect('pulse');powers.collect('pierce');
 context.secondary.spawnSplit({id:serial,activationId:serial},v3(0,.38,4),v3(0,0,-5),0);
 context.secondary.render();assert(context.secondary.echoes.length>0);const oldEchoBodies=context.secondary.echoes.map(e=>e.b);
 context.secondary.createWell(v3(0,0,-1),0,context.blocks);context.secondary.transitionParked=true;
 context.cameraFX.bomb();context.cameraFX.update(.1,{blackHoleActive:true});context.blackHoleLookPoint=v3(2,3,-1);
 context.ballTimeScale.scale=.35;context.aimTimeScale.scale=.4;
 context.holeImpactGuard.protectedOrigins.set(first.origin.id,first.origin);
 context.state='TRANSITION';context.transition=.7;context.repositionTime=.5;context.missTimer=.4;context.powerTime=99;context.accumulator=.1;context.slow=.2;
 context.score=1234;context.chain=5;context.comboTime=3;context.aimBlend=.7;context.aimShift=2;context.arenaOffset=-200;scene.position.z=-200;
 context.drag={id:9,echo:context.secondary.echoes[0]};context.targetRing.visible=true;
 context.previousVel.set(first.b.handle,{x:2,y:0,z:0});context.impactHistory.set('stale',{});context.strikeContacts.set('stale',{});
 context.ball.collider(0).setSolverGroups(0);context.ball.addForce({x:10,y:2,z:3},true);context.ball.addTorque({x:1,y:2,z:3},true);
 return {tracked,disposed,fragment,oldPickups,timer,oldEchoBodies,oldBodies:[...context.blocks.values()].map(o=>o.b),oldGate:context.gateBody,oldPreview:context.previewGroup,oldPreviewCores:[...context.previewCores]};
}
const counts=new Map();
for(const level of [2,14,2,14,14,2]){
 const old=dirtyScene();elements.get('bonus-test').onclick();assert(context.bonusTestOpen);select.value=String(level);load.onclick();
 assert(!context.bonusTestOpen);assert.equal(context.section,level);assert.equal(context.qaPower,null);assert.equal(context.state,'HELD');assert.equal(context.drag,null);
 const expected=arenaDefinition(level).blockCount;assert.equal(context.blocks.size,expected);assert.equal(context.originals.size,expected);assert.equal(context.world.bodies.len(),baselineBodies+expected+1);
 const currentCounts={bodies:context.world.bodies.len(),colliders:context.colliders.size,children:scene.children.length,previewChildren:context.previewGroup.children.length};
 if(counts.has(level))assert.deepEqual(currentCounts,counts.get(level));else counts.set(level,currentCounts);
 assert.equal(context.world.colliders.len(),context.colliders.size);
 for(const collider of context.colliders.keys())assert(context.world.getCollider(collider),'no stale collider reference');
 for(const body of [...old.oldBodies,...old.oldEchoBodies,old.oldGate])assert(!body.isValid(),'old body was removed');
 assert.equal(old.oldPreview.parent,null);assert(old.oldPreviewCores.every(core=>core.parent===null));assert.notEqual(context.previewGroup,old.oldPreview);
 assert.equal(context.previewGroup.children.filter(o=>o.geometry&&o!==context.previewGroup.children.at(-1)).length,arenaDefinition(level+1).blockCount);
 assert.equal(old.fragment.mesh.parent,null);assert(old.tracked.every(resource=>old.disposed.has(resource)),'cluster, child and fracture geometry disposed');
 assert.equal(context.fragments.length,0);assert.equal(context.dust.length,0);assert(context.dustMeshes.every(mesh=>mesh.count===0));assert.equal(context.glints.count,0);assert.equal(context.particleGlow.count,0);
 assert.equal(context.bonusWorld.pickups.length,0);assert(old.oldPickups.every(p=>p.mesh.parent===null&&p.shadow.parent===null));assert.equal(old.timer.parent,null);
 assert.equal(context.bonusWorld.pendingTips.length,0);assert.equal(context.bonusWorld.tip,null);assert([...context.bonusWorld.rings,...context.bonusWorld.arcs].every(fx=>!fx.mesh.visible));
 assert.equal(powers.active,null);assert.equal(powers.splitActive,false);assert.equal(context.secondary.echoes.length,0);assert.equal(context.secondary.echoInstances.count,0);assert.equal(context.secondary.well,null);assert.equal(context.secondary.blackHole,null);assert.equal(context.secondary.transitionParked,false);
 assert.equal(context.holeImpactGuard.protectedOrigins.size,0);assert.equal(context.previousVel.size,0);assert.equal(context.impactHistory.size,0);assert.equal(context.strikeContacts.size,0);
 for(const key of ['score','chain','comboTime','powerTime','transition','repositionTime','missTimer','accumulator','slow','arenaOffset','aimBlend','aimShift'])assert.equal(context[key],0,key+' resets');
 assert.equal(scene.position.z,0);assert.equal(context.blackHoleLookPoint,null);assert.equal(context.ballTimeScale.scale,1);assert.equal(context.aimTimeScale.scale,1);assert.equal(context.camera.fov,42);assert(context.camera.position.distanceTo(context.cameraBase)<1e-6);
 assert.equal(context.gateReady,false);assert.equal(context.gateOpen,false);assert.equal(context.railProgress.value,0);assert.equal(context.targetRing.visible,false);
 assert.equal(context.ball.collider(0).solverGroups(),context.GROUP.ball);assert.equal(context.ball.collider(0).collisionGroups(),context.GROUP.ball);
 assert(Math.abs(context.ball.translation().z-context.C.startZ)<1e-5);assert.equal(context.ball.linvel().x,0);assert.equal(context.ball.userForce().x,0);assert.equal(context.ball.userTorque().x,0);
 assert.equal(elements.get('score').textContent,'0');assert.equal(elements.get('combo').textContent,'');assert.equal(elements.get('section').textContent,`ARENA ${arenaDefinition(level).label}`);
 assert.deepEqual([2,14].map(n=>arenaBlocks(n)),seededBefore,'loading preserves the run seed');
}
assert(effectsCleared>=7);
elements.get('bonus-test').onclick();assert.equal(select.value,'2');assert(descendants(body).some(el=>el.className==='test-arena-current'&&el.textContent==='Current: 2 · Double Tap'));
const css=fs.readFileSync(new URL('../src/style.css',import.meta.url),'utf8');
assert.match(css,/\.bonus-test-card\{[^}]*max-height:calc\(100dvh - 32px\)[^}]*overflow-y:auto/);
assert.match(css,/\.test-arena-row select\{[^}]*min-width:0/);
assert(source.includes("card.className='glass-panel bonus-test-card'"));
context.world.free();context.queue.free();globalThis.document=previousDocument;
console.log('PASS Test menu choices/current arena, selection-only safety, Escape/invalid no-op, explicit Load and scroll styling');
console.log('PASS six real Rapier/Three repeat loads across arenas 2/14, stable scene/body/collider counts, disposed old resources, clean gate/preview/ball/effects/camera and unchanged run seed');
