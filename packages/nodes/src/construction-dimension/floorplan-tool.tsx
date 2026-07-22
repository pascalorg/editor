'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type ConstructionDimensionChainMode,
  type ConstructionDimensionMode,
  ConstructionDimensionNode,
  closestMeasurementFeatureBinding,
  constructionDimensionRequiredAnchorCount,
  type FloorplanGeometry,
  type GeometryContext,
  getWallArcData,
  getWallCurveFrameAt,
  type MeasurementAnchor,
  type MeasurementFeatureAnchor,
  type MeasurementPoint,
  nodeRegistry,
  type WallNode,
} from '@pascal-app/core'
import {
  buildSvgArcPath,
  clearSurfacePlanSnapFeedback,
  FloorplanGeometryRenderer,
  type FloorplanToolContext,
  formatLinearMeasurement,
  getArcPlanPoint,
  isGridSnapActive,
  isMagneticSnapActive,
  markToolCancelConsumed,
  resolveSurfacePlanPointSnap,
  triggerSFX,
  useDrawingView,
  useFloorplanRender,
  useInteractionScope,
} from '@pascal-app/editor'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { resolveCircularConstructionDimensionLayout } from './geometry'

const SEMANTIC_SNAP_DISTANCE = 0.2
const SEMANTIC_BYPASS_DISTANCE = 0.012
const MIN_DIMENSION_LENGTH = 0.001
const MIN_ARC_SWEEP = 1e-6

type Draft = {
  anchors: MeasurementAnchor[]
  points: MeasurementPoint[]
  stage: 'witnesses' | 'baseline'
}

type AssociatedPoint = {
  anchor: MeasurementAnchor
  point: MeasurementPoint
  semantic: boolean
  targetNodeId: string | null
}

const emptyDraft = (): Draft => ({ anchors: [], points: [], stage: 'witnesses' })

function geometryContext(node: AnyNode, nodes: Record<AnyNodeId, AnyNode>): GeometryContext {
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

function associatePoint(
  point: MeasurementPoint,
  targetNodeId: string | null,
  maxDistance: number,
  nodes: Record<AnyNodeId, AnyNode>,
): AssociatedPoint {
  if (!targetNodeId) return { anchor: point, point, semantic: false, targetNodeId: null }
  const node = nodes[targetNodeId as AnyNodeId]
  const contribution = node ? nodeRegistry.get(node.type)?.measurement : undefined
  if (!(node && contribution)) return { anchor: point, point, semantic: false, targetNodeId }
  const context = geometryContext(node, nodes)
  const features = contribution.features(node, context)
  const match =
    contribution.match?.(node, context, point, maxDistance) ??
    closestMeasurementFeatureBinding(features, point, maxDistance)
  if (!match) return { anchor: point, point, semantic: false, targetNodeId }

  const reference = {
    nodeId: node.id,
    featureId: match.featureId,
    parameters: match.parameters,
  }
  const anchor: MeasurementFeatureAnchor = {
    kind: 'feature',
    reference,
    fallback: match.point,
  }
  return { anchor, point: match.point, semantic: true, targetNodeId }
}

function clientToPlanPoint(group: SVGGElement, clientX: number, clientY: number) {
  const matrix = group.getScreenCTM()
  if (!matrix) return null
  const local = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse())
  return [local.x, 0, local.y] satisfies MeasurementPoint
}

function registryTargetNodeId(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null
  return (
    target.closest<SVGGElement>('.floorplan-registry-entry[data-node-id]')?.dataset.nodeId ?? null
  )
}

export function resolveConstructionDimensionDraftDirection(
  points: readonly MeasurementPoint[],
): [number, number] | null {
  if (points.length < 2) return null
  const dx = points[1]![0] - points[0]![0]
  const dz = points[1]![2] - points[0]![2]
  const magnitude = Math.hypot(dx, dz)
  return magnitude <= MIN_DIMENSION_LENGTH ? null : [dx / magnitude, dz / magnitude]
}

