export const PROFILER_BUCKETS=Object.freeze(['rapier','contacts','simulation','prepare','submit']);
const LIVE_LIMIT=720,RECORD_LIMIT=4096,RECORD_MS=8000,SETTLE_MS=2000;
const numeric=n=>Number.isFinite(n)&&n>=0?n:0;
const pct=(sorted,p)=>sorted.length?sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)]:null;
const fmt=(n,d=1)=>Number.isFinite(n)?n.toFixed(d):'—';
const bucketNames={rapier:'Rapier step',contacts:'Contacts / fracture',simulation:'Other simulation',prepare:'Render prep',submit:'CPU render submit'};
const fields=['frameMs',...PROFILER_BUCKETS,'gpuMs','drawCalls','triangles','bodies','colliders','width','height','samples'];
class Ring{
 constructor(limit){this.limit=limit;this.data=[];this.cursor=0;this.count=0;}
 push(value){this.data[this.cursor]=value;this.cursor=(this.cursor+1)%this.limit;this.count++;}
 values(){return this.data.length<this.limit?this.data.slice():this.data.slice(this.cursor).concat(this.data.slice(0,this.cursor));}
}
export function summarizeSamples(samples){
 const result={count:samples.length,fps:null,metrics:{},states:{}};
 for(const key of fields){const values=samples.map(s=>s[key]).filter(n=>Number.isFinite(n)&&n>=0).sort((a,b)=>a-b);const mid=values.length/2;result.metrics[key]={count:values.length,median:values.length?(values[Math.floor(mid)]+values[Math.ceil(mid)-1])/2:null,p95:pct(values,.95),min:values[0]??null,max:values.at(-1)??null};}
 const total=samples.reduce((sum,s)=>sum+numeric(s.frameMs),0);result.fps=total>0?samples.length*1000/total:null;
 for(const sample of samples){const state=sample.state||'unspecified';result.states[state]=(result.states[state]||0)+1;}
 return result;
}
function contextCopy(metadata,depth=0){const out={};for(const [key,value] of Object.entries(metadata||{}).slice(0,16)){if(value===null||['number','boolean','string'].includes(typeof value))out[key.slice(0,60)]=typeof value==='string'?value.slice(0,120):value;else if(depth<1&&value&&typeof value==='object')out[key.slice(0,60)]=contextCopy(value,depth+1);}return out;}
function togglesCopy(getToggles){return (getToggles?.()||[]).slice(0,32).map(({id,label,value})=>({id:String(id),label:String(label),value:!!value}));}
export class GameProfiler{
 constructor({renderer,onOpen=()=>{},onClose=()=>{},onToggle=()=>{},getToggles=()=>[],document:doc=globalThis.document,now=()=>performance.now()}={}){
  this.renderer=renderer;this.onOpen=onOpen;this.onClose=onClose;this.onToggle=onToggle;this.getToggles=getToggles;this.doc=doc;this.now=now;this.enabled=false;this.visible=false;this.frame=Object.fromEntries(PROFILER_BUCKETS.map(k=>[k,0]));this.live=new Ring(LIVE_LIMIT);this.baseline=null;this.comparison=null;this.recording=null;this.latest=null;this.metadata={};this.gpuStatus='unavailable';this.lastPaint=-Infinity;this.message='Record a baseline, change one switch, then record a comparison.';this.toggleNodes=new Map();
  if(doc)this.buildUI();
 }
 open(){if(this.enabled)return;this.onOpen();this.enabled=this.visible=true;this.lastPaint=-Infinity;if(this.element)this.element.hidden=false;this.refresh(true);}
 close(){if(!this.enabled)return;this.enabled=this.visible=false;if(this.recording){this.recording=null;this.message='Incomplete recording discarded. Completed recordings are kept.';}if(this.element)this.element.hidden=true;this.onClose();}
 toggle(){this.enabled?this.close():this.open();}
 beginFrame({active=false,dt=0}={}){if(!this.enabled)return;this.active=!!active;this.dt=numeric(dt);for(const key of PROFILER_BUCKETS)this.frame[key]=0;}
 add(name,ms){if(this.enabled&&PROFILER_BUCKETS.includes(name)&&Number.isFinite(ms)&&ms>=0)this.frame[name]+=ms;}
 endFrame({frameMs,active=this.active,drawCalls,triangles,bodies,colliders,width,height,samples,gpuMs=null,gpuStatus,metadata}={}){
  if(!this.enabled)return;
  if(gpuStatus)this.gpuStatus=String(gpuStatus);
  this.metadata=contextCopy(metadata);this.active=!!active;
  if(active&&Number.isFinite(frameMs)&&frameMs>0){
   const sample={frameMs,...this.frame,gpuMs:Number.isFinite(gpuMs)&&gpuMs>=0?gpuMs:null,drawCalls,triangles,bodies,colliders,width,height,samples,state:String(this.metadata.state||this.metadata.mode||'unspecified')};
   this.latest=sample;this.live.push(sample);
   const r=this.recording;if(r&&r.settle<SETTLE_MS){r.settle+=frameMs;}else if(r){if(!r.frames.count)r.startContext={...this.metadata};r.frames.push(sample);r.elapsed+=frameMs;r.endContext={...this.metadata};if(r.elapsed>=RECORD_MS)this.finishRecording();}
  }
  this.refresh();
 }
 startRecording(kind='baseline'){
  if(!this.enabled||this.recording||!['baseline','comparison'].includes(kind)||(kind==='comparison'&&!this.baseline))return false;
  this.recording={kind,elapsed:0,settle:0,frames:new Ring(RECORD_LIMIT),toggles:togglesCopy(this.getToggles),startContext:{...this.metadata},endContext:{...this.metadata}};this.message=`Recording ${kind}: only active gameplay counts.`;this.refresh(true);return true;
 }
 finishRecording(){const r=this.recording;if(!r)return;const samples=r.frames.values();this[r.kind]={...r,frames:undefined,summary:summarizeSamples(samples),samples,totalFrames:r.frames.count,endToggles:togglesCopy(this.getToggles)};this.recording=null;this.message=`${r.kind==='baseline'?'Baseline':'Comparison'} saved (${samples.length} frames).`;if(r.kind==='baseline')this.comparison=null;}
 report(){
  const lines=['Crystal Crash · performance report','Menu / paused frames excluded. Times in milliseconds.','CPU buckets are exclusive. CPU render submit is not GPU render time.','GPU timing is asynchronous and overlaps CPU; do not add it to CPU buckets.',`GPU timer: ${this.gpuStatus}`,'A/B caveat: workload is not guaranteed equal. Repeat the same arena, actions, camera and duration; change one switch at a time.','FPS uses frame intervals, not only measured CPU work.'];
  for(const [name,run] of [['Baseline',this.baseline],['Comparison',this.comparison]]){if(!run)continue;const s=run.summary;lines.push('',`${name}: ${fmt(run.elapsed/1000,2)} active seconds after 2s settling, ${run.totalFrames} frames (${s.count} retained)`,`FPS: ${fmt(s.fps)}`,`States (retained frame counts): ${JSON.stringify(s.states)}`,`Start context: ${JSON.stringify(run.startContext)}`,`End context: ${JSON.stringify(run.endContext)}`,`Switches at start: ${run.toggles.map(t=>`${t.label}=${t.value?'ON':'OFF'}`).join(', ')||'none'}`,`Switches at end: ${run.endToggles.map(t=>`${t.label}=${t.value?'ON':'OFF'}`).join(', ')||'none'}`);for(const key of fields){const m=s.metrics[key];lines.push(`${bucketNames[key]||key}: median ${fmt(m.median)}, p95 ${fmt(m.p95)}, range ${fmt(m.min)}–${fmt(m.max)} (n=${m.count})`);}}
  if(this.baseline&&this.comparison){lines.push('','Comparison − baseline (lower time is better; workload may differ):');for(const key of ['frameMs',...PROFILER_BUCKETS,'gpuMs']){const a=this.baseline.summary.metrics[key],b=this.comparison.summary.metrics[key];const delta=Number.isFinite(a.median)&&Number.isFinite(b.median)?b.median-a.median:null;lines.push(`${bucketNames[key]||key}: median Δ ${fmt(delta)} ms${a.median>0&&delta!==null?` (${fmt(delta/a.median*100)}%)`:''}`);}}
  if(!this.baseline)lines.push('','No completed baseline recording yet.');return lines.join('\n');
 }
 buildUI(){
  const doc=this.doc,make=(tag,text,parent,cls)=>{const n=doc.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;if(parent)parent.appendChild(n);return n;};
  this.style=make('style');this.style.textContent=`.cc-profiler{position:fixed;z-index:95;right:max(8px,env(safe-area-inset-right));top:max(78px,env(safe-area-inset-top));width:min(300px,calc(100vw - 16px));max-height:60dvh;overflow:auto;overscroll-behavior:contain;padding:10px;border:1px solid #527580;border-radius:12px;background:#0a1520;color:#e3f4f8;box-shadow:0 4px 16px #0008;font:11px/1.35 ui-monospace,monospace;touch-action:pan-y;pointer-events:none;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}.cc-profiler[hidden]{display:none!important}.cc-profiler *{box-sizing:border-box;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}.cc-profiler header{position:static;inset:auto;pointer-events:auto;display:flex;align-items:center;justify-content:space-between;font-weight:700}.cc-profiler button,.cc-profiler summary{min-height:44px;cursor:pointer;color:#e4faff;background:#193341;border:1px solid #476776;border-radius:7px;padding:8px;font:inherit}.cc-profiler button:disabled{opacity:.45;cursor:default}.cc-profiler header button{min-width:44px;font-size:18px}.cc-profiler p{margin:4px 0}.cc-profiler canvas{display:block;width:100%;height:40px;pointer-events:none;margin:5px 0;background:#0e202d;border-radius:5px}.cc-profiler details{margin-top:5px;pointer-events:auto}.cc-profiler button,.cc-profiler input,.cc-profiler textarea,.cc-profiler summary{pointer-events:auto}@media(max-height:600px){.cc-profiler{top:8px;max-height:calc(100dvh - 16px)}}.cc-profiler summary{display:list-item;padding-left:12px}.cc-profiler label{display:flex;align-items:center;gap:7px;min-height:44px}.cc-profiler input{width:20px;height:20px;accent-color:#67d8b0}.cc-profiler-controls{display:flex;flex-wrap:wrap;gap:5px;margin:7px 0}.cc-profiler-note{color:#abc5cf;font-size:11px}.cc-profiler textarea{display:block;width:100%;min-height:160px;background:#08121b;color:#e3f4f8;font:11px/1.4 ui-monospace,monospace;border:1px solid #527580;resize:vertical}.cc-profiler-buckets{white-space:pre-wrap;font-variant-numeric:tabular-nums}`;
  (doc.head||doc.body).appendChild(this.style);this.element=make('section',null,doc.body,'cc-profiler');this.element.hidden=true;this.element.setAttribute('aria-label','Performance profiler');
  for(const type of ['pointerdown','pointerup','pointermove','click','dblclick','wheel','touchstart','touchmove','touchend'])this.element.addEventListener(type,e=>e.stopPropagation());
  const header=make('header',null,this.element);make('span','PERFORMANCE',header);const close=make('button','×',header);close.type='button';close.setAttribute('aria-label','Close profiler');close.addEventListener('click',()=>this.close());
  this.metricsNode=make('p','Waiting for active gameplay…',this.element);this.timeline=make('canvas',null,this.element);this.timeline.width=640;this.timeline.height=80;this.timeline.setAttribute('aria-label','Recent active gameplay FPS timeline');this.timeline.setAttribute('role','img');this.ctx=this.timeline.getContext?.('2d');this.bucketsNode=make('p',null,this.element,'cc-profiler-buckets');this.statusNode=make('p',null,this.element,'cc-profiler-note');
  const details=make('details',null,this.element);make('summary','Record & diagnostic switches',details);const controls=make('div',null,details,'cc-profiler-controls');
  const button=(text,fn)=>{const n=make('button',text,controls);n.type='button';n.addEventListener('click',fn);return n;};this.baselineButton=button('Baseline · 8s',()=>this.startRecording('baseline'));this.compareButton=button('Compare · 8s',()=>this.startRecording('comparison'));
  this.toggleContainer=make('div',null,details);this.noteNode=make('p',null,details,'cc-profiler-note');make('p','Active gameplay only. Menu / paused frames excluded. Match workload for A/B; change one switch at a time.',details,'cc-profiler-note');
  const reportDetails=make('details',null,details);make('summary','Readable report',reportDetails);this.reportNode=make('textarea',null,reportDetails);this.reportNode.readOnly=true;this.reportNode.setAttribute('aria-label','Performance report');const actions=make('div',null,reportDetails,'cc-profiler-controls');
  const copy=make('button','Copy report',actions);copy.type='button';copy.addEventListener('click',async()=>{try{if(!globalThis.navigator?.clipboard?.writeText)throw Error('Clipboard unavailable');await globalThis.navigator.clipboard.writeText(this.report());this.message='Report copied.';}catch{this.message='Select and copy the report text below.';this.refresh(true);this.reportNode.focus?.();this.reportNode.select?.();return;}this.refresh(true);});
  if(typeof Blob!=='undefined'&&typeof URL?.createObjectURL==='function'){const download=make('button','Download .txt',actions);download.type='button';download.addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([this.report()],{type:'text/plain'}));const link=make('a');link.href=url;link.download='crystal-crash-performance.txt';doc.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);});}
 }
 refresh(force=false){
  if(!this.enabled||!this.element)return;const now=this.now();if(!force&&now-this.lastPaint<250)return;this.lastPaint=now;const values=this.live.values(),s=summarizeSamples(values),m=s.metrics;
  this.metricsNode.textContent=`${this.active?'LIVE':'Excluded: menu / paused'} · ${fmt(s.fps)} FPS\nFrame median ${fmt(m.frameMs.median)} / p95 ${fmt(m.frameMs.p95)} ms${this.comparison?` · A/B ${fmt(this.baseline.summary.fps)}/${fmt(this.comparison.summary.fps)} FPS`:''}`;
  this.bucketsNode.textContent=PROFILER_BUCKETS.map(k=>`${bucketNames[k]} ${fmt(m[k].median)} / ${fmt(m[k].p95)}`).join('\n');
  const last=this.latest;this.statusNode.textContent=`CPU median / p95 ms · GPU async ${fmt(m.gpuMs.median)} ms (${this.gpuStatus})${last?`\n${last.drawCalls??'—'} draws · ${last.triangles??'—'} triangles · ${last.bodies??'—'} bodies / ${last.colliders??'—'} colliders\n${last.width??'—'}×${last.height??'—'} buffer · MSAA ${last.samples??'—'}`:''}`;
  const r=this.recording;this.noteNode.textContent=r?`${r.settle<SETTLE_MS?'Settling':'Recording'} ${r.kind}: ${fmt(r.settle<SETTLE_MS?Math.min(2,r.settle/1000):Math.min(8,r.elapsed/1000))}/${r.settle<SETTLE_MS?'2.0':'8.0'} active seconds${this.active?'':' · waiting for gameplay'}`:this.message;
  this.baselineButton.disabled=!!r;this.compareButton.disabled=!!r||!this.baseline;this.reportNode.value=this.report();
  const toggles=togglesCopy(this.getToggles),ids=new Set(toggles.map(t=>t.id));for(const [id,item] of this.toggleNodes)if(!ids.has(id)){item.row.remove();this.toggleNodes.delete(id);}
  for(const toggle of toggles){let item=this.toggleNodes.get(toggle.id);if(!item){const row=this.doc.createElement('label'),input=this.doc.createElement('input'),label=this.doc.createElement('span');input.type='checkbox';row.appendChild(input);row.appendChild(label);this.toggleContainer.appendChild(row);input.addEventListener('change',()=>{this.onToggle(toggle.id,!!input.checked);this.refresh(true);});item={row,input,label};this.toggleNodes.set(toggle.id,item);}item.input.checked=toggle.value;item.input.disabled=!!r;item.label.textContent=toggle.label;}
  this.drawTimeline(values);
 }
 drawTimeline(values){
  const c=this.ctx;if(!c)return;const w=this.timeline.width,h=this.timeline.height;c.clearRect(0,0,w,h);c.strokeStyle='#365364';c.beginPath();c.moveTo(0,h*.5);c.lineTo(w,h*.5);c.stroke();c.fillStyle='#abc5cf';c.font='18px monospace';c.fillText('FPS 60',8,h*.5-4);if(!values.length)return;
  const step=Math.max(1,Math.ceil(values.length/80)),points=[];for(let i=0;i<values.length;i+=step){const group=values.slice(i,i+step);points.push(1000/(group.reduce((n,v)=>n+v.frameMs,0)/group.length));}
  c.strokeStyle='#67d8b0';c.lineWidth=2;c.beginPath();points.forEach((fps,i)=>{const x=i*w/Math.max(1,points.length-1),y=h-Math.min(120,fps)/120*h;i?c.lineTo(x,y):c.moveTo(x,y);});c.stroke();
 }
 dispose(){this.close();this.element?.remove();this.style?.remove();this.toggleNodes.clear();this.live=new Ring(LIVE_LIMIT);this.baseline=this.comparison=null;}
}

