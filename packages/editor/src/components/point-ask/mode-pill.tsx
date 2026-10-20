'use client'

import { useEffect, useRef } from 'react'
import { EASE_OUT, ENTER_MS } from '../../lib/point-ask/choreography'
import { canvasRect, freeViewport } from '../../lib/point-ask/projector'
import { usePointAsk } from '../../store/use-point-ask'
import { finishOptionalAnimations, pointMotionCalm, usePointMotionCalm } from './optional-motion'

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
  const optional = useRef<Animation[]>([])
  const calm = usePointMotionCalm()
  const shown = active && latched

  useEffect(() => {
    if (calm) finishOptionalAnimations(optional.current)
  }, [calm])

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
    const quiet = pointMotionCalm()
    const animation = node.animate(
      quiet
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [
            { opacity: 0, transform: 'translate(-50%, -8px)' },
            { opacity: 1, transform: 'translate(-50%, 0)' },
          ],
      { duration: ENTER_MS, easing: EASE_OUT },
    )
    if (!quiet) optional.current.push(animation)
    return () => {
      window.removeEventListener('resize', place)
      animation.cancel()
      optional.current = []
    }
  }, [shown])

  if (!shown) return null
  return (
    <div className="pa-pill" ref={el} role="status">
      <b>Point at anything to ask Pascal</b> · Esc to leave
    </div>
  )
}

/** While a compare control is held and the scene shows what it was before the turn: a small tag says so. */
export function BeforeTag() {
  const comparing = usePointAsk((s) => s.comparing)
  const el = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!comparing) return
    const node = el.current
    if (!node) return
    const view = freeViewport()
    if (view) {
      node.style.left = `${view.x0}px`
      // Below the level selector and the view switch, which sit over the canvas's top-left corner.
      node.style.top = `${view.y0 + 64}px`
    }
    node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: EASE_OUT })
  }, [comparing])

  if (!comparing) return null
  return (
    <div className="pa-before" ref={el} role="status">
      <i />
      Before
    </div>
  )
}
