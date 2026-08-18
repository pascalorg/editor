'use client'

import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { getWallCurveFrameAt, getWallCurveLength, isCurvedWall } from '@pascal-app/core'
import {
  type FloorplanToolContext,
  markToolCancelConsumed,
  triggerSFX,
  useEditor,
  useInteractionScope,
} from '@pascal-app/editor'
import { useCallback, useEffect, useRef, useState } from 'react'
import { findClosestWallInPlan } from '../shared/wall-attach-target'
import { bendLocalPoint, isCurvedLeanTo } from './arc'
import { createLeanToAssembly } from './assembly'
import { leanToFacetCount } from './geometry'
import { resolveLeanToSpanArc, resolveLeanToWallPlacement } from './layout'
import { leanToPlacementConflicts, resolveLeanToEndAbutments } from './placement-validation'
import {
  applyLeanToAvailableWallSpan,
  applyLeanToRoofAttachment,
  applyLeanToWallAutoSpan,
  clearLeanToRoofAttachment,
  resolveLeanToHostRoof,
  resolveLeanToRoofAttachment,
} from './roof-attachment'
import type { LeanToExtensionNode } from './schema'

type PlanPoint = [number, number]

function clientToPlanPoint(group: SVGGElement, clientX: number, clientY: number): PlanPoint | null {
  const matrix = group.getScreenCTM()
  if (!matrix) return null
  const local = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse())
  return [local.x, local.y]
}

