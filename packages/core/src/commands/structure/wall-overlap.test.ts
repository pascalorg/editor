import { describe, expect, test } from 'bun:test'
import { type AnyNode, DoorNode, LevelNode, WallNode, ZoneNode } from '../../schema'
import { planWallInsertion } from '../../systems/wall/wall-topology'
import { setWallGeometry } from './set-wall-geometry'
import { applyToScratch, structureChangeBatch } from './shared'
import { finishWallEdit, retypeOutlineBridges, trimWallOverlaps } from './wall-overlap'

const LEVEL = 'level_overlap'

function scene(...nodes: AnyNode[]): Record<string, AnyNode> {
  const level = LevelNode.parse({ id: LEVEL })
  return Object.fromEntries(
    [level, ...nodes.map((node) => ({ ...node, parentId: node.parentId ?? LEVEL }) as AnyNode)].map(
      (node) => [node.id, node],
    ),
  )
}
const wall = (id: string, start: [number, number], end: [number, number], extra = {}) =>
  WallNode.parse({ id: `wall_${id}`, start, end, ...extra })
function minter() {
  let i = 0
  return () => `wall_cut${++i}`
}
const walls = (nodes: Record<string, AnyNode>) =>
  Object.values(nodes).filter((node): node is WallNode => node.type === 'wall')
const ends = (node: AnyNode | undefined) => {
  const w = node as WallNode
  return [w.start.map((v) => +v.toFixed(6)), w.end.map((v) => +v.toFixed(6))]
}

describe('trimWallOverlaps', () => {
  test('a wall stretched over the end of a collinear wall cuts it back to meet it', () => {
    const nodes = scene(wall('placed', [1, 5], [10, 5]), wall('old', [-2, 5], [3, 5]))
    expect(trimWallOverlaps(nodes, ['wall_placed'], minter())).toBeNull()
    expect(ends(nodes.wall_old)).toEqual([
      [-2, 5],
      [1, 5],
    ])
    expect(ends(nodes.wall_placed)).toEqual([
      [1, 5],
      [10, 5],
    ])
  })

  test('a wall landing inside a longer one splits it round itself', () => {
    const nodes = scene(wall('placed', [3, 0], [5, 0]), wall('long', [0, 0], [10, 0]))
    expect(trimWallOverlaps(nodes, ['wall_placed'], minter())).toBeNull()
    expect(ends(nodes.wall_long)).toEqual([
      [0, 0],
      [3, 0],
    ])
    expect(ends(nodes.wall_cut1)).toEqual([
      [5, 0],
      [10, 0],
    ])
    expect(walls(nodes)).toHaveLength(3)
  })

  test('a wall it covers whole is deleted, its door moved onto the placed wall', () => {
    const door = DoorNode.parse({ id: 'door_d', position: [1, 0, 0], width: 0.9 })
    const nodes = scene(
      wall('placed', [0, 0], [6, 0]),
      { ...wall('short', [4, 0], [2, 0]), children: [door.id] } as AnyNode,
      { ...door, parentId: 'wall_short', wallId: 'wall_short' } as AnyNode,
    )
    expect(trimWallOverlaps(nodes, ['wall_placed'], minter())).toBeNull()
    expect(nodes.wall_short).toBeUndefined()
    const moved = nodes.door_d as DoorNode
    expect(moved.parentId).toBe('wall_placed')
    // 1 m from (4, 0) back toward (2, 0) is x = 3 on the placed wall.
    expect(moved.position[0]).toBeCloseTo(3)
    expect((nodes.wall_placed as WallNode).children).toContain('door_d')
  })

  test('a door across the cut stops the edit', () => {
    const door = DoorNode.parse({ id: 'door_d', position: [3, 0, 0], width: 0.9 })
    const nodes = scene(
      wall('placed', [3.2, 0], [10, 0]),
      { ...wall('old', [0, 0], [5, 0]), children: [door.id] } as AnyNode,
      { ...door, parentId: 'wall_old', wallId: 'wall_old' } as AnyNode,
    )
    expect(trimWallOverlaps(nodes, ['wall_placed'], minter())?.code).toBe('hosted-openings')
  })

  test('a thinner wall face-aligned inside a thicker one takes its stretch over', () => {
    // Outside 0.2 thick on the line z = 0; a partition 0.1 thick, 5 cm in.
    const nodes = scene(
      wall('partition', [2, 0.05], [6, 0.05], { thickness: 0.1 }),
      wall('outside', [0, 0], [8, 0], { thickness: 0.2 }),
    )
    expect(trimWallOverlaps(nodes, ['wall_partition'], minter())).toBeNull()
    expect(ends(nodes.wall_outside)).toEqual([
      [0, 0],
      [2, 0],
    ])
    expect(ends(nodes.wall_cut1)).toEqual([
      [6, 0],
      [8, 0],
    ])
  })

  test('walls side by side, face to face, are left alone', () => {
    const nodes = scene(
      wall('placed', [0, 0], [6, 0], { thickness: 0.1 }),
      wall('beside', [0, 0.1], [6, 0.1], { thickness: 0.1 }),
    )
    expect(trimWallOverlaps(nodes, ['wall_placed'], minter())).toBeNull()
    expect(ends(nodes.wall_beside)).toEqual([
      [0, 0.1],
      [6, 0.1],
    ])
  })

  test('rooms that named the cut wall name its pieces and the placed wall', () => {
    const zone = ZoneNode.parse({
      id: 'zone_r',
      name: 'Room',
      polygon: [
        [0, 0],
        [10, 0],
        [10, 4],
      ],
      boundaryWallIds: ['wall_long'],
    })
    const nodes = scene(wall('placed', [3, 0], [5, 0]), wall('long', [0, 0], [10, 0]), zone)
    expect(trimWallOverlaps(nodes, ['wall_placed'], minter())).toBeNull()
    expect((nodes.zone_r as ZoneNode).boundaryWallIds).toEqual([
      'wall_long',
      'wall_cut1',
      'wall_placed',
    ])
  })
})

