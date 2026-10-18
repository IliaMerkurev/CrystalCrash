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
  start() { this.starts++; if (this.buffer?.length === 1) this.onended?.(); }
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

function tick(fx, speed, intensity = 1, frames = 120, dt = 1 / 60) {
  for (let i = 0; i < frames; i++) {
    fx.context.currentTime += dt;
    fx.updateRolling(speed, intensity, dt);
  }
}

test('rolling has no autoplay and allocates one shared looping graph and buffer across thousands of updates', () => fixture(async fx => {
  fx.updateRolling(20); fx.play('glassTap'); fx.stopRolling();
  assert.equal(fx.context, null);
  fx.setMuted(true);
  assert.equal(await fx.unlock(), true);
  const ctx = fx.context;
  assert.ok(fx.rollingBuffer, 'texture is prepared during unlock, before the first movement');
  assert.equal(fx.rolling, null, 'the inaudible loop graph can remain lazy');
  fx.updateRolling(20);
  assert.equal(fx.rolling, null);
  fx.setMuted(false);
  tick(fx, 20);
  const { source, gain } = fx.rolling, buffer = fx.rollingBuffer;
  const initialNodes = ctx.nodes.length, initialBuffers = ctx.buffers.length;
  for (let i = 0; i < 4000; i++) {
    fx.updateRolling(i % 32, (i % 7) / 6, 1 / 60);
    if (i % 17 === 0) fx.stopRolling();
    if (i % 113 === 0) await fx.unlock();
  }
  assert.equal(ctx.nodes.length, initialNodes, 'no per-ball or per-frame nodes');
  assert.equal(ctx.buffers.length, initialBuffers, 'buffer is precomputed once');
  assert.equal(fx.rolling.source, source); assert.equal(fx.rolling.gain, gain);
  assert.equal(source.buffer, buffer); assert.equal(source.loop, true);
  assert.equal(source.starts, 1); assert.equal(source.stops, 0);
  assert.equal(source.loopStart, 0); assert.equal(source.loopEnd, buffer.duration);
  assert.deepEqual(source.connections, [gain]); assert.deepEqual(gain.connections, [fx.master]);
  assert.equal(ctx.nodes.filter(n => n.loop).length, 1);
  assert.equal(fx.voices.length, 0, 'rolling does not consume one-shot voice capacity');
}));

test('precomputed stone texture is short, finite, normalized, and wraps without a seam spike or volume notch', () => fixture(async fx => {
  await fx.unlock(); fx.updateRolling(16);
  const buffer = fx.rollingBuffer, data = buffer.getChannelData(0);
  assert.equal(buffer.numberOfChannels, 1); assert.equal(buffer.duration, .64);
  let energy = 0, peak = 0, deltaEnergy = 0;
  for (let i = 0; i < data.length; i++) {
    assert.ok(Number.isFinite(data[i]));
    energy += data[i] ** 2; peak = Math.max(peak, Math.abs(data[i]));
    deltaEnergy += (data[(i + 1) % data.length] - data[i]) ** 2;
  }
  const rms = Math.sqrt(energy / data.length), deltaRms = Math.sqrt(deltaEnergy / data.length);
  assert.ok(rms > .1 && rms <= .211); assert.ok(peak <= .721);
  assert.ok(Math.abs(data[0] - data.at(-1)) < deltaRms * 3, 'boundary is no sharper than ordinary texture');
  const edgeRms = Math.sqrt([...data.slice(0, 960), ...data.slice(-960)].reduce((sum, n) => sum + n * n, 0) / 1920);
  assert.ok(edgeRms > rms * .6 && edgeRms < rms * 1.4, 'no repeating fade-out/in at the loop edge');
}));

test('actual slow-motion speeds lower gain and pitch smoothly; contact intensity and extreme input are bounded', () => fixture(async fx => {
  await fx.unlock();
  fx.updateRolling(20);
  assert.ok(fx.rolling.speed > 0 && fx.rolling.speed < 20);
  assert.ok(fx.rolling.intensity > 0 && fx.rolling.intensity < 1);
  tick(fx, 20);
  const gain = fx.rolling.gain.gain, rate = fx.rolling.source.playbackRate;
  const normal = [gain.target, rate.target];
  fx.updateRolling(2);
  assert.ok(fx.rolling.speed > 2 && fx.rolling.speed < 20, 'speed change glides');
  tick(fx, 6); const aim = [gain.target, rate.target];
  tick(fx, 2); const blackHole = [gain.target, rate.target];
  assert.ok(normal[0] > aim[0] && aim[0] > blackHole[0]);
  assert.ok(normal[1] > aim[1] && aim[1] > blackHole[1]);
  tick(fx, 20, .2);
  assert.ok(gain.target < normal[0] * .21);
  tick(fx, 1e9, 1e9);
  assert.ok(gain.target <= .13); assert.ok(rate.target <= 2.08);
  for (const param of [gain, rate]) {
    assert.ok(param.events.some(e => e.kind === 'hold'));
    assert.ok(param.events.filter(e => e.kind === 'target').every(e => e.smoothing > 0));
  }
  for (const input of [NaN, Infinity, -5, 0]) {
    fx.updateRolling(input); assert.equal(gain.target, 0); assert.equal(fx.rolling.active, false);
  }
}));

