import { describe, expect, test } from 'bun:test'
import { type AnyNode, DoorNode, RoofSegmentNode, WallNode, WindowNode } from '../schema'
import {
  DEFAULT_OPENING_CASING_WIDTH,
  OPENING_CASING_PROUD,
  type OpeningCasingBoard,
  openingCasingBoards,
  openingCasingFaces,
  resolveOpeningCasingHost,
} from './opening-casing'

// Casing once sat inside the doors and windows. Now the cutout is the unit's
// own size and the casing is boards on the finished wall faces around it, on
// both faces unless one is turned off, 2 in wide.

const INCH = 0.0254
const host = { thickness: 0.2 }

const window = (values: Record<string, unknown> = {}) =>
  WindowNode.parse({
    id: 'window_c',
    position: [2, 1.2, 0],
    width: 1.2,
    height: 1,
    casingFaceA: true,
    casingFaceB: true,
    ...values,
  })
const door = (values: Record<string, unknown> = {}) =>
  DoorNode.parse({
    id: 'door_c',
    position: [2, 1.05, 0],
    width: 0.9,
    height: 2.1,
    casingFaceA: true,
    casingFaceB: true,
    ...values,
  })

const parts = (boards: OpeningCasingBoard[], face: 'a' | 'b') =>
  boards
    .filter((board) => board.face === face)
    .map((board) => board.part)
    .sort()

/** A board's extent along one axis of the host frame. */
const span = (board: OpeningCasingBoard, axis: 0 | 1 | 2) => [
  board.center[axis] - board.size[axis] / 2,
  board.center[axis] + board.size[axis] / 2,
]

describe('opening casing schema', () => {
  test('a door or window saved before casing loads without casing', () => {
    for (const legacy of [
      WindowNode.parse({ id: 'window_old', width: 1.2, height: 1 }),
      DoorNode.parse({ id: 'door_old', width: 0.9, height: 2.1 }),
    ]) {
      expect(legacy.casingFaceA).toBe(false)
      expect(legacy.casingFaceB).toBe(false)
      expect(openingCasingBoards(legacy, host)).toEqual([])
      expect(legacy.casingWidth).toBeCloseTo(2 * INCH, 12)
    }
    expect(DEFAULT_OPENING_CASING_WIDTH).toBeCloseTo(2 * INCH, 12)
    expect(OPENING_CASING_PROUD).toBeCloseTo(0.75 * INCH, 12)
  })

  test('a casing face turned off stays off', () => {
    const parsed = WindowNode.parse({ id: 'window_off', casingFaceA: false, casingWidth: 0.09 })
    expect(parsed.casingFaceA).toBe(false)
    expect(parsed.casingFaceB).toBe(false)
    expect(parsed.casingWidth).toBe(0.09)
  })
})

