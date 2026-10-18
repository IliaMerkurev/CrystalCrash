// Device-independent pixel budgets. UI remains native-resolution DOM.
export const QUALITY_TIERS=[
 {name:'Low',pixels:900000,reflection:256,transmission:.5},
 {name:'Medium',pixels:1400000,reflection:512,transmission:.5},
 {name:'High',pixels:2073600,reflection:1024,transmission:1}
];
export function pixelRatio(width,height,dpr,tier){return Math.min(dpr,1.7,Math.sqrt(QUALITY_TIERS[tier].pixels/Math.max(1,width*height)));}
export function calibrationTier(samples){const sorted=samples.filter(Number.isFinite).sort((a,b)=>a-b);if(!sorted.length)return 1;const p=sorted[Math.floor((sorted.length-1)*.8)];return p>16?0:p>9?1:2;}
export class RenderQuality{
 constructor({mobile=false}={}){this.mobile=mobile;this.tier=mobile?0:2;this.auto=true;this.samples=[];this.window=0;this.cooldown=2;this.frameMs=0;}
 calibrate(samples){this.tier=this.mobile?Math.min(0,calibrationTier(samples)):calibrationTier(samples);return this.tier;}
 select(value){this.auto=value==='auto';if(!this.auto)this.tier=Math.max(0,Math.min(2,Number(value)||0));this.samples=[];this.window=0;this.cooldown=2;}
 observe(ms,active){if(!Number.isFinite(ms)||ms<=0||ms>2000){this.samples=[];this.window=0;return false;}this.frameMs=this.frameMs?this.frameMs*.95+ms*.05:ms;if(!active||ms>150){this.samples=[];this.window=0;return false;}this.cooldown=Math.max(0,this.cooldown-ms/1000);if(!this.auto||!this.tier||this.cooldown)return false;this.samples.push(ms);this.window+=ms/1000;if(this.window<1.5)return false;const s=this.samples.sort((a,b)=>a-b),median=s[Math.floor(s.length*.5)],p90=s[Math.floor(s.length*.9)];this.samples=[];this.window=0;if(median>18.5&&p90>22){this.tier--;this.cooldown=5;return true;}return false;}
}
