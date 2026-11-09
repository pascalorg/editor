import { BIG_BOX_DISC, BUBBLE_GAP, SIDE_HYSTERESIS_MS } from './choreography'
import type { BubbleSide, Rect, ScreenPoint } from './types'

export type PlacementInput = {
  /** The targets' screen box. */
  box: Rect
  /** Where the finger landed on screen; null when the anchor cannot be projected (behind the camera). */
  click: ScreenPoint | null
  /** The bubble's size. */
  size: { w: number; h: number }
  /** The free viewport: the canvas minus the chat column and toolbars, already inset. */
  viewport: Rect
  /** Where the person dragged the bubble to by its context row, from its placed position. */
  offset: ScreenPoint
  /** The first placement of this bubble: no hysteresis yet. */
  first: boolean
}

export type PlacementState = {
  side: BubbleSide | null
  /** How long the current side has been invalid, in ms. */
  badMs: number
}

export type TailEdge = 'left' | 'right' | 'top' | 'bottom'

export type Placement = {
  /** The bubble's top-left on screen, drag offset included. */
  pos: ScreenPoint
  side: BubbleSide
  /** Where the tail sits on the bubble's edge, relative to the bubble; null when the click is under it. */
  tail: { edge: TailEdge; x: number; y: number } | null
  /** The side just changed: the caller springs to `pos` instead of snapping. */
  glide: boolean
  /** The click inside the bubble, for `transform-origin` on the open motion. */
  origin: ScreenPoint
  state: PlacementState
}

const SIDES = ['right', 'left', 'below', 'above'] as const
const TAIL_CORNER = 16
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

const area = (rect: Rect) => Math.max(0, rect.x1 - rect.x0) * Math.max(0, rect.y1 - rect.y0)

/**
 * Beside the target, never over it; the anchor is tracked 1:1 by the caller each frame, so this is
 * only the choice of side. A side is kept until it has been invalid for 150 ms, then the next
 * free one is taken and the move glides; with the anchor off screen the bubble docks at the nearest
 * edge (spec 2.4, rules 1-5).
 */
export function placeBubble(input: PlacementInput, state: PlacementState, dtMs: number): Placement {
  const { box, size, viewport: V, offset } = input
  const { w: bw, h: bh } = size
  const fit = (p: ScreenPoint): ScreenPoint => ({
    x: clamp(p.x, V.x0, Math.max(V.x0, V.x1 - bw)),
    y: clamp(p.y, V.y0, Math.max(V.y0, V.y1 - bh)),
  })
  const anchor =
    input.click ??
    (Number.isFinite(box.x0 + box.x1 + box.y0 + box.y1)
      ? { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 }
      : { x: (V.x0 + V.x1) / 2, y: (V.y0 + V.y1) / 2 })
  const onScreen =
    input.click !== null &&
    anchor.x >= V.x0 &&
    anchor.x <= V.x1 &&
    anchor.y >= V.y0 &&
    anchor.y <= V.y1

  let pos: ScreenPoint
  let side: BubbleSide
  let badMs = state.badMs
  if (onScreen) {
    // A target filling the view cannot be avoided: stand clear of the click instead.
    const big = area(box) > 0.5 * area(V)
    const R: Rect = big
      ? {
          x0: anchor.x - BIG_BOX_DISC,
          x1: anchor.x + BIG_BOX_DISC,
          y0: anchor.y - BIG_BOX_DISC,
          y1: anchor.y + BIG_BOX_DISC,
        }
      : box
    const at: Record<(typeof SIDES)[number], ScreenPoint> = {
      right: { x: R.x1 + BUBBLE_GAP, y: anchor.y - bh / 2 },
      left: { x: R.x0 - BUBBLE_GAP - bw, y: anchor.y - bh / 2 },
      below: { x: anchor.x - bw / 2, y: R.y1 + BUBBLE_GAP },
      above: { x: anchor.x - bw / 2, y: R.y0 - BUBBLE_GAP - bh },
    }
    const free = (s: (typeof SIDES)[number]) => {
      const p = fit(at[s])
      return p.x + bw < R.x0 - 2 || p.x > R.x1 + 2 || p.y + bh < R.y0 - 2 || p.y > R.y1 + 2
    }
    const best = SIDES.find(free) ?? 'right'
    const held = state.side && state.side !== 'dock' && !input.first ? state.side : null
    let chosen: (typeof SIDES)[number]
    if (!held) {
      chosen = best
      badMs = 0
    } else if (!free(held)) {
      badMs += dtMs
      if (badMs > SIDE_HYSTERESIS_MS) {
        chosen = best
        badMs = 0
      } else chosen = held
    } else {
      chosen = held
      badMs = 0
    }
    side = chosen
    pos = fit(at[chosen])
  } else {
    side = 'dock'
    badMs = 0
    pos = fit({ x: anchor.x - bw / 2, y: anchor.y - bh / 2 })
  }

  const glide = !input.first && state.side !== null && side !== state.side
  const placed = { x: pos.x + offset.x, y: pos.y + offset.y }

  // The tail points at the click from the bubble's nearest edge; under the bubble there is none.
  let tail: Placement['tail'] = null
  const lx = anchor.x - placed.x
  const ly = anchor.y - placed.y
  if (input.click !== null) {
    if (lx < 0) tail = { edge: 'left', x: 0, y: clamp(ly, TAIL_CORNER, bh - TAIL_CORNER) }
    else if (lx > bw) tail = { edge: 'right', x: bw, y: clamp(ly, TAIL_CORNER, bh - TAIL_CORNER) }
    else if (ly < 0) tail = { edge: 'top', x: clamp(lx, TAIL_CORNER, bw - TAIL_CORNER), y: 0 }
    else if (ly > bh) tail = { edge: 'bottom', x: clamp(lx, TAIL_CORNER, bw - TAIL_CORNER), y: bh }
  }

  return {
    pos: placed,
    side,
    tail,
    glide,
    origin: { x: clamp(lx, 0, bw), y: clamp(ly, 0, bh) },
    state: { side, badMs },
  }
}