describe('outline jogs', () => {
  // A 10 × 6 outline 0.2 thick, a 0.1 partition at x = 5 splitting top and bottom.
  const house = () =>
    scene(
      wall('top1', [0, 0], [5, 0], { thickness: 0.2 }),
      wall('top2', [5, 0], [10, 0], { thickness: 0.2 }),
      wall('right', [10, 0], [10, 6], { thickness: 0.2 }),
      wall('bot1', [10, 6], [5, 6], { thickness: 0.2 }),
      wall('bot2', [5, 6], [0, 6], { thickness: 0.2 }),
      wall('left', [0, 6], [0, 0], { thickness: 0.2 }),
      wall('part', [5, 0], [5, 6], { thickness: 0.1 }),
    )

  test('pushing an outside wall out past a partition makes an outside jog', () => {
    const nodes = house()
    const plan = setWallGeometry(nodes, {
      wallId: 'wall_top1',
      start: [0, -1],
      end: [5, -1],
      mintId: (kind) => `${kind}_jog`,
    })
    const after = applyToScratch(nodes, structureChangeBatch(plan.changes))
    expect(ends(after.wall_jog)).toEqual([
      [5, 0],
      [5, -1],
    ])
    expect((after.wall_jog as WallNode).thickness).toBe(0.2)
    expect((after.wall_part as WallNode).thickness).toBe(0.1)
  })

  test('a jog inside the house keeps the wall it continues', () => {
    const nodes = house()
    const inside = wall('jog', [5, 3], [7, 3], { thickness: 0.1 })
    nodes[inside.id] = { ...inside, parentId: LEVEL } as AnyNode
    retypeOutlineBridges(nodes, 'wall_top1', ['wall_jog'])
    expect((nodes.wall_jog as WallNode).thickness).toBe(0.1)
  })
})

