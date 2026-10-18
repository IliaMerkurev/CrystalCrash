import assert from 'node:assert/strict';
import test from 'node:test';
import { AudioFX } from '../src/audio.js';

class Param {
  constructor(value = 0) { this.value = value; this.events = []; }
  record(kind, value, time, smoothing) {
    assert.ok(Number.isFinite(value));
    this.events.push({ kind, value, time, smoothing });
    if (kind === 'set') this.value = value;
    return this;
  }
  setValueAtTime(v, t) { return this.record('set', v, t); }
  setTargetAtTime(v, t, s) { return this.record('target', v, t, s); }
  linearRampToValueAtTime(v, t) { return this.record('linear', v, t); }
  exponentialRampToValueAtTime(v, t) { return this.record('exponential', v, t); }
  cancelScheduledValues(t) { this.events.push({ kind: 'cancel', time: t }); }
  cancelAndHoldAtTime(t) { this.events.push({ kind: 'hold', time: t }); }
  get target() { return this.events.findLast(e => ['set', 'target', 'linear', 'exponential'].includes(e.kind))?.value ?? this.value; }
}

class Node {
  constructor(ctx, kind) {
    this.kind = kind; this.connections = []; this.stops = 0; this.starts = 0;
    for (const name of ['gain', 'frequency', 'playbackRate', 'Q', 'threshold', 'knee', 'ratio', 'attack', 'release']) this[name] = new Param();
    ctx.nodes.push(this);
  }
  connect(node) { this.connections.push(node); return node; }
  disconnect() { this.connections.length = 0; }
  start(when=0,offset=0) { this.startOffset=offset; this.starts++; if (this.buffer?.length === 1) this.onended?.(); }
  stop() { this.stops++; this.onended?.(); }
}

class Context {
  constructor() {
    this.currentTime = 1; this.sampleRate = 48000; this.state = 'suspended';
    this.nodes = []; this.buffers = []; this.destination = {}; this.resumes = 0;
  }
  createGain() { return new Node(this, 'gain'); }
  createDynamicsCompressor() { return new Node(this, 'compressor'); }
  createBufferSource() { return new Node(this, 'source'); }
  createBiquadFilter() { return new Node(this, 'filter'); }
  createOscillator() { return new Node(this, 'oscillator'); }
  createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    const buffer = { length, duration: length / sampleRate, numberOfChannels: channels, sampleRate, getChannelData: i => data[i] };
    this.buffers.push(buffer); return buffer;
  }
  async resume() { this.resumes++; this.state = 'running'; }
  async close() { this.state = 'closed'; }
}

async function fixture(run) {
  const original = globalThis.AudioContext;
  globalThis.AudioContext = Context;
  const fx = new AudioFX();
  try { await run(fx); } finally { fx.dispose(); globalThis.AudioContext = original; }
}


Context.prototype.decodeAudioData=function(bytes,ok,fail){this.decodes=(this.decodes||0)+1;assert(bytes.byteLength>0);return Promise.resolve({duration:65,numberOfChannels:2});};
const data='data:audio/mpeg;base64,SUQz';
async function ready(fx){await fx.unlock();await fx.musicDecoding;}
test('music has no autoplay, decodes once, loops at normal speed and uses one source',()=>fixture(async fx=>{
 fx.setMusicData(data);fx.setMusicPlaying(true);assert.equal(fx.context,null);await ready(fx);
 const source=fx.musicSource;assert(source);assert(source.loop);assert.equal(source.loopEnd,65);assert.equal(source.playbackRate.value,1);assert.equal(fx.musicGain.gain.value,.3);assert.equal(fx.master.gain.value,.56);
 const nodes=fx.context.nodes.length;for(let i=0;i<1000;i++)fx.setMusicPlaying(true);assert.equal(fx.musicSource,source);assert.equal(fx.context.nodes.length,nodes);assert.equal(fx.context.decodes,1);
}));
test('pause/mute resume the retained offset without duplicate sources',()=>fixture(async fx=>{
 fx.setMusicData(data);fx.setMusicPlaying(true);await ready(fx);const a=fx.musicSource;
 fx.context.currentTime+=12;fx.setMusicPlaying(false);assert.equal(fx.musicSource,null);assert.equal(fx.musicOffset,12);assert.equal(a.stops,1);
 fx.context.currentTime+=5;fx.setMusicPlaying(true);assert.equal(fx.musicSource.startOffset,12);fx.context.currentTime+=3;fx.setMuted(true);assert.equal(fx.musicOffset,15);assert.equal(fx.musicSource,null);
 fx.setMuted(false);assert.equal(fx.musicSource.startOffset,15);assert.equal(fx.context.decodes,1);
 fx.context.currentTime+=70;fx.setMusicPlaying(false);assert.equal(fx.musicOffset,20);
}));
test('pause during asynchronous decode prevents late playback',()=>fixture(async fx=>{
 fx.setMusicData(data);fx.setMusicPlaying(true);await fx.unlock();let resolve;fx.context.decodeAudioData=()=>new Promise(r=>resolve=r);
 fx.setMusicData(data+'AA');await Promise.resolve();fx.setMusicPlaying(false);resolve({duration:65});await fx.musicDecoding;assert.equal(fx.musicSource,null);fx.setMusicPlaying(true);assert(fx.musicSource);
}));
test('suspension and disposed or failed decode cannot resurrect music',()=>fixture(async fx=>{
 fx.setMusicData(data);fx.setMusicPlaying(true);await ready(fx);fx.context.currentTime+=2;fx.context.state='suspended';fx.context.onstatechange();assert.equal(fx.musicSource,null);assert.equal(fx.musicOffset,2);await fx.unlock();assert.equal(fx.musicSource.startOffset,2);
 fx.setMusicData('bad');await fx.musicDecoding;assert(fx.musicError);assert.equal(fx.musicSource,null);fx.play('click');assert(fx.voices.length>0,'music error leaves effects working');
 let resolve;fx.context.decodeAudioData=()=>new Promise(r=>resolve=r);fx.setMusicData(data);await Promise.resolve();const pending=fx.musicDecoding;fx.dispose();resolve({duration:65});await pending;assert.equal(fx.musicSource,null);assert.equal(fx.musicBuffer,null);
}));
test('callback-only Safari decode and webkit context fallback work',async()=>{
 const old=globalThis.AudioContext,webkit=globalThis.webkitAudioContext,decode=Context.prototype.decodeAudioData;
 delete globalThis.AudioContext;globalThis.webkitAudioContext=Context;Context.prototype.decodeAudioData=function(bytes,ok){ok({duration:65});};
 const fx=new AudioFX();try{fx.setMusicData(data);fx.setMusicPlaying(true);await ready(fx);assert(fx.musicSource);}finally{fx.dispose();globalThis.AudioContext=old;globalThis.webkitAudioContext=webkit;Context.prototype.decodeAudioData=decode;}
});

