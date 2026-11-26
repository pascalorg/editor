'use client'

import type { FloorplanToolContext } from '@pascal-app/editor'
import { useRef, useState } from 'react'
import { useGardenPlanTarget } from '../shared/garden-plan-draft'
import { useSiteFloorplanSvgInput } from '../shared/site-floorplan-draft'
import { planToSite, siteFloorplanFrame, siteFrame, siteToPlan } from '../shared/site-frame'
import { ownsRockPlacement, placeRock, planPointToSite, snapRockPlacementPoint } from './placement'
import { useRockPlacementScope } from './placement-scope'

/** Consume the SVG input before its forwarded grid event can reach the canvas tool. */
export default function FloorplanRockTool(context: FloorplanToolContext) {
  useRockPlacementScope()
  const groupRef = useRef<SVGGElement>(null)
  const { sceneApi, activeLevelId, drawingType = 'floor-plan', selectNode, finishTool } = context
  const [target, setTarget] = useState<[number, number] | null>(null)
  useGardenPlanTarget(target)
  useSiteFloorplanSvgInput({
    groupRef,
    ownsTarget: (el) => ownsRockPlacement('2d', el),
    onMove: (raw, event) => {
      const { building } = siteFloorplanFrame(
        siteFrame(sceneApi, activeLevelId)?.building ?? null,
        activeLevelId,
        drawingType,
      )
      setTarget(
        siteToPlan(building, snapRockPlacementPoint(planToSite(building, raw), event.altKey)),
      )
    },
    onLeave: () => setTarget(null),
    onClick: (raw, event) => {
      const at = snapRockPlacementPoint(
        planPointToSite(raw, { nodes: sceneApi.nodes(), activeLevelId, drawingType }),
        event.altKey,
      )
      const frame = siteFrame(sceneApi, activeLevelId)
      if (placeRock(sceneApi, at, selectNode, frame?.site.id)) finishTool()
    },
  })
  return <g ref={groupRef} />
}
