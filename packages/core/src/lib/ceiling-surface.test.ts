import { describe, expect, test } from 'bun:test'
import { setZoneIntent } from '../commands/structure/set-zone-intent'
import { transformZone } from '../commands/structure/transform-zone'
import type { AnyNode, AnyNodeId } from '../schema'
import { CeilingNode, LevelNode, WallNode, ZoneNode } from '../schema'
import useScene from '../store/use-scene'
import {
  ceilingPaintRegions,
  ceilingRegionRole,
  computeCeilingSurfaceCells,
  parseCeilingRegionRole,
} from './ceiling-surface'
import { area } from './polygon-boolean'
import { type NodePatch, reconcileLevelStructure, type SceneNodes } from './structure-kernel'

const levelId = 'level_ceiling_regions'
const ring: [number, number][] = [
  [0, 0],
  [8, 0],
  [8, 4],
  [0, 4],
]
const rect = (x: number, z: number, w: number, d: number): [number, number][] => [
  [x, z],
  [x + w, z],
  [x + w, z + d],
  [x, z + d],
]

function fixture() {
  const walls = ring.map((start, i) =>
    WallNode.parse({
      id: `wall_${i}`,
      parentId: levelId,
      start,
      end: ring[(i + 1) % 4],
      thickness: 0.2,
    }),
  )
  const level = LevelNode.parse({ id: levelId, children: walls.map((wall) => wall.id) })
  return Object.fromEntries([level, ...walls].map((node) => [node.id, node])) as SceneNodes
}
function apply(nodes: SceneNodes, patches: NodePatch[]): Record<string, AnyNode> {
  const result = { ...nodes }
  for (const patch of patches) {
    if (patch.op === 'delete') delete result[patch.id]
    else if (patch.op === 'create') result[patch.node.id] = patch.node
    else {
      const node = { ...result[patch.id], ...patch.data } as AnyNode
      for (const key of Object.keys(patch.data))
        if (patch.data[key as keyof typeof patch.data] === undefined)
          delete (node as unknown as Record<string, unknown>)[key]
      result[patch.id] = node
    }
  }
  return result
}
function run(nodes: SceneNodes) {
  let count = 0
  const plan = reconcileLevelStructure({
    levelId,
    nodes,
    mintId: (kind) => {
      let id: string
      do id = `${kind}_${String(++count).padStart(4, '0')}`
      while (nodes[id])
      return id
    },
  })
  return apply(nodes, plan.patches)
}
const zones = (nodes: SceneNodes) =>
  Object.values(nodes).filter((node): node is ZoneNode => node.type === 'zone')
const ceilings = (nodes: SceneNodes) =>
  Object.values(nodes).filter((node): node is CeilingNode => node.type === 'ceiling')
const regionArea = (zone: ZoneNode) =>
  area((zone.ceiling?.regions ?? []).map((region) => ({ outer: region.polygon, holes: [] })))

function paintedRoom() {
  const nodes = run(fixture())
  const zone = zones(nodes)[0]!
  // One patch across the whole room width, one only on its left end.
  nodes[zone.id] = {
    ...zone,
    seed: [1, 2],
    ceiling: {
      regions: [
        { id: 'band', polygon: rect(0, 1, 8, 2), finish: 'library:blue' },
        { id: 'corner', polygon: rect(0, 0, 1, 1), finish: 'library:red' },
      ],
    },
  }
  return { nodes, zoneId: zone.id }
}

describe('ceiling surface cells', () => {
  test('regions take what later ones leave; the ceiling keeps the rest', () => {
    const cells = computeCeilingSurfaceCells(
      rect(0, 0, 4, 4),
      [rect(3, 3, 0.5, 0.5)],
      [
        { id: 'a', polygon: rect(0, 0, 2, 4), finish: 'library:a' },
        { id: 'b', polygon: rect(1, 0, 2, 4), finish: 'library:b' },
        { id: 'outside', polygon: rect(10, 10, 1, 1), finish: 'library:c' },
      ],
    )
    const byRole = new Map(cells.map((cell) => [cell.role, cell]))
    expect([...byRole.keys()].sort()).toEqual(['region:a', 'region:b', 'surface'])
    expect(area(byRole.get('region:b')!.polygons)).toBeCloseTo(8)
    expect(area(byRole.get('region:a')!.polygons)).toBeCloseTo(4)
    // 16 − 12 painted − the 0.25 hole.
    expect(area(byRole.get('surface')!.polygons)).toBeCloseTo(3.75)
    expect(byRole.get('region:b')!.finish).toBe('library:b')
  })

  test('roles round-trip, and an automatic ceiling reads its room while a manual one reads itself', () => {
    expect(parseCeilingRegionRole(ceilingRegionRole('r1'))).toBe('r1')
    expect(parseCeilingRegionRole('surface')).toBeNull()
    const zone = ZoneNode.parse({
      id: 'zone_room',
      name: 'Room',
      polygon: ring,
      ceiling: { regions: [{ id: 'z', polygon: ring, finish: 'library:z' }] },
    })
    const auto = CeilingNode.parse({
      id: 'ceiling_auto',
      polygon: ring,
      boundary: 'auto',
      zoneId: zone.id,
      regions: [{ id: 'ignored', polygon: ring, finish: 'library:x' }],
    })
    const manual = CeilingNode.parse({
      id: 'ceiling_manual',
      polygon: ring,
      regions: [{ id: 'own', polygon: ring, finish: 'library:y' }],
    })
    const nodes = { [zone.id]: zone, [auto.id]: auto, [manual.id]: manual }
    expect(ceilingPaintRegions(auto, nodes).map((region) => region.id)).toEqual(['z'])
    expect(ceilingPaintRegions(manual, nodes).map((region) => region.id)).toEqual(['own'])
  })
})

