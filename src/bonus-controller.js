/** Distances are multiples of the main ball's diameter; time is simulation seconds. */
export const BONUS_DEFS = Object.freeze({
  pulse: Object.freeze({ kind: 'pulse', name: 'Pulse', color: 0xffb44a, colorCss: '#FFB44A', duration: 10, radiusD: 4.4, maxTargets: Infinity, damage: 3, description: 'On pickup, 10 seconds: every ball impact blasts nearby cubes for 3 damage' }),
  pierce: Object.freeze({ kind: 'pierce', name: 'Pierce', color: 0x44d9ff, colorCss: '#44D9FF', duration: 10, damage: 8, description: 'On pickup, 10 seconds of smashing straight through cubes' }),
  arc: Object.freeze({ kind: 'arc', name: 'Arc', color: 0xb68cff, colorCss: '#B68CFF', charges: 1, radiusD: 4.4, targetType: 'bottom-support-original', damage: 1, description: 'On pickup, one hit per bottom support, chaining within 4.4 ball diameters' }),
  frost: Object.freeze({ kind: 'frost', name: 'Frost', color: 0xb8e9f5, colorCss: '#B8E9F5', duration: 10, markDuration: 10, bonusDamage: 1, description: 'On pickup, 10 seconds of marking cubes for a stronger next hit' }),
  split: Object.freeze({ kind: 'split', name: 'Split', color: 0xf27ed2, colorCss: '#F27ED2', charges: 1, echoCount: 2, sourceType: 'all-live-balls', persistent: true, angleDegrees: 18, damage: 1, description: 'On pickup, every live ball creates two more; collect again to multiply them' }),
  gravity: Object.freeze({ kind: 'gravity', name: 'Tornado', color: 0x7887ff, colorCss: '#7887FF', charges: 1, radiusD: 6, duration: 4, maxTargets: 12, accelerationD: 35, maxDeltaSpeedD: 24, description: 'On pickup, spins nearby cubes in a tornado for 4 seconds' }),
  bomb: Object.freeze({ kind: 'bomb', name: 'Bomb', color: 0xff9438, colorCss: '#FF9438', automatic: true, countdown: 5, radiusD: 4.4, damage: 8, maxBallSpeed: 30, kickSpeed: 22, description: 'Automatically explodes after 5 seconds, blasting nearby cubes and kicking balls away' }),
  blackhole: Object.freeze({ kind: 'blackhole', name: 'Black Hole', color: 0x8e49ff, colorCss: '#8E49FF', charges: 1, duration: 6, radiusD: 8, rampDuration: 2, acceleration: 50, speedCap: 14, maxTargets: 64, description: 'On pickup, pulls nearby cubes inward for 6 seconds, building strength over 2 seconds' }),
  heavy: Object.freeze({ kind: 'heavy', name: 'Heavy Hit', color: 0xe98745, colorCss: '#E98745', charges: 1, damage: 3, description: 'Stores a 3-damage charge for the next direct hit; collect again to add charges' }),
});

/** Shared immediate-activation inventory; distances use the main ball diameter.
 * Tick with monotonic paused simulation time before contacts and pickups. Capture
 * once for the whole contact batch across all balls. Only valid direct contacts
 * call consumeDirect; indirect damage never recursively activates bonuses.
 */
export class BonusController {
  constructor() { this._serial = 0; this.reset(); }

  reset() {
    this.attacks = new Map();
    this.splitActive = false;
    this.splitActivationId = null;
    this.frostMarks = new Map();
    this._time = 0;
    this._epoch = ++this._serial;
    this._tokens = new WeakSet();
  }

  // Compatibility for single-accent callers. Every actual buff is in attacks.
  get active() {
    let newest = null;
    for (const attack of this.attacks.values()) if (!newest || attack.id > newest.id) newest = attack;
    return newest;
  }
  has(kind) { return kind === 'split' ? this.splitActive : this.attacks.has(kind); }
  get pierceExit() { return this.attacks.get('pierce')?.exiting ?? false; }
  get suppressReflection() { return this.attacks.has('pierce'); }
  get isPiercing() { return this.suppressReflection; }

