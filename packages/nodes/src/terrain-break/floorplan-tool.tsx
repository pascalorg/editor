'use client'

import type { FloorplanToolContext } from '@pascal-app/editor'
import { useEffect, useRef } from 'react'
import { rampFloorplanFrame, rampPlanToSite, rampSiteToPlan } from '../ramp/edit'
import {
  TerrainBreakDraftControls,
  useTerrainBreakDraft,
  useTerrainBreakDraftController,
} from './draft'

export default function FloorplanTerrainBreakTool(context: FloorplanToolContext) {
  const groupRef = useRef<SVGGElement>(null)
  const { frame, line, addPoint } = useTerrainBreakDraftController({ ...context, view: '2d' })
  const { building } = rampFloorplanFrame(
    frame?.building ?? null,
    context.activeLevelId,
    'floor-plan',
  )
  useEffect(() => {
    const group = groupRef.current
    const svg = group?.ownerSVGElement
    if (!group || !svg) return
    const consume = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }
    const resolve = (event: MouseEvent | PointerEvent) => {
      const matrix = group.getScreenCTM()
      if (!matrix) return null
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
      return rampPlanToSite(building, [point.x, point.y])
    }
    const down = (event: PointerEvent) => {
      if (event.button === 0) consume(event)
    }
    const move = (event: PointerEvent) => {
      if (event.buttons & 0b110) return
      consume(event)
      useTerrainBreakDraft.setState({ hover: resolve(event) })
    }
    const click = (event: MouseEvent) => {
      if (event.button !== 0) return
      consume(event)
      const point = resolve(event)
      if (point) addPoint(point)
    }
    svg.addEventListener('pointerdown', down, true)
    svg.addEventListener('pointermove', move, true)
    svg.addEventListener('click', click, true)
    return () => {
      svg.removeEventListener('pointerdown', down, true)
      svg.removeEventListener('pointermove', move, true)
      svg.removeEventListener('click', click, true)
    }
  }, [addPoint, building])
  return (
    <g ref={groupRef}>
      <polyline
        fill="none"
        pointerEvents="none"
        points={line.map((point) => rampSiteToPlan(building, point).join(',')).join(' ')}
        stroke="#0284c7"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
      <TerrainBreakDraftControls view="2d" />
    </g>
  )
}
