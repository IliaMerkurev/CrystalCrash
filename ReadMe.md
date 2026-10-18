# Crystal Crash

A portrait-first Three.js / Rapier glass-destruction playable.

Live preview: https://crystal-crash.pearly-haven-3558.chatgpt.site

## Run and build

Use Node.js 24 LTS. Run `npm ci`, then `npm run dev`. `npm run build` creates a standalone `dist/index.html`; `npm run preview` serves it. Use HTTP rather than file://. Vite is build tooling, not an embedded development server. Three.js 0.186.1 and Rapier compatibility/WASM 0.19.3 are pinned in the lockfile.

The HTML embeds the runtime, generated reflection environment, procedural models and synthesized sounds. No runtime CDN or external media is needed. The build rejects exports at or above 5,000,000 bytes; current export is approximately 3.49 MB. This is a playable prototype, not an ad-network-certified MRAID package.

## Controls and progression

Press PLAY to unlock audio. Grab the ball anywhere in the lower half, keep holding, pull back and release. Holding elsewhere below the middle line attracts the ball; when it reaches the pointer the same gesture becomes aiming. Crossing the bottom loss line cannot be rescued by attraction. Pause or tab switching suspends gameplay.

Fourteen authored arenas introduce five glass tiers with 1/2/4/6/8 direct-hit durability. Arena 01 contains 30 T1 cubes and exactly one Pulse. The first five arenas contain 30/36/41/45/48 blocks after added T1 rear formations; existing stronger-tier structures remain intact. Arena 01 has one Pulse. Arena 02 has Pulse + Split, and arena 03 has Split + Pierce. From arena 04 onward, each arena has a seeded random 2–5 distinct power types drawn from all nine. Containers are spread across distinct XZ towers using deterministic farthest-point spacing. Counts and selections remain stable through previews and resize; restarting can produce different later selections. The fourteen-arena sequence then repeats. Clear all targets, manually break the unlocked green-pulsing gate, and launch through it to travel to the next arena.

Both rails fill green from bottom to top according to original shell area removed. Partial chipping counts; detached debris never counts twice.

## Powers

Break a cube containing a large colored particle sun, then touch its landed 3D pickup with any moving ball. A colored cue appears around the ball. Bombs instead start their automatic five-second fuse on landing. Powers activate immediately on pickup. Pulse, Pierce and Frost run concurrently; their timers start at collection. Recollecting a timed power extends its remaining duration. Heavy Hit arms the next collision, with additional pickups adding charges. Split, Arc, Tornado and Black Hole activate instantly. There is no waiting queue. Uncollected pickups do not block completion; inaccessible pickups visibly return to a safe point.

- Pulse: a shared ten-second buff, starting immediately on pickup. Every distinct ball-to-cube impact deals three damage to the struck original and every original within 4.4 ball diameters, with a broad shockwave.
- Pierce: ten active seconds from pickup. Every distinct touched original is destroyed immediately, without glass bounce. Response resumes after leaving remaining shell volumes.
- Arc: radius-based branching lightning through ground/support-layer originals. Every reached cube passes the discharge to neighbors within 4.4 ball diameters; each original receives one hit, gaps stop the chain, and upper stacked originals are excluded from the initial snapshot.
- Frost: ten active seconds. Direct hits apply a mark; the next direct hit consumes that mark for +1 damage.
- Split: two fast smaller balls persist until lost. Catch and relaunch them in the lower zone; they have no magnetic attraction or aiming-camera zoom and slow for a one-second catch window when entering that zone, then accelerate toward the lower exit. Slow upper-zone extras are pulled downward to prevent stalling. All spheres physically collide. All balls collect and activate the shared power inventory. Repeated Split snapshots every living ball and adds two children per source: 1→3→9→27. Other active powers remain available while the extra balls live.
- Tornado (internal ID gravity): four seconds of tangential circulation around each cube’s starting orbit, with a taller tapered funnel. Up to twelve nearby playable cube clusters; balls and pickups are unaffected.
- Bomb: automatically arms on landing and explodes after five simulation seconds. A shrinking orange ring shows the fuse. The blast destroys originals in its 4.4-diameter radius and kicks free balls outward with capped speed; held/parked balls are excluded. It does not enter inventory.
- Black Hole: collection creates an airborne field in the upper arena center. Attraction ramps from zero over two seconds, lasts six seconds, and only moves cube structures. Destruction comes from ordinary physics impacts. The core, rings and local screen-space distortion follow the ramp.
- Heavy Hit: the next direct strike deals three damage, with a larger impact burst.

Collected inventory and surviving extra balls persist between arenas. Power timers pause during clear/gate travel and repositioning. Loose uncollected pickups and local Frost marks do not carry. Extra balls gather beside the main ball for travel, then wait beside it until the first main-ball shot launches the entire group together. Main-ball loss preserves shared powers while extra balls survive; with no survivors the inventory resets. Powers never damage the gate.

