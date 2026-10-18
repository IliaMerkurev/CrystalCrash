/** Distances are multiples of the main ball's diameter; time is simulation seconds. */
export const BONUS_DEFS = Object.freeze({
  pulse: Object.freeze({ kind: 'pulse', name: 'Pulse', color: 0xffb44a, colorCss: '#FFB44A', duration: 10, radiusD: 4.4, maxTargets: Infinity, damage: 3, description: '10 seconds: every ball impact blasts nearby cubes for 3 damage' }),
  pierce: Object.freeze({ kind: 'pierce', name: 'Pierce', color: 0x44d9ff, colorCss: '#44D9FF', duration: 10, damage: 8, description: '10 seconds of smashing straight through cubes' }),
  arc: Object.freeze({ kind: 'arc', name: 'Arc', color: 0xb68cff, colorCss: '#B68CFF', charges: 1, radiusD: 4.4, targetType: 'bottom-support-original', damage: 1, description: 'One hit per bottom support, chaining within 4.4 ball diameters' }),
  frost: Object.freeze({ kind: 'frost', name: 'Frost', color: 0xb8e9f5, colorCss: '#B8E9F5', duration: 10, markDuration: 10, bonusDamage: 1, description: '10 seconds of marking cubes for a stronger next hit' }),
  split: Object.freeze({ kind: 'split', name: 'Split', color: 0xf27ed2, colorCss: '#F27ED2', charges: 1, echoCount: 2, sourceType: 'all-live-balls', persistent: true, angleDegrees: 18, damage: 1, description: 'Every live ball creates two more; collect again to multiply them' }),
  gravity: Object.freeze({ kind: 'gravity', name: 'Tornado', color: 0x7887ff, colorCss: '#7887FF', charges: 1, radiusD: 6, duration: 4, maxTargets: 12, accelerationD: 35, maxDeltaSpeedD: 24, description: 'Spins nearby cubes in a tornado for 4 seconds' }),
  bomb: Object.freeze({ kind: 'bomb', name: 'Bomb', color: 0xff9438, colorCss: '#FF9438', automatic: true, countdown: 5, radiusD: 4.4, damage: 8, maxBallSpeed: 30, kickSpeed: 22, description: 'Automatically explodes after 5 seconds, blasting nearby cubes and kicking balls away' }),
  blackhole: Object.freeze({ kind: 'blackhole', name: 'Black Hole', color: 0x8e49ff, colorCss: '#8E49FF', charges: 1, duration: 6, radiusD: 8, rampDuration: 2, acceleration: 50, speedCap: 14, maxTargets: 64, description: 'Pulls nearby cubes inward for 6 seconds, building strength over 2 seconds' }),
  heavy: Object.freeze({ kind: 'heavy', name: 'Heavy Hit', color: 0xe98745, colorCss: '#E98745', charges: 1, damage: 3, description: 'The next direct hit deals 3 damage' }),
  halo: Object.freeze({ kind: 'halo', name: 'Safety Halo', color: 0xff777d, colorCss: '#FF777D', charges: 1, description: 'One automatic rescue from a fall' }),
});

