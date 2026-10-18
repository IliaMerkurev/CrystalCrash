import assert from 'node:assert/strict';
import test from 'node:test';
import { LaunchCharge, LaunchChargeMeter } from '../src/launch-charge.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} ≈ ${expected}`);

test('holding still and sub-threshold motion never precharge the launch', () => {
  const charge = new LaunchCharge();
  for (const length of [0, .2, .7, NaN, Infinity, -.8]) {
    charge.setPull(length);
    charge.update(10);
    assert.equal(charge.multiplier(), 1);
    assert.equal(charge.snapshot().elapsed, 0);
    assert.equal(charge.snapshot().state, 'idle');
  }
  charge.setPull(.700001);
  assert.equal(charge.snapshot().elapsed, 0);
  assert.equal(charge.snapshot().pulling, true);
  assert.equal(charge.snapshot().state, 'charging');
});

test('one inclusive 1.0–1.5-second window; no early, late, or cyclic reward', () => {
  const charge = new LaunchCharge();
  charge.setPull(1);
  charge.update(.999);
  assert.equal(charge.multiplier(), 1);
  charge.update(.001);
  assert.equal(charge.multiplier(), 2);
  assert.equal(charge.snapshot().state, 'window');
  charge.update(.5);
  assert.equal(charge.multiplier(), 2);
  charge.update(.00001);
  assert.equal(charge.multiplier(), 1);
  assert.equal(charge.snapshot().state, 'spent');
  charge.update(20);
  assert.equal(charge.multiplier(), 1);
  assert.equal(charge.snapshot().progress, 1);
});

test('retreat keeps the same running clock and requires a meaningful pull at release', () => {
  const charge = new LaunchCharge();
  charge.setPull(1);
  charge.update(.8);
  charge.setPull(.1);
  charge.update(.3);
  near(charge.snapshot().elapsed, 1.1);
  assert.equal(charge.multiplier(), 1);
  assert.equal(charge.snapshot().window, false);
  charge.setPull(1);
  assert.equal(charge.multiplier(), 2);
  charge.setPull(0);
  charge.update(.5);
  charge.setPull(1);
  assert.equal(charge.multiplier(), 1);
  assert.equal(charge.snapshot().state, 'spent');
  charge.reset();
  assert.deepEqual(charge.snapshot(), { state: 'idle', elapsed: 0, window: false, progress: 0, pulling: false, started: false });
  charge.setPull(1);
  charge.update(1.1);
  assert.equal(charge.multiplier(), 2);
});

test('pause freezes elapsed and invalid deltas never poison the clock', () => {
  const charge = new LaunchCharge();
  charge.setPull(1);
  charge.update(.9);
  charge.update(100, { paused: true });
  for (const value of [0, -1, NaN, Infinity, undefined]) charge.update(value);
  assert.equal(charge.snapshot().elapsed, .9);
  charge.update(.1);
  assert.equal(charge.multiplier(), 2);
  charge.update(100, { paused: true });
  assert.equal(charge.multiplier(), 2);
});

test('real-time window is independent of frame rate and repeated pull events', () => {
  for (const rate of [30, 60, 90, 120, 144]) {
    const charge = new LaunchCharge();
    charge.setPull(1);
    for (let i = 0; i < rate; i++) { charge.setPull(2); charge.update(1 / rate); }
    near(charge.snapshot().elapsed, 1);
    assert.equal(charge.multiplier(), 2, `${rate}Hz at 1 second`);
    for (let i = 0; i < rate / 2; i++) charge.update(1 / rate);
    assert.equal(charge.multiplier(), 2, `${rate}Hz at 1.5 seconds`);
    charge.update(1 / rate);
    assert.equal(charge.multiplier(), 1, `${rate}Hz after 1.5 seconds`);
  }
});

