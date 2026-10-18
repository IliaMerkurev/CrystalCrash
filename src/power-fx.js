import { BONUS_DEFS } from './bonus-controller.js';

/** Fixed-budget, simulation-clock impact feedback. No lights or physics. */
export class PowerFX {
  constructor({ THREE, scene, radius }) {
    this.T = THREE;
    this.radius = radius;
    this.root = new THREE.Group();
    this.root.name = 'power-feedback';
    scene.add(this.root);
    this.cursor = 0;
    this.time = 0;
    this.trailClock = 0;
    this.hasLastBall = false;
    this.lastBall = new THREE.Vector3();
    this.direction = new THREE.Vector3(0, 0, -1);
    this.up = new THREE.Vector3(0, 1, 0);
    this.dummy = new THREE.Object3D();
    this.color = new THREE.Color();
    this.particles = Array.from({ length: 80 }, () => ({
      p: new THREE.Vector3(), v: new THREE.Vector3(), origin: new THREE.Vector3(),
      age: 0, life: 0, size: 0, stretch: 1, kind: '', angle: 0,
    }));
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(80), 1);
    this.alpha.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('fxAlpha', this.alpha);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    });
    material.onBeforeCompile = shader => {
      shader.vertexShader = 'attribute float fxAlpha; varying float vFxAlpha;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvFxAlpha = fxAlpha;');
      shader.fragmentShader = 'varying float vFxAlpha;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vFxAlpha;');
    };
    material.customProgramCacheKey = () => 'power-fx-instance-alpha-v1';
    this.mesh = new THREE.InstancedMesh(geometry, material, 80);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Allocate the color attribute before shader warmup, not on the first hit.
    for (let i = 0; i < 80; i++) this.mesh.setColorAt(i, this.color);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);
    const ringGeometry = new THREE.RingGeometry(.91, 1, 48);
    this.rings = Array.from({ length: 4 }, () => {
      const mesh = new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({
        transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, toneMapped: false,
      }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      this.root.add(mesh);
      return { mesh, age: 0, life: 0, start: 0, end: 0, rise: 0, y: 0 };
    });
    this.spiralPositions = new Float32Array(96 * 3);
    const spiralGeometry = new THREE.BufferGeometry();
    spiralGeometry.setAttribute('position', new THREE.BufferAttribute(this.spiralPositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.spiral = new THREE.Line(spiralGeometry, new THREE.LineBasicMaterial({
      color: BONUS_DEFS.gravity.color, transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    }));
    this.spiral.frustumCulled = false;
    this.spiral.visible = false;
    this.root.add(this.spiral);
    this.gravityAge = 2;
    this.clear();
  }

  _particle(kind, point, angle, speed, life, size, stretch = 1) {
    const index = this.cursor++ % this.particles.length;
    const p = this.particles[index];
    p.p.copy(point); p.origin.copy(point);
    p.p.y = Math.max(.045, p.p.y);
    p.v.set(Math.cos(angle) * speed, speed * .15, Math.sin(angle) * speed);
    p.age = 0; p.life = life; p.size = size; p.stretch = stretch; p.kind = kind; p.angle = angle;
    this.mesh.setColorAt(index, this.color.setHex(BONUS_DEFS[kind].color));
    this.mesh.instanceColor.needsUpdate = true;
    return p;
  }

  _ring(kind, point, start, end, life, rise = 0, delay = 0) {
    const r = this.rings.find(r => !r.mesh.visible) || this.rings.reduce((a, b) => a.age / a.life > b.age / b.life ? a : b);
    r.mesh.position.copy(point); r.y = Math.max(.045, point.y);
    r.mesh.position.y = r.y; r.mesh.material.color.setHex(BONUS_DEFS[kind].color);
    r.age = -delay; r.life = life; r.start = start; r.end = end; r.rise = rise;
    r.mesh.scale.setScalar(start); r.mesh.material.opacity = 0; r.mesh.visible = true;
  }

  trigger(kind, point) {
    if (!BONUS_DEFS[kind] || !point) return;
    const d = this.radius * 2;
    if (kind === 'pulse') {
      this._ring(kind, point, d * .4, d * 2.2, .6);
      this._ring(kind, point, d * .25, d * 1.85, .6, .06, .13);
    } else if (kind === 'halo') {
      this._ring(kind, point, d * .4, d * 1.6, .95, d * 2);
      this._ring(kind, point, d * .6, d * 1.4, .95, d * 2.3, .15);
      this._ring(kind, point, d * .8, d * 1.2, .95, d * 2.6, .3);
    } else if (kind === 'gravity') {
      this.gravityAge = 0;
      this.spiral.position.copy(point); this.spiral.position.y = Math.max(.06, point.y);
      this.spiral.visible = true;
      for (let i = 0; i < 18; i++) {
        const p = this._particle(kind, point, i / 18 * Math.PI * 2, 0, 2, d * .07, 2);
        p.angle = i / 18 * Math.PI * 2;
      }
    }
    const count = { pulse: 12, pierce: 12, arc: 24, frost: 20, gravity: 0, split: 24, halo: 12, heavy: 24 }[kind];
    const heading = Math.atan2(this.direction.z, this.direction.x);
    for (let i = 0; i < count; i++) {
      let a = i / count * Math.PI * 2;
      if (kind === 'split') a = heading + (i < count / 2 ? -.65 : .65) + ((i % 12) / 11 - .5) * .45;
      if (kind === 'pierce') a = heading + (i / count - .5) * .6;
      const speed = d * (kind === 'heavy' ? 2 : kind === 'pierce' ? 6 : 3) * (.6 + Math.random() * .5);
      const life = kind === 'heavy' ? .32 : kind === 'arc' ? .28 + Math.random() * .2 : .6;
      const p = this._particle(kind, point, a, speed, life, d * (kind === 'heavy' ? .12 : .065), kind === 'frost' ? 6 : kind === 'arc' || kind === 'pierce' ? 8 : 3);
      if (kind === 'halo') p.v.y = d * (2 + Math.random() * 2);
      if (kind === 'split' && i >= count / 2) {
        // Same exact Split hue, with a bright inner fan distinct from its pink partner.
        this.mesh.setColorAt((this.cursor - 1) % 80, this.color.setHex(BONUS_DEFS.split.color).multiplyScalar(1.7));
      }
    }
  }

  update(dt, ballPoint, activeKind) {
    if (!(dt > 0)) return;
    this.time += dt;
    if (ballPoint) {
      const distance = this.hasLastBall ? this.lastBall.distanceTo(ballPoint) : 0;
      if (distance > .0001) this.direction.copy(ballPoint).sub(this.lastBall).normalize();
      this.trailClock += dt;
      if (activeKind === 'pierce' && distance > .001 && this.trailClock >= .025) {
        const count = Math.min(5, Math.ceil(distance / (this.radius * .3)));
        for (let i = 0; i < count; i++) {
          const p = this._particle('pierce', ballPoint, Math.atan2(this.direction.z, this.direction.x), 0, .2, this.radius * .12, 7);
          p.p.lerp(this.lastBall, (i + .5) / count);
          p.v.copy(this.direction).multiplyScalar(-this.radius * 2);
        }
        this.trailClock = 0;
      }
      this.lastBall.copy(ballPoint); this.hasLastBall = true;
    }
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i]; p.age += dt;
      const t = p.life ? p.age / p.life : 1;
      if (t >= 1) { this.alpha.array[i] = 0; this.dummy.scale.setScalar(0); }
      else {
        if (p.kind === 'gravity') {
          const r = this.radius * 6 * (1 - t);
          const a = p.angle + t * Math.PI * 5;
          p.p.set(p.origin.x + Math.cos(a) * r, Math.max(.06, p.origin.y) + .08 * Math.sin(a), p.origin.z + Math.sin(a) * r);
          p.angle += dt * .5;
        } else {
          p.p.addScaledVector(p.v, dt);
          if (p.kind === 'frost') p.v.y -= dt * 2;
        }
        this.dummy.position.copy(p.p);
        this.dummy.rotation.set(0, -p.angle, p.kind === 'frost' ? this.time * 2 : 0);
        this.dummy.scale.set(p.size * p.stretch, p.size, p.size);
        this.alpha.array[i] = Math.pow(1 - t, 1.4) * (p.kind === 'arc' ? .6 + .4 * Math.sin(t * 60) ** 2 : 1);
      }
      this.dummy.updateMatrix(); this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.alpha.needsUpdate = true; this.mesh.instanceMatrix.needsUpdate = true;
    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.age += dt;
      if (r.age >= r.life) { r.mesh.visible = false; continue; }
      const t = Math.max(0, r.age / r.life);
      r.mesh.scale.setScalar(r.start + (r.end - r.start) * (1 - (1 - t) ** 2));
      r.mesh.position.y = r.y + r.rise * t;
      r.mesh.material.opacity = r.age < 0 ? 0 : (1 - t) * .9;
    }
    if (this.spiral.visible) {
      this.gravityAge += dt;
      if (this.gravityAge >= 2) this.spiral.visible = false;
      else {
        for (let i = 0; i < 96; i++) {
          const f = i / 95, a = f * Math.PI * 8 - this.gravityAge * 5;
          const r = this.radius * 6 * f;
          this.spiralPositions[i * 3] = Math.cos(a) * r;
          this.spiralPositions[i * 3 + 1] = .04 * Math.sin(a * 2);
          this.spiralPositions[i * 3 + 2] = Math.sin(a) * r;
        }
        this.spiral.geometry.attributes.position.needsUpdate = true;
        this.spiral.material.opacity = Math.min(1, (2 - this.gravityAge) * 3) * .8;
      }
    }
  }

  warmupObjects() {
    const group = new this.T.Group();
    for (const object of [this.mesh, ...this.rings.map(r => r.mesh), this.spiral]) {
      const clone = object.clone(); clone.visible = true; group.add(clone);
    }
    return group;
  }

  clear() {
    for (const p of this.particles) { p.life = 0; p.age = 0; }
    this.alpha.array.fill(0); this.alpha.needsUpdate = true;
    this.dummy.scale.setScalar(0); this.dummy.updateMatrix();
    for (let i = 0; i < 80; i++) this.mesh.setMatrixAt(i, this.dummy.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
    for (const r of this.rings) r.mesh.visible = false;
    this.spiral.visible = false; this.gravityAge = 2;
    this.hasLastBall = false; this.trailClock = 0; this.cursor = 0;
  }
}
