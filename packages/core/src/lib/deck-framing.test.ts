import { describe, expect, test } from 'bun:test'
import { DECK_BOARD_STOCK } from './deck-boards'
import {
  DECK_BEAM_INSET,
  DECK_BOARD_OVERHANG,
  DECK_POST_SPACING,
  type DeckPiece,
  type DeckWall,
  planDeckFraming,
} from './deck-framing'
import { containsPoint } from './polygon-boolean'

const IN = 0.0254
const FT = 12 * IN

// The house's rear wall runs along x at z = 0; a 16 × 12 ft deck lies behind it, +z.
const WALL: DeckWall = { start: [-1, 0], end: [8, 0], thickness: 0.14 }
const DECK: Array<[number, number]> = [
  [0, 0],
  [16 * FT, 0],
  [16 * FT, 12 * FT],
  [0, 12 * FT],
]
const TOP = 0.6
const HIGH = TOP - 36 * IN
const LOW = TOP - 18 * IN
const BURIED = TOP - 8 * IN

const bottomOf = (piece: DeckPiece) => piece.position[1] - piece.dims[1] / 2
const topOf = (piece: DeckPiece) => piece.position[1] + piece.dims[1] / 2
/** A piece's plan footprint corners. */
const corners = (piece: DeckPiece): Array<[number, number]> => {
  const [x, , z] = piece.position
  const [length, , width] = piece.dims
  const c = Math.cos(piece.yaw)
  const s = -Math.sin(piece.yaw)
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([a, b]) => [
    x + (c * a * length - s * b * width) / 2,
    z + (s * a * length + c * b * width) / 2,
  ])
}
const within = (outline: Array<[number, number]>, piece: DeckPiece) =>
  corners(piece).every(
    ([x, z]) =>
      containsPoint([{ outer: outline, holes: [] }], [x, z]) ||
      outline.some(([px, pz], i) => {
        const [qx, qz] = outline[(i + 1) % outline.length]!
        const t = Math.max(
          0,
          Math.min(
            1,
            ((x - px) * (qx - px) + (z - pz) * (qz - pz)) / ((qx - px) ** 2 + (qz - pz) ** 2),
          ),
        )
        return Math.hypot(x - px - (qx - px) * t, z - pz - (qz - pz) * t) < 1e-6
      }),
  )

describe('a 16 × 12 ft deck on the house wall, 3 ft over the grade, boards along the house', () => {
  const plan = planDeckFraming({
    polygon: DECK,
    top: TOP,
    decking: IN,
    walls: [WALL],
    gradeY: HIGH,
  })
  const t = plan.joist!.thickness

  test('a ledger on the wall; joists square to it at 16 in from side to side, under the boards; rims set in so the boards overhang them, none at the house', () => {
    expect(plan.axes?.ledgerEdge).toBe(0)
    expect(plan.ledger?.position[2]).toBeCloseTo(t / 2, 9)
    expect(plan.ledger?.dims[0]).toBeCloseTo(16 * FT - 2 * DECK_BOARD_OVERHANG, 9)
    const xs = plan.joists.map((joist) => joist.position[0]).sort((a, b) => a - b)
    expect(xs[0]).toBeCloseTo(DECK_BOARD_OVERHANG + t / 2, 9)
    expect(xs.at(-1)).toBeCloseTo(16 * FT - DECK_BOARD_OVERHANG - t / 2, 9)
    for (let i = 1; i < xs.length; i++)
      expect(xs[i]! - xs[i - 1]!).toBeLessThanOrEqual(16 * IN + 1e-9)
    for (const joist of plan.joists) {
      expect(topOf(joist)).toBeCloseTo(TOP - IN, 9)
      expect(joist.dims[0]).toBeCloseTo(12 * FT - DECK_BOARD_OVERHANG - 2 * t, 9)
      expect(joist.hangers).toHaveLength(1)
    }
    // the end joists are the side rims
    expect(plan.joists.filter((joist) => joist.atRim)).toHaveLength(2)
    expect(plan.rims).toHaveLength(3)
    const outer = plan.rims.find((rim) => rim.position[2] > 3)!
    expect(outer.position[2]).toBeCloseTo(12 * FT - DECK_BOARD_OVERHANG - t / 2, 9)
  })

  test('one 4x8 beam dropped under the joists 16 in in from the outer rim, on 4x4 posts to the grade no more than 8 ft apart', () => {
    expect(plan.beam).toBe('dropped')
    expect(plan.beams).toHaveLength(1)
    const [beam] = plan.beams as [DeckPiece]
    expect(beam.size).toBe('4x8')
    expect(beam.position[2]).toBeCloseTo(12 * FT - DECK_BOARD_OVERHANG - DECK_BEAM_INSET, 9)
    expect(topOf(beam)).toBeCloseTo(TOP - IN - plan.joist!.depth, 9)
    const posts = plan.posts.slice().sort((a, b) => a.position[0] - b.position[0])
    expect(posts.length).toBeGreaterThanOrEqual(3)
    for (let i = 1; i < posts.length; i++)
      expect(posts[i]!.position[0] - posts[i - 1]!.position[0]).toBeLessThanOrEqual(
        DECK_POST_SPACING,
      )
    for (const post of posts) {
      expect(post.size).toBe('4x4')
      expect(bottomOf(post)).toBeCloseTo(HIGH, 9)
      expect(topOf(post)).toBeCloseTo(bottomOf(beam), 9)
    }
  })

  test('every piece lies inside the outline', () => {
    for (const piece of [plan.ledger!, ...plan.rims, ...plan.joists, ...plan.beams])
      expect(within(DECK, piece)).toBe(true)
  })
})

