import { describe, expect, test } from 'bun:test'
import { setZoneIntent } from '../commands/structure/set-zone-intent'
import { applyToScratch, structureChangeBatch } from '../commands/structure/shared'
import { enclosed } from '../commands/structure/structure.test'
import { type AnyNode, type SlabNode, WallNode, type ZoneNode } from '../schema'
import { railingWallDefaults } from '../schema/nodes/railing-wall'
import {
  DECK_BOARD_JOINT_GAP,
  DECK_BOARD_MAX_LENGTH,
  DECK_BOARD_STOCK,
  DEFAULT_DECK_BOARDS,
  deckBoardSettings,
  deckBoardThickness,
  deckSlabBoards,
  layoutDeckBoards,
} from './deck-boards'
import { area, difference, type MultiPolygon, type Polygon, union } from './polygon-boolean'
import { reconcileLevelStructure } from './structure-kernel'

const IN = 0.0254
const FT = 12 * IN
const LEVEL = 'level_test'

/** Settle the level's structure as the live sync does after an edit. */
function settle(before: Record<string, AnyNode>, after: Record<string, AnyNode>) {
  let i = 0
  const derived = reconcileLevelStructure({
    levelId: LEVEL,
    nodes: after,
    previousNodes: before,
    mintId: (kind) => {
      let id: string
      do id = `${kind}_derived${++i}`
      while (after[id])
      return id
    },
  })
  return applyToScratch(after, structureChangeBatch(derived.patches))
}

/** The kitchen (8 × 4) with a deck fenced off its z = 4 side by railings. */
function withDeck() {
  const { nodes } = enclosed()
  let next: Record<string, AnyNode> = nodes
  const sides: Array<[[number, number], [number, number]]> = [
    [
      [2, 4],
      [2, 6],
    ],
    [
      [2, 6],
      [6, 6],
    ],
    [
      [6, 6],
      [6, 4],
    ],
  ]
  sides.forEach(([start, end], index) => {
    const railing = WallNode.parse({
      ...railingWallDefaults(),
      id: `wall_railing${index}`,
      parentId: LEVEL,
      start,
      end,
    })
    next = { ...next, [railing.id]: railing }
  })
  return settle(nodes, next)
}

describe("a deck room's boards", () => {
  const deckOf = (nodes: Record<string, AnyNode>) =>
    Object.values(nodes).find(
      (node): node is ZoneNode => node.type === 'zone' && node.roomType === 'deck',
    )!
  const plateOf = (nodes: Record<string, AnyNode>, zone: ZoneNode) =>
    Object.values(nodes).find(
      (node): node is SlabNode =>
        node.type === 'slab' && node.plateRole !== 'base' && !!node.zoneIds?.includes(zone.id),
    )!
  const edit = (nodes: Record<string, AnyNode>, zone: ZoneNode, decking: unknown) =>
    settle(
      nodes,
      applyToScratch(
        nodes,
        structureChangeBatch(
          setZoneIntent(nodes, {
            zoneId: zone.id,
            patch: { decking } as Parameters<typeof setZoneIntent>[1]['patch'],
          }).changes,
        ),
      ),
    )

  test('are kept on the room, cleared by null; its floor plate declares their thickness, the frame under them', () => {
    const nodes = withDeck()
    const deck = deckOf(nodes)
    expect(deck.decking).toBeUndefined()
    expect(plateOf(nodes, deck).metadata?.decking).toBeCloseTo(IN, 9)
    const set = edit(nodes, deck, { boardSize: '2x6', direction: 'diagonal' })
    expect(deckOf(set).decking).toEqual({ boardSize: '2x6', direction: 'diagonal' })
    expect(plateOf(set, deck).metadata?.decking).toBeCloseTo(1.5 * IN, 9)
    const gap = edit(set, deck, { gap: IN / 8, direction: null })
    expect(deckOf(gap).decking).toEqual({ boardSize: '2x6', gap: IN / 8 })
    const cleared = edit(gap, deck, null)
    expect(deckOf(cleared).decking).toBeUndefined()
    expect(plateOf(cleared, deck).metadata?.decking).toBeCloseTo(IN, 9)
  })
})
const AXES = { origin: [0, 0] as const, u: [1, 0] as const, v: [0, 1] as const }
const rect = (w: number, d: number): MultiPolygon => [
  {
    outer: [
      [0, 0],
      [w, 0],
      [w, d],
      [0, d],
    ],
    holes: [],
  },
]

/** A board's extent along and across plan axis `along`. */
function extent(board: Polygon, along: readonly [number, number]) {
  const across: [number, number] = [-along[1], along[0]]
  const a = board.outer.map(([x, z]) => x * along[0] + z * along[1])
  const c = board.outer.map(([x, z]) => x * across[0] + z * across[1])
  return { length: Math.max(...a) - Math.min(...a), width: Math.max(...c) - Math.min(...c), a, c }
}

test('a deck with no settings gets 5/4x6 boards, 1 in by 5 1/2 in, a quarter inch apart, along the house', () => {
  expect(deckBoardSettings(undefined)).toEqual(DEFAULT_DECK_BOARDS)
  expect(DEFAULT_DECK_BOARDS).toEqual({ boardSize: '5/4x6', gap: IN / 4, direction: 'parallel' })
  expect(deckBoardThickness(DEFAULT_DECK_BOARDS)).toBeCloseTo(IN, 9)
  expect(DECK_BOARD_STOCK['5/4x6'].width).toBeCloseTo(5.5 * IN, 9)
  expect(DECK_BOARD_STOCK.composite.thickness).toBeCloseTo((15 / 16) * IN, 9)
  expect(
    deckBoardSettings({ decking: { boardSize: '2x4', gap: IN / 8, direction: 'diagonal' } }),
  ).toEqual({ boardSize: '2x4', gap: IN / 8, direction: 'diagonal' })
  // a deck room's plate takes its room's boards; a generated deck's 1 1/2 in decking is 2x stock
  const zone = { roomType: 'deck' as const, decking: { boardSize: '2x6' as const } }
  expect(deckSlabBoards({ zoneIds: ['zone_a'] }, () => zone).boardSize).toBe('2x6')
  expect(
    deckSlabBoards({ metadata: { floor: 'deck', decking: 1.5 * IN } }, () => null).boardSize,
  ).toBe('2x6')
  expect(deckSlabBoards({ metadata: { floor: 'deck' } }, () => null)).toEqual(DEFAULT_DECK_BOARDS)
})

