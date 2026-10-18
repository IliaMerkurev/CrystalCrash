// Selective time dilation around ONE shared Rapier step. Between calls, velocity,
// force and torque stay in logical (normal-time) units for gameplay and impulses.
// The world's timestep, cubes, and all unlisted bodies remain untouched. If the
// whole world is already slowed, apply only the remaining selective slowdown.
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const vector = value => ({ x: value.x, y: value.y, z: value.z });
const scaled = (value, factor) => ({ x: value.x * factor, y: value.y * factor, z: value.z * factor });
const validGlobalScale = value => Number.isFinite(value) && value > 0 ? Math.min(1, value) : 1;

// The effective wall-clock speed is min(globalScale, absoluteScale), not their
// product. For example .3 global plus .1 Black Hole needs one-third relative speed.
export const relativeBallTimeScale = (absoluteScale, globalScale = 1) =>
  Math.min(1, Math.max(0, finite(absoluteScale, 1)) / validGlobalScale(globalScale));

export class BallTimeScale {
  constructor({ minimumScale = .10, attack = .25, release = .4 } = {}) {
    this.minimumScale = Math.min(1, Math.max(.05, finite(minimumScale, .10)));
    this.attack = Math.max(.001, finite(attack, .25));
    this.release = Math.max(.001, finite(release, .4));
    this.scale = 1;
    this._pending = [];
  }

  // bodies must exclude held, parked, staged, or otherwise externally controlled
  // balls. Call AFTER game forces are applied and BEFORE world.step(), with no
  // gameplay callbacks between this and afterStep(). New split balls need only
  // appear in this list; no per-body history or birth registration is necessary.
  // dt is the simulated step duration. globalScale belongs to the world clock;
  // this.scale remains the ABSOLUTE Black Hole envelope in wall-clock units.
  beforeStep(dt, bodies, intensity = 0, globalScale = 1) {
    // Never accumulate scaling if a caller accidentally missed its prior restore.
    this.afterStep();
    dt = Math.max(0, finite(dt, 0));
    if (!dt) return this.scale; // pause preserves the envelope and body properties
    globalScale = validGlobalScale(globalScale);
    const amount = Math.min(1, Math.max(0, finite(intensity, 0)));
    const target = 1 - (1 - this.minimumScale) * amount;
    const tau = target < this.scale ? this.attack : this.release;
    this.scale += (target - this.scale) * -Math.expm1(-dt / globalScale / tau);
    if (Math.abs(this.scale - target) < 1e-6) this.scale = target;
    const s = relativeBallTimeScale(this.scale, globalScale);
    if (s === 1) return this.scale;
    const seen = new Set();
    for (const body of bodies ?? []) {
      if (!body || seen.has(body.handle) || !body.isValid() || !body.isDynamic()) continue;
      seen.add(body.handle);
      // Rapier sleeping thresholds are in solver-space speed. A genuinely moving
      // ball must not fall asleep just because its temporary time scale is .1.
      const logicalVelocity=body.linvel(),logicalSpin=body.angvel();
      if(Math.hypot(logicalVelocity.x,logicalVelocity.y,logicalVelocity.z)> .05||Math.hypot(logicalSpin.x,logicalSpin.y,logicalSpin.z)> .05)body.wakeUp();
      const state = {
        body, scale: s, gravity: body.gravityScale(),
        linearDamping: body.linearDamping(), angularDamping: body.angularDamping(),
        force: vector(body.userForce()), torque: vector(body.userTorque()),
      };
      this._pending.push(state);
      body.setLinvel(scaled(body.linvel(), s), false);
      body.setAngvel(scaled(body.angvel(), s), false);
      body.setGravityScale(state.gravity * s * s, false);
      body.setLinearDamping(state.linearDamping * s);
      body.setAngularDamping(state.angularDamping * s);
      body.resetForces(false);
      body.addForce(scaled(state.force, s * s), false);
      body.resetTorques(false);
      body.addTorque(scaled(state.torque, s * s), false);
    }
    return this.scale;
  }

  afterStep() {
    for (const state of this._pending) {
      const { body, scale } = state;
      if (!body.isValid()) continue;
      // Crucially restore from the solver's NEW velocities, never a pre-step
      // snapshot: collision bounce, friction, forces and gravity are preserved.
      body.setLinvel(scaled(body.linvel(), 1 / scale), false);
      body.setAngvel(scaled(body.angvel(), 1 / scale), false);
      body.setGravityScale(state.gravity, false);
      body.setLinearDamping(state.linearDamping);
      body.setAngularDamping(state.angularDamping);
      body.resetForces(false);
      body.addForce(state.force, false);
      body.resetTorques(false);
      body.addTorque(state.torque, false);
    }
    this._pending.length = 0;
  }

  reset() {
    this.afterStep();
    this.scale = 1;
  }
}
