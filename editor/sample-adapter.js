import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

// A second project, with no game imports or physics dependency. The editor UI
// owns history; this adapter owns scene objects, its document schema and input.
const IDS = ['box-a', 'box-b'];
const LIMITS = { position: [-10, 10], rotation: [-Math.PI, Math.PI], scale: [0.2, 5] };
const clone = value => JSON.parse(JSON.stringify(value));

export function createSampleDocument() {
  return {
    schemaVersion: 1,
    projectId: 'editor-sample',
    objects: {
      'box-a': { position: [-1.6, 0.75, 0], rotation: [0, 0.3, 0], scale: [1.5, 1.5, 1.5], color: '#63b9fa' },
      'box-b': { position: [1.5, 0.6, 0.2], rotation: [0, -0.4, 0], scale: [1.2, 1.2, 1.2], color: '#ecb76c' },
    },
  };
}

function exactKeys(value, keys, path) {
  if (!value || Object.prototype.toString.call(value) !== '[object Object]') throw Error(`${path} must be an object.`);
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => !keys.includes(key))) throw Error(`${path} must contain only ${keys.join(', ')}.`);
  if (own.some(key => !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))) throw Error(`${path} must contain plain data.`);
}

/** Closed, versioned schema: validates before mutating scene or document. */
export function validateSampleDocument(input) {
  exactKeys(input, ['schemaVersion', 'projectId', 'objects'], 'Document');
  if (input.schemaVersion !== 1 || input.projectId !== 'editor-sample') throw Error('Expected editor-sample schema version 1.');
  exactKeys(input.objects, IDS, 'objects');
  const output = { schemaVersion: 1, projectId: 'editor-sample', objects: {} };
  for (const id of IDS) {
    const value = input.objects[id];
    exactKeys(value, ['position', 'rotation', 'scale', 'color'], `objects.${id}`);
    const object = {};
    for (const [key, [minimum, maximum]] of Object.entries(LIMITS)) {
      const vector = value[key];
      if (!Array.isArray(vector) || vector.length !== 3 || Reflect.ownKeys(vector).length !== 4 || ![0, 1, 2].every(i => Object.hasOwn(vector, i) && Object.hasOwn(Object.getOwnPropertyDescriptor(vector, i), 'value'))) throw Error(`${id}.${key} must contain exactly three numbers.`);
      object[key] = [0, 1, 2].map(index => {
        const number = vector[index], min = key === 'position' && index === 1 ? 0 : minimum;
        if (typeof number !== 'number' || !Number.isFinite(number) || number < min || number > maximum) throw Error(`${id}.${key}[${index}] must be a finite number from ${min} to ${maximum}.`);
        return number;
      });
    }
    if (typeof value.color !== 'string' || !/^#[\da-f]{6}$/i.test(value.color)) throw Error(`${id}.color must be a six-digit hexadecimal color.`);
    object.color = value.color.toLowerCase();
    output.objects[id] = object;
  }
  return output;
}

export function createSampleEditor(mount = document.body) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#141a28');
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 150);
  camera.position.set(7, 6, 9);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-label', 'Two editable boxes on a floor');
  mount.append(canvas);

  scene.add(new THREE.HemisphereLight(0xe3eeff, 0x333948, 2.5));
  const light = new THREE.DirectionalLight(0xffead4, 4);
  light.position.set(5, 9, 4);
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  Object.assign(light.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, far: 40 });
  light.shadow.camera.updateProjectionMatrix();
  scene.add(light);
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: '#253045', roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.01;
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(20, 20, 0x536581, 0x35445d);
  scene.add(grid);
  const meshes = new Map(IDS.map(id => {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.15 }));
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.editorId = id;
    scene.add(mesh);
    return [id, mesh];
  }));
  const orbit = new OrbitControls(camera, canvas);
  orbit.target.set(0, 0.8, 0);
  orbit.enableDamping = true;
  orbit.minDistance = 1;
  orbit.maxDistance = 50;
  orbit.maxPolarAngle = Math.PI * 0.49;
  orbit.update();
  const gizmo = new TransformControls(camera, canvas);
  const helper = gizmo.getHelper();
  scene.add(helper);
  const listeners = new Set(), transformListeners = new Set();
  let state = validateSampleDocument(createSampleDocument());
  let selected = null, mode = 'edit', disposed = false, drag = null, press = null, frame = 0, playTime = 0, previousTime = 0;
  const notify = event => listeners.forEach(callback => callback(event));

  function syncScene() {
    for (const [id, mesh] of meshes) {
      const object = state.objects[id];
      mesh.position.fromArray(object.position);
      mesh.rotation.set(...object.rotation);
      mesh.scale.fromArray(object.scale);
      mesh.material.color.set(object.color);
      mesh.updateMatrixWorld();
    }
  }
  function attachSelected() {
    gizmo.detach();
    if (mode === 'edit' && meshes.has(selected)) gizmo.attach(meshes.get(selected));
  }
  function select(id) {
    if (id !== null && !meshes.has(id)) throw Error(`Unknown sample object: ${id}`);
    if (drag) cancelDrag();
    selected = id;
    attachSelected();
    notify({ type: 'selection', id });
  }
  function cancelDrag() {
    drag = null;
    gizmo.dragging = false;
    gizmo.axis = null;
    orbit.enabled = mode === 'edit';
    syncScene();
  }
  gizmo.addEventListener('dragging-changed', event => { orbit.enabled = !event.value && mode === 'edit'; });
  gizmo.addEventListener('mouseDown', () => {
    if (mode === 'edit' && selected) drag = { id: selected, before: clone(state) };
    if (press) press.transformed = true;
  });
  gizmo.addEventListener('mouseUp', () => {
    if (!drag || mode !== 'edit') return;
    const { id, before } = drag;
    drag = null;
    const mesh = meshes.get(id), next = clone(state);
    next.objects[id].position = mesh.position.toArray();
    next.objects[id].rotation = [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z];
    next.objects[id].scale = mesh.scale.toArray();
    try {
      state = validateSampleDocument(next);
      syncScene();
      // One transaction per completed gesture; orbiting and no-op drags add none.
      if (JSON.stringify(state) !== JSON.stringify(before)) transformListeners.forEach(callback => callback(clone(state)));
      notify({ type: 'scene' });
    } catch (error) {
      state = before;
      syncScene();
      notify({ type: 'error', message: error.message });
    }
  });

  const ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
  function pointerDown(event) { press = { x: event.clientX, y: event.clientY, transformed: Boolean(gizmo.axis || gizmo.dragging) }; }
  function pointerUp(event) {
    const start = press;
    press = null;
    if (!start || mode !== 'edit' || start.transformed || gizmo.dragging || gizmo.axis || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObjects([...meshes.values()], false)[0];
    select(hit?.object.userData.editorId ?? null);
  }
  function pointerCancel() { press = null; if (drag) cancelDrag(); }
  function pageHide(event) { if (!event.persisted) api.dispose(); }
  // Capture records the gesture before TransformControls handles pointerdown.
  canvas.addEventListener('pointerdown', pointerDown, true);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', pointerCancel);
  window.addEventListener('blur', pointerCancel);

  function fields(id) {
    if (!meshes.has(id)) return [];
    const value = state.objects[id], output = [];
    for (const [key, [minimum, maximum]] of Object.entries(LIMITS)) {
      value[key].forEach((number, index) => output.push({
        path: ['objects', id, key, index], label: `${key[0].toUpperCase()}${key.slice(1)} ${'XYZ'[index]}`,
        type: 'number', value: number, min: key === 'position' && index === 1 ? 0 : minimum, max: maximum, step: 0.01,
      }));
    }
    output.push({ path: ['objects', id, 'color'], label: 'Color', type: 'color', value: value.color });
    return output;
  }
  const api = {
    projectLabel: 'Reusable sample', arenaCount: 1,
    listEntities: () => IDS.map((id, index) => ({ id, label: `Box ${index + 1}`, type: 'Box', transform: true })),
    getObject: id => meshes.get(id),
    readDocument: () => clone(state),
    documentFor(id) { if (id != null && !meshes.has(id)) throw Error(`Unknown sample object: ${id}`); return clone(state); },
    validateDocument: validateSampleDocument,
    applyDocument(value) {
      if (mode !== 'edit') throw Error('Return to Edit before applying a document.');
      const next = validateSampleDocument(value);
      if (drag) cancelDrag();
      state = next;
      syncScene();
      attachSelected();
      notify({ type: 'scene' });
      return clone(state);
    },
    setMode(next) {
      if (next !== 'edit' && next !== 'play') throw Error('Mode must be edit or play.');
      if (drag) cancelDrag();
      mode = next;
      playTime = 0;
      syncScene();
      attachSelected();
      orbit.enabled = mode === 'edit';
      notify({ type: 'mode', mode });
    },
    setArena(number) { if (number !== 1) throw Error('This sample has one scene.'); },
    select, fields,
    setTransformMode(value) {
      if (!['translate', 'rotate', 'scale'].includes(value)) throw Error('Unknown transform mode.');
      if (drag) cancelDrag();
      gizmo.setMode(value);
    },
    focus(id) {
      const mesh = meshes.get(id);
      if (!mesh) return;
      const offset = camera.position.clone().sub(orbit.target).normalize().multiplyScalar(Math.max(4, mesh.scale.length() * 2.5));
      orbit.target.copy(mesh.position);
      camera.position.copy(mesh.position).add(offset);
      orbit.update();
    },
    effects: () => [], previewEffect() {},
    subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback); },
    onTransform(callback) { transformListeners.add(callback); return () => transformListeners.delete(callback); },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('pagehide', pageHide);
      window.removeEventListener('blur', pointerCancel);
      canvas.removeEventListener('pointerdown', pointerDown, true);
      canvas.removeEventListener('pointerup', pointerUp);
      canvas.removeEventListener('pointercancel', pointerCancel);
      gizmo.detach();
      scene.remove(helper);
      gizmo.dispose();
      orbit.dispose();
      geometry.dispose();
      meshes.forEach(mesh => mesh.material.dispose());
      floor.geometry.dispose();
      floor.material.dispose();
      grid.geometry.dispose();
      for (const material of [].concat(grid.material)) material.dispose();
      light.shadow.dispose();
      renderer.dispose();
      canvas.remove();
      listeners.clear();
      transformListeners.clear();
      if (window.crystalEditorAPI === api) delete window.crystalEditorAPI;
    },
  };
  function resize() {
    const width = Math.max(1, mount.clientWidth), height = Math.max(1, mount.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(mount);
  resize();
  syncScene();
  function render(time) {
    if (disposed) return;
    const dt = previousTime ? Math.min((time - previousTime) / 1000, 0.05) : 0;
    previousTime = time;
    if (mode === 'play') {
      playTime += dt;
      IDS.forEach((id, index) => {
        const mesh = meshes.get(id), base = state.objects[id];
        mesh.position.y = base.position[1] + Math.sin(playTime * 2 + index) ** 2 * 0.4;
        mesh.rotation.y = base.rotation[1] + playTime * (index ? -0.45 : 0.45);
      });
    } else orbit.update();
    renderer.render(scene, camera);
    frame = requestAnimationFrame(render);
  }
  frame = requestAnimationFrame(render);
  window.addEventListener('pagehide', pageHide);
  window.crystalEditorAPI = api;
  window.dispatchEvent(new Event('crystal-editor-ready'));
  return api;
}
