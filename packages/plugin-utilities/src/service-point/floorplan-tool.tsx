'use client'

import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { type FloorplanToolContext, useInteractionScope } from '@pascal-app/editor'
import { useEffect, useRef, useState } from 'react'
import { nearestWall } from '../anchor'
import {
  SERVICE_POINT_SYSTEM,
  type ServicePointKind,
  ServicePointNode,
  SYSTEM_COLOR,
} from '../schema'
import { siteToLocalPlan } from '../site-frame'
import {
  clientToPlanPoint,
  consumeEvent,
  type PlanPoint,
  planToSite,
  resolveToolFrame,
  snapPlanPoint,
} from '../tool-support'

/** How far from a wall centreline a click still counts as "on that wall". */
const WALL_SNAP_RADIUS = 1.5

/**
 * One-click service-point placement, snapping to a wall face when the click
 * lands near one.
 *
 * The wall search runs in BUILDING-LOCAL metres, because that is the frame
 * `wall.start` / `wall.end` are stored in (`anchor.ts`). A hit writes the
 * `wallId` + `wallT` anchor and leaves `position` at its default; a miss
 * writes the free-standing SITE `position` instead.
 *
 * `serviceKind` comes from `toolDefaults['service-point']`, seeded by the
 * Utilities panel before it activates the tool.
 */
export default function FloorplanServicePointToolLayer({
  activeLevelId,
  finishTool,
  gridSnapStep,
  sceneApi,
  selectNode,
  toolDefaults,
}: FloorplanToolContext) {
  const groupRef = useRef<SVGGElement>(null)
  const [cursor, setCursor] = useState<PlanPoint | null>(null)
  const [snapped, setSnapped] = useState(false)

  const rawKind = toolDefaults?.serviceKind
  const serviceKind = (typeof rawKind === 'string' ? rawKind : 'electric-meter') as ServicePointKind

  useEffect(() => {
    useInteractionScope.getState().begin({ kind: 'drafting', tool: 'service-point' })
    return () =>
      useInteractionScope
        .getState()
        .endIf((scope) => scope.kind === 'drafting' && scope.tool === 'service-point')
  }, [])

  useEffect(() => {
    const group = groupRef.current
    const svg = group?.ownerSVGElement
    if (!(group && svg)) return

    const resolve = (event: MouseEvent | PointerEvent) => {
      const raw = clientToPlanPoint(group, event.clientX, event.clientY)
      if (!raw) return null
      const { buildingId, frame, planFrame } = resolveToolFrame(sceneApi, activeLevelId)
      const plan = snapPlanPoint(raw, event.altKey, gridSnapStep)
      const site = planToSite(planFrame, plan)
      // The wall frame is building-local regardless of which 2D view is up.
      const local = siteToLocalPlan(frame, site)
      const nodes = sceneApi.nodes() as unknown as Record<string, Record<string, unknown>>
      const hit = event.altKey ? null : nearestWall(nodes, local, WALL_SNAP_RADIUS)
      return { buildingId, plan, site, hit }
    }

    const onPointerMove = (event: PointerEvent) => {
      const resolved = resolve(event)
      if (!resolved) return
      setCursor(resolved.plan)
      setSnapped(!!resolved.hit)
    }
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0) return
      consumeEvent(event)
      const resolved = resolve(event)
      if (!resolved) return
      const node = ServicePointNode.parse(
        resolved.hit
          ? {
              name: 'Service point',
              serviceKind,
              wallId: resolved.hit.geom.id,
              wallT: resolved.hit.t,
            }
          : {
              name: 'Service point',
              serviceKind,
              position: [resolved.site[0], 0, resolved.site[1]],
            },
      )
      sceneApi.upsert(node as unknown as AnyNode, resolved.buildingId ?? undefined)
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
  }, [activeLevelId, finishTool, gridSnapStep, sceneApi, selectNode, serviceKind])

  if (!cursor) return <g pointerEvents="none" ref={groupRef} />
  const color = SYSTEM_COLOR[SERVICE_POINT_SYSTEM[serviceKind]]
  return (
    <g pointerEvents="none" ref={groupRef}>
      <circle
        cx={cursor[0]}
        cy={cursor[1]}
        fill={snapped ? color : '#ffffff'}
        fillOpacity={snapped ? 0.6 : 0.7}
        r={0.34}
        stroke={color}
        strokeWidth={0.06}
      />
    </g>
  )
}
