'use client'

import type { BuildingNode } from '@pascal-app/core'
import { type FloorplanToolContext, useEditor, visibleScene } from '@pascal-app/editor'
import { type RefObject, useEffect, useRef, useState } from 'react'
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
  svg.addEventListener('pointerdown', down, true)
  svg.addEventListener('pointermove', move, true)
  svg.addEventListener('click', click, true)
  return () => {
    svg.removeEventListener('pointerdown', down, true)
    svg.removeEventListener('pointermove', move, true)
    svg.removeEventListener('click', click, true)
  }
}

function usePlanLawnInput(
  groupRef: RefObject<SVGGElement | null>,
  { building, mode, addPoint, brush }: PlanLawnControls,
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
        brush: { start, move, cancel },
        navigationAllows,
        setCursor,
      },
      svg,
    )
  }, [groupRef, building, mode, addPoint, start, move, cancel, navigationAllows])
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

function PlanLawnFeedback({
  points,
  cursor,
  settings,
  error,
}: {
  points: Point[]
  cursor: Point | null
  settings: LawnSettings
  error: string | null
}) {
  const first = settings.mode === 'brush' ? cursor : points[0]
  return (
    <>
      {settings.mode === 'area' && (
        <polygon
          fill={points.length >= 3 ? '#617c36' : 'none'}
          fillOpacity={0.2}
          pointerEvents="none"
          points={points.map((point) => point.join(',')).join(' ')}
          stroke={error ? '#b45309' : '#617c36'}
          strokeWidth={3}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {settings.mode === 'brush' && cursor && (
        <PlanLawnBrushCursor cursor={cursor} settings={settings} />
      )}
      {error && first && (
        <text fill="#b45309" fontSize={0.18} pointerEvents="none" x={first[0]} y={first[1] - 0.25}>
          {error}
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
    brush,
  })
  const points = draft.line.map((point) => siteToPlan(building, point))
  const cursorPlan = cursor ? siteToPlan(building, cursor) : null
  const error = settings.mode === 'brush' ? brush.error : draft.error
  return (
    <g ref={groupRef}>
      <PlanLawnFeedback points={points} cursor={cursorPlan} settings={settings} error={error} />
    </g>
  )
}