  /** All valid pickups activate now. Automatic floor effects never enter inventory. */
  collect(kind) {
    const def = Object.prototype.hasOwnProperty.call(BONUS_DEFS, kind) ? BONUS_DEFS[kind] : null;
    if (!def) return {kind, accepted: false, message: 'Unknown power'};
    if (def.automatic) return {kind, accepted: false, message: `${def.name} is automatic and does not use inventory`};
    const id = ++this._serial;
    if (['pulse', 'pierce', 'frost'].includes(kind)) {
      const prior = this.attacks.get(kind);
      const expiresAt = Math.max(this._time, prior?.expiresAt ?? this._time) + def.duration;
      this.attacks.set(kind, {kind, id, startedAt: prior?.startedAt ?? this._time,
        expiresAt, remaining: null, exiting: false, seen: prior?.seen ?? new Set()});
      return {kind, accepted: true, message: `${def.name} active · ${Math.ceil(expiresAt - this._time)}s`};
    }
    if (kind === 'heavy') {
      const remaining = (this.attacks.get(kind)?.remaining ?? 0) + def.charges;
      this.attacks.set(kind, {kind, id, startedAt: this._time, expiresAt: null, remaining, exiting: false});
      return {kind, accepted: true, message: `${def.name} · ${remaining} charge${remaining === 1 ? '' : 's'}`};
    }
    let effect;
    if (kind === 'split') {
      this.splitActive = true;
      this.splitActivationId = id;
      effect = {kind, activationId: id, originId: null, echoCount: def.echoCount,
        sourceType: def.sourceType, persistent: true, angleDegrees: def.angleDegrees, damage: def.damage};
    } else if (kind === 'arc') {
      effect = {kind, originId: null, radiusD: def.radiusD, targetType: def.targetType, damage: def.damage};
    } else if (kind === 'gravity') {
      effect = {kind, originId: null, radiusD: def.radiusD, duration: def.duration,
        maxTargets: def.maxTargets, accelerationD: def.accelerationD,
        maxDeltaSpeedD: def.maxDeltaSpeedD, targetType: 'intact-cube'};
    } else if (kind === 'blackhole') {
      effect = {kind, originId: null, duration: def.duration, radiusD: def.radiusD,
        rampDuration: def.rampDuration, acceleration: def.acceleration,
        speedCap: def.speedCap, maxTargets: def.maxTargets};
    }
    return {kind, accepted: true, message: `${def.name} activated`, effect: Object.freeze(effect)};
  }

  /** Each pickup gets a fresh ID, so earlier contacts cannot spend a later pickup. */
  capture() {
    const activationIds = Object.freeze(Object.fromEntries([...this.attacks].map(([kind, a]) => [kind, a.id])));
    const token = Object.freeze({epoch: this._epoch, activationIds,
      id: this.active?.id ?? null, kind: this.active?.kind ?? null,
      pierceExit: this.pierceExit, suppressReflection: this.suppressReflection});
    this._tokens.add(token);
    return token;
  }

  tick(now) {
    if (!Number.isFinite(now)) throw new TypeError('Bonus time must be finite simulation seconds');
    this._time = Math.max(this._time, now);
    const expiredFrostIds = [];
    for (const [id, expiresAt] of this.frostMarks) if (expiresAt <= this._time) {
      this.frostMarks.delete(id); expiredFrostIds.push(id);
    }
    for (const [kind, attack] of this.attacks) if (attack.expiresAt !== null && attack.expiresAt <= this._time) {
      if (kind === 'pierce') attack.exiting = true;
      else this.attacks.delete(kind);
    }
    return {pierceExit: this.pierceExit, suppressReflection: this.suppressReflection, expiredFrostIds};
  }

