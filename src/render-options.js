// Compile a real no-environment shader branch while retaining direct lighting,
// color, opacity, bevel and per-instance melt hooks. No scene.environment edits.
export function environmentVariant(material,enabled,tag='glass'){
 const compile=material.onBeforeCompile,key=material.customProgramCacheKey.bind(material);
 material.onBeforeCompile=function(shader,...args){compile.call(this,shader,...args);if(!enabled()){shader.vertexShader='#undef USE_ENVMAP\n#undef ENVMAP_TYPE_CUBE_UV\n#undef ENVMAP_TYPE_CUBE\n'+shader.vertexShader;shader.fragmentShader='#undef USE_ENVMAP\n#undef ENVMAP_TYPE_CUBE_UV\n#undef ENVMAP_TYPE_CUBE\n'+shader.fragmentShader;}};
 material.customProgramCacheKey=()=>key()+'-'+tag+'-environment-'+Number(enabled());
 return material;
}
export function withHidden(objects,render){const saved=[];for(const object of new Set(objects)){if(object?.visible){saved.push(object);object.visible=false;}}try{return render();}finally{for(const object of saved)object.visible=true;}}
export function reflectionProfile(size){return {blur:size<=128?1.15:size<=256?1:.8,roughness:size<=128?.55:size<=256?.44:size<=512?.38:.34};}
