'use client'

import { useViewer } from '@pascal-app/viewer'
import { useEffect, useRef } from 'react'
import { subscribeFrame } from '../../lib/point-ask/frame-loop'
import { projectWorld } from '../../lib/point-ask/projector'
import { usePointAsk } from '../../store/use-point-ask'

/** A persisted capture follows the camera, not the pointer or a later screen rectangle. */
export function PinFootprint() {
  const askId = usePointAsk((state) => state.cardFor)
  const pin = usePointAsk((state) => (askId ? state.pins[askId] : undefined))
  const polygon = useRef<SVGPolygonElement>(null)
  const footprint = pin?.behavior === 'persistent' ? pin.footprint : undefined

  useEffect(() => {
    if (!(footprint && pin)) return
    return subscribeFrame(() => {
      const node = polygon.current
      if (!node) return
      const points = footprint.corners.map(projectWorld)
      const visible =
        points.length >= 3 &&
        points.every((point) => point.ok) &&
        (pin.levelId === null || pin.levelId === useViewer.getState().selection.levelId)
      node.style.visibility = visible ? '' : 'hidden'
      if (visible)
        node.setAttribute('points', points.map((point) => `${point.x},${point.y}`).join(' '))
    })
  }, [footprint, pin])

  if (!footprint) return null
  return (
    <svg aria-hidden className="pa-footprint" data-point-ask-footprint={askId}>
      <polygon ref={polygon} style={{ visibility: 'hidden' }} />
    </svg>
  )
}