Arenas 6–14 now contain 52/56/60/64/68/74/80/86/92 originals with 2–5 distinct bonuses per arena. Later cycles increase toward a bounded 110 originals, retaining mixed glass tiers and the same random 2–5 bonus range. The first five layouts are unchanged.

## Focused checks

Run `npm run test:bonuses` for controller timers, inventory, damage routing, support-layer selection and extra-ball input checks. Real Rapier checks also cover held extra balls, transition parking and Tornado orbit and Black Hole friction restoration. These checks do not establish browser frame rate or visual acceptance. Press Q (physical key, any keyboard layout) for the hidden bonus test menu; selecting a power resets previous effects and equips it immediately. Escape closes the menu.

## Rendering and physics

Hollow glass shells use persistent Voronoi cells and compound convex structural bodies. Local hit quotas remove actual shell patches. Detached glass uses bounded floor-bouncing mesh particles, immediate shrink and orange melting; it has no rigid-body collision cascade. The remaining cubes, main ball and persistent extra balls use Rapier. Original targets score once.

Polished chamfers, tinted transparent surfaces, procedural normal detail, an embedded studio environment and one shared 1024² planar reflection approximate glass without expensive cube/debris transmission passes. A coherent small reflection filter avoids duplicate contours. Four fixed area lights and shared resources limit rendering cost. Startup warms representative drawing paths before PLAY.

## Source layout

- `src/arena-data.js`: authored layouts and container assignments
- `src/bonus-controller.js`: concurrent power timers, immediate activation, charge and mark state
- `src/bonus-visuals.js`: procedural core, pickup and ball-accent models
- `src/bonus-world.js`: pickup lifecycle, feedback, contextual teaching and HUD
- `src/secondary-powers.js`: bounded echoes, gravity well and Frost indicators
- `src/main.js`: physics contacts, original damage/scoring, controls and integration
- `src/config.js`: base material and gameplay tuning
- `src/audio.js`: synthesized action/effect sounds

## Verification status

Following owner approval, focused controller dispatch, Rapier secondary-effect, particle lifecycle, pooled feedback and early-arena layout checks passed. Browser rendering and device-performance validation remain pending; these logic checks do not establish visual or full gameplay acceptance.

Work is on `prototype/0.4`. Main remains the approved prior version until an explicit merge request. Important iterations are committed and pushed, and every deployment reuses the same public Site. Keep caches, recordings and test artifacts outside Git.

Contained powers use a dense 32-particle sun and layered additive sprites, without an embedded pickup model. Destruction removes the sun, grows the pickup over 0.38 seconds, and retains 16 smaller attached orbit particles. Each power has pooled world feedback and a distinct synthesized sound. The default lower-zone ball position projects near 64% screen height.

Camera feedback uses bounded, deterministic translation: short Pulse impacts, a decaying Bomb shake, slow Tornado wind sway, and a slight progressive Black Hole zoom. Pause freezes the effect clock; restart clears offsets. The lens copies display-encoded RGBA8 without a second color transform. QA routes support `lens=off` and `lens=identity` for comparison.

Black Hole now uses a 6.6-ball-diameter radius, eases camera focus over 0.6 seconds and progressively dollies up to 58% closer over its 3-second duration. FOV widens by the camera-space depth ratio with deliberate 40% subject growth while changing background perspective; both pose and lens return in 0.3 seconds. All free balls smoothly run at 10% motion speed while cubes retain normal simulation time. Logical velocities are converted only around each Rapier step, preserving post-collision responses and external impulses; held and parked balls are excluded. The one-second lower-zone catch window stays in real simulation seconds. Test opens the same diagnostic menu as Q, and FULLSCREEN uses the browser-supported API with an explicit unsupported fallback.

### Aim control and extra-ball parity
- Holding either the main ball or an extra ball to aim smoothly slows simulation to 40%; empty-space attraction does not. Release/cancel smoothly restores normal time. Camera/input remain responsive in real time, and menus freeze simulation.
- Black Hole ball dilation composes by the stronger slowdown rather than multiplication: settled aiming + Black Hole yields 30% cube time and 10% free-ball time. Held bodies remain externally controlled.
- Extra balls have the main ball's radius and polished steel response, retaining their pink tint. Spawn and carried-group spacing derive from the shared radius.

### Bomb visual refinement and arena diagnostics
- Bomb fire lobes spread 32% farther, hot streaks travel about 31% faster, and glowing embers are brighter. Smoke coverage is lighter and less opaque; damage and physical impulses are unchanged.
- The Test menu offers an explicit arena loader for the 14 authored arenas. Loading resets that scene, score and effects while retaining the current run seed for repeatable layouts.

- Black Hole now lasts 3 seconds with a proportionally faster pull ramp and inward particles. Its camera approaches 58% closer while deliberately increasing apparent size up to 40%; world geometry and influence radius are unchanged.

