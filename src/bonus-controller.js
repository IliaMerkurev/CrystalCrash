/** Distances are multiples of the main ball's diameter; time is simulation seconds. */
export const BONUS_DEFS = Object.freeze({
  pulse: Object.freeze({ kind: 'pulse', name: 'Pulse', color: 0xffb44a, colorCss: '#FFB44A', charges: 1, radiusD: 2.2, maxTargets: 6, damage: 1 }),
  pierce: Object.freeze({ kind: 'pierce', name: 'Pierce', color: 0x44d9ff, colorCss: '#44D9FF', charges: 3, duration: 6, damage: 1 }),
  arc: Object.freeze({ kind: 'arc', name: 'Arc', color: 0xb68cff, colorCss: '#B68CFF', charges: 1, hopRadiusD: 2.5, maxHops: 3, damage: 1 }),
  frost: Object.freeze({ kind: 'frost', name: 'Frost', color: 0xb8e9f5, colorCss: '#B8E9F5', charges: 3, duration: 6, maxTargets: 3, bonusDamage: 1 }),
  split: Object.freeze({ kind: 'split', name: 'Split', color: 0xf27ed2, colorCss: '#F27ED2', charges: 1, echoCount: 2, duration: 10, hitsPerEcho: 4, angleDegrees: 18, damage: 1 }),
  gravity: Object.freeze({ kind: 'gravity', name: 'Gravity Well', color: 0x7887ff, colorCss: '#7887FF', charges: 1, radiusD: 3, duration: 2, maxTargets: 4, accelerationD: 2, maxDeltaSpeedD: 2 }),
  heavy: Object.freeze({ kind: 'heavy', name: 'Heavy Hit', color: 0xe98745, colorCss: '#E98745', charges: 1, damage: 3 }),
  halo: Object.freeze({ kind: 'halo', name: 'Safety Halo', color: 0xff777d, colorCss: '#FF777D', charges: 1 }),
});

/**
 * Physics-free bonus inventory. Caller owns damage, target selection and collision filters.
 *
 * Per simulation step: tick(elapsed), then process valid direct glass contacts, then
 * pickups. Capture once before the entire physics contact batch, call consumeDirect
 * for each VALID hit, apply its direct damage and then its effect. Never call for resting contacts,
 * fragments, gates, pickups, or indirect bonus damage. Use persistent original cube
 * IDs (not collider/fragment IDs). The batch snapshot prevents spending queued powers
 * in that same step. Caller owns ordinary hit energy/cooldown validity.
 *
 * Pierce suppresses glass reflection from arming through its exit phase. tick can
 * enter exit even without a collision. During exit, no new glass damage is allowed.
 * Call finishPierceExit ONLY when the ball overlaps no glass. This arms the queue.
 * Use simulation elapsed seconds that stop advancing while paused, not wall time.
 */
export class BonusController {
  constructor() {
    this._serial = 0;
    this.reset();
  }

  reset() {
    this.active = null;
    this.queued = null;
    this.halo = false;
    this.frostMarks = new Map();
    this._time = 0;
    this._epoch = ++this._serial;
    this._tokens = new WeakSet();
  }

  _makeAttack(kind) {
    return { kind, id: ++this._serial, remaining: BONUS_DEFS[kind].charges,
      startedAt: null, seen: new Set(), exiting: false };
  }

  /** Only remove a physical pickup when accepted is true. */
  collect(kind) {
    const def = Object.prototype.hasOwnProperty.call(BONUS_DEFS, kind) ? BONUS_DEFS[kind] : null;
    if (!def) return { accepted: false, slot: null, message: 'Unknown power' };
    if (kind === 'halo') {
      if (this.halo) return { accepted: false, slot: null, message: 'One save already ready' };
      this.halo = true;
      return { accepted: true, slot: 'halo', message: 'One save ready' };
    }
    if (!this.active) {
      this.active = this._makeAttack(kind);
      return { accepted: true, slot: 'active', message: `${def.name} ready` };
    }
    if (!this.queued) {
      this.queued = this._makeAttack(kind);
      return { accepted: true, slot: 'queued', message: `${def.name} queued` };
    }
    return { accepted: false, slot: null, message: 'Use a power first' };
  }

  get pierceExit() { return this.active?.kind === 'pierce' && this.active.exiting; }
  get suppressReflection() { return this.active?.kind === 'pierce'; }
  get isPiercing() { return this.suppressReflection; }

  /** Opaque contact-batch snapshot; do not recapture during a physics contact loop. */
  capture() {
    const token = Object.freeze({ epoch: this._epoch, id: this.active?.id ?? null,
      kind: this.active?.kind ?? null, pierceExit: this.pierceExit,
      suppressReflection: this.suppressReflection });
    this._tokens.add(token);
    return token;
  }

  _advance() {
    this.active = this.queued;
    this.queued = null;
  }

  /** Update before resolving physics contacts. The timer starts at first valid Pierce hit. */
  tick(now) {
    if (!Number.isFinite(now)) throw new TypeError('Bonus time must be finite simulation seconds');
    this._time = Math.max(this._time, now);
    const expiredFrostIds = [];
    for (const [id, expiresAt] of this.frostMarks) {
      if (expiresAt <= this._time) { this.frostMarks.delete(id); expiredFrostIds.push(id); }
    }
    const a = this.active;
    if (a?.kind === 'pierce' && a.startedAt !== null &&
        this._time - a.startedAt >= BONUS_DEFS.pierce.duration) a.exiting = true;
    return { pierceExit: this.pierceExit, suppressReflection: this.suppressReflection, expiredFrostIds };
  }

