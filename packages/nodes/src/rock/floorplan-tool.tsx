'use client'

import type { FloorplanToolContext } from '@pascal-app/editor'
import { useEffect, useRef } from 'react'
import { siteFrame } from '../shared/site-frame'
import { ownsRockPlacement, placeRock, planPointToSite, snapRockPlacementPoint } from './placement'
import { useRockPlacementScope } from './placement-scope'

/** Consume the SVG input before its forwarded grid event can reach the canvas tool. */
export default function FloorplanRockTool(context: FloorplanToolContext) {
  useRockPlacementScope()
  const groupRef = useRef<SVGGElement>(null)
  const { sceneApi, activeLevelId, drawingType = 'floor-plan', selectNode, finishTool } = context
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
    svg.addEventListener('click', click, true)
    return () => {
      svg.removeEventListener('pointerdown', down, true)
      svg.removeEventListener('click', click, true)
    }
  }, [sceneApi, activeLevelId, drawingType, selectNode, finishTool])
  return <g ref={groupRef} />
}
