// Ephemeral store for the 2D floor-plan marquee (box-select) drag — the hot,
// per-pointer-move rectangle the select tool republishes on every move. It
// lives here, not in `FloorplanPanel`'s `useState`, for the same reason as
// `useFloorplanDraftPreview`: the panel is a ~10k-line component whose render
// costs ~120-220ms, so a `setState` per move made dragging a selection box
// re-render the whole panel. Producers write via `getState()` (no panel
// re-render); the small marquee overlay leaf subscribes and re-renders alone.
//
// The whole drag struct lives here (not just the moving corner) so the
// pointer-move / -up handlers read it non-reactively via `getState()` and the
// panel never subscribes. Editor-only; reset on pointer-up / cancel /
// tool-inactive.

import type { WallPlanPoint } from '@pascal-app/core'
import { create } from 'zustand'

export type FloorplanMarqueeDrag = {
  pointerId: number
  startClientX: number
  startClientY: number
  startPlanPoint: WallPlanPoint
  /** Moving corner under the cursor — the only field that changes per move. */
  currentPlanPoint: WallPlanPoint
}

type FloorplanMarqueeState = {
  drag: FloorplanMarqueeDrag | null
  begin(drag: FloorplanMarqueeDrag): void
  /** Advance the moving corner. No-ops (skips the store update, so the overlay
   *  doesn't re-render) when the snapped point is unchanged or no drag is open. */
  setCurrent(point: WallPlanPoint): void
  reset(): void
}

export const useFloorplanMarquee = create<FloorplanMarqueeState>((set) => ({
  drag: null,
  begin: (drag) => set({ drag }),
  setCurrent: (point) =>
    set((state) => {
      const prev = state.drag
      if (!prev) return state
      if (prev.currentPlanPoint[0] === point[0] && prev.currentPlanPoint[1] === point[1]) {
        return state
      }
      return { drag: { ...prev, currentPlanPoint: point } }
    }),
  reset: () => set((state) => (state.drag === null ? state : { drag: null })),
}))

export default useFloorplanMarquee
