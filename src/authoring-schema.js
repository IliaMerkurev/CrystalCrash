/**
 * Portable authoring-preset validation, shared by the editor and game runtime.
 * Positions are absolute in the normalized arena, rotations are radians, and
 * scale is relative to the original object. No Three.js or DOM dependency.
 */
export const SCHEMA_VERSION = 1;
export const PROJECT_ID = 'crystal-crash';
export const MAX_PRESET_BYTES = 250_000;
export const MAX_ARENA_OBJECTS = 250;

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const STABLE_ID = /^[a-zA-Z0-9_.:-]{1,100}$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function invalid(path, message) {
  throw new TypeError(`Invalid preset at ${path}: ${message}`);
}

// Inspect descriptors before reading values. Imported JSON is plain data, and
// programmatic callers must not introduce getters, symbols or hidden fields.
function record(value, path, allowed, required = allowed) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    invalid(path, 'expected an object');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    invalid(path, 'expected a plain object');
  }
  const keys = Reflect.ownKeys(value);
  for (const key of keys) {
    if (typeof key !== 'string' || FORBIDDEN_KEYS.has(key)) {
      invalid(path, 'unsupported or unsafe property');
    }
    if (allowed && !allowed.includes(key)) invalid(`${path}.${key}`, 'unknown property');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      invalid(`${path}.${key}`, 'expected an enumerable data property');
    }
  }
  for (const key of required || []) {
    if (!Object.hasOwn(value, key)) invalid(`${path}.${key}`, 'required property is missing');
  }
  return keys;
}

function array(value, path, length) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length !== length) {
    invalid(path, `expected an array of ${length} values`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1) invalid(path, 'array must not contain holes or extra properties');
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      invalid(`${path}[${index}]`, 'expected an array data value');
    }
  }
  return value;
}

function number(value, path, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    invalid(path, `expected a finite number between ${min} and ${max}`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function vector(value, path, ranges) {
  array(value, path, 3);
  return value.map((component, index) => number(component, `${path}[${index}]`, ...ranges[index]));
}

function material(value, path, glass) {
  const fields = ['color', 'roughness', 'opacity', 'envMapIntensity'];
  if (glass) fields.push('clearcoat');
  record(value, path, fields);
  if (typeof value.color !== 'string' || !HEX_COLOR.test(value.color)) {
    invalid(`${path}.color`, 'expected a six-digit hexadecimal color such as #079dff');
  }
  const result = {
    color: value.color.toLowerCase(),
    roughness: number(value.roughness, `${path}.roughness`, 0, 1),
    opacity: number(value.opacity, `${path}.opacity`, 0, 1),
    envMapIntensity: number(value.envMapIntensity, `${path}.envMapIntensity`, 0, 10),
  };
  if (glass) result.clearcoat = number(value.clearcoat, `${path}.clearcoat`, 0, 1);
  return result;
}

/** Validate and return an independent, canonical plain-data preset. */
export function validatePreset(value) {
  const rootFields = ['schemaVersion', 'projectId', 'arenas', 'materials', 'lighting', 'particles'];
  record(value, 'preset', rootFields, rootFields.filter(key => key !== 'arenas'));
  if (value.schemaVersion !== SCHEMA_VERSION) invalid('preset.schemaVersion', `expected ${SCHEMA_VERSION}`);
  if (value.projectId !== PROJECT_ID) invalid('preset.projectId', `expected "${PROJECT_ID}"`);

  const sourceArenas = Object.hasOwn(value, 'arenas') ? value.arenas : {};
  const arenaKeys = record(sourceArenas, 'preset.arenas', null);
  if (arenaKeys.length > 14) invalid('preset.arenas', 'at most 14 arenas are supported');
  const arenas = {};
  for (const arenaId of arenaKeys.sort((a, b) => Number(a) - Number(b))) {
    if (!/^(?:[1-9]|1[0-4])$/.test(arenaId)) invalid(`preset.arenas.${arenaId}`, 'expected an arena ID from 1 to 14');
    const path = `preset.arenas.${arenaId}`;
    const arena = sourceArenas[arenaId];
    record(arena, path, ['objects']);
    const objectIds = record(arena.objects, `${path}.objects`, null);
    if (objectIds.length > MAX_ARENA_OBJECTS) invalid(`${path}.objects`, `at most ${MAX_ARENA_OBJECTS} objects are supported`);
    const objects = {};
    for (const objectId of objectIds.sort()) {
      if (!STABLE_ID.test(objectId)) invalid(`${path}.objects`, 'object IDs must contain 1–100 letters, digits, underscores, periods, colons or hyphens');
      const objectPath = `${path}.objects.${objectId}`;
      const transform = arena.objects[objectId];
      record(transform, objectPath, ['position', 'rotation', 'scale']);
      objects[objectId] = {
        position: vector(transform.position, `${objectPath}.position`, [[-6, 6], [0, 20], [-6.15, -0.05]]),
        rotation: vector(transform.rotation, `${objectPath}.rotation`, Array(3).fill([-Math.PI, Math.PI])),
        scale: vector(transform.scale, `${objectPath}.scale`, Array(3).fill([0.35, 3])),
      };
    }
    arenas[arenaId] = { objects };
  }

  record(value.materials, 'preset.materials', ['glass', 'floor']);
  array(value.materials.glass, 'preset.materials.glass', 5);
  const materials = {
    glass: value.materials.glass.map((entry, index) => material(entry, `preset.materials.glass[${index}]`, true)),
    floor: material(value.materials.floor, 'preset.materials.floor', false),
  };
  record(value.lighting, 'preset.lighting', ['hemisphere', 'sun', 'fill', 'rails']);
  const lighting = {};
  for (const key of ['hemisphere', 'sun', 'fill', 'rails']) {
    lighting[key] = number(value.lighting[key], `preset.lighting.${key}`, 0, 10);
  }
  record(value.particles, 'preset.particles', ['cloudSize', 'orbitSpread', 'sparkSize', 'intensity']);
  const particles = {};
  for (const key of ['cloudSize', 'orbitSpread', 'sparkSize', 'intensity']) {
    particles[key] = number(value.particles[key], `preset.particles.${key}`, key === 'intensity' ? 0 : 0.25, 3);
  }

  const result = { schemaVersion: SCHEMA_VERSION, projectId: PROJECT_ID, arenas, materials, lighting, particles };
  // All accepted keys and strings are ASCII, so JSON length equals UTF-8 bytes.
  if (JSON.stringify(result).length >= MAX_PRESET_BYTES) {
    invalid('preset', `serialized document must be smaller than ${MAX_PRESET_BYTES} bytes`);
  }
  return result;
}

/** Clone only valid presets, retaining the same trust boundary as imports. */
export function clonePreset(value) {
  return validatePreset(value);
}
