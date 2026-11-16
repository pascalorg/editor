'use client'

import { rampStations } from '@pascal-app/core'
import { clearSurfacePlanSnapFeedback, type FloorplanToolContext } from '@pascal-app/editor'
import { useEffect, useRef } from 'react'
import {
  RampDraftControls,
  rampDraftLastPoint,
  useRampDraft,
  useRampDraftController,
} from './draft'
import { rampFloorplanFrame, rampSiteToPlan } from './edit'
import { snapRampPlanPoint } from './snapping'

export default function FloorplanRampTool(context: FloorplanToolContext) {
  const groupRef = useRef<SVGGElement>(null)
  const { frame, addPoint, finish, draft, preview, previewError } = useRampDraftController({
    ...context,
    view: '2d',
  })
  const drawingFrame = rampFloorplanFrame(
    frame?.building ?? null,
    context.activeLevelId,
    'floor-plan',
  )
  const siteId = frame?.site.id
  const { building, activeLevelId } = drawingFrame
  useEffect(() => {
    const group = groupRef.current
    const svg = group?.ownerSVGElement
    if (!(siteId && group && svg)) return
    const consume = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }
    const resolve = (event: MouseEvent | PointerEvent) => {
      const matrix = group.getScreenCTM()
      if (!matrix) return null
      const raw = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
      return snapRampPlanPoint(
        [raw.x, raw.y],
        rampDraftLastPoint(useRampDraft.getState()),
        building,
        activeLevelId,
        context.gridSnapStep,
        event.altKey,
      )
    }
    const down = (event: PointerEvent) => {
      if (event.button === 0) consume(event)
    }
    const move = (event: PointerEvent) => {
      if (event.buttons & 0b110) return
      consume(event)
      useRampDraft.setState({ hover: resolve(event) })
    }
    const click = (event: MouseEvent) => {
      if (event.button !== 0) return
      consume(event)
      const point = resolve(event)
      if (point) addPoint(point)
    }
    const doubleClick = (event: MouseEvent) => {
      consume(event)
      finish()
    }
    const leave = () => {
      useRampDraft.setState({ hover: null })
      clearSurfacePlanSnapFeedback()
    }
    svg.addEventListener('pointerdown', down, true)
    svg.addEventListener('pointermove', move, true)
    svg.addEventListener('click', click, true)
    svg.addEventListener('dblclick', doubleClick, true)
    svg.addEventListener('pointerleave', leave, true)
    return () => {
      clearSurfacePlanSnapFeedback()
      svg.removeEventListener('pointerdown', down, true)
      svg.removeEventListener('pointermove', move, true)
      svg.removeEventListener('click', click, true)
      svg.removeEventListener('dblclick', doubleClick, true)
      svg.removeEventListener('pointerleave', leave, true)
    }
  }, [addPoint, activeLevelId, context.gridSnapStep, finish, siteId, building])
  const points =
    preview && frame
      ? rampStations(preview).map((station) => rampSiteToPlan(building, station.point))
      : []
  const hover = draft.hover && frame ? rampSiteToPlan(building, draft.hover) : null
  const start = draft.start && frame ? rampSiteToPlan(building, draft.start) : null
  return (
    <g ref={groupRef}>
      <g pointerEvents="none">
        {points.length > 1 && (
          <>
            <polyline
              fill="none"
              opacity={0.4}
              points={points.map((point) => point.join(',')).join(' ')}
              stroke="#38bdf8"
              strokeLinejoin="round"
              strokeWidth={draft.options.width}
            />
            <polyline
              fill="none"
              points={points.map((point) => point.join(',')).join(' ')}
              stroke="#0284c7"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}
        {start && <circle cx={start[0]} cy={start[1]} fill="#0284c7" r={0.08} />}
        {hover && (
          <circle
            cx={hover[0]}
            cy={hover[1]}
            fill="none"
            r={0.12}
            stroke="#0284c7"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </g>
      <RampDraftControls
        finish={finish}
        previewError={frame ? previewError : 'Choose a Site before drawing a ramp.'}
        view="2d"
      />
    </g>
  )
}
