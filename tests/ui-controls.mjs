import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
assert(html.includes('id="bonus-test" class="tool-button">Test</button>'));assert(html.includes('id="fullscreen"'));assert(html.includes('Collected powers activate immediately'));
const start=source.indexOf('function setupFullscreen()'),end=source.indexOf('\nfunction ',start+10);let requests=0,exits=0,cancels=0;const notices=[],events={},button={setAttribute(k,v){this[k]=v;}},controls={addEventListener(k,fn){events[k]=fn;}};
const document={documentElement:{async requestFullscreen(){requests++;document.fullscreenElement=this;}},fullscreenElement:null,async exitFullscreen(){exits++;this.fullscreenElement=null;},querySelector:()=>controls,addEventListener(k,fn){events[k]=fn;}};
const context={document,$:()=>button,cancelDrag(){cancels++;},tell:m=>notices.push(m)};vm.createContext(context);vm.runInContext(source.slice(start,end),context);context.setupFullscreen();
await button.onclick();assert.equal(requests,1);assert.equal(button['aria-label'],'Exit fullscreen');assert(button.innerHTML.includes('<svg'));assert.equal(button['aria-pressed'],'true');await button.onclick();assert.equal(exits,1);assert.equal(button['aria-label'],'Enter fullscreen');
delete document.documentElement.requestFullscreen;await button.onclick();assert(notices.at(-1).includes('not available'));assert.equal(button['aria-pressed'],'false');let stopped=false;events.pointerdown({stopPropagation(){stopped=true;}});assert(stopped);assert.equal(cancels,3);
console.log('PASS visible test/fullscreen controls, trusted-click API toggle, unsupported fallback and pointer isolation');

const css=fs.readFileSync(new URL('../src/style.css',import.meta.url),'utf8');
const glassRule=css.match(/\.glass-panel,\.power-slot,\.power-tip[^}]+}/)?.[0];assert(glassRule);for(const plain of ['#hint','.rail-hint','#toast','#section','.brand','.legend'])assert(!glassRule.includes(plain));assert(css.includes('#paused{background:'));assert(css.includes('blur(24px) saturate(125%)'));
console.log('PASS frosted panels only, plain logo/hints/legend and fullscreen pause blur');

assert(css.includes('.scene-frosted #game{filter:blur(10px)'));assert(html.includes('class="scene-frosted"'));console.log('PASS explicit modal WebGL scene blur and accessible fullscreen icon');
const modalStart=source.indexOf('function syncModalBlur()'),modalEnd=source.indexOf('\nfunction ',modalStart+10);const modalStates=[];const musicStates=[];const modal={audio:{setMusicPlaying:on=>musicStates.push(on)},started:false,paused:false,bonusTestOpen:false,document:{body:{classList:{toggle:(name,on)=>modalStates.push({name,on})}}}};vm.createContext(modal);vm.runInContext(source.slice(modalStart,modalEnd),modal);modal.syncModalBlur();modal.started=true;modal.syncModalBlur();modal.bonusTestOpen=true;modal.syncModalBlur();modal.bonusTestOpen=false;modal.paused=true;modal.syncModalBlur();modal.paused=false;modal.syncModalBlur();assert.deepEqual(modalStates.map(x=>x.on),[true,false,true,true,false]);
console.log('PASS scene blur follows start, Test, pause and gameplay restoration');

assert.deepEqual(musicStates,[false,true,false,false,true]);modal.document.hidden=true;modal.syncModalBlur();assert.equal(musicStates.at(-1),false);console.log('PASS music follows modal and hidden-page eligibility');

const longPress=source.split('\n').find(line=>line.startsWith("document.addEventListener('contextmenu'"));assert(longPress);let guard;
vm.runInNewContext(longPress,{document:{addEventListener:(kind,fn)=>{assert.equal(kind,'contextmenu');guard=fn;}}});
let prevented=0;const event=(editable,game)=>({target:{closest:selector=>selector.startsWith('input')?editable:game},preventDefault(){prevented++;}});
guard(event(false,true));assert.equal(prevented,1);guard(event(true,true));guard(event(false,false));guard({target:null,preventDefault(){prevented++;}});assert.equal(prevented,1);
assert(css.includes('-webkit-user-select:none;user-select:none;-webkit-touch-callout:none'));assert(css.includes('-webkit-user-select:text;user-select:text;-webkit-touch-callout:default'));assert(css.includes('touch-action:none'));
console.log('PASS game long-press callout/selection guard preserves editable fields and unrelated browser context menus');
