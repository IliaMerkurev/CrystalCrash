import {shellPanels} from './glass-shell.js';

/** Preserve the existing shell's six equal panel masses, rather than using the
 * inertia of a uniformly dense solid cuboid. The paired, axis-aligned panels
 * have their combined COM at the origin and no products of inertia. */
export function intactShellMassProperties(sx,sy,sz,t,mass){
 if(![sx,sy,sz,t,mass].every(n=>Number.isFinite(n)&&n>0)||2*t>=Math.min(sx,sy,sz))throw new RangeError('Shell dimensions, thickness and mass must be positive and leave an interior.');
 const panelMass=mass/6,inertia={x:0,y:0,z:0};
 for(const {size:[w,h,d],p:[x,y,z]} of shellPanels(sx,sy,sz,t)){
  inertia.x+=panelMass*((h*h+d*d)/12+y*y+z*z);
  inertia.y+=panelMass*((w*w+d*d)/12+x*x+z*z);
  inertia.z+=panelMass*((w*w+h*h)/12+x*x+y*y);
 }
 return {mass,centerOfMass:{x:0,y:0,z:0},principalAngularInertia:inertia,angularInertiaLocalFrame:{x:0,y:0,z:0,w:1}};
}

/** Only use this for an intact, closed shell. Fractured clusters must retain
 * their precise cell colliders, including missing panels and visible gaps.
 * Callers chain the same contact groups/material/events onto this descriptor. */
export function intactShellColliderDesc(RAPIER,sx,sy,sz,t,mass){
 const p=intactShellMassProperties(sx,sy,sz,t,mass);
 return RAPIER.ColliderDesc.cuboid(sx/2,sy/2,sz/2).setMassProperties(p.mass,p.centerOfMass,p.principalAngularInertia,p.angularInertiaLocalFrame);
}
