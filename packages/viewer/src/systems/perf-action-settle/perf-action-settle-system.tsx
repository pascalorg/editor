import { useScene } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { PERF_OVERLAY_ENABLED } from '../../lib/gpu-perf'
import { notifyPerfActionFrame } from '../../lib/perf-actions'
import { getPendingWallRebuildCount } from '../wall/wall-system'

// Later than every other viewer system (the highest in the tree is 10) and
// later than the render call in post-processing (priority 1), so the counts
// reported are what the frame actually left behind.
const SETTLE_PRIORITY = 100

const PerfActionSettleFrame = () => {
  useFrame(() => {
    notifyPerfActionFrame(useScene.getState().dirtyNodes.size, getPendingWallRebuildCount())
  }, SETTLE_PRIORITY)
  return null
}

/**
 * Feeds the action-cost ledger (lib/perf-actions.ts) the per-frame settle
 * state: how much of the scene is still dirty and how many wall neighbour
 * rebuilds the wall system still owes. Without `?perf` the inner component
 * never mounts, so no useFrame subscriber is registered at all.
 */
export const PerfActionSettleSystem = () => {
  if (!PERF_OVERLAY_ENABLED) return null
  return <PerfActionSettleFrame />
}
