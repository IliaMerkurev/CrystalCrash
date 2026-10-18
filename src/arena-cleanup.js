// Schedules ordinary single-damage strikes without knowing about physics,
// rendering, rewards, or position. The caller supplies ONLY originals with
// nonempty surviving structural cell ids; detached debris does not qualify.
export class ArenaCleanup {
  constructor({ interval = 1, isDamaged = original => original.hits > 0 } = {}) {
    if (!Number.isFinite(interval) || interval <= 0) throw new RangeError('Cleanup interval must be positive');
    this.interval = interval;
    this.isDamaged = isDamaged;
    this.reset();
  }

  reset() {
    this.targetId = null;
    this.waited = 0;
  }

  // dt is simulation time, not wall time. Return at most one original per
  // update; the caller applies one normal hit. Never mutate supplied objects.
  // Damage must be explicit history (original.hits), not displacement, cluster
  // count, or an assumption based on a survivor's current shape.
  update(dt, liveOriginals) {
    const originals = [...liveOriginals];
    if (!originals.length || originals.some(original => !this.isDamaged(original))) {
      this.reset();
      return null;
    }
    const target = originals.find(original => original.id === this.targetId) || originals[0];
    this.targetId = target.id;
    if (!Number.isFinite(dt) || dt <= 0) return null;
    this.waited += dt;
    if (this.waited + 1e-9 < this.interval) return null;
    // Discard excess elapsed time: a long frame cannot create a strike burst,
    // either now or on subsequent frames. Next strike waits a full interval.
    this.waited = 0;
    return target;
  }
}
