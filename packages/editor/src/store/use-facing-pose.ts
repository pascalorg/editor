// Ephemeral store for the forward-facing floor triangle shown while placing or
// moving a node. A single editor-side overlay (`<FacingPoseIndicator>`)
// subscribes and renders the triangle; every placement/move path publishes its
// ghost pose here instead of drawing its own triangle. This is deliberately the
// one renderer for the facing indicator: rendering it from inside a tool's own
// cursor ghost (especially tools living in `@pascal-app/nodes`) left it
// invisible, while the editor-side overlay renders reliably. Producers clear on
// commit, cancel, and unmount.
//
// Poses are in the same building-local frame the tools already work in (the
// overlay is mounted inside ToolManager's building-local group).

import { create } from 'zustand'

export type FacingPose = {
  /** Ghost origin in building-local space. */
  position: [number, number, number]
  /** Ghost yaw (radians). The triangle inherits this so it points where the
   *  node faces. */
  rotationY: number
  /** Footprint depth along the ghost's local +Z; the triangle sits just past
   *  `center[1] + depth / 2`. */
  depth: number
  /** Footprint centre offset `[x, z]` in the ghost's local frame. Defaults to
   *  the origin. Kinds whose forward edge isn't centred on the origin (e.g. a
   *  stair, whose run starts at the entry) shift the triangle via this. */
  center?: [number, number]
  /** Point along local -Z (the front is the -Z side) instead of +Z. */
  reversed?: boolean
}

type FacingPoseState = {
  pose: FacingPose | null
  set(pose: FacingPose): void
  clear(): void
}

const useFacingPose = create<FacingPoseState>((set) => ({
  pose: null,
  set: (pose) => set({ pose }),
  clear: () => set({ pose: null }),
}))

export default useFacingPose
