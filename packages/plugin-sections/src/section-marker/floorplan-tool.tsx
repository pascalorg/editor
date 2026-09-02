'use client'

import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import {
  type FloorplanToolContext,
  isGridSnapActive,
  useInteractionScope,
} from '@pascal-app/editor'
import { useEffect, useRef, useState } from 'react'
import { isSectionMarker } from '../kind-guards'
import { SectionMarkerNode } from '../schema'

type Point = [number, number]

function clientToPlanPoint(group: SVGGElement, clientX: number, clientY: number): Point | null {
  const matrix = group.getScreenCTM()
  if (!matrix) return null
  const local = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse())
  return [local.x, local.y]
}

/** A, B, C … skipping letters already used by existing markers on this scene. */
function nextLabel(nodes: Readonly<Record<AnyNodeId, AnyNode>>): string {
  const used = new Set<string>()
  for (const node of Object.values(nodes) as unknown[]) {
    if (isSectionMarker(node)) used.add(String(node.label ?? ''))
  }
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(65 + i)
    if (!used.has(letter)) return letter
  }
  return `S${used.size + 1}`
}

/**
 * Two-click placement of a section marker in the 2D plan: click the cut
 * line's start, click its end. The section looks toward the SCREEN-LEFT side
 * of the travel direction; hold Shift on the second click to flip it.
 */
export default function FloorplanSectionMarkerToolLayer({
  activeLevelId,
  finishTool,
  gridSnapStep,
  sceneApi,
  selectNode,
}: FloorplanToolContext) {
  const groupRef = useRef<SVGGElement>(null)
  const startRef = useRef<Point | null>(null)
  const [start, setStart] = useState<Point | null>(null)
  const [cursor, setCursor] = useState<Point | null>(null)

  useEffect(() => {
    useInteractionScope.getState().begin({ kind: 'drafting', tool: 'section-marker' })
    return () =>
      useInteractionScope
        .getState()
        .endIf((scope) => scope.kind === 'drafting' && scope.tool === 'section-marker')
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
    const consume = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }
    const onPointerMove = (event: PointerEvent) => {
      const raw = clientToPlanPoint(group, event.clientX, event.clientY)
      if (raw) setCursor(snap(raw, event.altKey))
    }
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0) return
      consume(event)
      const raw = clientToPlanPoint(group, event.clientX, event.clientY)
      if (!raw) return
      const point = snap(raw, event.altKey)
      const first = startRef.current
      if (!first) {
        startRef.current = point
        setStart(point)
        return
      }
      if (Math.hypot(point[0] - first[0], point[1] - first[1]) < 0.1) return
      const node = SectionMarkerNode.parse({
        name: 'Section',
        label: nextLabel(sceneApi.nodes()),
        levelId: activeLevelId,
        start: first,
        end: point,
        lookDirection: event.shiftKey ? 'right' : 'left',
      })
      sceneApi.upsert(node as unknown as AnyNode, activeLevelId ?? undefined)
      selectNode(node.id as AnyNodeId)
      startRef.current = null
      setStart(null)
      finishTool()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (startRef.current) {
        startRef.current = null
        setStart(null)
      } else finishTool()
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
      {start && cursor ? (
        <line
          x1={start[0]}
          y1={start[1]}
          x2={cursor[0]}
          y2={cursor[1]}
          stroke="#111111"
          strokeWidth={0.035}
          strokeDasharray="0.2 0.12"
        />
      ) : null}
      {start ? <circle cx={start[0]} cy={start[1]} r={0.08} fill="#111111" /> : null}
    </g>
  )
}
