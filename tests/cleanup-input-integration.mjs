import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import {GLASS,comboFor} from '../src/config.js';
const source=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
function code(name){const start=source.indexOf('function '+name+'(');assert(start>=0);const next=source.indexOf('\nfunction ',start+9);const event=source.indexOf("\ncanvas.addEventListener(",start);return source.slice(start,Math.min(next<0?source.length:next,event<0?source.length:event));}

let released=0,pops=0;const el={textContent:'',offsetWidth:0,classList:{remove(){},add(){pops++;}}};
const context={GLASS,comboFor,score:0,chain:0,comboTime:0,C:{comboWindow:2},reduced:true,slow:0,bonusWorld:{release(){released++;}},updateSectionProgress(){},audio:{play(){}},$:()=>el,document:{querySelector:()=>el},clamp:THREE.MathUtils.clamp,elapsed:10,blocks:new Map(),v3:(...a)=>new THREE.Vector3(...a)};
vm.createContext(context);vm.runInContext(code('awardOriginal'),context);vm.runInContext(code('chipByStrikeImpl'),context);
const original=(id,cleanup=false)=>({id,type:1,rewarded:false,cleanupNoScore:cleanup,clusters:new Set(),graph:{totalArea:1,cells:[],bonds:[]}});
const automatic=original(1,true);context.awardOriginal(automatic);assert.equal(context.score,0);assert.equal(context.chain,0);assert.equal(released,1);context.awardOriginal(automatic);assert.equal(released,1);
const player=original(2);context.awardOriginal(player);assert.equal(context.score,25);assert.equal(released,2);
const o={origin:original(3),type:1};context.chipByStrikeImpl(o,new THREE.Vector3(),true,1,'cleanup');assert.equal(o.origin.cleanupNoScore,true);context.chipByStrikeImpl(o,new THREE.Vector3(),true,1,'environment');assert.equal(o.origin.cleanupNoScore,true);context.chipByStrikeImpl(o,new THREE.Vector3(),true,1,'player');assert.equal(o.origin.cleanupNoScore,false);
let captures=0,bodyChanges=0,aimed=0;const body={translation:()=>({x:0,y:.4,z:2}),setBodyType(){bodyChanges++;}};
Object.assign(context,{bonusTestOpen:false,started:true,paused:false,drag:null,state:'HELD',firstLaunchPending:true,ball:body,secondary:{echoes:[]},innerWidth:390,innerHeight:844,MID:0,worldPoint:()=>new THREE.Vector3(2,.4,3),projectedBall:()=>new THREE.Vector3(0,0,0),audio:{unlock(){},play(){}},lowerTarget:p=>p,canvas:{setPointerCapture(){captures++;}},RAPIER:{RigidBodyType:{Dynamic:0}},holdBall(){aimed++;context.drag.mode='aim';},C:{lossZ:7}});
vm.runInContext(code('pointerDown'),context);
const event={pointerId:1,button:0,clientX:10,clientY:700,preventDefault(){}};
context.pointerDown(event);assert.equal(context.drag,null);assert.equal(bodyChanges,0);assert.equal(captures,0);
context.pointerDown({...event,clientX:195,clientY:422});assert.equal(aimed,1);assert.equal(captures,1);context.drag=null;
context.firstLaunchPending=false;context.pointerDown(event);assert.equal(context.drag.mode,'attract');assert.equal(bodyChanges,1);
assert.match(code('generateSection'),/firstLaunchPending=true;cancelDrag/);assert.match(code('beginTravel'),/firstLaunchPending=true;cancelDrag/);assert.match(code('pointerUp'),/firstLaunchPending=false;tutorialEvent\('release'\)/);
assert.match(source,/!direct&&\(oa\?\.origin\?\.cleanupNoScore\|\|ob\?\.origin\?\.cleanupNoScore\)/);
const world=fs.readFileSync(new URL('../src/bonus-world.js',import.meta.url),'utf8');assert.match(world,/this.onBomb\(at,\{cleanupNoScore:item.cleanupNoScore\}\)/);
console.log('PASS cleanup no-score once-only drops, player scoring recovery, environmental provenance, and fixed-start prelaunch attraction lock');
