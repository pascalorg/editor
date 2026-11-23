'use client'

import type { FloorplanToolContext } from '@pascal-app/editor'
import { useRef } from 'react'
import { GardenPlanDraft } from '../shared/garden-plan-draft'
import { useSiteFloorplanSvgInput } from '../shared/site-floorplan-draft'
import { planToSite, siteFloorplanFrame, siteFrame, siteToPlan } from '../shared/site-frame'
import { snapHedgeDraftPoint, useHedgeDraft, useHedgeDraftController } from './draft'

/**
 * Draws a hedge on the plan, in the frame the drawing is in (a floor plan in its building's, a
 * site plan in the Site's); the points are kept in Site metres, as the 3D tool keeps them.
 */
export default function FloorplanHedgeTool(context: FloorplanToolContext) {
  const groupRef = useRef<SVGGElement>(null)
  const frame = siteFrame(context.sceneApi, context.activeLevelId)
  const { addPoint, error } = useHedgeDraftController({
    ...context,
    siteId: frame?.site.id,
    view: '2d',
  })
  const { building } = siteFloorplanFrame(
    frame?.building ?? null,
    context.activeLevelId,
    context.drawingType ?? 'floor-plan',
  )
  const resolve = (raw: [number, number], altKey: boolean) =>
    snapHedgeDraftPoint(planToSite(building, raw), altKey)
  useSiteFloorplanSvgInput({
    groupRef,
    allowButtonHeldHover: true,
    onMove: (raw, event) => useHedgeDraft.setState({ hover: resolve(raw, event.altKey) }),
    onClick: (raw, event) => addPoint(resolve(raw, event.altKey)),
  })
  const draft = useHedgeDraft()
  return (
    <g ref={groupRef}>
      <GardenPlanDraft
        closed={false}
        hover={draft.hover ? siteToPlan(building, draft.hover) : null}
        message={error}
        points={draft.points.map((point) => siteToPlan(building, point))}
      />
    </g>
  )
}