describe('opening casing boards', () => {
  test('a window is a picture frame on each face; a door has no board at the floor', () => {
    const windowBoards = openingCasingBoards(window({ sill: false }), host)
    expect(parts(windowBoards, 'a')).toEqual(['bottom', 'head', 'leg', 'leg'])
    expect(parts(windowBoards, 'b')).toEqual(['bottom', 'head', 'leg', 'leg'])
    const doorBoards = openingCasingBoards(door(), host)
    expect(parts(doorBoards, 'a')).toEqual(['head', 'leg', 'leg'])
    expect(parts(doorBoards, 'b')).toEqual(['head', 'leg', 'leg'])
  })

  test('every board stands on a finished face, outside the opening', () => {
    for (const opening of [window(), door()]) {
      for (const board of openingCasingBoards(opening, host)) {
        const [z0, z1] = span(board, 2)
        if (board.face === 'a') {
          expect(z0).toBeCloseTo(0.1, 12)
          expect(z1).toBeCloseTo(0.1 + OPENING_CASING_PROUD, 12)
        } else {
          expect(z1).toBeCloseTo(-0.1, 12)
          expect(z0).toBeCloseTo(-0.1 - OPENING_CASING_PROUD, 12)
        }
        const [x0, x1] = span(board, 0)
        const [y0, y1] = span(board, 1)
        const beside = x0 >= opening.width / 2 - 1e-12 || x1 <= -opening.width / 2 + 1e-12
        const aboveOrBelow = y0 >= opening.height / 2 - 1e-12 || y1 <= -opening.height / 2 + 1e-12
        expect(beside || aboveOrBelow).toBe(true)
      }
    }
  })

  test('the boards are as wide as the casing, and butt: head and bottom run over the legs', () => {
    const boards = openingCasingBoards(window({ casingWidth: 3 * INCH }), host)
    const head = boards.find((board) => board.part === 'head')!
    const leg = boards.find((board) => board.part === 'leg')!
    expect(head.size[1]).toBeCloseTo(3 * INCH, 12)
    expect(head.size[0]).toBeCloseTo(1.2 + 6 * INCH, 12)
    expect(leg.size[0]).toBeCloseTo(3 * INCH, 12)
    expect(leg.size[1]).toBeCloseTo(1, 12)
  })

  test('a face turned off has no boards', () => {
    const boards = openingCasingBoards(door({ casingFaceB: false }), host)
    expect(boards.length).toBeGreaterThan(0)
    expect(boards.every((board) => board.face === 'a')).toBe(true)
    expect(openingCasingBoards(door({ casingFaceA: false, casingFaceB: false }), host)).toEqual([])
  })

  test('an opening off the wall centre still cases the wall faces', () => {
    const faces = openingCasingFaces(window({ position: [2, 1.2, 0.05] }), host)
    expect(faces).toEqual([
      { face: 'a', plane: 0.05, out: 1 },
      { face: 'b', plane: -0.15000000000000002, out: -1 },
    ])
  })

  test('a sill takes the bottom board under it, on the window’s own front only', () => {
    const drop = 0.03
    for (const [rotationY, front] of [
      [0, 'a'],
      [Math.PI, 'b'],
    ] as const) {
      const boards = openingCasingBoards(
        window({ sill: true, sillThickness: drop, rotation: [0, rotationY, 0] }),
        host,
      )
      const bottomTop = (face: 'a' | 'b') =>
        span(boards.find((board) => board.face === face && board.part === 'bottom')!, 1)[1]
      const back = front === 'a' ? 'b' : 'a'
      expect(bottomTop(front)).toBeCloseTo(-0.5 - drop, 12)
      expect(bottomTop(back)).toBeCloseTo(-0.5, 12)
      expect(parts(boards, front)).toEqual(['bottom', 'foot', 'foot', 'head', 'leg', 'leg'])
    }
  })

  test('a corner window has no leg at its corner, and its head stops there', () => {
    const boards = openingCasingBoards(window(), { ...host, cornerEnd: 'end' })
    const legs = boards.filter((board) => board.face === 'a' && board.part === 'leg')
    expect(legs).toHaveLength(1)
    expect(legs[0]!.center[0]).toBeLessThan(0)
    const head = boards.find((board) => board.face === 'a' && board.part === 'head')!
    expect(span(head, 0)[1]).toBeCloseTo(0.6, 12)
  })
})

describe('opening casing host', () => {
  const wall = WallNode.parse({ id: 'wall_c', start: [0, 0], end: [4, 0], thickness: 0.15 })

  test('a wall cases on its own thickness; a curtain wall or a scripted unit takes none', () => {
    const nodes = { [wall.id]: wall } as Record<string, AnyNode>
    expect(resolveOpeningCasingHost(window({ parentId: wall.id }), nodes)).toEqual({
      thickness: 0.15,
    })
    const curtain = { ...wall, wallType: 'curtain' as const }
    expect(resolveOpeningCasingHost(window({ parentId: wall.id }), { [wall.id]: curtain })).toBe(
      null,
    )
    expect(resolveOpeningCasingHost(window(), nodes)).toBe(null)
  })

  test('a gable-end opening cases on the roof segment’s wall', () => {
    const segment = RoofSegmentNode.parse({ id: 'rseg_c', wallThickness: 0.18 })
    const opening = window({ roofSegmentId: segment.id, roofFace: 'front', parentId: segment.id })
    expect(
      resolveOpeningCasingHost(opening, { [segment.id]: segment } as Record<string, AnyNode>),
    ).toEqual({ thickness: 0.18 })
  })
})
