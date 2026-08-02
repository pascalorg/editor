'use client'

import {
  type AnyNode,
  type AnyNodeId,
  closestMeasurementFeatureBinding,
  collectAlignmentAnchors,
  emitter,
  type GeometryContext,
  type MeasurementFeatureAnchor,
  type MeasurementSnapKind,
  measurementAngle,
  measurementArea,
  measurementDistance,
  measurementFeatureLength,
  measurementPerimeter,
  measurementPrismVolume,
  nodeRegistry,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useState } from 'react'
import { measurementPolygonLabelAnchor } from '../../lib/measurement-label'
import {
  buildMeasurementAngleArcPoints,
  formatAreaLabel,
  formatLinearMeasurement,
  formatVolumeLabel,
  getLinearUnitLabel,
  linearUnitToMeters,
  MEASUREMENT_ACTIVE_COLOR,
  metersToLinearUnit,
} from '../../lib/measurements'
import {
  clearSurfacePlanSnapFeedback,
  resolveSurfacePlanPointSnap,
} from '../../lib/surface-plan-snap'
import useEditor from '../../store/use-editor'
import {
  commitMeasurementDraft,
  type MeasurementAxisGuide,
  type MeasurementPoint,
  measurementPolygonMidpoints,
  useMeasurementDraft,
} from '../../store/use-measurement-draft'
import { formatAngleRadians } from '../tools/shared/segment-angle'
import { FloorplanQuickMeasureLayer } from './floorplan-quick-measure-layer'
import { useFloorplanRender } from './floorplan-render-context'
import { resolveFloorplanLabelAngle } from './renderers/floorplan-label-angle'

const DRAFT_COLOR = MEASUREMENT_ACTIVE_COLOR
const X_AXIS_COLOR = '#ef4444'
const Z_AXIS_COLOR = '#3b82f6'
const RETICLE_COLOR = MEASUREMENT_ACTIVE_COLOR
const AXIS_SNAP_DISTANCE_PX = 16
const AXIS_SNAP_RELEASE_DISTANCE_PX = 24
const PROXIMITY_GUIDE_DISTANCE_PX = 40
const VERTEX_HANDLE_DISTANCE_PX = 12
const MIDPOINT_HANDLE_DISTANCE_PX = 10
const VERTEX_DRAG_ACTIVATION_PX = 4
const AXIS_GUIDE_HALF_LENGTH_PX = 1_200

type PlanPoint = { x: number; z: number }
type ProjectedSnapPoint = PlanPoint & { nodeId: string }
type ProjectedSnapSegment = {
  start: ProjectedSnapPoint
  end: ProjectedSnapPoint
  nodeId: string
}

export type ProjectedFloorplanSnap = {
  kind: 'vertex' | 'edge'
  nodeId: string
  point: PlanPoint
}

const MAX_REGISTERED_SNAP_ELEMENTS = 512
const MAX_REGISTERED_SNAP_SEGMENTS = 4096
const MAX_SAMPLED_PATH_SEGMENTS = 48
const VERTEX_SNAP_DISTANCE_PX = 16
const EDGE_SNAP_DISTANCE_PX = 10
const SEMANTIC_FEATURE_SNAP_DISTANCE = 0.2
// Alt-bypass association mirrors the 3D tool's surface-verify tolerance: a
// feature binds only when the point already sits on it, never by attraction.
const SEMANTIC_FEATURE_BYPASS_DISTANCE = 0.012

function measurementGeometryContext(
  node: AnyNode,
  nodes: Record<AnyNodeId, AnyNode>,
): GeometryContext {
  const resolve: GeometryContext['resolve'] = <N = AnyNode>(id: AnyNodeId) =>
    nodes[id] as N | undefined
  const childIds =
    'children' in node && Array.isArray(node.children) ? (node.children as AnyNodeId[]) : []
  const children = childIds
    .map((id) => nodes[id])
    .filter((child): child is AnyNode => child !== undefined)
  const parent = node.parentId ? (nodes[node.parentId as AnyNodeId] ?? null) : null
  const siblings =
    parent && 'children' in parent && Array.isArray(parent.children)
      ? (parent.children as AnyNodeId[])
          .map((id) => nodes[id])
          .filter(
            (sibling): sibling is AnyNode => sibling !== undefined && sibling.type === node.type,
          )
      : []
  return { resolve, children, parent, siblings }
}

function associatePlanPoint(
  point: MeasurementPoint,
  targetNodeId: string | null,
  maxDistance = SEMANTIC_FEATURE_SNAP_DISTANCE,
): {
  point: MeasurementPoint
  anchor?: MeasurementFeatureAnchor
  semantic?: { label: string; length: number | null; snapKind: MeasurementSnapKind }
} {
  if (!targetNodeId) return { point }
  const nodes = useScene.getState().nodes
  const node = nodes[targetNodeId as AnyNodeId]
  const contribution = node ? nodeRegistry.get(node.type)?.measurement : undefined
  if (!(node && contribution)) return { point }
  const context = measurementGeometryContext(node, nodes)
  const features = contribution.features(node, context)
  const match =
    contribution.match?.(node, context, point, maxDistance) ??
    closestMeasurementFeatureBinding(features, point, maxDistance)
  if (!match) return { point }
  const reference = {
    nodeId: node.id,
    featureId: match.featureId,
    parameters: match.parameters,
  }
  const feature =
    contribution.resolve?.(node, context, reference) ??
    features.find((candidate) => candidate.id === match.featureId) ??
    null
  return {
    point: match.point,
    anchor: {
      kind: 'feature',
      reference,
      fallback: match.point,
    },
    semantic: feature
      ? {
          label: feature.label,
          length: measurementFeatureLength(feature),
          snapKind: feature.snapKind,
        }
      : undefined,
  }
}

function closestPointOnScreenSegment(
  point: PlanPoint,
  start: PlanPoint,
  end: PlanPoint,
): PlanPoint {
  const dx = end.x - start.x
  const dz = end.z - start.z
  const lengthSquared = dx * dx + dz * dz
  if (lengthSquared < 1e-9) return { ...start }
  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared),
  )
  return { x: start.x + dx * t, z: start.z + dz * t }
}

export function resolveProjectedFloorplanSnap(
  pointer: PlanPoint,
  vertices: readonly ProjectedSnapPoint[],
  segments: readonly ProjectedSnapSegment[],
  vertexThreshold = VERTEX_SNAP_DISTANCE_PX,
  edgeThreshold = EDGE_SNAP_DISTANCE_PX,
): ProjectedFloorplanSnap | null {
  let nearestVertex: { candidate: ProjectedSnapPoint; distance: number } | null = null
  for (const candidate of vertices) {
    const distance = Math.hypot(pointer.x - candidate.x, pointer.z - candidate.z)
    if (distance <= vertexThreshold && (!nearestVertex || distance < nearestVertex.distance)) {
      nearestVertex = { candidate, distance }
    }
  }
  if (nearestVertex) {
    return {
      kind: 'vertex',
      nodeId: nearestVertex.candidate.nodeId,
      point: { x: nearestVertex.candidate.x, z: nearestVertex.candidate.z },
    }
  }

  let nearestEdge: { nodeId: string; point: PlanPoint; distance: number } | null = null
  for (const segment of segments) {
    const projected = closestPointOnScreenSegment(pointer, segment.start, segment.end)
    const distance = Math.hypot(pointer.x - projected.x, pointer.z - projected.z)
    if (distance <= edgeThreshold && (!nearestEdge || distance < nearestEdge.distance)) {
      nearestEdge = { nodeId: segment.nodeId, point: projected, distance }
    }
  }
  return nearestEdge ? { kind: 'edge', nodeId: nearestEdge.nodeId, point: nearestEdge.point } : null
}

