import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PERFORMANCE_STORAGE_KEY, SCENE_PIXEL_BUDGETS, DEFAULT_PERFORMANCE_SETTINGS,
  normalizePerformanceSettings, loadPerformanceSettings, savePerformanceSettings,
  formatPerformanceDiagnostics, createPerformanceSettingsUI, createPerformanceOverlay
} from '../src/performance-settings.js';

function memoryStorage() {
  const values = new Map();
  return {values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)};
}
class Element {
  constructor(tag, doc) { this.tagName = tag; this.ownerDocument = doc; this.children = []; this.attrs = {}; this.style = {}; this.listeners = new Map(); this.hidden = false; this.value = ''; this.checked = false; this.textWrites = 0; }
  set textContent(value) { this.text = value; this.textWrites++; }
  get textContent() { return this.text || ''; }
  append(...children) { for (const child of children) { child.parentNode = this; this.children.push(child); } }
  setAttribute(name, value) { this.attrs[name] = value; }
  addEventListener(name, fn) { const listeners = this.listeners.get(name) || new Set(); listeners.add(fn); this.listeners.set(name, listeners); }
  removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
  dispatch(name) { for (const fn of this.listeners.get(name) || []) fn({target: this}); }
  remove() { this.removed = true; if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); }
}
function documentFixture() {
  const document = {createElement(tag) { return new Element(tag, document); }};
  return {document, parent: document.createElement('div')};
}
const sample = {fps: 60, frameMs: 16.666, physicsMs: 2.125, drawCalls: 44, triangles: 125000, bodies: 120, colliders: 456, width: 1080, height: 1920, reflectionResolution: 512};

test('defaults preserve all visual effects and keep diagnostics opt-in', () => {
  assert.equal(Object.isFrozen(DEFAULT_PERFORMANCE_SETTINGS), true);
  assert.deepEqual(SCENE_PIXEL_BUDGETS, {low: 900000, medium: 1400000, high: 2073600});
  assert.deepEqual(DEFAULT_PERFORMANCE_SETTINGS, {sceneQuality: 'auto', floorReflection: 'auto', cubesInFloor: true, cubeEnvironment: true, particlesInFloor: true, debrisEnvironment: true, shadows: 'high', gateTransmission: true, areaLights: true, showDiagnostics: false});
  const first = normalizePerformanceSettings(), second = normalizePerformanceSettings();
  first.shadows = 'off';
  assert.equal(second.shadows, 'high');
});

test('validation is strict, independent, fresh, and strips unsupported keys', () => {
  const source = {sceneQuality: 'low', floorReflection: '1024', particlesInFloor: false, gateTransmission: false, cubeEnvironment: 'false', shadows: 'auto', showDiagnostics: 1, surprise: true};
  const normalized = normalizePerformanceSettings(source);
  assert.deepEqual(normalized, {...DEFAULT_PERFORMANCE_SETTINGS, sceneQuality: 'low', floorReflection: '1024', particlesInFloor: false, gateTransmission: false});
  assert.equal(source.cubeEnvironment, 'false');
  for (const raw of [null, false, 7, [], 'low']) assert.deepEqual(normalizePerformanceSettings(raw), DEFAULT_PERFORMANCE_SETTINGS);
  assert.deepEqual(normalizePerformanceSettings(Object.create({shadows: 'off'})), DEFAULT_PERFORMANCE_SETTINGS);
  for (const sceneQuality of ['auto', 'low', 'medium', 'high']) for (const floorReflection of ['auto', 'off', '128', '256', '512', '1024']) {
    assert.deepEqual(normalizePerformanceSettings({sceneQuality, floorReflection}), {...DEFAULT_PERFORMANCE_SETTINGS, sceneQuality, floorReflection});
  }
});

test('load and save round-trip independent settings and tolerate invalid storage', () => {
  const storage = memoryStorage();
  assert.deepEqual(loadPerformanceSettings(storage), DEFAULT_PERFORMANCE_SETTINGS);
  const saved = {...DEFAULT_PERFORMANCE_SETTINGS, sceneQuality: 'low', floorReflection: '1024', cubesInFloor: false, shadows: 'off', showDiagnostics: true};
  assert.equal(savePerformanceSettings({...saved, unsafe: 123}, storage), true);
  assert.deepEqual(loadPerformanceSettings(storage), saved);
  assert.equal(JSON.parse(storage.values.get(PERFORMANCE_STORAGE_KEY)).unsafe, undefined);
  for (const raw of ['{bad JSON', 'null', '[]', '123', '"false"']) {
    storage.values.set(PERFORMANCE_STORAGE_KEY, raw);
    assert.deepEqual(loadPerformanceSettings(storage), DEFAULT_PERFORMANCE_SETTINGS);
  }
  storage.values.set(PERFORMANCE_STORAGE_KEY, '{"floorReflection":"128","sceneQuality":"bad","particlesInFloor":false}');
  assert.deepEqual(loadPerformanceSettings(storage), {...DEFAULT_PERFORMANCE_SETTINGS, floorReflection: '128', particlesInFloor: false});
  const blocked = {getItem() { throw new Error('Denied'); }, setItem() { throw new Error('Quota'); }};
  assert.deepEqual(loadPerformanceSettings(blocked), DEFAULT_PERFORMANCE_SETTINGS);
  assert.equal(savePerformanceSettings(saved, blocked), false);
  assert.equal(savePerformanceSettings(saved, null), false);
  assert.deepEqual(loadPerformanceSettings(null), DEFAULT_PERFORMANCE_SETTINGS);
});

