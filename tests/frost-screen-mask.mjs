import assert from 'node:assert/strict';
import { FrostScreenMask, frostScreenEnvelope, FROST_SCREEN_DURATION } from '../src/frost-screen-mask.js';

assert.equal(frostScreenEnvelope(-1), 0);
assert.equal(frostScreenEnvelope(NaN), 0);
assert.ok(frostScreenEnvelope(0) > 0, 'Pickup is visible immediately');
assert.ok(frostScreenEnvelope(0.1) > frostScreenEnvelope(0));
assert.equal(frostScreenEnvelope(0.22), 1);
assert.ok(frostScreenEnvelope(1.5) > frostScreenEnvelope(2.3));
assert.equal(frostScreenEnvelope(FROST_SCREEN_DURATION), 0);

const listeners = new Map();
let bakes = 0, removed = false;
const canvas = { style: {}, setAttribute() {}, remove() { removed = true; }, getContext() { bakes++; return null; } };
const doc = { body: { appendChild() {} }, createElement: () => canvas, removeEventListener() {} };
const win = { innerWidth: 390, innerHeight: 844, devicePixelRatio: 3,
  addEventListener: (name, fn) => listeners.set(name, fn),
  removeEventListener: (name) => listeners.delete(name) };
const effect = new FrostScreenMask({ document: doc, window: win });
assert.equal(canvas.style.pointerEvents, 'none');
assert.equal(canvas.style.display, 'none');
assert.equal(canvas.width, 585);
effect.trigger();
assert.equal(canvas.style.display, 'block');
const firstOpacity = canvas.style.opacity;
effect.update(0);
assert.equal(canvas.style.opacity, firstOpacity, 'Pause does not advance effect');
effect.update(-10); effect.update(NaN);
assert.equal(effect.age, 0);
effect.update(0.22);
assert.equal(canvas.style.opacity, '0.85');
effect.update(1);
assert.equal(bakes, 1, 'No texture regeneration during animation');
effect.trigger();
assert.equal(effect.age, 0, 'Repeated pickup restarts effect');
effect.update(10);
assert.equal(canvas.style.display, 'none');
effect.trigger(); effect.clear();
assert.equal(canvas.style.display, 'none');
listeners.get('resize')();
assert.equal(bakes, 2);
effect.dispose(); effect.trigger();
assert.ok(removed);
assert.equal(effect.canvas, null);
assert.equal(listeners.size, 0);
const headless = new FrostScreenMask({ document: null, window: null });
headless.trigger(); headless.update(0.5); headless.dispose();

let ready;
const lateDoc = { body: null, createElement: () => canvas,
  addEventListener(name, fn) { ready = fn; }, removeEventListener() {} };
const late = new FrostScreenMask({ document: lateDoc, window: win });
late.trigger();
assert.equal(late.canvas, null);
lateDoc.body = { appendChild() {} }; ready();
assert.equal(late.canvas, canvas);
assert.equal(canvas.style.display, 'block', 'Pickup before DOM readiness survives mount');
late.dispose();
console.log('Frost screen mask: envelope, lifecycle, pause, retrigger, resize and headless checks passed');
