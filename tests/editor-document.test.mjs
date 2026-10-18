import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorDocument, loadJSONFile, saveJSONFile } from '../editor/document.js';

function validate(value) {
  if (!value || typeof value.n !== 'number' || !Number.isFinite(value.n) || value.n < 0) throw new Error('Invalid document');
  return { n: value.n, nested: { items: [...(value.nested?.items ?? [])] } };
}
const state = n => ({ n, nested: { items: [n] } });

test('constructor, reads, commits, and validator outputs have independent ownership', () => {
  const initial = state(0);
  let retained;
  const doc = new EditorDocument(initial, value => { retained = value; return validate(value); });
  initial.n = 9;
  initial.nested.items.push(9);
  retained.n = 8;
  const read = doc.value;
  read.n = 7;
  read.nested.items.push(7);
  assert.deepEqual(doc.value, state(0));
  const next = state(1);
  assert.equal(doc.commit(next), true);
  next.nested.items.push(9);
  retained.nested.items.push(8);
  assert.deepEqual(doc.value, state(1));
  doc.undo();
  assert.deepEqual(doc.value, state(0));
  const shared = state(3);
  const sharedDoc = new EditorDocument({}, () => shared);
  shared.nested.items.push(4);
  assert.deepEqual(sharedDoc.value, state(3));
});

test('invalid commits and imports never change current state, history, or saved state', () => {
  const doc = new EditorDocument(state(0), validate);
  doc.commit(state(1));
  doc.undo();
  for (const bad of [{ n: -1 }, { n: NaN }, { n: Infinity }, { n: 3n }, undefined]) {
    assert.throws(() => doc.commit(bad));
    assert.deepEqual(doc.value, state(0));
    assert.equal(doc.canUndo, false);
    assert.equal(doc.canRedo, true);
    assert.equal(doc.dirty, false);
  }
  const cycle = { n: 2 }; cycle.loop = cycle;
  assert.throws(() => doc.replace(cycle));
  assert.throws(() => doc.replace({ n: -2 }));
  assert.equal(doc.canRedo, true);
  assert.equal(doc.redo(), true);
  assert.deepEqual(doc.value, state(1));
});

test('canonical JSON equality suppresses redundant history and preserves redo', () => {
  const doc = new EditorDocument(state(0), validate);
  assert.equal(doc.commit({ ...state(0), ignored: true }), false);
  assert.equal(doc.canUndo, false);
  doc.commit(state(1)); doc.undo();
  assert.equal(doc.commit(state(0)), false);
  assert.equal(doc.canRedo, true);
});

test('undo, redo, branching, and saved-snapshot dirty tracking', () => {
  const doc = new EditorDocument(state(0), validate);
  assert.equal(doc.undo(), false);
  assert.equal(doc.redo(), false);
  assert.equal(doc.markSaved(), false);
  doc.commit(state(1), 'Move');
  assert.equal(doc.dirty, true);
  assert.equal(doc.markSaved(), true);
  assert.equal(doc.dirty, false);
  doc.undo(); assert.equal(doc.dirty, true);
  doc.redo(); assert.equal(doc.dirty, false);
  doc.commit(state(2));
  doc.undo(); assert.equal(doc.dirty, false);
  doc.commit(state(3));
  assert.equal(doc.canRedo, false);
  assert.equal(doc.redo(), false);
});

test('replace validates and is undoable', () => {
  const doc = new EditorDocument(state(0), validate);
  const events = [];
  doc.subscribe((_value, event) => events.push(event));
  assert.equal(doc.replace(state(4)), true);
  assert.equal(doc.dirty, true);
  assert.equal(events[0].label, 'Import document');
  doc.undo(); assert.deepEqual(doc.value, state(0));
  doc.redo(); assert.deepEqual(doc.value, state(4));
});

test('history is bounded to 100 undo steps', () => {
  const doc = new EditorDocument(state(0), validate);
  for (let n = 1; n <= 105; n++) doc.commit(state(n));
  let undos = 0; while (doc.undo()) undos++;
  assert.equal(undos, 100);
  assert.equal(doc.value.n, 5);
  let redos = 0; while (doc.redo()) redos++;
  assert.equal(redos, 100);
  assert.equal(doc.value.n, 105);
  let again = 0; while (doc.undo()) again++;
  assert.equal(again, 100);
});

test('subscriptions are explicit, independently cloned, labeled, and removable', () => {
  const doc = new EditorDocument(state(0), validate);
  const events = [];
  const unsubscribe = doc.subscribe((value, event) => {
    events.push([event.type, event.label, value.n]);
    assert.equal(event.document, doc);
    value.n = 999;
  });
  const secondValues = [];
  doc.subscribe(value => secondValues.push(value.n));
  assert.equal(events.length, 0);
  doc.commit(state(1), 'Move block');
  doc.undo(); doc.redo(); doc.markSaved();
  assert.deepEqual(events, [
    ['commit', 'Move block', 1], ['undo', 'Move block', 0],
    ['redo', 'Move block', 1], ['saved', 'Save document', 1],
  ]);
  assert.deepEqual(secondValues, [1, 0, 1, 1]);
  unsubscribe(); unsubscribe(); doc.commit(state(2));
  assert.equal(events.length, 4);
  assert.throws(() => doc.subscribe(null), TypeError);
});

