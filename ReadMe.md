# Crystal Crash

A portrait-first, tactile Three.js / Rapier glass-destruction playable.

Preview: https://crystal-crash.pearly-haven-3558.chatgpt.site

## Run locally (Windows or macOS/Linux)

Install Node.js 24 LTS. In this folder run `npm ci`, then `npm run dev` and open the printed localhost URL. `npm run build` creates `dist/index.html`; `npm run preview` serves the production file. Do not open the HTML through file://.

## Play

Press PLAY to enable sound. In the lower half, grab the ball to stop it exactly where it is; keep holding, pull back and release to launch from that position. Hold elsewhere below the dashed center line to attract the ball toward your pointer with gradually increasing force, even when it is in the upper half. When it reaches your finger, the same gesture becomes aiming. Crossing the red bottom line is a miss and cannot be rescued; a retry preserves the section. Escape/pointer cancellation aborts aiming safely. Pause and leaving the tab freeze gameplay. Clear all original glass blocks to turn the armored upper gate into breakable glass, then launch the ball through it to travel into the next arena; score carries over.

## Implementation

- Three.js 0.186.1, Rapier 3D compatibility/WASM 0.19.3, Vite 8.3.4; exact dependencies in lockfile.
- Vite is build tooling, not an embedded development server. The export includes bundled game code and the physics runtime, without runtime CDN calls.
- Dynamic towers and supported beams, CCD steel ball, normal gravity for blocks, separate gentle +Z return force for the ball.
- Five glass tiers with 1/2/4/6/8-strike local chipping, persistent Voronoi shell clusters, bounded floor-bouncing mesh debris and instanced fine shards.
- Original blocks score once; fragments never score. Cascade multipliers x1/x1.5/x2/x3. Endless seeded arenas, visible continuation above the gate, and player-triggered upward camera travel.
- Procedural Web Audio: launch, wall, hit, crack, chip, material-specific break, fall, catch, miss, section clear and UI.
- Perspective pinball camera shows glass thickness and tower height. Arena geometry adapts to the unchanged perspective camera: gate near the top, interaction divider in the middle, and fall edge near the bottom. Portrait lower rails taper to stay within the screen.

## Tuning

`src/config.js` contains glass score/color/density/crack/chip/fracture thresholds/roughness/transmission/thickness/shard presets plus launch power, return acceleration, start/loss positions, fixed timestep, debris budgets and combo window. `comboFor` owns combo thresholds. Section layouts and seed progression are in `generateSection` in `src/main.js`.

## Build budget

Prototype export is one HTML, approximately 2.82 MB raw (approximately 2.83 million bytes in current build), including embedded Rapier WASM. No external art, music or videos. Build rejects HTML >= 5,000,000 bytes. This is a hosted prototype, not a certified ad-network package; no MRAID/CTA/monetization is included.

## Verification and limitations

Production build and inline-byte gate pass. Real-Rapier and pointer-handler checks cover stopping at the current position, same-gesture aiming/launch, upper-half attraction, acceleration ramp, arrival-to-aim without accidental launch, cancellation, irreversible loss, retry, tier damage, once-only scoring and section progression. These do not replace real-device browser/touch testing. The cloud browser has disabled WebGL; no new rendered-browser or Safari acceptance is claimed. Phone performance, touch feel and Safari audio require owner verification.

Playable glass shells are hollow, with extruded Voronoi polygons, compound convex colliders and persistent bonds. Detached groups are visual 3D particles with floor bounce; they no longer have rigid bodies or secondary collision fracture. Shared physical materials, planar reflections and studio environment lighting approximate glass; this is not path tracing. No shop, bonuses or multiball.

## Development discipline

Work on `prototype/0.2`, preserve and verify meaningful pushes, and do not merge main without owner approval. Reuse the same Site for every iteration. Keep recordings, generated test reports and caches outside Git. Retain the portable Three.js playable production checklist when starting another project.

## Earlier iteration notes

The notes below describe the sequence of earlier iterations; the current controls and implementation above supersede old catcher/crack behavior.

Visual polish checkpoint: cracks now originate from Rapier contact positions on the impacted face; localized dents follow that contact; larger fragments use tapered glass-like prisms. Launch tuning, damage thresholds, debris caps and lifetimes are unchanged. Visual acceptance uses owner screenshots because this VM has disabled WebGL.

3D material pass: lower-angle camera; square glass blocks rotated 45 degrees with matching physics colliders; beveled faces; saturated absorption, studio-strip reflection environment, softer diffuse fill, reflective brushed table, metal catcher and warm edge fixtures. Launch forces and damage tuning remain unchanged.