function fakeDOM() {
  const document = { defaultView: { innerWidth: 390, innerHeight: 844 } };
  class Element {
    constructor(name) { this.name = name; this.style = {}; this.attributes = {}; this.children = []; this.ownerDocument = document; }
    setAttribute(key, value) { this.attributes[key] = value; }
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); }
  }
  document.createElement = name => new Element(name);
  document.createElementNS = (_namespace, name) => new Element(name);
  document.body = new Element('body');
  return document;
}

test('meter is compact, pointer-transparent, viewport-bounded, above and beside the ball', () => {
  const document = fakeDOM();
  const meter = new LaunchChargeMeter(document.body);
  const charge = new LaunchCharge();
  meter.render(charge.snapshot(), { x: 200, y: 700, width: 390, height: 844 });
  assert.equal(meter.element.style.display, 'none');
  charge.setPull(1);
  meter.render(charge.snapshot(), { x: 200, y: 700, width: 390, height: 844 });
  assert.equal(meter.element.style.display, 'block');
  assert.equal(meter.element.style.pointerEvents, 'none');
  assert.ok(parseFloat(meter.element.style.width) <= 152);
  assert.ok(parseFloat(meter.element.style.top) + parseFloat(meter.element.style.height) < 700);
  assert.ok(parseFloat(meter.element.style.left) > 200, 'place right when the dial fits without covering the launch line');
  meter.render(charge.snapshot(), { x: 330, y: 700, width: 390, height: 844 });
  assert.ok(parseFloat(meter.element.style.left) + parseFloat(meter.element.style.width) < 330, 'place left when the right side has insufficient room');
  for (const [x, y] of [[-100, -100], [1000, 1000]]) {
    meter.render(charge.snapshot(), { x, y, width: 390, height: 844 });
    assert.ok(parseFloat(meter.element.style.left) >= 8);
    assert.ok(parseFloat(meter.element.style.top) >= 8);
    assert.ok(parseFloat(meter.element.style.left) + parseFloat(meter.element.style.width) <= 382);
    assert.ok(parseFloat(meter.element.style.top) + parseFloat(meter.element.style.height) <= 836);
  }
  charge.update(1);
  meter.render(charge.snapshot(), { x: 200, y: 700, width: 390, height: 844 });
  assert.equal(meter.label.textContent, 'RELEASE ×2');
  near(Number(meter.needle.attributes.x2), 80);
  charge.update(.6);
  meter.render(charge.snapshot(), { x: 200, y: 700, width: 390, height: 844 });
  assert.equal(meter.label.textContent, 'NORMAL 1×');
  meter.hide();
  assert.equal(meter.element.style.display, 'none');
  meter.dispose();
  assert.equal(document.body.children.length, 0);
});

test('success glow is small, non-interactive and bounded by supplied active time', () => {
  const document = fakeDOM();
  const meter = new LaunchChargeMeter(document.body);
  meter.success({ x: 200, y: 700 });
  assert.equal(meter.successElement.style.display, 'block');
  assert.equal(meter.successElement.style.pointerEvents, 'none');
  assert.equal(meter.successElement.style.width, '64px');
  meter.update(.2);
  assert.ok(Number(meter.successElement.style.opacity) < 1);
  const opacity = meter.successElement.style.opacity;
  meter.update(10, { paused: true });
  assert.equal(meter.successElement.style.opacity, opacity);
  meter.render({}, { visible: false });
  assert.equal(meter.successElement.style.display, 'block');
  meter.update(.22);
  assert.equal(meter.successElement.style.display, 'none');
  meter.success({ x: -100, y: -100 });
  assert.equal(meter.successElement.style.left, '0px');
  assert.equal(meter.successElement.style.top, '0px');
  meter.render({}, { visible: false, realDt: 1 });
  assert.equal(meter.successElement.style.display, 'none');
  meter.success({ x: 200, y: 700 });
  meter.hide();
  assert.equal(meter.successElement.style.display, 'none');
  assert.equal(meter.successRemaining, 0);
});

test('meter remains safe when no DOM is available', () => {
  const meter = new LaunchChargeMeter(null);
  meter.render({}); meter.update(.1); meter.success(); meter.hide(); meter.dispose();
});
