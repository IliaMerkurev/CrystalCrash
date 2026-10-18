/** Lightweight procedural frost border. Texture is baked only on mount/resize. */
export const FROST_SCREEN_DURATION = 2.8;
const smooth = (t) => t * t * (3 - 2 * t);

export function frostScreenEnvelope(age) {
  if (!Number.isFinite(age) || age < 0 || age >= FROST_SCREEN_DURATION) return 0;
  if (age < 0.22) return 0.25 + 0.75 * smooth(age / 0.22);
  if (age < 0.5) return 1;
  return 1 - smooth((age - 0.5) / (FROST_SCREEN_DURATION - 0.5));
}

function randomSource() {
  let seed = 0x7f4a7c15;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export class FrostScreenMask {
  constructor({ document: doc = globalThis.document, window: win = globalThis.window } = {}) {
    this.document = doc;
    this.window = win;
    this.canvas = null;
    this.age = FROST_SCREEN_DURATION;
    this.disposed = false;
    this.onResize = () => this.bake();
    this.onReady = () => this.mount();
    if (doc?.body) this.mount();
    else doc?.addEventListener('DOMContentLoaded', this.onReady, { once: true });
  }

  mount() {
    if (this.disposed || this.canvas || !this.document?.body) return;
    const canvas = this.document.createElement('canvas');
    canvas.className = 'frost-screen-mask';
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, {
      position: 'fixed', inset: '0', width: '100%', height: '100%',
      pointerEvents: 'none', zIndex: 'auto', opacity: '0',
      transformOrigin: 'center', display: 'none',
    });
    this.canvas = canvas;
    // Before the positioned HUD: frost paints over the game, beneath all controls.
    const game = this.document.getElementById?.('game');
    if (game?.parentNode === this.document.body) this.document.body.insertBefore(canvas, game.nextSibling);
    else this.document.body.appendChild(canvas);
    this.window?.addEventListener('resize', this.onResize);
    this.bake();
    this.render();
  }

  bake() {
    const canvas = this.canvas;
    if (!canvas || this.disposed) return;
    const width = Math.max(1, this.window?.innerWidth || 800);
    const height = Math.max(1, this.window?.innerHeight || 600);
    // Cap both DPR and total texture size, including on tall mobile screens.
    const dpr = Math.min(this.window?.devicePixelRatio || 1, 1.5, 1800 / Math.max(width, height));
    canvas.width = Math.ceil(width * dpr);
    canvas.height = Math.ceil(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    const rand = randomSource();
    const depth = Math.min(width, height) * 0.185;
    const stroke = (x1, y1, x2, y2, alpha, lineWidth = 1) => {
      ctx.strokeStyle = `rgba(218,246,255,${alpha})`;
      ctx.lineWidth = lineWidth;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    };
    // Every edge uses local coordinates: x runs along the edge, y points inward.
    for (let edge = 0; edge < 4; edge++) {
      ctx.save();
      if (edge === 1) { ctx.translate(width, 0); ctx.rotate(Math.PI / 2); }
      if (edge === 2) { ctx.translate(width, height); ctx.rotate(Math.PI); }
      if (edge === 3) { ctx.translate(0, height); ctx.rotate(-Math.PI / 2); }
      const length = edge % 2 ? height : width;
      const wash = ctx.createLinearGradient(0, 0, 0, depth);
      wash.addColorStop(0, 'rgba(145,215,250,0.28)');
      wash.addColorStop(0.38, 'rgba(201,239,255,0.08)');
      wash.addColorStop(1, 'rgba(201,239,255,0)');
      ctx.fillStyle = wash; ctx.fillRect(0, 0, length, depth);
      // Fern-like branching ice veins plus translucent faceted ice needles.
      for (let x = -15; x < length + 15; x += 17 + rand() * 23) {
        const h = depth * (0.32 + rand() * 0.63);
        const lean = (rand() - 0.5) * h * 0.65;
        stroke(x, 0, x + lean, h, 0.42, 1.1);
        for (let t = 0.12; t < 0.94; t += 0.075) {
          const bx = x + lean * t, by = h * t;
          const branch = h * (1 - t) * (0.13 + rand() * 0.13);
          for (const side of [-1, 1]) {
            const tx = bx + side * branch, ty = by + branch * 0.58;
            stroke(bx, by, tx, ty, 0.25 + (1 - t) * 0.3, 0.8);
            for (let k = 0.35; k < 0.95; k += 0.25) {
              const sx = bx + (tx - bx) * k, sy = by + (ty - by) * k;
              stroke(sx, sy, sx + side * branch * 0.26, sy + branch * 0.32, 0.25, 0.65);
            }
          }
        }
        if (rand() < 0.45) {
          const tip = h * (0.65 + rand() * 0.35), half = 3 + rand() * 7;
          ctx.beginPath(); ctx.moveTo(x - half, 0); ctx.lineTo(x + lean, tip);
          ctx.lineTo(x + half, tip * 0.22); ctx.closePath();
          ctx.fillStyle = 'rgba(184,232,255,0.18)'; ctx.fill();
          ctx.strokeStyle = 'rgba(235,251,255,0.55)'; ctx.lineWidth = 0.8; ctx.stroke();
          stroke(x, 0, x + lean, tip, 0.55, 0.7);
        }
      }
      // Tiny frost grains keep the edge from looking like a smooth vignette.
      for (let i = 0; i < length * 1.5; i++) {
        const y = depth * Math.pow(rand(), 3);
        ctx.fillStyle = `rgba(227,248,255,${0.08 + rand() * 0.3})`;
        const size = 0.5 + rand() * 1.3;
        ctx.fillRect(rand() * length, y, size, size);
      }
      ctx.restore();
    }
    // Hard guarantee of a fully transparent, generous central play area.
    ctx.clearRect(depth * 1.08, depth * 1.08, width - depth * 2.16, height - depth * 2.16);
  }

  trigger() {
    if (this.disposed) return;
    this.age = 0;
    this.mount();
    this.render();
  }

  update(simdt) {
    if (this.disposed || this.age >= FROST_SCREEN_DURATION) return;
    if (Number.isFinite(simdt) && simdt > 0) this.age = Math.min(FROST_SCREEN_DURATION, this.age + simdt);
    this.render();
  }

  render() {
    if (!this.canvas) return;
    const intensity = frostScreenEnvelope(this.age);
    this.canvas.style.display = intensity > 0 ? 'block' : 'none';
    this.canvas.style.opacity = String(intensity * 0.85);
    // A subtle inward growth during the attack; no texture work in the frame loop.
    const growth = smooth(Math.min(1, Math.max(0, this.age / 0.22)));
    this.canvas.style.transform = `scale(${1.035 - growth * 0.035})`;
  }

  clear() {
    this.age = FROST_SCREEN_DURATION;
    this.render();
  }

  dispose() {
    this.clear();
    this.disposed = true;
    this.document?.removeEventListener('DOMContentLoaded', this.onReady);
    this.window?.removeEventListener('resize', this.onResize);
    this.canvas?.remove();
    this.canvas = null;
  }
}
