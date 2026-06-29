// Ephemeral store for the stair tool's 2D floor-plan build preview. The stair
// tool's snapped cursor point + rotation publish here on each `grid:move` / R-T
// rotate; the floor-plan stair preview layer subscribes and renders the ghost
// staircase. This mirrors how `usePlacementPreview` keeps column / elevator
// placement smooth: the preview lives OUTSIDE `FloorplanPanel`, so a per-move
// update re-renders only the tiny preview layer, not the (expensive) panel.
//
// Editor-only, same rationale as `usePlacementPreview`. Producers clear on
// tool-inactive, commit, and unmount.

import { create } from 'zustand'

type StairPreviewPoint = [number, number]

type StairBuildPreviewState = {
  /** Snapped plan-XZ point the ghost staircase sits at; `null` when idle. */
  point: StairPreviewPoint | null
  /** Yaw (radians), cycled by R / T. */
  rotation: number
  /** Set the snapped point. No-ops (skips the store update, so subscribers
   *  don't re-render) when the point is unchanged — `grid:move` fires far more
   *  often than the snapped cell actually changes. */
  setPoint(point: StairPreviewPoint | null): void
  rotateBy(deltaRadians: number): void
  reset(): void
}

export const useStairBuildPreview = create<StairBuildPreviewState>((set) => ({
  point: null,
  rotation: 0,
  setPoint: (point) =>
    set((state) => {
      const prev = state.point
      if (!point && !prev) return state
      if (point && prev && prev[0] === point[0] && prev[1] === point[1]) return state
      return { point }
    }),
  rotateBy: (deltaRadians) => set((state) => ({ rotation: state.rotation + deltaRadians })),
  reset: () =>
    set((state) =>
      state.point === null && state.rotation === 0 ? state : { point: null, rotation: 0 },
    ),
}))
