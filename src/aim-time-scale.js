// One wall-clock envelope for the whole simulation. Advance the world's fixed-
// step accumulator and animated gameplay by this scale; never multiply stored
// velocities by it. The caller decides whether any held ball is being aimed.
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;

export class AimTimeScale {
  constructor({ minimumScale = .4, attack = .12, release = .24 } = {}) {
    this.minimumScale = Math.min(1, Math.max(.05, finite(minimumScale, .4)));
    this.attack = Math.max(.001, finite(attack, .12));
    this.release = Math.max(.001, finite(release, .24));
    this.scale = 1;
  }

  // Pass false after either release or cancellation. Pause is an exact freeze,
  // even when the input gesture changed while paused; resume blends from here.
  update(realDt, aiming, { paused = false } = {}) {
    if (paused || !Number.isFinite(realDt) || realDt <= 0) return this.scale;
    const target = aiming ? this.minimumScale : 1;
    const tau = target < this.scale ? this.attack : this.release;
    this.scale += (target - this.scale) * -Math.expm1(-realDt / tau);
    if (Math.abs(this.scale - target) < 1e-6) this.scale = target;
    return this.scale;
  }

  reset() {
    this.scale = 1;
    return this.scale;
  }
}
