// `?perf` gate. Kept in its own module because both the overlay and
// `lib/perf-tracks.ts` (the instrumentation sink every system writes to) read
// it, and perf-tracks must not import a React component tree.
//
// Timing itself lives in perf-tracks: `gpu-render` carries three's WebGPU
// timestamp-query total for the frame's render passes, `gpu-queue` the
// submit→onSubmittedWorkDone fence, `render-encode` the synchronous CPU cost of
// building and submitting the frame. See components/viewer/post-processing.tsx.

export const PERF_OVERLAY_ENABLED =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('perf')
