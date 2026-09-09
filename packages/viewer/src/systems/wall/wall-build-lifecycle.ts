import { useScene } from '@pascal-app/core'
import { PERF_OVERLAY_ENABLED } from '../../lib/gpu-perf'
import { type PerfBatchStats, publishPerfWallDrainStats } from '../../lib/perf-panel-store'
import { beginSpan, endSpan, type PerfSpanHandle } from '../../lib/perf-tracks'

export const pendingAdjacentByLevel = new Map<string, Set<string>>()
let hydrationId: object | null = null
let hydrationToken: object | null = null
let initialBuildActive = false
let initialBuildSpan: PerfSpanHandle | null = null
export const initiallyBuiltWalls = new Set<string>()
export const drainStats: NonNullable<PerfBatchStats['wallDrain']> = {
  initialBuildActive: false,
  wallsConsumedThisFrame: 0,
  budgetExits: 0,
  heavyExits: 0,
  drainedExits: 0,
  capExits: 0,
  pendingNeighbours: 0,
  firstBuilds: 0,
  reinvalidationBuilds: 0,
  neighbourEnqueues: 0,
}

export function publishWallDrainStats() {
  drainStats.initialBuildActive = initialBuildActive
  if (PERF_OVERLAY_ENABLED) publishPerfWallDrainStats(drainStats)
}

export function endInitialBuild() {
  if (!initialBuildActive) return
  initialBuildActive = false
  endSpan(initialBuildSpan)
  initialBuildSpan = null
  publishWallDrainStats()
}

export function isWallInitialBuildActive(): boolean {
  const state = useScene.getState()
  if (state.hydrationId !== hydrationId) {
    endInitialBuild()
    hydrationId = state.hydrationId
    initiallyBuiltWalls.clear()
    pendingAdjacentByLevel.clear()
    for (const key of Object.keys(drainStats) as (keyof typeof drainStats)[]) {
      if (key !== 'initialBuildActive') drainStats[key] = 0
    }
    publishWallDrainStats()
  }
  const token = state.hydrationToken
  if (token !== hydrationToken) {
    endInitialBuild()
    hydrationToken = token
    if (token) {
      initialBuildActive = true
      initialBuildSpan = beginSpan('wall-initial-build')
      publishWallDrainStats()
    }
  }
  return initialBuildActive
}

useScene.subscribe(() => isWallInitialBuildActive())

export function subscribeWallBuildInteractions(
  target: EventTarget | null,
): (() => void) | undefined {
  if (!target) return
  const interrupt = () => useScene.getState().invalidateHydration()
  const events = ['pointerdown', 'pointermove', 'wheel']
  for (const event of events)
    target.addEventListener(event, interrupt, { capture: true, passive: true })
  isWallInitialBuildActive()
  return () => {
    for (const event of events) target.removeEventListener(event, interrupt, true)
  }
}
