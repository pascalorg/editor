'use client'

import {
  areMeasurementPointsCoplanar,
  MEASUREMENT_PLANAR_TOLERANCE,
  type MeasurementAnchor,
  type MeasurementFeatureAnchor,
  MeasurementNode,
  type MeasurementSnapKind,
  measurementNormal,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { create } from 'zustand'

export type MeasurementKind = 'distance' | 'angle' | 'area' | 'perimeter' | 'volume'
export type MeasurementDraftOwner = '2d' | '3d'
export type MeasurementDraftStage = 'collecting' | 'extruding' | 'ready'
export type MeasurementAxis = 'x' | 'y' | 'z'
export type MeasurementPoint = [number, number, number]

export type MeasurementAxisGuide = {
  axis: MeasurementAxis
  from: MeasurementPoint
  to: MeasurementPoint
  snapped: boolean
}

export type MeasurementSurfacePoint = {
  point: MeasurementPoint
  normal: MeasurementPoint
  targetNodeId: string | null
  anchor?: MeasurementFeatureAnchor
  semantic?: {
    label: string
    length: number | null
    snapKind: MeasurementSnapKind
  }
}

export type MeasurementVertexDrag = {
  owner: MeasurementDraftOwner
  index: number
  originalPoint: MeasurementPoint
  originalAnchor: MeasurementFeatureAnchor | null
  inserted: boolean
}

export type MeasurementDraftPayload =
  | { kind: 'distance'; points: [MeasurementAnchor, MeasurementAnchor] }
  | { kind: 'angle'; points: [MeasurementAnchor, MeasurementAnchor, MeasurementAnchor] }
  | { kind: 'area'; base: MeasurementAnchor[] }
  | { kind: 'perimeter'; base: MeasurementAnchor[] }
  | { kind: 'volume'; base: MeasurementAnchor[]; extrusion: MeasurementPoint }

type MeasurementDraftState = {
  kind: MeasurementKind
  owner: MeasurementDraftOwner | null
  levelId: string | null
  stage: MeasurementDraftStage
  points: MeasurementPoint[]
  anchors: Array<MeasurementFeatureAnchor | null>
  hover: MeasurementSurfacePoint | null
  hoverOwner: MeasurementDraftOwner | null
  axisGuide: MeasurementAxisGuide | null
  vertexDrag: MeasurementVertexDrag | null
  baseNormal: MeasurementPoint | null
  extrusionHeight: number
  error: string | null
  setKind(kind: MeasurementKind): void
  setHover(
    owner: MeasurementDraftOwner,
    hover: MeasurementSurfacePoint | null,
    axisGuide?: MeasurementAxisGuide | null,
  ): void
  beginVertexDrag(owner: MeasurementDraftOwner, index: number): boolean
  beginMidpointVertexDrag(owner: MeasurementDraftOwner, edgeIndex: number): boolean
  updateDraggedVertex(
    owner: MeasurementDraftOwner,
    hover: MeasurementSurfacePoint,
    axisGuide?: MeasurementAxisGuide | null,
  ): boolean
  finishVertexDrag(owner: MeasurementDraftOwner): boolean
  cancelVertexDrag(owner: MeasurementDraftOwner): boolean
  addPoint(
    owner: MeasurementDraftOwner,
    point: MeasurementPoint,
    anchor?: MeasurementFeatureAnchor,
  ): boolean
  closeBase(owner: MeasurementDraftOwner, preferredNormal?: MeasurementPoint): boolean
  setExtrusionHeight(owner: MeasurementDraftOwner, height: number): boolean
  finishExtrusion(owner: MeasurementDraftOwner): boolean
  removeLast(owner: MeasurementDraftOwner): boolean
  getCommitPayload(owner: MeasurementDraftOwner): MeasurementDraftPayload | null
  reset(): void
}

const MIN_EXTRUSION = 0.001

const clonePoint = (point: MeasurementPoint): MeasurementPoint => [...point]

export function measurementPolygonMidpoints(
  points: readonly MeasurementPoint[],
): Array<{ edgeIndex: number; point: MeasurementPoint }> {
  if (points.length < 3) return []
  return points.map((start, edgeIndex) => {
    const end = points[(edgeIndex + 1) % points.length]!
    return {
      edgeIndex,
      point: [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2],
    }
  })
}

function idleState(kind: MeasurementKind) {
  return {
    kind,
    owner: null,
    levelId: null,
    stage: 'collecting' as const,
    points: [],
    anchors: [],
    hover: null,
    hoverOwner: null,
    axisGuide: null,
    vertexDrag: null,
    baseNormal: null,
    extrusionHeight: 0,
    error: null,
  }
}

function payloadFor(state: MeasurementDraftState): MeasurementDraftPayload | null {
  if (state.stage !== 'ready') return null

  const anchorAt = (index: number): MeasurementAnchor =>
    state.anchors[index] ?? clonePoint(state.points[index]!)

  if (state.kind === 'distance') {
    const [start, end] = state.points
    if (!(start && end)) return null
    return { kind: 'distance', points: [anchorAt(0), anchorAt(1)] }
  }

  if (state.kind === 'angle') {
    if (state.points.length !== 3) return null
    return { kind: 'angle', points: [anchorAt(0), anchorAt(1), anchorAt(2)] }
  }

  if (state.kind === 'area' || state.kind === 'perimeter') {
    if (state.points.length < 3) return null
    return { kind: state.kind, base: state.points.map((_, index) => anchorAt(index)) }
  }

  if (!(state.baseNormal && state.points.length >= 3)) return null
  return {
    kind: 'volume',
    base: state.points.map((_, index) => anchorAt(index)),
    extrusion: [
      state.baseNormal[0] * state.extrusionHeight,
      state.baseNormal[1] * state.extrusionHeight,
      state.baseNormal[2] * state.extrusionHeight,
    ],
  }
}

export const useMeasurementDraft = create<MeasurementDraftState>((set, get) => ({
  ...idleState('distance'),

  setKind: (kind) => set((state) => (state.kind === kind ? state : { ...idleState(kind) })),

  setHover: (owner, hover, axisGuide = null) =>
    set((state) => {
      if (state.owner && state.owner !== owner) return state
      if (state.levelId && state.levelId !== useViewer.getState().selection.levelId) return state
      if (state.vertexDrag) return state
      if (!hover && !state.hover && !state.axisGuide) return state
      return { hover, hoverOwner: hover ? owner : null, axisGuide }
    }),

  beginVertexDrag: (owner, index) => {
    const state = get()
    const point = state.points[index]
    if (
      state.owner !== owner ||
      state.levelId !== useViewer.getState().selection.levelId ||
      state.stage !== 'collecting' ||
      state.vertexDrag ||
      !Number.isInteger(index) ||
      !point
    ) {
      return false
    }

    set({
      vertexDrag: {
        owner,
        index,
        originalPoint: clonePoint(point),
        originalAnchor: state.anchors[index] ?? null,
        inserted: false,
      },
      hover: null,
      hoverOwner: null,
      axisGuide: null,
      error: null,
    })
    return true
  },

  beginMidpointVertexDrag: (owner, edgeIndex) => {
    const state = get()
    if (
      state.owner !== owner ||
      state.levelId !== useViewer.getState().selection.levelId ||
      state.stage !== 'collecting' ||
      state.vertexDrag ||
      state.kind === 'distance' ||
      state.kind === 'angle' ||
      state.points.length < 3 ||
      !Number.isInteger(edgeIndex) ||
      edgeIndex < 0 ||
      edgeIndex >= state.points.length
    ) {
      return false
    }

    const start = state.points[edgeIndex]!
    const end = state.points[(edgeIndex + 1) % state.points.length]!
    const midpoint: MeasurementPoint = [
      (start[0] + end[0]) / 2,
      (start[1] + end[1]) / 2,
      (start[2] + end[2]) / 2,
    ]
    const index = edgeIndex + 1
    const points = [...state.points.slice(0, index), midpoint, ...state.points.slice(index)]
    const anchors = [...state.anchors.slice(0, index), null, ...state.anchors.slice(index)]

    set({
      points,
      anchors,
      vertexDrag: {
        owner,
        index,
        originalPoint: clonePoint(midpoint),
        originalAnchor: null,
        inserted: true,
      },
      hover: null,
      hoverOwner: null,
      axisGuide: null,
      error: null,
    })
    return true
  },

  updateDraggedVertex: (owner, hover, axisGuide = null) => {
    const state = get()
    const drag = state.vertexDrag
    if (
      !drag ||
      drag.owner !== owner ||
      state.levelId !== useViewer.getState().selection.levelId ||
      state.stage !== 'collecting' ||
      ![...hover.point, ...hover.normal].every(Number.isFinite)
    ) {
      return false
    }

    const points = state.points.map((point, index) =>
      index === drag.index ? clonePoint(hover.point) : point,
    )
    const anchors = state.anchors.map((anchor, index) =>
      index === drag.index ? (hover.anchor ?? null) : anchor,
    )
    set({
      points,
      anchors,
      hover: {
        point: clonePoint(hover.point),
        normal: clonePoint(hover.normal),
        targetNodeId: hover.targetNodeId,
        anchor: hover.anchor,
        semantic: hover.semantic,
      },
      hoverOwner: owner,
      axisGuide: axisGuide
        ? {
            axis: axisGuide.axis,
            from: clonePoint(axisGuide.from),
            to: clonePoint(axisGuide.to),
            snapped: axisGuide.snapped,
          }
        : null,
      error: null,
    })
    return true
  },

  finishVertexDrag: (owner) => {
    const drag = get().vertexDrag
    if (!drag || drag.owner !== owner) return false
    set({ vertexDrag: null, hover: null, hoverOwner: null, axisGuide: null, error: null })
    return true
  },

  cancelVertexDrag: (owner) => {
    const state = get()
    const drag = state.vertexDrag
    if (!drag || drag.owner !== owner) return false
    const points = drag.inserted
      ? state.points.filter((_, index) => index !== drag.index)
      : state.points.map((point, index) =>
          index === drag.index ? clonePoint(drag.originalPoint) : point,
        )
    const anchors = drag.inserted
      ? state.anchors.filter((_, index) => index !== drag.index)
      : state.anchors.map((anchor, index) => (index === drag.index ? drag.originalAnchor : anchor))
    set({
      points,
      anchors,
      vertexDrag: null,
      hover: null,
      hoverOwner: null,
      axisGuide: null,
      error: null,
    })
    return true
  },

  addPoint: (owner, point, anchor) => {
    const state = get()
    const activeLevelId = useViewer.getState().selection.levelId
    if (!activeLevelId) return false
    if (state.stage !== 'collecting' || state.vertexDrag || (state.owner && state.owner !== owner))
      return false
    if (state.levelId && state.levelId !== activeLevelId) {
      set({ error: 'The active level changed. Start a new measurement.' })
      return false
    }
    if (state.kind === 'distance' && state.points.length >= 2) return false
    if (state.kind === 'angle' && state.points.length >= 3) return false

    const points = [...state.points, clonePoint(point)]
    const anchors = [...state.anchors, anchor ?? null]
    const ready =
      (state.kind === 'distance' && points.length === 2) ||
      (state.kind === 'angle' && points.length === 3)
    set({
      owner,
      levelId: state.levelId ?? activeLevelId,
      points,
      anchors,
      stage: ready ? 'ready' : 'collecting',
      hover: null,
      hoverOwner: null,
      axisGuide: null,
      error: null,
    })
    return true
  },

  closeBase: (owner, preferredNormal) => {
    const state = get()
    if (
      state.owner !== owner ||
      state.levelId !== useViewer.getState().selection.levelId ||
      state.stage !== 'collecting' ||
      state.vertexDrag ||
      state.kind === 'distance' ||
      state.kind === 'angle' ||
      state.points.length < 3
    ) {
      return false
    }

    if (!areMeasurementPointsCoplanar(state.points, MEASUREMENT_PLANAR_TOLERANCE)) {
      set({ error: 'Measurement points must be on one plane.' })
      return false
    }

    let normal = measurementNormal(state.points)
    if (!normal) {
      set({ error: 'Measurement points must enclose an area.' })
      return false
    }
    if (
      preferredNormal &&
      normal[0] * preferredNormal[0] +
        normal[1] * preferredNormal[1] +
        normal[2] * preferredNormal[2] <
        0
    ) {
      normal = [
        normal[0] === 0 ? 0 : -normal[0],
        normal[1] === 0 ? 0 : -normal[1],
        normal[2] === 0 ? 0 : -normal[2],
      ]
    }

    set({
      baseNormal: clonePoint(normal),
      stage: state.kind === 'volume' ? 'extruding' : 'ready',
      hover: null,
      hoverOwner: null,
      axisGuide: null,
      error: null,
    })
    return true
  },

  setExtrusionHeight: (owner, height) => {
    const state = get()
    if (
      state.owner !== owner ||
      state.levelId !== useViewer.getState().selection.levelId ||
      state.stage !== 'extruding' ||
      !Number.isFinite(height)
    ) {
      return false
    }
    set({ extrusionHeight: height, error: null })
    return true
  },

  finishExtrusion: (owner) => {
    const state = get()
    if (
      state.owner !== owner ||
      state.levelId !== useViewer.getState().selection.levelId ||
      state.stage !== 'extruding' ||
      Math.abs(state.extrusionHeight) < MIN_EXTRUSION
    ) {
      return false
    }
    set({ stage: 'ready', hover: null, hoverOwner: null, axisGuide: null, error: null })
    return true
  },

  removeLast: (owner) => {
    const state = get()
    if (
      state.owner !== owner ||
      state.levelId !== useViewer.getState().selection.levelId ||
      state.vertexDrag ||
      state.points.length === 0
    ) {
      return false
    }

    const points = state.points.slice(0, -1)
    const anchors = state.anchors.slice(0, -1)
    set({
      owner: points.length > 0 ? owner : null,
      levelId: points.length > 0 ? state.levelId : null,
      stage: 'collecting',
      points,
      anchors,
      hover: null,
      hoverOwner: null,
      axisGuide: null,
      baseNormal: null,
      extrusionHeight: 0,
      error: null,
    })
    return true
  },

  getCommitPayload: (owner) => {
    const state = get()
    return state.owner === owner && state.levelId === useViewer.getState().selection.levelId
      ? payloadFor(state)
      : null
  },

  reset: () => set((state) => ({ ...idleState(state.kind) })),
}))

export function commitMeasurementDraft(owner: MeasurementDraftOwner): MeasurementNode['id'] | null {
  const draft = useMeasurementDraft.getState()
  const levelId = draft.levelId
  if (!levelId || useViewer.getState().selection.levelId !== levelId) {
    draft.reset()
    return null
  }
  const measurement = draft.getCommitPayload(owner)
  if (!measurement) return null

  const { createNode, nodes } = useScene.getState()
  const count = Object.values(nodes).filter((node) => node.type === 'measurement').length
  const node = MeasurementNode.parse({ name: `Measurement ${count + 1}`, measurement })
  createNode(node, levelId)
  draft.reset()
  return node.id
}

export function finishMeasurementDraft(
  owner: MeasurementDraftOwner,
  preferredNormal?: MeasurementPoint,
): boolean {
  const draft = useMeasurementDraft.getState()
  if (draft.stage === 'collecting') {
    if (draft.kind === 'distance' || draft.kind === 'angle') return false
    if (!draft.closeBase(owner, preferredNormal)) return false
    if (draft.kind === 'area' || draft.kind === 'perimeter') {
      return commitMeasurementDraft(owner) !== null
    }
    return true
  }
  if (draft.stage === 'extruding') {
    if (!draft.finishExtrusion(owner)) return false
  }
  return commitMeasurementDraft(owner) !== null
}
