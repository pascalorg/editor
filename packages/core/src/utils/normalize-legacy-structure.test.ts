import { afterEach, expect, test } from 'bun:test'
import { area } from '../lib/polygon-boolean'
import { detectRoomFaces, extractRooms } from '../lib/room-graph'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  LevelNode,
  SiteNode,
  WallNode,
} from '../schema'
import useScene from '../store/use-scene'
import {
  ensureSceneOpenings,
  healSceneNodes,
  migrateCeilingRoomLinks,
  migrateFloorPlates,
  migrateRoomZones,
  migrateSlabSlots,
  migrateVerticalSceneNodes,
  migrateWallFaceBands,
  migrateWallFaceKeys,
  normalizeLegacyStructure,
  reconcileStructureOnLoad,
  removeRetiredDrawingSheetNodes,
} from './scene-migrations'

const previous = useScene.getState()
afterEach(() => useScene.setState(previous, true))

test('legacy documentation-only zones retain metadata without inventing a room boundary', () => {
  const source = {
    zone_docs: { id: 'zone_docs', type: 'zone', name: 'Ward', metadata: { capacity: 2 } },
    zone_room: { id: 'zone_room', type: 'zone', spaceRole: 'room' },
  }
  const normalized = normalizeLegacyStructure(source)
  expect(normalized.zone_docs).toEqual({ ...source.zone_docs, polygon: [] })
  expect(normalized.zone_room).toEqual({ ...source.zone_room, name: 'Room' })
  expect(source.zone_docs).not.toHaveProperty('polygon')
  expect(normalizeLegacyStructure(normalized)).toBe(normalized)
})

function source(embedded: boolean) {
  const polygon: [number, number][] = [
    [0, 0],
    [0.9, 0],
    [0.9, 0.9],
    [0, 0.9],
  ]
  const walls = polygon.map((start, i) => ({
    ...WallNode.parse({
      id: `wall_${i}`,
      parentId: 'level_legacy',
      start,
      end: polygon[(i + 1) % 4],
      thickness: 0.1,
      justification: 'a',
    }),
    assemblyLayers: [{ thickness: 0.5 }],
  }))
  const level = LevelNode.parse({
    id: 'level_legacy',
    parentId: 'building_legacy',
    children: walls.map((w) => w.id),
  })
  const building = BuildingNode.parse({
    id: 'building_legacy',
    parentId: 'site_legacy',
    children: [level.id],
  })
  const site = {
    ...SiteNode.parse({ id: 'site_legacy' }),
    children: embedded ? [building] : [building.id],
  }
  return Object.fromEntries(
    [site, level, ...walls, ...(embedded ? [] : [building])].map((n) => [n.id, n]),
  )
}

// The authority prunes to root reachability after the shared migrations.
function authorityLoad(sourceNodes: Record<string, unknown>, roots: string[]) {
  const normalized = normalizeLegacyStructure(sourceNodes)
  const healed = healSceneNodes(normalized)
  const retired = removeRetiredDrawingSheetNodes(healed.nodes)
  const vertical = migrateVerticalSceneNodes(retired.nodes)
  const rooms = migrateRoomZones(vertical.nodes)
  const ceilings = migrateCeilingRoomLinks(rooms.nodes)
  const plates = migrateFloorPlates(ceilings.nodes)
  const slots = migrateSlabSlots(plates.nodes)
  const openings = ensureSceneOpenings(slots.nodes)
  const walls = migrateWallFaceBands(migrateWallFaceKeys(openings.nodes).nodes)
  const nodes = reconcileStructureOnLoad(walls.nodes, vertical.nodes).nodes
  const reachable = new Set<string>()
  const pending = [...roots]
  while (pending.length) {
    const id = pending.pop()!
    const node = nodes[id]
    if (!node || reachable.has(id)) continue
    reachable.add(id)
    if ('children' in node && Array.isArray(node.children)) pending.push(...node.children)
  }
  return Object.fromEntries(Object.entries(nodes).filter(([id]) => reachable.has(id)))
}

for (const embedded of [false, true]) {
  test(`complete client and authority load paths agree with legacy layers and embedded building=${embedded}`, () => {
    const original = source(embedded)
    const saved = JSON.stringify(original)
    const server = authorityLoad(original, ['site_legacy'])
    useScene.getState().setScene(original as Record<AnyNodeId, AnyNode>, ['site_legacy'])
    const client = useScene.getState().nodes
    const rooms = (nodes: Record<string, AnyNode>) =>
      Object.values(nodes)
        .filter((n) => n.type === 'zone')
        .sort((a, b) => a.id.localeCompare(b.id))
    expect(rooms(client)).toHaveLength(1)
    expect(rooms(server)).toEqual(rooms(client))
    expect(server.building_legacy).toMatchObject({
      parentId: 'site_legacy',
      children: ['level_legacy'],
    })
    expect(server.level_legacy).toMatchObject({
      children: expect.arrayContaining([rooms(server)[0]!.id]),
    })
    expect(JSON.stringify(original)).toBe(saved)
    const normalized = normalizeLegacyStructure(original)
    expect(normalizeLegacyStructure(normalized)).toBe(normalized)
    expect(normalized.wall_0).toMatchObject({ thickness: 0.5 })
    expect(normalized.wall_0).not.toHaveProperty('assemblyLayers')
  })
}

test('reference-area eligibility does not depend on wall thickness', () => {
  const nodes = source(false)
  const walls = Object.values(nodes).filter((n) => n.type === 'wall') as WallNode[]
  const reference = detectRoomFaces(walls)
  expect(reference).toHaveLength(1)
  const thickRoom = extractRooms(walls.map((wall) => ({ ...wall, thickness: 0.5 })))[0]!
  expect(area([{ outer: thickRoom.polygon.map(({ x, y }) => [x, y]), holes: [] }])).toBeLessThan(
    0.5,
  )
  expect(area([{ outer: reference[0]!.polygon, holes: [] }])).toBeGreaterThan(0.5)
  for (const thickness of [0.01, 0.5, 0.8]) {
    expect(detectRoomFaces(walls.map((wall) => ({ ...wall, thickness })))).toEqual(reference)
  }
})
