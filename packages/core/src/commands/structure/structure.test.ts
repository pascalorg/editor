import { describe, expect, test } from 'bun:test'
import { reconcileLevelStructure } from '../../lib/structure-kernel'
import { DoorNode, ItemNode, LevelNode, WallNode } from '../../schema'
import { getWallFaceLine } from '../../systems/wall/wall-frame'
import {
  createZone,
  deleteZone,
  divideZone,
  mergeZones,
  setWallGeometry,
  setZoneEdges,
  setZoneIntent,
} from './index'
import {
  applyToScratch,
  roomFace,
  type StructureNodes,
  type StructurePlan,
  structureChangeBatch,
} from './shared'

export function fixture() {
  const level = LevelNode.parse({ id: 'level_test' })
  return { [level.id]: level }
}
export function mint() {
  let i = 0
  return (kind: string) => `${kind}_test${++i}`
}
export const polygon: [number, number][] = [
  [0, 0],
  [8, 0],
  [8, 4],
  [0, 4],
]
export function apply(nodes: StructureNodes, plan: StructurePlan) {
  expect(plan.conflicts).toBeUndefined()
  const next = applyToScratch(nodes, structureChangeBatch(plan.changes))
  let i = 0
  const derived = reconcileLevelStructure({
    levelId: 'level_test',
    nodes: next,
    previousNodes: nodes,
    mintId: (kind) => {
      let id: string
      do {
        id = `${kind}_derived${++i}`
      } while (next[id])
      return id
    },
  })
  return applyToScratch(next, structureChangeBatch(derived.patches))
}
export function enclosed() {
  const initial = fixture()
  const result = createZone(initial, {
    levelId: 'level_test',
    polygon,
    enclose: true,
    mintId: mint(),
    name: 'Kitchen',
  })
  return { nodes: apply(initial, result), zoneId: result.zoneId }
}

