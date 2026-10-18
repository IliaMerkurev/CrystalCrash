import {validatePreset} from './authoring-schema.js';
import {arenaBlocks} from './arena-data.js';
const known=new Map();
export function validateProjectPreset(value){
 const doc=validatePreset(value);
 for(const [level,arena]of Object.entries(doc.arenas)){
  if(!known.has(level))known.set(level,new Set(arenaBlocks(Number(level)).map(spec=>spec[8]?.id)));
  for(const id of Object.keys(arena.objects))if(!known.get(level).has(id))throw new TypeError('Unknown authored object in arena '+level+': '+id);
 }
 return doc;
}