export function isProjectedFloorplanAxisPointVerified(
  candidate: PlanPoint,
  nodeId: string,
  vertices: readonly ProjectedSnapPoint[],
  segments: readonly ProjectedSnapSegment[],
  tolerance = 1.5,
): boolean {
  const resolved = resolveProjectedFloorplanSnap(
    candidate,
    vertices.filter((vertex) => vertex.nodeId === nodeId),
    segments.filter((segment) => segment.nodeId === nodeId),
    tolerance,
    tolerance,
  )
  return Boolean(
    resolved &&
      resolved.nodeId === nodeId &&
      Math.hypot(candidate.x - resolved.point.x, candidate.z - resolved.point.z) <= tolerance,
  )
}

function screenPointForElement(
  element: SVGGeometryElement,
  nodeId: string,
  x: number,
  z: number,
): ProjectedSnapPoint | null {
  const matrix = element.getScreenCTM()
  if (!matrix) return null
  const point = new DOMPoint(x, z).matrixTransform(matrix)
  return { x: point.x, z: point.y, nodeId }
}

function collectRegisteredFloorplanSnapGeometry(svg: SVGSVGElement): {
  vertices: ProjectedSnapPoint[]
  segments: ProjectedSnapSegment[]
} {
  const vertices: ProjectedSnapPoint[] = []
  const segments: ProjectedSnapSegment[] = []
  const nodes = useScene.getState().nodes as Record<
    string,
    { type: string; visible?: boolean } | undefined
  >
  const entries = svg.querySelectorAll<SVGGElement>(
    '.floorplan-registry-base .floorplan-registry-entry[data-node-id]',
  )
  let elementCount = 0

  const addSegment = (start: ProjectedSnapPoint | null, end: ProjectedSnapPoint | null) => {
    if (!(start && end) || segments.length >= MAX_REGISTERED_SNAP_SEGMENTS) return
    segments.push({ start, end, nodeId: start.nodeId })
  }

  for (const entry of entries) {
    const nodeId = entry.dataset.nodeId
    const node = nodeId ? nodes[nodeId] : null
    if (
      !nodeId ||
      !node ||
      node.visible === false ||
      node.type === 'measurement' ||
      node.type === 'guide' ||
      node.type === 'scan'
    ) {
      continue
    }

    const geometry = entry.querySelectorAll<SVGGeometryElement>(
      'line, polyline, polygon, rect, path, circle, ellipse',
    )
    for (const element of geometry) {
      if (elementCount >= MAX_REGISTERED_SNAP_ELEMENTS) break
      elementCount += 1
      const tag = element.tagName.toLowerCase()

      if (tag === 'line') {
        const line = element as SVGLineElement
        const start = screenPointForElement(
          element,
          nodeId,
          line.x1.baseVal.value,
          line.y1.baseVal.value,
        )
        const end = screenPointForElement(
          element,
          nodeId,
          line.x2.baseVal.value,
          line.y2.baseVal.value,
        )
        if (start) vertices.push(start)
        if (end) vertices.push(end)
        addSegment(start, end)
        continue
      }

      if (tag === 'polyline' || tag === 'polygon') {
        const poly = element as SVGPolylineElement | SVGPolygonElement
        const points: ProjectedSnapPoint[] = []
        for (let index = 0; index < poly.points.numberOfItems; index += 1) {
          const item = poly.points.getItem(index)
          const point = screenPointForElement(element, nodeId, item.x, item.y)
          if (point) points.push(point)
        }
        vertices.push(...points)
        for (let index = 1; index < points.length; index += 1) {
          addSegment(points[index - 1]!, points[index]!)
        }
        if (tag === 'polygon' && points.length >= 3) addSegment(points.at(-1)!, points[0]!)
        continue
      }

      if (tag === 'rect') {
        const rect = element as SVGRectElement
        const x = rect.x.baseVal.value
        const z = rect.y.baseVal.value
        const width = rect.width.baseVal.value
        const height = rect.height.baseVal.value
        const points = [
          screenPointForElement(element, nodeId, x, z),
          screenPointForElement(element, nodeId, x + width, z),
          screenPointForElement(element, nodeId, x + width, z + height),
          screenPointForElement(element, nodeId, x, z + height),
        ].filter((point): point is ProjectedSnapPoint => point !== null)
        vertices.push(...points)
        if (points.length === 4) {
          for (let index = 0; index < points.length; index += 1) {
            addSegment(points[index]!, points[(index + 1) % points.length]!)
          }
        }
        continue
      }

      let length = 0
      try {
        length = element.getTotalLength()
      } catch {
        continue
      }
      if (!(Number.isFinite(length) && length > 0)) continue
      const segmentCount = Math.min(
        MAX_SAMPLED_PATH_SEGMENTS,
        Math.max(8, Math.ceil(length / 0.25)),
      )
      let previous: ProjectedSnapPoint | null = null
      for (let index = 0; index <= segmentCount; index += 1) {
        const sample = element.getPointAtLength((length * index) / segmentCount)
        const point = screenPointForElement(element, nodeId, sample.x, sample.y)
        if (previous && point) addSegment(previous, point)
        if (tag === 'path' && (index === 0 || index === segmentCount) && point) {
          vertices.push(point)
        }
        previous = point
      }
    }
    if (elementCount >= MAX_REGISTERED_SNAP_ELEMENTS) break
  }

  return { vertices, segments }
}

export function resolveFloorplanMeasurementAxisSnap(
  raw: MeasurementPoint,
  anchor: MeasurementPoint,
  xAxisScreenDistance: number,
  zAxisScreenDistance: number,
  threshold = AXIS_SNAP_DISTANCE_PX,
  lockedAxis: 'x' | 'z' | null = null,
  releaseThreshold = AXIS_SNAP_RELEASE_DISTANCE_PX,
  proximity = false,
): { point: MeasurementPoint; guide: MeasurementAxisGuide } {
  const candidates = [
    {
      axis: 'x' as const,
      screenDistance: xAxisScreenDistance,
      to: [raw[0], anchor[1], anchor[2]] as MeasurementPoint,
    },
    {
      axis: 'z' as const,
      screenDistance: zAxisScreenDistance,
      to: [anchor[0], anchor[1], raw[2]] as MeasurementPoint,
    },
  ]
  const locked = lockedAxis
    ? candidates.find(
        (candidate) =>
          candidate.axis === lockedAxis && candidate.screenDistance <= releaseThreshold,
      )
    : null
  const closest = candidates.reduce((best, candidate) =>
    candidate.screenDistance < best.screenDistance ? candidate : best,
  )
  const selected = locked ?? (closest.screenDistance <= threshold ? closest : null)
  const guideCandidate = selected ?? closest
  return {
    point: selected ? [...selected.to] : [...raw],
    guide: {
      axis: guideCandidate.axis,
      from: [...anchor],
      to: [...guideCandidate.to],
      snapped: selected !== null,
      ...(proximity ? { proximity: true } : {}),
    },
  }
}

function isMeasurementKind(
  value: unknown,
): value is 'distance' | 'angle' | 'area' | 'perimeter' | 'volume' {
  return (
    value === 'distance' ||
    value === 'angle' ||
    value === 'area' ||
    value === 'perimeter' ||
    value === 'volume'
  )
}

