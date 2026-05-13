// GPU work-time measurement, gated by `?perf` in the URL.
//
// We can't use WebGPU timestamp queries here because the editor renders via
// a custom `RenderPipeline.render()` path that bypasses three.js's built-in
// timestamp infrastructure. Instead we use `device.queue.onSubmittedWorkDone()`,
// which resolves when the GPU finishes all submitted work — measuring the
// CPU→GPU-done delta gives a clean approximation of per-frame GPU duration
// regardless of which render path produced it.

export const PERF_OVERLAY_ENABLED =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('perf')

const MAX_SAMPLES = 256
const samples: number[] = []

export function pushGpuSample(ms: number): void {
  samples.push(ms)
  if (samples.length > MAX_SAMPLES) samples.shift()
}

export function drainGpuSamples(): number[] {
  if (samples.length === 0) return []
  const out = samples.slice()
  samples.length = 0
  return out
}