test('diagonal boards close the joists to 12 in under 5/4 or composite boards; 2x boards span 16 in at 45°', () => {
  const at = (boardSize: 'composite' | '2x6') =>
    planDeckFraming({
      polygon: DECK,
      top: TOP,
      decking: DECK_BOARD_STOCK[boardSize].thickness,
      walls: [WALL],
      gradeY: HIGH,
      boards: { boardSize, gap: IN / 4, direction: 'diagonal' },
    })
  const diagonal = planDeckFraming({
    polygon: DECK,
    top: TOP,
    decking: IN,
    walls: [WALL],
    gradeY: HIGH,
    boards: { boardSize: '5/4x6', gap: IN / 4, direction: 'diagonal' },
  })
  expect(diagonal.joistSpacing).toBeCloseTo(12 * IN, 9)
  expect(diagonal.spacingForBoards).toBe(true)
  const xs = diagonal.joists.map((joist) => joist.position[0]).sort((a, b) => a - b)
  for (let i = 1; i < xs.length; i++)
    expect(xs[i]! - xs[i - 1]!).toBeLessThanOrEqual(12 * IN + 1e-9)
  expect(at('composite').joistSpacing).toBeCloseTo(12 * IN, 9)
  expect(at('2x6').joistSpacing).toBeCloseTo(16 * IN, 9)
  expect(at('2x6').spacingForBoards).toBe(false)
})

test('boards out from the house turn the joists to run along it, on beams square to the house at both sides; the ledger hangs none', () => {
  const plan = planDeckFraming({
    polygon: DECK,
    top: TOP,
    decking: IN,
    walls: [WALL],
    gradeY: HIGH,
    boards: { boardSize: '5/4x6', gap: IN / 4, direction: 'perpendicular' },
  })
  expect(plan.joistsAlongHouse).toBe(true)
  for (const joist of plan.joists) {
    // along x, the house's run
    expect(Math.abs(Math.cos(joist.yaw))).toBeCloseTo(1, 9)
    expect(joist.hangers).toEqual([])
  }
  const zs = plan.joists.map((joist) => joist.position[2]).sort((a, b) => a - b)
  for (let i = 1; i < zs.length; i++)
    expect(zs[i]! - zs[i - 1]!).toBeLessThanOrEqual(16 * IN + 1e-9)
  expect(plan.beams).toHaveLength(2)
  const xs = plan.beams.map((beam) => beam.position[0]).sort((a, b) => a - b)
  expect(xs[0]).toBeCloseTo(DECK_BOARD_OVERHANG + DECK_BEAM_INSET, 9)
  expect(xs[1]).toBeCloseTo(16 * FT - DECK_BOARD_OVERHANG - DECK_BEAM_INSET, 9)
  for (const beam of plan.beams) expect(Math.abs(Math.sin(beam.yaw))).toBeCloseTo(1, 9)
  // posts under both beams, both ends of each
  expect(plan.posts.length).toBeGreaterThanOrEqual(4)
  expect(new Set(plan.posts.map((post) => post.position[0].toFixed(3))).size).toBe(2)
  // the joists span between the beams: sized for that, not the deck's width
  expect(plan.joist?.size).toBe('2x10')
  for (const piece of [plan.ledger!, ...plan.rims, ...plan.joists, ...plan.beams])
    expect(within(DECK, piece)).toBe(true)
})

test('a deck too wide for the joists gets a beam between, its joists sized for the shorter span', () => {
  const wide: Array<[number, number]> = [
    [0, 0],
    [30 * FT, 0],
    [30 * FT, 12 * FT],
    [0, 12 * FT],
  ]
  const plan = planDeckFraming({
    polygon: wide,
    top: TOP,
    decking: IN,
    walls: [{ start: [-1, 0], end: [10, 0], thickness: 0.14 }],
    gradeY: HIGH,
    boards: { boardSize: '5/4x6', gap: IN / 4, direction: 'perpendicular' },
  })
  // 27 ft between the outer beams: two bays of 13 ft 7 in, a 2x10's
  expect(plan.beams).toHaveLength(3)
  expect(plan.spanPastTable).toBe(false)
  expect(plan.joist?.size).toBe('2x10')
})