function clientToPlanPoint(group: SVGGElement, clientX: number, clientY: number): PlanPoint | null {
  const matrix = group.getScreenCTM()
  if (!matrix) return null
  const local = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse())
  return { x: local.x, z: local.y }
}

function planPointToClient(group: SVGGElement, point: MeasurementPoint): DOMPoint | null {
  const matrix = group.getScreenCTM()
  if (!matrix) return null
  return new DOMPoint(point[0], point[2]).matrixTransform(matrix)
}

function screenDistanceToPlanPoint(
  group: SVGGElement,
  point: MeasurementPoint,
  clientX: number,
  clientY: number,
): number {
  const screen = planPointToClient(group, point)
  return screen ? Math.hypot(clientX - screen.x, clientY - screen.y) : Number.POSITIVE_INFINITY
}

function snapPlanPoint(
  group: SVGGElement,
  raw: MeasurementPoint,
  anchors: readonly MeasurementPoint[],
  clientX: number,
  clientY: number,
  allowAxisSnap = true,
  lockedGuide: MeasurementAxisGuide | null = null,
  proximityAnchors: readonly MeasurementPoint[] = [],
): { point: MeasurementPoint; guide: MeasurementAxisGuide | null } {
  if (anchors.length === 0 && proximityAnchors.length === 0) return { point: raw, guide: null }
  const candidates = [
    ...anchors.map((anchor) => ({ anchor, proximity: false })),
    ...proximityAnchors.map((anchor) => ({ anchor, proximity: true })),
  ].flatMap(({ anchor, proximity }) => {
    const xPoint: MeasurementPoint = [raw[0], anchor[1], anchor[2]]
    const zPoint: MeasurementPoint = [anchor[0], anchor[1], raw[2]]
    return [
      {
        anchor,
        axis: 'x' as const,
        point: xPoint,
        proximity,
        screenDistance: screenDistanceToPlanPoint(group, xPoint, clientX, clientY),
      },
      {
        anchor,
        axis: 'z' as const,
        point: zPoint,
        proximity,
        screenDistance: screenDistanceToPlanPoint(group, zPoint, clientX, clientY),
      },
    ]
  })
  const threshold = allowAxisSnap ? AXIS_SNAP_DISTANCE_PX : -1
  const releaseThreshold = allowAxisSnap ? AXIS_SNAP_RELEASE_DISTANCE_PX : -1
  const locked = lockedGuide
    ? candidates.reduce<(typeof candidates)[number] | null>((best, candidate) => {
        if (
          candidate.axis !== lockedGuide.axis ||
          candidate.proximity !== Boolean(lockedGuide.proximity) ||
          candidate.anchor.some(
            (value, index) => Math.abs(value - lockedGuide.from[index]!) > 1e-9,
          ) ||
          candidate.screenDistance > releaseThreshold
        )
          return best
        return !best || candidate.screenDistance < best.screenDistance ? candidate : best
      }, null)
    : null
  const closest = candidates
    .filter(
      (candidate) =>
        !candidate.proximity || candidate.screenDistance <= PROXIMITY_GUIDE_DISTANCE_PX,
    )
    .reduce<(typeof candidates)[number] | null>(
      (best, candidate) =>
        !best || candidate.screenDistance < best.screenDistance ? candidate : best,
      null,
    )
  if (!closest) return { point: raw, guide: null }
  const selected = locked ?? (closest.screenDistance <= threshold ? closest : null)
  const guideCandidate = selected ?? closest
  return {
    point: selected ? [...selected.point] : [...raw],
    guide: {
      axis: guideCandidate.axis,
      from: [...guideCandidate.anchor],
      to: [...guideCandidate.point],
      snapped: selected !== null,
      ...(guideCandidate.proximity ? { proximity: true } : {}),
    },
  }
}

function measurementVertexSnapAnchors(
  points: readonly MeasurementPoint[],
  index: number,
  polygon: boolean,
): MeasurementPoint[] {
  if (!Number.isInteger(index) || index < 0 || index >= points.length || points.length < 2)
    return []
  const neighborIndices =
    polygon && points.length >= 3
      ? [(index - 1 + points.length) % points.length, (index + 1) % points.length]
      : [index - 1, index + 1]
  return Array.from(new Set(neighborIndices))
    .filter(
      (neighborIndex) =>
        neighborIndex >= 0 && neighborIndex < points.length && neighborIndex !== index,
    )
    .map((neighborIndex) => [...points[neighborIndex]!] as MeasurementPoint)
}

function closeBaseAndMaybeCommit(): boolean {
  const draft = useMeasurementDraft.getState()
  if (draft.kind === 'distance' || draft.kind === 'angle') return false
  if (!draft.closeBase('2d', [0, 1, 0])) return false
  if (draft.kind === 'area' || draft.kind === 'perimeter') commitMeasurementDraft('2d')
  return true
}

function isExtrusionControlTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element && target.closest('[data-measurement-extrusion-control]') !== null
  )
}

function FloorplanDraftLabel({
  angle = 0,
  appearance = 'plate',
  background,
  border,
  offsetPx = 0,
  point,
  sceneRotationDeg,
  screenUpright = false,
  text,
  textColor,
  unitsPerPixel,
}: {
  angle?: number
  appearance?: 'plate' | 'outlined'
  background: string
  border: string
  offsetPx?: number
  point: MeasurementPoint
  sceneRotationDeg: number
  screenUpright?: boolean
  text: string
  textColor: string
  unitsPerPixel: number
}) {
  const labelUnitsPerPixel = Math.max(unitsPerPixel, 1e-6)
  const fontSize = labelUnitsPerPixel * (appearance === 'outlined' ? 12 : 10)
  const padX = labelUnitsPerPixel * 6
  const padY = labelUnitsPerPixel * 3
  const plateWidth = text.length * labelUnitsPerPixel * 6.2 + padX * 2
  const plateHeight = fontSize + padY * 2
  const localAngleDeg = resolveFloorplanLabelAngle(angle, sceneRotationDeg, screenUpright)

  return (
    <g
      pointerEvents="none"
      transform={`translate(${point[0]} ${point[2]}) rotate(${localAngleDeg}) translate(0 ${-offsetPx * labelUnitsPerPixel})`}
    >
      {appearance === 'outlined' ? null : (
        <rect
          fill={background}
          height={plateHeight}
          opacity={0.94}
          rx={labelUnitsPerPixel * 4}
          ry={labelUnitsPerPixel * 4}
          stroke={border}
          strokeWidth={labelUnitsPerPixel * 0.7}
          vectorEffect="non-scaling-stroke"
          width={plateWidth}
          x={-plateWidth / 2}
          y={-plateHeight / 2}
        />
      )}
      <text
        dominantBaseline="middle"
        fill={appearance === 'outlined' ? '#ffffff' : textColor}
        fontFamily={
          appearance === 'outlined'
            ? 'system-ui, -apple-system, sans-serif'
            : 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
        }
        fontSize={fontSize}
        fontWeight={appearance === 'outlined' ? '500' : '600'}
        paintOrder={appearance === 'outlined' ? 'stroke' : undefined}
        stroke={appearance === 'outlined' ? border : undefined}
        strokeLinecap={appearance === 'outlined' ? 'round' : undefined}
        strokeLinejoin={appearance === 'outlined' ? 'round' : undefined}
        strokeWidth={appearance === 'outlined' ? fontSize * 0.35 : undefined}
        textAnchor="middle"
      >
        {text}
      </text>
    </g>
  )
}

