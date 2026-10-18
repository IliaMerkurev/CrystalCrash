// Stateful floor landings, kept separate from sustained rolling contact audio.
// The caller supplies ONLY eligible free balls (never held/parked/staged balls).
function supported(world, metadata, body) {
  for (let i = 0; i < body.numColliders(); i++) {
    const collider = body.collider(i);
    let found = false;
    world.contactPairsWith(collider, other => {
      if (found || metadata.get(other.handle)?.kind !== 'table') return;
      world.contactPair(collider, other, manifold => {
        if (manifold.numSolverContacts() > 0 && Math.abs(manifold.normal().y) > .65) found = true;
      });
    });
    if (found) return true;
  }
  return false;
}

export class BallLandingAudio {
  constructor({ minimumAirTime = .04, minimumImpactSpeed = .65, cooldown = .12 } = {}) {
    this.minimumAirTime = minimumAirTime;
    this.minimumImpactSpeed = minimumImpactSpeed;
    this.cooldown = cooldown;
    this._states = new Map();
    this._pending = [];
  }

  // Call immediately before world.step, AFTER selective velocity scaling. The
  // multiplier is only the remaining global wall-clock scale, not selective
  // scale again. Alternatively call before scaling with its full actual scale.
  beforeStep(world, colliderMetadata, bodies, dt, actualSpeedScale = 1) {
    this._pending.length = 0;
    const elapsed = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    const scale = Number.isFinite(actualSpeedScale) ? Math.max(0, Math.min(1, actualSpeedScale)) : 1;
    const seen = new Set();
    for (const body of bodies ?? []) {
      if (!body?.isValid() || !body.isDynamic() || seen.has(body.handle)) continue;
      seen.add(body.handle);
      let state = this._states.get(body.handle);
      if (!state || state.body !== body) {
        state = { body, airborne: 0, cooldown: 0 };
        this._states.set(body.handle, state);
      }
      state.cooldown = Math.max(0, state.cooldown - elapsed);
      const grounded = supported(world, colliderMetadata, body);
      // A new grounded spawn has no airborne history, even before its first
      // contact manifold exists: the short airborne qualification filters it.
      state.airborne = grounded ? 0 : state.airborne + elapsed;
      if (elapsed > 0) this._pending.push({ state, grounded, impactSpeed: Math.max(0, -body.linvel().y * scale) });
    }
    // Dropped eligibility and removed balls lose history immediately; storage
    // is bounded by the current eligible set, including during level changes.
    for (const handle of this._states.keys()) if (!seen.has(handle)) this._states.delete(handle);
  }

  afterStep(world, colliderMetadata) {
    const events = [];
    for (const { state, grounded, impactSpeed } of this._pending) {
      const { body } = state;
      if (!body.isValid() || !body.isDynamic()) {
        this._states.delete(body.handle);
        continue;
      }
      if (!supported(world, colliderMetadata, body)) continue;
      if (!grounded && state.airborne >= this.minimumAirTime && impactSpeed > this.minimumImpactSpeed && state.cooldown <= 0) {
        events.push({ body, impactSpeed, strength: Math.min(1, impactSpeed / 8) });
        state.cooldown = this.cooldown;
      }
      state.airborne = 0;
    }
    this._pending.length = 0;
    return events;
  }

  reset() {
    this._states.clear();
    this._pending.length = 0;
  }
}
