import './style.css';
import { EditorDocument, loadJSONFile, saveJSONFile } from './document.js';

// The UI knows only the bridge contract and document field paths. All game
// objects, selection gizmos, physics, and previews stay in the real game iframe.
const icons = {
  diamond: '<path d="M12 2 3 8l9 14 9-14-9-6Z"/><path d="m3 8 9 2 9-2M12 10v12M8 4.7 12 10l4-5.3"/>',
  cube: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="M3 8v9l9 5 9-5V8M12 13v9"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  import: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
  export: '<path d="M12 16V4m-4 4 4-4 4 4M4 16v5h16v-5"/>',
  save: '<path d="M5 3h12l4 4v14H3V3h2Zm2 0v6h10V3M7 21v-8h10v8"/>',
  undo: '<path d="M8 4 3 9l5 5M3 9h10a7 7 0 0 1 0 14" transform="translate(0 -2)"/>',
  redo: '<path d="m16 4 5 5-5 5M21 9H11a7 7 0 0 0 0 14" transform="translate(0 -2)"/>',
  move: '<path d="M12 2v20M2 12h20m-13-7 3-3 3 3m-6 14 3 3 3-3M5 9l-3 3 3 3m14-6 3 3-3 3"/>',
  rotate: '<path d="M20 7v5h-5M20 12a8 8 0 1 0-2 6"/>',
  scale: '<path d="M14 3h7v7m0-7-9 9M3 9v12h12M3 16l5-5 5 5-5 5"/>',
  focus: '<path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/><circle cx="12" cy="12" r="3"/>',
  play: '<path d="m8 4 13 8-13 8V4Z"/>',
  edit: '<path d="m15 4 5 5M3 21l5-1L21 7l-5-5L3 15v6Z"/>',
  screen: '<rect x="2" y="3" width="20" height="15" rx="2"/><path d="M8 22h8m-4-4v4"/>',
  sparkle: '<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/>',
  light: '<circle cx="12" cy="12" r="4"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4.2 4.2l2.1 2.1m11.4 11.4 2.1 2.1M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="m8 3 1-1h6l1 4 4 2 2 5-3 3-1 4-5 2-3-3-4-1-2-5 3-3 1-7Z"/>',
};
const svg = (name, className = '') => `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.cube}</svg>`;
const sampleScene = new URLSearchParams(location.search).get('scene') === 'sample';
const viewportURL = sampleScene ? '/editor/sample-scene.html' : '/?editor=1';
let projectTitle = sampleScene ? 'Sample Scene' : 'Crystal Crash';
const root = document.getElementById('editor-root');
root.innerHTML = `
  <header class="app-header">
    <div class="brand">${svg('diamond', 'brand-mark')}<div><div id="project-title" class="brand-title">${projectTitle}</div><div class="brand-subtitle">Scene editor</div></div></div>
    <div id="document-state" class="document-state"><span class="state-dot"></span><span id="document-name" class="document-name">Source configuration</span><span id="dirty-label" class="document-state-label">Unchanged</span></div>
    <div class="header-actions">
      <button id="import-button" title="Import a validated editor JSON file">${svg('import')}<span>Import</span></button>
      <button id="export-button" title="Download the current editor document as JSON">${svg('export')}<span>Export JSON</span></button>
      <button id="save-button" class="primary" title="Choose where to save this JSON file">${svg('save')}<span>Save<span class="save-label"> as…</span></span></button>
    </div>
    <input id="import-file" type="file" accept=".json,application/json" hidden>
  </header>
  <nav class="app-toolbar" aria-label="Editor tools">
    <div class="tool-group history-group">
      <button id="undo-button" class="icon-button subtle" title="Undo (Ctrl / ⌘ Z)" aria-label="Undo">${svg('undo')}</button>
      <button id="redo-button" class="icon-button subtle" title="Redo (Ctrl / ⌘ Shift Z)" aria-label="Redo">${svg('redo')}</button>
    </div>
    <div class="toolbar-separator"></div>
    <div class="tool-group transform-group" aria-label="Transform mode">
      <button data-transform="translate" aria-pressed="true" title="Move selected object (W)">${svg('move')}<span>Move</span><kbd>W</kbd></button>
      <button data-transform="rotate" aria-pressed="false" title="Rotate selected object (E)">${svg('rotate')}<span>Rotate</span><kbd>E</kbd></button>
      <button data-transform="scale" aria-pressed="false" title="Scale selected object (R)">${svg('scale')}<span>Scale</span><kbd>R</kbd></button>
    </div>
    <div class="toolbar-separator"></div>
    <button id="focus-button" class="icon-button subtle" title="Focus selected object (F)" aria-label="Focus selected object">${svg('focus')}</button>
    <div class="tool-group mode-group" aria-label="Editor mode">
      <button id="edit-button" aria-pressed="true" title="Edit the paused scene">${svg('edit')}Edit</button>
      <button id="play-button" aria-pressed="false" title="Play the current scene from its initial state">${svg('play')}Play</button>
    </div>
  </nav>
  <main class="workspace">
    <aside class="panel hierarchy-panel" aria-label="Scene hierarchy">
      <div class="panel-heading"><h1>Hierarchy</h1><span id="entity-count" class="small-count">0</span></div>
      <div class="arena-control"><label for="arena-select">Current arena</label><select id="arena-select" disabled></select></div>
      <div class="search-box">${svg('search')}<input id="entity-search" type="search" placeholder="Find an object…" aria-label="Search scene objects" autocomplete="off"></div>
      <div id="hierarchy" class="hierarchy-list" role="list" aria-label="Scene objects"></div>
      <div class="panel-note">Select an object here or in the viewport.<br>Use the gizmo or inspector to edit it.</div>
    </aside>
    <section class="center-panel" aria-label="Live scene viewport">
      <div class="viewport-toolbar"><div class="viewport-title">${svg('screen')}<span>Game viewport</span></div><select id="viewport-preset" aria-label="Viewport aspect ratio"><option value="fit">Fit available space</option><option value="portrait">Portrait · 9:16</option><option value="landscape">Landscape · 16:9</option><option value="square">Square · 1:1</option></select><span id="viewport-size" class="viewport-size">— × —</span></div>
      <div id="viewport-stage" class="viewport-stage">
        <div id="viewport-frame" class="viewport-frame"><iframe id="game-frame" src="${viewportURL}" title="Live editor viewport" allow="autoplay"></iframe></div>
        <div id="viewport-loading" class="viewport-loading">${svg('diamond', 'loading-mark')}<div class="loading-title">Opening the scene</div><div id="loading-description" class="loading-description">Starting the game renderer and physics.</div><button id="reload-button" hidden>Reload viewport</button></div>
      </div>
      <div class="viewport-footer"><span id="mode-description" class="mode-description">Edit mode · simulation paused</span><span class="viewport-help">Drag the bottom-right corner to resize</span></div>
      <div id="effects-bar" class="effects-bar" hidden><label for="effect-select">Effect preview</label><select id="effect-select" aria-label="Effect to preview"></select><button id="effect-button">${svg('sparkle')}Preview effect</button></div>
    </section>
    <aside class="panel inspector-panel" aria-label="Object inspector">
      <div class="panel-heading"><h2>Inspector</h2><span id="property-count" class="small-count">—</span></div>
      <div id="inspector-readonly" class="inspector-readonly" hidden>Play mode is a temporary test. Return to Edit to reset the scene and keep editing.</div>
      <div id="inspector" class="inspector-content"><div class="empty-state">${svg('cube')}<strong>Select an object</strong>Its editable properties will appear here.</div></div>
      <div class="project-note"><strong>Local workflow</strong><br>Changes stay in this session until you export or save JSON. Import the JSON into project source with the project’s import command before publishing.</div>
    </aside>
  </main>
  <footer id="status-bar" class="status-bar" data-tone="busy"><span class="status-led"></span><span id="status-text" class="status-text" role="status" aria-live="polite">Connecting to the game viewport…</span><span class="local-indicator">${svg('lock')}LOCAL SESSION</span></footer>
`;

