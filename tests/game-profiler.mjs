import assert from 'node:assert/strict';
import {GameProfiler,AsyncGpuTimer,PROFILER_BUCKETS,summarizeSamples} from '../src/game-profiler.js';

// A deliberately tiny DOM/canvas mock keeps these tests independent of browsers.
function node(tag='div'){
 return {tag,style:{},attrs:{},children:[],listeners:{},hidden:false,textContent:'',value:'',
  appendChild(child){this.children.push(child);return child;},setAttribute(k,v){this.attrs[k]=v;},
  addEventListener(k,fn){(this.listeners[k]??=[]).push(fn);},remove(){this.removed=true;},
  dispatch(k,event={}){for(const fn of this.listeners[k]||[])fn({stopPropagation(){},...event});},
  getContext(){return null;},focus(){this.focused=true;},select(){this.selected=true;},click(){this.dispatch('click');}
 };
}
const document=()=>({head:node('head'),body:node('body'),createElement:node});
const sample=(p,extra={})=>{p.beginFrame({active:true,dt:.016});p.add('rapier',2);p.add('contacts',1);p.add('simulation',3);p.add('prepare',2);p.add('submit',4);p.endFrame({active:true,frameMs:16,drawCalls:12,triangles:500,bodies:20,colliders:30,width:800,height:600,samples:4,metadata:{mode:'BALL_ACTIVE',arena:2,settings:{shadows:'low'},diagnostic:{particles:true}},...extra});};

// Opening/closing callback order, opt-in overhead, and mutually exclusive bucket contract.
let opened=0,closed=0,toggleReads=0;
const p=new GameProfiler({document:null,onOpen(){assert.equal(p.enabled,false);opened++;},onClose(){assert.equal(p.enabled,false);closed++;},getToggles(){toggleReads++;return [];}});
p.beginFrame({active:true,dt:1});p.add('rapier',100);p.endFrame({active:true,frameMs:16});
assert.equal(p.live.count,0);assert.equal(toggleReads,0);assert.equal(p.frame.rapier,0);
p.open();p.open();assert.equal(opened,1);assert.equal(p.enabled,true);assert.equal(p.visible,true);
p.beginFrame({active:true});p.add('rapier',2);p.add('rapier',3);p.add('contacts',1);p.add('rapier',-1);p.add('rapier',NaN);p.add('bogus',100);
assert.equal(p.frame.rapier,5);assert.equal(p.frame.contacts,1);assert.equal(Object.keys(p.frame).length,PROFILER_BUCKETS.length);
p.beginFrame({active:true});assert.ok(Object.values(p.frame).every(v=>v===0));
sample(p);assert.equal(p.live.count,1);assert.equal(p.latest.gpuMs,null);
sample(p,{active:false});sample(p,{frameMs:NaN});sample(p,{frameMs:0});assert.equal(p.live.count,1);
assert.equal(p.startRecording('comparison'),false);assert.equal(p.startRecording('anything'),false);
assert.equal(p.startRecording(),true);assert.equal(p.startRecording(),false);
for(let i=0;i<20;i++)sample(p,{active:false,frameMs:1000});assert.equal(p.recording.settle,0);assert.equal(p.recording.elapsed,0);
for(let i=0;i<125;i++)sample(p);assert.equal(p.recording.settle,2000);assert.equal(p.recording.elapsed,0);
for(let i=0;i<499;i++)sample(p,{gpuMs:3.5,gpuStatus:'available'});assert.ok(p.recording);sample(p,{gpuMs:3.5,gpuStatus:'available'});
assert.equal(p.recording,null);assert.equal(p.baseline.summary.count,500);assert.equal(p.baseline.totalFrames,500);assert.equal(p.baseline.summary.fps,62.5);
assert.equal(p.baseline.summary.metrics.gpuMs.median,3.5);assert.equal(p.baseline.summary.states.BALL_ACTIVE,500);
assert.equal(p.baseline.startContext.settings.shadows,'low');assert.equal(p.baseline.endContext.diagnostic.particles,true);
assert.equal(p.baseline.elapsed,8000);assert.equal(p.baseline.summary.metrics.rapier.median,2);
assert.equal(p.startRecording('comparison'),true);for(let i=0;i<625;i++)sample(p,{gpuMs:2});
assert.equal(p.comparison.summary.count,500);assert.match(p.report(),/Comparison − baseline/);assert.match(p.report(),/workload is not guaranteed equal/);assert.match(p.report(),/asynchronous/);assert.match(p.report(),/Menu \/ paused frames excluded/);assert.match(p.report(),/2s settling/);
assert.ok(p.live.values().length<=720);assert.equal(p.live.values().at(-1),p.latest);
p.startRecording();sample(p);p.close();p.close();assert.equal(closed,1);assert.equal(p.recording,null);assert.ok(p.baseline);assert.equal(p.visible,false);assert.equal(p.startRecording(),false);
p.open();p.startRecording();for(let i=0;i<10000;i++)sample(p,{frameMs:1});assert.equal(p.baseline.totalFrames,8000);assert.equal(p.baseline.summary.count,4096);assert.equal(p.comparison,null);p.dispose();assert.equal(p.baseline,null);assert.equal(p.enabled,false);

