import { describe, expect, test } from 'bun:test'
import { reconcileLevelStructure } from '../../lib/structure-kernel'
import { ItemNode, SeparatorNode, WallNode, type ZoneNode } from '../../schema'
import { getWallCurveFrameAt, getWallCurveLength } from '../../systems/wall/wall-curve'
import { SHARED_WALLS_DELETE_MESSAGE } from './delete-zone'
import { deleteZone, divideZone, setZoneIntent } from './index'
import { applyToScratch, type StructureNodes, structureChangeBatch } from './shared'
import { apply, enclosed, fixture, mint } from './structure.test'

const zones = (nodes: StructureNodes) =>
  Object.values(nodes).filter((n): n is ZoneNode => n.type === 'zone')
const boundaryIds = (nodes: StructureNodes, type: 'wall' | 'separator') =>
  Object.values(nodes)
    .filter((n) => n.type === type)
    .map((n) => n.id)
    .sort()

function chair(id: string, x: number, z: number) {
  return ItemNode.parse({
    id,
    parentId: 'level_test',
    position: [x, 0, z],
    asset: {
      id: 'chair',
      category: 'chairs',
      name: 'Chair',
      thumbnail: '',
      src: 'https://example.com/chair.glb',
    },
  })
}

/** The 8×4 enclosed room with an island Divide made in its middle. */
function island() {
  const { nodes, zoneId } = enclosed()
  const graph = apply(
    nodes,
    divideZone(nodes, {
      zoneId,
      path: [
        [3, 1],
        [5, 1],
        [5, 3],
        [3, 3],
      ],
      closed: true,
      mintId: mint(),
    }),
  )
  const area = zones(graph).find((zone) => zone.id !== zoneId)!
  return { nodes: graph, hostId: zoneId, areaId: area.id }
}

/** The 8×4 enclosed room split by Divide at x = 2. */
function split() {
  const { nodes, zoneId } = enclosed()
  const graph = apply(
    nodes,
    divideZone(nodes, {
      zoneId,
      cut: [
        [2, 0],
        [2, 4],
      ],
      mintId: mint(),
    }),
  )
  const other = zones(graph).find((zone) => zone.id !== zoneId)!
  return { nodes: graph, zoneId, otherId: other.id }
}

