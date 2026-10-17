# Crystal Crash

A portrait-first, tactile Three.js / Rapier glass-destruction playable.

Preview: https://crystal-crash.pearly-haven-3558.chatgpt.site

## Run locally (Windows or macOS/Linux)

Install Node.js 24 LTS. In this folder run `npm ci`, then `npm run dev` and open the printed localhost URL. `npm run build` creates `dist/index.html`; `npm run preview` serves the production file. Do not open the HTML through file://.

## Play

Press PLAY to enable sound. Pull the captured steel ball backward and release to choose direction and power. While the ball rolls, drag horizontally to position the catcher. Catch only works within the actual cup. Missing returns the ball for a retry without resetting the section. Clear all original glass blocks to advance; score carries over. Escape or pointer cancellation aborts an aim. Pause freezes simulation; leaving the tab pauses automatically. Arrow keys also move the carriage.

## Implementation

- Three.js 0.186.1, Rapier 3D compatibility/WASM 0.19.3, Vite 8.3.4; exact dependencies in lockfile.
- Vite is build tooling, not an embedded development server. The export includes bundled game code and the physics runtime, without runtime CDN calls.
- Dynamic towers and supported beams, CCD steel ball, normal gravity for blocks, separate gentle +Z return force for the ball.
- Five configurable materials with impulse/relative-speed damage, visible cracks, chipped geometry, bounded physical fragments and instanced small shards.
- Original blocks score once; fragments never score. Cascade multipliers x1/x1.5/x2/x3. Endless seeded sections and a brief camera transition.
- Procedural Web Audio: launch, wall, hit, crack, chip, material-specific break, fall, catch, miss, section clear and UI.
- Orthographic centered pinball camera preserves parallel rails. World table is square; portrait composition retains space for HUD and gestures.

## Tuning

`src/config.js` contains glass score/color/density/crack/chip/fracture thresholds/roughness/transmission/thickness/shard presets plus launch power, return acceleration, catch width, fixed timestep, debris budgets and combo window. `comboFor` owns combo thresholds. Section layouts and seed progression are in `generateSection` in `src/main.js`.

## Build budget

Prototype export is one HTML, approximately 2.82 MB raw (approximately 2.83 million bytes in current build), including embedded Rapier WASM. No external art, music or videos. Build rejects HTML >= 5,000,000 bytes. This is a hosted prototype, not a certified ad-network package; no MRAID/CTA/monetization is included.

## Verification and limitations

Production build and inline-byte gate pass. Real Rapier simulation checks cover nonlethal cracking, once-only scoring, catch, miss/retry, section advance/score retention and fragment cleanup. Browser/device verification is recorded separately; desktop viewport emulation is not iOS testing. Headless Chromium launch was blocked by the VM environment. The existing cloud browser reached the private Site sign-in gate, and the connected laptop exposed no usable browser surface. No rendered browser, touch-device or Safari acceptance is claimed; the owner should perform the focused visual/input check on the deployed link.

Chipped blocks use visibly deformed preset geometry with a conservative original collider; large shards use approximate convex-looking meshes with box colliders. Small shards are visual only. Glass uses shared physical materials and bounded transparency; this is intentionally not runtime Voronoi or path-traced glass. Phone performance and Safari audio need physical-device verification. No life economy, shop, bonuses or multiball.

## Development discipline

Work on `prototype/0.2`, preserve and verify meaningful pushes, and do not merge main without owner approval. Reuse the same Site for every iteration. Keep recordings, generated test reports and caches outside Git. Retain the portable Three.js playable production checklist when starting another project.

Visual polish checkpoint: cracks now originate from Rapier contact positions on the impacted face; localized dents follow that contact; larger fragments use tapered glass-like prisms. Launch tuning, damage thresholds, debris caps and lifetimes are unchanged. Visual acceptance uses owner screenshots because this VM has disabled WebGL.

3D material pass: lower-angle camera; square glass blocks rotated 45 degrees with matching physics colliders; beveled faces; saturated absorption, studio-strip reflection environment, softer diffuse fill, reflective brushed table, metal catcher and warm edge fixtures. Launch forces and damage tuning remain unchanged.

Perspective material pass: perspective camera fitted to table/tower bounds, ray-projected drag aiming, 30 initial stacked glass blocks, brighter studio environment, 512×512 planar table reflection beneath a brushed translucent coating, enlarged faceted debris and sparse short-lived glints. Reflection adds one scene pass; no screen-space ray tracing or postprocess bloom. Owner screenshot review remains required.

Hollow-shell fracture iteration: six actual thin wall panels and six compound colliders per cube, with wall thickness 0.025/0.040/0.055/0.070/0.090 world units. Cube mass is preserved across the hollow collider compound. Each face splits into small triangular plates, up to 48 convex-hull rigid shards per break, global 240-body fragment cap and 3.2-second lifetime. Fine instanced chips remain, capped at 420, with restrained glints. This is procedural prefracture, not runtime Unreal Geometry Collection/Voronoi. Browser/device performance remains unmeasured. Export 2,826,099 bytes.

Material correction: restored v5 per-type transmission and full surface opacity/depth writing. The hollow visual shell has continuous beveled outer and reversed inner surfaces instead of overlapping alpha-blended panels. Shader thickness is an artistic optical setting; actual shell/collider thickness still follows the five physical wall values. Thin-shard fracture is unchanged.
