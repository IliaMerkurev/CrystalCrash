import test from 'node:test';
import assert from 'node:assert/strict';
import {FractureTemplateCache} from '../src/fracture-template-cache.js';
import {damageBonds} from '../src/cluster-graph.js';
import {plateGeometry} from '../src/glass-shell.js';

const shape={sx:.88,sy:.88,sz:.88,type:0,variant:0};
const dispose=graph=>graph.cells.forEach(cell=>cell.geometry.dispose());
const snapshot=graph=>({bonds:graph.bonds.map(b=>({...b})),totalArea:graph.totalArea,cells:graph.cells.map(c=>({id:c.id,area:c.area,t:c.t,points:c.points.map(p=>p.slice()),pos:c.pos.toArray(),q:c.q.toArray(),normal:c.normal.toArray(),position:Array.from(c.geometry.attributes.position.array),colliderPoints:Array.from(c.colliderPoints)}))});

test('cache reuses deterministic templates while all origin graph data stays independent',()=>{
 const cache=new FractureTemplateCache(),a=cache.instantiate(shape),b=cache.instantiate(shape),before=snapshot(b);
 try{
  assert.deepEqual(snapshot(a),before);assert.equal(cache.stats.hits,1);assert.equal(cache.stats.misses,1);
  assert.notEqual(a,b);assert.notEqual(a.cells,b.cells);assert.notEqual(a.bonds,b.bonds);
  for(let i=0;i<a.cells.length;i++){
   const x=a.cells[i],y=b.cells[i];for(const key of ['points','pos','q','normal','geometry','colliderPoints'])assert.notEqual(x[key],y[key]);
   assert.notEqual(x.points[0],y.points[0]);assert.notEqual(x.colliderPoints.buffer,y.colliderPoints.buffer);
   for(const key of Object.keys(x.geometry.attributes))assert.notEqual(x.geometry.attributes[key].array.buffer,y.geometry.attributes[key].array.buffer);
  }
  damageBonds(a,a.cells.map(c=>c.id),a.cells[0].pos,1e6,1);assert.ok(a.bonds.some(b=>b.hp<0));
  a.cells[0].points[0][0]=999;a.cells[0].pos.x=999;a.cells[0].q.x=1;a.cells[0].normal.y=999;a.cells[0].colliderPoints[0]=999;a.cells[0].geometry.attributes.position.array[0]=999;a.cells[0].area=999;
  assert.deepEqual(snapshot(b),before);
  const c=cache.instantiate(shape);assert.deepEqual(snapshot(c),before);dispose(c);
 }finally{dispose(a);dispose(b);cache.dispose();}
});

test('seeded variants are repeatable, distinct and limited per dimensions/type',()=>{
 const cache=new FractureTemplateCache({variantsPerShape:3}),second=new FractureTemplateCache({variantsPerShape:3}),graphs=[];
 try{
  for(let variant=0;variant<3;variant++){const a=cache.instantiate({...shape,variant}),b=second.instantiate({...shape,variant});graphs.push(a,b);assert.deepEqual(snapshot(a),snapshot(b));}
  assert.notDeepEqual(snapshot(graphs[0]),snapshot(graphs[2]));assert.notDeepEqual(snapshot(graphs[2]),snapshot(graphs[4]));
  const other=cache.instantiate({...shape,type:1});graphs.push(other);assert.notDeepEqual(snapshot(graphs[0]),snapshot(other));
  for(let i=0;i<20;i++){const g=cache.instantiate({...shape,variant:undefined,random:()=>i/20});graphs.push(g);}assert.equal(cache.stats.entries,4);
 }finally{graphs.forEach(dispose);cache.dispose();second.dispose();}
});

