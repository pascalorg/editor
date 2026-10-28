import { describe, expect, test } from 'bun:test'
import { area } from '../../lib/polygon-boolean'
import { reconcileLevelStructure } from '../../lib/structure-kernel'
import {
  type AnyNode,
  type AnyNodeId,
  LevelNode,
  railingWallDefaults,
  type SeparatorNode,
  WallNode,
  type ZoneNode,
} from '../../schema'
import { planSeparatorInsertion } from '../../systems/wall/wall-topology'
import { createZone } from './create-zone'
import { setSeparatorEnd, translateSeparators } from './move-separators'
import { setWallGeometry } from './set-wall-geometry'
import {
  applyToScratch,
  type StructureNodes,
  type StructurePlan,
  structureChangeBatch,
} from './shared'

type Point = [number, number]
const LEVEL = 'level_porch'

function mint() {
  let i = 0
  return (kind: string) => `${kind}_moved${++i}`
}

/** The level's structure settled after an edit, as the live sync does it. */
function settle(before: StructureNodes, after: StructureNodes) {
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

function apply(nodes: StructureNodes, plan: StructurePlan) {
  expect(plan.conflicts).toBeUndefined()
  return settle(nodes, applyToScratch(nodes, structureChangeBatch(plan.changes)))
}

/**
 * An 8 × 4 house with a porch off its z = 4 side, closed by invisible walls drawn left, along
 * the bottom (one piece, or as `bottom` gives it) and right, and `railed` sides railings instead.
 */
function porch(
  bottom: Array<[Point, Point]> = [
    [
      [2, 6],
      [6, 6],
    ],
  ],
  railed: ReadonlySet<number> = new Set(),
) {
  const level = LevelNode.parse({ id: LEVEL })
  const empty: StructureNodes = { [level.id]: level }
  const house = apply(
    empty,
    createZone(empty, {
      levelId: LEVEL,
      polygon: [
        [0, 0],
        [8, 0],
        [8, 4],
        [0, 4],
      ],
      enclose: true,
      mintId: mint(),
      name: 'Kitchen',
    }),
  )
  let next = house
  const sides: Array<[Point, Point]> = [
    [
      [2, 4],
      [2, 6],
    ],
    ...bottom,
    [
      [6, 6],
      [6, 4],
    ],
  ]
  sides.forEach(([start, end], index) => {
    if (railed.has(index)) {
      const railing = WallNode.parse({
        ...railingWallDefaults(),
        id: `wall_railing${index}`,
        parentId: LEVEL,
        start,
        end,
      })
      next = { ...next, [railing.id]: railing }
      return
    }
    const plan = planSeparatorInsertion(next as Record<AnyNodeId, AnyNode>, {
      levelId: LEVEL as AnyNodeId,
      start,
      end,
      joinRadius: 0.05,
      mintId: () => `separator_side${index}`,
    })
    expect(plan).not.toBeNull()
    next = applyToScratch(next, plan!.changes)
  })
  return settle(house, next)
}

const near = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6
const separators = (nodes: StructureNodes) =>
  Object.values(nodes).filter((node): node is SeparatorNode => node.type === 'separator')
/** The invisible wall from `a` to `b`, either way round. */
const between = (nodes: StructureNodes, a: Point, b: Point) =>
  separators(nodes).find(
    (node) =>
      (near(node.start, a) && near(node.end, b)) || (near(node.start, b) && near(node.end, a)),
  )
const outdoorRoom = (nodes: StructureNodes) =>
  Object.values(nodes).find(
    (node): node is ZoneNode => node.type === 'zone' && node.name !== 'Kitchen',
  )
const roomArea = (zone: ZoneNode | undefined) =>
  zone ? area([{ outer: zone.polygon, holes: zone.holes }]) : 0
const whole = (separator: SeparatorNode | undefined) => ({
  separatorId: separator!.id,
  t0: 0,
  t1: 1,
})

describe('a porch closed by invisible walls', () => {
  test('its edge pushed out and back in stays a closed porch, the sides stretching with it', () => {
    const nodes = porch()
    expect(roomArea(outdoorRoom(nodes))).toBeCloseTo(8, 6)
    const bottom = between(nodes, [2, 6], [6, 6])
    const out = apply(
      nodes,
      translateSeparators(nodes, { spans: [whole(bottom)], offset: [0, 1], mintId: mint() }),
    )
    // The one moved invisible wall drags both its neighbours; their far ends stay on the house.
    expect(between(out, [2, 7], [6, 7])?.id).toBe(bottom!.id)
    expect(between(out, [2, 4], [2, 7])).toBeDefined()
    expect(between(out, [6, 7], [6, 4])).toBeDefined()
    expect(separators(out)).toHaveLength(3)
    const porchRoom = outdoorRoom(out)
    expect(porchRoom?.roomType).toBe('porch')
    expect(roomArea(porchRoom)).toBeCloseTo(12, 6)
    expect(porchRoom?.boundarySeparatorIds).toHaveLength(3)

    const back = apply(
      out,
      translateSeparators(out, { spans: [whole(bottom)], offset: [0, -2], mintId: mint() }),
    )
    expect(roomArea(outdoorRoom(back))).toBeCloseTo(4, 6)
    expect(between(back, [2, 4], [2, 5])).toBeDefined()
    expect(between(back, [6, 5], [6, 4])).toBeDefined()
  })

  test('a side moved along the house slides its end on the house wall and stretches the edge it meets', () => {
    const nodes = porch()
    const left = between(nodes, [2, 4], [2, 6])
    const after = apply(
      nodes,
      translateSeparators(nodes, { spans: [whole(left)], offset: [-1, 0], mintId: mint() }),
    )
    expect(between(after, [1, 4], [1, 6])?.id).toBe(left!.id)
    expect(between(after, [1, 6], [6, 6])).toBeDefined()
    expect(between(after, [6, 6], [6, 4])).toBeDefined()
    expect(roomArea(outdoorRoom(after))).toBeCloseTo(10, 6)
    // The house wall is never moved by its invisible walls.
    const walls = (scene: StructureNodes) =>
      Object.values(scene)
        .filter((node) => node.type === 'wall')
        .map((node) => JSON.stringify([(node as WallNode).start, (node as WallNode).end]))
        .sort()
    expect(walls(after)).toEqual(walls(nodes))
  })

  test('a side carried off the end of the house leaves an invisible wall back to it', () => {
    const nodes = porch()
    const left = between(nodes, [2, 4], [2, 6])
    const after = apply(
      nodes,
      translateSeparators(nodes, { spans: [whole(left)], offset: [-3, 0], mintId: mint() }),
    )
    expect(between(after, [-1, 4], [-1, 6])).toBeDefined()
    // The jog runs back along the house wall's line; the stretch under the wall is absorbed.
    expect(between(after, [-1, 4], [0, 4])).toBeDefined()
    expect(roomArea(outdoorRoom(after))).toBeCloseTo(14, 6)
  })

  test('an edge drawn in two pieces pushes as one line', () => {
    const nodes = porch([
      [
        [2, 6],
        [4, 6],
      ],
      [
        [4, 6],
        [6, 6],
      ],
    ])
    const pieces = [between(nodes, [2, 6], [4, 6]), between(nodes, [4, 6], [6, 6])]
    const after = apply(
      nodes,
      translateSeparators(nodes, {
        spans: pieces.map(whole),
        offset: [0, 1.5],
        mintId: mint(),
      }),
    )
    expect(between(after, [2, 7.5], [4, 7.5])).toBeDefined()
    expect(between(after, [4, 7.5], [6, 7.5])).toBeDefined()
    expect(separators(after)).toHaveLength(4)
    expect(roomArea(outdoorRoom(after))).toBeCloseTo(14, 6)
  })

  test('part of an edge moves alone, joined back to the rest by a jog', () => {
    const nodes = porch()
    const bottom = between(nodes, [2, 6], [6, 6])!
    const t = bottom.start[0] === 2 ? ([0, 0.5] as const) : ([0.5, 1] as const)
    const after = apply(
      nodes,
      translateSeparators(nodes, {
        spans: [{ separatorId: bottom.id, t0: t[0], t1: t[1] }],
        offset: [0, 1],
        mintId: mint(),
      }),
    )
    expect(between(after, [2, 7], [4, 7])?.id).toBe(bottom.id)
    expect(between(after, [4, 6], [6, 6])).toBeDefined()
    expect(between(after, [4, 6], [4, 7])).toBeDefined()
    expect(roomArea(outdoorRoom(after))).toBeCloseTo(10, 6)
  })

  test('a corner drawn a little open still moves together, and closes', () => {
    const nodes = porch()
    const bottom = between(nodes, [2, 6], [6, 6])!
    // Drawn by hand 3 cm short of the side: the room still closes there.
    const [shortStart, shortEnd] = near(bottom.start, [2, 6])
      ? [[2.03, 6] as Point, bottom.end]
      : [bottom.start, [2.03, 6] as Point]
    const open = settle(nodes, {
      ...nodes,
      [bottom.id]: { ...bottom, start: shortStart, end: shortEnd },
    })
    expect(roomArea(outdoorRoom(open))).toBeGreaterThan(7.8)
    const after = apply(
      open,
      translateSeparators(open, {
        spans: [whole(open[bottom.id] as SeparatorNode)],
        offset: [0, 1],
        mintId: mint(),
      }),
    )
    const left = separators(after).find(
      (node) => near(node.start, [2, 4]) || near(node.end, [2, 4]),
    )!
    const corner = near(left.start, [2, 4]) ? left.end : left.start
    expect(corner).toEqual([2.03, 7])
    expect(roomArea(outdoorRoom(after))).toBeGreaterThan(11.8)
  })

  test('an invisible wall T’d into the edge stretches with it', () => {
    let nodes = porch()
    const divider = planSeparatorInsertion(nodes as Record<AnyNodeId, AnyNode>, {
      levelId: LEVEL as AnyNodeId,
      start: [4, 4],
      end: [4, 6],
      joinRadius: 0.05,
      mintId: () => 'separator_divider',
    })
    nodes = settle(nodes, applyToScratch(nodes, divider!.changes))
    const bottom = between(nodes, [2, 6], [6, 6])
    const after = apply(
      nodes,
      translateSeparators(nodes, { spans: [whole(bottom)], offset: [0, 1], mintId: mint() }),
    )
    expect(between(after, [4, 4], [4, 7])?.id).toBe('separator_divider')
  })

  test('a corner dragged takes the invisible wall joined there with it; Alt leaves it', () => {
    const nodes = porch()
    const bottom = between(nodes, [2, 6], [6, 6])!
    const endpoint = near(bottom.start, [2, 6]) ? 'start' : 'end'
    const after = apply(
      nodes,
      setSeparatorEnd(nodes, { separatorId: bottom.id, endpoint, point: [1, 7] }),
    )
    expect(between(after, [1, 7], [6, 6])).toBeDefined()
    expect(between(after, [2, 4], [1, 7])).toBeDefined()
    expect(roomArea(outdoorRoom(after))).toBeCloseTo(11, 6)

    const detached = setSeparatorEnd(nodes, {
      separatorId: bottom.id,
      endpoint,
      point: [1, 7],
      detach: true,
    })
    const moved = applyToScratch(nodes, structureChangeBatch(detached.changes))
    expect(between(moved, [2, 4], [2, 6])).toBeDefined()
  })
})

test('an end T’d into a slanted wall slides along it', () => {
  const level = LevelNode.parse({ id: LEVEL })
  const slanted = WallNode.parse({
    id: 'wall_slanted',
    parentId: LEVEL,
    start: [0, 0],
    end: [10, 5],
  })
  const separator = planSeparatorInsertion(
    { [level.id]: level, [slanted.id]: slanted } as Record<AnyNodeId, AnyNode>,
    {
      levelId: LEVEL as AnyNodeId,
      start: [4, 2],
      end: [4, 8],
      joinRadius: 0.05,
      mintId: () => 'separator_tee',
    },
  )!.separators[0]!
  const nodes: StructureNodes = {
    [level.id]: level,
    [slanted.id]: slanted,
    [separator.id]: separator,
  }
  const plan = translateSeparators(nodes, {
    spans: [whole(separator)],
    offset: [1, 0],
    mintId: mint(),
  })
  const after = applyToScratch(nodes, structureChangeBatch(plan.changes)) as StructureNodes
  const moved = after[separator.id] as SeparatorNode
  expect(moved.start[0]).toBeCloseTo(5, 9)
  expect(moved.start[1]).toBeCloseTo(2.5, 9)
  expect(moved.end).toEqual([5, 8])
})

describe('a wall pushed with invisible walls on it', () => {
  test('carries the porch’s sides T’d into it', () => {
    const nodes = porch()
    const house = Object.values(nodes).find(
      (node): node is WallNode => node.type === 'wall' && node.start[1] === 4 && node.end[1] === 4,
    )!
    const after = apply(
      nodes,
      setWallGeometry(nodes, {
        wallId: house.id,
        start: [house.start[0], 3],
        end: [house.end[0], 3],
        mintId: mint(),
      }),
    )
    expect(between(after, [2, 3], [2, 6])).toBeDefined()
    expect(between(after, [6, 6], [6, 3])).toBeDefined()
    expect(roomArea(outdoorRoom(after))).toBeCloseTo(12, 6)
  })

  test('a railing edge pushed out takes the invisible sides joined at its ends', () => {
    const nodes = porch(undefined, new Set([1]))
    expect(outdoorRoom(nodes)).toBeDefined()
    const railing = nodes.wall_railing1 as WallNode
    const after = apply(
      nodes,
      setWallGeometry(nodes, {
        wallId: railing.id,
        start: [railing.start[0], 7],
        end: [railing.end[0], 7],
        mintId: mint(),
      }),
    )
    expect(between(after, [2, 4], [2, 7])).toBeDefined()
    expect(between(after, [6, 7], [6, 4])).toBeDefined()
    expect(roomArea(outdoorRoom(after))).toBeCloseTo(12, 6)
  })
})