class Events {constructor(){this.listeners=new Map();this.hidden=false;this.PointerEvent=function(){};}addEventListener(k,f){const set=this.listeners.get(k)||new Set();set.add(f);this.listeners.set(k,set);}removeEventListener(k,f){this.listeners.get(k)?.delete(f);}emit(k){for(const f of this.listeners.get(k)||[])f();}}
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
test('iPad interruption/visibility recovery preserves offset, pause and one music loop',()=>fixture(async fx=>{
 const doc=new Events(),win=new Events();fx.bindLifecycle(doc,win);fx.setMusicData(data);fx.setMusicPlaying(true);await ready(fx);const ctx=fx.context;ctx.currentTime+=7;
 doc.hidden=true;doc.emit('visibilitychange');ctx.state='interrupted';ctx.onstatechange();assert.equal(fx.musicSource,null);assert.equal(fx.musicOffset,7);
 fx.setMusicPlaying(false);doc.hidden=false;doc.emit('visibilitychange');win.emit('pageshow');win.emit('focus');await flush();assert.equal(ctx.state,'running');assert.equal(fx.musicSource,null,'paused game does not restart music');
 fx.setMusicPlaying(true);assert.equal(fx.musicSource.startOffset,7);const current=fx.musicSource;win.emit('focus');await flush();assert.equal(fx.musicSource,current);
 for(let i=0;i<5;i++){doc.hidden=true;doc.emit('visibilitychange');ctx.state='interrupted';ctx.onstatechange();doc.hidden=false;win.emit('pageshow');await flush();assert(fx.musicSource);}
 assert.equal(fx.context,ctx);assert.equal(ctx.decodes,1);const live=ctx.nodes.filter(n=>n.loop&&n.stops===0);assert.equal(live.filter(n=>n.buffer===fx.musicBuffer).length,1);
 fx.dispose();assert([...doc.listeners.values(),...win.listeners.values()].every(s=>s.size===0));
}));
test('rejected automatic resume retries inside next gesture; muted and hidden stay silent',()=>fixture(async fx=>{
 const doc=new Events(),win=new Events();fx.bindLifecycle(doc,win);fx.setMusicData(data);fx.setMusicPlaying(true);await ready(fx);const ctx=fx.context;
 fx.setPageVisible(false);ctx.state='interrupted';ctx.resume=async()=>{ctx.resumes++;throw new Error('gesture required');};fx.setPageVisible(true);await flush();assert.equal(fx.unlocked,false);assert.equal(fx.musicSource,null);
 ctx.resume=async()=>{ctx.resumes++;ctx.state='running';ctx.onstatechange();};doc.emit('pointerdown');await flush();assert(fx.musicSource);fx.play('click');assert(fx.voices.length>0);
 fx.setMuted(true);fx.setPageVisible(false);ctx.state='interrupted';const calls=ctx.resumes;fx.setPageVisible(true);doc.emit('pointerdown');await flush();assert.equal(ctx.resumes,calls);assert.equal(fx.musicSource,null);assert(fx.muted);
 doc.hidden=true;doc.emit('visibilitychange');fx.setMuted(false);doc.emit('pointerdown');await flush();assert.equal(ctx.resumes,calls);assert.equal(fx.musicSource,null);
}));
test('stale pending resume cannot block real gesture or resurrect a hidden/disposed source',()=>fixture(async fx=>{
 const doc=new Events(),win=new Events();fx.bindLifecycle(doc,win);fx.setMusicData(data);fx.setMusicPlaying(true);await ready(fx);const ctx=fx.context;
 fx.setPageVisible(false);ctx.state='interrupted';let resolveOld;ctx.resume=()=>new Promise(resolve=>resolveOld=resolve);fx.setPageVisible(true);assert(fx.unlocking);
 ctx.resume=async()=>{ctx.state='running';};doc.emit('pointerdown');await flush();const current=fx.musicSource;assert(current);resolveOld();await flush();assert.equal(fx.musicSource,current);
 fx.setPageVisible(false);assert.equal(fx.musicSource,null);ctx.onstatechange();assert.equal(fx.musicSource,null);fx.dispose();win.emit('pageshow');assert.equal(fx.context,null);
}));