// Percentiles/median/FPS are statistically defined, including missing GPU data.
const stats=summarizeSamples([{frameMs:10,rapier:0,gpuMs:null},{frameMs:20,rapier:2,gpuMs:3},{frameMs:30,rapier:4,gpuMs:9},{frameMs:40,rapier:6,gpuMs:undefined}]);
assert.equal(stats.metrics.frameMs.median,25);assert.equal(stats.metrics.frameMs.p95,40);assert.equal(stats.fps,40);assert.equal(stats.metrics.rapier.median,3);assert.equal(stats.metrics.gpuMs.median,6);assert.equal(stats.metrics.gpuMs.count,2);
assert.equal(summarizeSamples([{frameMs:10},{frameMs:20},{frameMs:30}]).metrics.frameMs.median,20);
assert.equal(summarizeSamples([]).fps,null);assert.equal(summarizeSamples([]).metrics.frameMs.median,null);

// UI stays hidden until requested, has no blur, throttles 4 Hz and defers switch ownership.
let time=0,enabled=true,toggleArgs=null;
const ui=new GameProfiler({document:document(),now:()=>time,getToggles:()=>[{id:'particles',label:'Particles',value:enabled}],onToggle:(id,value)=>{toggleArgs=[id,value];enabled=value;}});
assert.equal(ui.element.hidden,true);assert.match(ui.style.textContent,/backdrop-filter:none!important/);assert.match(ui.style.textContent,/header\{position:static;inset:auto;pointer-events:auto/);assert.match(ui.style.textContent,/\*\{box-sizing:border-box;backdrop-filter:none!important/);ui.open();assert.equal(ui.element.hidden,false);
const label=ui.toggleNodes.get('particles');assert.equal(label.input.checked,true);label.input.checked=false;label.input.dispatch('change');assert.deepEqual(toggleArgs,['particles',false]);assert.equal(label.input.checked,false);
const old=ui.metricsNode.textContent;time=249;sample(ui);assert.equal(ui.metricsNode.textContent,old);time=250;sample(ui);assert.notEqual(ui.metricsNode.textContent,old);assert.match(ui.statusNode.textContent,/800×600/);
ui.startRecording();assert.equal(label.input.disabled,true);assert.equal(ui.baselineButton.disabled,true);assert.match(ui.noteNode.textContent,/Settling/);
ui.close();assert.equal(ui.element.hidden,true);ui.dispose();assert.equal(ui.element.removed,true);assert.equal(ui.style.removed,true);

function gpuMock({supported=true}={}){
 let id=0;const queries=[],deleted=[],calls=[];
 const gl={QUERY_RESULT_AVAILABLE:1,QUERY_RESULT:2,CURRENT_QUERY:3,disjoint:false,lost:false,active:null,
  getExtension(name){assert.equal(name,'EXT_disjoint_timer_query_webgl2');return supported?{TIME_ELAPSED_EXT:4,GPU_DISJOINT_EXT:5}:null;},
  getParameter(flag){assert.equal(flag,5);return this.disjoint;},isContextLost(){return this.lost;},
  createQuery(){const q={id:++id,ready:false,ns:4e6};queries.push(q);return q;},
  getQuery(target,param){assert.equal(target,4);assert.equal(param,3);return this.active;},
  beginQuery(target,q){assert.equal(target,4);assert.equal(this.active,null);this.active=q;calls.push('begin');},
  endQuery(target){assert.equal(target,4);assert.ok(this.active);this.active=null;calls.push('end');},
  getQueryParameter(q,param){if(param===1){calls.push('available');return q.ready;}assert.equal(q.ready,true,'Never read a GPU result before availability');calls.push('result');return q.ns;},
  deleteQuery(q){assert.ok(!deleted.includes(q),'Delete each query only once');deleted.push(q);},
  finish(){assert.fail('GPU timer must not stall with finish');},flush(){assert.fail('GPU timer must not flush');}
 };
 return {gl,queries,deleted,calls};
}
let g=gpuMock();let timer=new AsyncGpuTimer({getContext:()=>g.gl},{maxPending:2});assert.equal(timer.status,'ready');
assert.equal(timer.begin(),true);assert.equal(timer.begin(),false);assert.equal(timer.end(),true);assert.equal(timer.end(),false);
assert.deepEqual(timer.poll(),{ms:null,status:'pending'});assert.ok(!g.calls.includes('result'));
g.queries[0].ready=true;assert.deepEqual(timer.poll(),{ms:4,status:'available'});assert.equal(g.deleted.length,1);assert.equal(timer.poll().ms,null);
assert.equal(timer.begin(),true);timer.end();assert.equal(timer.begin(),true);timer.end();assert.equal(timer.begin(),false);assert.equal(timer.pending.length,2);
g.gl.disjoint=true;assert.match(timer.poll().status,/disjoint/);assert.equal(timer.pending.length,0);assert.equal(g.deleted.length,3);assert.equal(timer.begin(),false);
g.gl.disjoint=false;assert.equal(timer.begin(),true);g.gl.disjoint=true;timer.poll();assert.equal(timer.current,null);assert.equal(g.gl.active,null);assert.equal(g.deleted.length,4);
g.gl.disjoint=false;g.gl.active={external:true};assert.equal(timer.begin(),false);assert.match(timer.status,/busy/);g.gl.active=null;
assert.equal(timer.begin(),true);timer.end();assert.equal(timer.begin(),true);timer.dispose();assert.equal(timer.pending.length,0);assert.equal(timer.current,null);assert.equal(g.deleted.length,6);assert.equal(timer.begin(),false);assert.equal(timer.poll().ms,null);timer.dispose();
g=gpuMock({supported:false});timer=new AsyncGpuTimer(g.gl);assert.equal(timer.begin(),false);assert.match(timer.poll().status,/unavailable/);assert.equal(g.queries.length,0);timer.dispose();
g=gpuMock();timer=new AsyncGpuTimer(g.gl);timer.begin();timer.end();g.gl.lost=true;assert.match(timer.poll().status,/context lost/);assert.equal(g.deleted.length,1);assert.equal(timer.pending.length,0);
g=gpuMock();timer=new AsyncGpuTimer(g.gl);g.gl.beginQuery=()=>{throw Error('driver');};assert.equal(timer.begin(),false);assert.equal(g.deleted.length,1);assert.match(timer.status,/timer error/);
g=gpuMock();timer=new AsyncGpuTimer(g.gl);timer.begin();timer.end();g.queries[0].ready=true;g.queries[0].ns=NaN;assert.equal(timer.poll().ms,null);assert.equal(g.deleted.length,1);
console.log('Profiler: opt-in CPU buckets, active-only settling/recording, bounded statistics, compact UI, and nonblocking GPU query lifecycle passed.');
