'use client'

import { create } from 'zustand'
import { angleBetweenMeasurements } from '../lib/measurements'

export type MeasurementPoint = [number, number, number]
export type MeasurementView = '2d' | '3d'
export type MeasurementMode = 'distance' | 'area' | 'perimeter' | 'angle'
export type MeasurementDisplayPrecision = 'coarse' | 'standard' | 'fine'

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
  boundaryPoints?: MeasurementPoint[]
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
  surfaceNormal?: MeasurementPoint
}

export type MeasurementAngleDraft = {
  first: MeasurementPoint
  vertex: MeasurementPoint | null
  second: MeasurementPoint | null
  view: MeasurementView
}

export type MeasurementPolygonDraft = {
  points: MeasurementPoint[]
  cursor: MeasurementPoint | null
  view: MeasurementView
}

export type MeasurementCursor = {
  point: MeasurementPoint
  view: MeasurementView
}

export type MeasurementSnapTarget = {
  guideLine?: {
    end: MeasurementPoint
    start: MeasurementPoint
  }
  kind?: MeasurementSnapKind
  label: string
  point: MeasurementPoint
  view: MeasurementView
}

export type MeasurementSnapKind =
  | 'center'
  | 'edge'
  | 'endpoint'
  | 'grid'
  | 'guide'
  | 'intersection'
  | 'measurement'
  | 'midpoint'
  | 'surface'
  | 'vertex'

export type MeasurementSnapSettings = Record<MeasurementSnapKind, boolean>
export type MeasurementSegmentEndpoint = 'end' | 'start'
export type DraggingMeasurementSegmentEndpoint = {
  endpoint: MeasurementSegmentEndpoint
  id: string
}

export const DEFAULT_MEASUREMENT_SNAP_SETTINGS: MeasurementSnapSettings = {
  center: true,
  edge: true,
  endpoint: true,
  grid: true,
  guide: true,
  intersection: true,
  measurement: true,
  midpoint: true,
  surface: true,
  vertex: true,
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
  polygonDraft: MeasurementPolygonDraft | null
  previewSegment: MeasurementSegment | null
  previewArea: MeasurementArea | null
  previewPerimeter: MeasurementPerimeter | null
  cursor: MeasurementCursor | null
  snapTarget: MeasurementSnapTarget | null
  mode: MeasurementMode
  displayPrecision: MeasurementDisplayPrecision
  continuousMeasurement: boolean
  enabledSnapKinds: MeasurementSnapSettings
  draggingSegmentEndpoint: DraggingMeasurementSegmentEndpoint | null
  selectedId: string | null
  begin: (view: MeasurementView, start: MeasurementPoint, surfaceNormal?: MeasurementPoint) => void
  update: (end: MeasurementPoint) => void
  updateDraftLength: (lengthMeters: number) => void
  commit: (end?: MeasurementPoint, measuredDistanceMeters?: number) => void
  beginAngle: (view: MeasurementView, first: MeasurementPoint) => void
  updateAngle: (point: MeasurementPoint) => void
  updateAngleDegrees: (degrees: number) => void
  updateAngleMeasurementDegrees: (id: string, degrees: number) => void
  commitAngle: (point?: MeasurementPoint) => void
  beginPolygon: (view: MeasurementView, point: MeasurementPoint) => void
  updatePolygon: (point: MeasurementPoint) => void
  addPolygonPoint: (point: MeasurementPoint) => void
  commitPolygon: () => void
  setPreviewSegment: (segment: MeasurementSegment | null) => void
  setPreviewArea: (area: MeasurementArea | null) => void
  setPreviewPerimeter: (perimeter: MeasurementPerimeter | null) => void
  setCursor: (view: MeasurementView, point: MeasurementPoint | null) => void
  setSnapTarget: (target: MeasurementSnapTarget | null) => void
  setMode: (mode: MeasurementMode) => void
  setDisplayPrecision: (precision: MeasurementDisplayPrecision) => void
  setContinuousMeasurement: (enabled: boolean) => void
  setSnapKindEnabled: (kind: MeasurementSnapKind, enabled: boolean) => void
  setAllSnapKindsEnabled: (enabled: boolean) => void
  resetSnapKinds: () => void
  selectMeasurement: (id: string | null) => void
  startSegmentEndpointDrag: (id: string, endpoint: MeasurementSegmentEndpoint) => void
  updateSegmentEndpoint: (
    id: string,
    endpoint: MeasurementSegmentEndpoint,
    point: MeasurementPoint,
  ) => void
  endSegmentEndpointDrag: () => void
  removeMeasurement: (id: string) => void
  deleteSelected: () => void
  addSegment: (
    view: MeasurementView,
    start: MeasurementPoint,
    end: MeasurementPoint,
    measuredDistanceMeters?: number,
  ) => void
  updateSegmentLength: (id: string, lengthMeters: number) => void
  addArea: (
    view: MeasurementView,
    labelPoint: MeasurementPoint,
    areaSquareMeters: number,
    boundaryPoints?: MeasurementPoint[],
  ) => void
  addPerimeter: (view: MeasurementView, labelPoint: MeasurementPoint, lengthMeters: number) => void
  cancelDraft: () => void
  clear: () => void
}

