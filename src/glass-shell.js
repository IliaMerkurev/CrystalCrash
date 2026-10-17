import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
export const wallThickness=type=>[.025,.04,.055,.07,.09][type];
export function shellPanels(sx,sy,sz,t){return [
 {size:[sx,t,sz],p:[0,(sy-t)/2,0]}, {size:[sx,t,sz],p:[0,-(sy-t)/2,0]},
 {size:[t,sy-2*t,sz],p:[(sx-t)/2,0,0]}, {size:[t,sy-2*t,sz],p:[-(sx-t)/2,0,0]},
 {size:[sx-2*t,sy-2*t,t],p:[0,0,(sz-t)/2]}, {size:[sx-2*t,sy-2*t,t],p:[0,0,-(sz-t)/2]}
 ];}
export function shellGeometry(sx,sy,sz,t){const parts=shellPanels(sx,sy,sz,t).map(a=>new THREE.BoxGeometry(...a.size).translate(...a.p));const g=mergeGeometries(parts);parts.forEach(g=>g.dispose());return g;}
export function plateGeometry(points,t){const v=[];const tri=(a,b,c)=>v.push(...a,...b,...c);const back=points.map(p=>[p[0],p[1],-t/2]),front=points.map(p=>[p[0],p[1],t/2]);tri(front[0],front[1],front[2]);tri(back[2],back[1],back[0]);for(let i=0;i<3;i++){let j=(i+1)%3;tri(front[i],back[i],back[j]);tri(front[i],back[j],front[j]);}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.computeVertexNormals();return g;}
export function fractureFaces(sx,sy,sz,t,random){const result=[];for(let axis=0;axis<3;axis++)for(const sign of [-1,1]){const dims=[sx,sy,sz],u=(axis+1)%3,v=(axis+2)%3,w=dims[u],h=dims[v],center=[(random()-.5)*w*.28,(random()-.5)*h*.28],corners=[[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]],normal=new THREE.Vector3().setComponent(axis,sign),basisU=new THREE.Vector3().setComponent(u,1),basisV=new THREE.Vector3().setComponent(v,sign),q=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(basisU,basisV,normal));for(let i=0;i<4;i++){const a=center,b=corners[i],c=corners[(i+1)%4],mid=(p,q)=>[(p[0]+q[0])/2,(p[1]+q[1])/2],ab=mid(a,b),bc=mid(b,c),ca=mid(c,a);for(const points of [[a,ab,ca],[ab,b,bc],[ca,bc,c],[ab,bc,ca]]){const cx=points.reduce((s,p)=>s+p[0],0)/3,cy=points.reduce((s,p)=>s+p[1],0)/3;const pos=new THREE.Vector3(cx,cy,0).applyQuaternion(q).addScaledVector(normal,dims[axis]/2-t/2);result.push({points:points.map(p=>[p[0]-cx,p[1]-cy]),pos,q,normal,t});}}}return result;}
