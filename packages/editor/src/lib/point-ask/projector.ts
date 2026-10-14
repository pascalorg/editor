import { Vector3 } from 'three'
import { getEditorThreeContext } from '../../components/editor/three-context-bridge'
import { BUBBLE_BOTTOM_INSET, BUBBLE_TOP_INSET, VIEWPORT_INSET } from './overlay-metrics'
import type { Rect, ScreenPoint } from './types'

// World to screen for the DOM overlay, read from the live editor camera each frame: the overlay
// lives outside the R3F tree, so it asks the same camera the canvas draws with. Screen units are
// CSS pixels in viewport coordinates (the overlay is `position: fixed`).

const scratch = new Vector3()

export type Projected = ScreenPoint & { ok: boolean }

/** The canvas the editor draws in, or null before it mounts. */
export function canvasRect(): DOMRect | null {
  return getEditorThreeContext()?.domElement.getBoundingClientRect() ?? null
}

/** A world point on the page; `ok` is false behind the camera or outside the clip volume. */
export function projectWorld(point: readonly [number, number, number]): Projected {
  const three = getEditorThreeContext()
  if (!three) return { x: 0, y: 0, ok: false }
  const rect = three.domElement.getBoundingClientRect()
  scratch.set(point[0], point[1], point[2])
  three.camera.updateMatrixWorld()
  scratch.project(three.camera)
  const ok = scratch.z > -1 && scratch.z < 1
  return {
    x: rect.left + (scratch.x * 0.5 + 0.5) * rect.width,
    y: rect.top + (-scratch.y * 0.5 + 0.5) * rect.height,
    ok,
  }
}

/** The screen box of a world box (its eight corners projected); null when nothing of it is in front of the camera. */
export function projectBox(box: {
  min: readonly [number, number, number]
  max: readonly [number, number, number]
}): Rect | null {
  let x0 = Number.POSITIVE_INFINITY
  let y0 = Number.POSITIVE_INFINITY
  let x1 = Number.NEGATIVE_INFINITY
  let y1 = Number.NEGATIVE_INFINITY
  let any = false
  for (const x of [box.min[0], box.max[0]])
    for (const y of [box.min[1], box.max[1]])
      for (const z of [box.min[2], box.max[2]]) {
        const p = projectWorld([x, y, z])
        if (!p.ok) continue
        any = true
        x0 = Math.min(x0, p.x)
        y0 = Math.min(y0, p.y)
        x1 = Math.max(x1, p.x)
        y1 = Math.max(y1, p.y)
      }
  return any ? { x0, y0, x1, y1 } : null
}

/** The union of several screen boxes. */
export function unionRect(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null
  return rects.reduce((all, r) => ({
    x0: Math.min(all.x0, r.x0),
    y0: Math.min(all.y0, r.y0),
    x1: Math.max(all.x1, r.x1),
    y1: Math.max(all.y1, r.y1),
  }))
}

/**
 * The free viewport a bubble may sit in: the canvas inset on every side, and clear of the top bar
 * and the action bar the editor floats over it.
 */
export function freeViewport(): Rect | null {
  const rect = canvasRect()
  if (!rect) return null
  return {
    x0: rect.left + VIEWPORT_INSET,
    y0: rect.top + BUBBLE_TOP_INSET,
    x1: rect.right - VIEWPORT_INSET,
    y1: rect.bottom - BUBBLE_BOTTOM_INSET,
  }
}
