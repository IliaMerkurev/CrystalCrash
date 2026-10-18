import * as DefaultTHREE from 'three';

/** Visuals only. XY is the icon plane, +Z its front; Y is up.
 * Factory owns shared GPU resources. Remove/reuse instances; releaseInstance()
 * frees only per-instance instancing buffers when permanently discarding cores.
 * Call dispose() only after removing every instance. No frame loop is installed.
 */
export function createBonusVisuals(THREE = DefaultTHREE) {
  const kinds = ['pulse', 'pierce', 'arc', 'halo'];
  const unitBounds = {};
  const colors = {pulse: 0xffb44a, pierce: 0x44d9ff, arc: 0xb68cff, halo: 0xff777d};
  const geometries = new Set(), materials = new Set();
  const ownGeometry = geometry => (geometries.add(geometry), geometry);
  const ownMaterial = material => (materials.add(material), material);
  const metal = ownMaterial(new THREE.MeshStandardMaterial({color: 0xa6b3c5, metalness: .96, roughness: .18}));
  const darkMetal = ownMaterial(new THREE.MeshStandardMaterial({color: 0x202938, metalness: .9, roughness: .24}));
  const surfaces = {}, lights = {}, glows = {};
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
    surfaces[kind] = ownMaterial(new THREE.MeshStandardMaterial({color: colors[kind], emissive: colors[kind], emissiveIntensity: .48, metalness: .42, roughness: .23}));
    lights[kind] = ownMaterial(new THREE.MeshBasicMaterial({color: colors[kind], toneMapped: false}));
    glows[kind] = ownMaterial(new THREE.SpriteMaterial({map: glowTexture, color: colors[kind], transparent: true, opacity: .28, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false}));
  }
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
  const key = kind => {
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
    } else {
      mesh(group, haloRim, metal, 0, -.08);
      mesh(group, haloInset, surfaces[kind], 0, -.08, .066);
      mesh(group, haloInset, surfaces[kind], 0, -.08, -.066);
      for (const x of [-.38, .38]) {
        mesh(group, box, metal, x, -.17, 0, .22, .18, .23);
        mesh(group, box, surfaces[kind], x, -.065, 0, .145, .025, .16);
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
    kind = key(kind);
    const group = new THREE.Group(); group.name = `core-${kind}`;
    const sun = mesh(group, sphere, surfaces[kind], 0, 0, -.025, .032);
    const pin = mesh(group, sphere, lights[kind], 0, 0, .006, .012);
    const silhouette = createModel(kind); silhouette.scale.multiplyScalar(.145); silhouette.position.z = .015; group.add(silhouette);
    const orbit = mesh(group, thinRing, lights[kind]); orbit.rotation.set(.8, .25, .2);
    const dots = new THREE.InstancedMesh(dotGeometry, lights[kind], 6);
    dots.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    dots.frustumCulled = false; group.add(dots);
    const glow = new THREE.Sprite(glows[kind]); glow.scale.set(.28, .28, 1); group.add(glow);
    group.userData.bonusKind = kind;
    group.userData.coreAnimation = {sun, pin, orbit, dots, silhouette, matrix: new THREE.Matrix4()};
    animateCore(group, 0);
    return group;
  }
  /** Time in seconds; no allocations and no position/lifecycle changes. */
  function animateCore(group, time) {
    const data = group.userData.coreAnimation;
    if (!data) return;
    data.sun.scale.setScalar(.032 * (1 + .08 * Math.sin(time * 2.2)));
    data.orbit.rotation.z = .2 + time * .22;
    data.silhouette.rotation.y = Math.sin(time * .65) * .24;
    for (let i = 0; i < 6; i++) {
      const angle = i * Math.PI / 3 + time * .42;
      const radius = .112 + (i % 2) * .017;
      data.matrix.makeTranslation(Math.cos(angle) * radius, Math.sin(angle) * radius * .64, Math.sin(angle * 2 + i) * .035);
      data.dots.setMatrixAt(i, data.matrix);
    }
    data.dots.instanceMatrix.needsUpdate = true;
  }
  /** Diameter ~1.08: multiply scale by the ball diameter, not its radius.
   * Pierce exposes userData.charges (three meshes) for charge visibility.
   */
  function createBallAccent(kind) {
    kind = key(kind);
    const group = new THREE.Group(); group.name = `ball-accent-${kind}`;
    group.userData.bonusKind = kind;
    if (kind === 'pierce') {
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
      model.position.x = (i - 1.5) * 1.2; core.position.set(model.position.x, .8, .1); accent.position.set(model.position.x, -.8, .1);
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
  return {createModel, createCore, animateCore, createBallAccent, warmupObjects, releaseInstance, dispose, colors, unitBounds};
}