export function buildConstructionDimensionPreviewGeometries(
  points: readonly MeasurementPoint[],
  baselinePoint: MeasurementPoint,
  unit: 'metric' | 'imperial',
  mode: ConstructionDimensionMode = 'linear',
  metricNotation: 'meters' | 'millimeters' = 'meters',
): FloorplanGeometry[] {
  if (mode === 'arc-length' || mode === 'angular') {
    const layout = resolveCircularConstructionDimensionLayout(mode, points)
    if (!(layout?.end && Math.abs(layout.sweep) > MIN_ARC_SWEEP)) return []
    const center = { x: layout.center[0], y: layout.center[1] }
    const end = getArcPlanPoint(center, layout.radius, layout.endAngle)
    const arcMid = getArcPlanPoint(center, layout.radius, layout.startAngle + layout.sweep / 2)
    const stroke = '#06b6d4'
    const lineStyle = {
      fill: 'none',
      pointerEvents: 'none' as const,
      stroke,
      strokeWidth: 2,
      vectorEffect: 'non-scaling-stroke' as const,
    }
    if (mode === 'angular') {
      const endRadius = Math.hypot(layout.end[0] - center.x, layout.end[1] - center.y)
      const maximumRadius = Math.max(0.25, Math.min(layout.radius, endRadius) * 0.9)
      const requestedRadius = Math.hypot(baselinePoint[0] - center.x, baselinePoint[2] - center.y)
      const arcRadius = Math.min(maximumRadius, Math.max(0.25, requestedRadius))
      const midAngle = layout.startAngle + layout.sweep / 2
      const arcMid = getArcPlanPoint(center, arcRadius, midAngle)
      const startRayEnd = getArcPlanPoint(
        center,
        Math.max(layout.radius, arcRadius + 0.12),
        layout.startAngle,
      )
      const endRayEnd = getArcPlanPoint(
        center,
        Math.max(endRadius, arcRadius + 0.12),
        layout.endAngle,
      )
      const degrees = (Math.abs(layout.sweep) * 180) / Math.PI
      const formattedDegrees = Number.parseFloat(degrees.toFixed(degrees < 10 ? 1 : 0))
      return [
        {
          kind: 'group',
          children: [
            {
              kind: 'line',
              x1: center.x,
              y1: center.y,
              x2: startRayEnd.x,
              y2: startRayEnd.y,
              ...lineStyle,
            },
            {
              kind: 'line',
              x1: center.x,
              y1: center.y,
              x2: endRayEnd.x,
              y2: endRayEnd.y,
              ...lineStyle,
            },
            {
              kind: 'path',
              d: buildSvgArcPath(
                center,
                arcRadius,
                layout.startAngle,
                layout.startAngle + layout.sweep,
              ),
              ...lineStyle,
            },
            {
              kind: 'line',
              x1: arcMid.x,
              y1: arcMid.y,
              x2: baselinePoint[0],
              y2: baselinePoint[2],
              strokeDasharray: '6 5',
              ...lineStyle,
            },
            {
              kind: 'dimension-label',
              cx: baselinePoint[0],
              cy: baselinePoint[2],
              text: `∠ ${formattedDegrees}°`,
              angle: 0,
              screenUpright: true,
              appearance: 'outlined',
            },
          ],
        },
      ]
    }
    return [
      {
        kind: 'group',
        children: [
          {
            kind: 'path',
            d: buildSvgArcPath(
              center,
              layout.radius,
              layout.startAngle,
              layout.startAngle + layout.sweep,
            ),
            ...lineStyle,
          },
          {
            kind: 'line',
            x1: layout.center[0],
            y1: layout.center[1],
            x2: layout.start[0],
            y2: layout.start[1],
            strokeDasharray: '6 5',
            ...lineStyle,
          },
          {
            kind: 'line',
            x1: layout.center[0],
            y1: layout.center[1],
            x2: end.x,
            y2: end.y,
            strokeDasharray: '6 5',
            ...lineStyle,
          },
          {
            kind: 'line',
            x1: arcMid.x,
            y1: arcMid.y,
            x2: baselinePoint[0],
            y2: baselinePoint[2],
            strokeDasharray: '6 5',
            ...lineStyle,
          },
          {
            kind: 'dimension-label',
            cx: baselinePoint[0],
            cy: baselinePoint[2],
            text: `ARC ${formatLinearMeasurement(layout.arcLength, unit, metricNotation)}`,
            angle: 0,
            screenUpright: true,
            appearance: 'outlined',
          },
        ],
      },
    ]
  }
  if (!['linear', 'chord', 'radius', 'diameter'].includes(mode)) return []
  const direction = resolveConstructionDimensionDraftDirection(points)
  if (!direction) return []
  const normal: [number, number] = [-direction[1], direction[0]]
  const project = (point: MeasurementPoint): [number, number] => {
    const along =
      (point[0] - baselinePoint[0]) * direction[0] + (point[2] - baselinePoint[2]) * direction[1]
    return [baselinePoint[0] + along * direction[0], baselinePoint[2] + along * direction[1]]
  }
  const dimensionPoints = points.map(project)
  return points.slice(0, -1).map((start, index) => {
    const end = points[index + 1]!
    const dx = end[0] - start[0]
    const dz = end[2] - start[2]
    const value = Math.abs(dx * direction[0] + dz * direction[1])
    const rawText = formatLinearMeasurement(value, unit, metricNotation)
    const text =
      mode === 'radius'
        ? `R ${rawText}`
        : mode === 'diameter'
          ? `Ø ${rawText}`
          : mode === 'chord'
            ? `CH ${rawText}`
            : rawText
    return {
      kind: 'dimension',
      start: [start[0], start[2]],
      end: [end[0], end[2]],
      dimensionStart: dimensionPoints[index]!,
      dimensionEnd: dimensionPoints[index + 1]!,
      offsetNormal: normal,
      offsetDistance: 0,
      extensionOvershoot: 0.12,
      text,
      stroke: '#06b6d4',
    }
  })
}

