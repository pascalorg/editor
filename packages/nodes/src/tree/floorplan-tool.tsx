'use client'

import { usePascalI18n } from '@pascal-app/core'
import { type FloorplanToolContext, TOOL_INVALID_COLOR } from '@pascal-app/editor'
import { useRef, useState } from 'react'
import { useGardenPlanTarget } from '../shared/garden-plan-draft'
import { useSiteFloorplanSvgInput } from '../shared/site-floorplan-draft'
import { planToSite, siteFloorplanFrame, siteFrame, siteToPlan } from '../shared/site-frame'
import { ownsTreePlacement, placeTree, snapTreePlacementPoint } from './placement'
import { treePlacementMessage } from './placement-message'
import { useTreePlacementScope } from './placement-scope'

type PlacementRefusal = { code: string; at: [number, number] }

export default function FloorplanTreeTool(context: FloorplanToolContext) {
  useTreePlacementScope()
  const i18n = usePascalI18n()
  const groupRef = useRef<SVGGElement>(null)
  const { sceneApi, activeLevelId, drawingType = 'floor-plan', selectNode, finishTool } = context
  const [refusal, setRefusal] = useState<PlacementRefusal | null>(null)
  const [target, setTarget] = useState<[number, number] | null>(null)
  useSiteFloorplanSvgInput({
    groupRef,
    ownsTarget: (el) => ownsTreePlacement('2d', el),
    onMove: (raw, event) => {
      const frame = siteFrame(sceneApi, activeLevelId)
      const { building } = siteFloorplanFrame(frame?.building ?? null, activeLevelId, drawingType)
      setTarget(
        siteToPlan(building, snapTreePlacementPoint(planToSite(building, raw), event.altKey)),
      )
    },
    onLeave: () => setTarget(null),
    onClick: (raw, event) => {
      const frame = siteFrame(sceneApi, activeLevelId)
      const { building } = siteFloorplanFrame(frame?.building ?? null, activeLevelId, drawingType)
      const at = snapTreePlacementPoint(planToSite(building, raw), event.altKey)
      if (
        placeTree(sceneApi, at, selectNode, frame?.site.id, (code) => setRefusal({ code, at: raw }))
      )
        finishTool()
    },
  })
  useGardenPlanTarget(target)
  return (
    <g ref={groupRef}>
      {refusal && (
        <text
          aria-live="polite"
          fill={TOOL_INVALID_COLOR}
          fontSize={0.18}
          pointerEvents="none"
          x={refusal.at[0]}
          y={refusal.at[1] - 0.25}
        >
          {treePlacementMessage(refusal.code, i18n)}
        </text>
      )}
    </g>
  )
}
