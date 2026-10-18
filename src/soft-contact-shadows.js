/** Cheap, render-only ground contact cues. One instanced draw, no textures.
 * update() receives scene-local coordinates (including top/bottom/half).
 * balls: iterable of {mesh, radius}, {p, radius}, {position, radius}, or echo records.
 * blocks: Map or iterable of {mesh, sx, sy, sz}; geometry bounds take precedence.
 * half: constant half-width or linear tableHalf(z) function. The game table tapers linearly.
 * Explicit Shadows Off must be passed as enabled:false by the rendering policy.
 */
export const SOFT_CONTACT_LIMITS = Object.freeze({initialCapacity:128,maxCapacity:4096,drawCalls:1,maxAltitude:5});
const VERTEX = `
attribute float contactOpacity;
attribute float contactShape;
varying vec2 contactUV;
varying vec2 tablePosition;
varying float shadowOpacity;
varying float shadowShape;
void main(){
 contactUV=uv*2.-1.;shadowOpacity=contactOpacity;shadowShape=contactShape;
 vec4 local=instanceMatrix*vec4(position,1.);
 tablePosition=local.xz;
 gl_Position=projectionMatrix*modelViewMatrix*local;
}`;
const FRAGMENT = `
uniform vec4 tableBounds;
varying vec2 contactUV;
varying vec2 tablePosition;
varying float shadowOpacity;
varying float shadowShape;
void main(){
 float r=mix(length(contactUV),max(abs(contactUV.x),abs(contactUV.y)),shadowShape*.72);
 float radial=exp(-3.5*r*r)*(1.-smoothstep(.45,1.,r));
 float along=clamp((tablePosition.y-tableBounds.x)/(tableBounds.y-tableBounds.x),0.,1.);
 float halfWidth=mix(tableBounds.z,tableBounds.w,along);
 float edge=min(min(tablePosition.y-tableBounds.x,tableBounds.y-tablePosition.y),halfWidth-abs(tablePosition.x));
 float alpha=shadowOpacity*radial*smoothstep(0.,.055,edge);
 if(alpha<.001)discard;
 gl_FragColor=vec4(.018,.026,.038,alpha);
}`;
const values=source=>source instanceof Map?source.values():(source||[]);
const finite=Number.isFinite;

