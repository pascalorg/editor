'use client'

export function recordNavigationPerfSample(
  _name: string,
  _ms: number,
  _meta?: Record<string, unknown>,
) {}

export function measureNavigationPerf<T>(_name: string, run: () => T): T {
  return run()
}

export function recordNavigationPerfMark(_name: string, _meta?: Record<string, unknown>) {}

export function mergeNavigationPerfMeta(_meta: Record<string, unknown>) {}

export function resetNavigationPerf() {}
