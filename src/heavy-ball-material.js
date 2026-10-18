import { Color } from 'three';

export const HEAVY_GOLD_COLOR = 0xffc247;
const smooth = t => t * t * (3 - 2 * t);

/** Animate the two ball-only shared materials; never clone materials per ball.
 * Supply the chrome main material and the pink extras' InstancedMesh material.
 * dt is unpaused visual time; active comes from the shared Heavy inventory.
 */
export class HeavyBallMaterial {
  constructor({ mainMaterial, extraMaterial } = {}) {
    this.materials = [...new Set([mainMaterial, extraMaterial].filter(Boolean))].map(material => ({
      material,
      color: material.color.clone(),
      emissive: material.emissive.clone(),
      emissiveIntensity: material.emissiveIntensity,
    }));
    this.gold = new Color(HEAVY_GOLD_COLOR);
    this.glow = new Color(0xff9c26);
    this.disposed = false;
    this.reset();
  }

  // charges is optional: increases while already active replay a small glow.
  // A consumed charge does not interrupt gold while any shared charge remains.
  update(dt, active, charges) {
    if (this.disposed || !Number.isFinite(dt) || dt <= 0) return this.mix;
    active = Boolean(active);
    const count = Number.isFinite(charges) ? Math.max(0, charges) : null;
    if (active !== this.active) {
      this.active = active;
      this.from = this.mix;
      this.age = 0;
      this.duration = active ? .32 : .42;
      this.pulseAge = 0;
    } else if (active && count !== null && this.charges !== null && count > this.charges) {
      this.pulseAge = 0;
    }
    this.charges = count;
    this.age = Math.min(this.duration, this.age + dt);
    const target = active ? 1 : 0;
    this.mix = this.from + (target - this.from) * smooth(this.age / this.duration);
    if (this.age === this.duration) this.mix = target;
    this.pulseAge = Math.min(.36, this.pulseAge + dt);
    // Warm, brief pulse leaves metallic environment highlights readable.
    const pulse = this.pulseAge < .36 ? Math.sin(Math.PI * this.pulseAge / .36) ** 2 : 0;
    for (const state of this.materials) {
      const { material } = state;
      if (this.mix === 1) material.color.copy(this.gold);
      else material.color.copy(state.color).lerp(this.gold, this.mix);
      material.emissive.copy(state.emissive).lerp(this.glow, pulse * .3);
      material.emissiveIntensity = state.emissiveIntensity + pulse * .22;
      if (this.mix === 0 && pulse === 0) this.restore(state);
    }
    return this.mix;
  }

  restore({ material, color, emissive, emissiveIntensity }) {
    material.color.copy(color);
    material.emissive.copy(emissive);
    material.emissiveIntensity = emissiveIntensity;
  }

  reset() {
    this.active = false;
    this.charges = null;
    this.mix = 0;
    this.from = 0;
    this.age = this.duration = .42;
    this.pulseAge = .36;
    for (const state of this.materials) this.restore(state);
  }

  dispose() {
    this.reset();
    // Materials belong to the renderer, not this controller.
    this.disposed = true;
  }
}