  _directDamage(originalId, baseDamage, result) {
    const brittle = this.frostMarks.has(originalId);
    if (brittle) this.frostMarks.delete(originalId);
    result.frostConsumed = brittle;
    return baseDamage + (brittle ? BONUS_DEFS.frost.bonusDamage : 0);
  }

  /**
   * Returns permission for direct damage and a secondary-effect descriptor.
   * Pulse excludes originId; Arc excludes originId and every already visited target.
   * Select nearest live original cubes using a stable ID tie-break; effects never hit
   * gates and never invoke this method recursively. Snapshot origin position BEFORE
   * direct damage destroys its body, so the caller can anchor the returned effect.
   */
  consumeDirect(snapshot, originalId, now = this._time) {
    const originId = originalId;
    this.tick(now);
    const result = { damage: 0, effect: null, consumed: false,
      suppressReflection: this.suppressReflection, pierceExit: this.pierceExit };
    if (!snapshot || !this._tokens.has(snapshot) ||
        snapshot.epoch !== this._epoch || originalId === null || originalId === undefined) return result;
    // A contact begun before pickup remains an ordinary hit, never spending the new power.
    if (snapshot.kind === null) {
      if (!this.pierceExit) result.damage = this._directDamage(originalId, 1, result);
      result.suppressReflection = snapshot.suppressReflection;
      return result;
    }
    const a = this.active;
    // Later valid contacts in this batch do ordinary damage without spending the queue.
    if (!a || a.id !== snapshot.id) {
      if (!this.pierceExit) result.damage = this._directDamage(originalId, 1, result);
      result.suppressReflection = snapshot.suppressReflection;
      return result;
    }
    if (a.kind === 'pierce') {
      result.suppressReflection = true;
      if (a.exiting || a.seen.has(originalId)) return result;
      if (a.startedAt === null) a.startedAt = this._time;
      a.seen.add(originalId);
      a.remaining -= 1;
      result.damage = this._directDamage(originalId, 1, result);
      result.consumed = true;
      if (a.remaining === 0) a.exiting = true;
      result.pierceExit = a.exiting;
      return result;
    }
    const def = BONUS_DEFS[a.kind];
    result.damage = this._directDamage(originalId, a.kind === 'heavy' ? def.damage : 1, result);
    result.suppressReflection = false;
    // Echoes do not call consumeDirect: they cannot spend powers or brittle marks.
    if (a.kind === 'split' && a.startedAt !== null) return result;
    result.consumed = true;
    if (a.kind === 'frost') {
      // The next three direct hits spend charges, but each original cube is marked once.
      if (!a.seen.has(originalId)) {
        a.seen.add(originalId);
        const expiresAt = this._time + def.duration;
        this.frostMarks.set(originalId, expiresAt);
        result.effect = Object.freeze({ kind: 'frost', originId, duration: def.duration, expiresAt });
      }
      a.remaining -= 1;
      if (a.remaining === 0) this._advance();
    } else if (a.kind === 'split') {
      a.startedAt = this._time;
      a.remaining = 0;
      result.effect = Object.freeze({ kind: 'split', originId, activationId: a.id,
        echoCount: def.echoCount, duration: def.duration, hitsPerEcho: def.hitsPerEcho,
        angleDegrees: def.angleDegrees, damage: def.damage });
      // Caller removes expired/lost echoes and confirms the last one with finishSplit().
    } else {
      if (a.kind === 'pulse') result.effect = Object.freeze({ kind: 'pulse', originId,
        radiusD: def.radiusD, maxTargets: def.maxTargets, damage: def.damage });
      else if (a.kind === 'arc') result.effect = Object.freeze({ kind: 'arc', originId,
        hopRadiusD: def.hopRadiusD, maxHops: def.maxHops, damage: def.damage });
      else if (a.kind === 'gravity') result.effect = Object.freeze({ kind: 'gravity', originId,
        radiusD: def.radiusD, duration: def.duration, maxTargets: def.maxTargets,
        accelerationD: def.accelerationD, maxDeltaSpeedD: def.maxDeltaSpeedD,
        targetType: 'intact-cube' });
      else if (a.kind === 'heavy') result.effect = Object.freeze({ kind: 'heavy', originId,
        damage: result.damage });
      this._advance();
    }
    return result;
  }

  /** Caller asserts no glass overlaps remain; do not call while embedded in any cube. */
  finishPierceExit() {
    if (!this.pierceExit) return false;
    this._advance();
    return true;
  }

  /** Call once all echoes are gone. An activation ID protects against stale callbacks. */
  finishSplit(activationId = this.active?.id) {
    const a = this.active;
    if (a?.kind !== 'split' || a.startedAt === null || a.id !== activationId) return false;
    this._advance();
    return true;
  }

  /** Check before ANY main-ball loss boundary; caller restores safe control without firing. */
  consumeHalo() {
    if (!this.halo) return false;
    this.halo = false;
    return true;
  }

  snapshotHUD() {
    const describe = a => a ? {
      kind: a.kind, name: BONUS_DEFS[a.kind].name, color: BONUS_DEFS[a.kind].color,
      charges: a.remaining, remaining: a.remaining, exiting: a.exiting,
      started: a.startedAt !== null,
      secondsLeft: ['pierce', 'split'].includes(a.kind)
        ? (a.startedAt === null ? BONUS_DEFS[a.kind].duration
          : Math.max(0, BONUS_DEFS[a.kind].duration - (this._time - a.startedAt)))
        : null,
    } : null;
    return { active: describe(this.active), queued: describe(this.queued), halo: this.halo,
      frostMarks: Object.freeze([...this.frostMarks].map(([originId, expiresAt]) => Object.freeze({ originId, expiresAt, secondsLeft: Math.max(0, expiresAt - this._time) }))),
      pierceExit: this.pierceExit, suppressReflection: this.suppressReflection };
  }
}
