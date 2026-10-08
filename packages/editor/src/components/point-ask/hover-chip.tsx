'use client'

import { useEffect, useRef } from 'react'
import { CHIP_OFFSET, DWELL_MS } from '../../lib/point-ask/choreography'
import { subscribeFrame } from '../../lib/point-ask/frame-loop'
import { getPointer, subscribePointer } from '../../lib/point-ask/pointer-tracker'
import { usePointAsk } from '../../store/use-point-ask'

/**
 * The label chip at the cursor: what the click will send, named before the click (the hover is
 * feedforward). It follows the pointer on the frame of the pointer event; the first eligible
 * appearance waits 120 ms then fades in, and target substitutions are instant (the tooltip rule).
 */
export function HoverChip() {
  const wrap = useRef<HTMLDivElement>(null)
  const label = useRef<HTMLDivElement>(null)
  const hover = usePointAsk((s) => s.hover)
  const active = usePointAsk((s) => s.active)
  const shift = usePointAsk((s) => s.shift)
  const bubbleOpen = usePointAsk((s) => s.bubble !== null)
  const draggingRegion = usePointAsk((s) => s.region !== null && !s.region.settled)
  const busy = usePointAsk((s) =>
    hover
      ? s.pinOrder.some((id) => {
          const pin = s.pins[id]
          return (
            pin &&
            (pin.model.state === 'queued' || pin.model.state === 'working') &&
            pin.model.targetIds.includes(hover.target.id)
          )
        })
      : false,
  )
  const seen = useRef(false)

  useEffect(() => {
    const place = (x: number, y: number) => {
      if (wrap.current)
        wrap.current.style.transform = `translate3d(${x + CHIP_OFFSET}px,${y + CHIP_OFFSET}px,0)`
    }
    const at = getPointer()
    if (at) place(at.x, at.y)
    if (!active) return
    return subscribePointer(place)
  }, [active])

  const visible = active && hover !== null && !draggingRegion
  useEffect(() => {
    const el = label.current
    if (!el) return
    if (!visible) {
      seen.current = false
      el.classList.remove('show')
      return
    }
    if (seen.current) {
      el.style.transitionDuration = '0ms'
      el.classList.add('show')
      return
    }
    el.style.transitionDuration = ''
    const since = performance.now()
    const stop = subscribeFrame((_dt, now) => {
      if (now - since < DWELL_MS) return
      el.classList.add('show')
      seen.current = true
      stop()
    })
    return stop
  }, [visible])

  const plus = shift && bubbleOpen ? '+ ' : ''
  return (
    <div className="pa-chipwrap" ref={wrap} style={{ opacity: visible ? 1 : 0 }}>
      <div className="pa-hlabel" ref={label}>
        {hover ? (
          busy ? (
            'Pascal is working on this'
          ) : (
            <>
              {plus}
              {hover.target.name}
              {hover.target.size ? <span className="sz">{hover.target.size}</span> : null}
              {hover.ambiguous ? <span className="sub">⌥ the wall</span> : null}
            </>
          )
        ) : null}
      </div>
    </div>
  )
}