let nextMeasurementId = 1

export function distanceBetweenMeasurements(a: MeasurementPoint, b: MeasurementPoint): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
}

export function isDraggingMeasurementEndpoint(
  dragging: DraggingMeasurementSegmentEndpoint | null,
  id: string,
  endpoint: MeasurementSegmentEndpoint,
): boolean {
  return dragging?.id === id && dragging.endpoint === endpoint
}

export function axisLockedMeasurementPoint(
  start: MeasurementPoint,
  end: MeasurementPoint,
  view: MeasurementView,
): MeasurementPoint {
  const axes = view === '2d' ? ([0, 2] as const) : ([0, 1, 2] as const)
  let strongestAxis: 0 | 1 | 2 = axes[0]
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

export function polygonPerimeterFromMeasurements(points: MeasurementPoint[]): number {
  if (points.length < 2) return 0
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length] ?? point
    return sum + Math.hypot(next[0] - point[0], next[2] - point[2])
  }, 0)
}

export function polygonAreaAndLabelPointFromMeasurements(points: MeasurementPoint[]): {
  areaSquareMeters: number
  labelPoint: MeasurementPoint
} {
  if (points.length < 3) {
    const fallback = points[0] ?? ([0, 0, 0] as MeasurementPoint)
    return { areaSquareMeters: 0, labelPoint: fallback }
  }

  let cx = 0
  let cz = 0
  let area = 0
  for (
    let index = 0, previousIndex = points.length - 1;
    index < points.length;
    previousIndex = index++
  ) {
    const previous = points[previousIndex]!
    const point = points[index]!
    const factor = previous[0] * point[2] - point[0] * previous[2]
    cx += (previous[0] + point[0]) * factor
    cz += (previous[2] + point[2]) * factor
    area += factor
  }

  area /= 2
  if (Math.abs(area) < 1e-9) {
    const average = points.reduce(
      (sum, point) => [sum[0] + point[0], sum[1] + point[1], sum[2] + point[2]] as MeasurementPoint,
      [0, 0, 0] as MeasurementPoint,
    )
    return {
      areaSquareMeters: 0,
      labelPoint: [
        average[0] / points.length,
        average[1] / points.length,
        average[2] / points.length,
      ],
    }
  }

  return {
    areaSquareMeters: Math.abs(area),
    labelPoint: [cx / (6 * area), points[0]?.[1] ?? 0, cz / (6 * area)],
  }
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

function normalizeVector(vector: MeasurementPoint): MeasurementPoint | null {
  const length = Math.hypot(vector[0], vector[1], vector[2])
  if (length < 1e-8) return null
  return [vector[0] / length, vector[1] / length, vector[2] / length]
}

function crossVector(a: MeasurementPoint, b: MeasurementPoint): MeasurementPoint {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function dotVector(a: MeasurementPoint, b: MeasurementPoint): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function rotateVectorAroundAxis(
  vector: MeasurementPoint,
  axis: MeasurementPoint,
  radians: number,
): MeasurementPoint {
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const cross = crossVector(axis, vector)
  const dot = dotVector(axis, vector)
  return [
    vector[0] * cos + cross[0] * sin + axis[0] * dot * (1 - cos),
    vector[1] * cos + cross[1] * sin + axis[1] * dot * (1 - cos),
    vector[2] * cos + cross[2] * sin + axis[2] * dot * (1 - cos),
  ]
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
    const boundaryPoints = Array.isArray(area.boundaryPoints)
      ? area.boundaryPoints.flatMap((point) => {
          const normalized = normalizePoint(point)
          return normalized ? [normalized] : []
        })
      : undefined
    return [
      {
        id: area.id,
        areaSquareMeters: area.areaSquareMeters,
        boundaryPoints: boundaryPoints && boundaryPoints.length >= 3 ? boundaryPoints : undefined,
        labelPoint,
        view: area.view,
      },
    ]
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
    draggingSegmentEndpoint: null,
    draft: null,
    polygonDraft: null,
    previewArea: null,
    previewPerimeter: null,
    previewSegment: null,
    selectedId: null,
    snapTarget: null,
  })
}

