// Independent rendering controls. This module has no renderer or animation loop.
export const PERFORMANCE_STORAGE_KEY = 'crystal-crash.performance.v1';
export const SCENE_PIXEL_BUDGETS = Object.freeze({low: 900000, medium: 1400000, high: 2073600});
export const DEFAULT_PERFORMANCE_SETTINGS = Object.freeze({
  sceneQuality: 'auto',
  floorReflection: 'auto',
  cubesInFloor: true,
  cubeEnvironment: true,
  particlesInFloor: true,
  debrisEnvironment: true,
  shadows: 'auto',
  gateTransmission: true,
  areaLights: 'auto',
  fillLighting: true,
  showDiagnostics: false
});
const CHOICES = Object.freeze({
  sceneQuality: Object.freeze(['auto', 'low', 'medium', 'high']),
  floorReflection: Object.freeze(['auto', 'off', '128', '256', '512', '1024']),
  shadows: Object.freeze(['auto', 'contact', 'off', 'low', 'high']),
  areaLights: Object.freeze(['auto', 'off', 'on'])
});
const owns = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

// Desktop-UA iPads still report touch points. Explicit saved values win.
export function isMobileGraphicsDevice(env=globalThis) {
  const nav=env.navigator||{};
  return !!(env.matchMedia?.('(pointer: coarse)')?.matches || /Android|iPhone|iPad|iPod/i.test(nav.userAgent||'') || (/Mac/i.test(nav.platform||nav.userAgent||'') && nav.maxTouchPoints>1));
}
export function performanceDefaults(env=globalThis) {return {...DEFAULT_PERFORMANCE_SETTINGS};}

/** Returns a fresh, known-key-only settings object. Invalid fields use defaults. */
export function normalizePerformanceSettings(value, defaults=performanceDefaults()) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = {...defaults};
  for (const key of Object.keys(result)) {
    if (!owns(source, key)) continue;
    const candidate = key === 'areaLights' && typeof source[key] === 'boolean' ? (source[key] ? 'on' : 'off') : source[key];
    if (CHOICES[key] ? CHOICES[key].includes(candidate) : typeof candidate === 'boolean') result[key] = candidate;
  }
  return result;
}

/** Omit storage for localStorage; pass null to disable persistence. */
export function loadPerformanceSettings(storage) {
  try {
    const target = storage === undefined ? globalThis.localStorage : storage;
    return normalizePerformanceSettings(JSON.parse(target?.getItem(PERFORMANCE_STORAGE_KEY) || 'null'));
  } catch {
    return performanceDefaults();
  }
}

/** Returns false when storage is unavailable/blocked; never interrupts gameplay. */
export function savePerformanceSettings(settings, storage) {
  try {
    const target = storage === undefined ? globalThis.localStorage : storage;
    if (!target || typeof target.setItem !== 'function') return false;
    target.setItem(PERFORMANCE_STORAGE_KEY, JSON.stringify(normalizePerformanceSettings(settings)));
    return true;
  } catch {
    return false;
  }
}

const number = (value, digits = 0) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value.toFixed(digits) : '—';
const size = (width, height) => typeof width === 'number' && width > 0 && typeof height === 'number' && height > 0
  && Number.isFinite(width) && Number.isFinite(height) ? `${Math.round(width)}×${Math.round(height)}` : '—';
/**
 * The diagnostics provider returns {fps, frameMs, physicsMs, drawCalls, triangles,
 * bodies, colliders, width, height, reflectionResolution}. Use 0/'off' for a disabled
 * mirror. fps can be omitted when frameMs is available. Values are never HTML.
 */
export function formatPerformanceDiagnostics(diagnostics = {}) {
  const d = diagnostics && typeof diagnostics === 'object' ? diagnostics : {};
  const fps = Number.isFinite(d.fps) ? d.fps : Number.isFinite(d.frameMs) && d.frameMs > 0 ? 1000 / d.frameMs : undefined;
  const reflection = d.reflectionResolution === 0 || d.reflectionResolution === 'off' ? 'Off'
    : typeof d.reflectionResolution === 'number' && d.reflectionResolution > 0 && Number.isFinite(d.reflectionResolution)
      ? `${Math.round(d.reflectionResolution)}²` : '—';
  return `${d.mode ? d.mode+" · " : ""}${number(fps)} FPS · ${number(d.frameMs, 1)} ms/frame\n`
    + `Simulation ${number(d.physicsMs, 2)} ms · Prepare + submit CPU ${number(d.renderMs, 2)} ms\nDraws ${number(d.drawCalls)} · Triangles ${number(d.triangles)}\n`
    + `Bodies ${number(d.bodies)} · Colliders ${number(d.colliders)}\n`
    + `Render ${size(d.width, d.height)} · Floor mirror ${reflection}`;
}

function readDiagnostics(getDiagnostics) {
  try { return getDiagnostics?.() || {}; } catch { return {}; }
}
function dom(parent, suppliedDocument) {
  const doc = suppliedDocument || parent?.ownerDocument || globalThis.document;
  if (!parent || !doc?.createElement) throw new TypeError('A DOM parent is required.');
  return doc;
}
let instanceId = 0;