Perspective material pass: perspective camera fitted to table/tower bounds, ray-projected drag aiming, 30 initial stacked glass blocks, brighter studio environment, 512×512 planar table reflection beneath a brushed translucent coating, enlarged faceted debris and sparse short-lived glints. Reflection adds one scene pass; no screen-space ray tracing or postprocess bloom. Owner screenshot review remains required.

Hollow-shell fracture iteration: six actual thin wall panels and six compound colliders per cube, with wall thickness 0.025/0.040/0.055/0.070/0.090 world units. Cube mass is preserved across the hollow collider compound. Each face splits into small triangular plates, up to 48 convex-hull rigid shards per break, global 240-body fragment cap and 3.2-second lifetime. Fine instanced chips remain, capped at 420, with restrained glints. This is procedural prefracture, not runtime Unreal Geometry Collection/Voronoi. Browser/device performance remains unmeasured. Export 2,826,099 bytes.

Material correction: restored v5 per-type transmission and full surface opacity/depth writing. The hollow visual shell has continuous beveled outer and reversed inner surfaces instead of overlapping alpha-blended panels. Shader thickness is an artistic optical setting; actual shell/collider thickness still follows the five physical wall values. Thin-shard fracture is unchanged.

Voronoi update: each wall uses bounded random sites and clipped half-plane Voronoi cells. Whole convex polygon silhouettes are extruded; rendering fan triangulation is internal only. Physical count varies with cell count (roughly half of cells, global cap240); visual chips use four irregular polygon variants per material. Focused 20-layout test verified face area coverage and valid convex hulls, with 3–10 polygon sides observed. Existing materials preserved. HTML 2,827,164 bytes.

Progressive clusters: persistent Voronoi cells are joined by a bond graph across shared in-face edges and overlapping cube-edge intervals. Solver contact impulse and local impact position weaken nearby bonds; connected components become compound rigid bodies with inherited linear/angular motion. Remaining shell clusters keep real openings and can split again. Components with 1–3 cells become expiring debris; larger structural components are never evicted by the debris cap. Score/completion is tracked once per original cube only after no structural clusters remain. Contact events are aggregated per cluster and same-origin shard contacts do not cause self-damage. Cells have a slight collision inset to reduce overlapping seam impulses. This is a custom prefractured bond model, not a full continuum stress simulation.
Focused checks: 20 cube/beam graphs initially connected; actual launched-ball contact fractures a patch; repeated damage works; fragment+cluster mass conserved; reward not premature or duplicated; section cleanup passes. Actual device rendering/performance remains unmeasured. Export 2,831,335 bytes.

### Tiered bonds and re-fracturable fragments

Bond resistance now increases explicitly across all five glass tiers (0.32 / 1.8 / 3 / 4.5 / 7), independently of optical materials. The weakest glass loses a much larger patch under the same hit. Bond toughness varies deterministically by edge, so cracks can leave uneven connected patches instead of uniformly separating every cell.

Connectivity determines detached patch size; there is no three-cell maximum. Larger patches remain structural compounds and can fracture repeatedly. Small two/three-cell pieces also retain their internal bonds and compound colliders, and subsequent impacts can split them further. These small debris compounds expire after at most five seconds, with inherited remaining lifetime after re-fracture, so they cannot indefinitely block section completion. Single chips retain the existing shorter lifetime and the global debris-body limit. Original-cube reward is still granted once, after its structural remnants are gone.

Focused real-Rapier checks verified tier differentiation, natural bonded-patch detachment, subsequent splitting, mass conservation before budget culling, once-only rewards, section transition, and debris cleanup. Browser/device performance still requires real-device validation.

### Coarser cluster fracture

Ordinary cube walls now contain five or six Voronoi cells instead of fourteen to eighteen. This increases characteristic shard width by approximately 1.7 times while preserving the full wall surface and original mass. Beam walls use area-scaled cell counts with a lower upper bound. Compounds retain their real bond graph and repeat fracture; fine supplemental chip particles remain small. Geometry coverage/connectivity, launched-ball fracture, tier distinction, bonded-compound detachment/re-fracture, score, transitions, and cleanup were checked. This reduces cell-collider load substantially, but device frame rate has not been measured.

### Interior-ball recovery

An active ball whose center remains inside a substantial shell for 0.12 seconds opens approximately 75% of that shell's remaining cells. Detection uses each compound body's current position and rotation, with an inset interior boundary and at least four represented shell faces, so ordinary exterior contact does not trigger recovery. Loose panes receive a small outward impulse; the ball is neither teleported nor directly accelerated. A per-original cooldown and one-shell-per-step bound prevent recursive fracture bursts. The remaining patches retain normal cluster behavior and once-only original scoring.

