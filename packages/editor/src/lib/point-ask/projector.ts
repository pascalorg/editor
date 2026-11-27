import { Vector3 } from 'three'
import { getEditorFloorplanContext } from '../../components/editor/floorplan-context-bridge'
import { getEditorThreeContext } from '../../components/editor/three-context-bridge'
import useEditor from '../../store/use-editor'
import { activeViewLayout, isViewVisible, VIEW_2D, VIEW_3D } from '../../store/view-layout'
import { BUBBLE_BOTTOM_INSET, BUBBLE_TOP_INSET, VIEWPORT_INSET } from './overlay-metrics'
import type { PointViewport, Rect, ScreenPoint } from './types'

// World to screen for the DOM overlay, read from the live editor camera or 2D floorplan each
// frame: the overlay lives outside the R3F/SVG trees, so it asks whichever surface owns a pane.
// Screen units are CSS pixels in viewport coordinates (the overlay is `position: fixed`).

const scratch = new Vector3()

export type Projected = ScreenPoint & { ok: boolean }

function hasArea(rect: DOMRect | null | undefined): rect is DOMRect {
  return Boolean(rect && rect.width > 0 && rect.height > 0)
}

/** The live bounding rectangle of a specific viewport (`'3d'` or `'2d'`), or null if hidden/unmounted. */
export function viewportRect(viewport: PointViewport): DOMRect | null {
  const editor = useEditor.getState()
  if (viewport === '3d') {
    if (!isViewVisible(editor, VIEW_3D)) return null
    const rect = getEditorThreeContext()?.domElement.getBoundingClientRect()
    return hasArea(rect) ? rect : null
  }
  if (editor.isFirstPersonMode || !isViewVisible(editor, VIEW_2D)) return null
  const rect = getEditorFloorplanContext()?.getRect()
  return hasArea(rect) ? rect : null
}

/** Mounted, visible scene viewports in pane order. */
export function visiblePointViewports(): PointViewport[] {
  const layout = activeViewLayout(useEditor.getState())
  const panes = layout.split ? layout.panes : [layout.panes[0]]
  const result: PointViewport[] = []
  for (const pane of panes) {
    if ((pane === VIEW_3D || pane === VIEW_2D) && viewportRect(pane)) {
      result.push(pane)
    }
  }
  return result
}

/** Preferred scene viewport (focused pane first, then any visible scene viewport). */
export function preferredPointViewport(): PointViewport | null {
  const layout = activeViewLayout(useEditor.getState())
  const focused = layout.panes[layout.focus]
  if ((focused === VIEW_3D || focused === VIEW_2D) && viewportRect(focused)) return focused
  return visiblePointViewports()[0] ?? null
}

/** The active scene viewport's canvas/SVG rect (defaults to preferred viewport for compatibility). */
export function canvasRect(viewport?: PointViewport): DOMRect | null {
  if (viewport) return viewportRect(viewport)
  const preferred = preferredPointViewport()
  if (preferred) return viewportRect(preferred)
  const fallback = getEditorThreeContext()?.domElement.getBoundingClientRect()
  return hasArea(fallback) ? fallback : null
}

/** A world point on the page in `viewport`; `ok` is false behind the camera or outside the clip volume. */
export function projectWorldIn(
  point: readonly [number, number, number],
  viewport: PointViewport,
): Projected {
  if (viewport === '2d') {
    const floorplan = getEditorFloorplanContext()
    if (!(floorplan && viewportRect('2d'))) return { x: 0, y: 0, ok: false }
    return floorplan.projectWorld(point)
  }
  const three = getEditorThreeContext()
  const rect = viewportRect('3d') ?? (three ? three.domElement.getBoundingClientRect() : null)
  if (!(three && hasArea(rect))) return { x: 0, y: 0, ok: false }
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

/** A world point on the page in the preferred (or specified) viewport. */
export function projectWorld(
  point: readonly [number, number, number],
  viewport: PointViewport = preferredPointViewport() ?? '3d',
): Projected {
  return projectWorldIn(point, viewport)
}

/** The screen box of a world box in `viewport`; null when nothing of it projects cleanly. */
export function projectBoxIn(
  box: {
    min: readonly [number, number, number]
    max: readonly [number, number, number]
  },
  viewport: PointViewport,
): Rect | null {
  let x0 = Number.POSITIVE_INFINITY
  let y0 = Number.POSITIVE_INFINITY
  let x1 = Number.NEGATIVE_INFINITY
  let y1 = Number.NEGATIVE_INFINITY
  let any = false
  const ys = viewport === '2d' ? [box.min[1]] : [box.min[1], box.max[1]]
  for (const x of [box.min[0], box.max[0]])
    for (const y of ys)
      for (const z of [box.min[2], box.max[2]]) {
        const p = projectWorldIn([x, y, z], viewport)
        if (!p.ok) continue
        any = true
        x0 = Math.min(x0, p.x)
        y0 = Math.min(y0, p.y)
        x1 = Math.max(x1, p.x)
        y1 = Math.max(y1, p.y)
      }
  if (!any) return null
  if (viewport === '2d') {
    const minSpan = 8
    if (x1 - x0 < minSpan) {
      const cx = (x0 + x1) / 2
      x0 = cx - minSpan / 2
      x1 = cx + minSpan / 2
    }
    if (y1 - y0 < minSpan) {
      const cy = (y0 + y1) / 2
      y0 = cy - minSpan / 2
      y1 = cy + minSpan / 2
    }
  }
  return { x0, y0, x1, y1 }
}

/** The screen box of a world box in the preferred (or specified) viewport. */
export function projectBox(
  box: {
    min: readonly [number, number, number]
    max: readonly [number, number, number]
  },
  viewport: PointViewport = preferredPointViewport() ?? '3d',
): Rect | null {
  return projectBoxIn(box, viewport)
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

/** The free viewport a bubble or card may sit in inside `viewport`. */
export function freeViewportIn(
  viewport: PointViewport = preferredPointViewport() ?? '3d',
): Rect | null {
  const rect = canvasRect(viewport)
  if (!rect) return null
  return {
    x0: rect.left + VIEWPORT_INSET,
    y0: rect.top + BUBBLE_TOP_INSET,
    x1: rect.right - VIEWPORT_INSET,
    y1: rect.bottom - BUBBLE_BOTTOM_INSET,
  }
}

/**
 * The free viewport a bubble may sit in: the canvas/SVG inset on every side, and clear of the
 * top bar and the action bar the editor floats over it.
 */
export function freeViewport(): Rect | null {
  return freeViewportIn()
}

/** Union bounding rect of all visible scene panes (for stage-centered UI like ModePill). */
export function stageRect(): DOMRect | null {
  const rects = visiblePointViewports()
    .map((vp) => viewportRect(vp))
    .filter((r): r is DOMRect => r !== null)
  if (rects.length === 0) return canvasRect()
  const left = Math.min(...rects.map((r) => r.left))
  const top = Math.min(...rects.map((r) => r.top))
  const right = Math.max(...rects.map((r) => r.right))
  const bottom = Math.max(...rects.map((r) => r.bottom))
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    x: left,
    y: top,
    toJSON() {
      return this
    },
  } as DOMRect
}
