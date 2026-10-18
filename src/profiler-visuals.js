// Reversible, session-only diagnostics. No collider or gameplay state mutation.
export const PROFILER_VISUAL_OPTIONS=[['areaLights','Area lights'],['hudBlur','HUD / menu blur'],['innerGlass','Cube inner glass'],['clearcoat','Cube clearcoat'],['normalMaps','Cube normal maps'],['floorCoat','Transparent floor coat'],['particles','Main-view particles / glow'],['decoration','Rail decorative blocks'],['nextDecks','Upcoming visual decks']];
export class ProfilerVisuals{
 constructor(){this.flags=Object.fromEntries(PROFILER_VISUAL_OPTIONS.map(([id])=>[id,true]));this.materials=new Map();}
 options(){return PROFILER_VISUAL_OPTIONS.map(([id,label])=>({id,label,value:this.flags[id]}));}
 set(id,value){if(Object.hasOwn(this.flags,id)){this.flags[id]=Boolean(value);if(id==='clearcoat'||id==='normalMaps')this.restoreMaterials();}}
 reset(){for(const id in this.flags)this.flags[id]=true;this.restoreMaterials();}
 restoreMaterials(){for(const m of this.materials.keys())m.needsUpdate=true;}
 trackMaterial(m){if(this.materials.has(m))return;this.materials.set(m,true);const compile=m.onBeforeCompile,key=m.customProgramCacheKey.bind(m),flags=this.flags;
 m.onBeforeCompile=function(shader,...args){compile.call(this,shader,...args);let defines='';if(!flags.clearcoat)defines+='#undef USE_CLEARCOAT\n';if(!flags.normalMaps)defines+='#undef USE_NORMALMAP\n#undef USE_NORMALMAP_TANGENTSPACE\n#undef USE_NORMALMAP_OBJECTSPACE\n';shader.vertexShader=defines+shader.vertexShader;shader.fragmentShader=defines+shader.fragmentShader;};
 m.customProgramCacheKey=()=>key()+'-profiler-'+Number(flags.clearcoat)+'-'+Number(flags.normalMaps);m.addEventListener('dispose',()=>this.materials.delete(m));
 }
 syncMaterials(materials){for(const m of materials)this.trackMaterial(m);}
 // Hidden state is scoped around rendering, including nested mirror passes.
 hidden({stage,preview,lights,inner,particles}){const out=[];if(!this.flags.areaLights)out.push(...lights);if(!this.flags.innerGlass)out.push(...inner);if(!this.flags.particles)out.push(...particles);if(!this.flags.nextDecks&&preview)out.push(preview);if(stage)for(const o of stage.children){if(!this.flags.floorCoat&&o.userData.profilerFloorCoat||!this.flags.decoration&&o.userData.profilerDecoration||!this.flags.nextDecks&&o.userData.profilerNextDeck)out.push(o);}return out;}
}
