import {createGraph} from './cluster-graph.js';
import {fractureFaces,plateGeometry,wallThickness} from './glass-shell.js';

const hashString=s=>{let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;};
const seededRandom=seed=>()=>{let n=seed+=0x6D2B79F5;n=Math.imul(n^(n>>>15),n|1);n^=n+Math.imul(n^(n>>>7),n|61);return ((n^(n>>>14))>>>0)/4294967296;};

function buildTemplate(sx,sy,sz,t,seed){
 const graph=createGraph(fractureFaces(sx,sy,sz,t,seededRandom(seed)));
 try{
  for(const cell of graph.cells){
   const geometry=plateGeometry(cell.points,cell.t);cell.geometry=geometry;
   geometry.applyQuaternion(cell.q);geometry.translate(cell.pos.x,cell.pos.y,cell.pos.z);
   const hull=plateGeometry(cell.points.map(p=>p.map(n=>n*.992)),cell.t*.98);
   try{hull.applyQuaternion(cell.q);hull.translate(cell.pos.x,cell.pos.y,cell.pos.z);cell.colliderPoints=hull.attributes.position.array.slice();}
   finally{hull.dispose();}
  }
  return graph;
 }catch(error){for(const cell of graph.cells)cell.geometry?.dispose();throw error;}
}

function cloneGraph(template){
 const cells=[];
 try{
  for(const cell of template.cells)cells.push({...cell,points:cell.points.map(p=>p.slice()),pos:cell.pos.clone(),q:cell.q.clone(),normal:cell.normal.clone(),geometry:cell.geometry.clone(),colliderPoints:cell.colliderPoints.slice()});
  return {cells,bonds:template.bonds.map(bond=>({...bond})),totalArea:template.totalArea};
 }catch(error){for(const cell of cells)cell.geometry.dispose();throw error;}
}

/** Bounded LRU of reusable, deterministic fracture variants. Templates are
 * private and never rendered. Every origin gets independent mutable graph
 * data AND BufferGeometry, so existing per-origin disposal needs no refcount.
 * Evicting/clearing templates cannot invalidate live or later fracture cells. */
export class FractureTemplateCache{
 #templates=new Map();
 #maxEntries;#variantsPerShape;#seed;
 #hits=0;#misses=0;#evictions=0;#disposedGeometries=0;
 constructor({maxEntries=32,variantsPerShape=3,seed=0x43525953}={}){
  if(!Number.isInteger(maxEntries)||maxEntries<1||!Number.isInteger(variantsPerShape)||variantsPerShape<1||!Number.isInteger(seed))throw new RangeError('Cache capacity and variant count must be positive integers; seed must be an integer.');
  this.#maxEntries=maxEntries;this.#variantsPerShape=variantsPerShape;this.#seed=seed>>>0;
 }
 get stats(){return {entries:this.#templates.size,maxEntries:this.#maxEntries,variantsPerShape:this.#variantsPerShape,hits:this.#hits,misses:this.#misses,evictions:this.#evictions,disposedGeometries:this.#disposedGeometries};}
 instantiate({sx,sy,sz,type,t=wallThickness(type),random=Math.random,variant}={}){
  if(!Number.isInteger(type)||type<0||type>4||![sx,sy,sz,t].every(n=>Number.isFinite(n)&&n>0)||2*t>=Math.min(sx,sy,sz))throw new RangeError('Fracture dimensions and thickness must leave an interior, and type must be a glass tier (0–4).');
  if(variant===undefined){const r=random();if(!Number.isFinite(r)||r<0||r>=1)throw new RangeError('Random sample must be in [0, 1).');variant=Math.floor(r*this.#variantsPerShape);}
  if(!Number.isInteger(variant)||variant<0||variant>=this.#variantsPerShape)throw new RangeError('Fracture variant is outside the configured range.');
  const key=[sx,sy,sz,type,t,variant].join('|');
  let template=this.#templates.get(key);
  if(template){this.#hits++;this.#templates.delete(key);this.#templates.set(key,template);}
  else{
   this.#misses++;
   template=buildTemplate(sx,sy,sz,t,hashString(key)^this.#seed);
   // Evict before insertion so retained templates never exceed the bound.
   if(this.#templates.size===this.#maxEntries){const oldest=this.#templates.keys().next().value;this.#dispose(this.#templates.get(oldest));this.#templates.delete(oldest);this.#evictions++;}
   this.#templates.set(key,template);
  }
  return cloneGraph(template);
 }
 #dispose(graph){for(const cell of graph.cells){cell.geometry.dispose();this.#disposedGeometries++;}}
 clear(){for(const graph of this.#templates.values())this.#dispose(graph);this.#templates.clear();}
 dispose(){this.clear();}
}