describe('setWallGeometry', () => {
  test('landing exactly on the line of the wall below leaves no zero-length wall', () => {
    // A room's left wall at x = 3 over a wider room below whose top runs from x = 0.
    const nodes = scene(
      wall('w2', [3, 0], [3, 5]),
      wall('topRight', [3, 0], [10, 0]),
      wall('belowLeft', [0, 5], [3, 5]),
      wall('belowRight', [3, 5], [10, 5]),
      wall('w3', [0, 10], [0, 5]),
    )
    const plan = setWallGeometry(nodes, {
      wallId: 'wall_w2',
      start: [0, 0],
      end: [0, 5],
      mintId: (kind) => `${kind}_new`,
    })
    const after = applyToScratch(nodes, structureChangeBatch(plan.changes))
    for (const w of walls(after)) {
      expect(Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1])).toBeGreaterThan(0.01)
    }
    expect(after.wall_belowLeft).toBeUndefined()
    expect(ends(after.wall_belowRight)).toEqual([
      [0, 5],
      [10, 5],
    ])
  })

  test('a wall stretched by a move takes over the collinear wall it now runs along', () => {
    const nodes = scene(
      wall('w2', [3, 0], [3, 5]),
      wall('c', [3, 5], [10, 5]),
      wall('e', [-2, 5], [2, 5]),
    )
    const plan = setWallGeometry(nodes, {
      wallId: 'wall_w2',
      start: [1, 0],
      end: [1, 5],
      mintId: (kind) => `${kind}_new`,
    })
    const after = applyToScratch(nodes, structureChangeBatch(plan.changes))
    expect(ends(after.wall_c)).toEqual([
      [1, 5],
      [10, 5],
    ])
    expect(ends(after.wall_e)).toEqual([
      [-2, 5],
      [1, 5],
    ])
  })
})

describe('drawing over a wall', () => {
  test('a wall drawn along part of another takes that stretch over', () => {
    const nodes = scene(wall('old', [0, 0], [4, 0], { thickness: 0.1 }))
    const result = planWallInsertion(nodes as never, {
      levelId: LEVEL as never,
      start: [2, 0],
      end: [6, 0],
      joinRadius: 0.05,
      wallDefaults: { thickness: 0.2 },
      replaceCovered: true,
      mintId: minter(),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const changes = finishWallEdit(nodes as never, result.plan.changes, {
      winnerIds: result.plan.insertedWalls.map((w) => w.id),
      mintId: minter(),
    })
    const after = walls(applyToScratch(nodes as never, changes))
    const covering = after.filter(
      (w) => Math.min(w.start[0], w.end[0]) < 4 - 1e-6 && Math.max(w.start[0], w.end[0]) > 2 + 1e-6,
    )
    // One wall, the new one, along [2, 4]; the old one keeps [0, 2].
    expect(covering).toHaveLength(1)
    expect(covering[0]!.thickness).toBe(0.2)
    expect(after).toHaveLength(2)
  })

  test('a wall drawn exactly over another replaces it instead of being refused', () => {
    const nodes = scene(wall('old', [0, 0], [4, 0], { thickness: 0.1 }))
    const refused = planWallInsertion(nodes as never, {
      levelId: LEVEL as never,
      start: [0, 0],
      end: [4, 0],
      joinRadius: 0.05,
    })
    expect(refused.ok).toBe(false)
    const result = planWallInsertion(nodes as never, {
      levelId: LEVEL as never,
      start: [0, 0],
      end: [4, 0],
      joinRadius: 0.05,
      wallDefaults: { thickness: 0.2 },
      replaceCovered: true,
      mintId: minter(),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const changes = finishWallEdit(nodes as never, result.plan.changes, {
      winnerIds: result.plan.insertedWalls.map((w) => w.id),
      mintId: minter(),
    })
    const after = walls(applyToScratch(nodes as never, changes))
    expect(after).toHaveLength(1)
    expect(after[0]!.thickness).toBe(0.2)
  })
})
