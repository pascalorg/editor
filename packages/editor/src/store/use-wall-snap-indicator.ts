// Ephemeral store for the "magnetic" wall-snap beacon shown during wall
// drafting. The wall tool writes the active snap point on pointermove when
// the draft endpoint locks onto existing wall geometry (a corner or a point
// along a wall); the 3D beacon layer subscribes and draws a vertical marker
// there. Cleared on commit, cancel, and unmount — same lifecycle as
// `use-alignment-guides`.

import { create } from 'zustand'

/** Which kind of wall geometry the draft point snapped to. */
export type WallSnapKind = 'endpoint' | 'midpoint' | 'intersection' | 'wall'

export type WallSnapPoint = {
  /** Building-local plan coordinates (XZ meters). */
  x: number
  z: number
  kind: WallSnapKind
  /** Optional wall ids whose geometry produced this snap. */
  wallIds?: string[]
}

type WallSnapIndicatorState = {
  point: WallSnapPoint | null
  set(point: WallSnapPoint | null): void
  clear(): void
}

const useWallSnapIndicator = create<WallSnapIndicatorState>((set) => ({
  point: null,
  set: (point) => set({ point }),
  clear: () => set({ point: null }),
}))

export default useWallSnapIndicator
