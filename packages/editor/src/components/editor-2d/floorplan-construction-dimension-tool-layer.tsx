'use client'

import {
  type AnyNode,
  type AnyNodeId,
  ConstructionDimensionNode,
  closestMeasurementFeatureBinding,
  type FloorplanGeometry,
  type GeometryContext,
  type MeasurementAnchor,
  type MeasurementFeatureAnchor,
  type MeasurementPoint,
  nodeRegistry,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { markToolCancelConsumed } from '../../hooks/use-keyboard'
import { formatLinearMeasurement } from '../../lib/measurements'
import { triggerSFX } from '../../lib/sfx-bus'
import {
  clearSurfacePlanSnapFeedback,
  resolveSurfacePlanPointSnap,
} from '../../lib/surface-plan-snap'
import useEditor from '../../store/use-editor'
import { useFloorplanRender } from './floorplan-render-context'
import { FloorplanDimensionRenderer } from './renderers/floorplan-dimension-renderer'

const SEMANTIC_SNAP_DISTANCE = 0.2
const SEMANTIC_BYPASS_DISTANCE = 0.012
const MIN_DIMENSION_LENGTH = 0.001

type Draft = {
  anchors: MeasurementAnchor[]
  points: MeasurementPoint[]
}

type AssociatedPoint = {
  anchor: MeasurementAnchor
  point: MeasurementPoint
  semantic: boolean
}

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
): AssociatedPoint {
  if (!targetNodeId) return { anchor: point, point, semantic: false }
  const nodes = useScene.getState().nodes
  const node = nodes[targetNodeId as AnyNodeId]
  const contribution = node ? nodeRegistry.get(node.type)?.measurement : undefined
  if (!(node && contribution)) return { anchor: point, point, semantic: false }
  const context = geometryContext(node, nodes)
  const features = contribution.features(node, context)
  const match =
    contribution.match?.(node, context, point, maxDistance) ??
    closestMeasurementFeatureBinding(features, point, maxDistance)
  if (!match) return { anchor: point, point, semantic: false }

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
  return { anchor, point: match.point, semantic: true }
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

function previewGeometry(
  points: readonly [MeasurementPoint, MeasurementPoint],
  baselinePoint: MeasurementPoint,
  unit: 'metric' | 'imperial',
): Extract<FloorplanGeometry, { kind: 'dimension' }> | null {
  const dx = points[1][0] - points[0][0]
  const dz = points[1][2] - points[0][2]
  const magnitude = Math.hypot(dx, dz)
  if (magnitude <= MIN_DIMENSION_LENGTH) return null
  const direction: [number, number] = [dx / magnitude, dz / magnitude]
  const normal: [number, number] = [-direction[1], direction[0]]
  const project = (point: MeasurementPoint): [number, number] => {
    const along =
      (point[0] - baselinePoint[0]) * direction[0] + (point[2] - baselinePoint[2]) * direction[1]
    return [baselinePoint[0] + along * direction[0], baselinePoint[2] + along * direction[1]]
  }
  const dimensionStart = project(points[0])
  const dimensionEnd = project(points[1])
  const value = Math.abs(dx * direction[0] + dz * direction[1])
  return {
    kind: 'dimension',
    start: [points[0][0], points[0][2]],
    end: [points[1][0], points[1][2]],
    dimensionStart,
    dimensionEnd,
    offsetNormal: normal,
    offsetDistance: 0,
    extensionOvershoot: 0.12,
    text: formatLinearMeasurement(value, unit),
    stroke: '#06b6d4',
  }
}

export function FloorplanConstructionDimensionToolLayer() {
  const groupRef = useRef<SVGGElement>(null)
  const draftRef = useRef<Draft>({ anchors: [], points: [] })
  const [draft, setDraft] = useState<Draft>(draftRef.current)
  const [hover, setHover] = useState<AssociatedPoint | null>(null)
  const mode = useEditor((state) => state.mode)
  const tool = useEditor((state) => state.tool)
  const active = mode === 'build' && tool === 'construction-dimension'
  const activeLevelId = useViewer((state) => state.selection.levelId)
  const unit = useViewer((state) => state.unit)
  const renderContext = useFloorplanRender()

  const updateDraft = useCallback((next: Draft) => {
    draftRef.current = next
    setDraft(next)
  }, [])

  useEffect(() => {
    updateDraft({ anchors: [], points: [] })
    setHover(null)
    const group = groupRef.current
    const svg = group?.ownerSVGElement
    if (!(active && activeLevelId && group && svg)) return

    const consume = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }
    const resolveEvent = (event: MouseEvent | PointerEvent): AssociatedPoint | null => {
      const raw = clientToPlanPoint(group, event.clientX, event.clientY)
      if (!raw) return null
      const surface = resolveSurfacePlanPointSnap({
        rawPoint: [raw[0], raw[2]],
        fallbackPoint: [raw[0], raw[2]],
        levelId: activeLevelId,
        align: false,
        magnetic: !event.altKey,
      })
      const point: MeasurementPoint = [surface.point[0], 0, surface.point[1]]
      const targetNodeId = surface.wallIds[0] ?? registryTargetNodeId(event.target)
      return associatePoint(
        point,
        targetNodeId,
        event.altKey ? SEMANTIC_BYPASS_DISTANCE : SEMANTIC_SNAP_DISTANCE,
      )
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
      if (event.button !== 0 || event.detail > 1) return
      consume(event)
      const associated = resolveEvent(event)
      if (!associated) return
      const current = draftRef.current
      if (current.points.length === 0) {
        updateDraft({ anchors: [associated.anchor], points: [associated.point] })
        triggerSFX('sfx:grid-snap')
        return
      }
      if (current.points.length === 1) {
        if (
          Math.hypot(
            associated.point[0] - current.points[0]![0],
            associated.point[2] - current.points[0]![2],
          ) <= MIN_DIMENSION_LENGTH
        ) {
          return
        }
        updateDraft({
          anchors: [...current.anchors, associated.anchor],
          points: [...current.points, associated.point],
        })
        triggerSFX('sfx:grid-snap')
        return
      }

      const [start, end] = current.points as [MeasurementPoint, MeasurementPoint]
      const dx = end[0] - start[0]
      const dz = end[2] - start[2]
      const magnitude = Math.hypot(dx, dz)
      if (magnitude <= MIN_DIMENSION_LENGTH) return
      const node = ConstructionDimensionNode.parse({
        name: 'Construction Dimension',
        anchors: current.anchors as [MeasurementAnchor, MeasurementAnchor],
        baseline: {
          origin: [associated.point[0], associated.point[2]],
          direction: [dx / magnitude, dz / magnitude],
        },
      })
      useScene.getState().createNode(node, activeLevelId)
      useViewer.getState().setSelection({ selectedIds: [node.id] })
      triggerSFX('sfx:structure-build')
      useEditor.getState().setTool(null)
      useEditor.getState().setMode('select')
      updateDraft({ anchors: [], points: [] })
      setHover(null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      markToolCancelConsumed()
      const current = draftRef.current
      if (current.points.length > 0) {
        updateDraft({ anchors: current.anchors.slice(0, -1), points: current.points.slice(0, -1) })
        return
      }
      useEditor.getState().setTool(null)
      useEditor.getState().setMode('select')
    }
    const onBlur = () => clearSurfacePlanSnapFeedback()

    svg.addEventListener('pointerdown', onPointerDown, true)
    svg.addEventListener('pointermove', onPointerMove, true)
    svg.addEventListener('pointerleave', onPointerLeave, true)
    svg.addEventListener('click', onClick, true)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('blur', onBlur)
    return () => {
      clearSurfacePlanSnapFeedback()
      svg.removeEventListener('pointerdown', onPointerDown, true)
      svg.removeEventListener('pointermove', onPointerMove, true)
      svg.removeEventListener('pointerleave', onPointerLeave, true)
      svg.removeEventListener('click', onClick, true)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [active, activeLevelId, updateDraft])

  const preview = useMemo(() => {
    if (draft.points.length !== 2 || !hover) return null
    return previewGeometry(draft.points as [MeasurementPoint, MeasurementPoint], hover.point, unit)
  }, [draft.points, hover, unit])

  if (!(active && activeLevelId)) return null
  const unitsPerPixel = renderContext?.unitsPerPixel ?? 0.01
  const reticleRadius = 10 * unitsPerPixel
  const hoverColor = hover?.semantic ? '#22c55e' : '#06b6d4'

  return (
    <g ref={groupRef}>
      {draft.points.length === 1 && hover ? (
        <line
          pointerEvents="none"
          stroke="#06b6d4"
          strokeDasharray="6 5"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          x1={draft.points[0]![0]}
          x2={hover.point[0]}
          y1={draft.points[0]![2]}
          y2={hover.point[2]}
        />
      ) : null}
      {preview ? (
        <FloorplanDimensionRenderer
          annotationUnitsPerPoint={unitsPerPixel}
          geometry={preview}
          sceneRotationDeg={renderContext?.sceneRotationDeg ?? 0}
        />
      ) : null}
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
