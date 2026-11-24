'use client'

import type { FloorplanToolContext } from '@pascal-app/editor'
import { useRef } from 'react'
import { GardenPlanDraft } from '../shared/garden-plan-draft'
import { useSiteFloorplanSvgInput } from '../shared/site-floorplan-draft'
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
  const { addPoint, finish, error } = usePlantingDraftController({
    ...context,
    siteId: frame?.site.id,
    view: '2d',
  })
  const resolve = (raw: [number, number], altKey: boolean) =>
    snapPlantingDraftPoint(planToSite(building, raw), altKey)
  useSiteFloorplanSvgInput({
    groupRef,
    allowButtonHeldHover: true,
    onMove: (raw, event) => usePlantingDraft.setState({ hover: resolve(raw, event.altKey) }),
    onClick: (raw, event) => addPoint(resolve(raw, event.altKey)),
    onDoubleClick: () => finish(),
  })
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