const $ = id => document.getElementById(id);
const clone = value => typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const humanize = value => String(value || 'Objects').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').replace(/^./, c => c.toUpperCase());
let api = null;
let history = null;
let entities = [];
let selectedId = null;
let mode = 'edit';
let transformMode = 'translate';
let busy = false;
let suggestedName = sampleScene ? 'sample-scene.json' : 'crystal-crash-scene.json';
let bridgeGeneration = 0;
let bridgeCleanup = [];
let refreshPending = false;
const validate = value => clone(api.validateDocument(clone(value)));

function status(message, tone = '') {
  $('status-text').textContent = message;
  $('status-text').title = message;
  $('status-bar').dataset.tone = tone;
}

function updateControls() {
  const ready = Boolean(api && history);
  const editable = ready && !busy && mode === 'edit';
  const selected = entities.find(entity => entity.id === selectedId);
  $('undo-button').disabled = !editable || !history?.canUndo;
  $('redo-button').disabled = !editable || !history?.canRedo;
  $('import-button').disabled = !editable;
  $('export-button').disabled = !ready || busy;
  $('save-button').disabled = !ready || busy;
  $('arena-select').disabled = !editable;
  $('entity-search').disabled = !ready;
  $('focus-button').disabled = !editable || !selected || typeof api?.focus !== 'function';
  $('edit-button').disabled = !ready || busy;
  $('play-button').disabled = !ready || busy;
  $('edit-button').setAttribute('aria-pressed', String(mode === 'edit'));
  $('play-button').setAttribute('aria-pressed', String(mode === 'play'));
  $('play-button').classList.toggle('playing', mode === 'play');
  $('viewport-frame').classList.toggle('playing', mode === 'play');
  $('inspector-readonly').hidden = mode !== 'play';
  $('mode-description').textContent = mode === 'play' ? 'Play mode · test the current scene' : 'Edit mode · simulation paused';
  $('effect-button').disabled = !ready || busy || !$('effect-select').options.length;
  $('effect-select').disabled = !ready || busy;
  for (const button of document.querySelectorAll('[data-transform]')) {
    button.disabled = !editable || !selected?.transform;
    button.setAttribute('aria-pressed', String(button.dataset.transform === transformMode));
  }
  for (const input of $('inspector').querySelectorAll('input')) input.disabled = !editable;
  const dirty = Boolean(history?.dirty);
  $('document-state').classList.toggle('dirty', dirty);
  $('dirty-label').textContent = dirty ? 'Unsaved edits' : 'Unchanged';
  document.title = `${dirty ? '• ' : ''}${projectTitle} · Scene Editor`;
}

