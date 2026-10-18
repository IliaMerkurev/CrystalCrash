import * as DefaultTHREE from 'three';

/** Visuals only. XY is the icon plane, +Z its front; Y is up.
 * Factory owns shared GPU resources. Remove/reuse instances; releaseInstance()
 * frees only per-instance instancing buffers when permanently discarding cores.
 * Call dispose() only after removing every instance. No frame loop is installed.
 */
export function createBonusVisuals(THREE = DefaultTHREE) {
  const kinds = ['pulse', 'pierce', 'arc', 'halo', 'frost', 'split', 'gravity', 'heavy'];
  const unitBounds = {};
  const colors = {pulse: 0xffb44a, pierce: 0x44d9ff, arc: 0xb68cff, halo: 0xff777d, frost: 0xb8e9f5, split: 0xf27ed2, gravity: 0x7887ff, heavy: 0xe98745};
  const geometries = new Set(), materials = new Set();
  const ownGeometry = geometry => (geometries.add(geometry), geometry);
  const ownMaterial = material => (materials.add(material), material);
  const metal = ownMaterial(new THREE.MeshStandardMaterial({color: 0xa6b3c5, metalness: .96, roughness: .18}));
  const darkMetal = ownMaterial(new THREE.MeshStandardMaterial({color: 0x202938, metalness: .9, roughness: .24}));
  const surfaces = {}, lights = {}, glows = {}, coreLights = {}, coreGlows = {}, cloudMaterials = {};
  const glowSize = 32, pixels = new Uint8Array(glowSize * glowSize * 4);
  for (let y = 0; y < glowSize; y++) for (let x = 0; x < glowSize; x++) {
    const r = Math.hypot((x + .5) / glowSize * 2 - 1, (y + .5) / glowSize * 2 - 1);
    const i = (y * glowSize + x) * 4;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
    pixels[i + 3] = Math.round(255 * Math.exp(-r * r * 7) * Math.max(0, 1 - r));
  }
  const glowTexture = new THREE.DataTexture(pixels, glowSize, glowSize);
  glowTexture.magFilter = glowTexture.minFilter = THREE.LinearFilter;
  glowTexture.needsUpdate = true;
  for (const kind of kinds) {
    cloudMaterials[kind] = ownMaterial(new THREE.ShaderMaterial({
      transparent:true,depthWrite:false,depthTest:true,blending:THREE.AdditiveBlending,toneMapped:false,
      uniforms:{tint:{value:new THREE.Color(colors[kind])},phase:{value:0}},
      vertexShader:'varying vec2 uvCloud; void main(){uvCloud=uv;vec4 c=modelViewMatrix*instanceMatrix*vec4(0.,0.,0.,1.);vec2 size=vec2(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz));c.xy+=position.xy*size*length(modelViewMatrix[0].xyz);gl_Position=projectionMatrix*c;}',
      fragmentShader:'varying vec2 uvCloud;uniform vec3 tint;void main(){float r=length(uvCloud-.5)*2.;float a=exp(-r*r*3.2)*(1.-smoothstep(.7,1.,r));gl_FragColor=vec4(tint,a*.32);}'
    }));
    surfaces[kind] = ownMaterial(new THREE.MeshStandardMaterial({color: colors[kind], emissive: colors[kind], emissiveIntensity: .48, metalness: .42, roughness: .23}));
    lights[kind] = ownMaterial(new THREE.MeshBasicMaterial({color: colors[kind], toneMapped: false}));
    coreLights[kind] = ownMaterial(new THREE.MeshBasicMaterial({color:new THREE.Color(colors[kind]).multiplyScalar(2.2),transparent:true,opacity:.95,blending:THREE.AdditiveBlending,depthTest:true,depthWrite:false,toneMapped:false}));
    coreGlows[kind] = ownMaterial(new THREE.SpriteMaterial({map:glowTexture,color:new THREE.Color(colors[kind]).multiplyScalar(1.1),transparent:true,opacity:.42,blending:THREE.AdditiveBlending,depthTest:true,depthWrite:false,toneMapped:false}));
    glows[kind] = ownMaterial(new THREE.SpriteMaterial({map: glowTexture, color: colors[kind], transparent: true, opacity: .28, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false}));
  }
  const cloudQuad = ownGeometry(new THREE.PlaneGeometry(1,1));
  const sphere = ownGeometry(new THREE.SphereGeometry(1, 16, 10));
  const dotGeometry = ownGeometry(new THREE.SphereGeometry(.006, 6, 4));
  const box = ownGeometry(new THREE.BoxGeometry(1, 1, 1));
  const torus = (radius, tube, arc = Math.PI * 2) => ownGeometry(new THREE.TorusGeometry(radius, tube, 8, 40, arc));
  const ring = torus(.415, .065), ringInset = torus(.415, .033);
  const thinRing = torus(.115, .002);
  const haloRim = torus(.38, .085, Math.PI), haloInset = torus(.38, .048, Math.PI);
  const accentRing = torus(.53, .012, Math.PI * 1.45);
  const chargeArc = torus(.53, .018, .36);
  function polygon(points) {
    const shape = new THREE.Shape();
    shape.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, {depth: .085, bevelEnabled: true, bevelThickness: .018, bevelSize: .018, bevelSegments: 2, curveSegments: 1, steps: 1});
    geometry.translate(0, 0, -.0425);
    return ownGeometry(geometry);
  }
  const arrowChevron = polygon([[-.13, -.30], [.075, -.20], [.19, 0], [.075, .20], [-.13, .30], [-.025, 0]]);
  const arrowTip = polygon([[-.12, -.22], [.22, 0], [-.12, .22], [-.025, 0]]);
  const bolt = polygon([[.18, .47], [-.34, -.03], [-.075, -.065], [-.19, -.44], [.36, .10], [.075, .13]]);
  // Six broad spokes read as three crossed icy planks at pickup scale.
  const snowflakePoints = [];
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3;
    for (const [offset, radius] of [[-.42, .12], [-.105, .46], [.105, .46], [.42, .12]]) {
      snowflakePoints.push([Math.cos(a + offset) * radius, Math.sin(a + offset) * radius]);
    }
  }
  const snowflake = polygon(snowflakePoints);
  const gravityRing = torus(.39, .033), gravityInset = torus(.39, .013);
  const weightBody = ownGeometry(new THREE.CylinderGeometry(.26, .41, .62, 6, 1));
  const weightBase = ownGeometry(new THREE.CylinderGeometry(.42, .44, .10, 6, 1));
  const weightCap = ownGeometry(new THREE.CylinderGeometry(.285, .285, .085, 6, 1));
  const key = kind => {
    if (kind === 'gravityWell' || kind === 'gravity-well' || kind === 'gravity_well') return 'gravity';
    if (kind === 'heavyHit' || kind === 'heavy-hit' || kind === 'heavy_hit') return 'heavy';
    if (kind === 'safetyHalo' || kind === 'safety-halo' || kind === 'safety_halo') return 'halo';
    if (!kinds.includes(kind)) throw new Error(`Unknown bonus visual: ${kind}`);
    return kind;
  };
  function mesh(parent, geometry, material, x = 0, y = 0, z = 0, sx = 1, sy = sx, sz = sx) {
    const object = new THREE.Mesh(geometry, material);
    object.position.set(x, y, z); object.scale.set(sx, sy, sz);
    parent.add(object); return object;
  }
  function inset(parent, geometry, kind, x = 0, y = 0) {
    mesh(parent, geometry, metal, x, y);
    mesh(parent, geometry, surfaces[kind], x, y, .051, .80, .80, .65);
    // Both faces retain their colored inset if the pickup turns while falling.
    mesh(parent, geometry, surfaces[kind], x, y, -.051, .80, .80, .65);
  }
  function createModel(kind) {
    kind = key(kind);
    const group = new THREE.Group(); group.name = `bonus-${kind}`;
    group.userData.bonusKind = kind;
    if (kind === 'pulse') {
      mesh(group, ring, metal);
      mesh(group, ringInset, surfaces[kind], 0, 0, .055);
      mesh(group, ringInset, surfaces[kind], 0, 0, -.055);
      mesh(group, sphere, surfaces[kind], 0, 0, 0, .155);
      mesh(group, sphere, lights[kind], -.025, .025, .135, .045);
      const orbit = mesh(group, ringInset, darkMetal);
      orbit.rotation.x = 1.03; orbit.rotation.y = .38;
    } else if (kind === 'pierce') {
      inset(group, arrowChevron, kind, -.32);
      inset(group, arrowChevron, kind, .015);
      inset(group, arrowTip, kind, .34);
      group.scale.setScalar(.96);
    } else if (kind === 'arc') {
      inset(group, bolt, kind);
      mesh(group, sphere, metal, .18, .47, 0, .095);
      mesh(group, sphere, metal, -.19, -.44, 0, .095);
      mesh(group, sphere, surfaces[kind], .18, .47, .07, .036);
      mesh(group, sphere, surfaces[kind], -.19, -.44, .07, .036);
      group.scale.setScalar(1.12);
    } else if (kind === 'halo') {
      mesh(group, haloRim, metal, 0, -.08);
      mesh(group, haloInset, surfaces[kind], 0, -.08, .066);
      mesh(group, haloInset, surfaces[kind], 0, -.08, -.066);
      for (const x of [-.38, .38]) {
        mesh(group, box, metal, x, -.17, 0, .22, .18, .23);
        mesh(group, box, surfaces[kind], x, -.065, 0, .145, .025, .16);
      }
    }
    if (kind === 'frost') {
      inset(group, snowflake, kind);
      mesh(group, sphere, metal, 0, 0, 0, .115);
      mesh(group, sphere, surfaces[kind], 0, 0, .07, .078);
    } else if (kind === 'split') {
      // Three separate lobes retain a recognizable silhouette in monochrome.
      for (const [x, y] of [[0, .26], [-.28, -.22], [.28, -.22]]) {
        mesh(group, sphere, metal, x, y, 0, .205);
        mesh(group, sphere, surfaces[kind], x, y, .105, .145);
        mesh(group, sphere, surfaces[kind], x, y, -.105, .145);
      }
    } else if (kind === 'gravity') {
      mesh(group, sphere, darkMetal, 0, 0, 0, .19);
      mesh(group, sphere, surfaces[kind], -.035, .035, .14, .07);
      for (let i = 0; i < 2; i++) {
        const orbit = new THREE.Group(); orbit.rotation.set(i ? -.78 : .78, i ? -.38 : .38, i ? -.48 : .48);
        mesh(orbit, gravityRing, metal);
        mesh(orbit, gravityInset, surfaces[kind], 0, 0, .031);
        group.add(orbit);
      }
      mesh(group, sphere, surfaces[kind], .35, .13, .09, .05);
    } else if (kind === 'heavy') {
      mesh(group, weightBody, surfaces[kind]);
      mesh(group, weightBase, metal, 0, -.305);
      mesh(group, weightCap, metal, 0, .31);
      // Three descending bright bars on the broad front face of the weight.
      for (let i = 0; i < 3; i++) {
        mesh(group, box, darkMetal, (i - 1) * .125, .02, .348, .10, .30 - i * .06, .026);
        mesh(group, box, lights[kind], (i - 1) * .125, .02, .365, .045, .24 - i * .06, .012);
      }
    }
    // Keep the public root transform clean for physics positioning/scaling.
    const bounds = new THREE.Box3().setFromObject(group);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const normalization = 1 / Math.max(size.x, size.y);
    group.scale.multiplyScalar(normalization);
    group.position.copy(center).multiplyScalar(-normalization);
    const root = new THREE.Group(); root.name = group.name; root.add(group);
    const dimensions = unitBounds[kind] || (unitBounds[kind] = Object.freeze({
      width: size.x * normalization, height: size.y * normalization,
      depth: size.z * normalization, groundHeight: size.y * normalization / 2,
    }));
    root.userData.bonusKind = kind;
    root.userData.unitBounds = dimensions;
    root.userData.groundHeight = dimensions.groundHeight;
    return root;
  }
  function createCore(kind) {
    return createParticleSun(kind, false);
  }
  /** A small release aura, in pickup-model local units. No central sun or icon.
   * Attach to the model root and call animateCore(aura, seconds).
   */
  function createPickupAura(kind) {
    return createParticleSun(kind, true);
  }
  function createParticleSun(kind, pickup) {
    kind = key(kind);
    const group = new THREE.Group(); group.name = `${pickup ? 'pickup-aura' : 'core'}-${kind}`;
    const sun = pickup ? null : new THREE.Sprite(coreGlows[kind]);
    const pin = pickup ? null : new THREE.Sprite(coreGlows[kind]);
    if(sun){sun.scale.set(.44,.44,1);group.add(sun);pin.scale.set(.20,.20,1);pin.position.set(-.012,.012,.058);group.add(pin);}
    const orbit = mesh(group, thinRing, pickup ? lights[kind] : coreLights[kind]);
    orbit.scale.setScalar(pickup ? 1.8 : 2.05); orbit.rotation.set(.8, .25, .2);
    const orbit2 = pickup ? null : mesh(group, thinRing, coreLights[kind]);
    if (orbit2) {orbit2.scale.setScalar(1.66); orbit2.rotation.set(-.65, .6, -.5);}
    const cloud = pickup ? null : new THREE.InstancedMesh(cloudQuad,cloudMaterials[kind],56);
    if(cloud){cloud.frustumCulled=false;cloud.instanceMatrix.setUsage(THREE.DynamicDrawUsage);group.add(cloud);}
    const count = pickup ? 16 : 32;
    const dots = new THREE.InstancedMesh(dotGeometry, coreLights[kind], count);
    dots.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    dots.frustumCulled = false; group.add(dots);
    // Deterministic variations are allocated once, never inside the frame loop.
    const particles = new Float32Array(count * 5);
    for (let i = 0; i < count; i++) {
      const dense = !pickup && i < 10, j = i * 5;
      particles[j] = i * 2.39996323;
      particles[j + 1] = dense ? .075 + (i % 5) * .024 : .17 + (i % 6) * .022;
      particles[j + 2] = (.34 + (i % 5) * .085) * (i % 2 ? 1 : -1);
      particles[j + 3] = .58 + (i % 4) * .12;
      particles[j + 4] = pickup ? 1 + (i % 4) * .28 : 1.8 + (i % 5) * .48;
    }
    const glow = new THREE.Sprite(pickup ? glows[kind] : coreGlows[kind]);
    const glowDiameter = pickup ? .22 : .82;
    glow.scale.set(glowDiameter, glowDiameter, 1); group.add(glow);
    if (!pickup) {
      // Compact stacked halos give a dense bright sun while keeping the cube rim readable.
      const innerHalo = new THREE.Sprite(coreGlows[kind]); innerHalo.scale.set(.54, .54, 1); group.add(innerHalo);
      const centerHalo = new THREE.Sprite(coreGlows[kind]); centerHalo.scale.set(.30, .30, 1); group.add(centerHalo);
    }
    group.traverse(object => {object.renderOrder = 6;});
    group.userData.bonusKind = kind;
    group.userData.coreAnimation = {sun, pin, orbit, orbit2, dots, particles, pickup, cloud,
      matrix: new THREE.Matrix4(), particleScale: new THREE.Vector3()};
    animateCore(group, 0);
    return group;
  }
  /** Time in seconds; no allocations and no position/lifecycle changes.
   * Supports sealed suns and released pickup auras.
   */
  function animateCore(group, time) {
    const data = group.userData.coreAnimation;
    if (!data) return;
    if (data.sun) data.sun.scale.setScalar(.44 * (1 + .055 * Math.sin(time * 2.2)));
    data.orbit.rotation.z = .2 + time * .22;
    if (data.orbit2) data.orbit2.rotation.z = -.5 - time * .16;
    for (let i = 0; i < data.dots.count; i++) {
      const j = i * 5, angle = data.particles[j] + time * data.particles[j + 2];
      const radius = data.particles[j + 1], tilt = data.particles[j + 3];
      const pulse = 1 + .12 * Math.sin(time * 2.6 + i * 1.7);
      data.matrix.makeTranslation(Math.cos(angle) * radius, Math.sin(angle) * radius * tilt,
        Math.sin(angle + i * .9) * radius * .42);
      data.particleScale.setScalar(data.particles[j + 4] * pulse);
      data.matrix.scale(data.particleScale);
      data.dots.setMatrixAt(i, data.matrix);
    }
    data.dots.instanceMatrix.needsUpdate = true;
    if(data.cloud){
      for(let i=0;i<data.cloud.count;i++){
        // Full spherical volume, not foreshortened planar orbits. Outer glow reaches .40.
        const y=1-2*(i+.5)/data.cloud.count,radial=Math.sqrt(1-y*y);
        const angle=i*2.39996323+time*(.12+(i%3)*.025),radius=.21+(i%5)*.032;
        data.matrix.makeTranslation(Math.cos(angle)*radial*radius,y*radius,Math.sin(angle)*radial*radius);
        data.particleScale.setScalar(.20+.035*Math.sin(time*1.7+i));
        data.matrix.scale(data.particleScale);data.cloud.setMatrixAt(i,data.matrix);
      }
      data.cloud.instanceMatrix.needsUpdate=true;
    }
  }
  /** Diameter ~1.08: multiply scale by the ball diameter, not its radius.
   * Pierce and Frost expose userData.charges (three meshes) for charge visibility.
   */
  function createBallAccent(kind) {
    kind = key(kind);
    const group = new THREE.Group(); group.name = `ball-accent-${kind}`;
    group.userData.bonusKind = kind;
    if (kind === 'pierce' || kind === 'frost') {
      group.userData.charges = [];
      for (let i = 0; i < 3; i++) {
        const charge = mesh(group, chargeArc, lights[kind]);
        charge.rotation.set(-Math.PI / 2, 0, .3 + i * .55);
        group.userData.charges.push(charge);
      }
    } else {
      const band = mesh(group, accentRing, surfaces[kind]);
      band.rotation.set(-.9, .2, kind === 'halo' ? -.7 : .4);
      if (kind === 'arc') {
        const symbol = mesh(group, bolt, surfaces[kind], 0, .48, .22, .16);
        symbol.rotation.z = -.2;
      }
      if (kind === 'split' || kind === 'gravity' || kind === 'heavy') {
        const symbol = createModel(kind);
        symbol.scale.setScalar(.19); symbol.position.set(0, .47, .24);
        group.add(symbol);
      }
    }
    return group;
  }
  /** Add this group to a lit scene for compileAsync + a real offscreen draw.
   * Remove afterward without disposing geometries/materials. All draw variants
   * (standard, basic, sprites, instancing) are represented before PLAY.
   */
  function warmupObjects() {
    const group = new THREE.Group(); group.name = 'bonus-visual-warmup';
    for (let i = 0; i < kinds.length; i++) {
      const model = createModel(kinds[i]), core = createCore(kinds[i]), accent = createBallAccent(kinds[i]);
      model.add(createPickupAura(kinds[i]));
      model.position.x = (i - (kinds.length - 1) / 2) * 1.2; core.position.set(model.position.x, .8, .1); accent.position.set(model.position.x, -.8, .1);
      group.add(model, core, accent);
    }
    group.traverse(object => {object.frustumCulled = false;});
    return group;
  }
  /** Optional cleanup for permanently discarded cores / warmup groups.
   * Does not touch shared materials or geometries; do not use on pooled cores.
   */
  function releaseInstance(root) {
    root.traverse(object => {if (object.isInstancedMesh) object.dispose();});
  }
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    glowTexture.dispose();
  }
  return {createModel, createCore, createPickupAura, animateCore, createBallAccent, warmupObjects, releaseInstance, dispose, colors, unitBounds};
}