test('localStorage access itself may throw without breaking the module', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, get() { throw new Error('SecurityError'); }});
  try {
    assert.deepEqual(loadPerformanceSettings(), DEFAULT_PERFORMANCE_SETTINGS);
    assert.equal(savePerformanceSettings(DEFAULT_PERFORMANCE_SETTINGS), false);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else delete globalThis.localStorage;
  }
});

test('compact UI keeps shared state, clearly separates choices, and persists only changes', () => {
  const {parent} = documentFixture(), storage = memoryStorage(), settings = loadPerformanceSettings(storage), changes = [];
  const ui = createPerformanceSettingsUI({parent, settings, storage, onChange: (state, key, previous) => changes.push({state, key, previous}), getDiagnostics: () => sample});
  assert.equal(ui.settings, settings);
  assert.equal(parent.children[0], ui.element);
  assert.equal(Object.keys(ui.controls).length, 10);
  assert.match(ui.element.style.cssText, /overflow-y:auto/);
  assert.doesNotMatch(ui.element.style.cssText, /position:fixed|inset:0/);
  const labels = Object.values(ui.controls).map(input => input.attrs['aria-label']);
  assert(labels.includes('Cubes in floor mirror'));
  assert(labels.includes('Environment on cubes'));
  assert(labels.includes('Particles in floor mirror'));
  assert(labels.includes('Environment on debris'));
  assert.deepEqual(ui.controls.floorReflection.children.map(option => option.value), ['auto', 'off', '128', '256', '512', '1024']);
  assert.match(ui.controls.sceneQuality.children.at(-1).textContent, /2\.0736 MP/);
  ui.controls.floorReflection.value = '1024'; ui.controls.floorReflection.dispatch('change');
  ui.controls.sceneQuality.value = 'low'; ui.controls.sceneQuality.dispatch('change');
  ui.controls.cubesInFloor.checked = false; ui.controls.cubesInFloor.dispatch('change');
  assert.equal(changes.length, 3);
  assert.equal(changes[0].state, settings);
  assert.equal(changes[0].key, 'floorReflection');
  assert.equal(changes[0].previous, 'auto');
  assert.deepEqual(loadPerformanceSettings(storage), {...DEFAULT_PERFORMANCE_SETTINGS, sceneQuality: 'low', floorReflection: '1024', cubesInFloor: false});
  assert.equal(ui.element.children[1].textContent, 'Settings saved on this device.');
  assert.equal(settings.cubeEnvironment, true);
  assert.equal(settings.particlesInFloor, true);
  ui.controls.sceneQuality.dispatch('change'); assert.equal(changes.length, 3);
  ui.controls.floorReflection.value = '9999'; ui.controls.floorReflection.dispatch('change');
  assert.equal(settings.floorReflection, '1024'); assert.equal(ui.controls.floorReflection.value, '1024');
  settings.shadows = 'off'; ui.refresh(); assert.equal(ui.controls.shadows.value, 'off');
  assert.equal(ui.element.children.at(-1).textContent, formatPerformanceDiagnostics(sample));
  ui.dispose(); ui.dispose(); ui.refresh();
  assert.equal(parent.children.length, 0);
  ui.controls.cubeEnvironment.checked = false; ui.controls.cubeEnvironment.dispatch('change');
  assert.equal(settings.cubeEnvironment, true);
});

test('UI applies settings even when saving is blocked and diagnostics are missing', () => {
  const {parent} = documentFixture(), settings = {...DEFAULT_PERFORMANCE_SETTINGS};
  const ui = createPerformanceSettingsUI({parent, settings, storage: {setItem() { throw new Error('Denied'); }}, getDiagnostics() { throw new Error('Renderer not ready'); }});
  ui.controls.gateTransmission.checked = false; ui.controls.gateTransmission.dispatch('change');
  assert.equal(settings.gateTransmission, false);
  assert.match(ui.element.children[1].textContent, /storage unavailable/);
  assert.match(ui.element.children.at(-1).textContent, /FPS/);
  ui.dispose();
});

