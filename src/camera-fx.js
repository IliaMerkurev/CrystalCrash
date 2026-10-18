// Deterministic camera feedback. Apply ABSOLUTE translation to the normal aim
// position and target; blend focus and dolly toward the Black Hole, compensating
// FOV in the camera integrator to preserve subject size. Pause with dt = 0.
export const CAMERA_FX_LIMITS = Object.freeze({ x: .42, y: .28, z: .18, translation: .5, dolly: .50, focusSeconds: 1.1, returnSeconds: .3 });

const TAU = Math.PI * 2;
const clamp01 = value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
const smoothstep = value => { const t = clamp01(value); return t * t * (3 - 2 * t); };
const smootherstep = value => { const t = clamp01(value); return t * t * t * (t * (t * 6 - 15) + 10); };
// Integrate a short smoothstep velocity ramp, then keep a steady approach.
// Normalization reaches the bounded endpoint exactly at the effect duration.
const dollyProgress = (age, duration) => {
 const ramp = Math.min(.08, duration * .5), t = Math.max(0, age);
 const u = Math.min(1, t / ramp);
 const distance = t < ramp ? ramp * (u * u * u - .5 * u * u * u * u) : t - ramp * .5;
 return clamp01(distance / (duration - ramp * .5));
};
const approach = (current, target, dt, seconds) => target + (current - target) * Math.exp(-dt / seconds);
const envelope = (age, duration, attack) => {
 if (age >= duration) return 0;
 const remaining = 1 - age / duration;
 return Math.sin(Math.min(1, age / attack) * Math.PI / 2) * remaining * remaining;
};

export class CameraFX {
 constructor() {
  // Reuse this result object; update never allocates geometry or per-frame arrays.
  this.offsets = { x: 0, y: 0, z: 0, focus: 0, dolly: 0 };
  this.reset();
 }
 reset() {
  this.time = 0;
  this.pulseAge = Infinity;
  this.bombAge = Infinity;
  this.lastPulseAt = -Infinity;
  this.pulseTokens = 2;
  this.wind = 0;
  this.holeActive = false;
  this.holeAge = this.returnAge = 0;
  this.focus = this.dolly = this.returnFocus = this.returnDolly = 0;
  this.startFocus = this.startDolly = 0;
  this.transition = false;
  this.visibility = 1;
  this.offsets.x = this.offsets.y = this.offsets.z = this.offsets.focus = this.offsets.dolly = 0;
  return this.offsets;
 }
 pulse() {
  // Two quick hits are allowed; sustained contact spam falls back to 1.5 pulses
  // per second. It cannot extend a continuously violent shake or stack strength.
  if (this.transition || this.time - this.lastPulseAt < .14 || this.pulseTokens < 1) return false;
  this.pulseTokens -= 1;
  this.lastPulseAt = this.time;
  this.pulseAge = 0;
  return true;
 }
 bomb() {
  if (this.transition) return false;
  this.bombAge = 0; // Replace the transient; repeated bombs never add amplitude.
  return true;
 }
 update(dt, { tornadoIntensity = 0, blackHoleActive = false, blackHoleDuration = 6, reducedMotion = false, transition = false } = {}) {
  // A paused frame is an exact freeze, even if incoming effect flags changed.
  if (!Number.isFinite(dt) || dt <= 0) return this.offsets;
  this.time += dt;
  this.pulseAge += dt;
  this.bombAge += dt;
  this.pulseTokens = Math.min(2, this.pulseTokens + dt * 1.5);
  this.transition = !!transition;
  this.visibility = approach(this.visibility, transition ? 0 : 1, dt, transition ? .16 : .35);
  const windTarget = transition ? 0 : clamp01(tornadoIntensity);
  this.wind = approach(this.wind, windTarget, dt, windTarget > this.wind ? .65 : .9);
  const focusActive = !!blackHoleActive && !transition;
  if (focusActive) {
   if (!this.holeActive) {
    this.holeAge = 0;
    this.startFocus = this.focus;
    this.startDolly = this.dolly;
   }
   this.holeAge += dt;
   const duration = Number.isFinite(blackHoleDuration) && blackHoleDuration > 0 ? blackHoleDuration : 6;
   this.focus = this.startFocus + (1 - this.startFocus) * smootherstep(this.holeAge / CAMERA_FX_LIMITS.focusSeconds);
   this.dolly = this.startDolly + (CAMERA_FX_LIMITS.dolly - this.startDolly) * dollyProgress(this.holeAge, duration);
  } else {
   if (this.holeActive) {
    this.returnAge = 0;
    this.returnFocus = this.focus;
    this.returnDolly = this.dolly;
   }
   this.returnAge += dt;
   const remaining = 1 - smoothstep(this.returnAge / CAMERA_FX_LIMITS.returnSeconds);
   this.focus = this.returnFocus * remaining;
   this.dolly = this.returnDolly * remaining;
  }
  this.holeActive = focusActive;
  if (this.wind < 1e-6 && windTarget === 0) this.wind = 0;

  const t = this.time, pulse = envelope(this.pulseAge, .19, .018), bomb = envelope(this.bombAge, 1.05, .025);
  // Fixed frequencies, not frame-random noise. The wind's 0.09–0.21 Hz movement
  // is broad and slow, while each impact is a short, smoothly decaying transient.
  let x = .075 * pulse * Math.sin(TAU * 15 * t + .4)
   + .42 * bomb * (.8 * Math.sin(TAU * 8 * t) + .2 * Math.sin(TAU * 13 * t + .7))
   + .27 * this.wind * (.82 * Math.sin(TAU * .13 * t) + .18 * Math.sin(TAU * .21 * t + .6));
  let y = .045 * pulse * Math.sin(TAU * 19 * t + 1.3)
   + .26 * bomb * Math.sin(TAU * 10 * t + 1.1)
   + .12 * this.wind * (.78 * Math.sin(TAU * .16 * t + .8) + .22 * Math.sin(TAU * .09 * t));
  let z = .025 * pulse * Math.sin(TAU * 12 * t + .9)
   + .14 * bomb * Math.sin(TAU * 7 * t + .6)
   + .065 * this.wind * Math.sin(TAU * .12 * t + 1.4);
  x = Math.max(-CAMERA_FX_LIMITS.x, Math.min(CAMERA_FX_LIMITS.x, x));
  y = Math.max(-CAMERA_FX_LIMITS.y, Math.min(CAMERA_FX_LIMITS.y, y));
  z = Math.max(-CAMERA_FX_LIMITS.z, Math.min(CAMERA_FX_LIMITS.z, z));
  const length = Math.hypot(x, y, z);
  const scale = this.visibility * (reducedMotion ? .08 : 1) * Math.min(1, CAMERA_FX_LIMITS.translation / Math.max(length, 1e-12));
  this.offsets.x = x * scale || 0;
  this.offsets.y = y * scale || 0;
  this.offsets.z = z * scale || 0;
  this.offsets.focus = this.focus * this.visibility * (reducedMotion ? .12 : 1) || 0;
  this.offsets.dolly = this.dolly * this.visibility * (reducedMotion ? .12 : 1) || 0;
  return this.offsets;
 }
}
