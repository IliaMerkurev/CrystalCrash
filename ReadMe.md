# Crystal Crash

A portrait-first Three.js / Rapier glass-destruction playable.

Live preview: https://crystal-crash.pearly-haven-3558.chatgpt.site

## Run and build

Use Node.js 24 LTS. Run `npm ci`, then `npm run dev`. `npm run build` creates a standalone `dist/index.html`; `npm run preview` serves it. Use HTTP rather than file://. Vite is build tooling, not an embedded development server. Three.js 0.186.1 and Rapier compatibility/WASM 0.19.3 are pinned in the lockfile.

The HTML embeds the runtime, generated reflection environment, procedural models and synthesized sounds. No runtime CDN or external media is needed. The build rejects exports at or above 5,000,000 bytes; current export is approximately 3.49 MB. This is a playable prototype, not an ad-network-certified MRAID package.

## Controls and progression

Press PLAY to unlock audio. Grab the ball anywhere in the lower half, keep holding, pull back and release. Holding elsewhere below the middle line attracts the ball; when it reaches the pointer the same gesture becomes aiming. Crossing the bottom loss line cannot be rescued by attraction. Pause or tab switching suspends gameplay.

Fourteen authored arenas introduce five glass tiers with 1/2/4/6/8 direct-hit durability. Arena 01 contains 30 T1 cubes and exactly one Pulse. The first five arenas contain 30/36/41/45/48 blocks after added T1 rear formations; existing stronger-tier structures remain intact. Arenas 01–10 introduce Pulse, Pierce, Arc and Halo; arenas 11–14 introduce Frost, Split, Gravity Well and Heavy Hit. The fourteen-arena sequence then repeats. Clear all targets, manually break the unlocked green-pulsing gate, and launch through it to travel to the next arena.

Both rails fill green from bottom to top according to original shell area removed. Partial chipping counts; detached debris never counts twice.

## Powers

Break a cube containing a large colored particle sun, then touch its landed 3D pickup with the moving main ball. A colored cue appears around the ball. Attack powers apply automatically on the next valid glass impact; there is no activation button. One active attack and one FIFO queued attack are allowed. Halo occupies an independent save slot. Queued pickups remain visibly labelled as queued. Uncollected pickups do not block completion; inaccessible pickups visibly return to a safe point.

- Pulse: three damage to the struck original and every original within 4.4 ball diameters, with a broad shockwave.
- Pierce: ten active seconds after its first hit. Every distinct touched original is destroyed immediately, without glass bounce. Response resumes after leaving remaining shell volumes.
- Arc: one damage to every ground/support-layer original across the arena, with branching lightning. Upper stacked originals are excluded from the initial target snapshot.
- Safety Halo: one automatic rescue before losing the main ball.
- Frost: ten active seconds. Direct hits apply a mark; the next direct hit consumes that mark for +1 damage.
- Split: two fast smaller balls persist until lost. Catch and relaunch them in the lower zone; they have no magnetic attraction or aiming-camera zoom and slow when entering that zone. They cannot collect or activate powers. The next queued power becomes available immediately.
- Gravity Well: four seconds of strong bounded pull on up to twelve nearby playable cube clusters within six ball diameters, braking near the center. Balls, pickups and debris are unaffected.
- Heavy Hit: the next direct strike deals three damage, with a larger impact burst.

Collected inventory and surviving extra balls persist between arenas. Power timers pause during clear/gate travel and repositioning. Loose uncollected pickups and local Frost marks do not carry. Extra balls gather beside the main ball for travel, then remain catchable in the next arena. Main-ball loss clears its inventory but leaves surviving extra balls alive. Powers never damage the gate.

Arenas 6–14 now contain 52/56/60/64/68/74/80/86/92 originals and 3/4/4/5/6/7/8/8/9 bonuses. Later cycles increase toward a bounded 110 originals and 14 bonuses, retaining mixed glass tiers. The first five layouts are unchanged.

## Focused checks

Run `npm run test:bonuses` for controller timers, inventory, damage routing, support-layer selection and extra-ball input checks. Real Rapier checks also cover held extra balls, transition parking and Gravity arrival/friction restoration. These checks do not establish browser frame rate or visual acceptance. Press Q (physical key, any keyboard layout) for the hidden bonus test menu; selecting a power resets previous effects and equips it immediately. Escape closes the menu.

## Rendering and physics

Hollow glass shells use persistent Voronoi cells and compound convex structural bodies. Local hit quotas remove actual shell patches. Detached glass uses bounded floor-bouncing mesh particles, immediate shrink and orange melting; it has no rigid-body collision cascade. The remaining cubes, main ball and at most two echoes use Rapier. Original targets score once.

Polished chamfers, tinted transparent surfaces, procedural normal detail, an embedded studio environment and one shared 1024² planar reflection approximate glass without expensive cube/debris transmission passes. A coherent small reflection filter avoids duplicate contours. Four fixed area lights and shared resources limit rendering cost. Startup warms representative drawing paths before PLAY.

## Source layout

- `src/arena-data.js`: authored layouts and container assignments
- `src/bonus-controller.js`: power inventory, FIFO, charge and mark state
- `src/bonus-visuals.js`: procedural core, pickup and ball-accent models
- `src/bonus-world.js`: pickup lifecycle, feedback, contextual teaching and HUD
- `src/secondary-powers.js`: bounded echoes, gravity well and Frost indicators
- `src/main.js`: physics contacts, original damage/scoring, controls and integration
- `src/config.js`: base material and gameplay tuning
- `src/audio.js`: synthesized action/effect sounds

## Verification status

Following owner approval, focused controller dispatch, Rapier secondary-effect, particle lifecycle, pooled feedback and early-arena layout checks passed. Browser rendering and device-performance validation remain pending; these logic checks do not establish visual or full gameplay acceptance.

Work is on `prototype/0.3`. Main remains the approved prior version until an explicit merge request. Important iterations are committed and pushed, and every deployment reuses the same public Site. Keep caches, recordings and test artifacts outside Git.

Contained powers use a dense 32-particle sun and layered additive sprites, without an embedded pickup model. Destruction removes the sun, grows the pickup over 0.38 seconds, and retains 16 smaller attached orbit particles. Each power has pooled world feedback and a distinct synthesized sound. The default lower-zone ball position projects near 64% screen height.
