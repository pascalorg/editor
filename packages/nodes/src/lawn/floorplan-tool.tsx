'use client'

import type { BuildingNode } from '@pascal-app/core'
import {
  type FloorplanToolContext,
  TOOL_INVALID_COLOR,
  useEditor,
  visibleScene,
} from '@pascal-app/editor'
import { type RefObject, useEffect, useRef, useState } from 'react'
import {
  GardenPlanDraft,
  publishGardenPlanPointer,
  useGardenPlanTarget,
} from '../shared/garden-plan-draft'
import { planToSite, siteFloorplanFrame, siteFrame, siteToPlan } from '../shared/site-frame'
import { lawnBrushColor, useLawnAuthoring } from './brush'
import { useLawnBrushController, useLawnNavigationGuard } from './brush-controller'
import { useLawnDraft, useLawnDraftController } from './draft'
import { snapLawnPoint } from './placement'

type Point = [number, number]
type LawnSettings = ReturnType<typeof useLawnAuthoring.getState>
type PlanLawnControls = {
  building: BuildingNode | null
  mode: LawnSettings['mode']
  addPoint: (point: Point) => void
  finish: () => void
  brush: Pick<ReturnType<typeof useLawnBrushController>, 'start' | 'move' | 'cancel'>
}
type PlanLawnInput = PlanLawnControls & {
  group: SVGGElement
  navigationAllows: ReturnType<typeof useLawnNavigationGuard>
  setCursor: (point: Point | null) => void
}

function consumePlanLawnInput(event: Event) {
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
}

function ownsPlanLawnInput(event: MouseEvent, context: PlanLawnInput) {
  return visibleScene(useEditor.getState()) !== '3d' && context.navigationAllows(event)
}

function planLawnPoint(event: MouseEvent, context: PlanLawnInput): Point | null {
  const matrix = context.group.getScreenCTM()
  if (!matrix) return null
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
  return planToSite(context.building, [point.x, point.y])
}

function beginPlanLawnPress(event: PointerEvent, context: PlanLawnInput) {
  if (event.button !== 0 || event.isPrimary === false || !ownsPlanLawnInput(event, context)) return
  const point = planLawnPoint(event, context)
  if (!point) return
  if (context.mode === 'brush') {
    context.setCursor(point)
    context.brush.start(point, event)
  }
  consumePlanLawnInput(event)
}

function movePlanLawnCursor(event: PointerEvent, context: PlanLawnInput) {
  if (!ownsPlanLawnInput(event, context)) {
    context.brush.cancel()
    context.setCursor(null)
    return
  }
  const point = planLawnPoint(event, context)
  if (!point) return
  const svg = context.group.ownerSVGElement
  if (svg) publishGardenPlanPointer(svg, event)
  if (context.mode === 'brush') {
    context.setCursor(point)
    context.brush.move(point, event)
  } else useLawnDraft.setState({ hover: snapLawnPoint(point, event.altKey) })
  consumePlanLawnInput(event)
}

function clickPlanLawnArea(event: MouseEvent, context: PlanLawnInput) {
  if (event.button !== 0 || !ownsPlanLawnInput(event, context)) return
  consumePlanLawnInput(event)
  if (context.mode !== 'area') return
  const point = planLawnPoint(event, context)
  if (point) context.addPoint(snapLawnPoint(point, event.altKey))
}

function installPlanLawnInput(context: PlanLawnInput, svg: SVGSVGElement) {
  const down = (event: PointerEvent) => beginPlanLawnPress(event, context)
  const move = (event: PointerEvent) => movePlanLawnCursor(event, context)
  const click = (event: MouseEvent) => clickPlanLawnArea(event, context)
  // The second click of a double-click repeats the last point and is dropped; the outline closes.
  const doubleClick = (event: MouseEvent) => {
    if (context.mode !== 'area' || event.button !== 0 || !ownsPlanLawnInput(event, context)) return
    consumePlanLawnInput(event)
    context.finish()
  }
  svg.addEventListener('dblclick', doubleClick, true)
  svg.addEventListener('pointerdown', down, true)
  svg.addEventListener('pointermove', move, true)
  svg.addEventListener('click', click, true)
  return () => {
    svg.removeEventListener('dblclick', doubleClick, true)
    svg.removeEventListener('pointerdown', down, true)
    svg.removeEventListener('pointermove', move, true)
    svg.removeEventListener('click', click, true)
  }
}