describe('boards along the house over a 12 × 10 ft deck', () => {
  const outline = rect(12 * FT, 10 * FT)
  const boards = layoutDeckBoards(outline, AXES, DEFAULT_DECK_BOARDS)
  const width = 5.5 * IN

  test('rows of full boards from the outer edge in, a quarter inch apart, the last ripped against the house', () => {
    const rows = boards
      .map((board) => extent(board, [1, 0]))
      .sort((a, b) => Math.max(...b.c) - Math.max(...a.c))
    expect(rows).toHaveLength(Math.ceil((10 * FT + IN / 4) / (width + IN / 4)))
    expect(Math.max(...rows[0]!.c)).toBeCloseTo(10 * FT, 4)
    for (const row of rows) expect(row.length).toBeCloseTo(12 * FT, 4)
    for (const row of rows.slice(0, -1)) expect(row.width).toBeCloseTo(width, 3)
    for (let i = 1; i < rows.length; i++)
      expect(Math.min(...rows[i - 1]!.c) - Math.max(...rows[i]!.c)).toBeCloseTo(IN / 4, 3)
    expect(rows.at(-1)!.width).toBeLessThan(width)
  })

  test('the boards cover the deck but for the gaps, and nothing past its outline', () => {
    expect(area(difference(union(boards), outline))).toBeCloseTo(0, 6)
    const covered = area(union(boards)) / area(outline)
    expect(covered).toBeGreaterThan(0.94)
    expect(covered).toBeLessThan(0.97)
  })
})

test('diagonal boards run at 45° to the house; boards out from it run square to it', () => {
  const outline = rect(10 * FT, 8 * FT)
  const diagonal = layoutDeckBoards(outline, AXES, {
    ...DEFAULT_DECK_BOARDS,
    direction: 'diagonal',
  })
  const k = Math.SQRT1_2
  for (const board of diagonal)
    expect(extent(board, [k, k]).width).toBeLessThanOrEqual(5.5 * IN + 1e-4)
  expect(area(difference(union(diagonal), outline))).toBeCloseTo(0, 6)
  const out = layoutDeckBoards(outline, AXES, {
    ...DEFAULT_DECK_BOARDS,
    direction: 'perpendicular',
  })
  for (const board of out) expect(extent(board, [0, 1]).length).toBeCloseTo(8 * FT, 4)
})

test('boards are cut along any outline: an L-shaped deck', () => {
  const ell: MultiPolygon = [
    {
      outer: [
        [0, 0],
        [6, 0],
        [6, 2],
        [2, 2],
        [2, 5],
        [0, 5],
      ],
      holes: [],
    },
  ]
  const boards = layoutDeckBoards(ell, AXES, DEFAULT_DECK_BOARDS)
  expect(area(difference(union(boards), ell))).toBeCloseTo(0, 6)
  expect(area(union(boards)) / area(ell)).toBeGreaterThan(0.93)
  // the long rows stop at the notch
  for (const board of boards) {
    const { a, c } = extent(board, [1, 0])
    if (Math.min(...c) > 2 + 1e-6) expect(Math.max(...a)).toBeLessThanOrEqual(2 + 1e-6)
  }
})

test('a run past 16 ft is laid in lengths butted over the joists, the joints of neighbouring rows staggered', () => {
  const outline = rect(30 * FT, 4 * FT)
  const stations = Array.from({ length: 23 }, (_, i) => 0.75 * IN + i * 16 * IN)
  const boards = layoutDeckBoards(outline, AXES, DEFAULT_DECK_BOARDS, {
    origin: [0, 0],
    axis: [1, 0],
    stations,
  })
  const rows = new Map<string, Array<{ from: number; to: number }>>()
  for (const board of boards) {
    const { a, c } = extent(board, [1, 0])
    const key = Math.max(...c).toFixed(3)
    rows.set(key, [...(rows.get(key) ?? []), { from: Math.min(...a), to: Math.max(...a) }])
  }
  const joints: number[][] = []
  for (const pieces of rows.values()) {
    pieces.sort((p, q) => p.from - q.from)
    expect(pieces.length).toBeGreaterThan(1)
    for (const piece of pieces)
      expect(piece.to - piece.from).toBeLessThanOrEqual(DECK_BOARD_MAX_LENGTH + 1e-6)
    const row: number[] = []
    for (let i = 1; i < pieces.length; i++) {
      const joint = (pieces[i - 1]!.to + pieces[i]!.from) / 2
      expect(pieces[i]!.from - pieces[i - 1]!.to).toBeCloseTo(DECK_BOARD_JOINT_GAP, 3)
      // over a joist
      expect(Math.min(...stations.map((s) => Math.abs(s - joint)))).toBeLessThan(1e-4)
      row.push(joint)
    }
    joints.push(row)
  }
  for (let i = 1; i < joints.length; i++)
    expect(joints[i]![0]).not.toBeCloseTo(joints[i - 1]![0]!, 3)
})
