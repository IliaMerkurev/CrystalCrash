import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),target=path.join(root,'src/presets/crystal-crash.json');
const original=await fs.readFile(target),dir=await fs.mkdtemp(path.join(os.tmpdir(),'crystal-preset-'));
try{
 const value=JSON.parse(original);value.particles.intensity=1.23;
 const source=path.join(dir,'exported.json');await fs.writeFile(source,JSON.stringify(value));
 execFileSync(process.execPath,['scripts/import-preset.mjs',source,'--dry-run'],{cwd:root});
 assert.deepEqual(await fs.readFile(target),original);
 execFileSync(process.execPath,['scripts/import-preset.mjs',source],{cwd:root});
 assert.equal(JSON.parse(await fs.readFile(target)).particles.intensity,1.23);
 const result=execFileSync(process.execPath,['--input-type=module','-e',"import {readVisualPreset} from './src/authoring-runtime.js';console.log(readVisualPreset().particles.intensity)"],{cwd:root,encoding:'utf8'});
 assert.equal(result.trim(),'1.23');
 console.log('PASS dry-run preserves source; atomic import persists and fresh production runtime consumes changed preset');
}finally{await fs.writeFile(target,original);await fs.rm(dir,{recursive:true,force:true});}