const FloorplanLeanToExtensionTool = ({
  activeLevelId,
  finishTool,
  sceneApi,
  selectNode,
}: FloorplanToolContext) => {
  const groupRef = useRef<SVGGElement>(null)
  const targetRef = useRef<LeanToExtensionNode | null>(null)
  const [target, setTarget] = useState<LeanToExtensionNode | null>(null)

  const clearTarget = useCallback(() => {
    targetRef.current = null
    setTarget(null)
  }, [])

  useEffect(() => {
    if (!activeLevelId) return
    const group = groupRef.current
    const svg = group?.ownerSVGElement
    if (!(group && svg)) return
    useInteractionScope.getState().begin({ kind: 'drafting', tool: 'lean-to-extension' })

    const consume = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }
    const resolveEvent = (event: MouseEvent | PointerEvent) => {
      const point = clientToPlanPoint(group, event.clientX, event.clientY)
      if (!point) return null
      const hit = findClosestWallInPlan(
        point,
        sceneApi.nodes() as Record<AnyNodeId, AnyNode>,
        activeLevelId,
      )
      if (!hit) return null
      const wallPlacement = resolveLeanToWallPlacement(hit.wall, hit.localX, hit.side)
      if (!wallPlacement) return null
      const nodes = sceneApi.nodes() as Record<AnyNodeId, AnyNode>
      const attachment = resolveLeanToRoofAttachment(wallPlacement, hit.wall, nodes)
      const autoSpannedNode = attachment
        ? applyLeanToRoofAttachment(wallPlacement, attachment)
        : applyLeanToWallAutoSpan(clearLeanToRoofAttachment(wallPlacement), hit.wall)
      const attachedNode = applyLeanToAvailableWallSpan(
        autoSpannedNode,
        hit.wall,
        nodes,
        wallPlacement.position[0],
      )
      const node = resolveLeanToEndAbutments(attachedNode, hit.wall, nodes)
      return leanToPlacementConflicts(node, hit.wall, nodes).length === 0 ? node : null
    }
    const update = (event: PointerEvent) => {
      consume(event)
      const node = resolveEvent(event)
      targetRef.current = node
      setTarget(node)
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.button === 0) consume(event)
    }
    const commit = (event: MouseEvent) => {
      if (event.button !== 0) return
      consume(event)
      const node = resolveEvent(event) ?? targetRef.current
      if (!node) return
      const nodes = sceneApi.nodes() as Record<AnyNodeId, AnyNode>
      const assembly = createLeanToAssembly(node, resolveLeanToHostRoof(node, nodes), nodes)
      sceneApi.createMany?.([
        { node: assembly.extension, parentId: node.parentId as AnyNodeId },
        ...assembly.children.map((child) => ({
          node: child,
          parentId: (child.parentId as AnyNodeId | null) ?? undefined,
        })),
      ])
      selectNode(assembly.extension.id)
      triggerSFX('sfx:structure-build')
      if (useEditor.getState().getContinuation('point') !== 'repeat') finishTool()
    }
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      markToolCancelConsumed()
      finishTool()
    }

    svg.addEventListener('pointerdown', onPointerDown, true)
    svg.addEventListener('pointermove', update, true)
    svg.addEventListener('pointerleave', clearTarget, true)
    svg.addEventListener('click', commit, true)
    window.addEventListener('keydown', cancel, true)
    return () => {
      svg.removeEventListener('pointerdown', onPointerDown, true)
      svg.removeEventListener('pointermove', update, true)
      svg.removeEventListener('pointerleave', clearTarget, true)
      svg.removeEventListener('click', commit, true)
      window.removeEventListener('keydown', cancel, true)
      clearTarget()
      useInteractionScope
        .getState()
        .endIf((scope) => scope.kind === 'drafting' && scope.tool === 'lean-to-extension')
    }
  }, [activeLevelId, clearTarget, finishTool, sceneApi, selectNode])

  if (!activeLevelId) return null
  const wall = target?.parentId ? sceneApi.get(target.parentId as AnyNodeId) : null
  if (!(target && wall?.type === 'wall')) return <g ref={groupRef} />

  const sign = Math.cos(target.rotation[1]) >= 0 ? 1 : -1
  // Recompute the local arc from the final placed span/position so the preview
  // footprint bends the same way reconciliation will store it.
  const spanArc = resolveLeanToSpanArc(wall, target)
  const previewNode = {
    ...target,
    spanArcCenterZ: spanArc?.centerZ,
    spanArcRadius: spanArc?.radius,
  }
  const curved = isCurvedLeanTo(previewNode) && isCurvedWall(wall)

  let originX: number
  let originZ: number
  let alongX: number
  let alongZ: number
  let perpX: number
  let perpZ: number
  if (curved) {
    const arcLength = getWallCurveLength(wall)
    const t = Math.max(0, Math.min(1, arcLength > 1e-6 ? target.position[0] / arcLength : 0))
    const frame = getWallCurveFrameAt(wall, t)
    alongX = frame.tangent.x
    alongZ = frame.tangent.y
    perpX = frame.normal.x
    perpZ = frame.normal.y
    originX = frame.point.x + perpX * target.position[2]
    originZ = frame.point.y + perpZ * target.position[2]
  } else {
    const dx = wall.end[0] - wall.start[0]
    const dz = wall.end[1] - wall.start[1]
    const length = Math.hypot(dx, dz)
    alongX = dx / length
    alongZ = dz / length
    perpX = -alongZ
    perpZ = alongX
    originX = wall.start[0] + alongX * target.position[0] + perpX * target.position[2]
    originZ = wall.start[1] + alongZ * target.position[0] + perpZ * target.position[2]
  }
  const outX = perpX * sign
  const outZ = perpZ * sign
  const toWorld = (localX: number, localZ: number): [number, number] => {
    if (curved) {
      const bent = bendLocalPoint(previewNode, localX, localZ)
      return [originX + alongX * bent.x + outX * bent.y, originZ + alongZ * bent.x + outZ * bent.y]
    }
    return [originX + alongX * localX + outX * localZ, originZ + alongZ * localX + outZ * localZ]
  }
  const left = target.span / 2 + target.leftOverhang
  const right = target.span / 2 + target.rightOverhang
  const high = target.highOverhang
  const low = target.projection + target.lowOverhang
  const facets = curved ? leanToFacetCount(previewNode) : 1
  const highEdge: [number, number][] = []
  const lowEdge: [number, number][] = []
  for (let i = 0; i <= facets; i++) {
    const localX = -left + ((right + left) * i) / facets
    highEdge.push(toWorld(localX, -high))
    lowEdge.push(toWorld(localX, low))
  }
  const points = [...highEdge, ...lowEdge.reverse()]

  return (
    <g ref={groupRef}>
      <polygon
        fill="rgba(14, 165, 233, 0.2)"
        pointerEvents="none"
        points={points.map((point) => point.join(',')).join(' ')}
        stroke="#0ea5e9"
        strokeDasharray="6 4"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
    </g>
  )
}

export default FloorplanLeanToExtensionTool