test('file loading supports BOM, validates, and exposes malformed/read errors', async () => {
  const file = new Blob(['\uFEFF{"n":2,"nested":{"items":[2]},"ignored":true}']);
  assert.deepEqual(await loadJSONFile(file, validate), state(2));
  await assert.rejects(loadJSONFile(new Blob(['{']), validate), SyntaxError);
  await assert.rejects(loadJSONFile(new Blob(['{"n":-1}']), validate), /Invalid/);
  await assert.rejects(loadJSONFile(null, validate), TypeError);
  const failure = new Error('Read denied');
  await assert.rejects(loadJSONFile({ text: async () => { throw failure; } }, validate), error => error === failure);
});

function withGlobals(changes, callback) {
  const previous = new Map(Object.keys(changes).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(changes)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  return Promise.resolve().then(callback).finally(() => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
}

function fakeHandle() {
  const events = [];
  return {
    events,
    createWritable: async () => ({
      write: async data => { events.push(['write', data]); },
      close: async () => { events.push(['close']); },
      abort: async () => { events.push(['abort']); },
    }),
  };
}

test('existing file handles save formatted JSON without opening a picker', async () => {
  const handle = fakeHandle();
  await withGlobals({ showSaveFilePicker: () => { throw new Error('Must not open'); } }, async () => {
    assert.equal(await saveJSONFile(state(2), { handle }), handle);
  });
  assert.deepEqual(handle.events, [['write', JSON.stringify(state(2), null, 2) + '\n'], ['close']]);
});

test('Save As uses explicit picker and safe JSON names', async () => {
  const handle = fakeHandle();
  let options;
  await withGlobals({ showSaveFilePicker: async value => { options = value; return handle; } }, async () => {
    assert.equal(await saveJSONFile(state(1), { suggestedName: '../../CON.json' }), handle);
    assert.equal(options.suggestedName, '_CON.json');
    assert.deepEqual(options.types[0].accept, { 'application/json': ['.json'] });
    await saveJSONFile({}, { suggestedName: 'bad<>:\u0000*.json' });
    assert.equal(options.suggestedName, 'bad-----.json');
    await saveJSONFile({}, { suggestedName: '...' });
    assert.equal(options.suggestedName, 'document.json');
  });
});

test('picker cancellation is harmless; security failures never silently download', async () => {
  let downloads = 0;
  const document = { body: {}, createElement: () => { downloads++; } };
  await withGlobals({ document, showSaveFilePicker: async () => { throw new DOMException('Cancel', 'AbortError'); } }, async () => {
    assert.equal(await saveJSONFile({}), null);
    assert.equal(downloads, 0);
  });
  const denied = new DOMException('Permission denied', 'SecurityError');
  await withGlobals({ document, showSaveFilePicker: async () => { throw denied; } }, async () => {
    await assert.rejects(saveJSONFile({}), error => error === denied);
    assert.equal(downloads, 0);
  });
});

test('write and close failures propagate and attempt to abandon partial writes', async () => {
  for (const stage of ['write', 'close']) {
    const events = [];
    const failure = new DOMException('I/O abort', 'AbortError');
    const handle = { createWritable: async () => ({
      write: async () => { events.push('write'); if (stage === 'write') throw failure; },
      close: async () => { events.push('close'); if (stage === 'close') throw failure; },
      abort: async () => { events.push('abort'); },
    }) };
    await assert.rejects(saveJSONFile({}, { handle }), error => error === failure);
    assert.equal(events.at(-1), 'abort');
  }
});

test('fallback downloads a JSON Blob and cleans up link and object URL', async () => {
  const events = [];
  let savedBlob;
  const link = { click: () => events.push('click'), remove: () => events.push('remove') };
  const document = {
    body: { appendChild: actual => { assert.equal(actual, link); events.push('append'); } },
    createElement: tag => { assert.equal(tag, 'a'); return link; },
  };
  const URL = {
    createObjectURL: blob => { savedBlob = blob; return 'blob:local-document'; },
    revokeObjectURL: url => { assert.equal(url, 'blob:local-document'); events.push('revoke'); },
  };
  await withGlobals({ showSaveFilePicker: undefined, document, URL, setTimeout: callback => { callback(); } }, async () => {
    assert.equal(await saveJSONFile(state(3), { suggestedName: '../level.json' }), null);
    assert.equal(link.download, 'level.json');
    assert.equal(link.href, 'blob:local-document');
    assert.equal(link.hidden, true);
    assert.equal(savedBlob.type, 'application/json;charset=utf-8');
    assert.deepEqual(JSON.parse(await savedBlob.text()), state(3));
    assert.deepEqual(events, ['append', 'click', 'remove', 'revoke']);
  });
});

test('fallback failure cleans resources and unsupported browsers reject', async () => {
  let revoked = false;
  const failure = new Error('Download failed');
  const link = { click: () => { throw failure; }, remove: () => {} };
  await withGlobals({
    showSaveFilePicker: undefined,
    document: { body: { appendChild() {} }, createElement: () => link },
    URL: { createObjectURL: () => 'blob:local', revokeObjectURL: () => { revoked = true; } },
    setTimeout: callback => { callback(); },
  }, async () => {
    await assert.rejects(saveJSONFile({}), error => error === failure);
    assert.equal(revoked, true);
  });
  await withGlobals({ showSaveFilePicker: undefined, document: undefined }, async () => {
    await assert.rejects(saveJSONFile({}), /cannot save/);
  });
});
