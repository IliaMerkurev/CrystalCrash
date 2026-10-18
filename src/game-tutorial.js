// Contextual, event-driven onboarding. No timers complete gameplay steps.
export const TUTORIAL_STORAGE_KEY='crystal-crash.tutorial.v1';
export const TUTORIAL_STEPS=Object.freeze(['catch','aim','release','attract','pickup','gate','extraCatch','extraRelease']);
const LABELS={catch:'Grab the main ball',aim:'Pull back to aim',release:'Release to launch',attract:'Hold here to attract',pickup:'Roll into a bonus',gate:'Roll through the open gate',extraCatch:'Grab an extra ball directly',extraRelease:'Pull back and release · No attraction'};
export const TUTORIAL_BONUSES=Object.freeze({pulse:'Pulse · Impacts blast nearby glass for 10s',pierce:'Pierce · Smash through glass for 10s',arc:'Arc · Chains through nearby bottom supports',frost:'Frost · Glass breaks one hit sooner this round',split:'Split · Every live ball creates two extras',gravity:'Tornado · Lifts and throws glass for 4s',heavy:'Heavy Hit · Adds a 3-damage strike',blackhole:'Black Hole · Pulls nearby glass inward for 3s',bomb:'Bomb · Explodes 3s after landing'});
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const transform=(v,m)=>[m[0]*v[0]+m[4]*v[1]+m[8]*v[2]+m[12]*v[3],m[1]*v[0]+m[5]*v[1]+m[9]*v[2]+m[13]*v[3],m[2]*v[0]+m[6]*v[1]+m[10]*v[2]+m[14]*v[3],m[3]*v[0]+m[7]*v[1]+m[11]*v[2]+m[15]*v[3]];
/** Projects local physics coordinates through the actual, animated camera. */
export function projectTutorialPoint(point,camera,viewport,sceneOffset=0){
 if(!point||!camera?.matrixWorldInverse?.elements||!camera?.projectionMatrix?.elements)return null;
 const world=[point.x,point.y,point.z+sceneOffset,1];
 const clip=transform(transform(world,camera.matrixWorldInverse.elements),camera.projectionMatrix.elements);
 if(!clip.every(Number.isFinite)||clip[3]<=0)return null;
 const [x,y,z]=clip.slice(0,3).map(n=>n/clip[3]);
 if(Math.abs(x)>1||Math.abs(y)>1||Math.abs(z)>1)return null;
 return {x:(viewport.left||0)+(x+1)*viewport.width/2,y:(viewport.top||0)+(1-y)*viewport.height/2};
}
export class GameTutorial {
 constructor({document:doc=globalThis.document,storage,root,project=projectTutorialPoint}={}){
  this.doc=doc;this.project=project;this.context=null;this.index=0;this.done=new Set();this.seenBonuses=new Set();this.bonusQueue=[];this.bonusTime=new Map();this.visible=false;
  try{this.storage=storage===undefined?globalThis.localStorage:storage;const raw=this.storage?.getItem(TUTORIAL_STORAGE_KEY);const saved=JSON.parse(raw||'0');if(typeof saved==='number'&&Number.isInteger(saved)&&saved>=0&&saved<=TUTORIAL_STEPS.length){for(const action of TUTORIAL_STEPS.slice(0,saved))this.done.add(action);}else if(Array.isArray(saved?.done)){for(const action of saved.done)if(TUTORIAL_STEPS.includes(action))this.done.add(action);}if(Array.isArray(saved?.bonuses))for(const kind of saved.bonuses)if(TUTORIAL_BONUSES[kind])this.seenBonuses.add(kind);this.index=this.done.size;}catch{}
  if(!doc)return;
  this.style=doc.createElement('style');this.style.textContent=`
.cc-tutorial{position:fixed;inset:0;z-index:18;pointer-events:none!important;overflow:hidden;contain:layout style;user-select:none}.cc-tutorial[hidden]{display:none!important}.cc-tutorial *{pointer-events:none!important;box-sizing:border-box}.cc-tutorial-label{position:absolute;max-width:216px;padding:9px 13px;border:1px solid #b6f6ff66;border-radius:13px;background:var(--glass-fill,#102339e8);backdrop-filter:var(--glass-blur,blur(10px));-webkit-backdrop-filter:var(--glass-blur,blur(10px));color:#edfdff;font:600 13px/1.25 system-ui,sans-serif;text-align:center;box-shadow:0 4px 22px #0005;text-wrap:balance}.cc-tutorial-pointer{position:absolute;width:52px;height:62px;filter:drop-shadow(0 2px 5px #001722);animation:cc-tutorial-nudge 1.25s ease-in-out infinite}.cc-tutorial[data-step=aim] .cc-tutorial-pointer,.cc-tutorial[data-step=extraRelease] .cc-tutorial-pointer{animation:cc-tutorial-pull 1.6s ease-in-out infinite}.cc-tutorial[data-step=attract] .cc-tutorial-pointer{animation:cc-tutorial-hold 1.5s ease-in-out infinite}.cc-tutorial-arrow{fill:none;stroke:#acfbff;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}.cc-tutorial-hand{fill:#eaffff;stroke:#21475c;stroke-width:1.5;stroke-linejoin:round}@keyframes cc-tutorial-nudge{0%,100%{transform:translateY(6px)}50%{transform:translateY(0)}}@keyframes cc-tutorial-pull{0%,100%{transform:translateY(0)}65%{transform:translateY(17px)}}@keyframes cc-tutorial-hold{0%,100%{transform:scale(1)}50%{transform:scale(.88)}}@media(prefers-reduced-motion:reduce){.cc-tutorial-pointer{animation:none!important}}`;
  (doc.head||root||doc.body).appendChild(this.style);
  this.element=doc.createElement('div');this.element.className='cc-tutorial';this.element.hidden=true;this.element.setAttribute('aria-live','polite');this.element.setAttribute('aria-atomic','true');
  this.label=doc.createElement('div');this.label.className='cc-tutorial-label';this.element.appendChild(this.label);
  this.pointer=doc.createElement('div');this.pointer.className='cc-tutorial-pointer';this.pointer.setAttribute('aria-hidden','true');
  this.pointer.innerHTML='<svg viewBox="0 0 52 62" width="52" height="62"><path class="cc-tutorial-arrow" d="M16 16V3m-6 6 6-6 6 6"/><path class="cc-tutorial-hand" d="M16 47V23c0-5 7-5 7 0v12-5c0-4 7-4 7 0v6-3c0-4 7-4 7 0v5-1c0-4 7-4 7 0v10c0 7-4 11-8 13H23c-4-3-6-7-8-10l-7-9c-3-4 2-8 5-4l3 3"/></svg>';
  this.element.appendChild(this.pointer);(root||doc.body).appendChild(this.element);
 }
 get step(){return TUTORIAL_STEPS.find(step=>!this.done.has(step))||'done';}
 get controlsCompleted(){return this.index>=TUTORIAL_STEPS.length;}
 get completed(){return this.controlsCompleted&&this.seenBonuses.size===Object.keys(TUTORIAL_BONUSES).length;}
 persist(){try{this.storage?.setItem(TUTORIAL_STORAGE_KEY,JSON.stringify({done:[...this.done],bonuses:[...this.seenBonuses]}));}catch{}}
 replay(){this.done.clear();this.seenBonuses.clear();this.bonusQueue=[];this.bonusTime.clear();this.index=0;this.persist();this.hide();}
 hide(){this.visible=false;if(this.element)this.element.hidden=true;}
 active(c){return !!c?.started&&!c.paused&&!c.menu&&!c.test&&!['READY','TRANSITION'].includes(c.state)&&(c.state!=='REPOSITION'||!!c.drag?.echo);}
 /** Pass context overrides when the action changes state before the next render. */
 notify(action,context){const c={...this.context,...context};if(this.completed||!TUTORIAL_STEPS.includes(action)||this.done.has(action)||!this.active(c)||(c.drag?.echo&&['catch','aim','release','attract'].includes(action)))return false;
  if(c.state==='REPOSITION'&&!['extraCatch','extraRelease'].includes(action))return false;
  if(action==='attract'&&!c.mainUpper)return false;
  if(action==='gate'&&(!c.gateReady||!c.gateOpen))return false;
  this.done.add(action);this.index=this.done.size;this.persist();this.hide();return true;
 }
 update(c){this.updateView(c);return {visible:this.visible,stage:this.displayStep||this.step};}
 updateView(c){this.context=c;this.hide();if(this.completed||!this.active(c))return;
  const targets=(c.bonusTargets||[]).filter(t=>t&&TUTORIAL_BONUSES[t.kind]&&t.point&&t.eligible!==false);
  for(const target of targets)if(!this.seenBonuses.has(target.kind)&&!this.bonusQueue.includes(target.kind))this.bonusQueue.push(target.kind);
  const candidates=[];const add=(step,point,label=LABELS[step])=>{if(point&&!this.done.has(step))candidates.push({step,point,label});};
  // Active control gestures and the unlocked exit always take precedence.
  if(c.state!=='REPOSITION'&&c.gateReady){if(c.gateOpen)add('gate',c.gatePoint);else if(!this.done.has('gate'))candidates.push({step:'gateBreak',point:c.gatePoint,label:'Break the glass gate'});}
  if(c.drag?.echo){
   const activeId=c.activeExtraId??c.drag.echo.b?.handle;const heldCandidates=(c.extraPoints||[]).filter(e=>e.isHeld&&!e.parked&&!e.staged);const held=activeId!==undefined?heldCandidates.find(e=>e.id===activeId):(heldCandidates.length===1?heldCandidates[0]:null);add('extraRelease',held?.point);
  }else{
   if(c.drag?.mode==='aim'&&['HELD','AIMING'].includes(c.state)){
    add('aim',c.mainPoint);add('release',c.mainPoint);
   }else if(!c.mainUpper&&!c.drag&&['HELD','BALL_ACTIVE'].includes(c.state)){if(this.done.has('catch')&&!this.done.has('release')&&c.mainPoint)candidates.push({step:'catch',point:c.mainPoint,label:'Grab the ball to finish launching'});else add('catch',c.mainPoint);}
   if(c.mainUpper&&c.state==='BALL_ACTIVE')add('attract',c.lowerPoint);
   const extra=(c.extraPoints||[]).find(e=>!e.isHeld&&!e.parked&&!e.staged&&e.catchable!==false&&(c.lowerZoneZ===undefined||e.point?.z>=c.lowerZoneZ)&&(c.lossZ===undefined||e.point?.z<c.lossZ));
   if(!c.drag){if(this.done.has('extraCatch')&&!this.done.has('extraRelease')&&extra?.point)candidates.push({step:'extraCatch',point:extra.point,label:'Grab the extra ball to relaunch'});else add('extraCatch',extra?.point);}
  }
  for(const kind of c.state==='REPOSITION'?[]:this.bonusQueue){if(this.seenBonuses.has(kind))continue;const target=targets.find(t=>t.kind===kind);if(target)candidates.push({step:'bonus-'+kind,point:target.point,kind,label:TUTORIAL_BONUSES[kind]});}
  if(!c.drag?.echo)add('pickup',c.eligiblePickupPoint||c.corePoint,c.eligiblePickupPoint?LABELS.pickup:'Break glowing glass');
  const viewport=c.viewport||{width:globalThis.innerWidth||0,height:globalThis.innerHeight||0};
  if(viewport.width<160||viewport.height<200)return;
  const left=viewport.left||0,top=viewport.top||0;
  // Re-resolve targets every frame; never point to a destroyed core or vanished drop.
  let selected,screen;
  for(const candidate of candidates){const p=this.project(candidate.point,c.camera,viewport,c.sceneOffset||0);if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y))continue;
   if((p.y<top+100&&!['gate','gateBreak'].includes(candidate.step))||p.y>top+viewport.height-72||p.x<left+12||p.x>left+viewport.width-12)continue;
   selected=candidate;screen=p;break;
  }
  if(!selected)return;const {step,kind,label}=selected;this.displayStep=step;this.visible=true;
  if(kind){const age=(this.bonusTime.get(kind)||0)+Math.max(0,Math.min(c.dt||0,.1));this.bonusTime.set(kind,age);if(age>=3){this.seenBonuses.add(kind);this.persist();}}
  if(!this.element)return;
  this.element.hidden=false;this.element.setAttribute('data-step',step);if(this.label.textContent!==label)this.label.textContent=label;
  const width=Math.min(216,viewport.width-32),labelX=clamp(screen.x-width/2,left+16,left+viewport.width-width-16);
  const anchorY=Math.max(top+104,screen.y);const labelY=anchorY+126<top+viewport.height-76?anchorY+78:anchorY-74;
  this.label.style.width=`${width}px`;this.label.style.left=`${labelX}px`;this.label.style.top=`${Math.max(top+104,labelY)}px`;
  this.pointer.style.left=`${clamp(screen.x-16,left+8,left+viewport.width-60)}px`;this.pointer.style.top=`${Math.max(top+104,screen.y+4)}px`;
 }
 destroy(){this.element?.remove();this.style?.remove();this.context=null;this.visible=false;}
}
