'use client'

import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import {
  type FloorplanToolContext,
  isGridSnapActive,
  useInteractionScope,
} from '@pascal-app/editor'
import { useEffect, useRef, useState } from 'react'
import { isElevationMarker } from '../kind-guards'
import { ElevationMarkerNode } from '../schema'

type Point = [number, number]

function clientToPlanPoint(group: SVGGElement, clientX: number, clientY: number): Point | null {
  const matrix = group.getScreenCTM()
  if (!matrix) return null
  const local = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse())
  return [local.x, local.y]
}

function nextLabel(nodes: Readonly<Record<AnyNodeId, AnyNode>>): string {
  let count = 0
  for (const node of Object.values(nodes) as unknown[]) {
    if (isElevationMarker(node)) count++
  }
  return String(count + 1)
}

/**
 * One-click placement of an elevation marker. The direction comes from the
 * tool defaults (`toolDefaults.direction`, default `north`); the compass
 * label under the bubble names it.
 */
export default function FloorplanElevationMarkerToolLayer({
  activeLevelId,
  finishTool,
  gridSnapStep,
  sceneApi,
  selectNode,
  toolDefaults,
}: FloorplanToolContext) {
  const groupRef = useRef<SVGGElement>(null)
  const [cursor, setCursor] = useState<Point | null>(null)
  const directionRef = useRef<string>(
    typeof toolDefaults?.direction === 'string' ? toolDefaults.direction : 'north',
  )

  useEffect(() => {
    useInteractionScope.getState().begin({ kind: 'drafting', tool: 'elevation-marker' })
    return () =>
      useInteractionScope
        .getState()
        .endIf((scope) => scope.kind === 'drafting' && scope.tool === 'elevation-marker')
  }, [])

  useEffect(() => {
    const group = groupRef.current
    const svg = group?.ownerSVGElement
    if (!(group && svg)) return

    const snap = (point: Point, altKey: boolean): Point => {
      const step = altKey || !isGridSnapActive() ? 0 : gridSnapStep
      return step > 0
        ? [Math.round(point[0] / step) * step, Math.round(point[1] / step) * step]
        : point
    }
    const onPointerMove = (event: PointerEvent) => {
      const raw = clientToPlanPoint(group, event.clientX, event.clientY)
      if (raw) setCursor(snap(raw, event.altKey))
    }
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      const raw = clientToPlanPoint(group, event.clientX, event.clientY)
      if (!raw) return
      const point = snap(raw, event.altKey)
      const node = ElevationMarkerNode.parse({
        name: 'Elevation',
        label: nextLabel(sceneApi.nodes()),
        direction: directionRef.current,
        position: point,
      })
      sceneApi.upsert(node as unknown as AnyNode, activeLevelId ?? undefined)
      selectNode(node.id as AnyNodeId)
      finishTool()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finishTool()
    }

    svg.addEventListener('pointermove', onPointerMove)
    svg.addEventListener('click', onClick, { capture: true })
    window.addEventListener('keydown', onKeyDown)
    return () => {
      svg.removeEventListener('pointermove', onPointerMove)
      svg.removeEventListener('click', onClick, { capture: true } as EventListenerOptions)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [activeLevelId, finishTool, gridSnapStep, sceneApi, selectNode])

  return (
    <g ref={groupRef} pointerEvents="none">
      {cursor ? (
        <circle
          cx={cursor[0]}
          cy={cursor[1]}
          r={0.36}
          fill="none"
          stroke="#111111"
          strokeWidth={0.02}
          strokeDasharray="0.1 0.08"
        />
      ) : null}
    </g>
  )
}