A real-Rapier regression checked exterior non-trigger, recovery inside a moved/rotated reinforced cube, majority detachment, unchanged ball pose/velocity at fracture, mass conservation, subsequent escape, reward uniqueness, and section progression. Real-device validation remains outstanding.

### Strike-count chipping balance

Valid distinct impacts now chip structural glass immediately instead of spending hits on crack-only feedback. Tier targets are 1 / 2 / 4 / 6 / 8 strikes. Each strike commits approximately 100% / 50% / 25% / 16.7% / 12.5% of the original shell area; coarse irregular cell boundaries create small rounding differences. Cumulative area accounting prevents exponential decay of the remaining shell. The final strike releases all remaining structural patches and grants the original reward once.

Patch selection grows through connected neighboring cells from the actual contact location. Released material forms varied bonded physical groups, with normal inherited movement, particles and repeat fracture. These detached groups use bounded debris cleanup and no longer block completion. Contact-start grouping across a cube's multiple colliders plus a 0.22-second original-wide strike cooldown suppress duplicate strike accounting from the same collision. Low-energy resting contacts remain below the valid-impact threshold. Interior-ball recovery remains active.

Focused checks passed all tier hit counts, local patch inclusion, cumulative removed area, mass conservation, cooldown, one-hit blue destruction from a real launched ball, unique rewards, section transitions and interior recovery. Real-device testing is still outstanding.


### Free-position ball control

Removed the launcher/catcher geometry and all carriage constraints. The dashed center boundary separates the lower control zone, with a restrained tint and pointer attraction ring. Direct lower-half grabs freeze the ball at its exact 3D position. Same-pointer pullback launches from that position; attraction ramps toward the lower-zone pointer and changes to aim on arrival with a reset baseline. The red bottom line is an irreversible loss threshold. Single-pointer capture, cancellation, UI exclusion, pause, reset and section transitions use the new flow.

### Melting debris and clear lower control zone

Collision masks separate ball, structural glass, debris and table/boundaries. Detached debris collide only with structural glass and table/boundaries, never with the ball or other debris. Structural target clusters retain their normal behavior. Released shards and compound debris immediately shrink around their own centers, gain orange emission progressively, and dissolve within a randomized 0.2–1-second lifetime. Convex collision shapes shrink with the visible geometry and bodies/materials are removed at expiry. A re-fractured melting group inherits its already-reduced shape and remaining lifetime. Fine instanced chips use independent lifetime/shrink/emission attributes; intact shared glass materials are unaffected.

All cube spawn bounds now lie entirely above the middle divider, with clearance for rotated corners. This applies to subsequent sections too; natural falling motion is unrestricted. Focused Rapier checks verified the collision matrix, matching visual/collider scale, lifetime cleanup without deleting remaining targets, original score progression and controls. Six section layouts passed the upper-half spawn-bound check. Physics timestep, CCD policy, renderer settings and cluster system were otherwise retained.


### Residual cleanup and lower-half destruction

Flat panes (one/two represented faces), open corners without opposing faces, and remnants at or below 30% of original shell area are terminal debris, not objectives. Substantial remaining shells stay playable; once-original reward accounting remains intact. This can complete a cube before its nominal maximum strike count when only unusable remnants remain.

When any actual remaining shell vertex crosses the same middle divider used for controls, all its remaining bonds are severed and its cells separate into individual physical melting shards with a restrained outward impulse. The ball-inside-shell amplified fracture rule has been removed completely.

Dissolve duration is now size-dependent from 0.3 to 2 seconds; larger pieces last longer. Fine chips use their visual size too. Shrink begins immediately; orange emission is raised from 3.5 to 7.5 peak strength for both physical shards and chip particles. Previous debris collision masks are preserved. Focused checks cover residual classification, full bond separation on crossing, duration ordering/range, score uniqueness, section progression and controls.


### Hybrid debris simulation

Rapier now simulates only the ball, table/boundaries and remaining playable glass structures. Detached irregular shards and glued groups are independent 3D mesh particles with inherited linear/angular movement, gravity, approximate oriented-box floor support, bounce and friction. They pass through cubes, the ball and other debris, and do not undergo secondary rigid-body fracture. No detached convex colliders or melting collider rebuilds remain.

