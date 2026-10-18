import assert from 'node:assert/strict';
import {GameTutorial,TUTORIAL_STORAGE_KEY,projectTutorialPoint,TUTORIAL_STEPS} from '../src/game-tutorial.js';
const node=()=>({style:{},children:[],hidden:false,attrs:{},appendChild(n){this.children.push(n);},setAttribute(k,v){this.attrs[k]=v;},remove(){this.removed=true;}});
const doc={head:node(),body:node(),createElement:node};
const data=new Map(),storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
const t=new GameTutorial({document:doc,storage,project:p=>p?{x:p.x,y:p.y}:null});
const base={started:true,state:'HELD',mainUpper:false,mainPoint:{x:200,y:250},lowerPoint:{x:200,y:320},viewport:{width:400,height:700},gateReady:false,gateOpen:false};
t.update(base);assert.equal(t.visible,true);assert.equal(t.step,'catch');assert.equal(t.notify('unrelated'),false);assert.equal(t.notify('catch'),true);
t.update({...base,drag:{mode:'aim'},state:'AIMING'});assert.equal(t.step,'aim');assert.equal(t.visible,true);assert.equal(t.notify('aim'),true);assert.equal(t.notify('release'),true);
t.update({...base,state:'BALL_ACTIVE'});assert.equal(t.visible,false);assert.equal(t.notify('attract'),false);
t.update({...base,state:'BALL_ACTIVE',mainUpper:true});assert.equal(t.visible,true);assert.equal(t.notify('attract'),true);assert.equal(t.notify('attractMove',{drag:{mode:'attract',age:.25,steerDistance:32}}),true);
assert.equal(t.notify('charged',{chargedSuccess:true}),true);t.update({...base,state:'BALL_ACTIVE'});assert.equal(t.step,'pickup');assert.equal(t.visible,false);
t.update({...base,eligiblePickupPoint:{x:240,y:300}});assert.equal(t.visible,true);assert.equal(t.notify('pickup'),true);
t.update({...base,gatePoint:{x:200,y:200}});assert.equal(t.visible,false);assert.equal(t.notify('gate'),false);
t.update({...base,gatePoint:{x:200,y:200},gateReady:true,gateOpen:true});assert.equal(t.visible,true);assert.equal(t.notify('gate'),true);assert.equal(t.completed,false);assert.equal(t.notify('extraCatch'),true);assert.equal(t.notify('extraRelease'),true);assert.equal(t.controlsCompleted,true);assert.equal(t.completed,false);assert.equal(JSON.parse(data.get(TUTORIAL_STORAGE_KEY)).done.length,TUTORIAL_STEPS.length);
const saved=new GameTutorial({document:doc,storage});assert.equal(saved.controlsCompleted,true);assert.equal(saved.completed,false);saved.replay();assert.equal(saved.step,'catch');assert.deepEqual(JSON.parse(data.get(TUTORIAL_STORAGE_KEY)).done,[]);
for(const c of [{paused:true},{menu:true},{test:true},{started:false},{state:'TRANSITION'},{state:'REPOSITION'},{drag:{echo:{}}}]){saved.update({...base,...c});assert.equal(saved.visible,false);}
for(const c of [{paused:true},{menu:true},{test:true},{started:false},{state:'TRANSITION'},{drag:{echo:{}}}]){saved.update({...base,...c});assert.equal(saved.notify('catch'),false);}
const noStorage=new GameTutorial({document:doc,storage:{getItem(){throw Error();},setItem(){throw Error();}},project:p=>p});noStorage.update(base);assert.equal(noStorage.notify('catch'),true);noStorage.replay();assert.equal(noStorage.step,'catch');
const I=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],camera={matrixWorldInverse:{elements:I},projectionMatrix:{elements:I}};
assert.deepEqual(projectTutorialPoint({x:0,y:0,z:0},camera,{width:400,height:600,left:10,top:20}),{x:210,y:320});
assert.equal(projectTutorialPoint({x:0,y:0,z:0},camera,{width:400,height:600},2),null);
assert.equal(projectTutorialPoint({x:2,y:0,z:0},camera,{width:400,height:600}),null);
assert.equal(projectTutorialPoint({x:0,y:0,z:0},null,{width:400,height:600}),null);
t.replay();t.update({...base,mainPoint:{x:200,y:20}});assert.equal(t.visible,false);t.update({...base,mainPoint:{x:200,y:680}});assert.equal(t.visible,false);
t.destroy();assert.equal(t.element.removed,true);console.log('game-tutorial: event progression, guards, persistence, replay, projection and visibility passed');

const contextual=new GameTutorial({document:doc,storage:null,project:p=>p});contextual.update({...base,gatePoint:{x:200,y:200},gateReady:true,gateOpen:true});assert.equal(contextual.displayStep,'gate');assert.equal(contextual.notify('gate'),true);assert.equal(contextual.step,'catch');contextual.update(base);assert.equal(contextual.notify('pickup'),true);assert.equal(contextual.step,'catch');assert.equal(contextual.done.has('pickup'),true);
contextual.done=new Set(['catch','aim','release','attract']);contextual.index=4;contextual.update({...base,corePoint:{x:200,y:300}});assert.equal(contextual.label.textContent,'Break glowing glass');assert.equal(contextual.visible,true);

