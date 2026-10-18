import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {MAX_PRESET_BYTES} from '../src/authoring-schema.js';
import {validateProjectPreset as validatePreset} from '../src/authoring-project.js';
const source=process.argv[2];
if(!source){console.error('Usage: npm run preset:import -- path/to/exported-preset.json [--dry-run]');process.exit(1);}
try{
 const stat=await fs.stat(source);if(stat.size>MAX_PRESET_BYTES)throw Error('Preset exceeds 250 KB');
 const value=validatePreset(JSON.parse(await fs.readFile(source,'utf8')));
 const target=fileURLToPath(new URL('../src/presets/crystal-crash.json',import.meta.url));
 if(process.argv.includes('--dry-run'))console.log('Valid CrystalCrash preset. No files changed.');
 else{
  const temporary=path.join(path.dirname(target),'.crystal-crash-'+process.pid+'.tmp');
  try{await fs.writeFile(temporary,JSON.stringify(value,null,2)+'\n',{flag:'wx'});await fs.rename(temporary,target);}
  finally{await fs.rm(temporary,{force:true});}
  console.log('Saved src/presets/crystal-crash.json. Review the Git diff and rebuild the playable.');
 }
}catch(error){console.error(error.message);process.exitCode=1;}
