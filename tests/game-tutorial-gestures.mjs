import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {GameTutorial,TUTORIAL_BONUSES,TUTORIAL_STEPS,TUTORIAL_STORAGE_KEY} from '../src/game-tutorial.js';

const node=()=>({style:{setProperty(k,v){this[k]=v;}},children:[],attrs:{},hidden:false,
 appendChild(child){this.children.push(child);},setAttribute(k,v){this.attrs[k]=v;},remove(){this.removed=true;}});
const make=(storage=null)=>new GameTutorial({document:{head:node(),body:node(),createElement:node},storage,project:p=>p});
const base={started:true,state:'HELD',mainUpper:false,mainPoint:{x:200,y:280},lowerPoint:{x:200,y:470},viewport:{width:400,height:700}};
const attracting={...base,state:'BALL_ACTIVE',mainUpper:true,drag:{mode:'attract',age:.25,steerDistance:32}};
const legacySteps=['catch','aim','release','attract','pickup','gate','extraCatch','extraRelease'];
const memory=raw=>{let value=raw;return {getItem:key=>key===TUTORIAL_STORAGE_KEY?value:null,setItem(key,next){assert.equal(key,TUTORIAL_STORAGE_KEY);value=next;},read:()=>JSON.parse(value)};};

test('launch guidance has a visible press, pull-back, hand-lift and launch loop',()=>{
 const tutorial=make();tutorial.update(base);
 assert.equal(tutorial.element.attrs['data-gesture'],'pull-release');
 assert.equal(tutorial.pointer.attrs['aria-hidden'],'true');
 assert.equal(tutorial.pointer.style['--cc-tutorial-pull'],'44px');
 assert.match(tutorial.detail.textContent,/Pull back.*lift your finger/);
 for(const layer of ['hand-motion','contact','pull-trail','release-ball','release-burst'])assert.match(tutorial.pointer.innerHTML,new RegExp(`cc-tutorial-${layer}`));
 assert.match(tutorial.style.textContent,/@keyframes cc-tutorial-pull-release\{[^\n]*44%,67%\{transform:translateY\(var\(--cc-tutorial-pull\)\)/);
 assert.match(tutorial.style.textContent,/@keyframes cc-tutorial-pull-release\{[^\n]*rotate\(-12deg\);opacity:0/);
 for(let i=0;i<100;i++)tutorial.update({...base,dt:.1});
 assert.equal(tutorial.done.size,0,'illustrative animations never complete a gameplay step');
});

test('initial aim and release cues teach normal launch before charge unlock',()=>{
 const tutorial=make();tutorial.update({...base,state:'AIMING',drag:{mode:'aim'}});
 assert.equal(tutorial.displayStep,'aim');assert.equal(tutorial.detail.textContent,'Pull back, then release');
 assert.equal(tutorial.notify('aim'),true);tutorial.update({...base,state:'AIMING',drag:{mode:'aim'}});
 assert.equal(tutorial.displayStep,'release');assert.equal(tutorial.label.textContent,'Release to launch');
 assert.equal(tutorial.element.attrs['data-gesture'],'pull-release');
 assert.equal(tutorial.done.has('release'),false);
});

test('the first attraction lesson keeps the hand stationary with a pulsing HOLD cue',()=>{
 const tutorial=make();tutorial.update(attracting);
 assert.equal(tutorial.displayStep,'attract');assert.equal(tutorial.element.attrs['data-gesture'],'hold');
 assert.match(tutorial.label.textContent,/HOLD.*lower zone/);assert.match(tutorial.detail.textContent,/Keep your finger down/);
 assert.match(tutorial.pointer.innerHTML,/>HOLD<\/span>/);
 assert.match(tutorial.style.textContent,/\[data-gesture=hold\],\[data-gesture=hold-move\]\) \.cc-tutorial-hand-motion\{animation:none;transform:none\}/);
 assert.match(tutorial.style.textContent,/@keyframes cc-tutorial-hold-ring\{.*scale\(1\.8\);opacity:0/);
 for(let i=0;i<100;i++)tutorial.update({...attracting,dt:.1});
 assert.equal(tutorial.done.has('attract'),false);assert.equal(tutorial.done.has('attractMove'),false);
});

test('HOLD & MOVE follows the hold lesson, retains contact and requires actual qualified movement',()=>{
 const tutorial=make();tutorial.update(attracting);
 assert.equal(tutorial.notify('attractMove'),false,'the initial hold lesson comes first');
 assert.equal(tutorial.notify('attract'),true);tutorial.update({...attracting,drag:null});
 assert.equal(tutorial.displayStep,'attractMove');assert.equal(tutorial.element.attrs['data-gesture'],'hold-move');
 assert.equal(tutorial.label.textContent,'HOLD & MOVE to steer');assert.match(tutorial.detail.textContent,/held finger.*lower zone/);
 assert.match(tutorial.pointer.innerHTML,/<g class="cc-tutorial-steer-motion"><circle class="cc-tutorial-hold-ring"/);
 assert.match(tutorial.style.textContent,/\[data-gesture=hold-move\] \.cc-tutorial-steer-motion\{animation:cc-tutorial-steer/);
 const steer=tutorial.style.textContent.match(/@keyframes cc-tutorial-steer\{[^\n]+/)[0];
 assert.match(steer,/translate\(-26px,4px\)/);assert.match(steer,/translate\(26px,4px\)/);assert.doesNotMatch(steer,/opacity/,'steering never shows a lifted/faded hand');
 for(const change of [{mainUpper:false},{state:'AIMING'},{drag:null},{drag:{mode:'aim',age:1,steerDistance:100}},{drag:{mode:'attract',age:.24,steerDistance:100}},{drag:{mode:'attract',age:1,steerDistance:31}},{drag:{mode:'attract',age:1,steerDistance:100,echo:{}}},{paused:true},{menu:true},{test:true}]){
  assert.equal(tutorial.notify('attractMove',{...attracting,...change}),false,JSON.stringify(change));
 }
 assert.equal(tutorial.done.has('attractMove'),false);assert.equal(tutorial.notify('attractMove',attracting),true);assert.equal(tutorial.notify('attractMove',attracting),false);
});

test('inserting the movement lesson preserves every old numeric and named completion',()=>{
 assert.equal(TUTORIAL_STEPS.indexOf('attractMove'),TUTORIAL_STEPS.indexOf('attract')+1);
 for(let count=0;count<=legacySteps.length;count++){
  const tutorial=make(memory(JSON.stringify(count)));
  assert.deepEqual([...tutorial.done],legacySteps.slice(0,count));assert.equal(tutorial.done.has('attractMove'),false);
 }
 const storage=memory(JSON.stringify({done:legacySteps,bonuses:Object.keys(TUTORIAL_BONUSES)})),tutorial=make(storage);
 assert.equal(tutorial.step,'attractMove');assert.equal(tutorial.completed,false);assert.equal(tutorial.seenBonuses.size,9);
 tutorial.update(attracting);assert.equal(tutorial.displayStep,'attractMove');assert.equal(tutorial.notify('attractMove'),true);
 assert.equal(tutorial.completed,false);assert.equal(tutorial.notify('charged',{chargedSuccess:true}),true);assert.equal(tutorial.completed,true);assert.equal(make(storage).completed,true);assert.equal(storage.read().done.length,10);
 tutorial.replay();assert.equal(tutorial.done.size,0);assert.equal(tutorial.seenBonuses.size,0);assert.deepEqual(storage.read(),{done:[],bonuses:[]});
});

test('extra-ball and bonus eligibility is preserved and unrelated cues do not inherit the gesture detail',()=>{
 const tutorial=make();
 const extras={...base,state:'BALL_ACTIVE',mainPoint:null,lowerZoneZ:0,lossZ:10,extraPoints:[
  {id:1,point:{x:160,y:300,z:5},isHeld:false,staged:true},
  {id:2,point:{x:180,y:300,z:5},isHeld:false,parked:true},
  {id:3,point:{x:200,y:300,z:-1},isHeld:false},
  {id:4,point:{x:220,y:300,z:5},isHeld:false,catchable:false},
  {id:5,point:{x:240,y:300,z:5},isHeld:false}
 ]};
 tutorial.update(extras);assert.equal(tutorial.displayStep,'extraCatch');assert.equal(tutorial.pointer.style.left,'224px');assert.equal(tutorial.element.attrs['data-gesture'],'pull-release');
 tutorial.update({...extras,drag:{mode:'aim',echo:{b:{handle:5}}},extraPoints:[{id:5,isHeld:true,point:{x:240,y:300,z:5}}]});
 assert.equal(tutorial.displayStep,'extraRelease');assert.equal(tutorial.detail.textContent,'Lift your finger to launch');assert.match(tutorial.label.textContent,/No attraction/);
 tutorial.update({...extras,extraPoints:[],bonusTargets:[{kind:'pulse',point:{x:210,y:300}}],dt:.1});
 assert.equal(tutorial.displayStep,'bonus-pulse');assert.equal(tutorial.element.attrs['data-gesture'],'point');assert.equal(tutorial.detail.hidden,true);assert.equal(tutorial.seenBonuses.size,0);
 for(let i=0;i<31;i++)tutorial.update({...extras,extraPoints:[],bonusTargets:[{kind:'pulse',point:{x:210,y:300}}],dt:.1});
 assert.equal(tutorial.seenBonuses.has('pulse'),true);
});

test('animated overlays remain input-through, reduced-motion aware and within the lower viewport',()=>{
 const tutorial=make();tutorial.update({...base,mainPoint:{x:200,y:620}});
 assert.equal(tutorial.pointer.style['--cc-tutorial-pull'],'12px');assert.equal(tutorial.pointer.style['--cc-tutorial-pull-scale'],String(12/44));assert.ok(parseFloat(tutorial.callout.style.top)<620);
 assert.match(tutorial.style.textContent,/\.cc-tutorial\{[^}]*pointer-events:none!important/);
 assert.match(tutorial.style.textContent,/\.cc-tutorial \*\{pointer-events:none!important/);
 assert.match(tutorial.style.textContent,/@media\(prefers-reduced-motion:reduce\)\{\.cc-tutorial \*\{animation:none!important\}/);
 const source=readFileSync(new URL('../src/game-tutorial.js',import.meta.url),'utf8');
 assert.doesNotMatch(source,/addEventListener|setTimeout|setInterval/);
 tutorial.update({...attracting,paused:true});assert.equal(tutorial.visible,false);
});

test('charge unlock requires launch and stationary HOLD; replay relocks without needing HOLD MOVE',()=>{const t=make();assert.equal(t.chargeUnlocked,false);t.done.add('release');assert.equal(t.chargeUnlocked,false);t.done.add('attract');assert.equal(t.chargeUnlocked,true);assert.equal(t.done.has('attractMove'),false);t.replay();assert.equal(t.chargeUnlocked,false);});

test('charged lesson follows basics and progresses full pull / hold / release only on a successful timed shot',()=>{const t=make();t.done.add('release');t.done.add('attract');const context={...base,state:'AIMING',drag:{mode:'aim'},charge:{fullPull:false}};t.update(context);assert.equal(t.displayStep,'charged');assert.equal(t.label.textContent,'PULL FULL');assert.equal(t.notify('charged'),false);t.update({...context,charge:{fullPull:true,state:'charging'}});assert.match(t.label.textContent,/HOLD/);t.update({...context,charge:{fullPull:true,state:'window',window:true}});assert.equal(t.label.textContent,'RELEASE IN ×2 SECTOR');assert.equal(t.notify('charged',{chargedSuccess:true}),true);t.replay();assert.equal(t.chargeUnlocked,false);});