test('LRU eviction and clear dispose templates without disposing active origin geometry',()=>{
 const cache=new FractureTemplateCache({maxEntries:2}),a=cache.instantiate(shape),b=cache.instantiate({...shape,type:1}),before=snapshot(a);let liveDisposals=0;
 for(const c of a.cells)c.geometry.addEventListener('dispose',()=>liveDisposals++);
 try{
  const hit=cache.instantiate(shape);dispose(hit); // A is most recently used.
  const c=cache.instantiate({...shape,type:2});dispose(c);assert.equal(cache.stats.entries,2);assert.equal(cache.stats.evictions,1);assert.ok(cache.stats.disposedGeometries>0);
  const misses=cache.stats.misses,again=cache.instantiate(shape);dispose(again);assert.equal(cache.stats.misses,misses);
  const evicted=cache.instantiate({...shape,type:1});dispose(evicted);assert.equal(cache.stats.misses,misses+1);
  for(let i=0;i<12;i++){const graph=cache.instantiate({...shape,sx:.9+i*.01});dispose(graph);assert.ok(cache.stats.entries<=2);}
  cache.clear();assert.equal(cache.stats.entries,0);assert.equal(liveDisposals,0);assert.deepEqual(snapshot(a),before);
  const rebuilt=cache.instantiate(shape);assert.deepEqual(snapshot(rebuilt),before);dispose(rebuilt);
 }finally{dispose(a);dispose(b);cache.dispose();}
 assert.equal(liveDisposals,a.cells.length);
});

test('disposing an origin cannot dispose the cached geometry or another origin',()=>{
 const cache=new FractureTemplateCache(),a=cache.instantiate(shape),before=snapshot(a);dispose(a);
 try{const b=cache.instantiate(shape);assert.deepEqual(snapshot(b),before);let disposed=0;b.cells[0].geometry.addEventListener('dispose',()=>disposed++);cache.dispose();assert.equal(disposed,0);dispose(b);assert.equal(disposed,1);}finally{cache.dispose();}
});

test('invalid sizes, tiers, variants, random samples and capacity are rejected',()=>{
 for(const options of [{maxEntries:0},{maxEntries:1.5},{variantsPerShape:0}])assert.throws(()=>new FractureTemplateCache(options),RangeError);
 const cache=new FractureTemplateCache();
 for(const options of [{sx:0},{t:.5},{type:6},{variant:3},{variant:-1},{variant:undefined,random:()=>1},{variant:undefined,random:()=>NaN}])assert.throws(()=>cache.instantiate({...shape,...options}),RangeError);
 assert.equal(cache.stats.entries,0);cache.dispose();
});

test('cached render geometry and precise hull buffers match the original plate construction',()=>{
 const cache=new FractureTemplateCache();
 try{for(const dimensions of [[.88,.88,.88],[2.8,.33,.88]])for(let type=0;type<5;type++){
  const [sx,sy,sz]=dimensions,graph=cache.instantiate({sx,sy,sz,type,variant:1});
  try{
   assert.ok(Math.abs(graph.totalArea-2*(sx*sy+sx*sz+sy*sz))<1e-8);
   graph.cells.forEach((cell,id)=>{
    assert.equal(cell.id,id);assert.ok(cell.area>0);
    const geometry=plateGeometry(cell.points,cell.t),hull=plateGeometry(cell.points.map(p=>p.map(n=>n*.992)),cell.t*.98);
    try{
     for(const g of [geometry,hull]){g.applyQuaternion(cell.q);g.translate(cell.pos.x,cell.pos.y,cell.pos.z);}
     for(const attribute of ['position','normal','uv'])assert.deepEqual(cell.geometry.attributes[attribute].array,geometry.attributes[attribute].array);
     assert.deepEqual(cell.colliderPoints,hull.attributes.position.array);
    }finally{geometry.dispose();hull.dispose();}
   });
   for(const bond of graph.bonds){assert.ok(graph.cells[bond.a]);assert.ok(graph.cells[bond.b]);assert.ok(bond.hp>0);assert.ok(bond.length>0);}
  }finally{dispose(graph);}
 }}finally{cache.dispose();}
});
