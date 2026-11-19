'use client'

import type { FloorplanToolContext } from '@pascal-app/editor'
import { useEffect, useRef } from 'react'
import { GardenPlanDraft, publishGardenPlanPointer } from '../shared/garden-plan-draft'
import { planToSite, siteFloorplanFrame, siteFrame, siteToPlan } from '../shared/site-frame'
import { snapPlantingDraftPoint, usePlantingDraft, usePlantingDraftController } from './draft'

/** SVG coordinates are building-local in a floor plan, Site-local in a site plan. */
export default function FloorplanPlantingTool(context: FloorplanToolContext) {
  const groupRef = useRef<SVGGElement>(null)
  const frame = siteFrame(context.sceneApi, context.activeLevelId)
  const { building } = siteFloorplanFrame(
    frame?.building ?? null,
    context.activeLevelId,
    context.drawingType ?? 'floor-plan',
  )
  const { addPoint, error } = usePlantingDraftController({
    ...context,
    siteId: frame?.site.id,
    view: '2d',
  })
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
      return snapPlantingDraftPoint(planToSite(building, [point.x, point.y]), event.altKey)
    }
    const down = (event: PointerEvent) => {
      if (event.button === 0) consume(event)
    }
    const move = (event: PointerEvent) => {
      if (event.buttons & 0b110) return
      consume(event)
      publishGardenPlanPointer(svg, event)
      usePlantingDraft.setState({ hover: resolve(event) })
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
  const draft = usePlantingDraft()
  return (
    <g ref={groupRef}>
      <GardenPlanDraft
        closed
        hover={draft.hover ? siteToPlan(building, draft.hover) : null}
        message={error}
        points={draft.points.map((point) => siteToPlan(building, point))}
      />
    </g>
  )
}