export const useMeasurementTool = create<MeasurementToolState>((set, get) => ({
  segments: [],
  areas: [],
  perimeters: [],
  angles: [],
  draft: null,
  angleDraft: null,
  polygonDraft: null,
  previewSegment: null,
  previewArea: null,
  previewPerimeter: null,
  cursor: null,
  snapTarget: null,
  mode: 'distance',
  displayPrecision: 'standard',
  continuousMeasurement: false,
  enabledSnapKinds: DEFAULT_MEASUREMENT_SNAP_SETTINGS,
  draggingSegmentEndpoint: null,
  selectedId: null,
  begin: (view, start, surfaceNormal) =>
    set({
      draft: { start, end: null, surfaceNormal, view },
      polygonDraft: null,
      previewArea: null,
      previewPerimeter: null,
      previewSegment: null,
      selectedId: null,
    }),
  update: (end) => set((state) => (state.draft ? { draft: { ...state.draft, end } } : state)),
  updateDraftLength: (lengthMeters) => {
    if (!(Number.isFinite(lengthMeters) && lengthMeters > 1e-4)) return
    set((state) => {
      if (!state.draft?.end) return state
      const currentLength = distanceBetweenMeasurements(state.draft.start, state.draft.end)
      if (currentLength < 1e-4) return state
      const scale = lengthMeters / currentLength
      const end: MeasurementPoint = [
        state.draft.start[0] + (state.draft.end[0] - state.draft.start[0]) * scale,
        state.draft.start[1] + (state.draft.end[1] - state.draft.start[1]) * scale,
        state.draft.start[2] + (state.draft.end[2] - state.draft.start[2]) * scale,
      ]
      return { draft: { ...state.draft, end } }
    })
  },
  commit: (end, measuredDistanceMeters) => {
    const draft = get().draft
    if (!draft) return

    const resolvedEnd = end ?? draft.end
    if (!resolvedEnd || distanceBetweenMeasurements(draft.start, resolvedEnd) < 1e-4) {
      set({
        draft: null,
        polygonDraft: null,
        previewArea: null,
        previewPerimeter: null,
        previewSegment: null,
      })
      return
    }

    const id = `measurement-${nextMeasurementId++}`
    set((state) => ({
      draft: state.continuousMeasurement
        ? { start: resolvedEnd, end: null, view: draft.view }
        : null,
      previewArea: null,
      previewPerimeter: null,
      previewSegment: null,
      selectedId: id,
      segments: [
        ...state.segments,
        {
          id,
          start: draft.start,
          end: resolvedEnd,
          view: draft.view,
          measuredDistanceMeters,
        },
      ],
    }))
  },
  beginAngle: (view, first) =>
    set({
      angleDraft: { first, vertex: null, second: null, view },
      draft: null,
      polygonDraft: null,
      previewArea: null,
      previewPerimeter: null,
      previewSegment: null,
      selectedId: null,
    }),
  updateAngle: (point) =>
    set((state) => {
      if (!state.angleDraft) return state
      return {
        angleDraft: state.angleDraft.vertex
          ? { ...state.angleDraft, second: point }
          : { ...state.angleDraft, vertex: point },
      }
    }),
  updateAngleDegrees: (degrees) => {
    if (!(Number.isFinite(degrees) && degrees > 1e-4 && degrees < 360)) return
    set((state) => {
      const draft = state.angleDraft
      if (!(draft?.vertex && draft.second)) return state
      const firstVector: MeasurementPoint = [
        draft.first[0] - draft.vertex[0],
        draft.first[1] - draft.vertex[1],
        draft.first[2] - draft.vertex[2],
      ]
      const secondVector: MeasurementPoint = [
        draft.second[0] - draft.vertex[0],
        draft.second[1] - draft.vertex[1],
        draft.second[2] - draft.vertex[2],
      ]
      const firstUnit = normalizeVector(firstVector)
      const secondLength = Math.hypot(secondVector[0], secondVector[1], secondVector[2])
      if (!(firstUnit && secondLength > 1e-4)) return state

      const currentNormal = normalizeVector(crossVector(firstVector, secondVector))
      const axis =
        currentNormal ??
        (draft.view === '2d' ? ([0, -1, 0] as MeasurementPoint) : ([0, 1, 0] as MeasurementPoint))
      const rotated = rotateVectorAroundAxis(firstUnit, axis, (degrees * Math.PI) / 180)
      const second: MeasurementPoint = [
        draft.vertex[0] + rotated[0] * secondLength,
        draft.vertex[1] + rotated[1] * secondLength,
        draft.vertex[2] + rotated[2] * secondLength,
      ]
      return { angleDraft: { ...draft, second } }
    })
  },
  updateAngleMeasurementDegrees: (id, degrees) => {
    if (!(Number.isFinite(degrees) && degrees > 1e-4 && degrees < 360)) return
    set((state) => ({
      angles: state.angles.map((angle) => {
        if (angle.id !== id) return angle
        const firstVector: MeasurementPoint = [
          angle.first[0] - angle.vertex[0],
          angle.first[1] - angle.vertex[1],
          angle.first[2] - angle.vertex[2],
        ]
        const secondVector: MeasurementPoint = [
          angle.second[0] - angle.vertex[0],
          angle.second[1] - angle.vertex[1],
          angle.second[2] - angle.vertex[2],
        ]
        const firstUnit = normalizeVector(firstVector)
        const secondLength = Math.hypot(secondVector[0], secondVector[1], secondVector[2])
        if (!(firstUnit && secondLength > 1e-4)) return angle

        const currentNormal = normalizeVector(crossVector(firstVector, secondVector))
        const axis =
          currentNormal ??
          (angle.view === '2d' ? ([0, -1, 0] as MeasurementPoint) : ([0, 1, 0] as MeasurementPoint))
        const rotated = rotateVectorAroundAxis(firstUnit, axis, (degrees * Math.PI) / 180)
        return {
          ...angle,
          second: [
            angle.vertex[0] + rotated[0] * secondLength,
            angle.vertex[1] + rotated[1] * secondLength,
            angle.vertex[2] + rotated[2] * secondLength,
          ] as MeasurementPoint,
        }
      }),
    }))
  },
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
  beginPolygon: (view, point) =>
    set({
      angleDraft: null,
      draft: null,
      polygonDraft: { points: [point], cursor: null, view },
      previewArea: null,
      previewPerimeter: null,
      previewSegment: null,
      selectedId: null,
    }),
  updatePolygon: (point) =>
    set((state) =>
      state.polygonDraft ? { polygonDraft: { ...state.polygonDraft, cursor: point } } : state,
    ),
  addPolygonPoint: (point) =>
    set((state) =>
      state.polygonDraft
        ? {
            polygonDraft: {
              ...state.polygonDraft,
              cursor: null,
              points: [...state.polygonDraft.points, point],
            },
          }
        : state,
    ),
  commitPolygon: () => {
    const { mode, polygonDraft } = get()
    if (!polygonDraft || polygonDraft.points.length < 3) {
      set({ polygonDraft: null, previewArea: null, previewPerimeter: null })
      return
    }

    const { areaSquareMeters, labelPoint } = polygonAreaAndLabelPointFromMeasurements(
      polygonDraft.points,
    )
    if (mode === 'area') {
      get().addArea(polygonDraft.view, labelPoint, areaSquareMeters, polygonDraft.points)
    } else if (mode === 'perimeter') {
      get().addPerimeter(
        polygonDraft.view,
        labelPoint,
        polygonPerimeterFromMeasurements(polygonDraft.points),
      )
    }
    set({ polygonDraft: null, previewArea: null, previewPerimeter: null })
  },
  setPreviewSegment: (previewSegment) => set({ previewSegment }),
  setPreviewArea: (previewArea) => set({ previewArea }),
  setPreviewPerimeter: (previewPerimeter) => set({ previewPerimeter }),
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
  setSnapTarget: (target) => set({ snapTarget: target }),
  setMode: (mode) =>
    set({
      angleDraft: null,
      draft: null,
      mode,
      polygonDraft: null,
      previewArea: null,
      previewPerimeter: null,
      previewSegment: null,
      selectedId: null,
      snapTarget: null,
    }),
  setDisplayPrecision: (displayPrecision) => set({ displayPrecision }),
  setContinuousMeasurement: (continuousMeasurement) => set({ continuousMeasurement }),
  setSnapKindEnabled: (kind, enabled) =>
    set((state) => ({
      enabledSnapKinds: {
        ...state.enabledSnapKinds,
        [kind]: enabled,
      },
      snapTarget: state.snapTarget?.kind === kind && !enabled ? null : state.snapTarget,
    })),
  setAllSnapKindsEnabled: (enabled) =>
    set((state) => {
      const enabledSnapKinds = Object.fromEntries(
        Object.keys(DEFAULT_MEASUREMENT_SNAP_SETTINGS).map((kind) => [kind, enabled]),
      ) as MeasurementSnapSettings
      return {
        enabledSnapKinds,
        snapTarget: state.snapTarget?.kind && !enabled ? null : state.snapTarget,
      }
    }),
  resetSnapKinds: () =>
    set((state) => ({
      enabledSnapKinds: DEFAULT_MEASUREMENT_SNAP_SETTINGS,
      snapTarget:
        state.snapTarget?.kind && !DEFAULT_MEASUREMENT_SNAP_SETTINGS[state.snapTarget.kind]
          ? null
          : state.snapTarget,
    })),
  selectMeasurement: (id) => set({ selectedId: id }),
  startSegmentEndpointDrag: (id, endpoint) =>
    set({ draggingSegmentEndpoint: { endpoint, id }, selectedId: id }),
  updateSegmentEndpoint: (id, endpoint, point) =>
    set((state) => ({
      segments: state.segments.map((segment) =>
        segment.id === id
          ? {
              ...segment,
              [endpoint]: point,
              measuredDistanceMeters: undefined,
            }
          : segment,
      ),
    })),
  endSegmentEndpointDrag: () => set({ draggingSegmentEndpoint: null }),
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
      set({ draft: null, previewArea: null, previewPerimeter: null, previewSegment: null })
      return
    }

    const id = `measurement-${nextMeasurementId++}`
    set((state) => ({
      draft: null,
      polygonDraft: null,
      previewArea: null,
      previewPerimeter: null,
      previewSegment: null,
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
  updateSegmentLength: (id, lengthMeters) => {
    if (!(Number.isFinite(lengthMeters) && lengthMeters > 1e-4)) return
    set((state) => ({
      segments: state.segments.map((segment) => {
        if (segment.id !== id) return segment
        const currentLength = distanceBetweenMeasurements(segment.start, segment.end)
        if (currentLength < 1e-4) return segment
        const scale = lengthMeters / currentLength
        const end: MeasurementPoint = [
          segment.start[0] + (segment.end[0] - segment.start[0]) * scale,
          segment.start[1] + (segment.end[1] - segment.start[1]) * scale,
          segment.start[2] + (segment.end[2] - segment.start[2]) * scale,
        ]
        return { ...segment, end, measuredDistanceMeters: lengthMeters }
      }),
    }))
  },
  addArea: (view, labelPoint, areaSquareMeters, boundaryPoints) => {
    if (!(Number.isFinite(areaSquareMeters) && areaSquareMeters > 1e-6)) {
      set({
        draft: null,
        polygonDraft: null,
        previewArea: null,
        previewPerimeter: null,
        previewSegment: null,
      })
      return
    }

    const id = `measurement-area-${nextMeasurementId++}`
    set((state) => ({
      draft: null,
      polygonDraft: null,
      previewArea: null,
      previewPerimeter: null,
      previewSegment: null,
      selectedId: id,
      areas: [
        ...state.areas,
        {
          id,
          areaSquareMeters,
          boundaryPoints,
          labelPoint,
          view,
        },
      ],
    }))
  },
  addPerimeter: (view, labelPoint, lengthMeters) => {
    if (!(Number.isFinite(lengthMeters) && lengthMeters > 1e-6)) {
      set({
        draft: null,
        polygonDraft: null,
        previewArea: null,
        previewPerimeter: null,
        previewSegment: null,
      })
      return
    }

    const id = `measurement-perimeter-${nextMeasurementId++}`
    set((state) => ({
      draft: null,
      polygonDraft: null,
      previewArea: null,
      previewPerimeter: null,
      previewSegment: null,
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
  cancelDraft: () =>
    set({
      angleDraft: null,
      cursor: null,
      draggingSegmentEndpoint: null,
      draft: null,
      polygonDraft: null,
      previewArea: null,
      previewPerimeter: null,
      previewSegment: null,
      snapTarget: null,
    }),
  clear: () =>
    set({
      angleDraft: null,
      angles: [],
      areas: [],
      cursor: null,
      draggingSegmentEndpoint: null,
      draft: null,
      polygonDraft: null,
      perimeters: [],
      previewArea: null,
      previewPerimeter: null,
      previewSegment: null,
      selectedId: null,
      segments: [],
      snapTarget: null,
    }),
}))
