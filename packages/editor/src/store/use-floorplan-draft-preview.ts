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
import { registerDrawingControls, runDrawingControl } from '../lib/drawing-controls'

/** Screen-space (SVG-local px) cursor point — drives the coordinate badge. */
type SvgPoint = { x: number; y: number }

export type FloorplanPolygonDraftType = 'ceiling' | 'slab' | 'zone'

type WallDraftCommit = (end: WallPlanPoint) => boolean
const wallDraftCommitters = new Map<'2d' | '3d', WallDraftCommit>()

type FloorplanDraftPreviewState = {
  registerDrawingControls: typeof registerDrawingControls
  runDrawingControl: typeof runDrawingControl
  wallDraftLength: number | null
  wallDraftPointerEnd: WallPlanPoint | null
  setWallDraftLength(length: number | null): void
  constrainWallDraftPoint(start: WallPlanPoint, point: WallPlanPoint): WallPlanPoint
  registerWallDraftCommit(view: '2d' | '3d', commit: WallDraftCommit): () => void
  commitWallDraft(view: '2d' | '3d' | 'split', allowFreeLength?: boolean): boolean
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
   *  unless that tool's draft is open. The START points are mirrored here (set
   *  per click / per 3D draft move) so out-of-tree consumers — e.g. the hosted
   *  host-owned preview publishers — can observe the whole open
   *  segment; panel state remains the 2D interaction source of truth. */
  wallDraftEnd: WallPlanPoint | null
  fenceDraftEnd: WallPlanPoint | null
  roofDraftEnd: WallPlanPoint | null
  wallDraftStart: WallPlanPoint | null
  fenceDraftStart: WallPlanPoint | null
  roofDraftStart: WallPlanPoint | null
  roofDraftQuarterTurn: boolean
  polygonDraftType: FloorplanPolygonDraftType | null
  polygonDraftPoints: WallPlanPoint[]
  /** Set the snapped cursor point. No-ops (skips the store update, so
   *  subscribers don't re-render) when unchanged — `grid:move` fires far more
   *  often than the snapped cell actually changes. */
  setCursorPoint(point: WallPlanPoint | null): void
  /** Set the screen-space cursor point (deduped on x/y). */
  setCursorPosition(point: SvgPoint | null): void
  setWallDraftEnd(point: WallPlanPoint | null): void
  setFenceDraftEnd(point: WallPlanPoint | null): void
  setRoofDraftEnd(point: WallPlanPoint | null): void
  setWallDraftStart(point: WallPlanPoint | null): void
  setFenceDraftStart(point: WallPlanPoint | null): void
  setRoofDraftStart(point: WallPlanPoint | null): void
  setRoofDraftQuarterTurn(quarterTurn: boolean): void
  setPolygonDraft(type: FloorplanPolygonDraftType | null, points: readonly WallPlanPoint[]): void
  reset(): void
}

function planPointsEqual(a: readonly WallPlanPoint[], b: readonly WallPlanPoint[]) {
  return (
    a.length === b.length &&
    a.every((point, index) => point[0] === b[index]?.[0] && point[1] === b[index]?.[1])
  )
}

