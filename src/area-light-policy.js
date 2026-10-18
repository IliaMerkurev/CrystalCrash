// Pure policy: callers supply newly resolved asynchronous GPU timings, never CPU
// submission timings. It creates no timers, GPU queries, or renderer state.
export const AREA_LIGHT_BUDGET = Object.freeze({samples: 30, qualifyGpuMs: 8, qualifyFrameMs: 18, disableGpuMs: 12, disableFrameMs: 22, overBudgetWindows: 2});
const validTime = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const percentile90 = values => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.9) - 1];

/** Manual shadow choices are independent; contact is a cheap non-shadow-map path. */
export function resolveShadowMode(mode = 'auto', effectiveAreaLights = false) {
  if (['contact', 'off', 'low', 'high'].includes(mode)) return mode;
  return effectiveAreaLights ? 'high' : 'contact';
}

/**
 * sampleId must uniquely identify each resolved GPU query. Polls without a new
 * result are harmless; duplicate IDs cannot qualify a device. gpuAvailable means
 * the asynchronous timer is supported and usable, not that a query is ready now.
 * Qualification measures the cheap baseline with lights off. Once enabled, two
 * over-budget windows latch Auto off for this policy's lifetime (no oscillation).
 * Manual On/Off always wins, including on mobile or after an over-budget latch.
 */
export function createAreaLightPolicy({mobile = false} = {}) {
  let enabled = false, latchedOff = false, reason = 'awaiting-gpu', modeBefore;
  let gpu = [], frames = [], badWindows = 0, gpuP90 = null, frameP90 = null;
  const seen = new Set();
  function reset() { enabled = false; gpu = []; frames = []; badWindows = 0; gpuP90 = null; frameP90 = null; }
  function snapshot() { return {enabled, reason, latchedOff, samples: gpu.length, gpuP90, frameP90}; }
  return {
    update({mode = 'auto', gpuAvailable = false, gpuMs, frameMs, sampleId, disjoint = false} = {}) {
      mode = mode === true ? 'on' : mode === false ? 'off' : mode;
      if (!['auto', 'off', 'on'].includes(mode)) mode = 'auto';
      if (mode !== modeBefore) { reset(); modeBefore = mode; }
      if (mode !== 'auto') { enabled = mode === 'on'; reason = `manual-${mode}`; return snapshot(); }
      if (mobile) { reset(); reason = 'mobile'; return snapshot(); }
      if (latchedOff) { enabled = false; reason = 'over-budget'; return snapshot(); }
      if (!gpuAvailable || disjoint) { reset(); reason = disjoint ? 'gpu-disjoint' : 'gpu-unavailable'; return snapshot(); }
      if (!enabled) reason = 'qualifying';
      if (sampleId == null || seen.has(sampleId) || !validTime(gpuMs) || !validTime(frameMs)) return snapshot();
      seen.add(sampleId);
      // Bound memory. Timer query IDs supplied by callers must be monotonic or
      // unique; retaining recent IDs also protects normal polling duplicates.
      if (seen.size > 256) seen.delete(seen.values().next().value);
      gpu.push(gpuMs); frames.push(frameMs);
      if (gpu.length < AREA_LIGHT_BUDGET.samples) return snapshot();
      gpuP90 = percentile90(gpu); frameP90 = percentile90(frames);
      gpu = []; frames = [];
      if (!enabled) {
        enabled = gpuP90 < AREA_LIGHT_BUDGET.qualifyGpuMs && frameP90 < AREA_LIGHT_BUDGET.qualifyFrameMs;
        reason = enabled ? 'qualified' : 'baseline-over-budget';
      } else {
        const over = gpuP90 > AREA_LIGHT_BUDGET.disableGpuMs || frameP90 > AREA_LIGHT_BUDGET.disableFrameMs;
        badWindows = over ? badWindows + 1 : 0;
        if (badWindows >= AREA_LIGHT_BUDGET.overBudgetWindows) { enabled = false; latchedOff = true; reason = 'over-budget'; }
        else reason = over ? 'watching-budget' : 'qualified';
      }
      return snapshot();
    },
    snapshot
  };
}