const powers=new GameTutorial({document:doc,storage:null,project:p=>p});
const quiet={...base,state:'BALL_ACTIVE',mainUpper:false,mainPoint:null,bonusTargets:[{id:1,kind:'bomb',point:{x:210,y:300},phase:'dropped'}],dt:.1};
powers.update({...quiet,paused:true});assert.equal(powers.bonusQueue.length,0);
powers.update({...quiet,mainPoint:base.mainPoint});assert.equal(powers.displayStep,'catch');assert.equal(powers.bonusQueue[0],'bomb');assert.equal(powers.seenBonuses.size,0);
powers.update(quiet);assert.equal(powers.displayStep,'bonus-bomb');assert.match(powers.label.textContent,/3s after landing/);
powers.update({...quiet,bonusTargets:[]});assert.equal(powers.visible,false);assert.equal(powers.seenBonuses.size,0);
for(let i=0;i<31;i++)powers.update(quiet);assert.equal(powers.seenBonuses.has('bomb'),true);
powers.update(quiet);assert.equal(powers.visible,false);powers.replay();assert.equal(powers.seenBonuses.size,0);
powers.update({...base,drag:{mode:'aim',echo:{}},extraPoints:[{id:2,isHeld:true,point:{x:200,y:300}}]});assert.equal(powers.displayStep,'extraRelease');assert.equal(powers.notify('release'),false);assert.equal(powers.notify('extraRelease'),true);
console.log('game-tutorial: queued power explanations, stale target rejection and extra-ball instructions passed');

const gateCue=new GameTutorial({document:doc,storage:null,project:p=>p});gateCue.update({...base,gateReady:true,gateOpen:false,gatePoint:{x:200,y:20}});assert.equal(gateCue.displayStep,'gateBreak');assert.equal(gateCue.visible,true);assert.equal(gateCue.notify('gate'),false);assert.equal(gateCue.pointer.style.top,'104px');

const all=new GameTutorial({document:doc,storage,project:p=>p});all.replay();all.update(base);for(const action of ['catch','aim','release','pickup','extraCatch','extraRelease'])assert.equal(all.notify(action),true);assert.equal(all.notify('attract',{mainUpper:true}),true);assert.equal(all.notify('attractMove',{state:'BALL_ACTIVE',mainUpper:true,drag:{mode:'attract',age:.25,steerDistance:32}}),true);assert.equal(all.notify('gate',{gateReady:true,gateOpen:true}),true);
for(const kind of ['pulse','pierce','arc','frost','split','gravity','heavy','blackhole','bomb']){
 const context={...base,dt:.1,bonusTargets:[{kind,point:{x:200,y:300}}]};
 for(let i=0;i<15;i++)all.update(context);
 for(let i=0;i<40;i++)all.update({...context,paused:true});
 assert.equal(all.seenBonuses.has(kind),false);
 for(let i=0;i<16;i++)all.update(context);
 assert.equal(all.seenBonuses.has(kind),true);
}
assert.equal(all.notify('charged',{chargedSuccess:true}),true);assert.equal(all.completed,true);const persistedAll=new GameTutorial({document:doc,storage});assert.equal(persistedAll.completed,true);persistedAll.replay();assert.equal(persistedAll.completed,false);assert.equal(persistedAll.seenBonuses.size,0);
console.log('game-tutorial: all nine powers persist only after visible exposure; paused time never counts');
const priority=new GameTutorial({document:doc,storage:null,project:p=>p});priority.done=new Set(['catch','aim','release','attract']);priority.index=4;
const pulseCore={...base,corePoint:{x:210,y:320},bonusTargets:[{kind:'pulse',phase:'contained',point:{x:210,y:320}}],dt:.1};priority.update(pulseCore);assert.equal(priority.displayStep,'bonus-pulse');for(let i=0;i<31;i++)priority.update(pulseCore);assert.equal(priority.displayStep,'pickup');assert.equal(priority.label.textContent,'Break glowing glass');console.log('game-tutorial: first power explanation outranks generic live-core pickup cue');

const cancelled=new GameTutorial({document:doc,storage:null,project:p=>p});cancelled.update(base);cancelled.notify('catch');cancelled.notify('aim');cancelled.update({...base,drag:null});assert.equal(cancelled.displayStep,'catch');assert.match(cancelled.label.textContent,/finish launching/);assert.equal(cancelled.done.has('aim'),true);cancelled.notify('release');cancelled.notify('extraCatch');cancelled.update({...base,extraPoints:[{id:3,point:{x:260,y:320},isHeld:false}]});assert.equal(cancelled.displayStep,'extraCatch');assert.match(cancelled.label.textContent,/relaunch/);assert.equal(cancelled.done.has('extraCatch'),true);assert.equal(cancelled.done.has('extraRelease'),false);console.log('game-tutorial: cancelled main and extra launch gestures retain progress and offer regrab cues');

const precise=new GameTutorial({document:doc,storage:null,project:p=>p});
const extraContext={...base,state:'REPOSITION',drag:{mode:'aim',echo:{b:{handle:22}}},extraPoints:[{id:11,isHeld:true,point:{x:150,y:300}},{id:22,isHeld:true,point:{x:280,y:300}}]};precise.update(extraContext);assert.equal(precise.visible,true);assert.equal(precise.displayStep,'extraRelease');assert.equal(precise.pointer.style.left,'264px');assert.equal(precise.notify('extraCatch'),true);assert.equal(precise.notify('extraRelease'),true);assert.equal(precise.notify('pickup'),false);precise.replay();precise.update({...extraContext,state:'TRANSITION'});assert.equal(precise.visible,false);assert.equal(precise.notify('extraCatch'),false);precise.update({...extraContext,drag:{mode:'aim',echo:{b:{handle:99}}}});assert.equal(precise.visible,false);precise.update({...extraContext,activeExtraId:11});assert.equal(precise.pointer.style.left,'134px');console.log('game-tutorial: active extra target is exact; valid reposition extra gestures accepted; transition stays hidden');