function setPlanPointField(
  field:
    | 'fenceDraftEnd'
    | 'fenceDraftStart'
    | 'roofDraftEnd'
    | 'roofDraftStart'
    | 'wallDraftEnd'
    | 'wallDraftStart',
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

function constrainLength(
  start: WallPlanPoint,
  point: WallPlanPoint,
  length: number | null,
): WallPlanPoint {
  const dx = point[0] - start[0]
  const dz = point[1] - start[1]
  const distance = Math.hypot(dx, dz)
  if (length === null || distance < 1e-8) return point
  return [start[0] + (dx * length) / distance, start[1] + (dz * length) / distance]
}

export const useFloorplanDraftPreview = create<FloorplanDraftPreviewState>((set, get) => ({
  registerDrawingControls,
  runDrawingControl,
  wallDraftLength: null,
  wallDraftPointerEnd: null,
  registerWallDraftCommit: (view, commit) => {
    wallDraftCommitters.set(view, commit)
    return () => {
      if (wallDraftCommitters.get(view) === commit) wallDraftCommitters.delete(view)
    }
  },
  commitWallDraft: (view, allowFreeLength = false) => {
    const { wallDraftStart: start, wallDraftEnd: end, wallDraftLength: length } = get()
    if (
      !start ||
      !end ||
      (!allowFreeLength && length === null) ||
      Math.hypot(end[0] - start[0], end[1] - start[1]) < 0.01
    )
      return false
    const committed = wallDraftCommitters.get(view === '2d' ? '2d' : '3d')?.(end) ?? false
    // Split view's floorplan must advance its local chain after the 3D owner commits.
    if (committed && view === 'split') wallDraftCommitters.get('2d')?.(end)
    return committed
  },
  constrainWallDraftPoint: (start, point) => constrainLength(start, point, get().wallDraftLength),
  setWallDraftLength: (length) =>
    set((state) => {
      if (length !== null && (!Number.isFinite(length) || length < 0.01)) return state
      if (length === state.wallDraftLength) return state
      const end =
        state.wallDraftStart && state.wallDraftPointerEnd
          ? constrainLength(state.wallDraftStart, state.wallDraftPointerEnd, length)
          : state.wallDraftEnd
      return { wallDraftLength: length, wallDraftEnd: end }
    }),
  cursorPoint: null,
  cursorPosition: null,
  wallDraftEnd: null,
  fenceDraftEnd: null,
  roofDraftEnd: null,
  wallDraftStart: null,
  fenceDraftStart: null,
  roofDraftStart: null,
  roofDraftQuarterTurn: false,
  polygonDraftType: null,
  polygonDraftPoints: [],
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
  setWallDraftEnd: (point) =>
    set((state) => {
      const end =
        point && state.wallDraftStart
          ? constrainLength(state.wallDraftStart, point, state.wallDraftLength)
          : point
      const next = setPlanPointField('wallDraftEnd', end)(state)
      const previousPointer = state.wallDraftPointerEnd
      if (
        next === state &&
        (point === previousPointer ||
          (point &&
            previousPointer &&
            point[0] === previousPointer[0] &&
            point[1] === previousPointer[1]))
      )
        return state
      return { ...next, wallDraftPointerEnd: point }
    }),
  setFenceDraftEnd: (point) => set(setPlanPointField('fenceDraftEnd', point)),
  setRoofDraftEnd: (point) => set(setPlanPointField('roofDraftEnd', point)),
  setWallDraftStart: (point) =>
    set((state) => {
      const next = setPlanPointField('wallDraftStart', point)(state)
      return next === state ? state : { ...next, wallDraftLength: null, wallDraftPointerEnd: null }
    }),
  setFenceDraftStart: (point) => set(setPlanPointField('fenceDraftStart', point)),
  setRoofDraftStart: (point) => set(setPlanPointField('roofDraftStart', point)),
  setRoofDraftQuarterTurn: (quarterTurn) =>
    set((state) =>
      state.roofDraftQuarterTurn === quarterTurn ? state : { roofDraftQuarterTurn: quarterTurn },
    ),
  setPolygonDraft: (type, points) =>
    set((state) =>
      state.polygonDraftType === type && planPointsEqual(state.polygonDraftPoints, points)
        ? state
        : { polygonDraftType: type, polygonDraftPoints: points.map(([x, z]) => [x, z]) },
    ),
  reset: () =>
    set((state) =>
      state.cursorPoint === null &&
      state.cursorPosition === null &&
      state.wallDraftEnd === null &&
      state.wallDraftLength === null &&
      state.wallDraftPointerEnd === null &&
      state.fenceDraftEnd === null &&
      state.roofDraftEnd === null &&
      state.wallDraftStart === null &&
      state.fenceDraftStart === null &&
      state.roofDraftStart === null &&
      state.roofDraftQuarterTurn === false &&
      state.polygonDraftType === null &&
      state.polygonDraftPoints.length === 0
        ? state
        : {
            cursorPoint: null,
            cursorPosition: null,
            wallDraftEnd: null,
            wallDraftLength: null,
            wallDraftPointerEnd: null,
            fenceDraftEnd: null,
            roofDraftEnd: null,
            wallDraftStart: null,
            fenceDraftStart: null,
            roofDraftStart: null,
            roofDraftQuarterTurn: false,
            polygonDraftType: null,
            polygonDraftPoints: [],
          },
    ),
}))
