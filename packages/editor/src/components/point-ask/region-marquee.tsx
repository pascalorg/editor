'use client'

import { prefersReducedMotion } from '@pascal-app/core'
import { useEffect, useRef } from 'react'
import { EASE_OUT, REGION_FLASH_MS } from '../../lib/point-ask/choreography'
import type { Rect } from '../../lib/point-ask/types'
import { usePointAsk } from '../../store/use-point-ask'

const CORNERS = ['tl', 'tr', 'bl', 'br'] as const

type RegionMarqueeProps = {
  /** The rectangle in viewport pixels, or null when no region is being drawn. */
  rect: Rect | null
  /** The live size inside the rectangle ("4.2 × 3.1 m"), or null while it cannot be measured. */
  sizeLabel: string | null
  /** The person let go: the rectangle stays at 60% until the ask is sent or dismissed. */
  settled: boolean
  /** Changes when a capture happens: the shutter flash fills the rectangle once. */
  flashKey: number
}

/**
 * The rectangle of a region capture (the owner's "the marquee shows its live size in metres; on
 * release a shutter flash fills the rectangle"). It follows the pointer 1:1, with no spring: a
 * trailing rectangle would read as latency. The flash is a "Playful touches" moment; under
 * reduced motion it is a quiet fade.
 */
export function RegionMarquee({ rect, sizeLabel, settled, flashKey }: RegionMarqueeProps) {
  const flash = useRef<HTMLDivElement>(null)
  const seen = useRef(flashKey)
  const playful = usePointAsk((s) => s.playful)

  useEffect(() => {
    if (flashKey === seen.current) return
    seen.current = flashKey
    const el = flash.current
    if (!(el && playful)) return
    const peak = prefersReducedMotion() ? 0.3 : 0.9
    el.animate([{ opacity: peak }, { opacity: 0 }], {
      duration: REGION_FLASH_MS,
      easing: EASE_OUT,
      fill: 'forwards',
    })
  }, [flashKey, playful])

  if (!rect) return null
  return (
    <div
      aria-hidden
      className={`pa-rgn${settled ? ' settled' : ''}`}
      style={{
        transform: `translate3d(${rect.x0}px,${rect.y0}px,0)`,
        width: rect.x1 - rect.x0,
        height: rect.y1 - rect.y0,
      }}
    >
      {CORNERS.map((corner) => (
        <span className={`pa-rgn-c ${corner}`} key={corner} />
      ))}
      <div className="pa-rgn-flash" ref={flash} />
      <div className="pa-rgn-size">{sizeLabel}</div>
    </div>
  )
}
