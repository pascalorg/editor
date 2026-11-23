'use client'

import { type RefObject, useEffect, useRef } from 'react'
import { publishGardenPlanPointer } from './garden-plan-draft'

type Point = [number, number]

/**
 * Capture pointer hover, click and double-click events on a floorplan SVG overlay and project
 * client coordinates through the `<g>` CTM before the underlying panel can consume them.
 */
export function useSiteFloorplanSvgInput({
  groupRef,
  onMove,
  onClick,
  onDoubleClick,
  onLeave,
  ownsTarget,
  allowButtonHeldHover = false,
}: {
  groupRef: RefObject<SVGGElement | null>
  onMove: (raw: Point, event: PointerEvent) => void
  onClick: (raw: Point, event: MouseEvent) => void
  onDoubleClick?: (event: MouseEvent) => void
  onLeave?: () => void
  ownsTarget?: (target: EventTarget | null) => boolean
  allowButtonHeldHover?: boolean
}) {
  const latest = useRef({
    onMove,
    onClick,
    onDoubleClick,
    onLeave,
    ownsTarget,
    allowButtonHeldHover,
  })
  latest.current = { onMove, onClick, onDoubleClick, onLeave, ownsTarget, allowButtonHeldHover }

  useEffect(() => {
    const group = groupRef.current
    const svg = group?.ownerSVGElement
    if (!group || !svg) return
    const consume = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }
    const matchesTarget = (target: EventTarget | null) =>
      latest.current.ownsTarget ? latest.current.ownsTarget(target) : true
    const project = (event: MouseEvent | PointerEvent): Point | null => {
      const matrix = group.getScreenCTM()
      if (!matrix) return null
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
      return [point.x, point.y]
    }
    const down = (event: PointerEvent) => {
      if (event.button === 0 && matchesTarget(event.target)) consume(event)
    }
    const move = (event: PointerEvent) => {
      if (!matchesTarget(event.target)) return
      if (latest.current.allowButtonHeldHover) {
        if (event.buttons & 0b110) return
      } else if (event.buttons !== 0) return
      const raw = project(event)
      if (!raw) return
      consume(event)
      publishGardenPlanPointer(svg, event)
      latest.current.onMove(raw, event)
    }
    const leave = () => latest.current.onLeave?.()
    const click = (event: MouseEvent) => {
      if (event.button !== 0 || !matchesTarget(event.target)) return
      consume(event)
      const raw = project(event)
      if (raw) latest.current.onClick(raw, event)
    }
    const doubleClick = (event: MouseEvent) => {
      if (event.button !== 0 || !matchesTarget(event.target) || !latest.current.onDoubleClick)
        return
      consume(event)
      latest.current.onDoubleClick(event)
    }
    svg.addEventListener('pointerdown', down, true)
    svg.addEventListener('pointermove', move, true)
    if (onLeave) svg.addEventListener('pointerleave', leave)
    svg.addEventListener('click', click, true)
    if (onDoubleClick) svg.addEventListener('dblclick', doubleClick, true)
    return () => {
      svg.removeEventListener('pointerdown', down, true)
      svg.removeEventListener('pointermove', move, true)
      if (onLeave) svg.removeEventListener('pointerleave', leave)
      svg.removeEventListener('click', click, true)
      if (onDoubleClick) svg.removeEventListener('dblclick', doubleClick, true)
    }
  }, [groupRef, Boolean(onLeave), Boolean(onDoubleClick)])
}