/**
 * Mount inside the existing Test card, never on top of it. Mutates the supplied
 * settings object, persists changes, then calls onChange(settings, key, previous).
 * refresh() synchronizes controls/diagnostics after external changes. There are
 * no timers; the existing menu controls opening and gameplay pointer isolation.
 */
export function createPerformanceSettingsUI({parent, settings, onChange, getDiagnostics, storage, document: suppliedDocument} = {}) {
  const doc = dom(parent, suppliedDocument);
  settings ??= loadPerformanceSettings(storage);
  Object.assign(settings, normalizePerformanceSettings(settings));
  const id = `cc-performance-${++instanceId}`;
  const root = doc.createElement('section');
  root.className = 'performance-settings';
  root.setAttribute('aria-label', 'Performance settings');
  root.style.cssText = 'margin:12px 0;padding:12px 0;border-top:1px solid #678ca955;border-bottom:1px solid #678ca955;min-width:0;';
  const heading = doc.createElement('b');
  heading.textContent = 'Performance';
  heading.style.cssText = 'display:block;margin:0 0 5px;font-size:13px;';
  const note = doc.createElement('p');
  note.textContent = 'Choose each setting independently.';
  note.style.cssText = 'margin:0 0 9px;color:#aac0d1;font:11px/1.4 sans-serif;';
  root.append(heading, note);
  const controls = {};
  const handlers = [];
  let disposed = false;
  const groups = {};
  for (const [name, description] of [
    ['Lighting', 'Fill = hemisphere and cool directional light; the key light stays on. Area = extra rail lights, enabled by Auto only after a desktop GPU check. Environment = shine on glass.'],
    ['Shadows', 'Auto uses soft contact shadows while area lights are off, and soft dynamic shadows when on. Choose a manual mode independently of lighting.'],
    ['Graphics', 'Floor mirror reflects objects. Its resolution and object visibility are independent of lighting and shadows.']
  ]) {
    const group = doc.createElement('details');
    group.open = name === 'Graphics';
    group.setAttribute('aria-label', name);
    group.style.cssText = 'margin:10px 0;padding:8px;border:1px solid #678ca944;border-radius:8px;min-width:0;';
    const legend = doc.createElement('summary');
    legend.textContent = name;
    legend.style.cssText = 'padding:5px;min-height:34px;box-sizing:border-box;cursor:pointer;color:#e7f4ff;font:bold 12px/24px sans-serif;';
    const help = doc.createElement('p');
    help.textContent = description;
    help.style.cssText = 'margin:1px 0 6px;color:#aac0d1;font:11px/1.4 sans-serif;';
    group.append(legend, help);
    groups[name] = group;
    root.append(group);
  }
  const fields = [
    ['fillLighting', 'Fill lighting', null, 'Hemisphere ambient fill and cool directional fill. The key light stays on so shadows remain independently controlled.'],
    ['areaLights', 'Area lights', [['auto', 'Auto'], ['off', 'Off'], ['on', 'On']], 'Auto starts off and enables only after a desktop GPU budget check. Phones, tablets, and unavailable GPU timing keep Auto off. Your On or Off choice always wins.'],
    ['sceneQuality', 'Scene resolution', [['auto', 'Auto'], ['low', 'Low · 0.90 MP'], ['medium', 'Medium · 1.40 MP'], ['high', 'High · 2.0736 MP']], 'Pixel budget for the main scene. Auto adapts to the device.'],
    ['floorReflection', 'Floor mirror', [['auto', 'Auto'], ['off', 'Off'], ['128', '128 × 128'], ['256', '256 × 256'], ['512', '512 × 512'], ['1024', '1024 × 1024']], 'Mirror texture resolution. Auto follows scene quality.'],
    ['cubesInFloor', 'Cubes in floor mirror', null, 'Show glass cubes and physical glass pieces in the floor mirror.'],
    ['cubeEnvironment', 'Environment on cubes', null, 'Studio reflections on cube surfaces, separate from the floor mirror.'],
    ['particlesInFloor', 'Particles in floor mirror', null, 'Show glass particles in the floor mirror.'],
    ['debrisEnvironment', 'Environment on debris', null, 'Studio reflections on glass debris and particle surfaces.'],
    ['shadows', 'Shadows', [['auto', 'Auto'], ['contact', 'Soft contact'], ['off', 'Off'], ['low', 'Low · 512'], ['high', 'High · 1024']], 'Auto uses soft contact shadows with area lights off, and soft dynamic shadows with area lights on. Manual choices stay independent.'],
    ['gateTransmission', 'Gate transmission', null, 'Use the glass gate’s see-through transmission effect.'],
    ['showDiagnostics', 'Show FPS / ms in game', null, 'Keep a small, non-interactive performance readout visible during gameplay.']
  ];
  for (const [key, title, choices, description] of fields) {
    const row = doc.createElement('label');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:44px;padding:2px 1px;color:#e7f4ff;font:12px/1.3 sans-serif;';
    row.htmlFor = `${id}-${key}`;
    row.title = description;
    const label = doc.createElement('span');
    label.textContent = title;
    label.style.cssText = 'flex:1;min-width:0;';
    const input = doc.createElement(choices ? 'select' : 'input');
    input.id = row.htmlFor;
    input.name = key;
    input.setAttribute('data-setting', key);
    input.setAttribute('aria-label', title);
    input.title = description;
    if (choices) {
      input.style.cssText = 'width:132px;max-width:48%;min-height:36px;border:1px solid #678ca988;border-radius:6px;padding:4px;background:#1c3043;color:#f3f8ff;font:11px sans-serif;';
      for (const [value, text] of choices) {
        const option = doc.createElement('option');
        option.value = value;
        option.textContent = text;
        input.append(option);
      }
    } else {
      input.type = 'checkbox';
      input.style.cssText = 'flex:none;width:18px;height:18px;margin:5px 2px;accent-color:#91dfff;cursor:pointer;';
    }
    const change = () => {
      if (disposed) return;
      const value = choices ? input.value : input.checked;
      const previous = settings[key];
      if ((choices && !CHOICES[key].includes(value)) || typeof value !== typeof previous) { refresh(); return; }
      if (previous === value) return;
      settings[key] = value;
      note.textContent = savePerformanceSettings(settings, storage)
        ? 'Settings saved on this device.'
        : 'Applied for this session · device storage unavailable.';
      onChange?.(settings, key, previous);
      refresh();
    };
    input.addEventListener('change', change);
    handlers.push([input, change]);
    controls[key] = input;
    row.append(label, input);
    const groupName = key === 'shadows' ? 'Shadows' : ['fillLighting', 'areaLights', 'cubeEnvironment', 'debrisEnvironment'].includes(key) ? 'Lighting' : 'Graphics';
    groups[groupName].append(row);
  }
  const distinction = doc.createElement('p');
  distinction.textContent = 'Floor mirror = reflected objects. Environment = shine on glass surfaces.';
  distinction.style.cssText = 'margin:8px 0;color:#aac0d1;font:10px/1.4 sans-serif;';
  const diagnostics = doc.createElement('output');
  diagnostics.className = 'performance-settings-diagnostics';
  diagnostics.setAttribute('aria-label', 'Current performance');
  diagnostics.setAttribute('aria-live', 'off');
  diagnostics.style.cssText = 'display:block;white-space:pre-wrap;overflow-wrap:anywhere;color:#c6e5f7;font:10px/1.5 ui-monospace,monospace;';
  root.append(distinction, diagnostics);
  parent.append(root);
  function refresh() {
    if (disposed) return;
    const valid = normalizePerformanceSettings(settings);
    for (const [key, input] of Object.entries(controls)) {
      if (CHOICES[key]) input.value = valid[key];
      else input.checked = valid[key];
    }
    diagnostics.textContent = formatPerformanceDiagnostics(readDiagnostics(getDiagnostics));
  }
  refresh();
  return {
    element: root, settings, controls, refresh,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const [input, change] of handlers) input.removeEventListener('change', change);
      root.remove();
    }
  };
}