/**
 * Physics-free bonus inventory. Caller owns damage, target selection and collision filters.
 *
 * Per simulation step: tick(elapsed), then process valid direct glass contacts, then
 * pickups from any live ball. All balls share this inventory and one snapshot:
 * capture once before the entire physics contact batch, call consumeDirect for
 * each VALID direct ball hit, apply its direct damage and then its effect. Never call for resting contacts,
 * fragments, gates, pickups, or indirect bonus damage. Use persistent original cube
 * IDs (not collider/fragment IDs). The batch snapshot prevents spending queued powers
 * in that same step. Caller owns ordinary hit energy/cooldown validity.
 *
 * Pierce suppresses glass reflection from arming through its exit phase. tick can
 * enter exit even without a collision. During exit, no new glass damage is allowed.
 * Its original-target deduplication is shared by all balls. Call finishPierceExit
 * ONLY when every live ball overlaps no glass. This arms the queue.
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
    this.splitActive = false;
    this.splitActivationId = null;
    this.frostMarks = new Map();
    this._time = 0;
    this._epoch = ++this._serial;
    this._tokens = new WeakSet();
  }

  _makeAttack(kind) {
    return { kind, id: ++this._serial, remaining: BONUS_DEFS[kind].charges ?? null,
      startedAt: null, seen: new Set(), exiting: false };
  }

  /** Only remove a physical pickup when accepted is true. */
  collect(kind) {
    const def = Object.prototype.hasOwnProperty.call(BONUS_DEFS, kind) ? BONUS_DEFS[kind] : null;
    if (!def) return { accepted: false, slot: null, message: 'Unknown power' };
    if (def.automatic) return { accepted: false, slot: null, message: `${def.name} is automatic and does not use inventory` };
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

  /** Update before contacts. Pulse/Pierce/Frost timers start at their first valid hit. */
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
    if (['pulse', 'frost'].includes(a?.kind) && a.startedAt !== null &&
        this._time - a.startedAt >= BONUS_DEFS[a.kind].duration) this._advance();
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
   * Pulse excludes originId, which already receives the same burst damage directly.
   * Arc chains through nearby bottom/support originals within radiusD per hop.
   * Caller tracks visited originals, including the direct-hit origin, so each
   * original receives at most one hit per discharge. Effects never hit
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
      result.damage = this._directDamage(originalId, BONUS_DEFS.pierce.damage, result);
      result.consumed = true;
      result.pierceExit = a.exiting;
      return result;
    }
    const def = BONUS_DEFS[a.kind];
    result.damage = this._directDamage(originalId, ['heavy', 'pulse'].includes(a.kind) ? def.damage : 1, result);
    result.suppressReflection = false;
    // Main and secondary balls spend the same attack and brittle marks.
    result.consumed = true;
    if (a.kind === 'pulse') {
      if (a.startedAt === null) a.startedAt = this._time;
      // Every valid direct ball impact triggers a blast for the shared duration.
      // The caller filters resting/duplicate contacts and never recurses from AoE.
      // No lifetime target set: a later impact may blast the same original again.
      result.effect = Object.freeze({ kind: 'pulse', originId,
        radiusD: def.radiusD, maxTargets: def.maxTargets, damage: def.damage });
    } else if (a.kind === 'frost') {
      if (a.startedAt === null) a.startedAt = this._time;
      // Mark a hit cube, then consume that mark on its next hit. While the timer
      // runs a surviving cube can be marked again, with no target or hit budget.
      if (!result.frostConsumed) {
        const expiresAt = this._time + def.markDuration;
        this.frostMarks.set(originalId, expiresAt);
        result.effect = Object.freeze({ kind: 'frost', originId, duration: def.markDuration, expiresAt });
      }
    } else if (a.kind === 'split') {
      a.startedAt = this._time;
      this.splitActive = true;
      this.splitActivationId = a.id;
      result.effect = Object.freeze({ kind: 'split', originId, activationId: a.id,
        echoCount: def.echoCount, sourceType: def.sourceType, persistent: true,
        angleDegrees: def.angleDegrees, damage: def.damage });
      // Extra balls remain independently of the FIFO; caller confirms their loss.
      this._advance();
    } else {
      if (a.kind === 'arc') result.effect = Object.freeze({ kind: 'arc', originId,
        radiusD: def.radiusD, targetType: def.targetType, damage: def.damage });
      else if (a.kind === 'gravity') result.effect = Object.freeze({ kind: 'gravity', originId,
        radiusD: def.radiusD, duration: def.duration, maxTargets: def.maxTargets,
        accelerationD: def.accelerationD, maxDeltaSpeedD: def.maxDeltaSpeedD,
        targetType: 'intact-cube' });
      else if (a.kind === 'blackhole') result.effect = Object.freeze({ kind: 'blackhole', originId,
        duration: def.duration, radiusD: def.radiusD, rampDuration: def.rampDuration,
        acceleration: def.acceleration, speedCap: def.speedCap, maxTargets: def.maxTargets });
      else if (a.kind === 'heavy') result.effect = Object.freeze({ kind: 'heavy', originId,
        damage: result.damage });
      this._advance();
    }
    return result;
  }

  /** Caller asserts no live ball overlaps glass; do not finish while any is embedded. */
  finishPierceExit() {
    if (!this.pierceExit) return false;
    this._advance();
    return true;
  }

  /**
   * Caller asserts no physical extra balls remain, across every Split generation.
   * Activation IDs are diagnostic only: the last surviving ball may come from an
   * older activation. This notification never advances or clears the attack FIFO.
   */
  finishSplit() {
    if (!this.splitActive) return false;
    this.splitActive = false;
    this.splitActivationId = null;
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
      description: BONUS_DEFS[a.kind].description,
      charges: a.remaining, remaining: a.remaining, exiting: a.exiting,
      started: a.startedAt !== null,
      secondsLeft: ['pulse', 'pierce', 'frost'].includes(a.kind)
        ? (a.startedAt === null ? BONUS_DEFS[a.kind].duration
          : Math.max(0, BONUS_DEFS[a.kind].duration - (this._time - a.startedAt)))
        : null,
    } : null;
    return { active: describe(this.active), queued: describe(this.queued), halo: this.halo,
      splitActive: this.splitActive, splitActivationId: this.splitActivationId,
      frostMarks: Object.freeze([...this.frostMarks].map(([originId, expiresAt]) => Object.freeze({ originId, expiresAt, secondsLeft: Math.max(0, expiresAt - this._time) }))),
      pierceExit: this.pierceExit, suppressReflection: this.suppressReflection };
  }
}
