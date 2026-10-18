import { BONUS_DEFS } from './bonus-controller.js';

/** Fixed-budget, simulation-clock impact feedback. No lights or physics.
 * Every bonus keeps its hue and silhouette. Larger ranges use narrow rings and
 * individual shards instead of a full-screen additive flash. */
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
      age: 0, life: 0, size: 0, stretch: 1, kind: '', angle: 0, lift: 0, glow: 1,
    }));
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(this.particles.length), 1);
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
    this.mesh = new THREE.InstancedMesh(geometry, material, this.particles.length);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Allocate every attribute/material before startup shader warmup.
    for (let i = 0; i < this.particles.length; i++) this.mesh.setColorAt(i, this.color);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);
    const ringGeometry = new THREE.RingGeometry(.935, 1, 64);
    this.rings = Array.from({ length: 4 }, () => {
      const mesh = new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({
        transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, toneMapped: false,
      }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      this.root.add(mesh);
      return { mesh, age: 0, life: 0, start: 0, end: 0, rise: 0, y: 0, opacity: .8 };
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
    p.lift = 0; p.glow = kind === 'frost' ? .72 : .9;
    this.mesh.setColorAt(index, this.color.setHex(BONUS_DEFS[kind].color));
    this.mesh.instanceColor.needsUpdate = true;
    return p;
  }

  _ring(kind, point, start, end, life, rise = 0, delay = 0, opacity = .8) {
    const r = this.rings.find(r => !r.mesh.visible) || this.rings.reduce((a, b) => a.age / a.life > b.age / b.life ? a : b);
    r.mesh.position.copy(point); r.y = Math.max(.065, point.y);
    r.mesh.position.y = r.y; r.mesh.material.color.setHex(BONUS_DEFS[kind].color);
    r.age = -delay; r.life = life; r.start = start; r.end = end; r.rise = rise; r.opacity = opacity;
    r.mesh.scale.setScalar(start); r.mesh.material.opacity = 0; r.mesh.visible = true;
  }

  trigger(kind, point) {
    if (!BONUS_DEFS[kind] || !point) return;
    const d = this.radius * 2;
    if (kind === 'pulse') {
      const radius = d * Math.max(4.4, BONUS_DEFS.pulse.radiusD);
      this._ring(kind, point, d * .35, radius, .78, .035, 0, .88);
      this._ring(kind, point, d * .2, radius * .87, .75, .1, .11, .66);
      this._ring(kind, point, d * .12, radius * .68, .68, .17, .22, .5);
    } else if (kind === 'halo') {
      this._ring(kind, point, d * .4, d * 2.1, 1.05, d * 2);
      this._ring(kind, point, d * .6, d * 1.8, 1.05, d * 2.4, .13, .68);
      this._ring(kind, point, d * .8, d * 1.5, 1.05, d * 2.8, .26, .54);
    } else if (kind === 'heavy') {
      this._ring(kind, point, d * .15, d * 2.3, .43, .035, 0, .95);
      this._ring(kind, point, d * .3, d * 1.55, .36, d * .3, .065, .65);
    } else if (kind === 'frost') {
      this._ring(kind, point, d * .35, d * 2.5, .9, .025, 0, .72);
      this._ring(kind, point, d * 2.4, d * .5, .85, .12, .08, .52);
    } else if (kind === 'split') {
      this._ring(kind, point, d * .25, d * 1.5, .48, .04, 0, .8);
    } else if (kind === 'pierce') {
      this._ring(kind, point, d * .18, d * 1.35, .3, .04, 0, .85);
    } else if (kind === 'gravity') {
      const radius = d * Math.max(6, BONUS_DEFS.gravity.radiusD);
      this.gravityAge = 0;
      this.spiral.position.copy(point); this.spiral.position.y = Math.max(.08, point.y);
      this.spiral.visible = true;
      this._ring(kind, point, radius, d * .35, 1.85, .035, 0, .7);
      this._ring(kind, point, radius * .7, d * .2, 1.55, .12, .18, .46);
      for (let i = 0; i < 30; i++) {
        const p = this._particle(kind, point, i / 30 * Math.PI * 2, 0, 2, d * (.075 + i % 3 * .02), 3.6);
        p.angle = i / 30 * Math.PI * 2;
        p.lift = i % 3 * d * .19;
      }
    }
    const count = { pulse: 32, pierce: 22, arc: 28, frost: 30, gravity: 0, split: 32, halo: 18, heavy: 38 }[kind];
    const heading = Math.atan2(this.direction.z, this.direction.x);
    for (let i = 0; i < count; i++) {
      let a = i / count * Math.PI * 2;
      if (kind === 'split') a = heading + (i < count / 2 ? -.7 : .7) + ((i % 16) / 15 - .5) * .36;
      if (kind === 'pierce') a = heading + (i / count - .5) * .4;
      const speed = d * ({ heavy: 6.2, pierce: 10, pulse: 6.8, split: 7, frost: 3.8, arc: 6, halo: 3.2 }[kind]) * (.65 + Math.random() * .45);
      const life = kind === 'heavy' ? .48 : kind === 'arc' ? .3 + Math.random() * .2 : kind === 'frost' ? .85 : .64;
      const size = d * (kind === 'heavy' ? .14 : kind === 'pulse' ? .095 : kind === 'frost' ? .07 : .075);
      const stretch = kind === 'frost' ? 5 : kind === 'arc' || kind === 'pierce' ? 10 : kind === 'heavy' ? 2.6 : 4;
      const p = this._particle(kind, point, a, speed, life, size, stretch);
      if (kind === 'halo') p.v.y = d * (2.5 + Math.random() * 2);
      if (kind === 'heavy') p.v.y = d * (1.4 + Math.random() * 3.2);
      if (kind === 'frost') p.v.y = d * (.5 + Math.random() * 1.8);
      if (kind === 'split') {
        p.v.y = d * (.2 + i % 3 * .2);
        // Two saturated magenta fans; brightness differs without white cores.
        if (i >= count / 2) this.mesh.setColorAt((this.cursor - 1) % this.particles.length, this.color.setHex(BONUS_DEFS.split.color).multiplyScalar(1.2));
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
      if (activeKind === 'pierce' && distance > .001 && this.trailClock >= .016) {
        const count = Math.min(6, Math.max(2, Math.ceil(distance / (this.radius * .25))));
        for (let i = 0; i < count; i++) {
          const p = this._particle('pierce', ballPoint, Math.atan2(this.direction.z, this.direction.x), 0, .3, this.radius * .2, 12);
          p.p.lerp(this.lastBall, (i + .5) / count);
          p.v.copy(this.direction).multiplyScalar(-this.radius * 2.4);
          p.glow = .78;
        }
        this.trailClock = 0;
      } else if (activeKind === 'frost' && distance > .001 && this.trailClock >= .075) {
        const p = this._particle('frost', ballPoint, this.time * 7, this.radius * .9, .45, this.radius * .11, 3);
        p.v.y = this.radius * .6; p.glow = .55;
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
          const r = this.radius * 2 * Math.max(6, BONUS_DEFS.gravity.radiusD) * (.28 + (i % 5) * .18) * (1 - t);
          const a = p.angle + t * Math.PI * 7;
          p.p.set(p.origin.x + Math.cos(a) * r, Math.max(.08, p.origin.y) + p.lift * Math.sin(Math.PI * t), p.origin.z + Math.sin(a) * r);
          p.angle += dt * .6;
          this.dummy.rotation.set(0, -a - Math.PI / 2, 0);
        } else {
          p.p.addScaledVector(p.v, dt);
          if (p.kind === 'frost' || p.kind === 'heavy') p.v.y -= dt * (p.kind === 'heavy' ? 5 : 2);
          p.p.y = Math.max(.055, p.p.y);
          this.dummy.rotation.set(0, -p.angle, p.kind === 'frost' ? this.time * 2.6 : 0);
        }
        this.dummy.position.copy(p.p);
        const shrink = 1 - t * .45;
        this.dummy.scale.set(p.size * p.stretch * shrink, p.size * shrink, p.size * shrink);
        this.alpha.array[i] = Math.pow(1 - t, 1.15) * p.glow * (p.kind === 'arc' ? .6 + .4 * Math.sin(t * 65) ** 2 : 1);
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
      r.mesh.material.opacity = r.age < 0 ? 0 : (1 - t) * r.opacity;
    }
    if (this.spiral.visible) {
      this.gravityAge += dt;
      if (this.gravityAge >= 2) this.spiral.visible = false;
      else {
        const radius = this.radius * 2 * Math.max(6, BONUS_DEFS.gravity.radiusD);
        for (let i = 0; i < 96; i++) {
          const f = i / 95, a = f * Math.PI * 10 - this.gravityAge * 7;
          const r = radius * f;
          this.spiralPositions[i * 3] = Math.cos(a) * r;
          this.spiralPositions[i * 3 + 1] = .12 * Math.sin(a * 2) * (1 - f);
          this.spiralPositions[i * 3 + 2] = Math.sin(a) * r;
        }
        this.spiral.geometry.attributes.position.needsUpdate = true;
        this.spiral.material.opacity = Math.min(1, (2 - this.gravityAge) * 3) * .85;
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
    for (let i = 0; i < this.particles.length; i++) this.mesh.setMatrixAt(i, this.dummy.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
    for (const r of this.rings) r.mesh.visible = false;
    this.spiral.visible = false; this.gravityAge = 2;
    this.hasLastBall = false; this.trailClock = 0; this.cursor = 0;
  }
}