describe('structure primitives', () => {
  test('create is pure, deterministic with caller IDs; enclosure is opt-in and intent derives surfaces', () => {
    const nodes = fixture(),
      before = JSON.stringify(nodes)
    const run = () =>
      createZone(nodes, {
        levelId: 'level_test',
        polygon,
        mintId: mint(),
        intent: { hasCeiling: false },
      })
    expect(run()).toEqual(run())
    expect(JSON.stringify(nodes)).toBe(before)
    const next = apply(nodes, run())
    expect(Object.values(next).filter((n) => n.type === 'separator')).toHaveLength(4)
    expect(Object.values(next).filter((n) => n.type === 'wall')).toHaveLength(0)
    expect(Object.values(next).filter((n) => n.type === 'zone')).toHaveLength(1)
    expect(Object.values(next).filter((n) => n.type === 'slab')).toHaveLength(1)
    expect(Object.values(next).filter((n) => n.type === 'ceiling')).toHaveLength(0)
  })
  test('intent merges nested fields, clears null, validates and stores names verbatim', () => {
    const { nodes, zoneId } = enclosed()
    const a = apply(
      nodes,
      setZoneIntent(nodes, {
        zoneId,
        patch: { floor: { elevation: 0.4, finish: 'wood' }, name: '  Studio  ', hasCeiling: false },
      }),
    )
    const b = apply(
      a,
      setZoneIntent(a, { zoneId, patch: { floor: { finish: null }, hasCeiling: null } }),
    )
    expect(b[zoneId]).toMatchObject({ name: '  Studio  ', floor: { elevation: 0.4 } })
    expect((b[zoneId] as { floor: object }).floor).not.toHaveProperty('finish')
    expect(() =>
      setZoneIntent(nodes, { zoneId, patch: { floor: { elevation: Number.NaN } } }),
    ).toThrow()
  })
  test('divide snaps endpoints, retains seed identity, shares plate; merge restores one zone', () => {
    const { nodes, zoneId } = enclosed()
    const split = divideZone(nodes, {
      zoneId,
      cut: [
        [2, 0.03],
        [2, 3.98],
      ],
      mintId: mint(),
    })
    const next = apply(nodes, split)
    expect(next[split.separatorId!]).toMatchObject({ start: [2, 0], end: [2, 4] })
    expect(next[zoneId]).toMatchObject({ name: 'Kitchen', seed: [4, 2] })
    const zones = Object.values(next).filter((n) => n.type === 'zone')
    expect(zones).toHaveLength(2)
    expect(Object.values(next).filter((n) => n.type === 'slab')).toHaveLength(1)
    expect(Object.values(next).filter((n) => n.type === 'ceiling')).toHaveLength(2)
    const merged = apply(next, mergeZones(next, { zoneIds: [zones[0]!.id, zones[1]!.id] }))
    expect(Object.values(merged).filter((n) => n.type === 'zone')).toHaveLength(1)
    expect(Object.values(merged).filter((n) => n.type === 'ceiling')).toHaveLength(1)
  })
  test('walls and separators round trip through wall planners', () => {
    const { nodes, zoneId } = enclosed()
    const zone = nodes[zoneId]!
    if (zone.type !== 'zone') throw Error()
    const span = roomFace(nodes, zone)!.spans[0]!
    const result = setZoneEdges(nodes, {
      zoneId,
      edges: [{ spanRef: span, kind: 'separator' }],
      mintId: mint(),
    })
    const next = apply(nodes, result)
    const current = next[zoneId]!
    if (current.type !== 'zone') throw Error()
    const separator = roomFace(next, current)!.spans.find((s) => s.kind === 'separator')!
    const restored = apply(
      next,
      setZoneEdges(next, {
        zoneId,
        edges: [{ spanRef: separator, kind: 'wall' }],
        mintId: (kind) => `${kind}_restored`,
      }),
    )
    expect(Object.values(restored).filter((n) => n.type === 'wall')).toHaveLength(4)
    expect(restored[zoneId]).toBeDefined()
  })
  test('delete removes room construction; undo data includes all boundary IDs', () => {
    const { nodes, zoneId } = enclosed()
    const plan = deleteZone(nodes, { zoneId, contents: 'delete' })
    expect(plan.payload.wallIds).toHaveLength(4)
    expect(plan.payload.keptSharedWallIds).toEqual([])
    const next = apply(nodes, plan)
    for (const type of ['zone', 'wall', 'slab', 'ceiling'])
      expect(Object.values(next).filter((n) => n.type === type)).toHaveLength(0)
  })
  test('geometry moves junction neighbours while justification only moves the body', () => {
    const { nodes } = enclosed()
    const wall = Object.values(nodes).find((n): n is WallNode => n.type === 'wall')!
    const result = setWallGeometry(nodes, {
      wallId: wall.id,
      start: [-1, 0],
      end: [8, 0],
      mintId: mint(),
    })
    expect(applyToScratch(nodes, structureChangeBatch(result.changes))[wall.id]).toMatchObject({
      start: [-1, 0],
      end: [8, 0],
    })
    const justified = setWallGeometry(nodes, {
      wallId: wall.id,
      justification: 'a',
      mintId: mint(),
    })
    const after = applyToScratch(nodes, structureChangeBatch(justified.changes))[
      wall.id
    ] as WallNode
    expect(justified.changes).toEqual([{ op: 'update', id: wall.id, data: { justification: 'a' } }])
    expect(after.start).toEqual(wall.start)
    expect(after.end).toEqual(wall.end)
    expect(getWallFaceLine(after, 'b')).toEqual({
      start: { x: wall.start[0], y: wall.start[1] },
      end: { x: wall.end[0], y: wall.end[1] },
    })
  })
  test('create accepts a boundary set and closes explicit curved wall edges without a chord', () => {
    const existing = enclosed()
    const walls = Object.values(existing.nodes).filter((n) => n.type === 'wall')
    const nodes = { ...fixture(), ...Object.fromEntries(walls.map((n) => [n.id, n])) }
    const adopted = createZone(nodes, {
      levelId: 'level_test',
      boundaryIds: walls.map((n) => n.id),
      mintId: () => 'zone_adopted',
    })
    expect(adopted.changes).toHaveLength(1)
    expect(apply(nodes, adopted)['zone_adopted']).toBeDefined()
    const wall = WallNode.parse({
      id: 'wall_curve',
      parentId: 'level_test',
      start: [0, 0],
      end: [8, 0],
      curveOffset: -1,
    })
    const curvedNodes = { ...fixture(), [wall.id]: wall }
    const closed = createZone(curvedNodes, {
      levelId: 'level_test',
      edges: [
        { wallId: wall.id, face: 'a', t0: 0, t1: 1 },
        {
          separator: [
            [8, 4],
            [0, 4],
          ],
        },
      ],
      mintId: mint(),
    })
    expect(
      closed.changes.filter((c) => c.op === 'create' && c.node.type === 'separator'),
    ).toHaveLength(3)
    expect(Object.values(apply(curvedNodes, closed)).filter((n) => n.type === 'zone')).toHaveLength(
      1,
    )
    expect(() =>
      createZone(fixture(), {
        levelId: 'level_test',
        polygon: [
          [0, 0],
          [4, 4],
          [0, 4],
          [3, 0],
        ],
        mintId: mint(),
      }),
    ).toThrow('valid polygon')
  })
  test('partial wall conversion reports openings, preserves surviving hosts and supports several spans', () => {
    const { nodes, zoneId } = enclosed()
    const wall = Object.values(nodes).find(
      (n) => n.type === 'wall' && n.start[0] === 0 && n.start[1] === 0 && n.end[0] === 8,
    )!
    const kept = DoorNode.parse({
      id: 'door_kept',
      parentId: wall.id,
      wallId: wall.id,
      position: [1, 0, 0],
    })
    const removed = DoorNode.parse({
      id: 'door_removed',
      parentId: wall.id,
      wallId: wall.id,
      position: [3, 0, 0],
    })
    const graph = {
      ...nodes,
      [kept.id]: kept,
      [removed.id]: removed,
      [wall.id]: { ...wall, children: [kept.id, removed.id] },
    }
    const zone = nodes[zoneId]!
    if (zone.type !== 'zone') throw Error()
    const span = roomFace(nodes, zone)!.spans.find((s) => s.boundaryId === wall.id)!
    let nextId = 0
    const mintId = (kind: string) => `${kind}_conversion${++nextId}`
    const input = {
      zoneId,
      edges: [{ spanRef: { ...span, t0: 0.25, t1: 0.75 }, kind: 'separator' as const }],
      mintId,
    }
    expect(setZoneEdges(graph, input)).toMatchObject({
      changes: [],
      conflicts: [{ code: 'hosted-openings', nodeIds: [removed.id] }],
    })
    const next = apply(graph, setZoneEdges(graph, { ...input, dropOpenings: true }))
    expect(next[removed.id]).toBeUndefined()
    expect(next[kept.id]).toMatchObject({ parentId: wall.id, position: [1, 0, 0] })
    expect(next[zoneId]).toBeDefined()
    const multiple = apply(
      nodes,
      setZoneEdges(nodes, {
        zoneId,
        edges: [
          { spanRef: { ...span, t0: 0.1, t1: 0.2 }, kind: 'separator' },
          { spanRef: { ...span, t0: 0.7, t1: 0.8 }, kind: 'separator' },
        ],
        mintId,
      }),
    )
    expect(Object.values(multiple).filter((n) => n.type === 'separator')).toHaveLength(2)
    expect(Object.values(multiple).filter((n) => n.type === 'wall')).toHaveLength(6)
  })
  test('shared walls stay on edge conversion and deletion; wall-only merge names the wall', () => {
    const { nodes, zoneId } = enclosed()
    const divided = apply(
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
    const zone = divided[zoneId]!
    if (zone.type !== 'zone') throw Error()
    const separator = roomFace(divided, zone)!.spans.find((s) => s.kind === 'separator')!
    let nextId = 0
    const walled = apply(
      divided,
      setZoneEdges(divided, {
        zoneId,
        edges: [{ spanRef: separator, kind: 'wall' }],
        mintId: (kind) => `${kind}_shared${++nextId}`,
      }),
    )
    const wall = Object.values(walled).find(
      (n) => n.type === 'wall' && n.start[0] === 2 && n.end[0] === 2,
    )!
    const zones = Object.values(walled).filter((n) => n.type === 'zone')
    expect(mergeZones(walled, { zoneIds: [zones[0]!.id, zones[1]!.id] })).toMatchObject({
      changes: [],
      conflicts: [{ code: 'wall-boundary', nodeIds: [wall.id] }],
    })
    const current = walled[zoneId]!
    if (current.type !== 'zone') throw Error()
    const shared = roomFace(walled, current)!.spans.find((s) => s.boundaryId === wall.id)!
    expect(
      setZoneEdges(walled, {
        zoneId,
        edges: [{ spanRef: shared, kind: 'separator' }],
        mintId: mint(),
      }).changes,
    ).toEqual([])
    const deleted = deleteZone(walled, { zoneId, contents: 'delete' })
    expect(deleted.payload.keptSharedWallIds).toContain(wall.id)
    expect(apply(walled, deleted)[wall.id]).toBeDefined()
  })
  test('keep contents preserves item hierarchy and detaches ceiling fixtures before derivation', () => {
    const { nodes, zoneId } = enclosed()
    const ceiling = Object.values(nodes).find((n) => n.type === 'ceiling')!
    const asset = {
      id: 'fixture',
      category: 'test',
      name: 'Fixture',
      thumbnail: '',
      src: 'https://example.com/fixture.glb',
    }
    const table = ItemNode.parse({
      id: 'item_table',
      parentId: 'level_test',
      position: [2, 0, 2],
      children: ['item_child'],
      asset,
    })
    const child = ItemNode.parse({
      id: 'item_child',
      parentId: table.id,
      position: [0, 1, 0],
      asset,
    })
    const light = ItemNode.parse({
      id: 'item_light',
      parentId: ceiling.id,
      position: [3, 0, 2],
      asset,
    })
    const graph = {
      ...nodes,
      [table.id]: table,
      [child.id]: child,
      [light.id]: light,
      [ceiling.id]: { ...ceiling, children: [light.id] },
    }
    const kept = deleteZone(graph, { zoneId, contents: 'keep' })
    expect(kept.payload.itemIds).toHaveLength(3)
    const result = apply(graph, kept)
    expect(result[table.id]).toMatchObject({ parentId: 'level_test', children: [child.id] })
    expect(result[child.id]).toMatchObject({ parentId: table.id, position: [0, 1, 0] })
    expect(result[light.id]).toMatchObject({ parentId: 'level_test' })
    const deleted = apply(graph, deleteZone(graph, { zoneId, contents: 'delete' }))
    expect(Object.values(deleted).filter((n) => n.type === 'item')).toHaveLength(0)
  })
})
