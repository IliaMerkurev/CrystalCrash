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
    // Pooled volumetric lobes: irregular silhouettes plus procedural fire/smoke.
    // No textures, hit-time resources, or fullscreen passes.
    const fireGeometry = new THREE.SphereGeometry(1,12,8);
    const lobeGeometry=new THREE.SphereGeometry(1,20,14);
    const positions=lobeGeometry.attributes.position;
    for(let i=0;i<positions.count;i++){
      const x=positions.getX(i),y=positions.getY(i),z=positions.getZ(i);
      const bump=1+.12*Math.sin(x*9+y*5)*Math.cos(z*8-y*4)+.065*Math.sin(z*17+x*11);
      positions.setXYZ(i,x*bump,y*bump,z*bump);
    }
    lobeGeometry.computeVertexNormals();
    this.bombShaderTime={value:0};this.bombDirection=new THREE.Vector3();
    const lobeMaterial=smoke=>{
      const m=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0,depthWrite:false,blending:smoke?THREE.NormalBlending:THREE.AdditiveBlending,toneMapped:false});
      m.onBeforeCompile=shader=>{
        shader.uniforms.bombPhase=this.bombShaderTime;
        shader.vertexShader='varying vec3 bombLocal;\n'+shader.vertexShader;
        shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nbombLocal=position;');
        shader.fragmentShader=`varying vec3 bombLocal; uniform float bombPhase;
          float bhash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
          float bnoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
            return mix(mix(mix(bhash(i),bhash(i+vec3(1,0,0)),f.x),mix(bhash(i+vec3(0,1,0)),bhash(i+vec3(1,1,0)),f.x),f.y),mix(mix(bhash(i+vec3(0,0,1)),bhash(i+vec3(1,0,1)),f.x),mix(bhash(i+vec3(0,1,1)),bhash(i+vec3(1,1,1)),f.x),f.y),f.z);}
        `+shader.fragmentShader;
        shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
          vec3 flow=bombLocal*3.8+vec3(0.,-bombPhase*2.8,0.);
          float turbulence=bnoise(flow)*.66+bnoise(flow*2.25+4.7)*.34;
          float veins=1.-abs(turbulence*2.-1.);
          ${smoke ? `diffuseColor.rgb=mix(vec3(.055,.049,.043),vec3(.16,.14,.115),turbulence);
          diffuseColor.a*=smoothstep(.13,.65,turbulence)*.55;` : `
          float heat=clamp(veins*veins-.29-bombPhase*.16,0.,1.);
          diffuseColor.rgb=mix(vec3(.28,.012,.001),vec3(1.,.18,.008),smoothstep(.05,.45,heat));
          diffuseColor.rgb=mix(diffuseColor.rgb,vec3(1.,.78,.19),smoothstep(.36,.70,heat));
          diffuseColor.a*=smoothstep(.14,.48,turbulence);`}
        `);
      };
      m.customProgramCacheKey=()=>smoke?'bomb-smoke-volume-v2':'bomb-flame-volume-v2';return m;
    };
    this.fire=new THREE.InstancedMesh(lobeGeometry,lobeMaterial(false),16);
    this.smoke=new THREE.InstancedMesh(lobeGeometry,lobeMaterial(true),12);
    for(const object of [this.fire,this.smoke]){object.instanceMatrix.setUsage(THREE.DynamicDrawUsage);object.frustumCulled=false;object.visible=false;this.root.add(object);}
    this.smoke.renderOrder=4;this.fire.renderOrder=5;
    this.flash = new THREE.Mesh(fireGeometry,new THREE.MeshBasicMaterial({
      color:0xfffac7,transparent:true,opacity:0,depthWrite:false,
      blending:THREE.AdditiveBlending,toneMapped:false,
    }));
    this.flash.renderOrder=6;this.flash.visible=false;this.root.add(this.flash);
    this.bombPoint = new THREE.Vector3(); this.bombAge=1.45;
    this.blackHoleRoot=new THREE.Group(); this.blackHoleRoot.visible=false; this.root.add(this.blackHoleRoot);
    this.blackHoleCore=new THREE.Mesh(fireGeometry,new THREE.MeshStandardMaterial({color:0x04050d,metalness:.72,roughness:.14}));
    this.blackHoleRoot.add(this.blackHoleCore);
    const holeRingGeometry=new THREE.TorusGeometry(1,.062,8,80);
    this.blackHoleRings=[];
    for(let i=0;i<3;i++) {
      const ring=new THREE.Mesh(holeRingGeometry,new THREE.MeshBasicMaterial({color:i<2?(i===0?0xffce77:0xff7839):(BONUS_DEFS.blackhole?.color ?? 0x8878ff),transparent:true,opacity:.8,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false}));
      ring.renderOrder=8;this.blackHoleRoot.add(ring);this.blackHoleRings.push(ring);
    }
    // Broad, translucent purple toroidal volume frames the narrow hot disk.
    // Unlike a filled sphere this cannot cover the black core or erase the rings.
    this.blackHoleHalo=new THREE.Mesh(new THREE.TorusGeometry(1,.19,8,80),new THREE.MeshBasicMaterial({
      color:0x7950ef,transparent:true,opacity:.16,depthWrite:false,
      blending:THREE.AdditiveBlending,toneMapped:false,
    }));
    this.blackHoleHalo.renderOrder=7;this.blackHoleRoot.add(this.blackHoleHalo);
    const streamGeometry=fireGeometry.clone();
    this.blackHoleStreamAlpha=new THREE.InstancedBufferAttribute(new Float32Array(36),1).setUsage(THREE.DynamicDrawUsage);
    streamGeometry.setAttribute('fxAlpha',this.blackHoleStreamAlpha);
    const streamMaterial=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.85,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false});
    streamMaterial.onBeforeCompile=material.onBeforeCompile;
    streamMaterial.customProgramCacheKey=material.customProgramCacheKey;
    this.blackHoleParticles=new THREE.InstancedMesh(streamGeometry,streamMaterial,36);
    this.blackHoleStreamPhase=new Float64Array(36);
    this.blackHoleStreamDirections=[];
    this.blackHoleLastAge=null;
    for(let i=0;i<36;i++){
      // Fixed spherical lanes, kept vertically bounded above the arena floor.
      const y=.5*(1-2*(i+.5)/36),a=i*2.399963,r=Math.sqrt(1-y*y);
      this.blackHoleStreamDirections.push(new THREE.Vector3(Math.cos(a)*r,y,Math.sin(a)*r));
      this.blackHoleStreamPhase[i]=i/36;
    }
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
      // Fire, smoke and streaks carry the blast silhouette, not geometric rings.
      this.bombPoint.copy(point); this.bombPoint.y=Math.max(.08,point.y);
      this.bombAge=0;this.bombShaderTime.value=0;
      this.fire.visible=true;this.smoke.visible=true;this.flash.visible=true;
      this.fire.material.opacity=0;this.smoke.material.opacity=0;this.flash.material.opacity=0;
    } else if (kind === 'pulse') {
      const radius = d * Math.max(4.4, BONUS_DEFS.pulse.radiusD);
      this._ring(kind, point, d * .35, radius, .78, .035, 0, .88);
      this._ring(kind, point, d * .2, radius * .87, .75, .1, .11, .66);
      this._ring(kind, point, d * .12, radius * .68, .68, .17, .22, .5);
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
    const count = { pulse: 32, pierce: 22, arc: 28, frost: 30, gravity: 0, split: 32, heavy: 38, bomb:64 }[kind];
    const heading = Math.atan2(this.direction.z, this.direction.x);
    for (let i = 0; i < count; i++) {
      let a = i / count * Math.PI * 2;
      if (kind === 'split') a = heading + (i < count / 2 ? -.7 : .7) + ((i % 16) / 15 - .5) * .36;
      if (kind === 'pierce') a = heading + (i / count - .5) * .4;
      const speed = d * ({ heavy: 6.2, pierce: 10, pulse: 6.8, split: 7, frost: 3.8, arc: 6, bomb:21 }[kind]) * (.65 + Math.random() * .45);
      const life = kind === 'bomb' ? (i%3===0?1.15+Math.random()*.2:.45+Math.random()*.35) : kind === 'heavy' ? .48 : kind === 'arc' ? .3 + Math.random() * .2 : kind === 'frost' ? .85 : .64;
      const size = d * (kind === 'bomb' ? (i%3===0?.04:.055) : kind === 'heavy' ? .14 : kind === 'pulse' ? .095 : kind === 'frost' ? .07 : .075);
      const stretch = kind === 'bomb' ? (i%3===0?2.5:18+Math.random()*12) : kind === 'frost' ? 5 : kind === 'arc' || kind === 'pierce' ? 10 : kind === 'heavy' ? 2.6 : 4;
      const p = this._particle(kind, point, a, speed, life, size, stretch);
      if (kind === 'bomb') {
        p.v.y=d*(1.5+Math.random()*9);p.glow=1.65;if(i%3===0)p.v.multiplyScalar(.55);
        this.mesh.setColorAt((this.cursor-1)%this.particles.length,this.color.setHex(i%3===0?0xff6b12:i%2?0xfff1a8:0xffac32));
      }
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
    if(!state?.point){this.blackHoleRoot.visible=false;this.blackHoleLastAge=null;return;}
    this.blackHoleRoot.visible=true;this.blackHoleRoot.position.copy(state.point);
    const intensity=Math.max(0,Math.min(1,state.intensity||0));
    const age=Number.isFinite(state.age)?state.age:this.time;
    const range=state.range||state.radius||this.radius*16;
    const core=this.radius*(.5+intensity*.5);
    this.blackHoleCore.scale.setScalar(core);
    for(let i=0;i<3;i++) {
      const ring=this.blackHoleRings[i];
      ring.scale.setScalar(core*(2.05+i*.53));
      // Static inclined accretion rim; only its light flickers, never its orbit.
      ring.rotation.set(-.83+i*.13,.06*(i-1),.04*i);
      ring.position.y=(i-1)*core*.12;
      ring.material.opacity=(.3+intensity*(.62-i*.1))*(.96+.04*Math.sin(age*11+i*2));
    }
    this.blackHoleHalo.scale.set(core*3.65,core*3.05,core*3.65);
    this.blackHoleHalo.rotation.set(-.9,0,.12);
    this.blackHoleHalo.material.opacity=(.035+intensity*.10)*(.97+.03*Math.sin(age*8));
    const reset=this.blackHoleLastAge===null||age<this.blackHoleLastAge;
    const dt=reset?0:Math.max(0,age-this.blackHoleLastAge);
    this.blackHoleLastAge=age;
    const outer=Math.max(this.radius*2,range*.85),sink=this.radius*.36;
    const density=6+30*intensity,speed=.18+.30*intensity;
    for(let i=0;i<36;i++) {
      if(reset)this.blackHoleStreamPhase[i]=i/36;
      const phase=this.blackHoleStreamPhase[i]=(this.blackHoleStreamPhase[i]+dt*speed)%1;
      // r(t) = outer - distance*t^2.2: strictly inward, with growing speed.
      // The endpoint is inside even the smallest dormant core, so no orbital gap.
      const radius=outer-(outer-sink)*Math.pow(phase,2.2);
      const direction=this.blackHoleStreamDirections[i];
      this.dummy.position.copy(direction).multiplyScalar(radius);
      this.dummy.quaternion.setFromUnitVectors(this.up,direction);
      const fadeIn=Math.min(1,phase/.12),fadeOut=Math.min(1,(1-phase)/.13);
      const densityFade=Math.max(0,Math.min(1,density-i));
      const size=this.radius*(.035+intensity*.055);
      const stretch=1.5+(2+intensity*4)*Math.pow(phase,1.2);
      this.dummy.scale.set(size,size*stretch,size);
      this.dummy.updateMatrix();this.blackHoleParticles.setMatrixAt(i,this.dummy.matrix);
      this.blackHoleStreamAlpha.array[i]=fadeIn*fadeOut*densityFade*(.25+intensity*.75);
    }
    this.blackHoleStreamAlpha.needsUpdate=true;
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
        if(p.kind==='bomb'){
          this.dummy.quaternion.setFromUnitVectors(this.up,this.bombDirection.copy(p.v).normalize());
          this.dummy.scale.set(p.size*shrink,p.size*p.stretch*shrink,p.size*shrink);
        }else this.dummy.scale.set(p.size * p.stretch * shrink, p.size * shrink, p.size * shrink);
        this.alpha.array[i] = Math.pow(1 - t, 1.15) * p.glow * (p.kind === 'arc' ? .6 + .4 * Math.sin(t * 65) ** 2 : 1);
      }
      this.dummy.updateMatrix(); this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.alpha.needsUpdate = true; this.mesh.instanceMatrix.needsUpdate = true;
    if (this.bombAge < 1.45) {
      this.bombAge=Math.min(1.45,this.bombAge+dt);
      const t=this.bombAge,d=this.radius*2;this.bombShaderTime.value=t;
      this.flash.position.copy(this.bombPoint);
      const flashSize=d*(.55+Math.min(t/.055,1)*1.15);
      this.flash.scale.set(flashSize,flashSize*.82,flashSize);
      this.flash.material.opacity=Math.pow(Math.max(0,1-t/.16),1.3)*.92;
      this.flash.visible=t<.16;
      for(let i=0;i<16;i++) {
        const age=Math.max(0,t-(i%4)*.018),a=i*2.399963;
        const rise=.45+(i%5)*.19,travel=d*1.32*(.18+(1-Math.exp(-age*4))*(1.25+(i%4)*.38));
        this.dummy.position.set(this.bombPoint.x+Math.cos(a)*travel,this.bombPoint.y+d*(.2+age*rise*2.3),this.bombPoint.z+Math.sin(a)*travel);
        const size=d*1.12*(.12+(1-Math.exp(-age*8))*(.7+(i%3)*.19));
        this.dummy.rotation.set(i*.7+age*.4,i*.9,-age*.6);
        this.dummy.scale.set(size*(.82+(i%3)*.15),size*(1.1+age*.35),size);
        this.dummy.updateMatrix();this.fire.setMatrixAt(i,this.dummy.matrix);
      }
      for(let i=0;i<12;i++) {
        const age=Math.max(0,t-.08),a=i*2.399963+.5;
        const travel=d*(.5+(1-Math.exp(-age*2.8))*(1.7+(i%3)*.35));
        this.dummy.position.set(this.bombPoint.x+Math.cos(a)*travel,this.bombPoint.y+d*(.5+age*(1.35+(i%4)*.23)),this.bombPoint.z+Math.sin(a)*travel);
        const size=d*(.4+age*(.65+(i%3)*.14));
        this.dummy.rotation.set(i+age*.6,i*.7,age*.3);
        this.dummy.scale.set(size,size*(.85+(i%3)*.16),size*1.1);
        this.dummy.updateMatrix();this.smoke.setMatrixAt(i,this.dummy.matrix);
      }
      this.fire.instanceMatrix.needsUpdate=true;this.smoke.instanceMatrix.needsUpdate=true;
      this.fire.material.opacity=Math.min(1,t/.045)*Math.pow(Math.max(0,1-t/1.03),.65)*.92;
      this.smoke.material.opacity=Math.min(1,Math.max(0,t-.07)/.22)*Math.pow(Math.max(0,1-t/1.45),.8)*.22;
      this.fire.visible=t<1.03;this.smoke.visible=t<1.45;
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
    for (const object of [this.mesh, ...this.rings.map(r => r.mesh), this.spiral, this.fire, this.smoke, this.flash, this.blackHoleCore, ...this.blackHoleRings, this.blackHoleHalo, this.blackHoleParticles]) {
      const clone = object.clone(); clone.visible = true; clone.frustumCulled=false;
      clone.material=object.material.clone(); clone.material.opacity=.5;
      clone.material.onBeforeCompile=object.material.onBeforeCompile;
      clone.material.customProgramCacheKey=object.material.customProgramCacheKey;
      clone.userData.powerFXWarmupMaterial=true;
      if(object===this.mesh||object===this.blackHoleParticles){
        clone.geometry=object.geometry.clone();
        clone.geometry.setAttribute('fxAlpha',new this.T.InstancedBufferAttribute(new Float32Array(object===this.mesh?this.particles.length:36).fill(1),1));
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
    this.bombAge=1.45;this.bombShaderTime.value=0;this.fire.visible=false;this.smoke.visible=false;this.flash.visible=false;
    this.fire.material.opacity=0;this.smoke.material.opacity=0;this.flash.material.opacity=0;
    this.blackHoleRoot.visible=false;this.blackHoleLastAge=null;
    this.blackHoleStreamAlpha.array.fill(0);this.blackHoleStreamAlpha.needsUpdate=true;
  }
}