test('rolling envelope is frame-rate independent and supports older AudioParam cancellation', () => fixture(async fx => {
  await fx.unlock(); tick(fx, 17, .6, 12, 1 / 30);
  const slow = { speed: fx.rolling.speed, intensity: fx.rolling.intensity };
  fx.stopRolling();
  fx.rolling.gain.gain.cancelAndHoldAtTime = undefined;
  fx.rolling.source.playbackRate.cancelAndHoldAtTime = undefined;
  tick(fx, 17, .6, 48, 1 / 120);
  assert.ok(Math.abs(fx.rolling.speed - slow.speed) < 1e-12);
  assert.ok(Math.abs(fx.rolling.intensity - slow.intensity) < 1e-12);
  assert.ok(fx.rolling.gain.gain.events.some(e => e.kind === 'cancel'));
}));

test('pause/reset, mute, suspended context and resume cannot restore a stale rolling sound', () => fixture(async fx => {
  await fx.unlock(); tick(fx, 20);
  const { source, gain } = fx.rolling, ctx = fx.context;
  fx.stopRolling();
  assert.equal(gain.gain.target, 0); assert.equal(fx.rolling.speed, 0); assert.equal(fx.rolling.intensity, 0);
  const stopEvents = gain.gain.events.length;
  fx.stopRolling(); fx.stopRolling();
  assert.equal(gain.gain.events.length, stopEvents, 'steady stopped frames do not queue automation');
  tick(fx, 20); fx.setMuted(true);
  assert.equal(fx.master.gain.target, 0); assert.equal(gain.gain.target, 0);
  fx.updateRolling(24); fx.setMuted(false); await fx.unlock();
  assert.equal(fx.master.gain.target, .56); assert.equal(gain.gain.target, 0);
  assert.equal(fx.rolling.active, false);
  fx.updateRolling(20); assert.ok(gain.gain.target > 0);
  ctx.state = 'suspended'; fx.updateRolling(24);
  assert.equal(gain.gain.target, 0); assert.equal(gain.gain.value, 0);
  assert.equal(source.playbackRate.target, .48);
  assert.equal(ctx.resumes, 1, 'rolling does not repeatedly request device resumes');
  assert.equal(await fx.unlock(), true); assert.equal(gain.gain.target, 0);
  assert.equal(fx.rolling.active, false);
  fx.updateRolling(10); assert.ok(gain.gain.target > 0);
  fx.updateRolling(10, 1, 0); assert.equal(gain.gain.target, 0, 'zero-dt pause is silent');
  fx.dispose();
  assert.equal(source.stops, 1); assert.equal(source.connections.length, 0); assert.equal(gain.connections.length, 0);
  assert.equal(fx.rollingBuffer, null); assert.equal(fx.rolling, null); assert.equal(ctx.state, 'closed');
  fx.updateRolling(20); fx.stopRolling(); assert.equal(await fx.unlock(), false);
}));

test('concurrent gesture unlocks share one resume; a pending unlock cannot resurrect disposed audio', async () => {
  const originalContext = globalThis.AudioContext;
  let resolveResume;
  class DelayedContext extends Context {
    resume() { this.resumes++; return new Promise(resolve => { resolveResume = () => { this.state = 'running'; resolve(); }; }); }
  }
  globalThis.AudioContext = DelayedContext;
  const fx = new AudioFX(), discarded = new AudioFX();
  try {
    const first = fx.unlock(), second = fx.unlock(), ctx = fx.context;
    assert.equal(ctx.resumes, 1);
    fx.updateRolling(20); assert.equal(fx.rolling, null, 'no rolling backlog during unlock');
    resolveResume();
    assert.deepEqual(await Promise.all([first, second]), [true, true]);
    assert.equal(ctx.nodes.filter(n => n.kind === 'source').length, 1, 'one silent unlock source');
    assert.equal(fx.unlocking, null);
    const pending = discarded.unlock(), retired = discarded.context;
    discarded.dispose(); resolveResume();
    assert.equal(await pending, false);
    assert.equal(discarded.context, null); assert.equal(discarded.unlocked, false);
    assert.equal(retired.nodes.filter(n => n.kind === 'source').length, 0, 'no source created after disposal');
  } finally { fx.dispose(); discarded.dispose(); globalThis.AudioContext = originalContext; }
});

test('glassTap is a separate short, softer contact recipe; shatter recipe remains unchanged', () => fixture(async fx => {
  await fx.unlock();
  const tones = [], noises = [];
  fx._tone = (_voice, _at, hz, duration, amplitude, shape, end) => tones.push({ hz, duration, amplitude, shape, end });
  fx._noise = (_voice, _at, duration, amplitude, hz, band) => noises.push({ duration, amplitude, hz, band });
  fx.play('glassTap', 1, 'blue');
  assert.equal(tones.length, 3); assert.equal(noises.length, 1);
  assert.ok(tones.every(t => t.duration <= .085 && t.amplitude <= .035));
  assert.deepEqual(noises[0], { duration: .012, amplitude: .014, hz: 1200, band: 'bandpass' });
  fx.play('glassTap', 1, 'blue'); assert.equal(tones.length, 3, 'contact chatter is rate-limited');
  fx.context.currentTime += .06; fx.play('glassTap', .25, 'blue');
  assert.equal(tones.length, 6); assert.equal(tones[3].amplitude, .0175);
  tones.length = 0; noises.length = 0;
  fx.play('break', 1, 'blue');
  assert.equal(tones.length, 6); assert.equal(noises.length, 1);
  assert.deepEqual(noises[0], { duration: .17, amplitude: .12, hz: 1900, band: 'highpass' });
  assert.equal(tones[0].duration, .32); assert.equal(tones[0].amplitude, .066);
  assert.deepEqual(tones[5], { hz: 155, duration: .1, amplitude: .055, shape: 'sine', end: 65 });
}));