function FloorplanExtrusionControl({
  center,
  sceneRotationDeg,
  unitsPerPixel,
}: {
  center: MeasurementPoint
  sceneRotationDeg: number
  unitsPerPixel: number
}) {
  const unit = useViewer((state) => state.unit)
  const extrusionHeight = useMeasurementDraft((state) => state.extrusionHeight)
  const points = useMeasurementDraft((state) => state.points)
  const baseNormal = useMeasurementDraft((state) => state.baseNormal)
  const [value, setValue] = useState(() =>
    extrusionHeight === 0 ? '' : String(metersToLinearUnit(extrusionHeight, unit)),
  )

  useEffect(() => {
    const height = useMeasurementDraft.getState().extrusionHeight
    setValue(height === 0 ? '' : String(Number(metersToLinearUnit(height, unit).toFixed(3))))
  }, [unit])

  const width = 260 * unitsPerPixel
  const height = 72 * unitsPerPixel
  const x = center[0] - width / 2
  const y = center[2] - height / 2

  const commit = () => {
    const numericValue = Number.parseFloat(value)
    if (!Number.isFinite(numericValue)) {
      useMeasurementDraft.getState().setExtrusionHeight('2d', 0)
      return
    }
    useMeasurementDraft.getState().setExtrusionHeight('2d', linearUnitToMeters(numericValue, unit))
    const draft = useMeasurementDraft.getState()
    if (draft.finishExtrusion('2d')) commitMeasurementDraft('2d')
  }
  const extrusion: MeasurementPoint = baseNormal
    ? [
        baseNormal[0] * extrusionHeight,
        baseNormal[1] * extrusionHeight,
        baseNormal[2] * extrusionHeight,
      ]
    : [0, 0, 0]
  const volumeLabel = formatVolumeLabel(measurementPrismVolume(points, extrusion), unit)

  return (
    <g transform={`rotate(${-sceneRotationDeg} ${center[0]} ${center[2]})`}>
      <foreignObject
        data-measurement-extrusion-control
        height={height}
        overflow="visible"
        pointerEvents="auto"
        width={width}
        x={x}
        y={y}
      >
        <div
          className="flex h-full w-full items-center gap-1.5 rounded-md border border-border/70 bg-background/95 p-1.5 text-foreground shadow-lg"
          data-measurement-extrusion-control
          onClick={(event) => {
            event.stopPropagation()
            event.nativeEvent.stopImmediatePropagation()
          }}
          onPointerDown={(event) => {
            event.stopPropagation()
            event.nativeEvent.stopImmediatePropagation()
          }}
        >
          <label className="sr-only" htmlFor="measurement-extrusion-height">
            Extrusion height
          </label>
          <div className="relative min-w-0 flex-1">
            <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center font-medium text-muted-foreground text-xs">
              H
            </span>
            <input
              aria-label="Extrusion height"
              className="h-8 w-full rounded-md border border-border bg-background pr-7 pl-6 text-sm outline-none focus:border-cyan-400"
              id="measurement-extrusion-height"
              inputMode="decimal"
              onChange={(event) => {
                const next = event.target.value
                setValue(next)
                const numericValue = Number.parseFloat(next)
                if (Number.isFinite(numericValue)) {
                  useMeasurementDraft
                    .getState()
                    .setExtrusionHeight('2d', linearUnitToMeters(numericValue, unit))
                } else {
                  useMeasurementDraft.getState().setExtrusionHeight('2d', 0)
                }
              }}
              onKeyDown={(event) => {
                event.stopPropagation()
                if (event.key === 'Enter') {
                  event.preventDefault()
                  commit()
                }
              }}
              placeholder="0"
              step="0.1"
              type="number"
              value={value}
            />
            <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-muted-foreground text-xs">
              {getLinearUnitLabel(unit)}
            </span>
          </div>
          <span className="shrink-0 font-mono font-semibold text-[11px] tabular-nums text-foreground">
            V {volumeLabel}
          </span>
          <button
            className="h-8 shrink-0 rounded-full bg-cyan-500 px-3 font-medium text-black text-xs disabled:cursor-not-allowed disabled:opacity-40"
            disabled={Math.abs(extrusionHeight) < 0.001}
            onClick={commit}
            type="button"
          >
            Create
          </button>
        </div>
      </foreignObject>
    </g>
  )
}

