import { TUNE } from './config.js';

// The normalized Bomb is one unit tall. BonusWorld scales it by ball diameter
// * 1.3 and rests the model's bottom .012 above the table surface.
export const BOMB_LANDING_Y = TUNE.ballRadius * 1.3 + .012;

/** Keep automatic Bombs beside their carrier, inside the upper playing field.
 * Shared by host scoring and the released item, so short fields and tapered
 * rails cannot move a carefully placed Bomb to the empty lower controls. */
export function bombLandingPoint(point, bounds = {}) {
  const top = Number.isFinite(bounds.top) ? bounds.top + .81 : -Infinity;
  const mid = Number.isFinite(bounds.mid) ? bounds.mid : 0;
  const z = Math.max(top, Math.min(mid - .05, point.z));
  const half = typeof bounds.half === 'function' ? bounds.half(z)
    : Number.isFinite(bounds.half) ? bounds.half : 6.25;
  const limit = Math.max(.01, half - .71);
  return { x: Math.max(-limit, Math.min(limit, point.x)), z };
}