test('a low deck doubles its beam inside the outer rim, the joists hung on it; below grade nothing props it', () => {
  const low = planDeckFraming({ polygon: DECK, top: TOP, decking: IN, walls: [WALL], gradeY: LOW })
  expect(low.beam).toBe('flush')
  const t = low.joist!.thickness
  const [beam] = low.beams as [DeckPiece]
  expect(beam.size).toBe(low.joist!.size)
  expect(topOf(beam)).toBeCloseTo(TOP - IN, 9)
  expect(beam.position[2]).toBeCloseTo(12 * FT - DECK_BOARD_OVERHANG - 1.5 * t, 9)
  for (const joist of low.joists) {
    expect(joist.dims[0]).toBeCloseTo(12 * FT - DECK_BOARD_OVERHANG - 3 * t, 9)
    expect(joist.hangers).toHaveLength(2)
  }
  for (const post of low.posts) expect(bottomOf(post)).toBeCloseTo(LOW, 9)
  const buried = planDeckFraming({
    polygon: DECK,
    top: TOP,
    decking: IN,
    walls: [WALL],
    gradeY: BURIED,
  })
  expect(buried.beam).toBe('unsupported')
  expect(buried.posts).toEqual([])
  expect(buried.joists.length).toBeGreaterThan(0)
})

test('an L-shaped deck frames along its outline: a rim on every free edge, a beam under each outer edge, every joist inside', () => {
  const ell: Array<[number, number]> = [
    [0, 0],
    [20 * FT, 0],
    [20 * FT, 8 * FT],
    [10 * FT, 8 * FT],
    [10 * FT, 14 * FT],
    [0, 14 * FT],
  ]
  const plan = planDeckFraming({
    polygon: ell,
    top: TOP,
    decking: IN,
    walls: [{ start: [-1, 0], end: [22 * FT, 0], thickness: 0.14 }],
    gradeY: HIGH,
  })
  expect(plan.irregular).toBe(true)
  expect(plan.rims).toHaveLength(5)
  expect(plan.beams).toHaveLength(2)
  for (const piece of [plan.ledger!, ...plan.rims, ...plan.joists, ...plan.beams])
    expect(within(ell, piece)).toBe(true)
  const short = plan.joists.filter((joist) => joist.position[0] > 10 * FT + 1)
  const long = plan.joists.filter((joist) => joist.position[0] < 10 * FT - 1)
  for (const joist of short) expect(joist.position[2] + joist.dims[0] / 2).toBeLessThan(8 * FT)
  expect(Math.max(...long.map((joist) => joist.position[2] + joist.dims[0] / 2))).toBeGreaterThan(
    12 * FT,
  )
})

test('posts run to the ground under each; posts already standing on a beam line carry it', () => {
  const sloped = planDeckFraming({
    polygon: DECK,
    top: TOP,
    decking: IN,
    walls: [WALL],
    gradeY: HIGH,
    gradeAt: (x) => HIGH - 0.05 * x,
  })
  for (const post of sloped.posts)
    expect(bottomOf(post)).toBeCloseTo(HIGH - 0.05 * post.position[0], 9)
  const line = 12 * FT - DECK_BOARD_OVERHANG - DECK_BEAM_INSET
  const carried = planDeckFraming({
    polygon: DECK,
    top: TOP,
    decking: IN,
    walls: [WALL],
    gradeY: HIGH,
    carriers: [
      [1, line + 0.1],
      [16 * FT - 1, line - 0.1],
    ],
  })
  expect(carried.beams[0]?.carried).toBe(true)
  expect(carried.posts).toEqual([])
})

test('a deck with no wall on any edge stands free: rims all round, beams under both ends of the joists', () => {
  const free = planDeckFraming({ polygon: DECK, top: TOP, decking: IN, walls: [], gradeY: HIGH })
  expect(free.axes?.ledgerEdge).toBeNull()
  expect(free.ledger).toBeNull()
  expect(free.rims).toHaveLength(4)
  expect(free.beams).toHaveLength(2)
  for (const joist of free.joists) expect(joist.hangers).toEqual([])
  const sliver = planDeckFraming({
    polygon: [
      [0, 0],
      [0.2, 0],
      [0.2, 0.2],
      [0, 0.2],
    ],
    top: TOP,
    decking: IN,
    walls: [WALL],
    gradeY: HIGH,
  })
  expect([...sliver.rims, ...sliver.joists, ...sliver.beams, ...sliver.posts]).toEqual([])
})
