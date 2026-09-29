import { describe, expect, test } from 'bun:test'
import { reconcileLevelStructure } from '../../lib/structure-kernel'
import { ItemNode, SeparatorNode, WallNode } from '../../schema'
import { planZoneRemoval } from './delete-zone'
import { createZone, deleteZone, divideZone, setZoneIntent, snapZoneBoundary } from './index'
import { applyToScratch, diffStructure, structureChangeBatch } from './shared'
import { apply, enclosed, fixture, mint } from './structure.test'

function row() {
  const nodes: Record<string, any> = fixture()
  let i = 0
  const wall = (start: number[], end: number[]) => {
    const node = WallNode.parse({ id: `wall_row${++i}`, parentId: 'level_test', start, end })
    nodes[node.id] = node
  }
  for (const x of [0, 2, 4]) {
    wall([x, 0], [x + 2, 0])
    wall([x, 4], [x + 2, 4])
  }
  wall([0, 0], [0, 4])
  wall([6, 0], [6, 4])
  for (const x of [2, 4]) {
    const separator = SeparatorNode.parse({
      id: `separator_row${x}`,
      parentId: 'level_test',
      start: [x, 0],
      end: [x, 4],
    })
    nodes[separator.id] = separator
  }
  const result = reconcileLevelStructure({
    levelId: 'level_test',
    nodes,
    mintId: (kind) => `${kind}_row${++i}`,
  })
  return applyToScratch(nodes, structureChangeBatch(result.patches))
}

describe('structure audit regressions', () => {
  test('deleting the middle of three rooms merges it into one neighbour; both neighbours stay', () => {
    const nodes = row()
    const zones = Object.values(nodes)
      .filter((n) => n.type === 'zone')
      .sort((a, b) => a.seed![0] - b.seed![0])
    const middle = zones[1]!
    const plan = deleteZone(nodes, { zoneId: middle.id, contents: 'delete' })
    expect(plan.payload).toMatchObject({ mode: 'merge', wallIds: [], opensZoneIds: [] })
    expect(plan.payload.separatorIds).toHaveLength(1)
    const after = apply(nodes, plan)
    expect(after[middle.id]).toBeUndefined()
    for (const zone of [zones[0]!, zones[2]!]) {
      expect(after[zone.id]).toBeDefined()
      expect(
        Object.values(after).find((n) => n.type === 'ceiling' && n.zoneId === zone.id),
      ).toBeDefined()
    }
    expect(Object.values(after).filter((n) => n.type === 'zone')).toHaveLength(2)
  })
  test('shared-wall protection uses geometry even when mirrors are empty', () => {
    const { nodes, zoneId } = enclosed()
    const divider = WallNode.parse({
      id: 'wall_shared_audit',
      parentId: 'level_test',
      start: [2, 0],
      end: [2, 4],
    })
    let graph = apply(nodes, { changes: [{ op: 'create', node: divider }] })
    graph = Object.fromEntries(
      Object.entries(graph).map(([id, n]) => [
        id,
        n.type === 'zone' ? { ...n, boundaryWallIds: [] } : n,
      ]),
    )
    const plan = deleteZone(graph, { zoneId, contents: 'delete' })
    expect(plan.payload.keptSharedWallIds).toContain(divider.id)
    expect(plan.changes).not.toContainEqual({ op: 'delete', id: divider.id })
  })
  test('room removal reports other faces it opens while shared separators stay', () => {
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
    const other = Object.values(graph).find((n) => n.type === 'zone' && n.id !== zoneId)!
    // Wall deletion takes a split half down this way; deleting the room itself merges it.
    const plan = planZoneRemoval(graph, { zoneId, contents: 'delete' })
    expect(plan.payload.opensZoneIds).toEqual([other.id])
    expect(plan.payload.separatorIds).toEqual([])
    expect(plan.payload.keptSharedSeparatorIds).toHaveLength(1)
  })
  for (const contents of ['keep', 'delete'] as const)
    test(`fully shared enclosure is refused (${contents} contents), nothing changes`, () => {
      const { nodes, zoneId } = enclosed()
      let nextId = 0
      const points: [number, number][] = [
        [-2, -2],
        [10, -2],
        [10, 6],
        [-2, 6],
      ]
      let graph = apply(nodes, {
        changes: points.map((start, i) => ({
          op: 'create',
          node: WallNode.parse({
            id: `wall_outer${++nextId}`,
            parentId: 'level_test',
            start,
            end: points[(i + 1) % 4],
          }),
        })),
      })
      expect(Object.values(graph).filter((n) => n.type === 'zone')).toHaveLength(2)
      graph = apply(
        graph,
        setZoneIntent(graph, {
          zoneId,
          patch: {
            name: 'Custom',
            floor: { elevation: 0.4, finish: 'wood' },
            wallMaterial: 'paint',
            hasFloor: false,
            hasCeiling: false,
          },
        }),
      )
      const item = ItemNode.parse({
        id: 'item_reset',
        parentId: 'level_test',
        position: [2, 0, 2],
        asset: {
          id: 'chair',
          category: 'chairs',
          name: 'Chair',
          thumbnail: '',
          src: 'https://example.com/chair.glb',
        },
      })
      graph = { ...graph, [item.id]: item }
      const plan = deleteZone(graph, { zoneId, contents })
      expect(plan.payload).toMatchObject({
        mode: 'blocked',
        wallIds: [],
        separatorIds: [],
        opensZoneIds: [],
        itemIds: [],
      })
      expect(plan.changes).toEqual([])
      expect(plan.conflicts?.map((c) => c.code)).toEqual(['shared-walls'])
      expect(graph[zoneId]).toMatchObject({ name: 'Custom' })
      expect(graph[item.id]).toBeDefined()
    })
  test('diff updates contain only changed keys including explicit clears', () => {
    const { nodes, zoneId } = enclosed()
    const next = { ...nodes, [zoneId]: { ...nodes[zoneId]!, name: 'New', floor: undefined } }
    expect(diffStructure(nodes, next)).toEqual([
      { op: 'update', id: zoneId, data: { name: 'New' } },
    ])
  })
  test('L-room collinear boundary cuts and endpoints more than one metre away are refused', () => {
    const initial = fixture()
    const made = createZone(initial, {
      levelId: 'level_test',
      polygon: [
        [0, 0],
        [8, 0],
        [8, 4],
        [4, 4],
        [4, 8],
        [0, 8],
      ],
      enclose: true,
      mintId: mint(),
    })
    const nodes = apply(initial, made)
    expect(
      divideZone(nodes, {
        zoneId: made.zoneId,
        cut: [
          [0, 4],
          [8, 4],
        ],
        mintId: mint(),
      }).conflicts?.[0]?.code,
    ).toBe('boundary-overlap')
    expect(snapZoneBoundary(nodes, made.zoneId, [-1, 2])).not.toBeNull()
    expect(snapZoneBoundary(nodes, made.zoneId, [-1.001, 2])).toBeNull()
    expect(
      divideZone(nodes, {
        zoneId: made.zoneId,
        cut: [
          [-2, 2],
          [4, 6],
        ],
        mintId: mint(),
      }).conflicts?.[0]?.code,
    ).toBe('snap-distance')
  })
})