export class SoftContactShadows {
 constructor({THREE,scene}){
  this.THREE=THREE;this.scene=scene;this.disposed=false;this.capacity=0;this.count=0;
  this.group=new THREE.Group();this.group.name='SoftContactShadows';this.group.visible=false;scene.add(this.group);
  this.uniforms={tableBounds:{value:new THREE.Vector4(-6,6,6.25,6.25)}};
  this.material=new THREE.ShaderMaterial({uniforms:this.uniforms,vertexShader:VERTEX,fragmentShader:FRAGMENT,transparent:true,depthWrite:false,depthTest:true,toneMapped:false,side:THREE.FrontSide});
  this.dummy=new THREE.Object3D();this.dummy.rotation.x=-Math.PI/2;
  this.sourceMatrix=new THREE.Matrix4();this.sourceBounds=new THREE.Box3();
  this.ensureCapacity(SOFT_CONTACT_LIMITS.initialCapacity);
 }
 ensureCapacity(requested){
  if(requested<=this.capacity||this.disposed)return;
  const capacity=Math.min(SOFT_CONTACT_LIMITS.maxCapacity,Math.max(SOFT_CONTACT_LIMITS.initialCapacity,2**Math.ceil(Math.log2(requested))));
  if(capacity<=this.capacity)return;
  const T=this.THREE,old=this.mesh,geometry=new T.PlaneGeometry(2,2);
  const opacity=new T.InstancedBufferAttribute(new Float32Array(capacity).fill(.3),1);opacity.setUsage(T.DynamicDrawUsage);geometry.setAttribute('contactOpacity',opacity);
  const shape=new T.InstancedBufferAttribute(new Float32Array(capacity),1);shape.setUsage(T.DynamicDrawUsage);geometry.setAttribute('contactShape',shape);
  const mesh=new T.InstancedMesh(geometry,this.material,capacity);mesh.name='SoftContactShadowBatch';mesh.renderOrder=-9;mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);mesh.count=0;
  // A growth can happen mid-frame; preserve already populated slots.
  if(old){mesh.instanceMatrix.array.set(old.instanceMatrix.array);opacity.array.set(old.geometry.attributes.contactOpacity.array);shape.array.set(old.geometry.attributes.contactShape.array);old.removeFromParent();old.dispose();old.geometry.dispose();}
  this.mesh=mesh;this.capacity=capacity;this.group.add(mesh);
 }
 put(x,z,rx,rz,altitude,opacity,shape=0){
  if(!finite(x)||!finite(z)||!finite(rx)||!finite(rz)||!finite(altitude)||rx<=0||rz<=0||altitude>=SOFT_CONTACT_LIMITS.maxAltitude||this.count>=SOFT_CONTACT_LIMITS.maxCapacity)return;
  const b=this.uniforms.tableBounds.value;
  const h=Math.max(0,altitude),spread=1+Math.min(h,4)*.18;
  rx*=spread;rz*=spread;
  if(z+rz<b.x||z-rz>b.y)return;
  const t0=Math.max(0,Math.min(1,(z-rz-b.x)/(b.y-b.x))),t1=Math.max(0,Math.min(1,(z+rz-b.x)/(b.y-b.x)));
  if(Math.abs(x)-rx>Math.max(b.z+(b.w-b.z)*t0,b.z+(b.w-b.z)*t1))return;
  const fade=Math.pow(1+h*1.2,-2)*Math.min(1,(SOFT_CONTACT_LIMITS.maxAltitude-h)/1.5);
  if(opacity*fade<.003)return;
  this.ensureCapacity(this.count+1);
  this.dummy.position.set(x,.004,z);this.dummy.scale.set(rx,rz,1);this.dummy.updateMatrix();
  this.mesh.setMatrixAt(this.count,this.dummy.matrix);this.mesh.geometry.attributes.contactOpacity.setX(this.count,opacity*fade);this.mesh.geometry.attributes.contactShape.setX(this.count,shape);this.count++;
 }
 update({enabled=false,balls=[],blocks=[],top=-6,bottom=6,half=6.25}={}){
  if(this.disposed)return;
  this.clear();if(!enabled||!finite(top)||!finite(bottom)||bottom<=top)return;
  const far=typeof half==='function'?half(top):half,near=typeof half==='function'?half(bottom):half;
  if(!finite(far)||!finite(near)||far<=0||near<=0)return;
  this.uniforms.tableBounds.value.set(top,bottom,far,near);
  for(const ball of values(balls)){
   if(!ball||ball.removed||ball.valid===false||ball.visible===false)continue;
   // Echo meshes are pose proxies and can intentionally be hidden behind a shared batch.
   const mesh=ball.mesh,p=ball.p||ball.position||mesh?.position||ball.b?.translation?.();
   const radius=ball.radius??mesh?.geometry?.parameters?.radius??.38;
   if(!p||!finite(radius)||radius<=0||p.y+radius<-.02)continue;
   this.put(p.x,p.z,radius*1.6,radius*1.6,p.y-radius,.3);
  }
  for(const block of values(blocks)){
   if(!block||block.removed||block.visible===false||block.mesh?.visible===false)continue;
   const mesh=block.mesh;
   if(mesh?.geometry){
    const geometry=mesh.geometry;if(!geometry.boundingBox)geometry.computeBoundingBox();
    if(!geometry.boundingBox)continue;
    this.sourceMatrix.compose(mesh.position,mesh.quaternion,mesh.scale);
    this.sourceBounds.copy(geometry.boundingBox).applyMatrix4(this.sourceMatrix);
    const {min,max}=this.sourceBounds;if(max.y<-.02)continue;
    this.put((min.x+max.x)/2,(min.z+max.z)/2,(max.x-min.x)*.66+.08,(max.z-min.z)*.66+.08,min.y,.18,1);
   }else{
    const p=block.p||block.position||block.b?.translation?.();if(!p)continue;
    const sx=block.sx??.88,sy=block.sy??.88,sz=block.sz??.88;if(p.y+sy/2<-.02)continue;
    this.put(p.x,p.z,sx*.66+.08,sz*.66+.08,p.y-sy/2,.18,1);
   }
  }
  this.mesh.count=this.count;this.group.visible=this.count>0;
  if(this.count){this.mesh.instanceMatrix.needsUpdate=true;this.mesh.geometry.attributes.contactOpacity.needsUpdate=true;this.mesh.geometry.attributes.contactShape.needsUpdate=true;}
 }
 clear(){this.count=0;this.group.visible=false;if(this.mesh)this.mesh.count=0;}
 warmupObjects(){
  const warm=new this.THREE.Group();warm.name='SoftContactShadowsWarmup';if(this.disposed)return warm;
  // Compatible with BonusVisuals.releaseInstance: shared geometry, disposable material/instance buffer.
  const mesh=this.mesh.clone();mesh.visible=true;mesh.count=1;mesh.frustumCulled=false;
  mesh.material=this.material.clone();mesh.userData.powerFXWarmupMaterial=true;
  const dummy=new this.THREE.Object3D();dummy.rotation.x=-Math.PI/2;dummy.scale.set(.6,.6,1);dummy.updateMatrix();mesh.setMatrixAt(0,dummy.matrix);mesh.instanceMatrix.needsUpdate=true;
  warm.add(mesh);return warm;
 }
 dispose(){if(this.disposed)return;this.clear();this.group.removeFromParent();this.mesh.dispose();this.mesh.geometry.dispose();this.material.dispose();this.disposed=true;}
}