export function normalizeConstructionDimensionChainMode(
  value: unknown,
): ConstructionDimensionChainMode {
  return value === 'continuous' ? 'continuous' : 'point-to-point'
}

export function normalizeConstructionDimensionMode(value: unknown): ConstructionDimensionMode {
  return [
    'radius',
    'diameter',
    'center-mark',
    'chord',
    'arc-length',
    'angular',
    'coordinate',
  ].includes(value as string)
    ? (value as ConstructionDimensionMode)
    : 'linear'
}

export function constructionDimensionUsesBaseline(mode: ConstructionDimensionMode): boolean {
  return ['linear', 'radius', 'chord', 'arc-length', 'angular'].includes(mode)
}

function wallFeatureAnchor(
  wall: WallNode,
  featureId: string,
  fallback: MeasurementPoint,
): MeasurementFeatureAnchor {
  return {
    kind: 'feature',
    reference: { nodeId: wall.id, featureId },
    fallback,
  }
}

export function buildCurvedWallConstructionDimensionDraft(
  wall: WallNode,
  mode: ConstructionDimensionMode,
): Pick<Draft, 'anchors' | 'points'> | null {
  const arc = getWallArcData(wall)
  if (!arc) return null

  const center: MeasurementPoint = [arc.center.x, 0, arc.center.y]
  const start: MeasurementPoint = [wall.start[0], 0, wall.start[1]]
  const end: MeasurementPoint = [wall.end[0], 0, wall.end[1]]
  const midpointFrame = getWallCurveFrameAt(wall, 0.5)
  const midpoint: MeasurementPoint = [midpointFrame.point.x, 0, midpointFrame.point.y]
  const feature = (featureId: string, fallback: MeasurementPoint) =>
    wallFeatureAnchor(wall, featureId, fallback)

  switch (mode) {
    case 'radius':
    case 'center-mark':
      return {
        anchors: [feature('wall:curve:center', center), feature('wall:midpoint', midpoint)],
        points: [center, midpoint],
      }
    case 'chord':
      return {
        anchors: [feature('wall:start', start), feature('wall:end', end)],
        points: [start, end],
      }
    case 'arc-length':
    case 'angular':
      return null
    default:
      return null
  }
}

