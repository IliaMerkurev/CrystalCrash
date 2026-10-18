import assert from 'node:assert/strict';
import {RenderQuality,pixelRatio,calibrationTier,QUALITY_TIERS} from '../src/render-quality.js';
import fs from 'node:fs';
for(const [w,h,d]of [[1024,1366,2],[1366,1024,2],[390,844,3],[1920,1080,1]])for(let t=0;t<3;t++){const r=pixelRatio(w,h,d,t);assert.ok(w*h*r*r<=QUALITY_TIERS[t].pixels+1);assert.ok(r<=d&&r<=1.7);}
assert.equal(calibrationTier([4,5,6,7,8]),2);assert.equal(calibrationTier([10,11,12,13,14]),1);assert.equal(calibrationTier([30,31,32,33,34]),0);
const mobile=new RenderQuality({mobile:true});assert.equal(mobile.calibrate([1,2,3]),0);const q=new RenderQuality();for(let i=0;i<120;i++)q.observe(33,true);assert.equal(q.tier,1);for(let i=0;i<100;i++)q.observe(33,true);assert.equal(q.tier,1);q.select('2');for(let i=0;i<1000;i++)q.observe(40,true);assert.equal(q.tier,2);q.select('auto');for(let i=0;i<1000;i++)q.observe(40,false);assert.equal(q.tier,2);
const source=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8');assert.match(source,/toneMapping===THREE.NoToneMapping\)return/);assert.match(source,/reflectionTexel/);assert.match(source,/if\(!b.isSleeping\(\)\)previousVel/);assert.match(source,/if\(!o.b.isSleeping\(\)\|\|!o.sleepSynced\)/);assert.match(source,/getContext\(\).finish\(\);if\(i\)samples/);
console.log('Quality budgets, calibration, hysteresis, manual override and render/sleep integration passed');
