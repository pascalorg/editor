'use client'

import {
  emitter,
  type PointAskStatus,
  registerPointAskHandler,
  useHasPointAskHandler,
  useScene,
} from '@pascal-app/core'
import { subscribeRevealEvents, useViewer } from '@pascal-app/viewer'
import { useEffect } from 'react'
import { startPointAskSession } from '../../lib/point-ask/session'
import { usePointAsk } from '../../store/use-point-ask'
import { PointAskBubble } from './bubble'
import { HoverChip } from './hover-chip'
import { ModePill, ModeVignette } from './mode-pill'
import { OutlineCorners } from './outline-corners'
import { PointAskPins } from './pins'
import { POINT_ASK_CSS } from './point-ask-styles'
import { RegionMarquee } from './region-marquee'
import { REGION_MARQUEE_CSS } from './region-marquee-styles'

/**
 * Point and ask's overlay (the owner, 8 October): the outline's corners, the label chip, the
 * anchored bubble and the pins, drawn over the 3D view and following its camera. It renders only
 * where a host has registered a handler for asks (the open-source editor has no chat), though pins
 * already planted stay until they retire.
 */
export function PointAskLayer() {
  const available = useHasPointAskHandler()
  const hasPins = usePointAsk((s) => s.pinOrder.length > 0)
  const active = usePointAsk((s) => s.active)
  const region = usePointAsk((s) => s.region)

  useEffect(() => startPointAskSession(), [])

  // A test door in development only, like the camera controls': a page script registers a fake
  // chat and plays its statuses, so the scene side can be driven without a model.
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return
    const w = window as typeof window & { __pascalPointAskTest?: unknown }
    w.__pascalPointAskTest = {
      register: registerPointAskHandler,
      status: (status: PointAskStatus) => emitter.emit('point-ask:status', status),
      store: usePointAsk,
      scene: useScene,
      emitter,
      viewer: useViewer,
      reveal: subscribeRevealEvents,
    }
    return () => {
      w.__pascalPointAskTest = undefined
    }
  }, [])

  if (!(available || hasPins || active)) return null
  return (
    <div className="pa-layer" data-point-ask-layer>
      <style>{POINT_ASK_CSS + REGION_MARQUEE_CSS}</style>
      <ModeVignette />
      <OutlineCorners />
      <RegionMarquee
        flashKey={region?.flashKey ?? 0}
        rect={region?.rect ?? null}
        settled={region?.settled ?? false}
        sizeLabel={region?.sizeLabel ?? null}
      />
      <PointAskPins />
      <PointAskBubble />
      <HoverChip />
      <ModePill />
    </div>
  )
}
