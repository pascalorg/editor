'use client'

import { prefersReducedMotion } from '@pascal-app/core'
import { useEffect, useRef } from 'react'
import { CORNER_SPRING } from '../../lib/point-ask/choreography'
import { subscribeFrame } from '../../lib/point-ask/frame-loop'
import { projectBox, unionRect } from '../../lib/point-ask/projector'
import { SpringPair } from '../../lib/point-ask/spring'
import { usePointAsk } from '../../store/use-point-ask'

const CORNERS = ['tl', 'tr', 'bl', 'br'] as const
/** How far outside its place a corner starts when the outline first draws itself. */
const DRAW_IN_PX = 12

/**
 * The outline's corners: four brackets around the pointed element's screen box that travel from
 * one target to the next on a spring instead of blinking off and on (the owner's "the outline
 * draws itself, and travels"). The 3D outline on the element itself is the viewer's; these frame
 * it. They follow the camera every frame, and never animate a hover change that a lag would read
 * as latency: only the travel between targets is sprung, and it is fast (response 0.16 s).
 */
export function OutlineCorners() {
  const nodes = useRef<(HTMLDivElement | null)[]>([])
  const springs = useRef(CORNERS.map(() => new SpringPair(0, 0, CORNER_SPRING)))
  const shown = useRef(false)
  // The frame loop runs only while the mode is on: an idle editor pays nothing for it.
  const on = usePointAsk((s) => s.active)

  useEffect(() => {
    if (!on) {
      shown.current = false
      for (const el of nodes.current) if (el) el.style.opacity = '0'
      return
    }
    return subscribeFrame((dt) => {
      const state = usePointAsk.getState()
      // The pointer's next pick leads while it names one; with none under it the bubble's targets stay framed.
      const targets = state.hover ? [state.hover.target] : (state.bubble?.targets ?? [])
      const boxes = state.active
        ? targets.flatMap((t) => (t.box ? [projectBox(t.box)] : [])).flatMap((r) => (r ? [r] : []))
        : []
      const rect = unionRect(boxes)
      if (!rect) {
        if (shown.current) {
          shown.current = false
          for (const el of nodes.current) if (el) el.style.opacity = '0'
        }
        return
      }
      const calm = prefersReducedMotion()
      const first = !shown.current
      shown.current = true
      const points = {
        tl: [rect.x0, rect.y0],
        tr: [rect.x1, rect.y0],
        bl: [rect.x0, rect.y1],
        br: [rect.x1, rect.y1],
      } as const
      CORNERS.forEach((corner, index) => {
        const el = nodes.current[index]
        const spring = springs.current[index]
        if (!(el && spring)) return
        const [px, py] = points[corner]
        if (calm) spring.snap(px, py)
        else {
          if (first)
            spring.snap(
              px + (corner[1] === 'l' ? -DRAW_IN_PX : DRAW_IN_PX),
              py + (corner[0] === 't' ? -DRAW_IN_PX : DRAW_IN_PX),
            )
          spring.to(px, py).step(dt)
        }
        const { x, y } = spring.value
        el.style.transform = `translate3d(${x}px,${y}px,0)`
        el.style.opacity = '1'
      })
    })
  }, [on])

  return (
    <>
      {CORNERS.map((corner, index) => (
        <div
          className={`pa-fc ${corner}`}
          key={corner}
          ref={(el) => {
            nodes.current[index] = el
          }}
        />
      ))}
    </>
  )
}
