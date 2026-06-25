// Ephemeral store for the 2D floor-plan's in-flight DRAFT preview state — the
// hot, per-pointer-move values every build/edit tool republishes on `grid:move`
// (the snapped cursor point today; wall/fence/roof draft endpoints as later
// slices land here). It exists so those per-move updates DON'T live in
// `FloorplanPanel`'s own `useState`: the panel is a ~10k-line component whose
// render costs ~120-220ms, so a `setState` per move made every 2D draft tool
// feel laggy. Producers write via `getState().setX(...)` (no panel re-render);
// the small overlay leaves subscribe and re-render alone. Same pattern that
// keeps stair / column / elevator placement smooth (`useStairBuildPreview`,
// `usePlacementPreview`).
//
// Editor-only. Producers clear on tool-inactive, commit, and unmount.

import type { WallPlanPoint } from '@pascal-app/core'
import { create } from 'zustand'

/** Screen-space (SVG-local px) cursor point — drives the coordinate badge. */
type SvgPoint = { x: number; y: number }

type FloorplanDraftPreviewState = {
  /** Snapped plan-XZ point under the cursor; drives the crosshair + the
   *  cursor-following polygon-draft preview. `null` when idle. */
  cursorPoint: WallPlanPoint | null
  /** Screen-space cursor point driving the coordinate-indicator badge. Set on
   *  every SVG `pointermove` while a build/select tool is active, so it's the
   *  single hottest 2D update — keeping it out of panel state is what stops the
   *  panel re-rendering per move. `null` when idle. */
  cursorPosition: SvgPoint | null
  /** Live END point of the open wall / fence / roof draft segment — the per-move
   *  endpoint that drives the 2D draft polygon + measurement. Each is `null`
   *  unless that tool's draft is open. The START points stay in panel state
   *  (set per click, low-frequency). */
  wallDraftEnd: WallPlanPoint | null
  fenceDraftEnd: WallPlanPoint | null
  roofDraftEnd: WallPlanPoint | null
  /** Set the snapped cursor point. No-ops (skips the store update, so
   *  subscribers don't re-render) when unchanged — `grid:move` fires far more
   *  often than the snapped cell actually changes. */
  setCursorPoint(point: WallPlanPoint | null): void
  /** Set the screen-space cursor point (deduped on x/y). */
  setCursorPosition(point: SvgPoint | null): void
  setWallDraftEnd(point: WallPlanPoint | null): void
  setFenceDraftEnd(point: WallPlanPoint | null): void
  setRoofDraftEnd(point: WallPlanPoint | null): void
  reset(): void
}

function setPlanPointField(
  field: 'wallDraftEnd' | 'fenceDraftEnd' | 'roofDraftEnd',
  point: WallPlanPoint | null,
) {
  return (
    state: FloorplanDraftPreviewState,
  ): Partial<FloorplanDraftPreviewState> | typeof state => {
    const prev = state[field]
    if (!point && !prev) return state
    if (point && prev && prev[0] === point[0] && prev[1] === point[1]) return state
    return { [field]: point }
  }
}

export const useFloorplanDraftPreview = create<FloorplanDraftPreviewState>((set) => ({
  cursorPoint: null,
  cursorPosition: null,
  wallDraftEnd: null,
  fenceDraftEnd: null,
  roofDraftEnd: null,
  setCursorPoint: (point) =>
    set((state) => {
      const prev = state.cursorPoint
      if (!point && !prev) return state
      if (point && prev && prev[0] === point[0] && prev[1] === point[1]) return state
      return { cursorPoint: point }
    }),
  setCursorPosition: (point) =>
    set((state) => {
      const prev = state.cursorPosition
      if (!point && !prev) return state
      if (point && prev && prev.x === point.x && prev.y === point.y) return state
      return { cursorPosition: point }
    }),
  setWallDraftEnd: (point) => set(setPlanPointField('wallDraftEnd', point)),
  setFenceDraftEnd: (point) => set(setPlanPointField('fenceDraftEnd', point)),
  setRoofDraftEnd: (point) => set(setPlanPointField('roofDraftEnd', point)),
  reset: () =>
    set((state) =>
      state.cursorPoint === null &&
      state.cursorPosition === null &&
      state.wallDraftEnd === null &&
      state.fenceDraftEnd === null &&
      state.roofDraftEnd === null
        ? state
        : {
            cursorPoint: null,
            cursorPosition: null,
            wallDraftEnd: null,
            fenceDraftEnd: null,
            roofDraftEnd: null,
          },
    ),
}))
