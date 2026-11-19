// Ephemeral store for the wall / fence tools' click-chaining start points.
// The 3D tools (`@pascal-app/nodes` wall/tool.tsx, fence/tool.tsx) own node
// creation for both views; after each chained commit they publish the
// created segment's resolved end here so the 2D floor-plan draft chains its
// next segment from the same point instead of re-deriving it through a
// different snap pipeline. Cleared on cancel, single-segment commit, and
// unmount — never persisted, never in undo history.

import { create } from 'zustand'
import type { WallPlanPoint } from '../components/tools/wall/wall-snap-geometry'

type SegmentKind = 'wall' | 'fence'
export type SegmentDraftChainOutcome = 'idle' | 'active' | 'refused'

type SegmentDraftChainState = {
  wall: WallPlanPoint | null
  fence: WallPlanPoint | null
  wallOutcome: SegmentDraftChainOutcome
  fenceOutcome: SegmentDraftChainOutcome
  setChainStart(kind: SegmentKind, point: WallPlanPoint | null): void
  markRefused(kind: SegmentKind): void
  clear(kind: SegmentKind): void
}

const useSegmentDraftChain = create<SegmentDraftChainState>((set) => ({
  wall: null,
  fence: null,
  wallOutcome: 'idle',
  fenceOutcome: 'idle',
  setChainStart: (kind, point) =>
    set(
      kind === 'wall'
        ? { wall: point, wallOutcome: point ? 'active' : 'idle' }
        : { fence: point, fenceOutcome: point ? 'active' : 'idle' },
    ),
  markRefused: (kind) =>
    set(kind === 'wall' ? { wallOutcome: 'refused' } : { fenceOutcome: 'refused' }),
  clear: (kind) =>
    set(
      kind === 'wall' ? { wall: null, wallOutcome: 'idle' } : { fence: null, fenceOutcome: 'idle' },
    ),
}))

export default useSegmentDraftChain
