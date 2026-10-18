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
    // Persistent blast pool: eight low-poly fire lobes and one compact flash.
    // All geometry, colors and shader variants exist before the first bomb.
    const fireGeometry = new THREE.SphereGeometry(1,12,8);
    this.fire = new THREE.InstancedMesh(fireGeometry,new THREE.MeshBasicMaterial({
      color:0xffffff,transparent:true,opacity:0,depthWrite:false,
      blending:THREE.AdditiveBlending,toneMapped:false,
    }),8);
    for(let i=0;i<8;i++) this.fire.setColorAt(i,this.color.setHex(i%2 ? 0xff5420 : 0xffa52c));
    this.fire.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fire.frustumCulled=false; this.fire.visible=false; this.root.add(this.fire);
    this.flash = new THREE.Mesh(fireGeometry,new THREE.MeshBasicMaterial({
      color:0xffc05b,transparent:true,opacity:0,depthWrite:false,
      blending:THREE.AdditiveBlending,toneMapped:false,
    }));
    this.flash.visible=false; this.root.add(this.flash);
    this.bombPoint = new THREE.Vector3(); this.bombAge=1;
    this.blackHoleRoot=new THREE.Group(); this.blackHoleRoot.visible=false; this.root.add(this.blackHoleRoot);
    this.blackHoleCore=new THREE.Mesh(fireGeometry,new THREE.MeshStandardMaterial({color:0x04050d,metalness:.72,roughness:.14}));
    this.blackHoleRoot.add(this.blackHoleCore);
    const holeRingGeometry=new THREE.TorusGeometry(1,.027,6,64);
    this.blackHoleRings=[];
    for(let i=0;i<3;i++) {
      const ring=new THREE.Mesh(holeRingGeometry,new THREE.MeshBasicMaterial({color:i===1?0xffa54b:(BONUS_DEFS.blackhole?.color ?? 0x8878ff),transparent:true,opacity:.8,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false}));
      this.blackHoleRoot.add(ring);this.blackHoleRings.push(ring);
    }
    this.blackHoleParticles=new THREE.InstancedMesh(fireGeometry,new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.7,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false}),36);
    this.blackHoleParticles.frustumCulled=false;
    this.blackHoleParticles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for(let i=0;i<36;i++)this.blackHoleParticles.setColorAt(i,this.color.setHex(i%3===0?0xffa54b:(BONUS_DEFS.blackhole?.color ?? 0x8878ff)));
    this.blackHoleRoot.add(this.blackHoleParticles);
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
    if (kind === 'bomb') {
      const blastRadius=d*(BONUS_DEFS.bomb.radiusD || 6.5);
      this._ring(kind,point,d*.2,blastRadius,.62,.025,0,.96);
      this._ring(kind,point,d*.35,blastRadius*.83,.72,.12,.08,.66);
      this._ring(kind,point,d*.2,blastRadius*.53,.5,d*.8,.035,.4);
      this.bombPoint.copy(point); this.bombPoint.y=Math.max(.08,point.y);
      this.bombAge=0; this.fire.visible=true; this.flash.visible=true;
      this.fire.material.opacity=0; this.flash.material.opacity=0;
    } else if (kind === 'pulse') {
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
    const count = { pulse: 32, pierce: 22, arc: 28, frost: 30, gravity: 0, split: 32, halo: 18, heavy: 38, bomb:64 }[kind];
    const heading = Math.atan2(this.direction.z, this.direction.x);
    for (let i = 0; i < count; i++) {
      let a = i / count * Math.PI * 2;
      if (kind === 'split') a = heading + (i < count / 2 ? -.7 : .7) + ((i % 16) / 15 - .5) * .36;
      if (kind === 'pierce') a = heading + (i / count - .5) * .4;
      const speed = d * ({ heavy: 6.2, pierce: 10, pulse: 6.8, split: 7, frost: 3.8, arc: 6, halo: 3.2, bomb:13 }[kind]) * (.65 + Math.random() * .45);
      const life = kind === 'bomb' ? .55+Math.random()*.4 : kind === 'heavy' ? .48 : kind === 'arc' ? .3 + Math.random() * .2 : kind === 'frost' ? .85 : .64;
      const size = d * (kind === 'bomb' ? .11 : kind === 'heavy' ? .14 : kind === 'pulse' ? .095 : kind === 'frost' ? .07 : .075);
      const stretch = kind === 'frost' ? 5 : kind === 'arc' || kind === 'pierce' ? 10 : kind === 'heavy' ? 2.6 : 4;
      const p = this._particle(kind, point, a, speed, life, size, stretch);
      if (kind === 'bomb') {
        p.v.y=d*(2+Math.random()*6); p.glow=.92;
        this.mesh.setColorAt((this.cursor-1)%this.particles.length,this.color.setHex(i%3===0?0xffbd58:BONUS_DEFS.bomb.color));
      }
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

  /** Main owns the scene-color lens pass; this pool only draws physical visuals.
   * Pass current simulation state each step. null immediately hides everything. */
  syncBlackHole(state) {
    if(!state?.point){this.blackHoleRoot.visible=false;return;}
    this.blackHoleRoot.visible=true;this.blackHoleRoot.position.copy(state.point);
    const intensity=Math.max(0,Math.min(1,state.intensity||0));
    const age=Number.isFinite(state.age)?state.age:this.time;
    const range=state.range||state.radius||this.radius*16;
    const core=this.radius*(.64+intensity*.76);
    this.blackHoleCore.scale.setScalar(core);
    for(let i=0;i<3;i++) {
      const ring=this.blackHoleRings[i];
      ring.scale.setScalar(core*(1.24+i*.24));
      ring.rotation.set(-Math.PI/2+.35+i*.33,.18*Math.sin(age*.6+i),age*(.35+i*.12));
      ring.material.opacity=.22+intensity*(.65-i*.09);
    }
    for(let i=0;i<36;i++) {
      const phase=(i/36+age*(.12+intensity*.17))%1;
      const radius=core*1.4+(range*.85-core*1.4)*(1-phase)*(1-phase);
      const angle=i*2.399963+age*(.4+intensity*2.8)+phase*5;
      this.dummy.position.set(Math.cos(angle)*radius,Math.sin(angle*2+i)*core*.2*(1-phase),Math.sin(angle)*radius);
      this.dummy.rotation.set(0,-angle,0);
      const size=this.radius*(.025+intensity*.055)*Math.sin(Math.PI*phase);
      this.dummy.scale.set(size*(2+intensity*3),size,size);
      this.dummy.updateMatrix();this.blackHoleParticles.setMatrixAt(i,this.dummy.matrix);
    }
    this.blackHoleParticles.material.opacity=.15+intensity*.7;
    this.blackHoleParticles.instanceMatrix.needsUpdate=true;
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
          if (p.kind === 'frost' || p.kind === 'heavy' || p.kind === 'bomb') p.v.y -= dt * (p.kind === 'bomb' ? 9 : p.kind === 'heavy' ? 5 : 2);
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
    if (this.bombAge < 1) {
      this.bombAge=Math.min(1,this.bombAge+dt);
      const t=this.bombAge,d=this.radius*2;
      this.flash.position.copy(this.bombPoint);
      this.flash.scale.set(d*(.3+Math.min(t/.12,1)*1.4),d*(.2+Math.min(t/.12,1)*.9),d*(.3+Math.min(t/.12,1)*1.4));
      this.flash.material.opacity=Math.max(0,1-t/.23)*.72;
      this.flash.visible=t<.23;
      for(let i=0;i<8;i++) {
        const a=i*Math.PI/4,age=Math.max(0,t-i%3*.025),travel=d*(.25+age*2.8);
        this.dummy.position.set(this.bombPoint.x+Math.cos(a)*travel,this.bombPoint.y+d*(.25+age*(1.6+i%3*.55)),this.bombPoint.z+Math.sin(a)*travel);
        const size=d*(.35+Math.sin(Math.min(1,age/.7)*Math.PI)*.48);
        this.dummy.rotation.set(age,i,0); this.dummy.scale.set(size,size*(1.1+age*.7),size);
        this.dummy.updateMatrix(); this.fire.setMatrixAt(i,this.dummy.matrix);
      }
      this.fire.instanceMatrix.needsUpdate=true;
      this.fire.material.opacity=Math.max(0,1-t/.85)*.43;
      this.fire.visible=t<.85;
    }
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
    for (const object of [this.mesh, ...this.rings.map(r => r.mesh), this.spiral, this.fire, this.flash, this.blackHoleCore, ...this.blackHoleRings, this.blackHoleParticles]) {
      const clone = object.clone(); clone.visible = true; clone.frustumCulled=false;
      clone.material=object.material.clone(); clone.material.opacity=.5;
      clone.material.onBeforeCompile=object.material.onBeforeCompile;
      clone.material.customProgramCacheKey=object.material.customProgramCacheKey;
      clone.userData.powerFXWarmupMaterial=true;
      if(object===this.mesh){
        clone.geometry=object.geometry.clone();
        clone.geometry.setAttribute('fxAlpha',new this.T.InstancedBufferAttribute(new Float32Array(this.particles.length).fill(1),1));
        clone.userData.powerFXWarmupGeometry=true;
      }
      if(clone.isInstancedMesh){
        clone.count=1; clone.setMatrixAt(0,new this.T.Matrix4().makeScale(.12,.12,.12));
        clone.instanceMatrix.needsUpdate=true;
      } else clone.scale.setScalar(.12);
      clone.position.set(0,0,0);group.add(clone);
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
    this.bombAge=1; this.fire.visible=false; this.flash.visible=false;
    this.blackHoleRoot.visible=false;
  }
}
