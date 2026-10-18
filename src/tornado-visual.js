// Local procedural storm volume. All geometries/materials/pools are allocated once.
// Coordinates use the game's Y-up ground plane; well.point is the physical center.
export const TORNADO_VISUAL_LIMITS = Object.freeze({height:4.7, smoke:80, debris:44, drawCalls:8, maxRadius:2.9, maxHeight:5.2});
const NOISE = `
float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}`;
const VERTEX = `varying vec2 vUv;varying vec3 vLocal;varying vec3 vNormal;void main(){vUv=uv;vLocal=position;vNormal=normalize(normalMatrix*normal);vec4 p=vec4(position,1.);
#ifdef USE_INSTANCING
p=instanceMatrix*p;
#endif
gl_Position=projectionMatrix*modelViewMatrix*p;}`;
export class TornadoVisual {
 constructor({THREE,scene}) {
  this.THREE=THREE;this.scene=scene;this.disposed=false;this.active=false;this.well=null;
  this.group=new THREE.Group();this.group.name='TornadoVisual';this.group.visible=false;scene.add(this.group);
  this.uniforms={time:{value:0},strength:{value:0}};this.geometries=new Set();this.materials=new Set();
  this.dummy=new THREE.Object3D();this.meshes=[];
  const material=(fragmentShader,extra={})=>{const m=new THREE.ShaderMaterial({uniforms:this.uniforms,vertexShader:VERTEX,fragmentShader,transparent:true,depthWrite:false,depthTest:true,side:THREE.DoubleSide,forceSinglePass:true,toneMapped:false,...extra});this.materials.add(m);return m;};
  const add=(geometry,mat)=>{this.geometries.add(geometry);const mesh=new THREE.Mesh(geometry,mat);mesh.frustumCulled=false;this.group.add(mesh);this.meshes.push(mesh);return mesh;};
  const coneMaterial=material(`uniform float time,strength;varying vec2 vUv;varying vec3 vLocal,vNormal;${NOISE}
void main(){float h=vUv.y;float a=atan(vLocal.z,vLocal.x);vec3 p=vec3(cos(a+time*.5)*3.,h*7.-time*.75,sin(a+time*.5)*3.);float n=noise(p*2.)*.65+noise(p*5.)*.35;float band=.5+.5*sin(h*62.-a*3.+time*8.+n*4.);float edge=smoothstep(0.,.09,h)*(1.-smoothstep(.83,1.,h));float rim=pow(1.-abs(normalize(vNormal).z),1.3);vec3 shade=mix(vec3(.12,.19,.27),vec3(.57,.68,.76),n*.65+band*.22+rim*.13);gl_FragColor=vec4(shade,strength*edge*(.18+.30*n+.15*band));}`);
  const coneGeo=new THREE.CylinderGeometry(1.9,.19,4.7,64,36,true);coneGeo.translate(0,2.35,0);
  this.outer=add(coneGeo,coneMaterial);this.inner=add(coneGeo,coneMaterial);this.inner.scale.set(.82,1,.82);this.inner.rotation.y=1.9;
  // Flat broad helix strips, rather than device-dependent WebGL line widths.
  const ribbonGeometry=(phase,turns,width)=>{const steps=240,positions=[],uv=[],indices=[];
   for(let i=0;i<=steps;i++){const t=i/steps,a=phase+t*Math.PI*2*turns,r=.22+1.71*Math.pow(t,.88);for(let side=0;side<2;side++){const y=t*4.62+(side-.5)*width;positions.push(Math.cos(a)*r,y,Math.sin(a)*r);uv.push(t,side);}if(i<steps){let k=i*2;indices.push(k,k+2,k+1,k+1,k+2,k+3);}}
   const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();g.computeBoundingSphere();return g;};
  const ribbon=(orange)=>material(`uniform float time,strength;varying vec2 vUv;varying vec3 vLocal,vNormal;
void main(){float cross=abs(vUv.y-.5)*2.;float edge=pow(1.-cross,1.4);float core=pow(1.-cross,9.);float ends=smoothstep(0.,.025,vUv.x)*(1.-smoothstep(.9,1.,vUv.x));float flow=.65+.35*pow(.5+.5*sin(vUv.x*55.-time*9.),4.);vec3 tint=${orange?'vec3(1.,.25,.025)':'vec3(.025,.65,1.)'};gl_FragColor=vec4(tint*(1.1+core*1.8)+vec3(core*.6),strength*edge*ends*flow*${orange?'.63':'.95'});}`,{blending:THREE.AdditiveBlending});
  const cyan=ribbon(false),orange=ribbon(true);this.ribbons=[];
  for(let i=0;i<4;i++)this.ribbons.push(add(ribbonGeometry(i*2.1,i===3?2.6:3.2,i===3?.055:.19),i===3?orange:cyan));
  const smokeMaterial=material(`uniform float time,strength;varying vec2 vUv;varying vec3 vLocal,vNormal;${NOISE}
void main(){float n=noise(vLocal*5.+vec3(time*.2));float rim=pow(abs(normalize(vNormal).z),1.5);vec3 c=mix(vec3(.20,.25,.30),vec3(.65,.72,.77),n);gl_FragColor=vec4(c,strength*rim*(.09+n*.14));}`);
  const smokeGeo=new THREE.IcosahedronGeometry(1,2);this.geometries.add(smokeGeo);
  this.smoke=new THREE.InstancedMesh(smokeGeo,smokeMaterial,TORNADO_VISUAL_LIMITS.smoke);this.smoke.frustumCulled=false;this.smoke.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.group.add(this.smoke);this.meshes.push(this.smoke);
  const debrisGeo=new THREE.OctahedronGeometry(1,0);this.geometries.add(debrisGeo);
  this.debrisMaterial=new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false,toneMapped:false});this.materials.add(this.debrisMaterial);
  this.debris=new THREE.InstancedMesh(debrisGeo,this.debrisMaterial,TORNADO_VISUAL_LIMITS.debris);this.debris.frustumCulled=false;this.debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.group.add(this.debris);this.meshes.push(this.debris);
  const color=new THREE.Color();for(let i=0;i<TORNADO_VISUAL_LIMITS.debris;i++)this.debris.setColorAt(i,color.setHex(i%9===0?0xffa34b:i%3===0?0x7debff:0x526677));
  this.animate(0);
 }
 animate(time){
  this.uniforms.time.value=time;
  this.outer.rotation.y=time*.45;this.inner.rotation.y=-time*.28+1.9;
  for(let i=0;i<this.ribbons.length;i++)this.ribbons[i].rotation.y=time*(i===3?-1.6:-2.15)+i*.3;
  const d=this.dummy;
  for(let i=0;i<TORNADO_VISUAL_LIMITS.smoke;i++){
   const dust=i<28,t=dust?(i%7)/55:((i-28)/52+time*.065)%1;
   const a=i*2.39996-time*(dust?1.3:1.9),r=dust?.35+(i%7)*.17:.22+1.7*Math.pow(t,.88);
   const s=dust?.24+(i%4)*.045:.13+t*.24;
   d.position.set(Math.cos(a)*r,dust?.13+(i%3)*.1:t*4.63,Math.sin(a)*r);d.rotation.set(i*.7,a,i*.3);d.scale.set(s*1.4,s*.8,s);d.updateMatrix();this.smoke.setMatrixAt(i,d.matrix);
  }
  for(let i=0;i<TORNADO_VISUAL_LIMITS.debris;i++){
   const t=(i/44+time*(.07+(i%3)*.014))%1,a=i*2.39996-time*2.8,r=.35+1.85*t,s=i%3===0?.021:.035+(i%4)*.013;
   d.position.set(Math.cos(a)*r,t*4.7,Math.sin(a)*r);d.rotation.set(time+i,a,time*.8);d.scale.set(s,s*(1+i%2),s);d.updateMatrix();this.debris.setMatrixAt(i,d.matrix);
  }
  this.smoke.instanceMatrix.needsUpdate=true;this.debris.instanceMatrix.needsUpdate=true;
 }
 update(well,dt,time){
  if(this.disposed)return;
  if(!well||!well.point||!(well.range>0)||!(well.duration>0)||!Number.isFinite(time)||time>=well.expires){this.clear();return;}
  const elapsed=Math.max(0,time-well.born),remaining=Math.max(0,well.expires-time);
  this.well=well;this.active=true;this.group.visible=true;
  // Physical center already moves smoothly. Copy it exactly to avoid visual/force lag.
  this.group.position.set(well.point.x,.04,well.point.z);
  const width=Math.min(1.1,Math.max(.7,well.range/4));this.group.scale.set(width,1,width);
  this.uniforms.strength.value=Math.min(1,elapsed/.18,remaining/.42);this.debrisMaterial.opacity=this.uniforms.strength.value*.85;
  this.animate(elapsed);
 }
 clear(){this.active=false;this.well=null;this.group.visible=false;this.uniforms.strength.value=0;this.debrisMaterial.opacity=0;}
 warmupObjects(){
  // Real Mesh and InstancedMesh variants, with identical geometry and materials.
  // Caller releases warmup materials/instance buffers with releaseInstance(); geometry stays shared.
  const warm=new this.THREE.Group();warm.name='TornadoVisualWarmup';
  if(this.disposed)return warm;
  for(const mesh of this.meshes){
   const clone=mesh.clone();clone.visible=true;clone.frustumCulled=false;
   clone.material=mesh.material.clone();clone.material.opacity=.5;
   if(clone.material.uniforms?.strength)clone.material.uniforms.strength.value=.5;
   clone.userData.powerFXWarmupMaterial=true;clone.scale.multiplyScalar(.12);warm.add(clone);
  }return warm;
 }
 dispose(){if(this.disposed)return;this.clear();this.group.removeFromParent();this.smoke.dispose();this.debris.dispose();for(const geometry of this.geometries)geometry.dispose();for(const material of this.materials)material.dispose();this.disposed=true;}
}