export function FloorplanMeasurementToolLayer() {
  const groupRef = useRef<SVGGElement>(null)
  const vertexGesture = useRef<{
    pointerId: number
    source: 'vertex' | 'midpoint'
    index: number
    startX: number
    startY: number
    engaged: boolean
    previousInputDragging: boolean
    previousCursor: string
  } | null>(null)
  const suppressNextClick = useRef(false)
  const cancelVertexGesture = useRef<() => void>(() => {})
  const mode = useEditor((state) => state.mode)
  const tool = useEditor((state) => state.tool)
  const storedKind = useEditor((state) => state.toolDefaults.measurement?.kind)
  const kind = isMeasurementKind(storedKind) ? storedKind : 'distance'
  const smartActive = mode === 'build' && tool === 'measurement' && storedKind === 'smart'
  const active = mode === 'build' && tool === 'measurement' && isMeasurementKind(storedKind)
  const renderContext = useFloorplanRender()
  const points = useMeasurementDraft((state) => state.points)
  const hover = useMeasurementDraft((state) => state.hover)
  const hoverOwner = useMeasurementDraft((state) => state.hoverOwner)
  const owner = useMeasurementDraft((state) => state.owner)
  const stage = useMeasurementDraft((state) => state.stage)
  const axisGuide = useMeasurementDraft((state) => state.axisGuide)
  const vertexDrag = useMeasurementDraft((state) => state.vertexDrag)
  const baseNormal = useMeasurementDraft((state) => state.baseNormal)
  const extrusionHeight = useMeasurementDraft((state) => state.extrusionHeight)
  const error = useMeasurementDraft((state) => state.error)
  const draftLevelId = useMeasurementDraft((state) => state.levelId)
  const activeLevelId = useViewer((state) => state.selection.levelId)
  const unit = useViewer((state) => state.unit)
  const metricNotation = useViewer((state) => state.metricNotation)

  useEffect(() => {
    if (active) {
      cancelVertexGesture.current()
      useMeasurementDraft.getState().setKind(kind)
    }
  }, [active, kind])

  useEffect(() => {
    const draft = useMeasurementDraft.getState()
    if (draft.levelId && draft.levelId !== activeLevelId) {
      cancelVertexGesture.current()
      draft.reset()
    }
  }, [activeLevelId])

  useEffect(() => {
    const group = groupRef.current
    const svg = group?.ownerSVGElement
    if (!(active && group && svg) || owner === '3d') return
    let projectedGeometry:
      | (ReturnType<typeof collectRegisteredFloorplanSnapGeometry> & {
          proximityAnchors: MeasurementPoint[]
        })
      | null = null
    let projectedGeometryTimestamp = Number.NEGATIVE_INFINITY

    const getProjectedGeometry = () => {
      const now = performance.now()
      if (!projectedGeometry || now - projectedGeometryTimestamp > 120) {
        const geometry = collectRegisteredFloorplanSnapGeometry(svg)
        const seen = new Set<string>()
        const sceneAnchors = collectAlignmentAnchors(
          useScene.getState().nodes,
          '',
          activeLevelId,
        ).map(({ x, z }) => [x, 0, z] as MeasurementPoint)
        const proximityAnchors = [
          ...sceneAnchors,
          ...geometry.vertices.flatMap((vertex) => {
            const plan = clientToPlanPoint(group, vertex.x, vertex.z)
            if (!plan) return []
            return [[plan.x, 0, plan.z] as MeasurementPoint]
          }),
        ].filter((anchor) => {
          const key = `${Math.round(anchor[0] * 1_000)}:${Math.round(anchor[2] * 1_000)}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        projectedGeometry = { ...geometry, proximityAnchors }
        projectedGeometryTimestamp = now
      }
      return projectedGeometry
    }

    const consume = (event: MouseEvent | PointerEvent) => {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }

    const closestVertexIndex = (
      event: MouseEvent | PointerEvent,
      points: readonly MeasurementPoint[],
      threshold = VERTEX_HANDLE_DISTANCE_PX,
    ) => {
      let closestIndex: number | null = null
      let closestDistance = threshold
      for (let index = 0; index < points.length; index += 1) {
        const distance = screenDistanceToPlanPoint(
          group,
          points[index]!,
          event.clientX,
          event.clientY,
        )
        if (distance > closestDistance) continue
        closestDistance = distance
        closestIndex = index
      }
      return closestIndex
    }

    const resolveEventPoint = (
      event: MouseEvent | PointerEvent,
      anchorsOverride?: readonly MeasurementPoint[],
    ) => {
      const plan = clientToPlanPoint(group, event.clientX, event.clientY)
      if (!plan) return null
      const draft = useMeasurementDraft.getState()
      const projectedGeometry = getProjectedGeometry()
      const projectedSnap = resolveProjectedFloorplanSnap(
        { x: event.clientX, z: event.clientY },
        projectedGeometry.vertices,
        projectedGeometry.segments,
      )
      const projectedPlan = projectedSnap
        ? clientToPlanPoint(group, projectedSnap.point.x, projectedSnap.point.z)
        : null
      // Measurement anchors always bind to real geometry — the construction
      // snapping-mode chip doesn't govern this analysis tool. Alt bypasses,
      // including the projected registry-geometry pull.
      const surfaceSnap = resolveSurfacePlanPointSnap({
        rawPoint: [plan.x, plan.z],
        fallbackPoint:
          projectedPlan && !event.altKey ? [projectedPlan.x, projectedPlan.z] : [plan.x, plan.z],
        levelId: activeLevelId,
        align: false,
        magnetic: !event.altKey,
      })
      // A discrete wall snap (corner / midpoint / crossing) is the strongest
      // signal; a locked axis must not pull the point off it.
      const discreteWallSnap =
        surfaceSnap.wallSnap === 'endpoint' ||
        surfaceSnap.wallSnap === 'midpoint' ||
        surfaceSnap.wallSnap === 'intersection'
      const raw: MeasurementPoint = [surfaceSnap.point[0], 0, surfaceSnap.point[1]]
      const targetNodeId = surfaceSnap.wallIds[0] ?? projectedSnap?.nodeId ?? null
      const lastPoint = draft.points.at(-1)
      const resolved = snapPlanPoint(
        group,
        raw,
        anchorsOverride ?? (lastPoint ? [lastPoint] : []),
        event.clientX,
        event.clientY,
        !discreteWallSnap && !event.altKey,
        !event.altKey &&
          !discreteWallSnap &&
          draft.axisGuide?.snapped &&
          draft.axisGuide.axis !== 'y'
          ? draft.axisGuide
          : null,
        projectedGeometry.proximityAnchors,
      )
      if (targetNodeId && resolved.guide?.snapped) {
        const candidate = planPointToClient(group, resolved.point)
        if (
          !candidate ||
          !isProjectedFloorplanAxisPointVerified(
            { x: candidate.x, z: candidate.y },
            targetNodeId,
            projectedGeometry.vertices,
            projectedGeometry.segments,
          )
        ) {
          const surfaceOnly = snapPlanPoint(
            group,
            raw,
            anchorsOverride ?? (lastPoint ? [lastPoint] : []),
            event.clientX,
            event.clientY,
            false,
            null,
            projectedGeometry.proximityAnchors,
          )
          return { ...surfaceOnly, targetNodeId }
        }
      }
      return { ...resolved, targetNodeId }
    }

    const clearVertexGesture = (finish: boolean) => {
      const gesture = vertexGesture.current
      if (!gesture) return
      if (gesture.engaged) {
        const draft = useMeasurementDraft.getState()
        if (finish) draft.finishVertexDrag('2d')
        else draft.cancelVertexDrag('2d')
        useViewer.getState().setInputDragging(gesture.previousInputDragging)
      }
      document.body.style.cursor = gesture.previousCursor
      if (svg.hasPointerCapture?.(gesture.pointerId)) svg.releasePointerCapture(gesture.pointerId)
      vertexGesture.current = null
    }
    cancelVertexGesture.current = () => clearVertexGesture(false)

    const onPointerDown = (event: PointerEvent) => {
      const draft = useMeasurementDraft.getState()
      if (event.button !== 0 || (draft.owner && draft.owner !== '2d')) return
      if (isExtrusionControlTarget(event.target)) return
      consume(event)
      if (draft.owner !== '2d' || draft.stage !== 'collecting' || draft.vertexDrag) return
      if (draft.kind === 'distance') return
      const polygon = draft.kind === 'area' || draft.kind === 'perimeter' || draft.kind === 'volume'
      const threshold = event.pointerType === 'touch' ? 22 : VERTEX_HANDLE_DISTANCE_PX
      const vertexIndex = closestVertexIndex(event, draft.points, threshold)
      const midpointIndex =
        vertexIndex === null && polygon
          ? closestVertexIndex(
              event,
              measurementPolygonMidpoints(draft.points).map((midpoint) => midpoint.point),
              event.pointerType === 'touch' ? 18 : MIDPOINT_HANDLE_DISTANCE_PX,
            )
          : null
      if (vertexIndex === null && midpointIndex === null) return
      svg.setPointerCapture?.(event.pointerId)
      vertexGesture.current = {
        pointerId: event.pointerId,
        source: vertexIndex !== null ? 'vertex' : 'midpoint',
        index: vertexIndex ?? midpointIndex!,
        startX: event.clientX,
        startY: event.clientY,
        engaged: false,
        previousInputDragging: useViewer.getState().inputDragging,
        previousCursor: document.body.style.cursor,
      }
    }

    const onPointerMove = (event: PointerEvent) => {
      const draft = useMeasurementDraft.getState()
      if (draft.owner && draft.owner !== '2d') return

      const gesture = vertexGesture.current
      if (gesture?.pointerId === event.pointerId) {
        consume(event)
        if (!gesture.engaged) {
          if (
            Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) <
            VERTEX_DRAG_ACTIVATION_PX
          ) {
            return
          }
          const began =
            gesture.source === 'vertex'
              ? draft.beginVertexDrag('2d', gesture.index)
              : draft.beginMidpointVertexDrag('2d', gesture.index)
          if (!began) {
            clearVertexGesture(false)
            return
          }
          if (gesture.source === 'midpoint') gesture.index += 1
          gesture.engaged = true
          useViewer.getState().setInputDragging(true)
          document.body.style.cursor = 'grabbing'
        }

        const activeDraft = useMeasurementDraft.getState()
        const anchors = measurementVertexSnapAnchors(
          activeDraft.points,
          gesture.index,
          activeDraft.kind === 'area' ||
            activeDraft.kind === 'perimeter' ||
            activeDraft.kind === 'volume',
        )
        const resolved = resolveEventPoint(event, anchors)
        if (resolved) {
          const associated = associatePlanPoint(
            resolved.point,
            resolved.targetNodeId,
            event.altKey ? SEMANTIC_FEATURE_BYPASS_DISTANCE : SEMANTIC_FEATURE_SNAP_DISTANCE,
          )
          activeDraft.updateDraggedVertex(
            '2d',
            {
              point: associated.point,
              normal: [0, 1, 0],
              targetNodeId: resolved.targetNodeId,
              anchor: associated.anchor,
              semantic: associated.semantic,
            },
            resolved.guide,
          )
        }
        return
      }

      if (draft.stage !== 'collecting') return
      const resolved = resolveEventPoint(event)
      const associated = resolved
        ? associatePlanPoint(
            resolved.point,
            resolved.targetNodeId,
            event.altKey ? SEMANTIC_FEATURE_BYPASS_DISTANCE : SEMANTIC_FEATURE_SNAP_DISTANCE,
          )
        : null
      draft.setHover(
        '2d',
        resolved && associated
          ? {
              point: associated.point,
              normal: [0, 1, 0],
              targetNodeId: resolved.targetNodeId,
              anchor: associated.anchor,
              semantic: associated.semantic,
            }
          : null,
        resolved?.guide ?? null,
      )
    }

    const onPointerLeave = () => {
      if (vertexGesture.current) return
      clearSurfacePlanSnapFeedback()
      const draft = useMeasurementDraft.getState()
      if (!draft.owner || draft.owner === '2d') draft.setHover('2d', null)
    }

    const onPointerUp = (event: PointerEvent) => {
      const gesture = vertexGesture.current
      if (!gesture || gesture.pointerId !== event.pointerId) return
      consume(event)
      const wasEngaged = gesture.engaged
      const source = gesture.source
      const vertexIndex = gesture.index
      clearVertexGesture(true)
      if (!wasEngaged && source === 'vertex') {
        const draft = useMeasurementDraft.getState()
        if (vertexIndex === 0 && draft.points.length >= 3 && draft.kind !== 'angle') {
          closeBaseAndMaybeCommit()
        }
      }
      suppressNextClick.current = true
      setTimeout(() => {
        suppressNextClick.current = false
      }, 300)
    }

    const onPointerCancel = (event: PointerEvent) => {
      const gesture = vertexGesture.current
      if (!gesture || gesture.pointerId !== event.pointerId) return
      consume(event)
      clearVertexGesture(false)
      clearSurfacePlanSnapFeedback()
    }

    const onClick = (event: MouseEvent) => {
      const draft = useMeasurementDraft.getState()
      if (event.button !== 0 || (draft.owner && draft.owner !== '2d')) return
      if (isExtrusionControlTarget(event.target)) return
      consume(event)
      if (suppressNextClick.current) {
        suppressNextClick.current = false
        return
      }
      if (event.detail > 1 || draft.stage !== 'collecting') return

      const vertexIndex = draft.kind === 'distance' ? null : closestVertexIndex(event, draft.points)
      if (vertexIndex !== null) {
        if (vertexIndex === 0 && draft.points.length >= 3 && draft.kind !== 'angle') {
          closeBaseAndMaybeCommit()
        }
        return
      }
      const resolved = resolveEventPoint(event)
      if (!resolved) return
      const associated = associatePlanPoint(
        resolved.point,
        resolved.targetNodeId,
        event.altKey ? SEMANTIC_FEATURE_BYPASS_DISTANCE : SEMANTIC_FEATURE_SNAP_DISTANCE,
      )
      if (!draft.addPoint('2d', associated.point, associated.anchor)) return
      if (useMeasurementDraft.getState().stage === 'ready') commitMeasurementDraft('2d')
    }

    const onDoubleClick = (event: MouseEvent) => {
      const draft = useMeasurementDraft.getState()
      if (draft.owner !== '2d' || draft.stage !== 'collecting') return
      if (draft.kind === 'distance' || draft.kind === 'angle') return
      if (isExtrusionControlTarget(event.target)) return
      consume(event)
      if (suppressNextClick.current) {
        suppressNextClick.current = false
        return
      }
      closeBaseAndMaybeCommit()
    }

    const onBlur = () => {
      clearVertexGesture(false)
      clearSurfacePlanSnapFeedback()
    }
    const onToolCancel = () => {
      clearVertexGesture(false)
      clearSurfacePlanSnapFeedback()
    }

    emitter.on('tool:cancel', onToolCancel)
    svg.addEventListener('pointerdown', onPointerDown, true)
    svg.addEventListener('pointermove', onPointerMove, true)
    svg.addEventListener('pointerup', onPointerUp, true)
    svg.addEventListener('pointercancel', onPointerCancel, true)
    svg.addEventListener('pointerleave', onPointerLeave, true)
    svg.addEventListener('click', onClick, true)
    svg.addEventListener('dblclick', onDoubleClick, true)
    window.addEventListener('blur', onBlur)
    return () => {
      cancelVertexGesture.current = () => {}
      clearVertexGesture(false)
      clearSurfacePlanSnapFeedback()
      emitter.off('tool:cancel', onToolCancel)
      svg.removeEventListener('pointerdown', onPointerDown, true)
      svg.removeEventListener('pointermove', onPointerMove, true)
      svg.removeEventListener('pointerup', onPointerUp, true)
      svg.removeEventListener('pointercancel', onPointerCancel, true)
      svg.removeEventListener('pointerleave', onPointerLeave, true)
      svg.removeEventListener('click', onClick, true)
      svg.removeEventListener('dblclick', onDoubleClick, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [active, activeLevelId, owner])

  const preview = useMemo(() => {
    const livePoints =
      stage === 'collecting' && hover && !vertexDrag ? [...points, hover.point] : points
    const planPoints = livePoints.map((point) => ({ x: point[0], y: point[2] }))
    const polygonPoints = planPoints.map((point) => `${point.x},${point.y}`).join(' ')
    const angleArc =
      kind === 'angle' && livePoints.length >= 3
        ? buildMeasurementAngleArcPoints(livePoints[0]!, livePoints[1]!, livePoints[2]!)
        : []
    const angleArcPoints = angleArc.map((point) => `${point[0]},${point[2]}`).join(' ')
    const first = planPoints[0]
    const last = planPoints[planPoints.length - 1]
    const center = measurementPolygonLabelAnchor(points)
    const polygon = kind === 'area' || kind === 'perimeter' || kind === 'volume'
    const midpointHandles =
      polygon && stage === 'collecting' && !vertexDrag ? measurementPolygonMidpoints(points) : []
    const activeEdges: Array<[MeasurementPoint, MeasurementPoint]> = vertexDrag
      ? measurementVertexSnapAnchors(points, vertexDrag.index, polygon).map((neighbor) => [
          neighbor,
          points[vertexDrag.index]!,
        ])
      : []
    let label: {
      angle: number
      point: MeasurementPoint
      screenUpright: boolean
      text: string
    } | null = null
    let segmentLabel: { angle: number; point: MeasurementPoint; text: string } | null = null

    if (kind === 'distance' && livePoints.length >= 2) {
      const start = livePoints[0]!
      const end = livePoints[livePoints.length - 1]!
      label = {
        angle: Math.atan2(end[2] - start[2], end[0] - start[0]),
        point: [(start[0] + end[0]) / 2, 0, (start[2] + end[2]) / 2],
        screenUpright: false,
        text: formatLinearMeasurement(measurementDistance(start, end), unit, metricNotation),
      }
    } else if (kind === 'angle' && livePoints.length >= 3) {
      const anglePoints = livePoints.slice(0, 3) as [
        MeasurementPoint,
        MeasurementPoint,
        MeasurementPoint,
      ]
      label = {
        angle: 0,
        point: angleArc[Math.floor(angleArc.length / 2)] ?? anglePoints[1],
        screenUpright: true,
        text: formatAngleRadians(measurementAngle(...anglePoints)),
      }
    } else if ((kind === 'area' || kind === 'perimeter') && livePoints.length >= 3) {
      const liveCenter = measurementPolygonLabelAnchor(livePoints)
      if (liveCenter) {
        label = {
          angle: 0,
          point: liveCenter,
          screenUpright: true,
          text:
            kind === 'area'
              ? `A ${formatAreaLabel(measurementArea(livePoints), unit)}`
              : `P ${formatLinearMeasurement(measurementPerimeter(livePoints), unit, metricNotation)}`,
        }
      }
    } else if (kind === 'volume' && center && baseNormal) {
      const extrusion: MeasurementPoint = [
        baseNormal[0] * extrusionHeight,
        baseNormal[1] * extrusionHeight,
        baseNormal[2] * extrusionHeight,
      ]
      if (stage !== 'extruding') {
        label = {
          angle: 0,
          point: center,
          screenUpright: true,
          text: `V ${formatVolumeLabel(measurementPrismVolume(points, extrusion), unit)}`,
        }
      }
    }

    if (kind !== 'distance' && stage === 'collecting') {
      const segmentEnd = vertexDrag ? points[vertexDrag.index] : hover?.point
      const segmentStart = vertexDrag
        ? (axisGuide?.from ?? points[(vertexDrag.index - 1 + points.length) % points.length])
        : points.at(-1)
      if (segmentStart && segmentEnd && measurementDistance(segmentStart, segmentEnd) > 1e-6) {
        segmentLabel = {
          angle: Math.atan2(segmentEnd[2] - segmentStart[2], segmentEnd[0] - segmentStart[0]),
          point: [
            (segmentStart[0] + segmentEnd[0]) / 2,
            (segmentStart[1] + segmentEnd[1]) / 2,
            (segmentStart[2] + segmentEnd[2]) / 2,
          ],
          text: formatLinearMeasurement(
            measurementDistance(segmentStart, segmentEnd),
            unit,
            metricNotation,
          ),
        }
      }
    }

    return {
      activeEdges,
      angleArcPoints,
      center,
      first,
      label,
      last,
      livePoints,
      midpointHandles,
      planPoints,
      polygonPoints,
      segmentLabel,
    }
  }, [
    axisGuide,
    baseNormal,
    extrusionHeight,
    hover,
    kind,
    metricNotation,
    points,
    stage,
    unit,
    vertexDrag,
  ])

  if (smartActive) return <FloorplanQuickMeasureLayer />
  if (!active || (draftLevelId && draftLevelId !== activeLevelId)) return null
  const unitsPerPixel = renderContext?.unitsPerPixel ?? 0.01
  const sceneRotationDeg = renderContext?.sceneRotationDeg ?? 0
  const anchorRadius = 4.5 * unitsPerPixel
  const labelFontSize = 12 * unitsPerPixel
  const reticleRadius = 16 * unitsPerPixel
  const reticleInnerRadius = 9 * unitsPerPixel
  const cornerSnap = hover?.semantic?.snapKind === 'endpoint'
  const reticleColor = axisGuide?.snapped
    ? axisGuide.axis === 'x'
      ? X_AXIS_COLOR
      : axisGuide.axis === 'z'
        ? Z_AXIS_COLOR
        : RETICLE_COLOR
    : hover?.semantic
      ? '#22c55e'
      : RETICLE_COLOR
  const distanceStrokeColor =
    kind === 'distance' && axisGuide?.snapped
      ? axisGuide.axis === 'x'
        ? X_AXIS_COLOR
        : Z_AXIS_COLOR
      : DRAFT_COLOR
  const guideAnchor = vertexDrag && axisGuide ? axisGuide.from : points.at(-1)
  const guideHalfLength = AXIS_GUIDE_HALF_LENGTH_PX * unitsPerPixel
  const labelBackground = renderContext?.palette.measurementLabelBackground ?? '#0f172a'
  const labelText = renderContext?.palette.measurementLabelText ?? '#f8fafc'

  return (
    <g ref={groupRef}>
      {guideAnchor ? (
        <g pointerEvents="none">
          <line
            stroke={X_AXIS_COLOR}
            strokeDasharray={axisGuide?.axis === 'x' && axisGuide.snapped ? undefined : '6 5'}
            strokeOpacity={axisGuide?.axis === 'x' ? (axisGuide.snapped ? 1 : 0.8) : 0.28}
            strokeWidth={axisGuide?.axis === 'x' ? (axisGuide.snapped ? 3.5 : 2) : 1}
            vectorEffect="non-scaling-stroke"
            x1={guideAnchor[0] - guideHalfLength}
            x2={guideAnchor[0] + guideHalfLength}
            y1={guideAnchor[2]}
            y2={guideAnchor[2]}
          />
          <line
            stroke={Z_AXIS_COLOR}
            strokeDasharray={axisGuide?.axis === 'z' && axisGuide.snapped ? undefined : '6 5'}
            strokeOpacity={axisGuide?.axis === 'z' ? (axisGuide.snapped ? 1 : 0.8) : 0.28}
            strokeWidth={axisGuide?.axis === 'z' ? (axisGuide.snapped ? 3.5 : 2) : 1}
            vectorEffect="non-scaling-stroke"
            x1={guideAnchor[0]}
            x2={guideAnchor[0]}
            y1={guideAnchor[2] - guideHalfLength}
            y2={guideAnchor[2] + guideHalfLength}
          />
        </g>
      ) : null}
      {kind === 'distance' && preview.planPoints.length >= 2 ? (
        <line
          stroke={distanceStrokeColor}
          strokeLinecap="round"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          x1={preview.planPoints[0]!.x}
          x2={preview.planPoints[preview.planPoints.length - 1]!.x}
          y1={preview.planPoints[0]!.y}
          y2={preview.planPoints[preview.planPoints.length - 1]!.y}
        />
      ) : null}
      {kind === 'angle' && preview.planPoints.length >= 2 ? (
        <>
          <polyline
            fill="none"
            points={preview.polygonPoints}
            stroke={DRAFT_COLOR}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
          {preview.angleArcPoints ? (
            <polyline
              fill="none"
              points={preview.angleArcPoints}
              stroke={DRAFT_COLOR}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={3}
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
        </>
      ) : null}
      {(kind === 'area' || kind === 'perimeter' || kind === 'volume') &&
      preview.planPoints.length >= 2 ? (
        <>
          {kind !== 'perimeter' && preview.planPoints.length >= 3 ? (
            <polygon fill={DRAFT_COLOR} fillOpacity={0.12} points={preview.polygonPoints} />
          ) : null}
          <polyline
            fill="none"
            points={preview.polygonPoints}
            stroke={DRAFT_COLOR}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
          {preview.first && preview.last ? (
            <line
              stroke={DRAFT_COLOR}
              strokeDasharray="5 4"
              strokeOpacity={0.65}
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
              x1={preview.last.x}
              x2={preview.first.x}
              y1={preview.last.y}
              y2={preview.first.y}
            />
          ) : null}
        </>
      ) : null}
      {preview.activeEdges.map(([start, end], index) => (
        <line
          key={`measurement-active-edge-${index}`}
          stroke="#f8fafc"
          strokeLinecap="round"
          strokeOpacity={0.95}
          strokeWidth={3}
          vectorEffect="non-scaling-stroke"
          x1={start[0]}
          x2={end[0]}
          y1={start[2]}
          y2={end[2]}
        />
      ))}
      {axisGuide ? (
        <g pointerEvents="none">
          <line
            stroke="#f8fafc"
            strokeOpacity={axisGuide.snapped ? 0.8 : 0.35}
            strokeWidth={4}
            vectorEffect="non-scaling-stroke"
            x1={axisGuide.from[0]}
            x2={axisGuide.to[0]}
            y1={axisGuide.from[2]}
            y2={axisGuide.to[2]}
          />
          <line
            stroke={axisGuide.axis === 'x' ? X_AXIS_COLOR : Z_AXIS_COLOR}
            strokeDasharray={axisGuide.snapped ? undefined : '5 4'}
            strokeOpacity={axisGuide.snapped ? 1 : 0.72}
            strokeWidth={axisGuide.snapped ? 2.5 : 1.75}
            vectorEffect="non-scaling-stroke"
            x1={axisGuide.from[0]}
            x2={axisGuide.to[0]}
            y1={axisGuide.from[2]}
            y2={axisGuide.to[2]}
          />
          <text
            dominantBaseline="central"
            fill={axisGuide.axis === 'x' ? X_AXIS_COLOR : Z_AXIS_COLOR}
            fontSize={labelFontSize}
            fontWeight="700"
            textAnchor="middle"
            transform={`rotate(${-sceneRotationDeg} ${axisGuide.to[0]} ${axisGuide.to[2]})`}
            x={axisGuide.to[0]}
            y={axisGuide.to[2] - 24 * unitsPerPixel}
          >
            {axisGuide.proximity ? 'ALIGN ' : ''}
            {axisGuide.axis.toUpperCase()}
          </text>
          {axisGuide.snapped ? (
            <>
              <circle
                cx={axisGuide.to[0]}
                cy={axisGuide.to[2]}
                fill={labelBackground}
                r={6 * unitsPerPixel}
                stroke={axisGuide.axis === 'x' ? X_AXIS_COLOR : Z_AXIS_COLOR}
                strokeWidth={3}
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={axisGuide.to[0]}
                cy={axisGuide.to[2]}
                fill={axisGuide.axis === 'x' ? X_AXIS_COLOR : Z_AXIS_COLOR}
                r={2 * unitsPerPixel}
              />
            </>
          ) : null}
          {axisGuide.proximity && axisGuide.snapped ? (
            <circle
              cx={axisGuide.from[0]}
              cy={axisGuide.from[2]}
              fill={labelBackground}
              r={5 * unitsPerPixel}
              stroke={axisGuide.axis === 'x' ? X_AXIS_COLOR : Z_AXIS_COLOR}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
        </g>
      ) : null}
      {points.map((point, index) => (
        <circle
          cx={point[0]}
          cy={point[2]}
          fill={vertexDrag?.index === index ? '#f8fafc' : DRAFT_COLOR}
          key={`measurement-draft-point-${index}`}
          pointerEvents="none"
          r={vertexDrag?.index === index ? anchorRadius * 1.2 : anchorRadius}
          stroke="white"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {preview.midpointHandles.map(({ edgeIndex, point }) => (
        <circle
          cx={point[0]}
          cy={point[2]}
          fill="#a3e635"
          key={`measurement-draft-midpoint-${edgeIndex}`}
          pointerEvents="none"
          r={3 * unitsPerPixel}
          stroke="white"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {hover && hoverOwner === '2d' ? (
        <g pointerEvents="none">
          {cornerSnap ? (
            <circle
              cx={hover.point[0]}
              cy={hover.point[2]}
              fill="none"
              r={reticleRadius + 6 * unitsPerPixel}
              stroke="#a3e635"
              strokeOpacity={0.9}
              strokeWidth={3}
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          <circle
            cx={hover.point[0]}
            cy={hover.point[2]}
            fill="none"
            r={reticleRadius}
            stroke={reticleColor}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
          <circle
            cx={hover.point[0]}
            cy={hover.point[2]}
            fill="none"
            r={reticleInnerRadius}
            stroke={reticleColor}
            strokeOpacity={0.72}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
          <line
            stroke={X_AXIS_COLOR}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            x1={hover.point[0] - reticleInnerRadius}
            x2={hover.point[0] + reticleInnerRadius}
            y1={hover.point[2]}
            y2={hover.point[2]}
          />
          <line
            stroke={Z_AXIS_COLOR}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            x1={hover.point[0]}
            x2={hover.point[0]}
            y1={hover.point[2] - reticleInnerRadius}
            y2={hover.point[2] + reticleInnerRadius}
          />
        </g>
      ) : null}
      {hover && hoverOwner === '2d' && hover.semantic ? (
        <FloorplanDraftLabel
          background={labelBackground}
          border="#22c55e"
          offsetPx={30}
          point={hover.point}
          sceneRotationDeg={sceneRotationDeg}
          screenUpright
          text={`${hover.semantic.label}${
            hover.semantic.length === null
              ? ''
              : ` · ${formatLinearMeasurement(hover.semantic.length, unit, metricNotation)}`
          }`}
          textColor={labelText}
          unitsPerPixel={unitsPerPixel}
        />
      ) : null}
      {preview.label ? (
        <FloorplanDraftLabel
          angle={preview.label.angle}
          appearance="outlined"
          background={labelBackground}
          border={DRAFT_COLOR}
          offsetPx={preview.label.screenUpright ? 0 : 14}
          point={preview.label.point}
          sceneRotationDeg={sceneRotationDeg}
          screenUpright={preview.label.screenUpright}
          text={preview.label.text}
          textColor={labelText}
          unitsPerPixel={unitsPerPixel}
        />
      ) : null}
      {preview.segmentLabel ? (
        <FloorplanDraftLabel
          angle={preview.segmentLabel.angle}
          background={labelBackground}
          border={DRAFT_COLOR}
          offsetPx={12}
          point={preview.segmentLabel.point}
          sceneRotationDeg={sceneRotationDeg}
          text={preview.segmentLabel.text}
          textColor={labelText}
          unitsPerPixel={unitsPerPixel}
        />
      ) : null}
      {error && preview.last ? (
        <FloorplanDraftLabel
          background={labelBackground}
          border="var(--destructive)"
          offsetPx={-16}
          point={[preview.last.x, 0, preview.last.y]}
          sceneRotationDeg={sceneRotationDeg}
          screenUpright
          text={error}
          textColor="var(--destructive)"
          unitsPerPixel={unitsPerPixel}
        />
      ) : null}
      {owner === '2d' && stage === 'extruding' && preview.center ? (
        <FloorplanExtrusionControl
          center={preview.center}
          sceneRotationDeg={sceneRotationDeg}
          unitsPerPixel={unitsPerPixel}
        />
      ) : null}
    </g>
  )
}

export default FloorplanMeasurementToolLayer
