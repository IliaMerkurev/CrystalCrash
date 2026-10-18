const WINDOW_START_MIN = 1;
const WINDOW_START_MAX = 1.25;
const WINDOW_DURATION = 1 / 3;
const DIAL_DURATION = 2;
const TIME_EPSILON = 1e-12;

/** A single, real-active-time timing window for each launch gesture. */
export class LaunchCharge {
  constructor({ random = Math.random } = {}) {
    this.random = typeof random === 'function' ? random : Math.random;
    this.reset();
  }

  reset() {
    // Choose once per fresh gesture, before pulling starts. Retreats never reroll.
    const roll = this.random();
    const unit = Number.isFinite(roll) ? Math.max(0, Math.min(1, roll)) : 0;
    this.windowStart = WINDOW_START_MIN + unit * (WINDOW_START_MAX - WINDOW_START_MIN);
    this.windowEnd = this.windowStart + WINDOW_DURATION;
    this.elapsed = 0;
    this.started = false;
    this.pulling = false;
    return this.snapshot();
  }

  /** Crossing .7 starts the clock once. Retreating never resets or stops it. */
  setPull(length) {
    this.pulling = Number.isFinite(length) && length > .7;
    if (this.pulling) this.started = true;
    return this.snapshot();
  }

  /** Supply unscaled elapsed seconds, excluding app pause/background time. */
  update(realDt, { paused = false } = {}) {
    if (!paused && this.started && Number.isFinite(realDt) && realDt > 0) {
      this.elapsed = Math.min(Number.MAX_SAFE_INTEGER, this.elapsed + realDt);
    }
    return this.snapshot();
  }

  multiplier() {
    // A tiny roundoff allowance keeps exact 1/60-second frame boundaries fair.
    return this.started && this.pulling && this.elapsed >= this.windowStart - TIME_EPSILON && this.elapsed <= this.windowEnd + TIME_EPSILON ? 2 : 1;
  }

