'use client'

import { create } from 'zustand'
import { angleBetweenMeasurements } from '../lib/measurements'

export type MeasurementPoint = [number, number, number]
export type MeasurementView = '2d' | '3d'
export type MeasurementMode = 'distance' | 'area' | 'perimeter' | 'angle'

export type MeasurementSegment = {
  id: string
  start: MeasurementPoint
  end: MeasurementPoint
  view: MeasurementView
  measuredDistanceMeters?: number
}

export type MeasurementArea = {
  id: string
  areaSquareMeters: number
  labelPoint: MeasurementPoint
  view: MeasurementView
}

export type MeasurementPerimeter = {
  id: string
  labelPoint: MeasurementPoint
  lengthMeters: number
  view: MeasurementView
}

export type MeasurementAngle = {
  id: string
  first: MeasurementPoint
  vertex: MeasurementPoint
  second: MeasurementPoint
  view: MeasurementView
}

export type MeasurementDraft = {
  start: MeasurementPoint
  end: MeasurementPoint | null
  view: MeasurementView
}

export type MeasurementAngleDraft = {
  first: MeasurementPoint
  vertex: MeasurementPoint | null
  second: MeasurementPoint | null
  view: MeasurementView
}

export type MeasurementCursor = {
  point: MeasurementPoint
  view: MeasurementView
}

export type PersistedMeasurements = {
  version: 1
  segments: MeasurementSegment[]
  areas: MeasurementArea[]
  perimeters: MeasurementPerimeter[]
  angles: MeasurementAngle[]
}

type MeasurementToolState = {
  segments: MeasurementSegment[]
  areas: MeasurementArea[]
  perimeters: MeasurementPerimeter[]
  angles: MeasurementAngle[]
  draft: MeasurementDraft | null
  angleDraft: MeasurementAngleDraft | null
  cursor: MeasurementCursor | null
  mode: MeasurementMode
  selectedId: string | null
  begin: (view: MeasurementView, start: MeasurementPoint) => void
  update: (end: MeasurementPoint) => void
  commit: (end?: MeasurementPoint) => void
  beginAngle: (view: MeasurementView, first: MeasurementPoint) => void
  updateAngle: (point: MeasurementPoint) => void
  commitAngle: (point?: MeasurementPoint) => void
  setCursor: (view: MeasurementView, point: MeasurementPoint | null) => void
  setMode: (mode: MeasurementMode) => void
  selectMeasurement: (id: string | null) => void
  removeMeasurement: (id: string) => void
  deleteSelected: () => void
  addSegment: (
    view: MeasurementView,
    start: MeasurementPoint,
    end: MeasurementPoint,
    measuredDistanceMeters?: number,
  ) => void
  addArea: (view: MeasurementView, labelPoint: MeasurementPoint, areaSquareMeters: number) => void
  addPerimeter: (view: MeasurementView, labelPoint: MeasurementPoint, lengthMeters: number) => void
  cancelDraft: () => void
  clear: () => void
}

let nextMeasurementId = 1

export function distanceBetweenMeasurements(a: MeasurementPoint, b: MeasurementPoint): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
}

export function axisLockedMeasurementPoint(
  start: MeasurementPoint,
  end: MeasurementPoint,
  view: MeasurementView,
): MeasurementPoint {
  const axes = view === '2d' ? ([0, 2] as const) : ([0, 1, 2] as const)
  let strongestAxis = axes[0]
  let strongestDistance = Math.abs(end[strongestAxis] - start[strongestAxis])

  for (const axis of axes.slice(1)) {
    const distance = Math.abs(end[axis] - start[axis])
    if (distance > strongestDistance) {
      strongestAxis = axis
      strongestDistance = distance
    }
  }

  return start.map((value, axis) =>
    axis === strongestAxis ? end[axis as keyof MeasurementPoint] : value,
  ) as MeasurementPoint
}

function isMeasurementView(value: unknown): value is MeasurementView {
  return value === '2d' || value === '3d'
}

function normalizePoint(value: unknown): MeasurementPoint | null {
  if (!Array.isArray(value) || value.length !== 3) return null
  const point = value.map((entry) => (typeof entry === 'number' ? entry : Number.NaN))
  if (!point.every(Number.isFinite)) return null
  return point as MeasurementPoint
}

function readMeasurementIdNumber(id: string): number {
  const match = id.match(/-(\d+)$/)
  return match ? Number(match[1]) : 0
}

