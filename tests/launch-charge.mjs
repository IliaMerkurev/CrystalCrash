import assert from 'node:assert/strict';
import test from 'node:test';
import { LaunchCharge, LaunchChargeMeter } from '../src/launch-charge.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} ≈ ${expected}`);
const fixedCharge = (unit = 0) => new LaunchCharge({ random: () => unit });

test('holding still and sub-threshold motion never precharge the launch', () => {
  const charge = fixedCharge();
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

test('one inclusive one-third-second window starts between 1.0 and 1.25 seconds', () => {
  for (const unit of [0, .25, .5, .75, 1]) {
    const charge = fixedCharge(unit);
    const { windowStart, windowEnd, windowDuration } = charge.snapshot();
    near(windowStart, 1 + .25 * unit);
    near(windowEnd - windowStart, 1 / 3);
    assert.equal(windowDuration, 1 / 3);
    charge.setPull(1);
    charge.update(windowStart - .001);
    assert.equal(charge.multiplier(), 1);
    assert.equal(charge.snapshot().state, 'charging');
    charge.update(.001);
    assert.equal(charge.multiplier(), 2);
    assert.equal(charge.snapshot().state, 'window');
    charge.update(1 / 3);
    assert.equal(charge.multiplier(), 2);
    near(charge.snapshot().elapsed, windowEnd);
    charge.update(.00001);
    assert.equal(charge.multiplier(), 1);
    assert.equal(charge.snapshot().state, 'spent');
    charge.update(20);
    assert.equal(charge.multiplier(), 1);
    assert.equal(charge.snapshot().progress, 1);
  }
});

test('sample once on construction and each reset, never during the same gesture', () => {
  const rolls = [0, .5, 1];
  let calls = 0;
  const charge = new LaunchCharge({ random: () => rolls[calls++] });
  assert.equal(calls, 1);
  assert.equal(charge.snapshot().windowStart, 1);
  for (const length of [0, .2, .7, 1, 2, .1, 1]) {
    charge.setPull(length);
    charge.update(.1);
    charge.update(10, { paused: true });
    charge.snapshot();
    charge.multiplier();
    assert.equal(charge.snapshot().windowStart, 1);
    assert.equal(calls, 1);
  }
  const second = charge.reset();
  assert.equal(calls, 2);
  assert.equal(second.windowStart, 1.125);
  assert.equal(second.elapsed, 0);
  assert.equal(second.state, 'idle');
  assert.equal(second.started, false);
  charge.setPull(1);
  charge.update(1.1);
  assert.equal(charge.multiplier(), 1, 'reset uses the newly sampled start');
  charge.update(.025);
  assert.equal(charge.multiplier(), 2);
  assert.equal(calls, 2);
  const third = charge.reset();
  assert.equal(calls, 3);
  assert.equal(third.windowStart, 1.25);
  near(third.windowEnd, 1.25 + 1 / 3);
});

test('default RNG and invalid injected samples keep the timing bounds safe', () => {
  const charge = new LaunchCharge();
  assert.ok(charge.snapshot().windowStart >= 1 && charge.snapshot().windowStart <= 1.25);
  for (const [unit, expected] of [[-1, 1], [2, 1.25], [NaN, 1], [Infinity, 1]]) {
    const snapshot = fixedCharge(unit).snapshot();
    assert.equal(snapshot.windowStart, expected);
    near(snapshot.windowEnd - snapshot.windowStart, 1 / 3);
  }
});

test('retreat keeps the same running clock and requires a meaningful pull at release', () => {
  const charge = fixedCharge();
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
  assert.deepEqual(charge.snapshot(), { state: 'idle', elapsed: 0, window: false, windowStart: 1, windowEnd: 1 + 1 / 3, windowDuration: 1 / 3, progress: 0, pulling: false, started: false });
  charge.setPull(1);
  charge.update(1.1);
  assert.equal(charge.multiplier(), 2);
});

test('pause freezes elapsed and invalid deltas never poison the clock', () => {
  const charge = fixedCharge();
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
    const charge = fixedCharge();
    charge.setPull(1);
    for (let i = 0; i < rate; i++) { charge.setPull(2); charge.update(1 / rate); }
    near(charge.snapshot().elapsed, 1);
    assert.equal(charge.multiplier(), 2, `${rate}Hz at 1 second`);
    for (let i = 0; i < rate / 3; i++) charge.update(1 / rate);
    assert.equal(charge.multiplier(), 2, `${rate}Hz at the one-third-second window end`);
    charge.update(1 / rate);
    assert.equal(charge.multiplier(), 1, `${rate}Hz after the window end`);
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
  const charge = fixedCharge();
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

test('dial sector, bonus marker and label use the chosen window from the first frame', () => {
  const document = fakeDOM();
  const meter = new LaunchChargeMeter(document.body);
  let unit = 0;
  const charge = new LaunchCharge({ random: () => unit });
  const point = { x: 200, y: 700, width: 390, height: 844 };
  const expectSector = snapshot => {
    const [startX, startY, radiusX, radiusY, rotation, largeArc, sweep, endX, endY] = meter.sector.attributes.d.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi).map(Number);
    const startAngle = Math.PI * (1 - snapshot.windowStart / 2);
    const endAngle = Math.PI * (1 - snapshot.windowEnd / 2);
    near(startX, 80 + Math.cos(startAngle) * 60);
    near(startY, 78 - Math.sin(startAngle) * 60);
    near(endX, 80 + Math.cos(endAngle) * 60);
    near(endY, 78 - Math.sin(endAngle) * 60);
    assert.deepEqual([radiusX, radiusY, rotation, largeArc, sweep], [60, 60, 0, 0, 1]);
    near(startAngle - endAngle, Math.PI / 6, 'the green arc covers exactly one third of a second');
    near(Number(meter.bonusLabel.attributes.x), 80 + Math.cos((startAngle + endAngle) / 2) * 38);
    near(Number(meter.bonusLabel.attributes.y), 83 - Math.sin((startAngle + endAngle) / 2) * 38);
    assert.equal(meter.timingLabel.textContent, `${snapshot.windowStart.toFixed(2)}–${snapshot.windowEnd.toFixed(2)} s`);
  };
  // Even the idle render already knows the next gesture's interval.
  meter.render(charge.snapshot(), point);
  expectSector(charge.snapshot());
  assert.equal(meter.timingLabel.textContent, '1.00–1.33 s');
  const firstSector = meter.sector.attributes.d;
  charge.setPull(1);
  meter.render(charge.snapshot(), point);
  assert.equal(meter.element.style.display, 'block');
  assert.equal(meter.sector.attributes.d, firstSector);
  unit = 1;
  charge.update(1);
  charge.setPull(.1);
  meter.render(charge.snapshot(), point);
  assert.equal(meter.sector.attributes.d, firstSector, 'retreat and elapsed time do not move the sector');
  charge.setPull(1);
  charge.update(10, { paused: true });
  meter.render(charge.snapshot(), point);
  assert.equal(meter.sector.attributes.d, firstSector, 'pausing does not move the sector');
  assert.equal(meter.label.textContent, 'RELEASE ×2');
  charge.reset();
  meter.render(charge.snapshot(), point);
  expectSector(charge.snapshot());
  assert.notEqual(meter.sector.attributes.d, firstSector);
  assert.equal(meter.timingLabel.textContent, '1.25–1.58 s');
  charge.setPull(1);
  meter.render(charge.snapshot(), point);
  expectSector(charge.snapshot());
  const nextSector = meter.sector.attributes.d;
  for (const dt of [1, .25, 1 / 3, .001]) {
    charge.update(dt);
    meter.render(charge.snapshot(), point);
    assert.equal(meter.sector.attributes.d, nextSector);
  }
  assert.equal(meter.label.textContent, 'NORMAL 1×');
  meter.dispose();
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