async function operation(label, task, successMessage) {
  if (!api || !history || busy) return false;
  busy = true;
  updateControls();
  status(label, 'busy');
  try {
    await task();
    if (successMessage) status(successMessage, 'success');
    return true;
  } catch (error) {
    status(error?.message || String(error), 'error');
    return false;
  } finally {
    busy = false;
    refreshScene(true);
  }
}

async function applyEdit(next, label) {
  if (mode !== 'edit') return false;
  return operation(`Applying ${label.toLowerCase()}…`, async () => {
    const canonical = validate(next);
    if (same(canonical, history.value)) return;
    await api.applyDocument(clone(canonical));
    history.commit(canonical, label);
    if (selectedId) api.select?.(selectedId);
  }, `${label}. Export or save JSON to keep your changes.`);
}

function renderHierarchy() {
  const list = $('hierarchy');
  const openGroups = new Map([...list.querySelectorAll('details')].map(element => [element.dataset.group, element.open]));
  const query = $('entity-search').value.trim().toLowerCase();
  const visible = entities.filter(entity => `${entity.label} ${entity.type} ${entity.id}`.toLowerCase().includes(query));
  $('entity-count').textContent = String(entities.length);
  const groups = new Map();
  for (const entity of visible) {
    const type = entity.type || 'Objects';
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push(entity);
  }
  list.replaceChildren();
  if (!visible.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = query ? 'No matching objects.' : 'Waiting for scene objects…';
    list.append(empty);
  }
  for (const [type, items] of groups) {
    const group = document.createElement('details');
    group.className = 'entity-group';
    group.dataset.group = type;
    group.open = query ? true : (openGroups.get(type) ?? true);
    const summary = document.createElement('summary');
    const label = document.createElement('span');
    label.textContent = humanize(type);
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = String(items.length);
    summary.append(label, count);
    group.append(summary);
    for (const entity of items) {
      const button = document.createElement('button');
      button.className = `entity-button${entity.id === selectedId ? ' selected' : ''}`;
      button.setAttribute('role', 'listitem');
      button.setAttribute('aria-current', String(entity.id === selectedId));
      button.title = `${entity.label} (${entity.id})`;
      button.dataset.entityId = entity.id;
      button.innerHTML = svg(entity.icon || (/light/i.test(entity.type) ? 'light' : entity.transform ? 'cube' : 'settings'));
      const name = document.createElement('span');
      name.className = 'entity-label';
      name.textContent = entity.label || entity.id;
      button.append(name);
      button.addEventListener('click', () => selectEntity(entity.id));
      button.addEventListener('dblclick', () => focusSelection());
      group.append(button);
    }
    list.append(group);
  }
}

