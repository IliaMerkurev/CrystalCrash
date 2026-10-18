import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import {BonusController,BONUS_DEFS} from '../src/bonus-controller.js';
const source=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
function code(name){const start=source.indexOf('function '+name+'(');assert(start>=0);const next=source.indexOf('\nfunction ',start+9);const event=source.indexOf("\ncanvas.addEventListener(",start);return source.slice(start,Math.min(next<0?source.length:next,event<0?source.length:event));}
const hits=[],fx=[],blocks=new Map();
const context={THREE,BONUS_DEFS,C:{ballRadius:.38},v3:(...x)=>new THREE.Vector3(...x),blocks,powerTime:10,elapsed:2,shake:0,ball:{linvel:()=>({x:0,y:0,z:-10})},powerFX:{trigger:kind=>fx.push(kind)},audio:{play(){}},secondary:{createWell(){return {targets:[1]};},spawnSplit(){}},bonusWorld:{teach(){},dismiss(){},pulse(){},feedback(){},arcTargets:(from,targets)=>fx.push(['arc',targets.length])},chipByStrike:(o,p,direct,damage=1)=>{hits.push({id:o.origin.id,damage});return true;},powers:new BonusController()};
vm.createContext(context);for(const n of ['bonusTargets','groundPowerTargets','applyPower','damage'])vm.runInContext(code(n),context);
function block(id,x,y,z,type=0){const geometry=new THREE.BoxGeometry(.88,.88,.88),o={id,origin:{id,lastStrike:-10},type,ids:[0],lastHit:-10,mesh:{geometry},b:{translation:()=>({x,y,z}),worldCom:()=>({x,y,z}),rotation:()=>({x:0,y:0,z:0,w:1})}};blocks.set(id,o);return o;}
block(1,0,.44,0);for(let i=2;i<=10;i++)block(i,(i-6)*.3,.44,-1);block(11,0,.44,-5);
context.applyPower({kind:'pulse',originId:1,radiusD:4.4,damage:3},new THREE.Vector3(0,.44,0));assert.equal(hits.length,9);assert(hits.every(h=>h.damage===3));assert(!hits.some(h=>h.id===11));
hits.length=0;blocks.clear();block(1,0,.44,0);block(2,0,1.32,0);block(3,0,.44,-20,4);block(4,3,.44,-12,3);
const targets=context.groundPowerTargets(new Set([1]));assert.deepEqual(Array.from(targets,t=>t.o.origin.id),[3,4]);context.applyPower({kind:'arc',originId:1,damage:1},new THREE.Vector3(),targets);assert.deepEqual(hits,[{id:3,damage:1},{id:4,damage:1}]);assert(fx.some(x=>Array.isArray(x)&&x[0]==='arc'&&x[1]===2));
hits.length=0;context.powers.collect('pierce');const token=context.powers.capture();context.damage(blocks.get(3),1,new THREE.Vector3(),true,token);assert.equal(hits[0].damage,8);assert.equal(context.powers.active.kind,'pierce');
// Exercise actual pointer functions with headless coordinates and a real camera snapshot.
let released=null,held=0,mainMoves=0;const echo={b:{translation:()=>({x:0,y:.25,z:2})},transitionParked:false};
Object.assign(context,{started:true,paused:false,drag:null,state:'BALL_ACTIVE',bonusTestOpen:false,innerWidth:400,innerHeight:800,MID:0,C:{ballRadius:.38,lossZ:6,launchMin:7,launchMax:24},canvas:{setPointerCapture(){},hasPointerCapture:()=>false},camera:new THREE.PerspectiveCamera(),checkLoss:()=>false,worldPoint:e=>new THREE.Vector3(e.clientX/100,.38,e.clientY/100),projectedBall:()=>new THREE.Vector3(0,0,0),tableHalf:()=>6,lowerTarget:()=>new THREE.Vector3(),audio:{unlock(){},play(){}},$ :()=>({textContent:''}),clamp:THREE.MathUtils.clamp,aimLine:{visible:false,geometry:{dispose(){}},computeLineDistances(){}},heldPosition:new THREE.Vector3(),ball:{translation:()=>({x:0,y:.38,z:-2}),setBodyType(){mainMoves++;}},secondary:{echoes:[echo],isValid:e=>e===echo,holdEcho(){held++;return true;},releaseEcho(e,v){released=v;}},bonusWorld:{dismiss(){}},holdBall:()=>assert.fail('Main ball should not be caught')});
for(const n of ['cancelDrag','aim','pointerDown','pointerMove','pointerUp'])vm.runInContext(code(n),context);
context.pointerDown({pointerId:1,clientX:200,clientY:400,button:0});assert.equal(context.drag.echo,echo);assert.equal(held,1);assert.equal(context.state,'BALL_ACTIVE');
context.pointerMove({pointerId:1,clientX:200,clientY:550});context.pointerUp({pointerId:1,clientX:200,clientY:550});assert(released.z< -10);assert.equal(mainMoves,0);assert.equal(context.drag,null);assert.equal(context.state,'BALL_ACTIVE');
assert(source.includes("drag?.mode==='aim'&&!drag.echo"));assert(source.includes('secondary?.remap(p=>{p.z+=STRIDE;})'));assert(source.includes('bonusWorld?.reset({preservePowers:reposition})'));
console.log('PASS production Pulse area/3-hit damage; Arc all ground targets and upper exclusion; Pierce instant-tier damage; extra-ball catch/relaunch keeps main state and attraction untouched; persistence/clock wiring inspected');
// A main-ball miss must not delete a healthy secondary ball.
let cleared=false;echo.valid=true;echo.activationId=77;context.powers=new BonusController();context.powers.splitActive=true;context.powers.splitActivationId=77;
Object.assign(context,{state:'BALL_ACTIVE',drag:null,powerFX:{clear(){}},secondary:{echoes:[echo],clear(){cleared=true;},endWell(){}},ball:{translation:()=>({x:0,y:.38,z:7}),collider:()=>({setSolverGroups(){}}),setBodyType(){}},RAPIER:{RigidBodyType:{Dynamic:0}},tell(){}});
vm.runInContext(code('checkLoss'),context);assert.equal(context.checkLoss(),true);assert.equal(cleared,false);assert.equal(context.powers.splitActive,true);assert.equal(context.powers.splitActivationId,77);
assert(source.includes("(state==='TRANSITION'||gateReady))secondary?.followTransition"));
assert(source.includes("elapsed<1&&oa?.kind!=='ball'&&ob?.kind!=='ball'&&oa?.kind!=='echo'&&ob?.kind!=='echo'"));
console.log('PASS healthy extra-ball survival on main miss; gate-ready follow and early echo-contact guards');
