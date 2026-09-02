'use client'

import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { type FloorplanToolContext, useInteractionScope } from '@pascal-app/editor'
import { useEffect, useRef, useState } from 'react'
import { SYSTEM_COLOR, UtilityPoleNode } from '../schema'
import {
  clientToPlanPoint,
  consumeEvent,
  type PlanPoint,
  planToSite,
  resolveToolFrame,
  snapPlanPoint,
} from '../tool-support'

/** One-click pole placement. The ghost is the same circle-and-cross symbol. */
export default function FloorplanUtilityPoleToolLayer({
  activeLevelId,
  finishTool,
  gridSnapStep,
  sceneApi,
  selectNode,
}: FloorplanToolContext) {
  const groupRef = useRef<SVGGElement>(null)
  const [cursor, setCursor] = useState<PlanPoint | null>(null)

  useEffect(() => {
    useInteractionScope.getState().begin({ kind: 'drafting', tool: 'utility-pole' })
    return () =>
      useInteractionScope
        .getState()
        .endIf((scope) => scope.kind === 'drafting' && scope.tool === 'utility-pole')
  }, [])

  useEffect(() => {
    const group = groupRef.current
    const svg = group?.ownerSVGElement
    if (!(group && svg)) return

    const onPointerMove = (event: PointerEvent) => {
      const raw = clientToPlanPoint(group, event.clientX, event.clientY)
      if (raw) setCursor(snapPlanPoint(raw, event.altKey, gridSnapStep))
    }
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0) return
      consumeEvent(event)
      const raw = clientToPlanPoint(group, event.clientX, event.clientY)
      if (!raw) return
      const { buildingId, planFrame } = resolveToolFrame(sceneApi, activeLevelId)
      const site = planToSite(planFrame, snapPlanPoint(raw, event.altKey, gridSnapStep))
      const node = UtilityPoleNode.parse({ name: 'Utility pole', position: site })
      sceneApi.upsert(node as unknown as AnyNode, buildingId ?? undefined)
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

  if (!cursor) return <g pointerEvents="none" ref={groupRef} />
  const [cx, cy] = cursor
  const r = 0.45
  const arm = r * 1.45
  return (
    <g pointerEvents="none" ref={groupRef}>
      <circle
        cx={cx}
        cy={cy}
        fill="#ffffff"
        fillOpacity={0.7}
        r={r}
        stroke={SYSTEM_COLOR.power}
        strokeWidth={0.07}
      />
      <line stroke={SYSTEM_COLOR.power} strokeWidth={0.07} x1={cx - arm} x2={cx + arm} y1={cy} y2={cy} />
      <line stroke={SYSTEM_COLOR.power} strokeWidth={0.07} x1={cx} x2={cx} y1={cy - arm} y2={cy + arm} />
    </g>
  )
}