export function FloorplanConstructionDimensionToolLayer({
  activeLevelId,
  finishTool,
  gridSnapStep,
  metricNotation,
  sceneApi,
  selectNode,
  toolDefaults,
  unit,
}: FloorplanToolContext) {
  const groupRef = useRef<SVGGElement>(null)
  const draftRef = useRef<Draft>(emptyDraft())
  const [draft, setDraft] = useState<Draft>(draftRef.current)
  const [hover, setHover] = useState<AssociatedPoint | null>(null)
  const chainMode = normalizeConstructionDimensionChainMode(toolDefaults?.chainMode)
  const dimensionMode = normalizeConstructionDimensionMode(toolDefaults?.mode)
  const collectsMany =
    dimensionMode === 'coordinate' || (dimensionMode === 'linear' && chainMode === 'continuous')
  const usesBaseline = constructionDimensionUsesBaseline(dimensionMode)
  const renderContext = useFloorplanRender()
  const drawingType = useDrawingView((state) => state.drawingType)

  useEffect(() => {
    useInteractionScope.getState().begin({ kind: 'drafting', tool: 'construction-dimension' })
    return () =>
      useInteractionScope
        .getState()
        .endIf((scope) => scope.kind === 'drafting' && scope.tool === 'construction-dimension')
  }, [])

  const updateDraft = useCallback((next: Draft) => {
    draftRef.current = next
    setDraft(next)
  }, [])

  useEffect(() => {
    updateDraft(emptyDraft())
    setHover(null)
    const group = groupRef.current
    const svg = group?.ownerSVGElement
    if (!(activeLevelId && group && svg)) return

    const consume = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }
    const resolveEvent = (event: MouseEvent | PointerEvent): AssociatedPoint | null => {
      const raw = clientToPlanPoint(group, event.clientX, event.clientY)
      if (!raw) return null
      const forceFree = event.altKey
      const gridStep = !forceFree && isGridSnapActive() ? gridSnapStep : 0
      const fallbackPoint: [number, number] =
        gridStep > 0
          ? [Math.round(raw[0] / gridStep) * gridStep, Math.round(raw[2] / gridStep) * gridStep]
          : [raw[0], raw[2]]
      const magnetic = !forceFree && isMagneticSnapActive()
      const surface = resolveSurfacePlanPointSnap({
        rawPoint: [raw[0], raw[2]],
        fallbackPoint,
        levelId: activeLevelId,
        align: false,
        magnetic,
      })
      const point: MeasurementPoint = [surface.point[0], 0, surface.point[1]]
      const targetNodeId = surface.wallIds[0] ?? registryTargetNodeId(event.target)
      return associatePoint(
        point,
        targetNodeId,
        magnetic ? SEMANTIC_SNAP_DISTANCE : SEMANTIC_BYPASS_DISTANCE,
        sceneApi.nodes(),
      )
    }
    const commitDraft = (current: Draft, baselinePoint?: MeasurementPoint) => {
      const direction = resolveConstructionDimensionDraftDirection(current.points)
      const originPoint = baselinePoint ?? current.points.at(-1)
      if (!(direction && originPoint)) return false
      const node = ConstructionDimensionNode.parse({
        name:
          dimensionMode === 'linear' && chainMode === 'continuous'
            ? 'Continuous Dimension'
            : `${dimensionMode.replaceAll('-', ' ')} Dimension`,
        anchors: current.anchors,
        baseline: {
          origin: [originPoint[0], originPoint[2]],
          direction,
        },
        chainMode,
        mode: dimensionMode,
        drawingType,
      })
      sceneApi.upsert(node, activeLevelId)
      selectNode(node.id)
      triggerSFX('sfx:structure-build')
      finishTool()
      updateDraft(emptyDraft())
      setHover(null)
      return true
    }
    const finishWitnesses = () => {
      const current = draftRef.current
      const required = constructionDimensionRequiredAnchorCount(dimensionMode)
      if (current.stage !== 'witnesses' || current.points.length < required) return false
      if (!usesBaseline) return commitDraft(current)
      updateDraft({ ...current, stage: 'baseline' })
      triggerSFX('sfx:grid-snap')
      return true
    }
    const removeLastWitness = () => {
      const current = draftRef.current
      if (current.points.length === 0) return false
      updateDraft({
        anchors: current.anchors.slice(0, -1),
        points: current.points.slice(0, -1),
        stage: 'witnesses',
      })
      return true
    }
    const commitAt = (associated: AssociatedPoint) => {
      const current = draftRef.current
      if (current.stage === 'baseline') commitDraft(current, associated.point)
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.button === 0) consume(event)
    }
    const onPointerMove = (event: PointerEvent) => {
      consume(event)
      setHover(resolveEvent(event))
    }
    const onPointerLeave = () => {
      clearSurfacePlanSnapFeedback()
      setHover(null)
    }
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0) return
      consume(event)
      if (event.detail > 1) return
      const associated = resolveEvent(event)
      if (!associated) return
      const current = draftRef.current
      if (current.stage === 'baseline') {
        commitAt(associated)
        return
      }
      const targetNode = associated.targetNodeId
        ? sceneApi.get(associated.targetNodeId as AnyNodeId)
        : undefined
      const curvedWallDraft =
        current.points.length === 0 && targetNode?.type === 'wall'
          ? buildCurvedWallConstructionDimensionDraft(targetNode, dimensionMode)
          : null
      if (curvedWallDraft) {
        const next: Draft = { ...curvedWallDraft, stage: 'witnesses' }
        updateDraft(next)
        triggerSFX('sfx:grid-snap')
        if (usesBaseline) updateDraft({ ...next, stage: 'baseline' })
        else commitDraft(next)
        return
      }
      const previous = current.points.at(-1)
      if (
        previous &&
        Math.hypot(associated.point[0] - previous[0], associated.point[2] - previous[2]) <=
          MIN_DIMENSION_LENGTH
      ) {
        return
      }
      const next: Draft = {
        anchors: [...current.anchors, associated.anchor],
        points: [...current.points, associated.point],
        stage: 'witnesses',
      }
      updateDraft(next)
      triggerSFX('sfx:grid-snap')
      if (
        !collectsMany &&
        next.points.length === constructionDimensionRequiredAnchorCount(dimensionMode)
      ) {
        if (usesBaseline) updateDraft({ ...next, stage: 'baseline' })
        else commitDraft(next)
      }
    }
    const onDoubleClick = (event: MouseEvent) => {
      if (event.button !== 0 || !collectsMany) return
      consume(event)
      finishWitnesses()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && collectsMany) {
        if (!finishWitnesses()) return
        event.preventDefault()
        event.stopImmediatePropagation()
        return
      }
      if (event.key === 'Backspace') {
        if (!removeLastWitness()) return
        event.preventDefault()
        event.stopImmediatePropagation()
        markToolCancelConsumed()
        return
      }
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      markToolCancelConsumed()
      const current = draftRef.current
      if (current.stage === 'baseline') {
        updateDraft({ ...current, stage: 'witnesses' })
        return
      }
      if (removeLastWitness()) return
      finishTool()
    }
    const onBlur = () => clearSurfacePlanSnapFeedback()

    svg.addEventListener('pointerdown', onPointerDown, true)
    svg.addEventListener('pointermove', onPointerMove, true)
    svg.addEventListener('pointerleave', onPointerLeave, true)
    svg.addEventListener('click', onClick, true)
    svg.addEventListener('dblclick', onDoubleClick, true)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('blur', onBlur)
    return () => {
      clearSurfacePlanSnapFeedback()
      svg.removeEventListener('pointerdown', onPointerDown, true)
      svg.removeEventListener('pointermove', onPointerMove, true)
      svg.removeEventListener('pointerleave', onPointerLeave, true)
      svg.removeEventListener('click', onClick, true)
      svg.removeEventListener('dblclick', onDoubleClick, true)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [
    activeLevelId,
    chainMode,
    collectsMany,
    dimensionMode,
    drawingType,
    finishTool,
    gridSnapStep,
    sceneApi,
    selectNode,
    updateDraft,
    usesBaseline,
  ])

  const preview = useMemo(
    () =>
      draft.stage === 'baseline' && hover
        ? buildConstructionDimensionPreviewGeometries(
            draft.points,
            hover.point,
            unit,
            dimensionMode,
            metricNotation,
          )
        : [],
    [dimensionMode, draft.points, draft.stage, hover, metricNotation, unit],
  )
  const witnessDraftPoints =
    draft.stage === 'witnesses' && hover ? [...draft.points, hover.point] : draft.points

  if (!activeLevelId) return null
  const unitsPerPixel = renderContext?.unitsPerPixel ?? 0.01
  const reticleRadius = 10 * unitsPerPixel
  const hoverColor = hover?.semantic ? '#22c55e' : '#06b6d4'

  return (
    <g ref={groupRef}>
      {witnessDraftPoints.length >= 2 && (draft.stage === 'witnesses' || preview.length === 0) ? (
        <polyline
          fill="none"
          pointerEvents="none"
          points={witnessDraftPoints.map((point) => `${point[0]},${point[2]}`).join(' ')}
          stroke="#06b6d4"
          strokeDasharray="6 5"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      {preview.map((geometry, index) => (
        <FloorplanGeometryRenderer
          annotationUnitsPerPoint={unitsPerPixel}
          geometry={geometry}
          key={`${index}-${geometry.kind}`}
          sceneRotationDeg={renderContext?.sceneRotationDeg ?? 0}
        />
      ))}
      {draft.points.map((point, index) => (
        <circle
          fill="#06b6d4"
          key={`${index}-${point.join('-')}`}
          pointerEvents="none"
          r={4.5 * unitsPerPixel}
          stroke="#ffffff"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
          cx={point[0]}
          cy={point[2]}
        />
      ))}
      {hover ? (
        <g pointerEvents="none">
          <circle
            cx={hover.point[0]}
            cy={hover.point[2]}
            fill="none"
            r={reticleRadius}
            stroke={hoverColor}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
          <line
            stroke={hoverColor}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            x1={hover.point[0] - reticleRadius * 1.4}
            x2={hover.point[0] + reticleRadius * 1.4}
            y1={hover.point[2]}
            y2={hover.point[2]}
          />
          <line
            stroke={hoverColor}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            x1={hover.point[0]}
            x2={hover.point[0]}
            y1={hover.point[2] - reticleRadius * 1.4}
            y2={hover.point[2] + reticleRadius * 1.4}
          />
        </g>
      ) : null}
    </g>
  )
}

export default FloorplanConstructionDimensionToolLayer
