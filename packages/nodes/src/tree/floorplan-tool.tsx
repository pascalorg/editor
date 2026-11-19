'use client'

import { usePascalI18n } from '@pascal-app/core'
import { type FloorplanToolContext, TOOL_INVALID_COLOR } from '@pascal-app/editor'
import { type RefObject, useEffect, useRef, useState } from 'react'
import { publishGardenPlanPointer, useGardenPlanTarget } from '../shared/garden-plan-draft'
import { planToSite, siteFloorplanFrame, siteFrame, siteToPlan } from '../shared/site-frame'
import { ownsTreePlacement, placeTree, snapTreePlacementPoint } from './placement'
import { treePlacementMessage } from './placement-message'
import { useTreePlacementScope } from './placement-scope'

type PlacementRefusal = { code: string; at: [number, number] }

function useFloorplanTreePlacementInput(
  context: FloorplanToolContext,
  groupRef: RefObject<SVGGElement | null>,
  onRefusal: (refusal: PlacementRefusal) => void,
  onTarget: (planPoint: [number, number] | null) => void,
) {
  const { sceneApi, activeLevelId, drawingType = 'floor-plan', selectNode, finishTool } = context
  useEffect(() => {
    const group = groupRef.current
    const svg = group?.ownerSVGElement
    if (!svg || !group) return
    const consume = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }
    const down = (event: PointerEvent) => {
      if (event.button === 0 && ownsTreePlacement('2d', event.target)) consume(event)
    }
    // A plain hover is taken before the panel sees it (it would clear the plan's target for a tool
    // it does not know); any move with a button held (a pan, a drag) is left to the panel.
    const move = (event: PointerEvent) => {
      if (event.buttons !== 0 || !ownsTreePlacement('2d', event.target)) return
      const matrix = group.getScreenCTM()
      if (!matrix) return
      consume(event)
      publishGardenPlanPointer(svg, event)
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
      const frame = siteFrame(sceneApi, activeLevelId)
      const { building } = siteFloorplanFrame(frame?.building ?? null, activeLevelId, drawingType)
      // The target stands where a click would plant, snapping included.
      onTarget(
        siteToPlan(
          building,
          snapTreePlacementPoint(planToSite(building, [point.x, point.y]), event.altKey),
        ),
      )
    }
    const leave = () => onTarget(null)
    const click = (event: MouseEvent) => {
      if (event.button !== 0 || !ownsTreePlacement('2d', event.target)) return
      consume(event)
      const matrix = group.getScreenCTM()
      if (!matrix) return
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
      const frame = siteFrame(sceneApi, activeLevelId)
      const { building } = siteFloorplanFrame(frame?.building ?? null, activeLevelId, drawingType)
      const at = snapTreePlacementPoint(planToSite(building, [point.x, point.y]), event.altKey)
      if (
        placeTree(sceneApi, at, selectNode, frame?.site.id, (code) =>
          onRefusal({ code, at: [point.x, point.y] }),
        )
      )
        finishTool()
    }
    svg.addEventListener('pointerdown', down, true)
    svg.addEventListener('pointermove', move, true)
    svg.addEventListener('pointerleave', leave)
    svg.addEventListener('click', click, true)
    return () => {
      svg.removeEventListener('pointerdown', down, true)
      svg.removeEventListener('pointermove', move, true)
      svg.removeEventListener('pointerleave', leave)
      svg.removeEventListener('click', click, true)
    }
  }, [sceneApi, activeLevelId, drawingType, selectNode, finishTool, groupRef, onRefusal, onTarget])
}

export default function FloorplanTreeTool(context: FloorplanToolContext) {
  useTreePlacementScope()
  const i18n = usePascalI18n()
  const groupRef = useRef<SVGGElement>(null)
  const [refusal, setRefusal] = useState<PlacementRefusal | null>(null)
  const [target, setTarget] = useState<[number, number] | null>(null)
  useFloorplanTreePlacementInput(context, groupRef, setRefusal, setTarget)
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
