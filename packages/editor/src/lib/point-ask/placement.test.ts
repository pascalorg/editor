import { describe, expect, test } from 'bun:test'
import { type PlacementInput, type PlacementState, placeBubble } from './placement'
import type { Rect } from './types'

// The bubble sits beside its target and never covers it (spec 2.4, placement). Written first: a
// bubble over the thing it asks about; a side that flips on every frame at the boundary; a bubble
// that detaches from its anchor; a bubble that leaves the viewport.

const VIEWPORT: Rect = { x0: 12, y0: 56, x1: 1000, y1: 700 }
const SIZE = { w: 320, h: 180 }
const FRESH: PlacementState = { side: null, badMs: 0 }

const input = (more: Partial<PlacementInput> = {}): PlacementInput => ({
  box: { x0: 400, y0: 300, x1: 500, y1: 400 },
  click: { x: 450, y: 350 },
  size: SIZE,
  viewport: VIEWPORT,
  offset: { x: 0, y: 0 },
  first: true,
  ...more,
})

const bubbleRect = (pos: { x: number; y: number }): Rect => ({
  x0: pos.x,
  y0: pos.y,
  x1: pos.x + SIZE.w,
  y1: pos.y + SIZE.h,
})

const touches = (a: Rect, b: Rect) => !(a.x1 < b.x0 || a.x0 > b.x1 || a.y1 < b.y0 || a.y0 > b.y1)

describe('which side the bubble takes', () => {
  test('right of the target first, centred on the click row', () => {
    const placed = placeBubble(input(), FRESH, 16)

    expect(placed.side).toBe('right')
    expect(placed.pos).toEqual({ x: 516, y: 260 })
    expect(placed.glide).toBe(false)
  })

  test('left when the right has no room', () => {
    const placed = placeBubble(
      input({ box: { x0: 700, y0: 300, x1: 800, y1: 400 }, click: { x: 750, y: 350 } }),
      FRESH,
      16,
    )

    expect(placed.side).toBe('left')
    expect(placed.pos.x).toBe(700 - 16 - 320)
  })

  test('below when a wide target blocks both sides', () => {
    const box = { x0: 50, y0: 300, x1: 990, y1: 400 }
    const placed = placeBubble(input({ box, click: { x: 500, y: 350 } }), FRESH, 16)

    expect(placed.side).toBe('below')
    expect(placed.pos).toEqual({ x: 500 - 160, y: 416 })
  })

  test('above when it is blocked on every other side', () => {
    const box = { x0: 50, y0: 560, x1: 990, y1: 690 }
    const placed = placeBubble(input({ box, click: { x: 500, y: 620 } }), FRESH, 16)

    expect(placed.side).toBe('above')
    expect(placed.pos.y).toBe(560 - 16 - 180)
  })

  test('is clamped inside the viewport', () => {
    const box = { x0: 30, y0: 60, x1: 90, y1: 120 }
    const placed = placeBubble(input({ box, click: { x: 60, y: 90 } }), FRESH, 16)

    expect(placed.pos.x).toBeGreaterThanOrEqual(VIEWPORT.x0)
    expect(placed.pos.y).toBeGreaterThanOrEqual(VIEWPORT.y0)
    expect(placed.pos.x + SIZE.w).toBeLessThanOrEqual(VIEWPORT.x1)
    expect(placed.pos.y + SIZE.h).toBeLessThanOrEqual(VIEWPORT.y1)
  })

  test('never covers the target when a side fits', () => {
    for (const box of [
      { x0: 400, y0: 300, x1: 500, y1: 400 },
      { x0: 700, y0: 300, x1: 800, y1: 400 },
      { x0: 50, y0: 300, x1: 990, y1: 400 },
      { x0: 50, y0: 560, x1: 990, y1: 690 },
    ]) {
      const click = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 }
      const placed = placeBubble(input({ box, click }), FRESH, 16)

      expect(touches(bubbleRect(placed.pos), box)).toBe(false)
    }
  })

  test('a target filling the view puts the bubble beside the click, outside a 48 px disc', () => {
    const box = { x0: 12, y0: 56, x1: 900, y1: 690 }
    const click = { x: 450, y: 300 }
    const placed = placeBubble(input({ box, click }), FRESH, 16)
    const disc = { x0: click.x - 48, y0: click.y - 48, x1: click.x + 48, y1: click.y + 48 }

    expect(placed.side).toBe('right')
    expect(placed.pos.x).toBe(click.x + 48 + 16)
    expect(touches(bubbleRect(placed.pos), disc)).toBe(false)
  })

  test('the user’s drag offset moves it, and the tail follows', () => {
    const plain = placeBubble(input(), FRESH, 16)
    const moved = placeBubble(input({ offset: { x: 30, y: -20 } }), FRESH, 16)

    expect(moved.pos).toEqual({ x: plain.pos.x + 30, y: plain.pos.y - 20 })
    expect(moved.tail?.y).toBe((plain.tail?.y ?? 0) + 20)
  })
})

