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

export type StairPreviewPoint = [number, number]

type StairBuildPreviewState = {
  /** Snapped plan-XZ point the ghost staircase sits at; `null` when idle. */
  point: StairPreviewPoint | null
  /** Yaw (radians), cycled by R / T. */
  rotation: number
  rise: number | null
  /** Set the snapped point. No-ops (skips the store update, so subscribers
   *  don't re-render) when the point is unchanged — `grid:move` fires far more
   *  often than the snapped cell actually changes. */
  setPoint(point: StairPreviewPoint | null): void
  setPreview(point: StairPreviewPoint | null, rotation: number, rise?: number | null): void
  rotateBy(deltaRadians: number): void
  reset(): void
}

export const useStairBuildPreview = create<StairBuildPreviewState>((set) => ({
  point: null,
  rotation: 0,
  rise: null,
  setPoint: (point) =>
    set((state) => {
      const prev = state.point
      if (!point && !prev) return state
      if (point && prev && prev[0] === point[0] && prev[1] === point[1]) return state
      return { point: point ? [point[0], point[1]] : null }
    }),
  setPreview: (point, rotation, rise) =>
    set((state) => {
      const samePoint =
        (!point && !state.point) ||
        Boolean(point && state.point && state.point[0] === point[0] && state.point[1] === point[1])
      return samePoint && state.rotation === rotation && (rise === undefined || rise === state.rise)
        ? state
        : {
            point: point ? [point[0], point[1]] : null,
            rotation,
            rise: rise === undefined ? state.rise : rise,
          }
    }),
  reset: () =>
    set((state) =>
      state.point === null && state.rotation === 0 && state.rise === null
        ? state
        : { point: null, rotation: 0, rise: null },
    ),
}))
