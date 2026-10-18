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

## Save directly into project source

Run `npm run editor`, then open Settings and enter the absolute CrystalCrash repository folder once. Configure validates the Git checkout, package identity, source preset and schema. It loads the destination preset into this editor after any unsaved-change confirmation. The displayed destination is the project that Save will update; if it is a different checkout, only its preset is loaded (the renderer/code still comes from the checkout running Vite). Use matching game versions, or launch the editor from the destination checkout.

Save writes only `src/presets/crystal-crash.json` in that configured project. No export/import command is needed. The setting persists locally in ignored `.editor-local/settings.json` in the checkout running Vite. Each successful overwrite first saves the exact previous bytes in `.editor-local/backups/`, then atomically replaces the target. Restore a backup through Import and Save, or copy it back manually. Review and commit source changes as usual; Save does not commit or publish them.

If another editor or process changes the source, Save reports a conflict and leaves your edits unsaved. Export them if needed, then use Settings → Reload source to explicitly discard the current document and load the latest version. Save never silently overwrites a stale revision or a different destination selected by another tab. A completed save clears the dirty marker only if no newer edits were made during the request.

This service exists only in the local Vite development server, bound to loopback. It checks local Host/Origin, a per-process session token, JSON limits, preset validation and source revision. The request cannot choose a target filename. Symlinks in the preset path are rejected. Published/static editor builds have no filesystem API; use Save As or Export there. The independent sample scene also uses Save As/Export.

Import and Export remain available for sharing presets. Save As uses the browser file picker when supported; otherwise it downloads JSON. Export retains the dirty marker because download completion cannot be verified. An optional command-line importer remains available:

```sh
npm run preset:import -- /path/to/preset.json --dry-run
npm run preset:import -- /path/to/preset.json
npm run build
```

Production consumes the saved JSON on the next build. Local storage is not used for source persistence. Do not apply a sample-scene preset to CrystalCrash.

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

`npm run editor:save-check` checks direct-save configuration, backup, conflicts and request protection. `npm run editor:check` runs the focused checks (the persistence check restores the original preset after exercising the importer). Automated checks cover schema rejection, JSON roundtrip, history, stable IDs, runtime poses and real Rapier shell collider correspondence. Production bundle checks reject editor symbols. UI rendering, gizmo feel, file-picker interactions and Play/Stop still require a WebGL browser smoke check; the cloud browser could not reach the local preview server during this delivery. Existing GLB/custom shader/game behavior is retained rather than reimplemented by the editor.