describe('deleting a room', () => {
  test('an island merges back into the room around it; its items stay', () => {
    const { nodes, hostId, areaId } = island()
    let graph = apply(
      nodes,
      setZoneIntent(nodes, {
        zoneId: areaId,
        patch: { name: 'Nook', floor: { finish: 'tile' } },
      }),
    )
    const item = chair('item_island_chair', 4, 2)
    graph = { ...graph, [item.id]: item }
    const walls = boundaryIds(graph, 'wall')
    const plan = deleteZone(graph, { zoneId: areaId, contents: 'delete' })
    expect(plan.conflicts).toBeUndefined()
    expect(plan.payload).toMatchObject({
      mode: 'merge',
      mergedIntoZoneId: hostId,
      wallIds: [],
      openingIds: [],
      itemIds: [item.id],
    })
    expect(plan.payload.separatorIds.sort()).toEqual(boundaryIds(graph, 'separator'))
    const after = apply(graph, plan)
    expect(zones(after).map((zone) => zone.id)).toEqual([hostId])
    expect(boundaryIds(after, 'separator')).toEqual([])
    expect(boundaryIds(after, 'wall')).toEqual(walls)
    expect(after[item.id]).toEqual(item)
    // The host's floor covers the whole room again: no hole where the island was.
    expect((after[hostId] as ZoneNode).holes).toEqual([])
  })

  test('one side of a split merges back into the other; every wall stays', () => {
    const { nodes, zoneId, otherId } = split()
    const walls = boundaryIds(nodes, 'wall')
    const plan = deleteZone(nodes, { zoneId, contents: 'delete' })
    expect(plan.payload).toMatchObject({ mode: 'merge', mergedIntoZoneId: otherId, wallIds: [] })
    const after = apply(nodes, plan)
    expect(zones(after).map((zone) => zone.id)).toEqual([otherId])
    expect(boundaryIds(after, 'separator')).toEqual([])
    expect(boundaryIds(after, 'wall')).toEqual(walls)
  })

  test('the middle of three merges into one neighbour; the other separator stays', () => {
    const nodes: Record<string, any> = fixture()
    let i = 0
    const add = (node: WallNode | SeparatorNode) => {
      nodes[node.id] = node
    }
    for (const x of [0, 2, 4]) {
      add(
        WallNode.parse({
          id: `wall_r${++i}`,
          parentId: 'level_test',
          start: [x, 0],
          end: [x + 2, 0],
        }),
      )
      add(
        WallNode.parse({
          id: `wall_r${++i}`,
          parentId: 'level_test',
          start: [x, 4],
          end: [x + 2, 4],
        }),
      )
    }
    add(WallNode.parse({ id: 'wall_rw', parentId: 'level_test', start: [0, 0], end: [0, 4] }))
    add(WallNode.parse({ id: 'wall_re', parentId: 'level_test', start: [6, 0], end: [6, 4] }))
    for (const x of [2, 4])
      add(
        SeparatorNode.parse({
          id: `separator_r${x}`,
          parentId: 'level_test',
          start: [x, 0],
          end: [x, 4],
        }),
      )
    const result = reconcileLevelStructure({
      levelId: 'level_test',
      nodes,
      mintId: (kind) => `${kind}_r${++i}`,
    })
    const graph = applyToScratch(nodes, structureChangeBatch(result.patches))
    const [left, middle, right] = zones(graph).sort((a, b) => a.seed![0] - b.seed![0])
    const plan = deleteZone(graph, { zoneId: middle!.id, contents: 'delete' })
    expect(plan.payload.mode).toBe('merge')
    expect(plan.payload.separatorIds).toHaveLength(1)
    const merged = plan.payload.mergedIntoZoneId
    expect([left!.id, right!.id]).toContain(merged!)
    const after = apply(graph, plan)
    expect(zones(after)).toHaveLength(2)
    expect(boundaryIds(after, 'separator')).toHaveLength(1)
    expect(boundaryIds(after, 'wall')).toEqual(boundaryIds(graph, 'wall'))
  })

  test('a room whose walls are all shared is refused with a structured conflict', () => {
    const { nodes, zoneId } = enclosed()
    const points: [number, number][] = [
      [-2, -2],
      [10, -2],
      [10, 6],
      [-2, 6],
    ]
    const graph = apply(nodes, {
      changes: points.map((start, i) => ({
        op: 'create' as const,
        node: WallNode.parse({
          id: `wall_outer${i}`,
          parentId: 'level_test',
          start,
          end: points[(i + 1) % 4],
        }),
      })),
    })
    expect(zones(graph)).toHaveLength(2)
    const plan = deleteZone(graph, { zoneId, contents: 'delete' })
    expect(plan.changes).toEqual([])
    expect(plan.conflicts).toEqual([
      {
        code: 'shared-walls',
        nodeIds: [zoneId, ...plan.payload.keptSharedWallIds],
        message: SHARED_WALLS_DELETE_MESSAGE,
      },
    ])
    expect(plan.payload).toMatchObject({ mode: 'blocked', wallIds: [], itemIds: [] })
    expect(plan.payload.keptSharedWallIds).toHaveLength(4)
  })

  test('the room around an island is deleted with its own walls, not merged into the island', () => {
    const { nodes, hostId } = island()
    const plan = deleteZone(nodes, { zoneId: hostId, contents: 'delete' })
    expect(plan.payload.mode).toBe('delete')
    expect(plan.payload.mergedIntoZoneId).toBeUndefined()
    expect(plan.payload.wallIds).toHaveLength(4)
    expect(plan.changes).toContainEqual({ op: 'delete', id: hostId })
  })

  test('mixed boundaries: own walls plus an unshared separator follow the removal rules', () => {
    const nodes: Record<string, any> = fixture()
    const corners: [number, number][] = [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ]
    for (let i = 0; i < 3; i++)
      nodes[`wall_m${i}`] = WallNode.parse({
        id: `wall_m${i}`,
        parentId: 'level_test',
        start: corners[i],
        end: corners[i + 1],
      })
    nodes.separator_m = SeparatorNode.parse({
      id: 'separator_m',
      parentId: 'level_test',
      start: [0, 4],
      end: [0, 0],
    })
    let n = 0
    const result = reconcileLevelStructure({
      levelId: 'level_test',
      nodes,
      mintId: (kind) => `${kind}_m${++n}`,
    })
    const graph = applyToScratch(nodes, structureChangeBatch(result.patches))
    const [zone] = zones(graph)
    const plan = deleteZone(graph, { zoneId: zone!.id, contents: 'delete' })
    expect(plan.payload).toMatchObject({ mode: 'delete', separatorIds: ['separator_m'] })
    expect(plan.payload.wallIds.sort()).toEqual(['wall_m0', 'wall_m1', 'wall_m2'])
  })
})

test('an item kept from a curved wall faces along the curve where it hung', () => {
  const nodes: Record<string, any> = fixture()
  const corners: [number, number][] = [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4],
  ]
  for (let i = 0; i < 4; i++)
    nodes[`wall_c${i}`] = WallNode.parse({
      id: `wall_c${i}`,
      parentId: 'level_test',
      start: corners[i],
      end: corners[(i + 1) % 4],
      ...(i === 0 ? { curveOffset: -1 } : {}),
    })
  const curved = nodes.wall_c0
  const along = getWallCurveLength(curved) * 0.2
  nodes.item_shelf = ItemNode.parse({
    ...chair('item_shelf', 0, 0),
    parentId: curved.id,
    position: [along, 1, 0.1],
    rotation: [0, 0.3, 0],
  })
  curved.children = ['item_shelf']
  let n = 0
  const graph = applyToScratch(
    nodes,
    structureChangeBatch(
      reconcileLevelStructure({
        levelId: 'level_test',
        nodes,
        mintId: (kind) => `${kind}_c${++n}`,
      }).patches,
    ),
  )
  const [zone] = zones(graph)
  const plan = deleteZone(graph, { zoneId: zone!.id, contents: 'keep' })
  const kept = applyToScratch(graph, structureChangeBatch(plan.changes)).item_shelf as ItemNode
  const frame = getWallCurveFrameAt(curved, 0.2)
  expect(kept.parentId).toBe('level_test')
  expect(kept.rotation[1]).toBeCloseTo(0.3 - Math.atan2(frame.tangent.y, frame.tangent.x), 6)
  expect(kept.position[0]).toBeCloseTo(frame.point.x + frame.normal.x * 0.1, 6)
  expect(kept.position[2]).toBeCloseTo(frame.point.y + frame.normal.y * 0.1, 6)
})
