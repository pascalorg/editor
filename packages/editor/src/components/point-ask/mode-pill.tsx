'use client'

import { prefersReducedMotion } from '@pascal-app/core'
import { useEffect, useRef } from 'react'
import { EASE_OUT, ENTER_MS } from '../../lib/point-ask/choreography'
import { canvasRect } from '../../lib/point-ask/projector'
import { usePointAsk } from '../../store/use-point-ask'

/** The mode's presence in the viewport: a faint edge tint while it is on. */
export function ModeVignette() {
  const active = usePointAsk((s) => s.active)
  return <div aria-hidden className={`pa-vignette${active ? ' on' : ''}`} />
}

/**
 * Only when a tap latched the mode: the pill that says how to leave. It sits at the top centre of
 * the 3D view (not of the page: the panels beside it are not part of the view) and enters 8 px up.
 */
export function ModePill() {
  const active = usePointAsk((s) => s.active)
  const latched = usePointAsk((s) => s.latched)
  const el = useRef<HTMLDivElement>(null)
  const shown = active && latched

  useEffect(() => {
    if (!shown) return
    const node = el.current
    if (!node) return
    const place = () => {
      const rect = canvasRect()
      if (rect) node.style.left = `${rect.left + rect.width / 2}px`
    }
    place()
    window.addEventListener('resize', place)
    node.animate(
      prefersReducedMotion()
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [
            { opacity: 0, transform: 'translate(-50%, -8px)' },
            { opacity: 1, transform: 'translate(-50%, 0)' },
          ],
      { duration: ENTER_MS, easing: EASE_OUT },
    )
    return () => window.removeEventListener('resize', place)
  }, [shown])

  if (!shown) return null
  return (
    <div className="pa-pill" ref={el} role="status">
      <b>Point at anything to ask Pascal</b> · Esc to leave
    </div>
  )
}
