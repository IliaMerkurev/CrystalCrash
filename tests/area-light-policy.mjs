import test from 'node:test';
import assert from 'node:assert/strict';
import {createAreaLightPolicy, resolveShadowMode} from '../src/area-light-policy.js';
function feed(policy, count, sample = {}, start = 0) {
  let result;
  for (let i = 0; i < count; i++) result = policy.update({gpuAvailable: true, gpuMs: 5, frameMs: 16, sampleId: start + i, ...sample});
  return result;
}
test('Auto starts off and requires 30 unique asynchronous GPU samples', () => {
  const p = createAreaLightPolicy();
  assert.equal(p.snapshot().enabled, false);
  assert.equal(p.update().reason, 'gpu-unavailable');
  assert.equal(feed(p, 29).enabled, false);
  assert.equal(p.update({gpuAvailable:true, gpuMs:5, frameMs:16, sampleId:28}).enabled, false);
  assert.equal(feed(p, 1, {}, 29).enabled, true);
  assert.equal(p.update({gpuAvailable:true}).enabled, true);
});
test('CPU-only, invalid, and disjoint samples never qualify Auto', () => {
  for (const sample of [{gpuAvailable:false}, {gpuMs:undefined}, {gpuMs:NaN}, {gpuMs:Infinity}, {gpuMs:0}, {frameMs:-1}, {disjoint:true}, {sampleId:null}]) {
    assert.equal(feed(createAreaLightPolicy(), 90, sample).enabled, false);
  }
  const p = createAreaLightPolicy(); feed(p,30);
  assert.equal(p.update({gpuAvailable:false}).enabled,false);
  assert.equal(feed(p,29,{},30).enabled,false);
  assert.equal(feed(p,1,{},59).enabled,true);
  assert.equal(p.update({gpuAvailable:true,disjoint:true}).enabled,false);
});
test('mobile Auto stays off, while persistent manual override always wins', () => {
  const p = createAreaLightPolicy({mobile:true});
  assert.equal(feed(p,100).reason,'mobile');
  assert.equal(p.update({mode:'on'}).enabled,true);
  assert.equal(p.update({mode:'off',gpuAvailable:true}).enabled,false);
  assert.equal(p.update({mode:'auto'}).enabled,false);
});
test('strict qualification limits protect slower baseline and frame bottlenecks', () => {
  assert.equal(feed(createAreaLightPolicy(),30,{gpuMs:8}).enabled,false);
  assert.equal(feed(createAreaLightPolicy(),30,{frameMs:18}).enabled,false);
  assert.equal(feed(createAreaLightPolicy(),30,{gpuMs:7.9,frameMs:17.9}).enabled,true);
});
test('two sustained enabled over-budget windows latch Auto off without oscillation', () => {
  const p = createAreaLightPolicy(); feed(p,30);
  assert.equal(feed(p,30,{gpuMs:13},30).enabled,true);
  assert.equal(feed(p,30,{gpuMs:13},60).latchedOff,true);
  assert.equal(feed(p,120,{},90).enabled,false);
  assert.equal(p.update({mode:'on'}).enabled,true);
  assert.equal(p.update({mode:'auto',gpuAvailable:true}).enabled,false);
  const frameLimited = createAreaLightPolicy(); feed(frameLimited,30);
  assert.equal(feed(frameLimited,60,{frameMs:23},30).enabled,false);
});
test('hysteresis ignores isolated slow windows and resets on a healthy window', () => {
  const p=createAreaLightPolicy(); feed(p,30);
  feed(p,30,{gpuMs:13},30); feed(p,30,{gpuMs:10},60);
  assert.equal(feed(p,30,{gpuMs:13},90).enabled,true);
  assert.equal(p.snapshot().latchedOff,false);
});
test('switching manual mode back to Auto requalifies and manual shadows remain independent', () => {
  const p=createAreaLightPolicy(); feed(p,30);
  p.update({mode:'on'});
  assert.equal(p.update({mode:'auto',gpuAvailable:true}).enabled,false);
  for (const choice of ['off','contact','low','high']) for (const enabled of [false,true]) assert.equal(resolveShadowMode(choice,enabled),choice);
  assert.equal(resolveShadowMode('auto',false),'contact');
  assert.equal(resolveShadowMode('auto',true),'high');
});