test('UI can load its settings directly from injected storage', () => {
  const {parent} = documentFixture(), storage = memoryStorage();
  savePerformanceSettings({...DEFAULT_PERFORMANCE_SETTINGS, shadows: 'low', showDiagnostics: true}, storage);
  const ui = createPerformanceSettingsUI({parent, storage});
  assert.equal(ui.settings.shadows, 'low');
  assert.equal(ui.controls.showDiagnostics.checked, true);
  ui.dispose();
});

test('diagnostic formatting reports every requested field without NaN or HTML', () => {
  const text = formatPerformanceDiagnostics(sample);
  for (const expected of ['60 FPS', '16.7 ms/frame', 'Simulation 2.13 ms', 'Draws 44', 'Triangles 125000', 'Bodies 120', 'Colliders 456', '1080×1920', 'Floor mirror 512²']) assert(text.includes(expected));
  assert.match(formatPerformanceDiagnostics({frameMs: 20, reflectionResolution: 0}), /50 FPS/);
  assert.match(formatPerformanceDiagnostics({reflectionResolution: 'off'}), /Floor mirror Off/);
  assert.doesNotMatch(formatPerformanceDiagnostics({fps: NaN, frameMs: Infinity, physicsMs: -1, drawCalls: '<img>', width: -1, height: 2}), /NaN|Infinity|<img>|-1/);
  assert.doesNotMatch(formatPerformanceDiagnostics(null), /undefined|null/);
});

test('overlay is opt-in, pointer-transparent, externally updated, and throttled to 4 Hz', () => {
  const {parent} = documentFixture(), settings = {...DEFAULT_PERFORMANCE_SETTINGS};
  let reads = 0;
  const overlay = createPerformanceOverlay({parent, settings, getDiagnostics: () => { reads++; return {...sample, fps: 60 + reads}; }});
  assert.equal(overlay.element.hidden, true);
  assert.match(overlay.element.style.cssText, /pointer-events:none!important/);
  assert.doesNotMatch(overlay.element.style.cssText, /inset:0/);
  assert.equal(overlay.update(0), false); assert.equal(reads, 0);
  settings.showDiagnostics = true;
  assert.equal(overlay.update(0), true); assert.equal(overlay.element.hidden, false);
  for (let now = 1; now < 250; now++) assert.equal(overlay.update(now), false);
  assert.equal(reads, 1); assert.equal(overlay.element.textWrites, 1);
  assert.equal(overlay.update(250), true); assert.equal(reads, 2);
  settings.showDiagnostics = false;
  assert.equal(overlay.update(260), false); assert.equal(overlay.element.hidden, true);
  settings.showDiagnostics = true;
  assert.equal(overlay.update(270), false); assert.equal(overlay.element.hidden, false);
  assert.equal(overlay.update(500, sample), true); assert.equal(reads, 2);
  const writes = overlay.element.textWrites;
  assert.equal(overlay.update(750, sample), true); assert.equal(overlay.element.textWrites, writes);
  assert.equal(overlay.update(NaN), false);
  assert.equal(overlay.update(0, sample), true); // A changed clock origin is safe.
  overlay.dispose(); overlay.dispose();
  assert.equal(parent.children.length, 0);
  assert.equal(overlay.update(1000), false);
});

// Mobile defaults migrate old saved settings without overriding an explicit choice.
test('mobile area-light defaults include desktop-UA iPads and preserve explicit preferences', async () => {
 const {performanceDefaults,isMobileGraphicsDevice}=await import('../src/performance-settings.js');
 const ipad={navigator:{userAgent:'Mozilla Macintosh',platform:'MacIntel',maxTouchPoints:5}};
 assert(isMobileGraphicsDevice(ipad));assert.equal(performanceDefaults(ipad).areaLights,false);
 assert.equal(performanceDefaults({navigator:{platform:'MacIntel',maxTouchPoints:0}}).areaLights,true);
 assert.equal(performanceDefaults({navigator:{userAgent:'Android'}}).areaLights,false);
 assert.equal(performanceDefaults({matchMedia:()=>({matches:true})}).areaLights,false);
 const defaults=performanceDefaults(ipad);
 assert.equal(normalizePerformanceSettings({shadows:'off'},defaults).areaLights,false);
 assert.equal(normalizePerformanceSettings({areaLights:true},defaults).areaLights,true);
 assert.equal(normalizePerformanceSettings({areaLights:false},performanceDefaults({})).areaLights,false);
 assert.equal(normalizePerformanceSettings({areaLights:'true'},defaults).areaLights,false);
});
