import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {validateProjectPreset} from '../src/authoring-project.js';
import {MAX_PRESET_BYTES} from '../src/authoring-schema.js';
const ROUTE='/__editor/source/',FIXED='src/presets/crystal-crash.json';
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const fail=(status,message)=>Object.assign(new Error(message),{status});
async function noLinks(root,relative){
 let current=root;
 for(const part of relative.split('/')){current=path.join(current,part);const s=await fs.lstat(current);if(s.isSymbolicLink())throw fail(400,'Symbolic links are not allowed in the source-save path.');}
 return current;
}
async function localDirectory(root,name){
 const target=path.join(root,name);await fs.mkdir(target,{recursive:true});
 if((await fs.lstat(target)).isSymbolicLink())throw fail(400,'Local editor directory must not be a symbolic link.');return target;
}
export async function validateRepository(input){
 if(typeof input!=='string'||!path.isAbsolute(input)||input.length>4096)throw fail(400,'Choose an absolute repository folder.');
 const root=await fs.realpath(input);
 const git=await fs.stat(path.join(root,'.git')).catch(()=>null);if(!git||(!git.isDirectory()&&!git.isFile()))throw fail(400,'The folder must be a Git repository or worktree.');
 const pkg=JSON.parse(await fs.readFile(await noLinks(root,'package.json'),'utf8'));
 if(pkg.name!=='crystal-crash')throw fail(400,'This editor saves only to a CrystalCrash project.');
 const target=await noLinks(root,FIXED),stat=await fs.stat(target);
 if(!stat.isFile()||stat.size>MAX_PRESET_BYTES)throw fail(400,'Invalid source preset file.');
 const bytes=await fs.readFile(target);const document=validateProjectPreset(JSON.parse(bytes.toString('utf8')));
 return {root,target,bytes,document,revision:digest(bytes)};
}
export async function createSourceStore(projectRoot){
 const home=await fs.realpath(projectRoot),local=await localDirectory(home,'.editor-local'),settings=path.join(local,'settings.json');
 let configured=null,queue=Promise.resolve();
 try{if((await fs.lstat(settings)).isSymbolicLink())throw Error('Settings symlink rejected');const s=JSON.parse(await fs.readFile(settings,'utf8'));configured=(await validateRepository(s.root)).root;}catch(error){if(error.code!=='ENOENT')console.warn('Editor source folder needs configuration:',error.message);}
 const locked=fn=>{const next=queue.then(fn,fn);queue=next.catch(()=>{});return next;};
 async function status(){if(!configured)return {enabled:true,root:null,project:null,revision:null,document:null};const s=await validateRepository(configured);return {enabled:true,root:s.root,project:digest(s.root),revision:s.revision,document:s.document};}
 return {
  status:()=>locked(status),
  configure:root=>locked(async()=>{const s=await validateRepository(root);const temp=path.join(local,`settings-${crypto.randomUUID()}.tmp`);try{await fs.writeFile(temp,JSON.stringify({root:s.root},null,2)+'\n',{flag:'wx',mode:0o600});await fs.rename(temp,settings);}finally{await fs.rm(temp,{force:true});}configured=s.root;return status();}),
  save:(document,revision,project)=>locked(async()=>{
   if(!configured)throw fail(400,'Choose the project folder in Settings first.');
   if(project!==digest(configured))throw fail(409,'The configured project changed. Open Settings and reload the intended source before saving.');
   if(typeof revision!=='string'||!/^[a-f0-9]{64}$/.test(revision))throw fail(400,'A valid source revision is required. Reload the source first.');
   const valid=validateProjectPreset(document),bytes=Buffer.from(JSON.stringify(valid,null,2)+'\n');
   if(bytes.length>MAX_PRESET_BYTES)throw fail(413,'Formatted preset exceeds the source size limit.');
   const before=await validateRepository(configured);if(before.revision!==revision)throw fail(409,'Source changed outside the editor. Reload the source or export your edits before resolving the conflict.');
   const backups=await localDirectory(local,'backups');
   const backup=path.join(backups,`${Date.now()}-${crypto.randomUUID()}.json`);await fs.writeFile(backup,before.bytes,{flag:'wx',mode:0o600});
   const temp=path.join(path.dirname(before.target),`.editor-${crypto.randomUUID()}.tmp`);
   try{
    await fs.writeFile(temp,bytes,{flag:'wx',mode:(await fs.stat(before.target)).mode&0o777});
    const again=await validateRepository(configured);if(again.target!==before.target||again.revision!==revision)throw fail(409,'Source changed while saving. No replacement was made.');
    await fs.rename(temp,before.target);
   }finally{await fs.rm(temp,{force:true});}
   return {root:before.root,project:digest(before.root),revision:digest(bytes),backup:path.basename(backup)};
  })
 };
}
export function authorizeRequest(req,token,{mutation=false}={}){
 const remote=req.socket.remoteAddress;
 if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote))throw fail(403,'Local requests only.');
 const allowed=new Set([`127.0.0.1:${req.socket.localPort}`,`localhost:${req.socket.localPort}`,`[::1]:${req.socket.localPort}`]);
 if(!allowed.has(req.headers.host))throw fail(403,'Invalid local Host.');
 const expected='http://'+req.headers.host,origin=req.headers.origin;
 if(origin&&origin!==expected)throw fail(403,'Cross-origin requests are blocked.');
 if(req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin')throw fail(403,'Cross-site requests are blocked.');
 if(mutation){
  if(origin!==expected)throw fail(403,'A same-origin request is required.');
  if(req.headers['content-type']?.split(';')[0].trim()!=='application/json')throw fail(415,'JSON requests only.');
  const provided=req.headers['x-editor-token'];if(typeof provided!=='string'||Buffer.byteLength(provided)!==Buffer.byteLength(token)||!crypto.timingSafeEqual(Buffer.from(provided),Buffer.from(token)))throw fail(403,'Invalid local session token. Reload the editor.');
 }
}
async function readBody(req){let size=0,parts=[];for await(const chunk of req){size+=chunk.length;if(size>MAX_PRESET_BYTES+10000)throw fail(413,'Request exceeds the preset size limit.');parts.push(chunk);}try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw fail(400,'Invalid JSON body.');}}
export function sourceSavePlugin(){
 return {name:'crystal-local-source-save',apply:'serve',
  handleHotUpdate(ctx){if(path.resolve(ctx.file)===path.join(ctx.server.config.root,FIXED))return [];},
  config(){return {server:{host:'127.0.0.1',strictPort:true,cors:false,allowedHosts:['localhost','127.0.0.1'],fs:{deny:['.env','.env.*','*.{crt,pem,key,p12,pfx,cer,der}','.npmrc','.yarnrc.yml','**/.git/**','**/.editor-local/**','**/.editor-*.tmp']}}};},
  async configureServer(server){
   const store=await createSourceStore(server.config.root),token=crypto.randomBytes(32).toString('hex');
   server.middlewares.use(async(req,res,next)=>{
    if(!req.url?.startsWith(ROUTE))return next();
    res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    try{
     const route=req.url.slice(ROUTE.length);authorizeRequest(req,token,{mutation:req.method!=='GET'});
     let result;
     if(req.method==='GET'&&route==='session')result={...(await store.status()),token};
     else if(req.method==='POST'&&route==='configure'){const b=await readBody(req);if(Object.keys(b).some(k=>k!=='root'))throw fail(400,'Unknown configuration field.');result=await store.configure(b.root);}
     else if(req.method==='POST'&&route==='save'){const b=await readBody(req);if(Object.keys(b).some(k=>!['document','revision','project'].includes(k)))throw fail(400,'Unknown save field.');result=await store.save(b.document,b.revision,b.project);}
     else throw fail(404,'Unknown source-save operation.');
     res.statusCode=200;res.end(JSON.stringify(result));
    }catch(error){res.statusCode=error.status||400;res.end(JSON.stringify({error:error.message||'Source save failed.'}));}
   });
  }
 };
}