/**
 * Optional small HUD. Call update(nowMs) from the existing frame loop; both provider
 * reads and DOM text writes run at most 4 Hz. update(nowMs, diagnostics) also accepts
 * an existing sample. settings.showDiagnostics controls visibility immediately.
 * No RAF, timers, focus targets, or pointer listeners are created here.
 */
export function createPerformanceOverlay({parent, settings = DEFAULT_PERFORMANCE_SETTINGS, getDiagnostics, document: suppliedDocument} = {}) {
  const doc = dom(parent, suppliedDocument);
  const element = doc.createElement('output');
  element.className = 'performance-overlay';
  element.setAttribute('aria-label', 'Gameplay performance');
  element.setAttribute('aria-live', 'off');
  element.style.cssText = 'position:fixed;left:max(8px,env(safe-area-inset-left));bottom:max(8px,env(safe-area-inset-bottom));z-index:24;pointer-events:none!important;user-select:none;max-width:calc(100vw - 16px);box-sizing:border-box;padding:6px 8px;border:1px solid #a4dfff44;border-radius:7px;background:#071420d9;color:#dff5ff;white-space:pre-wrap;overflow-wrap:anywhere;font:10px/1.45 ui-monospace,monospace;';
  element.hidden = true;
  parent.append(element);
  let disposed = false, lastUpdate = -Infinity, lastText = '';
  return {
    element,
    update(nowMs = globalThis.performance?.now?.() ?? Date.now(), diagnostics) {
      if (disposed) return false;
      const visible = settings.showDiagnostics === true;
      element.hidden = !visible;
      if (!visible || !Number.isFinite(nowMs)) return false;
      // A clock reset is treated as a new measurement window.
      if (nowMs >= lastUpdate && nowMs - lastUpdate < 250) return false;
      lastUpdate = nowMs;
      const text = formatPerformanceDiagnostics(diagnostics ?? readDiagnostics(getDiagnostics));
      if (text !== lastText) { element.textContent = text; lastText = text; }
      return true;
    },
    dispose() { if (!disposed) { disposed = true; element.remove(); } }
  };
}