describe('ceiling regions follow their room', () => {
  test('a rebuilt ceiling keeps drawing the room regions (the room owns them)', () => {
    const { nodes, zoneId } = paintedRoom()
    const before = ceilings(nodes).find((ceiling) => ceiling.zoneId === zoneId)!
    const { [before.id]: _, ...withoutCeiling } = nodes
    const rebuilt = run(withoutCeiling)
    const ceiling = ceilings(rebuilt).find((node) => node.zoneId === zoneId)!
    expect(ceiling).toBeDefined()
    expect(ceilingPaintRegions(ceiling, rebuilt).map((region) => region.id)).toEqual([
      'band',
      'corner',
    ])
    expect(run(rebuilt)).toEqual(rebuilt)
  })

  test('divide clips each room its part; merge brings them back together', () => {
    const { nodes, zoneId } = paintedRoom()
    const divider = WallNode.parse({
      id: 'wall_divider',
      parentId: levelId,
      start: [2, 0],
      end: [2, 4],
    })
    const divided = run({ ...nodes, [divider.id]: divider })
    const rooms = zones(divided)
    expect(rooms).toHaveLength(2)
    const kept = rooms.find((room) => room.id === zoneId)!
    const other = rooms.find((room) => room.id !== zoneId)!
    // The band spans both rooms; the corner stays in the seed room.
    expect(kept.ceiling?.regions?.map((region) => region.id)).toEqual(['band', 'corner'])
    expect(other.ceiling?.regions?.map((region) => region.id)).toEqual(['band'])
    expect(regionArea(kept) + regionArea(other)).toBeCloseTo(16 + 1)
    expect(run(divided)).toEqual(divided)

    const { wall_divider: _, ...merged } = divided
    const rejoined = run(merged)
    const survivor = zones(rejoined)[0]!
    expect(zones(rejoined)).toHaveLength(1)
    expect(regionArea(survivor)).toBeCloseTo(17)
    expect(new Set(survivor.ceiling?.regions?.map((region) => region.id))).toEqual(
      new Set(['band', 'corner']),
    )
  })

  test('moving the room moves its ceiling regions; raising its floor leaves them', () => {
    const { nodes, zoneId } = paintedRoom()
    let count = 0
    const plan = transformZone(nodes, {
      zoneId,
      translate: [10, 0],
      mintId: (kind: string) => `${kind}_moved_${++count}`,
    })
    const moved = apply(nodes, plan.changes as NodePatch[])
    const zone = moved[zoneId] as ZoneNode
    expect(zone.ceiling?.regions?.[1]?.polygon).toEqual(rect(10, 0, 1, 1))

    const raised = setZoneIntent(nodes, { zoneId, patch: { floor: { elevation: 0.3 } } })
    const after = apply(nodes, raised.changes as NodePatch[])
    expect((after[zoneId] as ZoneNode).ceiling).toEqual((nodes[zoneId] as ZoneNode).ceiling)
  })

  test('set_zone_intent writes and clears ceiling regions without touching the floor', () => {
    const { nodes, zoneId } = paintedRoom()
    const regions = [{ id: 'mcp', polygon: rect(3, 1, 2, 2), finish: 'library:green' }]
    const set = setZoneIntent(nodes, { zoneId, patch: { ceiling: { regions } } })
    expect(set.changes).toEqual([{ op: 'update', id: zoneId, data: { ceiling: { regions } } }])
    const cleared = setZoneIntent(nodes, { zoneId, patch: { ceiling: null } })
    expect(cleared.changes).toEqual([{ op: 'update', id: zoneId, data: { ceiling: undefined } }])
    expect(() =>
      setZoneIntent(nodes, {
        zoneId,
        patch: { ceiling: { regions: [{ id: 'bad', polygon: 'x' }] } } as never,
      }),
    ).toThrow()
  })
})

test('a room ceiling made manual keeps its painted parts on itself', () => {
  const { nodes, zoneId } = paintedRoom()
  const ceiling = ceilings(nodes).find((node) => node.zoneId === zoneId)!
  const saved = useScene.getState()
  globalThis.requestAnimationFrame ??= (callback: FrameRequestCallback) => {
    callback(0)
    return 0
  }
  try {
    useScene.setState({ nodes, readOnly: false } as never)
    useScene.getState().detachDerivedNode(ceiling.id as AnyNodeId, { polygon: rect(0, 0, 6, 4) })
    const detached = useScene.getState().nodes[ceiling.id as AnyNodeId] as CeilingNode
    expect(detached.boundary).toBeUndefined()
    expect(detached.regions?.map((region) => region.id)).toEqual(['band', 'corner'])
    expect(ceilingPaintRegions(detached, useScene.getState().nodes)).toEqual(detached.regions!)
  } finally {
    useScene.setState(saved, true)
  }
})