function selectEntity(id, fromBridge = false) {
  if (!api || busy || mode !== 'edit') return;
  selectedId = entities.some(entity => entity.id === id) ? id : null;
  if (!fromBridge) {
    try { api.select?.(selectedId); }
    catch (error) { status(error.message || String(error), 'error'); }
  }
  renderHierarchy();
  renderInspector(true);
  updateControls();
}

function colorHex(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return `#${Math.max(0, Math.min(0xffffff, value)).toString(16).padStart(6, '0')}`;
  const text = String(value || '');
  if (/^#[\da-f]{6}$/i.test(text)) return text;
  if (/^#[\da-f]{3}$/i.test(text)) return `#${[...text.slice(1)].map(char => char + char).join('')}`;
  return '#ffffff';
}

function setPath(documentValue, path, value) {
  if (!Array.isArray(path) || !path.length) throw new Error('This property has no valid document path.');
  let parent = documentValue;
  for (let index = 0; index < path.length; index++) {
    const key = path[index];
    if ((typeof key !== 'string' && !Number.isInteger(key)) || ['__proto__', 'prototype', 'constructor'].includes(String(key))) throw new Error('The property path is not allowed.');
    if (index === path.length - 1) parent[key] = value;
    else {
      if (parent[key] === null || typeof parent[key] !== 'object') throw new Error('The property no longer exists in this document.');
      parent = parent[key];
    }
  }
}

async function commitField(field, value) {
  if (busy || mode !== 'edit') return;
  if (field.type === 'number') {
    if (!Number.isFinite(value)) { status(`${field.label}: enter a finite number.`, 'error'); renderInspector(true); return; }
    if ((Number.isFinite(field.min) && value < field.min) || (Number.isFinite(field.max) && value > field.max)) {
      status(`${field.label}: use a value${Number.isFinite(field.min) ? ` of at least ${field.min}` : ''}${Number.isFinite(field.max) ? ` and at most ${field.max}` : ''}.`, 'error');
      renderInspector(true);
      return;
    }
  }
  try {
    const next = typeof api.documentFor === 'function' ? clone(api.documentFor(selectedId)) : history.value;
    setPath(next, field.path, value);
    await applyEdit(next, `Changed ${field.label.toLowerCase()}`);
  } catch (error) {
    status(error.message || String(error), 'error');
    renderInspector(true);
  }
}

function fieldGroup(field) {
  if (field.group || field.section) return String(field.group || field.section);
  const tokens = (field.path || []).map(String);
  if (tokens.some(token => /^(position|rotation|scale)$/i.test(token))) return 'Transform';
  return 'Properties';
}

function renderInspector(force = false) {
  const inspector = $('inspector');
  if (!force && inspector.contains(document.activeElement)) return;
  const selected = entities.find(entity => entity.id === selectedId);
  const openGroups = new Map([...inspector.querySelectorAll('details')].map(element => [element.dataset.group, element.open]));
  inspector.replaceChildren();
  $('property-count').textContent = '—';
  if (!selected) {
    inspector.innerHTML = `<div class="empty-state">${svg('cube')}<strong>Select an object</strong>Choose an object in the hierarchy or viewport to inspect its properties.</div>`;
    return;
  }
  const heading = document.createElement('div');
  heading.className = 'selection-heading';
  heading.innerHTML = `<div class="selection-icon">${svg(selected.transform ? 'cube' : 'settings')}</div>`;
  const title = document.createElement('div');
  title.className = 'selection-title';
  const name = document.createElement('strong');
  name.textContent = selected.label || selected.id;
  const type = document.createElement('small');
  type.textContent = humanize(selected.type);
  title.append(name, type);
  heading.append(title);
  inspector.append(heading);
  let fields;
  try { fields = api.fields?.(selectedId) || []; }
  catch (error) { status(error.message || String(error), 'error'); fields = []; }
  $('property-count').textContent = String(fields.length);
  if (!fields.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'This object has no editable properties.';
    inspector.append(empty);
    return;
  }
  const groups = new Map();
  for (const field of fields) {
    const group = fieldGroup(field);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(field);
  }
  let fieldIndex = 0;
  for (const [groupName, groupFields] of groups) {
    const group = document.createElement('details');
    group.className = 'field-section';
    group.dataset.group = groupName;
    group.open = openGroups.get(groupName) ?? true;
    const summary = document.createElement('summary');
    summary.textContent = humanize(groupName);
    group.append(summary);
    for (const field of groupFields) {
      const row = document.createElement('div');
      row.className = 'field-row';
      const label = document.createElement('label');
      label.className = 'field-label';
      const id = `property-${fieldIndex++}`;
      label.htmlFor = id;
      label.textContent = field.label || humanize(field.path?.at(-1));
      row.append(label);
      if (field.type === 'color') {
        const control = document.createElement('div');
        control.className = 'color-control';
        const input = document.createElement('input');
        input.id = id;
        input.type = 'color';
        input.value = colorHex(field.value);
        input.title = field.label;
        const hex = document.createElement('input');
        hex.type = 'text';
        hex.maxLength = 7;
        hex.value = input.value;
        hex.setAttribute('aria-label', `${field.label} hexadecimal value`);
        const commitColor = text => {
          if (!/^#[\da-f]{6}$/i.test(text)) { status(`${field.label}: enter a color like #B8D8FF.`, 'error'); renderInspector(true); return; }
          commitField(field, typeof field.value === 'number' ? parseInt(text.slice(1), 16) : text);
        };
        input.addEventListener('input', () => { hex.value = input.value; });
        input.addEventListener('change', () => commitColor(input.value));
        hex.addEventListener('change', () => commitColor(hex.value.trim()));
        control.append(input, hex);
        row.append(control);
      } else if (field.type === 'number') {
        const input = document.createElement('input');
        input.id = id;
        input.type = 'number';
        input.value = String(field.value ?? 0);
        input.step = String(field.step ?? 'any');
        if (Number.isFinite(field.min)) input.min = String(field.min);
        if (Number.isFinite(field.max)) input.max = String(field.max);
        input.addEventListener('change', () => commitField(field, input.value.trim() === '' ? NaN : Number(input.value)));
        row.append(input);
      } else {
        const value = document.createElement('span');
        value.textContent = String(field.value ?? '');
        row.append(value);
      }
      if (field.description) {
        const hint = document.createElement('div');
        hint.className = 'field-hint';
        hint.textContent = field.description;
        row.append(hint);
      }
      group.append(row);
    }
    inspector.append(group);
  }
  updateControls();
}

function refreshScene(forceInspector = false) {
  if (!api) return;
  try {
    entities = api.listEntities() || [];
    if (!entities.some(entity => entity.id === selectedId)) selectedId = null;
    renderHierarchy();
    renderInspector(forceInspector);
    updateControls();
  } catch (error) { status(error.message || String(error), 'error'); }
}

function bridgeNotification(event) {
  if (event?.type === 'error') status(event.message || 'The scene could not apply that edit.', 'error');
  if (event?.type === 'selection' || Object.hasOwn(event || {}, 'selectedId')) {
    selectEntity(event.selectedId ?? event.id ?? null, true);
  }
  if (Number.isInteger(event?.arena) && event.arena >= 1 && event.arena <= Number(api?.arenaCount || 1)) $('arena-select').value = String(event.arena);
  if (event?.mode === 'edit' || event?.mode === 'play') mode = event.mode;
  if (refreshPending || busy) return;
  refreshPending = true;
  requestAnimationFrame(() => { refreshPending = false; refreshScene(); });
}

async function undoRedo(direction) {
  if (mode !== 'edit' || !(direction === 'undo' ? history?.canUndo : history?.canRedo)) return;
  await operation(direction === 'undo' ? 'Undoing edit…' : 'Redoing edit…', async () => {
    const changed = history[direction]();
    if (!changed) return;
    try { await api.applyDocument(history.value); }
    catch (error) { history[direction === 'undo' ? 'redo' : 'undo'](); throw error; }
    if (selectedId) api.select?.(selectedId);
  }, direction === 'undo' ? 'Edit undone.' : 'Edit restored.');
}

function setTransformMode(value) {
  if (!api || busy || mode !== 'edit') return;
  transformMode = value;
  try { api.setTransformMode?.(value); updateControls(); }
  catch (error) { status(error.message || String(error), 'error'); }
}

function focusSelection() {
  if (!api || !selectedId || busy || mode !== 'edit') return;
  try { api.focus?.(selectedId); }
  catch (error) { status(error.message || String(error), 'error'); }
}

async function setMode(next) {
  if (next === mode) return;
  await operation(next === 'play' ? 'Starting play test…' : 'Returning to edit mode…', async () => {
    await api.setMode(next);
    mode = next;
    if (next === 'edit' && selectedId) api.select?.(selectedId);
  }, next === 'play' ? 'Play test started. Return to Edit to reset simulation.' : 'Scene reset. Your edits are preserved.');
}

function exportJSON(message = 'JSON download started. Import the file into project source before publishing.') {
  if (!history || busy) return;
  try {
    const data = JSON.stringify(history.value, null, 2) + '\n';
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = suggestedName;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    // A download can be cancelled outside the page; only a confirmed file
    // handle write clears the unsaved indicator.
    status(message, 'success');
    updateControls();
  } catch (error) { status(error.message || String(error), 'error'); }
}

async function saveAs() {
  if (!history || busy) return;
  if (typeof window.showSaveFilePicker !== 'function') {
    exportJSON('This browser has no save-file picker. JSON download started instead.');
    return;
  }
  // The picker must be called directly from a user gesture, before any await.
  let picker;
  try {
    picker = window.showSaveFilePicker({ suggestedName, types: [{ description: 'Editor scene JSON', accept: { 'application/json': ['.json'] } }] });
  } catch (error) { status(error.message || String(error), 'error'); return; }
  await operation('Choosing a file…', async () => {
    let handle;
    try { handle = await picker; }
    catch (error) { if (error.name === 'AbortError') { status('Save cancelled.'); return; } throw error; }
    status('Saving JSON…', 'busy');
    await saveJSONFile(history.value, { handle, suggestedName });
    history.markSaved();
    suggestedName = handle.name || suggestedName;
    $('document-name').textContent = suggestedName;
    $('document-name').title = suggestedName;
    status('JSON saved. Import it into project source before publishing.', 'success');
  });
}

function resizeViewport() {
  const stage = $('viewport-stage');
  const frame = $('viewport-frame');
  const css = getComputedStyle(stage);
  const width = Math.max(150, stage.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight));
  const height = Math.max(180, stage.clientHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom));
  const ratios = { portrait: 9 / 16, landscape: 16 / 9, square: 1 };
  const ratio = ratios[$('viewport-preset').value];
  const fittedWidth = ratio ? Math.min(width, height * ratio) : width;
  const fittedHeight = ratio ? Math.min(height, width / ratio) : height;
  frame.style.width = `${Math.round(fittedWidth)}px`;
  frame.style.height = `${Math.round(fittedHeight)}px`;
}

function renderArenaSelector() {
  const select = $('arena-select');
  const count = Math.max(1, Math.min(1000, Number(api.arenaCount) || 1));
  const previous = Number(select.value) || 1;
  select.replaceChildren();
  for (let arena = 1; arena <= count; arena++) {
    const option = document.createElement('option');
    option.value = String(arena);
    option.textContent = `Arena ${String(arena).padStart(2, '0')}`;
    select.append(option);
  }
  select.value = String(Math.min(previous, count));
  select.closest('.arena-control').hidden = count <= 1;
}

function renderEffects() {
  const effects = typeof api.effects === 'function' ? api.effects() : [];
  $('effects-bar').hidden = !effects?.length;
  $('effect-select').replaceChildren();
  for (const effect of effects || []) {
    const option = document.createElement('option');
    option.value = effect.id;
    option.textContent = effect.label || humanize(effect.id);
    $('effect-select').append(option);
  }
  resizeViewport();
}

function cleanBridge() {
  for (const unsubscribe of bridgeCleanup) {
    try { unsubscribe?.(); } catch { /* A reloaded iframe may already be gone. */ }
  }
  bridgeCleanup = [];
}

async function connectBridge() {
  const generation = ++bridgeGeneration;
  cleanBridge();
  api = null;
  updateControls();
  $('viewport-loading').hidden = false;
  $('reload-button').hidden = true;
  $('loading-description').textContent = 'Starting the game renderer and physics.';
  const startedAt = performance.now();
  while (generation === bridgeGeneration) {
    let candidate;
    try {
      const frameWindow = $('game-frame').contentWindow;
      candidate = frameWindow?.crystalEditorAPI;
      if (!candidate && frameWindow?.crystalEditorError) {
        const error = frameWindow.crystalEditorError;
        $('loading-description').textContent = error.message || String(error);
        $('reload-button').hidden = false;
        status(`The scene could not start: ${error.message || error}`, 'error');
        return;
      }
    }
    catch (error) { status(`The editor requires a same-origin game viewport: ${error.message}`, 'error'); return; }
    if (candidate && typeof candidate.readDocument === 'function') {
      try {
        api = candidate;
        const initial = validate(api.readDocument());
        if (generation !== bridgeGeneration) return;
        if (history) {
          await api.applyDocument(history.value);
          status('Viewport reconnected. Session edits were restored.', 'success');
        } else {
          history = new EditorDocument(initial, validate);
          history.markSaved();
          status('Ready. Select an object to start editing.', 'success');
        }
        projectTitle = humanize(api.projectLabel || projectTitle);
        $('project-title').textContent = projectTitle;
        renderArenaSelector();
        bridgeCleanup.push(history.subscribe(() => updateControls()));
        await api.setMode('edit');
        mode = 'edit';
        api.setTransformMode?.(transformMode);
        if (typeof api.subscribe === 'function') bridgeCleanup.push(api.subscribe(bridgeNotification));
        if (typeof api.onTransform === 'function') bridgeCleanup.push(api.onTransform(value => {
          if (busy || mode !== 'edit' || !history) return;
          try {
            const canonical = validate(value || api.readDocument());
            history.commit(canonical, `${humanize(transformMode)} object`);
            refreshScene(true);
            status('Object transform updated. Undo restores the whole drag.', 'success');
          } catch (error) { status(error.message || String(error), 'error'); }
        }));
        $('viewport-loading').hidden = true;
        renderEffects();
        refreshScene(true);
        // Keyboard events stay inside an iframe. Listen there too, without
        // touching game input or editable form fields.
        const frameDocument = $('game-frame').contentDocument;
        frameDocument?.addEventListener('keydown', keyboard);
        bridgeCleanup.push(() => frameDocument?.removeEventListener('keydown', keyboard));
        return;
      } catch (error) {
        api = null;
        $('loading-description').textContent = error.message || String(error);
        $('reload-button').hidden = false;
        status(`Could not open the editor: ${error.message || error}`, 'error');
        updateControls();
        return;
      }
    }
    const elapsed = performance.now() - startedAt;
    if (elapsed > 12000) $('loading-description').textContent = 'The renderer is still starting. This may take longer on the first run.';
    if (elapsed > 45000) {
      $('loading-description').textContent = 'The game has not connected yet. You can reload the viewport or check the browser console for a startup error.';
      $('reload-button').hidden = false;
    }
    await new Promise(resolve => setTimeout(resolve, 120));
  }
}

function keyboard(event) {
  const target = event.target;
  if (target?.closest?.('input,textarea,select,[contenteditable="true"]') || event.defaultPrevented) return;
  const key = event.key.toLowerCase();
  const modifier = event.ctrlKey || event.metaKey;
  if (modifier && key === 's') { event.preventDefault(); saveAs(); return; }
  if (modifier && key === 'z') { event.preventDefault(); undoRedo(event.shiftKey ? 'redo' : 'undo'); return; }
  if (modifier && key === 'y') { event.preventDefault(); undoRedo('redo'); return; }
  if (modifier || event.altKey || mode !== 'edit') return;
  if (['w', 'e', 'r'].includes(key)) { event.preventDefault(); setTransformMode({ w: 'translate', e: 'rotate', r: 'scale' }[key]); }
  if (key === 'f') { event.preventDefault(); focusSelection(); }
}

$('import-button').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file || busy || mode !== 'edit') return;
  if (file.size > 250_000) { status('This JSON file exceeds the 250 KB import limit.', 'error'); return; }
  await operation('Importing JSON…', async () => {
    const imported = await loadJSONFile(file, validate);
    await api.applyDocument(clone(imported));
    history.commit(imported, `Import ${file.name}`);
    suggestedName = file.name.endsWith('.json') ? file.name : `${file.name}.json`;
    $('document-name').textContent = suggestedName;
    $('document-name').title = suggestedName;
    if (selectedId) api.select?.(selectedId);
  }, 'JSON imported. You can undo the import.');
});
$('export-button').addEventListener('click', () => exportJSON());
$('save-button').addEventListener('click', saveAs);
$('undo-button').addEventListener('click', () => undoRedo('undo'));
$('redo-button').addEventListener('click', () => undoRedo('redo'));
$('entity-search').addEventListener('input', renderHierarchy);
$('focus-button').addEventListener('click', focusSelection);
$('edit-button').addEventListener('click', () => setMode('edit'));
$('play-button').addEventListener('click', () => setMode('play'));
for (const button of document.querySelectorAll('[data-transform]')) button.addEventListener('click', () => setTransformMode(button.dataset.transform));
$('arena-select').addEventListener('change', async event => {
  const arena = Number(event.target.value);
  await operation(`Opening arena ${arena}…`, async () => {
    await api.setArena(arena);
    const next = validate(api.readDocument());
    if (!same(next, history.value)) history.commit(next, `Switch to arena ${arena}`);
    selectedId = null;
    api.select?.(null);
  }, `Arena ${String(arena).padStart(2, '0')} is ready to edit.`);
});
$('effect-button').addEventListener('click', async () => {
  const select = $('effect-select');
  await operation('Previewing effect…', async () => { await api.previewEffect(select.value); }, `Previewing ${select.selectedOptions[0]?.textContent || 'effect'}.`);
});
$('viewport-preset').addEventListener('change', resizeViewport);
$('reload-button').addEventListener('click', () => { $('game-frame').contentWindow?.location.reload(); });
$('game-frame').addEventListener('load', connectBridge);
$('game-frame').addEventListener('error', () => { status('The game viewport could not load.', 'error'); $('reload-button').hidden = false; });
window.addEventListener('keydown', keyboard);
window.addEventListener('beforeunload', event => {
  if (history?.dirty) { event.preventDefault(); event.returnValue = ''; }
});
new ResizeObserver(resizeViewport).observe($('viewport-stage'));
new ResizeObserver(() => {
  const frame = $('game-frame');
  $('viewport-size').textContent = `${frame.clientWidth} × ${frame.clientHeight}`;
}).observe($('viewport-frame'));
updateControls();
resizeViewport();
connectBridge();
