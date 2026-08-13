'use client'

import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import {
  type FloorplanToolContext,
  markToolCancelConsumed,
  triggerSFX,
  useEditor,
  useInteractionScope,
} from '@pascal-app/editor'
import { useCallback, useEffect, useRef, useState } from 'react'
import { findClosestWallInPlan } from '../shared/wall-attach-target'
import { createLeanToAssembly } from './assembly'
import { resolveLeanToWallPlacement } from './layout'
import {
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
      return attachment
        ? applyLeanToRoofAttachment(wallPlacement, attachment)
        : applyLeanToWallAutoSpan(clearLeanToRoofAttachment(wallPlacement), hit.wall)
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
      const assembly = createLeanToAssembly(node, resolveLeanToHostRoof(node, nodes))
      useScene.getState().createNodes([
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

  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dz)
  const dirX = dx / length
  const dirZ = dz / length
  const perpX = -dirZ
  const perpZ = dirX
  const sign = Math.cos(target.rotation[1]) >= 0 ? 1 : -1
  const originX = wall.start[0] + dirX * target.position[0] + perpX * target.position[2]
  const originZ = wall.start[1] + dirZ * target.position[0] + perpZ * target.position[2]
  const outX = perpX * sign
  const outZ = perpZ * sign
  const half = target.span / 2 + target.sideOverhang
  const run = target.projection + target.eaveOverhang
  const points = [
    [originX - dirX * half, originZ - dirZ * half],
    [originX + dirX * half, originZ + dirZ * half],
    [originX + dirX * half + outX * run, originZ + dirZ * half + outZ * run],
    [originX - dirX * half + outX * run, originZ - dirZ * half + outZ * run],
  ]

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
