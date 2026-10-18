import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createSourceStore,validateRepository,authorizeRequest,sourceSavePlugin} from '../scripts/editor-source-server.mjs';
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'crystal-source-save-'));
const preset=JSON.parse(await fs.readFile(new URL('../src/presets/crystal-crash.json',import.meta.url)));
let passed=0;const ok=(name,fn)=>{fn();passed++;console.log('PASS '+name);};
async function repo(name){const root=path.join(tmp,name);await fs.mkdir(path.join(root,'src/presets'),{recursive:true});await fs.mkdir(path.join(root,'.git'));await fs.writeFile(path.join(root,'package.json'),JSON.stringify({name:'crystal-crash'}));await fs.writeFile(path.join(root,'src/presets/crystal-crash.json'),JSON.stringify(preset));return root;}
try{
 const home=await repo('host'),a=await repo('a'),b=await repo('b'),store=await createSourceStore(home);

 assert.equal((await store.status()).root,null);
 await assert.rejects(()=>store.configure(tmp),/Git repository/);
 let session=await store.configure(a);assert.equal(session.root,a);assert(session.project&&session.revision);passed++;
 const next=structuredClone(preset);next.particles.intensity=1.35;
 const saved=await store.save(next,session.revision,session.project);assert.notEqual(saved.revision,session.revision);assert.equal(JSON.parse(await fs.readFile(path.join(a,'src/presets/crystal-crash.json'))).particles.intensity,1.35);passed++;
 const backups=await fs.readdir(path.join(home,'.editor-local/backups'));assert.equal(backups.length,1);assert.deepEqual(JSON.parse(await fs.readFile(path.join(home,'.editor-local/backups',backups[0]))),preset);passed++;
 await assert.rejects(()=>store.save(next,session.revision,session.project),e=>e.status===409);passed++;
 const invalid=structuredClone(next);invalid.particles.intensity=999;await assert.rejects(()=>store.save(invalid,saved.revision,saved.project));assert.equal((await store.status()).revision,saved.revision);passed++;
 await fs.writeFile(path.join(a,'src/presets/crystal-crash.json'),JSON.stringify(preset));session=await store.status();await store.configure(b);
 await assert.rejects(()=>store.save(next,session.revision,session.project),e=>e.status===409);assert.deepEqual(JSON.parse(await fs.readFile(path.join(b,'src/presets/crystal-crash.json'))),preset);passed++;
 const restored=await createSourceStore(home);assert.equal((await restored.status()).root,b);passed++;
 const base=await restored.status();const results=await Promise.allSettled([restored.save(next,base.revision,base.project),restored.save({...next,particles:{...next.particles,intensity:1.4}},base.revision,base.project)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);passed++;
 const c=await repo('symlink');await fs.unlink(path.join(c,'src/presets/crystal-crash.json'));await fs.symlink(path.join(b,'src/presets/crystal-crash.json'),path.join(c,'src/presets/crystal-crash.json'));await assert.rejects(()=>validateRepository(c),/Symbolic links/);passed++;
 const token='a'.repeat(64),request=()=>({socket:{remoteAddress:'127.0.0.1',localPort:5173},headers:{host:'127.0.0.1:5173',origin:'http://127.0.0.1:5173','sec-fetch-site':'same-origin','content-type':'application/json','x-editor-token':token}});
 authorizeRequest(request(),token,{mutation:true});passed++;
 for(const [key,value]of [['host','evil.example:5173'],['origin','http://evil.example'],['origin','null'],['sec-fetch-site','cross-site'],['content-type','text/plain'],['x-editor-token','wrong']]){const req=request();req.headers[key]=value;assert.throws(()=>authorizeRequest(req,token,{mutation:true}));passed++;}
 const req=request();req.socket.remoteAddress='10.0.0.3';assert.throws(()=>authorizeRequest(req,token));passed++;
 const noOrigin=request();delete noOrigin.headers.origin;assert.throws(()=>authorizeRequest(noOrigin,token,{mutation:true}));passed++;
 const plugin=sourceSavePlugin();assert.equal(plugin.apply,'serve');assert(!plugin.configurePreviewServer);assert.equal(plugin.config().server.host,'127.0.0.1');passed++;
 assert.deepEqual(plugin.handleHotUpdate({file:path.join(home,'src/presets/crystal-crash.json'),server:{config:{root:home}}}),[]);assert.equal(plugin.handleHotUpdate({file:path.join(home,'src/main.js'),server:{config:{root:home}}}),undefined);passed++;
 let middleware;await plugin.configureServer({config:{root:home},middlewares:{use:fn=>middleware=fn}});
 const server=http.createServer((req,res)=>middleware(req,res,()=>{res.statusCode=404;res.end();}));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const origin='http://127.0.0.1:'+server.address().port,route=origin+'/__editor/source/';
  const response=await fetch(route+'session');assert.equal(response.status,200);const info=await response.json();assert(info.token);passed++;
  const httpNext=structuredClone(next);httpNext.particles.intensity=1.55;
  const headers={'Origin':origin,'Content-Type':'application/json','X-Editor-Token':info.token};
  let r=await fetch(route+'save',{method:'POST',headers,body:JSON.stringify({document:httpNext,revision:info.revision,project:info.project})});assert.equal(r.status,200);passed++;
  r=await fetch(route+'save',{method:'POST',headers,body:JSON.stringify({document:httpNext,revision:info.revision,project:info.project})});assert.equal(r.status,409);passed++;
  r=await fetch(route+'configure',{method:'POST',headers:{...headers,Origin:'http://evil.example'},body:JSON.stringify({root:a})});assert.equal(r.status,403);passed++;
  r=await fetch(route+'save',{method:'POST',headers,body:JSON.stringify({path:'/arbitrary',document:next,revision:info.revision,project:info.project})});assert.equal(r.status,400);passed++;
  r=await fetch(route+'save',{method:'POST',headers:{...headers,'X-Editor-Token':'x'},body:'{}'});assert.equal(r.status,403);passed++;
 }finally{await new Promise(resolve=>server.close(resolve));}
 console.log(`All ${passed} focused source-save checks passed.`);
}finally{await fs.rm(tmp,{recursive:true,force:true});}