### Pulse readability
Pulse impacts now show a short local amber flash, two broader luminous expanding waves and 48 brighter radial sparks. Wave geometry and warmup are pooled; damage, radius and mini-shake are unchanged. The active-ball amber cue is also enlarged and animated while preserving the reflective ball surface.

### Short Bomb fuse and heat shock
Bomb countdown is 3 simulation seconds after landing, with a synchronized circular fuse display. A thin bright shock ring scales outward and fades in .38 seconds; a short local heat-distortion pass follows the expanding blast. Fire/ember glow increases without changing damage or ball impulses. Pulse's persistent amber cue is shared by all live balls through instanced effects.

### Arena-wide Frost
Frost activates on pickup with an arena-wide snow wave and a fading transparent crystalline screen border. Every surviving original cube stays visibly iced until the arena ends, retaining its underlying glass color. Its required hit total is reduced by one (minimum one); repeated Frost does not stack, and pickup alone never destroys an already damaged cube. Fractured parts inherit the same original ice state. Missed shots retain arena ice; Test's explicit effect reset removes both the appearance and weakening.

### Roaming Tornado
Tornado now follows a smooth randomized route through the upper arena, collecting nearby playable cube clusters as it moves. Captured cubes spin and rise briefly, then receive a bounded tangential/upward throw and cannot be recaptured by that Tornado. Environmental collision damage is suspended only during capture, with shared ownership when Black Hole overlaps; ordinary tier/Frost collision damage resumes on release. Ball physics remains outside the vortex.

The effect uses a pooled gray-blue storm cone, broad luminous cyan spiral ribbons, restrained orange accents, dust and debris. Eight bounded renderables replace the old narrow funnel. The Frost border also now has an explicit layer beneath all HUD labels and controls.

### Any-ball aim framing
Catching any ball now uses the same smooth aim-camera pose and pullback space. The camera follows the held ball through a parallel translation, preserving the centered shooting direction without drag-driven yaw; input remains on its frozen gesture projection. Global aim time approaches 30% speed and restores smoothly on release/cancel. Black Hole's selective ball slowdown is normalized against that global scale, so the two effects do not multiply into excessive slowdown.

### Captured-cluster collision optimization
While Black Hole or Tornado captures a playable cluster, its existing glass colliders keep their exact ball/extra-ball collision geometry. A temporary mass-zero local bounding box handles cube/table contacts instead. Visible meshes, fracture cells, Frost state, mass properties and velocities are retained. Shared field ownership keeps this representation until the final capture ends; release, direct-hit fracture, effect reset and arena cleanup restore/remove it safely. Direct ball and Bomb damage continue through the existing original-cube rules.

Focused real-Rapier checks cover collision masks, holes, mass/center-of-mass/inertia, overlapping field ownership, stale bodies, friction and repeated cleanup. Synthetic dense-contact CPU comparisons are development diagnostics, not device FPS guarantees; rendering quality and FX geometry are unchanged.

### Short Black Hole and staggered release
Black Hole now lasts 3 seconds, reaching full pull after 1 second. Its camera and inward-particle timeline are retimed proportionally. Free balls smoothly approach 10% normal speed; aiming still slows the world to 30%, and the selective ball scale combines to 10% rather than 3%. Logical moving velocities prevent premature solver sleep, and normal speed returns smoothly from current collision results.

Natural expiry gives captured cubes a small horizontal outward nudge. Temporary environmental contacts and collision-damage protection are then restored bottom-first in groups of at most eight, 0.15 simulation seconds apart. Falling motion continues; ball/Bomb damage remains available. The release schedule follows running physics even during main-ball respawn, and overlapping Tornado ownership remains valid. Explicit resets remove pending ownership immediately.

### More relaxed bonus distribution
Arena 1 keeps its single Pulse, and arenas 2–3 have two distinct seeded pickups without guaranteed Split. Split has one-third the selection weight of other kinds. Later ordinary arenas retain 2–5 unique pickups; an arena containing Black Hole or Tornado has only 1–2 additional pickups, and the two powerful fields never share an arena. Existing tower geometry and spaced host selection are retained.

Tornado's cyan ribbons now have soft feathered edges, with additional gold filaments, warm orbiting particles and a ground-hugging airflow skirt. The fixed visual budget is nine draws and 27,520 triangles per scene pass; no full-screen blur or physics change is added by this polish.

### Soft contact and rolling audio
Nonbreaking glass/table impacts now use a quieter distinct glass tap, with impact thresholds and contact/cooldown suppression. Captured environmental collisions stay quiet. A single shared procedural rolling loop follows actual grounded ball tangential speed and smoothly fades on stop, catch, airborne motion, pause or mute. Main and extra balls share bounded loudness; Black Hole and aiming speed reductions are reflected in pitch/gain. Music remains separate.