Size-based dissolve lifetime is 0.5–3 seconds, with immediate shrink and progressive orange emission preserved. Hit quotas, local chipping, residual cleanup, complete separation below the divider, upper-half spawning, scoring and ball controls remain. Focused checks verified zero debris bodies/colliders, visual group retention, floor bounce, duration bounds, cleanup, score/section progression and pointer controls. This removes debris physics load; it does not establish device FPS or eliminate possible remaining compound-shell or rendering issues.

## Gate progression and crisp debris

- Melt duration is size-based from 0.5 to 1 second. Mesh debris uses actual polygon support vertices for floor contact, stronger gravity and brisk friction; fine chips also use geometric support rather than a fixed hovering height.
- Falling cubes register distinct contact episodes. Original-object contact identities survive collider reconstruction; resting contact does not repeatedly spend hit quotas. Cube-floor restitution uses the minimum material coefficient to avoid artificial high bounces and their repeated impacts. Residual scraps still clear automatically.
- Clearing targets changes the armored gate into breakable glass and smoothly returns the ball to the lower start point or held pointer. The player must launch into the gate to shatter it, then pass through the opening. The next arena similarly positions the ball safely without an automatic launch. A smooth upward travel leads to the next seeded arena with a continuous surrounding platform.
- Aiming eases the camera toward the lower edge to create finger room. The gesture projects through a frozen camera, so camera movement cannot change its launch vector. Portrait framing spans more screen width; landscape gameplay width is retained with extended surroundings.
- Focused real-Rapier checks cover all five tier drop impacts, floor support, gate waiting/crossing/progression, and frozen-camera aiming. Actual device visual/performance review remains necessary.

## Reflection environment

A generated 1536×768 sRGB studio panorama is embedded in the single HTML and filtered to a PMREM environment for glass and polished metal. Broad white strips with restrained cyan and warm accents supply contrasting highlights. It affects reflections only; the visible scene background and environment geometry remain unchanged. The source is an LDR JPEG, not a true high-dynamic-range capture.

## Full-height arena layout

The surrounding platform is removed. Only the active tabletop and the next tables beyond its gate remain above the void. Table length, divider, spawns, floor collider, side rails, gate, loss line and travel distance adapt together to the initial viewport and resizing; camera angle, fitting parameters, aim offset and transition behavior are retained. Horizontal upper play width remains unchanged; portrait lower edges taper slightly to fit the phone.

Glass, steel and table materials explicitly bind the reflection map so their individual environment strengths apply. The generated LDR source image is unchanged and filtered through PMREM; per-material environment intensity controls reflection strength. Glass optical path length now corresponds more closely to its thin walls, and the table coat gives environment reflections more weight alongside its planar reflection.

## Crisp glass, frosted gate and bounded glow

Glass roughness and clearcoat roughness are 0.005; physical dielectric Fresnel remains handled by MeshPhysicalMaterial. The 12.3-wide exit gate is 1.5 units high, with matching collider and fracture dimensions. It begins as frosted glass, remains invulnerable until all targets clear, then smoothly becomes clear glass with an emissive pulse that fades to zero.

Melting shards and fine chips receive bounded instanced camera-facing additive halos; side strips have narrow orange halo meshes. These are localized glow effects rather than a costly full-screen bloom pass. They do not change the generated environment image or visible background.

## Visual refinement 22

Glass now uses 94% transmission with lighter body tint, retained colored absorption, crisp beveled edges and reoriented studio reflections. The floor exposes more of its planar reflection. Four continuous rectangular rail lights replace the two isolated point highlights; rail halos and melting emission are brighter. The gate starts as clear reflective glass, is 0.75 units high and 0.18 units deep, remains locked until the arena clears, then pulses before manual breaking. Camera and controls are unchanged. Visual review on a real browser remains required.

## Visual correction 23

User screenshot review showed the previous high-transmission glass lost tier-color readability and the table became too mirror-like. Saturated original tier colors are restored with moderate 42–60% transmission and crisp physical reflections. The earlier brushed floor coat (roughness 0.22, opacity 0.76) is restored. Continuous rail illumination remains. The obsolete prototype footer label is hidden.

A small tileable mathematical normal map adds broad, subtle changes of reflection direction to glass. It uses stable face UVs on shells and fracture plates, with lower amplitude on small shards; no noisy frosting or raster dependency is added.

## Reference-led visual refinement 24

Confirmed landscape and portrait browser frames revealed fixed-distance fog obscuring the expanded portrait arena. Fog now starts beyond the active gate. Colored glass receives a narrow procedural edge-emission mask, while normal variation is reduced to keep broad faces clean. Planar reflections use a bounded nine-tap anisotropic blur so the brushed floor shows softened color streaks instead of crisp duplicate towers. Camera and gameplay are unchanged.
