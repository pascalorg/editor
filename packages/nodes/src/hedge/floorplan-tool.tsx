'use client'

import type { FloorplanToolContext } from '@pascal-app/editor'
import { useEffect, useRef } from 'react'
import { planToSite, siteFloorplanFrame, siteFrame, siteToPlan } from '../shared/site-frame'
import { snapHedgeDraftPoint, useHedgeDraft, useHedgeDraftController } from './draft'

/**
 * Draws a hedge on the plan, in the frame the drawing is in (a floor plan in its building's, a
 * site plan in the Site's); the points are kept in Site metres, as the 3D tool keeps them.
 */
export default function FloorplanHedgeTool(context: FloorplanToolContext) {
  const groupRef = useRef<SVGGElement>(null)
  const frame = siteFrame(context.sceneApi, context.activeLevelId)
  const { addPoint, line, error } = useHedgeDraftController({
    ...context,
    siteId: frame?.site.id,
    view: '2d',
  })
  const { building } = siteFloorplanFrame(
    frame?.building ?? null,
    context.activeLevelId,
    context.drawingType ?? 'floor-plan',
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
      return snapHedgeDraftPoint(planToSite(building, [point.x, point.y]), event.altKey)
    }
    const down = (event: PointerEvent) => {
      if (event.button === 0) consume(event)
    }
    const move = (event: PointerEvent) => {
      if (event.buttons & 0b110) return
      consume(event)
      useHedgeDraft.setState({ hover: resolve(event) })
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
  const points = line.map((point) => siteToPlan(building, point))
  const first = points[0]
  return (
    <g ref={groupRef}>
      <polyline
        fill="none"
        pointerEvents="none"
        points={points.map((point) => point.join(',')).join(' ')}
        stroke={error ? '#b45309' : '#3f8f3a'}
        strokeWidth={3}
        vectorEffect="non-scaling-stroke"
      />
      {error && first && (
        <text fill="#b45309" fontSize={0.18} pointerEvents="none" x={first[0]} y={first[1] - 0.25}>
          {error}
        </text>
      )}
    </g>
  )
}
