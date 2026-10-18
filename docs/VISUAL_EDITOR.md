# Visual editor

This editor runs the actual CrystalCrash renderer in a same-origin frame. Its controls are a separate development application. It is not included in the release HTML.

## Start

Use a current Node version supported by Vite 8 (Node 22.12+ recommended).

```sh
npm ci
npm run editor
```

Open http://localhost:5173/editor.html. Hardware-accelerated WebGL2 is required. The editor displays the game's initialization error if the renderer cannot start. Run from the server, not a file URL.

## Edit and preview

- Select an arena and a cube in the hierarchy or viewport.
- W / E / R select move, rotate and scale. Dragging a gizmo creates one undo step.
- Use the inspector for precise position, rotation, scale, glass, floor, light and particle changes.
- The viewport has orbit navigation and portrait/landscape sizing. Focus centers the selected object.
- Edit freezes gameplay physics. Play starts a disposable simulation. Returning to Edit restores the selected authored arena, score and authored poses.
- Effect buttons preview existing procedural effects. They do not change bonus rules.
- Undo/Redo works on complete validated documents, not live mesh references.

Positions use arena-normalized depth, so a layout survives aspect-ratio changes. Edited objects are constrained inside the upper play area; their rendered dimensions and Rapier shell colliders are rebuilt together. Transient shards, active balls, scores and animation time are never saved. The MVP edits existing authored cubes, not object creation/deletion or imported model topology.

## Persist changes into the game

Export JSON downloads a preset. Save As uses the browser file picker when supported; otherwise use Export. Import restores a validated JSON document. Download requests cannot confirm that a file was actually saved, so Export retains the unsaved indicator.

The editor does not silently modify repository files. Explicitly apply the chosen file:

```sh
npm run preset:import -- /path/to/preset.json --dry-run
npm run preset:import -- /path/to/preset.json
npm run build
```

The importer validates project/version, ranges, known arena object IDs and size, then atomically replaces only `src/presets/crystal-crash.json`. Review the Git diff and commit that source JSON. Production imports it directly. Local storage is not the persistence mechanism. Do not commit an exported sample-scene preset as a game preset.

## Separate editor build

```sh
npm run editor:build
npm run editor:preview
```

Open http://localhost:4174/editor.html. `editor-dist/` is disposable tooling output. `npm run build` still creates only the offline playable `dist/index.html`, under 5,000,000 bytes. Do not package `editor-dist`, editor source or dev-server assets into an advertisement.

## Reuse in another game

Open `/editor.html?scene=sample` for a second independent two-box scene. It imports no CrystalCrash gameplay or Rapier code. `editor/document.js`, `editor/main.js` and `editor/style.css` are generic; `editor/crystal-adapter.js` and `editor/sample-adapter.js` implement the scene-specific contract.

An adapter exposes `projectLabel`, `arenaCount`, `listEntities`, `getObject`, `readDocument`, `validateDocument`, `applyDocument`, `documentFor`, `setMode`, `setArena`, `fields`, `select`, `setTransformMode`, `focus`, `effects`, `previewEffect`, `subscribe`, `onTransform` and `dispose` as `window.crystalEditorAPI`, then emits `crystal-editor-ready`. Documents contain JSON values with stable authored IDs. Adapter code owns runtime resources, camera/input ownership, validation and pose/collider rebuilding. The generic shell owns UI and document history. Cross-frame JSON is copied before validation.

## Verification and limits

`npm run editor:check` runs the focused checks (the persistence check restores the original preset after exercising the importer). Automated checks cover schema rejection, JSON roundtrip, history, stable IDs, runtime poses and real Rapier shell collider correspondence. Production bundle checks reject editor symbols. UI rendering, gizmo feel, file-picker interactions and Play/Stop still require a WebGL browser smoke check; the cloud browser could not reach the local preview server during this delivery. Existing GLB/custom shader/game behavior is retained rather than reimplemented by the editor.