describe('hysteresis: a side is kept until it has been wrong for 150 ms', () => {
  const blockedRight = input({
    box: { x0: 700, y0: 300, x1: 800, y1: 400 },
    click: { x: 750, y: 350 },
    first: false,
  })

  test('no switch before 150 ms', () => {
    const first = placeBubble(blockedRight, { side: 'right', badMs: 0 }, 100)

    expect(first.side).toBe('right')
    expect(first.glide).toBe(false)
    expect(first.state).toEqual({ side: 'right', badMs: 100 })
  })

  test('the switch after 150 ms glides, and resets the clock', () => {
    const first = placeBubble(blockedRight, { side: 'right', badMs: 0 }, 100)
    const second = placeBubble(blockedRight, first.state, 60)

    expect(second.side).toBe('left')
    expect(second.glide).toBe(true)
    expect(second.state).toEqual({ side: 'left', badMs: 0 })
  })

  test('a side that is right again clears the count', () => {
    const wrong = placeBubble(blockedRight, { side: 'right', badMs: 0 }, 100)
    const right = placeBubble(input({ first: false }), wrong.state, 16)

    expect(right.side).toBe('right')
    expect(right.state.badMs).toBe(0)
  })

  test('with every side blocked it still obeys the 150 ms rule', () => {
    const viewport = { x0: 400, y0: 200, x1: 620, y1: 420 }
    const crowded = input({
      box: { x0: 400, y0: 200, x1: 620, y1: 420 },
      click: { x: 500, y: 300 },
      viewport,
      first: false,
    })
    const early = placeBubble(crowded, { side: 'left', badMs: 0 }, 100)
    const late = placeBubble(crowded, early.state, 100)

    expect(early.side).toBe('left')
    expect(early.glide).toBe(false)
    expect(late.side).toBe('right')
    expect(late.glide).toBe(true)
  })
})

describe('the tail', () => {
  test('sits on the edge facing the click, 16 px from the corners at most', () => {
    const placed = placeBubble(input(), FRESH, 16)

    expect(placed.tail).toEqual({ edge: 'left', x: 0, y: 90 })
  })

  test('on the top edge for a bubble below its target', () => {
    const box = { x0: 50, y0: 300, x1: 990, y1: 400 }
    const placed = placeBubble(input({ box, click: { x: 500, y: 350 } }), FRESH, 16)

    expect(placed.tail?.edge).toBe('top')
    expect(placed.tail?.y).toBe(0)
    expect(placed.tail?.x).toBe(160)
  })

  test('is clamped 16 px from the corners', () => {
    const placed = placeBubble(
      input({ box: { x0: 400, y0: 300, x1: 500, y1: 400 }, click: { x: 450, y: 305 } }),
      FRESH,
      16,
    )

    expect(placed.tail?.edge).toBe('left')
    expect(placed.tail?.y).toBeGreaterThanOrEqual(16)
    expect(placed.tail?.y).toBeLessThanOrEqual(180 - 16)
  })

  test('is hidden when the click is under the bubble', () => {
    const box = { x0: 12, y0: 56, x1: 1000, y1: 700 }
    const placed = placeBubble(
      input({ box, click: { x: 600, y: 300 }, offset: { x: -200, y: 0 } }),
      FRESH,
      16,
    )

    expect(placed.tail).toBeNull()
  })

  test('the origin of the open motion is the click, inside the bubble', () => {
    const placed = placeBubble(input(), FRESH, 16)

    expect(placed.origin).toEqual({ x: 0, y: 90 })
  })
})

describe('docking', () => {
  test('a click off the viewport docks at the nearest edge, the tail turned to it', () => {
    const placed = placeBubble(
      input({ click: { x: -50, y: 300 }, box: { x0: -80, y0: 250, x1: -20, y1: 350 } }),
      FRESH,
      16,
    )

    expect(placed.side).toBe('dock')
    expect(placed.pos.x).toBe(VIEWPORT.x0)
    expect(placed.tail).toEqual({ edge: 'left', x: 0, y: 90 })
  })

  test('docks on the right and at the bottom too', () => {
    const right = placeBubble(
      input({ click: { x: 1300, y: 300 }, box: { x0: 1280, y0: 250, x1: 1320, y1: 350 } }),
      FRESH,
      16,
    )
    const bottom = placeBubble(
      input({ click: { x: 500, y: 900 }, box: { x0: 480, y0: 880, x1: 520, y1: 920 } }),
      FRESH,
      16,
    )

    expect(right.pos.x).toBe(VIEWPORT.x1 - SIZE.w)
    expect(right.tail?.edge).toBe('right')
    expect(bottom.pos.y).toBe(VIEWPORT.y1 - SIZE.h)
    expect(bottom.tail?.edge).toBe('bottom')
  })

  test('a click that cannot be projected docks inside the view with no tail', () => {
    const placed = placeBubble(input({ click: null }), FRESH, 16)

    expect(placed.side).toBe('dock')
    expect(placed.tail).toBeNull()
    expect(placed.pos.x).toBeGreaterThanOrEqual(VIEWPORT.x0)
    expect(placed.pos.x + SIZE.w).toBeLessThanOrEqual(VIEWPORT.x1)
  })

  test('coming back from the dock re-chooses a side and glides', () => {
    const docked = placeBubble(
      input({ click: { x: -50, y: 300 }, box: { x0: -80, y0: 250, x1: -20, y1: 350 } }),
      FRESH,
      16,
    )
    const back = placeBubble(input({ first: false }), docked.state, 16)

    expect(back.side).toBe('right')
    expect(back.glide).toBe(true)
  })
})
