'use client'

import { useViewer } from '@pascal-app/viewer'
import { useEffect, useRef } from 'react'
import { subscribeFrame } from '../../lib/point-ask/frame-loop'
import { projectWorldIn, viewportRect } from '../../lib/point-ask/projector'
import type { PointViewport } from '../../lib/point-ask/types'
import { usePointAsk } from '../../store/use-point-ask'

/** A persisted capture follows its viewport's projection, not the pointer or a later screen rectangle. */
export function PinFootprint({ viewport = '3d' }: { viewport?: PointViewport }) {
  const askId = usePointAsk((state) => state.cardFor)
  const pin = usePointAsk((state) => (askId ? state.pins[askId] : undefined))
  const svg = useRef<SVGSVGElement>(null)
  const polygon = useRef<SVGPolygonElement>(null)
  const footprint = pin?.behavior === 'persistent' ? pin.footprint : undefined

  useEffect(() => {
    if (!(footprint && pin)) return
    return subscribeFrame(() => {
      const node = polygon.current
      if (!node) return
      const frame = viewportRect(viewport)
      if (svg.current) {
        svg.current.style.clipPath =
          frame && typeof window !== 'undefined'
            ? `inset(${frame.top}px ${Math.max(0, window.innerWidth - frame.right)}px ${Math.max(0, window.innerHeight - frame.bottom)}px ${frame.left}px)`
            : ''
      }
      const points = footprint.corners.map((corner) => projectWorldIn(corner, viewport))
      const visible =
        frame !== null &&
        points.length >= 3 &&
        points.every((point) => point.ok) &&
        (pin.levelId === null || pin.levelId === useViewer.getState().selection.levelId)
      node.style.visibility = visible ? '' : 'hidden'
      if (visible)
        node.setAttribute('points', points.map((point) => `${point.x},${point.y}`).join(' '))
    })
  }, [footprint, pin, viewport])

  if (!footprint) return null
  return (
    <svg
      aria-hidden
      className="pa-footprint"
      data-point-ask-footprint={askId}
      data-point-ask-viewport={viewport}
      ref={svg}
    >
      <polygon ref={polygon} style={{ visibility: 'hidden' }} />
    </svg>
  )
}