  /** Pulse excludes the direct-hit origin; secondary effects must not call back.
   * Pierce deduplicates originals across all balls. At expiry only an embedded
   * ball is blocked; other buffs still work for nonpenetrating direct contacts.
   */
  consumeDirect(snapshot, originalId, now = this._time, {penetrating = false} = {}) {
    this.tick(now);
    const result = {damage: 0, effects: [], effect: null, consumed: false,
      pierced: false, frostConsumed: false,
      suppressReflection: this.suppressReflection, pierceExit: this.pierceExit};
    if (!snapshot || !this._tokens.has(snapshot) || snapshot.epoch !== this._epoch || originalId == null) return result;
    result.suppressReflection = snapshot.suppressReflection;
    if (this.pierceExit && penetrating) return result;
    const captured = kind => {
      const attack = this.attacks.get(kind);
      return attack && snapshot.activationIds[kind] === attack.id ? attack : null;
    };
    const pierce = captured('pierce'), pulse = captured('pulse'), frost = captured('frost'), heavy = captured('heavy');
    if (pierce && !pierce.exiting) {
      if (pierce.seen.has(originalId)) return result;
      pierce.seen.add(originalId);
      result.pierced = true;
    }
    let damage = 1;
    if (result.pierced) damage = Math.max(damage, BONUS_DEFS.pierce.damage);
    if (pulse) damage = Math.max(damage, BONUS_DEFS.pulse.damage);
    if (heavy) damage = Math.max(damage, BONUS_DEFS.heavy.damage);
    if (this.frostMarks.has(originalId)) {
      this.frostMarks.delete(originalId);
      result.frostConsumed = true;
      damage += BONUS_DEFS.frost.bonusDamage;
    }
    result.damage = damage;
    result.consumed = !!(result.pierced || pulse || frost || heavy);
    if (pulse) result.effects.push(Object.freeze({kind: 'pulse', originId: originalId,
      radiusD: BONUS_DEFS.pulse.radiusD, maxTargets: BONUS_DEFS.pulse.maxTargets, damage: BONUS_DEFS.pulse.damage}));
    if (frost && !result.frostConsumed) {
      const duration = BONUS_DEFS.frost.markDuration, expiresAt = this._time + duration;
      this.frostMarks.set(originalId, expiresAt);
      result.effects.push(Object.freeze({kind: 'frost', originId: originalId, duration, expiresAt}));
    }
    if (heavy) {
      heavy.remaining--;
      if (heavy.remaining <= 0) this.attacks.delete('heavy');
      result.effects.push(Object.freeze({kind: 'heavy', originId: originalId, damage}));
    }
    result.effect = result.effects[0] ?? null;
    return result;
  }

  /** Call only after every live ball has left all glass volumes. */
  finishPierceExit() {
    if (!this.pierceExit) return false;
    this.attacks.delete('pierce');
    return true;
  }

  /** Call only when no extra balls remain across all Split generations. */
  finishSplit() {
    if (!this.splitActive) return false;
    this.splitActive = false;
    this.splitActivationId = null;
    return true;
  }

  snapshotHUD() {
    const describe = a => ({id: a.id, kind: a.kind, name: BONUS_DEFS[a.kind].name,
      color: BONUS_DEFS[a.kind].color, description: BONUS_DEFS[a.kind].description,
      charges: a.remaining, remaining: a.remaining, started: true, exiting: a.exiting,
      secondsLeft: a.expiresAt === null ? null : Math.max(0, a.expiresAt - this._time)});
    const activeEffects = [...this.attacks.values()].sort((a, b) => b.id - a.id).map(describe);
    return {active: activeEffects[0] ?? null, activeEffects,
      splitActive: this.splitActive, splitActivationId: this.splitActivationId,
      frostMarks: Object.freeze([...this.frostMarks].map(([originId, expiresAt]) => Object.freeze({originId, expiresAt, secondsLeft: Math.max(0, expiresAt - this._time)}))),
      pierceExit: this.pierceExit, suppressReflection: this.suppressReflection};
  }
}