export class AsyncGpuTimer{
 constructor(rendererOrGl,{maxPending=6}={}){
  this.gl=rendererOrGl?.getContext?.()||rendererOrGl;this.pending=[];this.current=null;this.maxPending=Math.max(1,Math.min(16,Math.floor(maxPending)||6));this.disposed=false;this.ext=null;
  try{if(this.gl?.createQuery)this.ext=this.gl.getExtension('EXT_disjoint_timer_query_webgl2');}catch{}
  this.status=this.ext?'ready':'unavailable (EXT_disjoint_timer_query_webgl2)';
 }
 available(){if(this.disposed||!this.ext)return false;if(this.gl.isContextLost?.()){this.clear();this.status='unavailable (context lost)';return false;}return true;}
 clear(){if(this.current){try{this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);}catch{}this.pending.push(this.current);this.current=null;}for(const q of this.pending){try{this.gl.deleteQuery(q);}catch{}}this.pending.length=0;}
 disjoint(){if(this.gl.getParameter(this.ext.GPU_DISJOINT_EXT)){this.clear();this.status='disjoint (samples discarded)';return true;}return false;}
 begin(){
  if(!this.available()||this.current)return false;
  try{if(this.disjoint())return false;if(this.pending.length>=this.maxPending){this.status='pending (queue full)';return false;}if(this.gl.getQuery?.(this.ext.TIME_ELAPSED_EXT,this.gl.CURRENT_QUERY)){this.status='busy (another GPU query)';return false;}const q=this.gl.createQuery();if(!q){this.status='unavailable (query allocation)';return false;}try{this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT,q);this.current=q;return true;}catch(error){this.gl.deleteQuery(q);throw error;}}
  catch{this.status='unavailable (timer error)';return false;}
 }
 end(){if(!this.current)return false;const q=this.current;this.current=null;try{this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);this.pending.push(q);this.status='pending';return true;}catch{this.gl.deleteQuery(q);this.status='unavailable (timer error)';return false;}}
 poll(){
  let ms=null;if(!this.available())return {ms,status:this.status};
  try{if(this.disjoint())return {ms,status:this.status};while(this.pending.length){const q=this.pending[0];if(!this.gl.getQueryParameter(q,this.gl.QUERY_RESULT_AVAILABLE))break;this.pending.shift();try{const ns=this.gl.getQueryParameter(q,this.gl.QUERY_RESULT);if(Number.isFinite(ns)&&ns>=0)ms=ns/1e6;}finally{this.gl.deleteQuery(q);}}this.status=ms!==null?'available':this.pending.length||this.current?'pending':'ready';}
  catch{this.clear();this.status='unavailable (timer error)';}return {ms,status:this.status};
 }
 dispose(){this.clear();this.disposed=true;this.status='unavailable (disposed)';}
}