function usePlanLawnInput(
  groupRef: RefObject<SVGGElement | null>,
  { building, mode, addPoint, finish, brush }: PlanLawnControls,
) {
  const navigationAllows = useLawnNavigationGuard()
  const [cursor, setCursor] = useState<Point | null>(null)
  const { start, move, cancel } = brush
  useEffect(() => {
    const group = groupRef.current,
      svg = group?.ownerSVGElement
    if (!group || !svg) return
    return installPlanLawnInput(
      {
        group,
        building,
        mode,
        addPoint,
        finish,
        brush: { start, move, cancel },
        navigationAllows,
        setCursor,
      },
      svg,
    )
  }, [groupRef, building, mode, addPoint, finish, start, move, cancel, navigationAllows])
  return cursor
}

function PlanLawnBrushCursor({ cursor, settings }: { cursor: Point; settings: LawnSettings }) {
  return (
    <>
      {[0.25, 0.5, 0.75, 1].map((fraction) => (
        <circle
          key={fraction}
          cx={cursor[0]}
          cy={cursor[1]}
          r={settings.radiusM * fraction}
          fill={lawnBrushColor[settings.effect]}
          fillOpacity={0.035}
          stroke={lawnBrushColor[settings.effect]}
          strokeOpacity={(1 - fraction * 0.7) * 0.6}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      ))}
    </>
  )
}

/** The brush on the plan: the plan's own target at its centre, and the ring in its effect's colour. */
function PlanLawnBrush({
  cursor,
  settings,
  message,
}: {
  cursor: Point | null
  settings: LawnSettings
  message: string | null
}) {
  useGardenPlanTarget(cursor)
  return (
    <>
      {cursor && <PlanLawnBrushCursor cursor={cursor} settings={settings} />}
      {message && cursor && (
        <text
          fill={TOOL_INVALID_COLOR}
          fontSize={0.18}
          pointerEvents="none"
          x={cursor[0]}
          y={cursor[1] - 0.25}
        >
          {message}
        </text>
      )}
    </>
  )
}

export default function FloorplanLawnTool(context: FloorplanToolContext) {
  const groupRef = useRef<SVGGElement>(null)
  const frame = siteFrame(context.sceneApi, context.activeLevelId)
  const { building } = siteFloorplanFrame(
    frame?.building ?? null,
    context.activeLevelId,
    context.drawingType ?? 'floor-plan',
  )
  const settings = useLawnAuthoring()
  const draft = useLawnDraftController({ ...context, siteId: frame?.site.id, view: '2d' })
  const brush = useLawnBrushController({ ...context, siteId: frame?.site.id, view: '2d' })
  const cursor = usePlanLawnInput(groupRef, {
    building,
    mode: settings.mode,
    addPoint: draft.addPoint,
    finish: draft.finish,
    brush,
  })
  const outline = useLawnDraft()
  const cursorPlan = cursor ? siteToPlan(building, cursor) : null
  return (
    <g ref={groupRef}>
      {settings.mode === 'area' ? (
        <GardenPlanDraft
          closed
          hover={outline.hover ? siteToPlan(building, outline.hover) : null}
          message={draft.error}
          points={outline.points.map((point) => siteToPlan(building, point))}
        />
      ) : (
        <PlanLawnBrush cursor={cursorPlan} message={brush.message} settings={settings} />
      )}
    </g>
  )
}