function syncNextMeasurementId(measurements: PersistedMeasurements) {
  const highestId = [
    ...measurements.segments,
    ...measurements.areas,
    ...measurements.perimeters,
    ...measurements.angles,
  ].reduce((max, measurement) => Math.max(max, readMeasurementIdNumber(measurement.id)), 0)
  nextMeasurementId = Math.max(nextMeasurementId, highestId + 1)
}

export function normalizePersistedMeasurements(value: unknown): PersistedMeasurements {
  if (!(value && typeof value === 'object')) {
    return { version: 1, segments: [], areas: [], perimeters: [], angles: [] }
  }

  const source = value as Partial<PersistedMeasurements>

  const segments = (Array.isArray(source.segments) ? source.segments : []).flatMap((segment) => {
    const start = normalizePoint(segment?.start)
    const end = normalizePoint(segment?.end)
    if (!(start && end && typeof segment?.id === 'string' && isMeasurementView(segment.view))) {
      return []
    }
    return [
      {
        id: segment.id,
        start,
        end,
        view: segment.view,
        measuredDistanceMeters: Number.isFinite(segment.measuredDistanceMeters)
          ? segment.measuredDistanceMeters
          : undefined,
      },
    ]
  })

  const areas = (Array.isArray(source.areas) ? source.areas : []).flatMap((area) => {
    const labelPoint = normalizePoint(area?.labelPoint)
    if (
      !(
        labelPoint &&
        typeof area?.id === 'string' &&
        Number.isFinite(area.areaSquareMeters) &&
        isMeasurementView(area.view)
      )
    ) {
      return []
    }
    return [{ id: area.id, areaSquareMeters: area.areaSquareMeters, labelPoint, view: area.view }]
  })

  const perimeters = (Array.isArray(source.perimeters) ? source.perimeters : []).flatMap(
    (perimeter) => {
      const labelPoint = normalizePoint(perimeter?.labelPoint)
      if (
        !(
          labelPoint &&
          typeof perimeter?.id === 'string' &&
          Number.isFinite(perimeter.lengthMeters) &&
          isMeasurementView(perimeter.view)
        )
      ) {
        return []
      }
      return [
        {
          id: perimeter.id,
          labelPoint,
          lengthMeters: perimeter.lengthMeters,
          view: perimeter.view,
        },
      ]
    },
  )

  const angles = (Array.isArray(source.angles) ? source.angles : []).flatMap((angle) => {
    const first = normalizePoint(angle?.first)
    const vertex = normalizePoint(angle?.vertex)
    const second = normalizePoint(angle?.second)
    if (
      !(first && vertex && second && typeof angle?.id === 'string' && isMeasurementView(angle.view))
    ) {
      return []
    }
    return [{ id: angle.id, first, vertex, second, view: angle.view }]
  })

  return { version: 1, segments, areas, perimeters, angles }
}

export function serializeMeasurements(): PersistedMeasurements {
  const { segments, areas, perimeters, angles } = useMeasurementTool.getState()
  return {
    version: 1,
    segments,
    areas,
    perimeters,
    angles,
  }
}

export function hydrateMeasurements(value: unknown) {
  const measurements = normalizePersistedMeasurements(value)
  syncNextMeasurementId(measurements)
  useMeasurementTool.setState({
    ...measurements,
    angleDraft: null,
    cursor: null,
    draft: null,
    selectedId: null,
  })
}

