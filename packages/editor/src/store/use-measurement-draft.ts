'use client'

import {
  areMeasurementPointsCoplanar,
  MEASUREMENT_PLANAR_TOLERANCE,
  MeasurementNode,
  measurementNormal,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { create } from 'zustand'

export type MeasurementKind = 'distance' | 'area' | 'volume'
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
}

export type MeasurementVertexDrag = {
  owner: MeasurementDraftOwner
  index: number
  originalPoint: MeasurementPoint
  inserted: boolean
}

export type MeasurementDraftPayload =
  | { kind: 'distance'; points: [MeasurementPoint, MeasurementPoint] }
  | { kind: 'area'; base: MeasurementPoint[] }
  | { kind: 'volume'; base: MeasurementPoint[]; extrusion: MeasurementPoint }

type MeasurementDraftState = {
  kind: MeasurementKind
  owner: MeasurementDraftOwner | null
  levelId: string | null
  stage: MeasurementDraftStage
  points: MeasurementPoint[]
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
  addPoint(owner: MeasurementDraftOwner, point: MeasurementPoint): boolean
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

  if (state.kind === 'distance') {
    const [start, end] = state.points
    if (!(start && end)) return null
    return { kind: 'distance', points: [clonePoint(start), clonePoint(end)] }
  }

  if (state.kind === 'area') {
    if (state.points.length < 3) return null
    return { kind: 'area', base: state.points.map(clonePoint) }
  }

  if (!(state.baseNormal && state.points.length >= 3)) return null
  return {
    kind: 'volume',
    base: state.points.map(clonePoint),
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
      vertexDrag: { owner, index, originalPoint: clonePoint(point), inserted: false },
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

    set({
      points,
      vertexDrag: { owner, index, originalPoint: clonePoint(midpoint), inserted: true },
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
    set({
      points,
      hover: {
        point: clonePoint(hover.point),
        normal: clonePoint(hover.normal),
        targetNodeId: hover.targetNodeId,
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
    set({
      points,
      vertexDrag: null,
      hover: null,
      hoverOwner: null,
      axisGuide: null,
      error: null,
    })
    return true
  },

  addPoint: (owner, point) => {
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

    const points = [...state.points, clonePoint(point)]
    set({
      owner,
      levelId: state.levelId ?? activeLevelId,
      points,
      stage: state.kind === 'distance' && points.length === 2 ? 'ready' : 'collecting',
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
    set({
      owner: points.length > 0 ? owner : null,
      levelId: points.length > 0 ? state.levelId : null,
      stage: 'collecting',
      points,
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
