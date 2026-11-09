'use client'

import type { FloorplanGeometry } from '@pascal-app/core'
import { getRevealPlanState, type RevealPlanState, subscribeRevealTicks } from '@pascal-app/viewer'
import { type RefObject, useEffect } from 'react'

/** A node's plan centreline, from its start: what a growing reveal follows. */
export type FloorplanRevealAxis = { x1: number; y1: number; x2: number; y2: number }

/** An entry's plan geometry, by pass. */
export type FloorplanRevealEntry = {
  base: FloorplanGeometry | null
  overlay: FloorplanGeometry | null
  handles: FloorplanGeometry | null
}

/** How a revealing entry draws: its opacity, and for a growing one the clip that uncovers it. */
export type FloorplanRevealLook = {
  opacity: number
  clip: { x: number; y: number; width: number; height: number; rotateDeg: number } | null
}

/** The clip reaches this far before the start and past the end, so mitred corners show whole. */
const CLIP_PAD_M = 1
/** And this far to either side of the centreline: the wall, its layers and its labels. */
const CLIP_HALF_WIDTH_M = 50

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3

/**
 * The centreline a linear kind (a wall, a fence) draws as its `hit-line`, if
 * its plan geometry has one outside any transformed group.
 */
export function floorplanRevealAxis(
  geometries: readonly (FloorplanGeometry | null | undefined)[],
): FloorplanRevealAxis | null {
  const visit = (geometry: FloorplanGeometry): FloorplanRevealAxis | null => {
    if (geometry.kind === 'hit-line') {
      const { x1, y1, x2, y2 } = geometry
      return Math.hypot(x2 - x1, y2 - y1) > 1e-6 ? { x1, y1, x2, y2 } : null
    }
    if (geometry.kind !== 'group' || geometry.transform) return null
    for (const child of geometry.children) {
      const axis = visit(child)
      if (axis) return axis
    }
    return null
  }
  for (const geometry of geometries) {
    const axis = geometry ? visit(geometry) : null
    if (axis) return axis
  }
  return null
}

/**
 * The plan's twin of a 3D reveal: a node that rises in 3D and has a
 * centreline grows along it from its start; everything else fades in. An undo's
 * reverse play reads the same look backwards: a wall's clip shrinks toward its
 * start, everything else fades out.
 */
export function floorplanRevealLook(
  state: RevealPlanState,
  axis: FloorplanRevealAxis | null,
): FloorplanRevealLook {
  const eased = easeOutCubic(Math.min(1, Math.max(0, state.progress)))
  if (state.style !== 'rise' || !axis) return { opacity: eased, clip: null }
  const length = Math.hypot(axis.x2 - axis.x1, axis.y2 - axis.y1)
  return {
    opacity: 1,
    clip: {
      x: axis.x1 - CLIP_PAD_M,
      y: axis.y1 - CLIP_HALF_WIDTH_M,
      width: CLIP_PAD_M + eased * (length + CLIP_PAD_M),
      height: CLIP_HALF_WIDTH_M * 2,
      rotateDeg: (Math.atan2(axis.y2 - axis.y1, axis.x2 - axis.x1) * 180) / Math.PI,
    },
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg'
let clipIds = 0

/**
 * Plays a node's construction reveal on its plan entry: while the reveal
 * runs, each tick sets the entry group's opacity or its growing clip, then
 * clears them when the node is done. Imperative, so a reveal re-renders no
 * React tree; an entry with nothing revealing subscribes to nothing.
 */
export function useFloorplanReveal(
  nodeId: string,
  groupRef: RefObject<SVGGElement | null>,
  entry: FloorplanRevealEntry | null,
  waiting: boolean,
  /** The reveal has something to play for the node (it moves in, or an undo takes it back): the effect runs again. */
  active = false,
) {
  useEffect(() => {
    const group = groupRef.current
    if (waiting || !group || !getRevealPlanState(nodeId)) return
    const axis = entry ? floorplanRevealAxis([entry.base, entry.overlay, entry.handles]) : null
    let clip: SVGClipPathElement | null = null
    let rect: SVGRectElement | null = null
    let stop = () => {}
    const clear = () => {
      stop()
      group.removeAttribute('opacity')
      group.removeAttribute('clip-path')
      clip?.remove()
      clip = null
    }
    const apply = () => {
      const state = getRevealPlanState(nodeId)
      if (!state) return clear()
      const look = floorplanRevealLook(state, axis)
      group.setAttribute('opacity', String(look.opacity))
      if (!look.clip) return
      if (!(clip && rect)) {
        clipIds += 1
        const id = `floorplan-reveal-${clipIds}`
        clip = document.createElementNS(SVG_NS, 'clipPath')
        clip.setAttribute('id', id)
        clip.setAttribute('clipPathUnits', 'userSpaceOnUse')
        rect = document.createElementNS(SVG_NS, 'rect')
        clip.appendChild(rect)
        group.appendChild(clip)
        group.setAttribute('clip-path', `url(#${id})`)
      }
      const { x, y, width, height, rotateDeg } = look.clip
      rect.setAttribute('x', String(x))
      rect.setAttribute('y', String(y))
      rect.setAttribute('width', String(width))
      rect.setAttribute('height', String(height))
      rect.setAttribute('transform', `rotate(${rotateDeg} ${axis?.x1 ?? 0} ${axis?.y1 ?? 0})`)
    }
    stop = subscribeRevealTicks(apply)
    apply()
    return clear
    // biome-ignore lint/correctness/useExhaustiveDependencies: `active` only says the reveal's state may have changed
  }, [nodeId, groupRef, entry, waiting, active])
}