export const useMeasurementTool = create<MeasurementToolState>((set, get) => ({
  segments: [],
  areas: [],
  perimeters: [],
  angles: [],
  draft: null,
  angleDraft: null,
  cursor: null,
  mode: 'distance',
  selectedId: null,
  begin: (view, start) => set({ draft: { start, end: null, view }, selectedId: null }),
  update: (end) => set((state) => (state.draft ? { draft: { ...state.draft, end } } : state)),
  commit: (end) => {
    const draft = get().draft
    if (!draft) return

    const resolvedEnd = end ?? draft.end
    if (!resolvedEnd || distanceBetweenMeasurements(draft.start, resolvedEnd) < 1e-4) {
      set({ draft: null })
      return
    }

    const id = `measurement-${nextMeasurementId++}`
    set((state) => ({
      draft: null,
      selectedId: id,
      segments: [
        ...state.segments,
        {
          id,
          start: draft.start,
          end: resolvedEnd,
          view: draft.view,
        },
      ],
    }))
  },
  beginAngle: (view, first) =>
    set({ angleDraft: { first, vertex: null, second: null, view }, draft: null, selectedId: null }),
  updateAngle: (point) =>
    set((state) => {
      if (!state.angleDraft) return state
      return {
        angleDraft: state.angleDraft.vertex
          ? { ...state.angleDraft, second: point }
          : { ...state.angleDraft, vertex: point },
      }
    }),
  commitAngle: (point) => {
    const angleDraft = get().angleDraft
    if (!angleDraft) return

    if (!angleDraft.vertex) {
      const vertex = point
      if (!vertex || distanceBetweenMeasurements(angleDraft.first, vertex) < 1e-4) {
        set({ angleDraft: null })
        return
      }
      set({ angleDraft: { ...angleDraft, vertex, second: null } })
      return
    }

    const second = point ?? angleDraft.second
    if (
      !second ||
      distanceBetweenMeasurements(angleDraft.vertex, second) < 1e-4 ||
      angleBetweenMeasurements(angleDraft.first, angleDraft.vertex, second) < 1e-4
    ) {
      set({ angleDraft: null })
      return
    }

    const id = `measurement-angle-${nextMeasurementId++}`
    set((state) => ({
      angleDraft: null,
      angles: [
        ...state.angles,
        {
          id,
          first: angleDraft.first,
          vertex: angleDraft.vertex!,
          second,
          view: angleDraft.view,
        },
      ],
      selectedId: id,
    }))
  },
  setCursor: (view, point) =>
    set((state) => {
      if (!point) {
        return state.cursor?.view === view ? { cursor: null } : state
      }

      const previousPoint = state.cursor?.point
      if (
        state.cursor?.view === view &&
        previousPoint?.[0] === point[0] &&
        previousPoint[1] === point[1] &&
        previousPoint[2] === point[2]
      ) {
        return state
      }

      return { cursor: { point, view } }
    }),
  setMode: (mode) => set({ angleDraft: null, draft: null, mode, selectedId: null }),
  selectMeasurement: (id) => set({ selectedId: id }),
  removeMeasurement: (id) =>
    set((state) => ({
      areas: state.areas.filter((area) => area.id !== id),
      angles: state.angles.filter((angle) => angle.id !== id),
      perimeters: state.perimeters.filter((perimeter) => perimeter.id !== id),
      selectedId: state.selectedId === id ? null : state.selectedId,
      segments: state.segments.filter((segment) => segment.id !== id),
    })),
  deleteSelected: () => {
    const selectedId = get().selectedId
    if (!selectedId) return
    get().removeMeasurement(selectedId)
  },
  addSegment: (view, start, end, measuredDistanceMeters) => {
    if (distanceBetweenMeasurements(start, end) < 1e-4) {
      set({ draft: null })
      return
    }

    const id = `measurement-${nextMeasurementId++}`
    set((state) => ({
      draft: null,
      selectedId: id,
      segments: [
        ...state.segments,
        {
          id,
          start,
          end,
          view,
          measuredDistanceMeters,
        },
      ],
    }))
  },
  addArea: (view, labelPoint, areaSquareMeters) => {
    if (!(Number.isFinite(areaSquareMeters) && areaSquareMeters > 1e-6)) {
      set({ draft: null })
      return
    }

    const id = `measurement-area-${nextMeasurementId++}`
    set((state) => ({
      draft: null,
      selectedId: id,
      areas: [
        ...state.areas,
        {
          id,
          areaSquareMeters,
          labelPoint,
          view,
        },
      ],
    }))
  },
  addPerimeter: (view, labelPoint, lengthMeters) => {
    if (!(Number.isFinite(lengthMeters) && lengthMeters > 1e-6)) {
      set({ draft: null })
      return
    }

    const id = `measurement-perimeter-${nextMeasurementId++}`
    set((state) => ({
      draft: null,
      perimeters: [
        ...state.perimeters,
        {
          id,
          labelPoint,
          lengthMeters,
          view,
        },
      ],
      selectedId: id,
    }))
  },
  cancelDraft: () => set({ angleDraft: null, draft: null }),
  clear: () =>
    set({
      angleDraft: null,
      angles: [],
      areas: [],
      cursor: null,
      draft: null,
      perimeters: [],
      selectedId: null,
      segments: [],
    }),
}))