  snapshot() {
    const state = !this.started ? 'idle' : this.elapsed < this.windowStart - TIME_EPSILON ? 'charging' : this.elapsed <= this.windowEnd + TIME_EPSILON ? 'window' : 'spent';
    return {
      state,
      elapsed: this.elapsed,
      window: this.multiplier() === 2,
      windowStart: this.windowStart,
      windowEnd: this.windowEnd,
      windowDuration: WINDOW_DURATION,
      progress: Math.min(1, Math.max(0, this.elapsed / DIAL_DURATION)),
      pulling: this.pulling,
      started: this.started,
    };
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;

/**
 * Small, pointer-transparent timing dial. x/y are the ball's viewport CSS pixels;
 * width/height are viewport bounds. update() uses the game's unscaled frame dt.
 * render(snapshot, {visible:false}) hides only the dial; hide() clears success FX.
 */
export class LaunchChargeMeter {
  constructor(parent = globalThis.document?.body) {
    this.parent = parent;
    this.document = parent?.ownerDocument ?? globalThis.document;
    this.successRemaining = 0;
    this.successDuration = .42;
    this.viewport = { width: 1, height: 1 };
    if (!parent || !this.document) return;

    const make = (name, attributes = {}) => {
      const node = this.document.createElementNS(SVG_NS, name);
      for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
      return node;
    };
    const text = (value, attributes) => {
      const node = make('text', attributes);
      node.textContent = value;
      return node;
    };
    this.element = this.document.createElement('div');
    this.element.className = 'launch-charge-meter';
    this.element.setAttribute('role', 'img');
    Object.assign(this.element.style, {
      position: 'fixed', left: '0', top: '0', display: 'none', zIndex: '75',
      pointerEvents: 'none', userSelect: 'none', boxSizing: 'border-box',
      borderRadius: '15px', border: '1px solid rgba(170,224,255,.25)',
      background: 'rgba(5,14,25,.83)', color: '#e9f7ff',
      boxShadow: '0 4px 18px rgba(0,0,0,.25)',
      fontFamily: 'system-ui, sans-serif', contain: 'layout style',
    });
    const svg = make('svg', { viewBox: '0 0 160 108', width: '100%', height: '100%', 'aria-hidden': 'true' });
    svg.style.display = 'block';
    svg.appendChild(make('path', { d: 'M 20 78 A 60 60 0 0 1 140 78', fill: 'none', stroke: '#2e475b', 'stroke-width': 7, 'stroke-linecap': 'round' }));
    this.sector = make('path', { fill: 'none', stroke: '#69efbc', 'stroke-width': 9 });
    svg.appendChild(this.sector);
    for (const progress of [0, .25, .5, .75, 1]) {
      const angle = Math.PI * (1 - progress);
      svg.appendChild(make('line', {
        x1: 80 + Math.cos(angle) * 49, y1: 78 - Math.sin(angle) * 49,
        x2: 80 + Math.cos(angle) * 54, y2: 78 - Math.sin(angle) * 54,
        stroke: '#b5cfdf', 'stroke-width': 1.5,
      }));
    }
    this.bonusLabel = text('×2', { fill: '#a0ffcf', 'font-size': 15, 'font-weight': 800, 'text-anchor': 'middle' });
    svg.appendChild(this.bonusLabel);
    this.timingLabel = text('', { x: 80, y: 11, fill: '#c4dbe9', 'font-size': 10, 'text-anchor': 'middle' });
    svg.appendChild(this.timingLabel);
    this.needle = make('line', { x1: 80, y1: 78, x2: 37, y2: 78, stroke: '#f2faff', 'stroke-width': 3, 'stroke-linecap': 'round' });
    svg.appendChild(this.needle);
    svg.appendChild(make('circle', { cx: 80, cy: 78, r: 4, fill: '#f2faff' }));
    this.label = text('TIMED LAUNCH', { x: 80, y: 100, fill: '#e9f7ff', 'font-size': 13, 'font-weight': 700, 'letter-spacing': '.2', 'text-anchor': 'middle' });
    svg.appendChild(this.label);
    this.element.appendChild(svg);
    parent.appendChild(this.element);

    this.successElement = this.document.createElement('div');
    this.successElement.className = 'launch-charge-success';
    this.successElement.textContent = '×2';
    this.successElement.setAttribute('aria-hidden', 'true');
    Object.assign(this.successElement.style, {
      position: 'fixed', left: '0', top: '0', display: 'none', zIndex: '75',
      width: '64px', height: '42px', lineHeight: '42px', textAlign: 'center',
      pointerEvents: 'none', userSelect: 'none', boxSizing: 'border-box',
      color: '#d9ffe9', background: 'rgba(20,86,60,.72)',
      border: '1px solid rgba(140,255,193,.8)', borderRadius: '21px',
      boxShadow: '0 0 18px rgba(105,255,167,.48)',
      font: '800 23px/42px system-ui, sans-serif',
    });
    parent.appendChild(this.successElement);
  }

  render(snapshot, { x, y, width, height, visible = true, realDt } = {}) {
    if (realDt !== undefined) this.update(realDt);
    if (!this.element) return;
    const view = this.document.defaultView ?? globalThis;
    const viewportWidth = Math.max(1, finite(width, view.innerWidth || 1));
    const viewportHeight = Math.max(1, finite(height, view.innerHeight || 1));
    this.viewport = { width: viewportWidth, height: viewportHeight };
    const windowStart = clamp(finite(snapshot?.windowStart, WINDOW_START_MIN), 0, DIAL_DURATION);
    const windowEnd = clamp(finite(snapshot?.windowEnd, windowStart + WINDOW_DURATION), windowStart, DIAL_DURATION);
    if (windowStart !== this.renderedWindowStart || windowEnd !== this.renderedWindowEnd) {
      const startAngle = Math.PI * (1 - windowStart / DIAL_DURATION);
      const endAngle = Math.PI * (1 - windowEnd / DIAL_DURATION);
      const middleAngle = (startAngle + endAngle) / 2;
      this.sector.setAttribute('d', `M ${80 + Math.cos(startAngle) * 60} ${78 - Math.sin(startAngle) * 60} A 60 60 0 0 1 ${80 + Math.cos(endAngle) * 60} ${78 - Math.sin(endAngle) * 60}`);
      this.bonusLabel.setAttribute('x', String(80 + Math.cos(middleAngle) * 38));
      this.bonusLabel.setAttribute('y', String(83 - Math.sin(middleAngle) * 38));
      this.timingLabel.textContent = `${windowStart.toFixed(2)}–${windowEnd.toFixed(2)} s`;
      this.renderedWindowStart = windowStart;
      this.renderedWindowEnd = windowEnd;
    }
    if (!visible || !snapshot?.started) { this.element.style.display = 'none'; return; }

    // Normal phone width: about 132px. Never cover the whole screen on resize.
    const meterWidth = Math.min(clamp(viewportWidth * .34, 128, 152), viewportWidth - 16, (viewportHeight - 16) * 160 / 108);
    if (meterWidth < 40) { this.element.style.display = 'none'; return; }
    const meterHeight = meterWidth * 108 / 160;
    const ballX = finite(x, viewportWidth / 2), sideGap = 28;
    const fitsRight = ballX + sideGap + meterWidth <= viewportWidth - 8;
    const fitsLeft = ballX - sideGap - meterWidth >= 8;
    const placeRight = fitsRight || (!fitsLeft && ballX <= viewportWidth / 2);
    const left = clamp(placeRight ? ballX + sideGap : ballX - sideGap - meterWidth, 8, viewportWidth - meterWidth - 8);
    const top = clamp(finite(y, viewportHeight / 2) - meterHeight - 38, 8, viewportHeight - meterHeight - 8);
    Object.assign(this.element.style, { display: 'block', width: `${meterWidth}px`, height: `${meterHeight}px`, left: `${left}px`, top: `${top}px` });
    const progress = clamp(finite(snapshot.progress, 0), 0, 1);
    const angle = Math.PI * (1 - progress);
    this.needle.setAttribute('x2', String(80 + Math.cos(angle) * 43));
    this.needle.setAttribute('y2', String(78 - Math.sin(angle) * 43));
    const ready = Boolean(snapshot.window && snapshot.pulling);
    const label = ready ? 'RELEASE ×2' : !snapshot.pulling ? 'PULL BACK' : snapshot.state === 'spent' ? 'NORMAL 1×' : 'TIMED LAUNCH';
    this.label.textContent = label;
    this.label.setAttribute('fill', ready ? '#a0ffcf' : '#e9f7ff');
    this.needle.setAttribute('stroke', ready ? '#a0ffcf' : '#f2faff');
    this.sector.setAttribute('stroke', snapshot.state === 'spent' ? '#477d6c' : '#69efbc');
    this.element.style.borderColor = ready ? 'rgba(140,255,193,.8)' : 'rgba(170,224,255,.25)';
    this.element.style.boxShadow = ready ? '0 0 15px rgba(105,255,167,.3)' : '0 4px 18px rgba(0,0,0,.25)';
    this.element.setAttribute('aria-label', ready ? 'Release now for double launch power' : snapshot.state === 'spent' ? 'Timing window over. Normal launch power.' : 'Timed launch. Release in the green sector for double power.');
  }

  hide() {
    if (this.element) this.element.style.display = 'none';
    if (this.successElement) this.successElement.style.display = 'none';
    this.successRemaining = 0;
  }

  success(point = {}) {
    if (!this.successElement) return;
    const view = this.document.defaultView ?? globalThis;
    const width = Math.max(64, finite(point.width, view.innerWidth || this.viewport.width));
    const height = Math.max(42, finite(point.height, view.innerHeight || this.viewport.height));
    this.successRemaining = this.successDuration;
    this.successX = clamp(finite(point.x, width / 2) - 32, 0, width - 64);
    this.successY = clamp(finite(point.y, height / 2) - 74, 0, height - 42);
    Object.assign(this.successElement.style, { display: 'block', opacity: '1', transform: 'scale(1)', left: `${this.successX}px`, top: `${this.successY}px` });
  }

  update(realDt, { paused = false } = {}) {
    if (!this.successElement || this.successRemaining <= 0 || paused || !Number.isFinite(realDt) || realDt <= 0) return;
    this.successRemaining = Math.max(0, this.successRemaining - realDt);
    if (!this.successRemaining) { this.successElement.style.display = 'none'; return; }
    const progress = 1 - this.successRemaining / this.successDuration;
    this.successElement.style.opacity = String(1 - progress * progress);
    this.successElement.style.transform = `translateY(${-8 * progress}px) scale(${1 + .08 * progress})`;
  }

  dispose() {
    this.element?.remove();
    this.successElement?.remove();
    this.successRemaining = 0;
  }
}
