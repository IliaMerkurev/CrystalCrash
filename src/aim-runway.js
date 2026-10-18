import * as THREE from 'three';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
// Calibrated once against the frozen gesture camera. Preserve initial sensitivity,
// then compress only the long end of the pull into the available touch runway.
export function safePullEnd(y,height){const bottom=height-Math.max(18,Math.min(36,height*.045));return Math.min(height-2,Math.max(y+1,bottom-y<32?height-8:bottom));}
export function adaptPull(x,z,reach,max=12){const length=Math.hypot(x,z);if(!length)return{x,z};const compressed=Number.isFinite(reach)&&reach>0&&reach<max,ratio=compressed?Math.min(1,length/reach):0,mapped=Math.min(max,length+(compressed?max-reach:0)*ratio*ratio),scale=mapped/length;return{x:x*scale,z:z*scale};}
// Parallel screen-up translation changes framing without changing yaw/pitch/FOV.
// Caller rebuilds the base pose every frame, so there is no accumulated drift.
export function frameAimRunway(camera,point,blend,aspect){if(!(blend>0))return;camera.updateMatrixWorld();const local=point.clone().applyMatrix4(camera.matrixWorldInverse),depth=-local.z;if(depth<=.1)return;const targetY=aspect<1?.52:.47,desired=1-2*targetY,actual=point.clone().project(camera).y;
 const shift=Math.min(0,actual-desired)*depth*Math.tan(THREE.MathUtils.degToRad(camera.fov)/2)*clamp(blend,0,1);
 camera.position.addScaledVector(new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion),shift);camera.updateMatrixWorld();}
