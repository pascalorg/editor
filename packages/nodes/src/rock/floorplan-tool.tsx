'use client'

import type { FloorplanToolContext } from '@pascal-app/editor'
import { useEffect, useRef, useState } from 'react'
import { publishGardenPlanPointer, useGardenPlanTarget } from '../shared/garden-plan-draft'
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
  useEffect(() => {
    const group = groupRef.current
    const svg = group?.ownerSVGElement
    if (!(svg && group)) return
    const consume = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }
    const down = (event: PointerEvent) => {
      if (event.button === 0 && ownsRockPlacement('2d', event.target)) consume(event)
    }
    // A plain hover is taken before the panel sees it (it would clear the plan's target for a tool
    // it does not know); any move with a button held (a pan, a drag) is left to the panel.
    const move = (event: PointerEvent) => {
      if (event.buttons !== 0 || !ownsRockPlacement('2d', event.target)) return
      const matrix = group.getScreenCTM()
      if (!matrix) return
      consume(event)
      publishGardenPlanPointer(svg, event)
      const raw = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
      const { building } = siteFloorplanFrame(
        siteFrame(sceneApi, activeLevelId)?.building ?? null,
        activeLevelId,
        drawingType,
      )
      // The target stands where a click would set the rock, snapping included.
      setTarget(
        siteToPlan(
          building,
          snapRockPlacementPoint(planToSite(building, [raw.x, raw.y]), event.altKey),
        ),
      )
    }
    const leave = () => setTarget(null)
    const click = (event: MouseEvent) => {
      if (event.button !== 0 || !ownsRockPlacement('2d', event.target)) return
      consume(event)
      const matrix = group.getScreenCTM()
      if (!matrix) return
      const raw = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
      const at = snapRockPlacementPoint(
        planPointToSite([raw.x, raw.y], { nodes: sceneApi.nodes(), activeLevelId, drawingType }),
        event.altKey,
      )
      const frame = siteFrame(sceneApi, activeLevelId)
      if (placeRock(sceneApi, at, selectNode, frame?.site.id)) finishTool()
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
  }, [sceneApi, activeLevelId, drawingType, selectNode, finishTool])
  return <g ref={groupRef} />
}
