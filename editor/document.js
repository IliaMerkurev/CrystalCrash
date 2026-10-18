const HISTORY_LIMIT = 100;

// Reject values that JSON would silently discard or convert to null. All stored
// snapshots are strings, so callers and validators cannot mutate history.
function serializeJSON(value) {
  return JSON.stringify(value, (_key, entry) => {
    const type = typeof entry;
    if (entry === undefined || type === 'function' || type === 'symbol' || type === 'bigint') {
      throw new TypeError('The document must contain only JSON values.');
    }
    if (type === 'number' && !Number.isFinite(entry)) {
      throw new TypeError('The document must contain only finite numbers.');
    }
    if (entry !== null && type === 'object' && !Array.isArray(entry)) {
      const prototype = Object.getPrototypeOf(entry);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError('The document must contain only plain JSON objects.');
      }
    }
    return entry;
  });
}

function validatedSnapshot(value, validate) {
  // A validator may normalize its argument in place, but never owns the input.
  const input = JSON.parse(serializeJSON(value));
  return serializeJSON(validate(input));
}

/** A JSON document with isolated snapshots and up to 100 undo steps. */
export class EditorDocument {
  #validate;
  #current;
  #saved;
  #past = [];
  #future = [];
  #listeners = new Set();

  constructor(initial, validate) {
    if (typeof validate !== 'function') throw new TypeError('A document validator is required.');
    this.#validate = validate;
    this.#current = validatedSnapshot(initial, validate);
    this.#saved = this.#current;
  }

  /** A fresh copy of the current canonical JSON value. */
  get value() {
    return JSON.parse(this.#current);
  }

  get canUndo() {
    return this.#past.length > 0;
  }

  get canRedo() {
    return this.#future.length > 0;
  }

  get dirty() {
    return this.#current !== this.#saved;
  }

  /** Validate first; failed validation and identical JSON are never edits. */
  commit(next, label = 'Edit document') {
    const snapshot = validatedSnapshot(next, this.#validate);
    if (snapshot === this.#current) return false;
    const editLabel = String(label);
    this.#past.push({ snapshot: this.#current, label: editLabel });
    if (this.#past.length > HISTORY_LIMIT) this.#past.shift();
    this.#current = snapshot;
    this.#future.length = 0;
    this.#notify('commit', editLabel);
    return true;
  }

  /** An imported replacement is a normal, validated, undoable edit. */
  replace(next) {
    return this.commit(next, 'Import document');
  }

  undo() {
    if (!this.canUndo) return false;
    const previous = this.#past.pop();
    this.#future.push({ snapshot: this.#current, label: previous.label });
    this.#current = previous.snapshot;
    this.#notify('undo', previous.label);
    return true;
  }

  redo() {
    if (!this.canRedo) return false;
    const next = this.#future.pop();
    this.#past.push({ snapshot: this.#current, label: next.label });
    this.#current = next.snapshot;
    this.#notify('redo', next.label);
    return true;
  }

  /** Call only after the caller has confirmed its save succeeded. */
  markSaved() {
    if (!this.dirty) return false;
    this.#saved = this.#current;
    this.#notify('saved', 'Save document');
    return true;
  }

  /** Subscribe to changes; this does not invoke the callback immediately. */
  subscribe(fn) {
    if (typeof fn !== 'function') throw new TypeError('A subscriber must be a function.');
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  #notify(type, label) {
    const snapshot = this.#current;
    const event = Object.freeze({ type, label, document: this });
    for (const listener of [...this.#listeners]) {
      listener(JSON.parse(snapshot), event);
    }
  }
}

/** Read a user-selected File/Blob and return a validated, independently owned value. */
export async function loadJSONFile(file, validate) {
  if (!file || typeof file.text !== 'function') throw new TypeError('Choose a JSON file to open.');
  if (typeof validate !== 'function') throw new TypeError('A document validator is required.');
  const text = await file.text();
  // Some text editors prepend a UTF-8 byte-order mark.
  const parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
  return JSON.parse(validatedSnapshot(parsed, validate));
}

function safeFilename(suggestedName) {
  const leaf = String(suggestedName ?? 'document.json').split(/[\\/]/).pop();
  let base = leaf
    .replace(/[<>:"|?*\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g, '-')
    .trim()
    .replace(/\.json$/i, '')
    .replace(/^[. ]+|[. ]+$/g, '');
  if (!base) base = 'document';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base)) base = `_${base}`;
  return `${Array.from(base).slice(0, 115).join('')}.json`;
}

/**
 * Explicitly save to an existing handle or the browser's Save As picker.
 * Without that API, initiate a local JSON download. No automatic persistence.
 * Returns a successful file handle, or null for a download or picker dismissal.
 * Only picker cancellation is suppressed; all read/write/security errors reject.
 */
export async function saveJSONFile(value, { handle = null, suggestedName = 'document.json' } = {}) {
  const json = JSON.stringify(JSON.parse(serializeJSON(value)), null, 2) + '\n';
  const filename = safeFilename(suggestedName);
  let destination = handle;

  if (!destination && typeof globalThis.showSaveFilePicker === 'function') {
    try {
      destination = await globalThis.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'JSON document', accept: { 'application/json': ['.json'] } }],
        excludeAcceptAllOption: true,
      });
    } catch (error) {
      if (error?.name === 'AbortError') return null;
      throw error;
    }
  }

  if (destination) {
    const writable = await destination.createWritable();
    try {
      await writable.write(json);
      await writable.close();
    } catch (error) {
      // Abandon incomplete writes, while preserving the original I/O failure.
      try {
        await writable.abort?.();
      } catch {
        // A failed stream may already be closed or aborted.
      }
      throw error;
    }
    return destination;
  }

  if (!globalThis.document?.body || typeof globalThis.URL?.createObjectURL !== 'function') {
    throw new Error('This browser cannot save JSON files.');
  }
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  let link;
  try {
    link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
  } finally {
    link?.remove();
    // Defer revocation so the browser can consume the download's Blob URL.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return null;
}
