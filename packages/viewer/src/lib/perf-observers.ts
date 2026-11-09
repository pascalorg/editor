import { PERF_OVERLAY_ENABLED } from './gpu-perf'
import { recordPerfSample } from './perf-tracks'

let initialized = false

export function initPerfObservers(): void {
  if (!PERF_OVERLAY_ENABLED || initialized) return
  initialized = true

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        recordPerfSample('long-task', entry.duration)
      }
    })
    observer.observe({ type: 'longtask', buffered: true })
  } catch {}
}
