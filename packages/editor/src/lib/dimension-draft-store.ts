/**
 * Shared zustand store for dimension-input drafting state.
 *
 * Both the 3D wall tool and the 2D floorplan panel read/write this store.
 * The 3D tool owns the DimensionInput component (via Html); the 2D
 * floorplan renders ghost walls as SVG and places points using the
 * locked dimensions.
 */
import { create } from 'zustand'
import type { WallPlanPoint } from '../components/tools/wall/wall-drafting'
import {
  EMPTY_DIMENSION_DRAFT,
  isDoubleClick,
  recordClickTime,
  type DimensionDraftState,
  buildGhostWalls,
} from '../components/tools/wall/wall-drafting'

interface DimensionDraftStore extends DimensionDraftState {
  /** Place a point using locked dimensions or fallback. Returns new state. */
  placePoint: (fallback: WallPlanPoint) => void
  /** Update length/angle values and recalculate preview. */
  setValues: (length: string, angle: string) => void
  /** Set the active field type for focus management. */
  setFieldType: (fieldType: 'length' | 'angle') => void
  /** Check and record double-click. Returns true if double-click detected. */
  checkDoubleClick: (clickTime: number) => boolean
  /** Reset to initial state. */
  reset: () => void
  /** Initialize with a starting point (Point 1). */
  startDraft: (point: WallPlanPoint) => void
  /** Get ghost wall segments for rendering. */
  getGhostWalls: () => Array<{ start: WallPlanPoint; end: WallPlanPoint }>
}

function calculateNextPoint(
  from: WallPlanPoint,
  lengthMeters: number,
  angleDeg: number,
): WallPlanPoint {
  const rad = (angleDeg * Math.PI) / 180
  return [from[0] + Math.cos(rad) * lengthMeters, from[1] + Math.sin(rad) * lengthMeters]
}

export const useDimensionDraftStore = create<DimensionDraftStore>((set, get) => ({
  points: [],
  previewPoint: null,
  lengthValue: '',
  angleValue: '',
  lockedLength: null,
  lockedAngle: null,
  lastClickTime: 0,
  fieldType: 'length' as const,

  startDraft(point) {
    set({
      ...EMPTY_DIMENSION_DRAFT,
      points: [point],
      fieldType: 'length',
    })
  },

  placePoint(fallback) {
    const state = get()
    const lastPoint =
      state.points.length > 0 ? state.points[state.points.length - 1] : null

    let newPoint: WallPlanPoint
    if (state.lockedLength !== null && state.lockedAngle !== null && lastPoint) {
      newPoint = calculateNextPoint(lastPoint, state.lockedLength, state.lockedAngle)
    } else {
      newPoint = fallback
    }

    set({
      points: [...state.points, newPoint],
      previewPoint: null,
      lengthValue: '',
      angleValue: '',
      lockedLength: null,
      lockedAngle: null,
      fieldType: 'length',
    })
  },

  setValues(lengthValue, angleValue) {
    const state = get()
    // Parse values
    const lengthMatch = lengthValue.trim().match(/^([+-]?\d+(?:\.\d+)?)\s*([a-zA-Z]*)$/)
    const lockedLength =
      lengthMatch && lengthMatch[1]
        ? (() => {
            const v = parseFloat(lengthMatch[1])
            if (Number.isNaN(v)) return null
            const u = (lengthMatch[2] ?? '').toLowerCase()
            if (u === '') return v
            const factors: Record<string, number> = { m: 1, ft: 0.3048, cm: 0.01, in: 0.0254, mm: 0.001 }
            const f = factors[u]
            return f !== undefined ? v * f : null
          })()
        : null

    const angleClean = angleValue.replace(/°|deg$/i, '').trim()
    const lockedAngle =
      angleClean !== '' ? (() => {
        const v = parseFloat(angleClean)
        return Number.isNaN(v) ? null : ((v % 360) + 360) % 360
      })() : null

    // Calculate preview
    const lastPoint =
      state.points.length > 0 ? state.points[state.points.length - 1] : null
    const previewPoint =
      lockedLength !== null && lockedAngle !== null && lastPoint
        ? calculateNextPoint(lastPoint, lockedLength, lockedAngle)
        : null

    set({ lengthValue, angleValue, lockedLength, lockedAngle, previewPoint })
  },

  setFieldType(fieldType) {
    set({ fieldType })
  },

  checkDoubleClick(clickTime) {
    const state = get()
    const isDbl = isDoubleClick(state, clickTime)
    set({ lastClickTime: clickTime })
    return isDbl
  },

  reset() {
    set(EMPTY_DIMENSION_DRAFT)
  },

  getGhostWalls() {
    const state = get()
    const allPoints = state.previewPoint
      ? [...state.points, state.previewPoint]
      : state.points
    return buildGhostWalls(allPoints)
  },
}))
