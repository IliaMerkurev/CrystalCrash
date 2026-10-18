import * as THREE from 'three';

// Screen radii are fractions of the shorter viewport side. Displacement is in
// aspect-correct screen-height units, so the wave stays circular at every aspect.
export const BLAST_LENS_LIMITS = Object.freeze({
 duration: .64,
 minScreenRadius: .012,
 maxScreenRadius: .32,
 maxDisplacement: .006,
});

const smoothstep = value => {
 const t = THREE.MathUtils.clamp(value, 0, 1);
 return t * t * (3 - 2 * t);
};

// A single reusable, short-lived framebuffer lens. It samples the already
// display-encoded frame, never rerenders the arena and never adds a dark layer.
export class BlastLens {
 constructor(renderer, { identity = false } = {}) {
  this.renderer = renderer;
  this.identity = identity;
  this.disposed = false;
  this.size = new THREE.Vector2();
  this.zero = new THREE.Vector2();
  this.point = new THREE.Vector3();
  this.center = new THREE.Vector3();
  this.edge = new THREE.Vector3();
  this.right = new THREE.Vector3();
  this.camera = new THREE.Camera();
  this.scene = new THREE.Scene();
  this.material = new THREE.ShaderMaterial({
   depthTest: false,
   depthWrite: false,
   toneMapped: false,
   blending: THREE.NoBlending,
   uniforms: {
    frame: { value: null },
    center: { value: new THREE.Vector2(.5, .5) },
    halfTexel: { value: new THREE.Vector2() },
    aspect: { value: 1 },
    radius: { value: .1 },
    progress: { value: 0 },
    strength: { value: 0 },
    maxDisplacement: { value: BLAST_LENS_LIMITS.maxDisplacement },
   },
   vertexShader: `varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
   fragmentShader: `
    uniform sampler2D frame;
    uniform vec2 center, halfTexel;
    uniform float aspect, radius, progress, strength, maxDisplacement;
    varying vec2 vUv;
    void main() {
     vec2 scale = vec2(aspect, 1.);
     vec2 d = (vUv - center) * scale;
     float distanceToCenter = length(d);
     float q = distanceToCenter / max(radius, .00001);
     if (q >= 1.) discard;

     // A fast outward-moving, narrow annulus with two refractive shoulders.
     // Its support is local even when the blast origin lies near a screen edge.
     float waveRadius = .10 + .90 * (1. - (1. - progress) * (1. - progress));
     float waveWidth = .055 + .02 * progress;
     float waveDistance = (q - waveRadius) / waveWidth;
     float ring = 1. - smoothstep(.3, 1., abs(waveDistance));
     float boundary = 1. - smoothstep(.90, 1., q);
     vec2 radial = d / max(distanceToCenter, .00001);
     vec2 displacement = radial * sin(waveDistance * 3.14159265) * ring * radius * .05;

     // Lower-amplitude, rising heat/smoke shimmer follows behind the wave.
     // Procedural motion only: no noise textures, persistent haze or tint.
     float heat = (1. - smoothstep(.12, .72, q))
      * (1. - smoothstep(waveRadius - waveWidth, waveRadius + waveWidth, q));
     vec2 local = d / max(radius, .00001);
     vec2 shimmer = vec2(
      sin(local.y * 34. - progress * 19.) * cos(local.x * 23. + progress * 7.),
      cos(local.x * 29. + progress * 13.) * sin(local.y * 21. - progress * 17.)
     );
     displacement += shimmer * radius * .006 * heat * (1. - progress);
     displacement *= boundary * strength;
     displacement *= min(1., maxDisplacement / max(length(displacement), .00001));

     vec2 uv = clamp(vUv + displacement / scale, halfTexel, vec2(1.) - halfTexel);
     vec4 original = texture2D(frame, vUv);
     vec4 refracted = texture2D(frame, uv);
     // No blending, tone mapping or colorspace chunk: the copied framebuffer
     // is already display encoded. Preserve the destination's original alpha.
     gl_FragColor = vec4(refracted.rgb, original.a);
    }`,
  });
  this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
  this.mesh.frustumCulled = false;
  this.scene.add(this.mesh);
  this.clear();
  this.resize();
 }

 resize() {
  this.renderer.getDrawingBufferSize(this.size);
  const width = Math.max(1, Math.floor(this.size.x));
  const height = Math.max(1, Math.floor(this.size.y));
  this.size.set(width, height);
  if (this.texture?.image.width === width && this.texture.image.height === height) return;
  this.texture?.dispose();
  this.texture = new THREE.FramebufferTexture(width, height);
  // Keep default RGBA/UnsignedByte storage. An sRGB internal format can make
  // copyTexSubImage2D invalid against the default framebuffer (black-copy bug).
  this.texture.colorSpace = THREE.NoColorSpace;
  this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
  this.copyValidated = false;
  this.copyFailed = false;
  this.material.uniforms.frame.value = this.texture;
  this.material.uniforms.halfTexel.value.set(.5 / width, .5 / height);
  this.renderer.initTexture(this.texture);
 }

 async warm() {
  if (this.disposed) return;
  await this.renderer.compileAsync(this.scene, this.camera);
 }

 trigger(point, radius) {
  if (this.disposed || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)
   || !Number.isFinite(point.z) || !Number.isFinite(radius) || radius <= 0) return false;
  this.point.copy(point);
  this.worldRadius = radius;
  this.age = 0;
  this.active = true;
  this.material.uniforms.progress.value = 0;
  this.material.uniforms.strength.value = 0;
  return true;
 }

 update(dt) {
  if (!this.active || !Number.isFinite(dt) || dt <= 0) return;
  this.age = Math.min(BLAST_LENS_LIMITS.duration, this.age + dt);
  const u = this.material.uniforms;
  u.progress.value = this.age / BLAST_LENS_LIMITS.duration;
  u.strength.value = this.identity ? 0 : smoothstep(this.age / .018)
   * (1 - smoothstep((this.age - .28) / (BLAST_LENS_LIMITS.duration - .28)));
  if (this.age >= BLAST_LENS_LIMITS.duration) this.active = false;
 }

 render(camera, arenaOffset = 0) {
  if (this.disposed || !this.active || !Number.isFinite(arenaOffset)) return false;
  this.resize();
  if (this.copyFailed) return false;
  this.center.copy(this.point);
  this.center.z += arenaOffset;
  // Camera-right projection avoids foreshortening as the aim camera moves.
  this.right.setFromMatrixColumn(camera.matrixWorld, 0);
  this.edge.copy(this.center).addScaledVector(this.right, this.worldRadius);
  this.center.project(camera);
  this.edge.project(camera);
  if (!Number.isFinite(this.center.x) || !Number.isFinite(this.center.y)
   || !Number.isFinite(this.center.z) || this.center.z >= 1 || this.center.z <= -1) return false;
  const u = this.material.uniforms;
  u.aspect.value = this.size.x / this.size.y;
  const shorterSide = Math.min(1, u.aspect.value);
  const projectedRadius = Math.hypot((this.edge.x - this.center.x) * u.aspect.value,
   this.edge.y - this.center.y) * .5;
  if (!Number.isFinite(projectedRadius)) return false;
  u.radius.value = THREE.MathUtils.clamp(projectedRadius,
   BLAST_LENS_LIMITS.minScreenRadius * shorterSide, BLAST_LENS_LIMITS.maxScreenRadius * shorterSide);
  u.center.value.set((this.center.x + 1) * .5, (this.center.y + 1) * .5);
  const radiusX = u.radius.value / u.aspect.value;
  if (u.center.value.x + radiusX <= 0 || u.center.value.x - radiusX >= 1
   || u.center.value.y + u.radius.value <= 0 || u.center.value.y - u.radius.value >= 1) return false;

  const renderer = this.renderer, autoClear = renderer.autoClear;
  try {
   renderer.copyFramebufferToTexture(this.texture, this.zero);
   if (!this.copyValidated && renderer.getContext) {
    const gl = renderer.getContext(), error = gl.getError();
    this.copyValidated = true;
    if (error !== gl.NO_ERROR) {
     this.copyFailed = true;
     console.warn('Blast lens copy-path GL error (may predate copy)', error);
     return false;
    }
   }
   renderer.autoClear = false;
   renderer.render(this.scene, this.camera);
   return true;
  } finally {
   renderer.autoClear = autoClear;
  }
 }

 clear() {
  this.active = false;
  this.age = BLAST_LENS_LIMITS.duration;
  this.worldRadius = 0;
  this.material.uniforms.progress.value = 1;
  this.material.uniforms.strength.value = 0;
 }

 dispose() {
  if (this.disposed) return;
  this.clear();
  this.disposed = true;
  this.texture?.dispose();
  this.mesh.geometry.dispose();
  this.material.dispose();
 }
}
