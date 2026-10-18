import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import * as THREE from 'three';import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';import {Reflector} from 'three/addons/objects/Reflector.js';import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';import {createStageBoxGeometry} from '../src/stage-geometry.js'; const source=fs.readFileSync(process.argv[2]||new URL('../src/main.js',import.meta.url),'utf8');
function code(name){
 const start=source.indexOf('function '+name+'(');assert(start>=0,name);
 let depth=0,quote=null,comment=null,escaped=false;
 for(let i=source.indexOf('{',start);i<source.length;i++){
  const c=source[i],n=source[i+1];
  if(comment==='line'){if(c==='\n')comment=null;continue;}
  if(comment==='block'){if(c==='*'&&n==='/'){comment=null;i++;}continue;}
  if(quote){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c===quote)quote=null;continue;}
  if(c==='/'&&n==='/'){comment='line';i++;continue;}
  if(c==='/'&&n==='*'){comment='block';i++;continue;}
  if(c==='"'||c==="'"||c==='`'){quote=c;continue;}
  if(c==='{')depth++;else if(c==='}'&&!--depth)return source.slice(start,i+1);
 }
 assert.fail('Unterminated production function '+name);
}


const v3=(...a)=>new THREE.Vector3(...a),camera=new THREE.PerspectiveCamera(42,829/1085,.1,100),target=v3(0,.6,-.1),direction=v3(0,.66,.75).normalize(),right=v3(1,0,0),up=v3().crossVectors(direction,right).normalize(),t=Math.tan(THREE.MathUtils.degToRad(42)/2);let distance=0;for(const x of [-6.15,6.15])for(const z of [-6.8,6.8])for(const y of [0,z<0?5.5:0]){const q=v3(x,y,z).sub(target),depth=q.dot(direction);distance=Math.max(distance,depth+Math.abs(q.dot(right))/(t*camera.aspect)*1.01,depth+Math.abs(q.dot(up))/t*1.2);}camera.position.copy(direction).multiplyScalar(distance).add(target);camera.lookAt(target);camera.updateMatrixWorld();
const c={THREE,v3,camera,scene:new THREE.Scene(),GATE_HEIGHT:1.5,C:{ballRadius:.38},clamp:THREE.MathUtils.clamp,RoundedBoxGeometry,createStageBoxGeometry,Reflector,mergeGeometries,railLights:[],reflectionTexel:{value:new THREE.Vector2()},railProgress:{value:0},railTop:{value:0},railBottom:{value:0},REFLECTION_RES:128,performanceSettings:{floorReflection:'off'},reflectionProfile:()=>({blur:1,roughness:.5})};for(const k of ['TOP','MID','BOTTOM','NEAR_HALF','STRIDE','stageGroup','stageMaterials','floorMesh'])c[k]=null;vm.createContext(c);for(const name of ['configureArena','tableHalf','arenaShape','box',...(source.includes('function batchStageDecorations(')?['batchStageDecorations']:[]),'buildArenaVisual'])vm.runInContext(code(name),c);c.configureArena();c.buildArenaVisual(new THREE.MeshStandardMaterial(),new THREE.MeshStandardMaterial(),new THREE.MeshStandardMaterial(),new THREE.Texture());c.scene.updateMatrixWorld(true);const frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse)),out={};c.stageGroup.traverse(o=>{if(!o.isMesh||!o.visible||!frustum.intersectsObject(o))return;const cat=(o.userData.profilerNextDeck?'next ':'current ')+(o.userData.profilerDecoration?'decor':(o.geometry.type==='RoundedBoxGeometry'||['chamfer','emissive'].includes(o.userData.stagePart))?'rails':o.userData.profilerFloorCoat?'coat':'deck/glow');const n=(o.geometry.index?.count??o.geometry.attributes.position.count)/3*(o.isInstancedMesh?o.count:1);out[cat]??={meshes:0,triangles:0};out[cat].meshes++;out[cat].triangles+=n;});console.log(JSON.stringify({bounds:[c.TOP,c.MID,c.BOTTOM],categories:out}));

let totalTriangles=0,totalMeshes=0; c.stageGroup.traverse(o=>{if(o.isMesh){totalMeshes++;totalTriangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3*(o.isInstancedMesh?o.count:1);}}); console.log(JSON.stringify({fullStage:{meshes:totalMeshes,triangles:totalTriangles},visible:{meshes:Object.values(out).reduce((a,x)=>a+x.meshes,0),triangles:Object.values(out).reduce((a,x)=>a+x.triangles,0)}}));
if(!process.argv[2]){
 assert.equal(totalTriangles,10330); assert.equal(totalMeshes,106);
 assert.equal(Object.values(out).reduce((a,x)=>a+x.triangles,0),4794);
 assert.equal(Object.values(out).reduce((a,x)=>a+x.meshes,0),58);
 const batches=c.stageGroup.children.filter(o=>o.userData.profilerDecoration);
 assert.equal(batches.length,60); assert(batches.every(o=>o.isInstancedMesh&&o.count<=4&&o.geometry.attributes.position.count>0&&o.castShadow&&o.receiveShadow)); assert.equal(new Set(batches.map(o=>o.geometry)).size,2);
 assert.equal(batches.filter(o=>o.userData.profilerNextDeck).length,40);
 for(const o of batches){o.geometry.computeBoundingBox();assert(!o.geometry.boundingBox.isEmpty());assert(o.geometry.index.count/3<=176);}
 // Visibility remains valid with low aim/dolly and either aspect: closed side/end
 // faces remain in all structural pieces; only inset cap bottom faces are absent.
 for(const aspect of [390/844,1280/720])for(const eye of [[0,8,12],[0,4,4],[0,12,-15]]){
  camera.aspect=aspect;camera.position.set(...eye);camera.lookAt(0,0,-8);camera.updateProjectionMatrix();camera.updateMatrixWorld();
  const f=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
  assert(c.stageGroup.children.some(o=>o.isMesh&&f.intersectsObject(o)));
 }
 console.log('PASS production stage budgets, bounded material batches, preview flags and alternate view frusta');
}

const unique=new Set();c.stageGroup.traverse(o=>{if(o.geometry)unique.add(o.geometry);}); console.log(JSON.stringify({uniqueGeometry:unique.size,geometryBytes:[...unique].reduce((a,g)=>a+Object.values(g.attributes).reduce((b,x)=>b+x.array.byteLength,0)+(g.index?.array.byteLength||0),0),instanceBytes:c.stageGroup.children.reduce((a,o)=>a+(o.instanceMatrix?.array.byteLength||0),0)}));
