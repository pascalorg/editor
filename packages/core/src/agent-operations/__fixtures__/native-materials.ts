import { expect } from 'bun:test'
import { BuildingNode, DoorNode, LevelNode, SiteNode, WallNode, WindowNode } from '../../schema'
import type { AnyNode, SceneMaterial } from '../../schema'

/**
 * Acceptance contract v1.1 (2026-10-10): user-approved exact custom native PBR,
 * plus Main's run_batch composition requirement. Derived before candidate edits.
 * Four analytical rectangle walls: south runs east, so a is interior and b exterior.
 * Public observables are native refs/datablocks, untouched opposite finish/openings,
 * serialized inputs and transaction history; random material IDs are not an oracle.
 */
export const MOUNTAIN_NAME = 'Mountain house — warm timber'
export const MOUNTAIN_MATERIAL = {
  preset: 'custom' as const,
  properties: { color: '#71503a', roughness: 0.86, metalness: 0 },
}
export const EXPECTED_MOUNTAIN_MATERIAL = {
  preset: 'custom',
  properties: {
    color: '#71503a', roughness: 0.86, metalness: 0,
    opacity: 1, transparent: false, side: 'front',
  },
} as const
export const INTERIOR_FINISH = 'library:concrete-drywall'

export function nativeMaterialScene() {
  const site = SiteNode.parse({ id: 'site_materials' })
  const building = BuildingNode.parse({ id: 'building_materials', parentId: site.id })
  const level = LevelNode.parse({ id: 'level_materials', parentId: building.id, level: 0 })
  const south = WallNode.parse({
    id: 'wall_material_south', parentId: level.id, start: [0, 0], end: [6, 0],
    height: 3, slots: { a: INTERIOR_FINISH, b: 'library:concrete-raw' },
    faceRegions: [{ id: 'interior_stripe', face: 'a', u0: 0, u1: 2, v0: 0, v1: 1, finish: '#fffafa' }],
  })
  const east = WallNode.parse({ id: 'wall_material_east', parentId: level.id, start: [6, 0], end: [6, 4], height: 3 })
  const north = WallNode.parse({ id: 'wall_material_north', parentId: level.id, start: [6, 4], end: [0, 4], height: 3 })
  const west = WallNode.parse({ id: 'wall_material_west', parentId: level.id, start: [0, 4], end: [0, 0], height: 3 })
  const window = WindowNode.parse({ id: 'window_materials', parentId: south.id, position: [4, 1.5, 0], width: 1, height: 1 })
  const door = DoorNode.parse({ id: 'door_materials', parentId: south.id, position: [1, 1, 0], width: 0.9, height: 2 })
  site.children = [building.id]
  building.children = [level.id]
  level.children = [south.id, east.id, north.id, west.id]
  south.children = [window.id, door.id]
  return {
    nodes: Object.fromEntries([site, building, level, south, east, north, west, window, door].map(node => [node.id, node])) as Record<string, AnyNode>,
    rootNodeIds: [site.id],
    level, south, east, north, west, window, door,
  }
}

export function mountainPaint(targets = ['wall_material_south']) {
  return { targets, role: 'exterior', material: structuredClone(MOUNTAIN_MATERIAL), materialName: MOUNTAIN_NAME }
}

export function nativePaintReadback(nodes: Readonly<Record<string, AnyNode>>, materials: Readonly<Record<string, SceneMaterial>>, wallId = 'wall_material_south') {
  const wall = nodes[wallId]
  if (wall?.type !== 'wall') throw new Error(`Missing wall ${wallId}`)
  const ref = wall.slots?.b
  expect(ref).toMatch(/^scene:/)
  const id = ref!.slice('scene:'.length)
  const datablock = materials[id]
  expect(datablock).toBeDefined()
  expect(datablock!.id).toBe(id)
  expect(datablock!.material).toEqual(EXPECTED_MOUNTAIN_MATERIAL)
  return { ref: ref!, datablock: datablock! }
}

export function expectPreserved(before: Readonly<Record<string, AnyNode>>, after: Readonly<Record<string, AnyNode>>) {
  for (const [id, node] of Object.entries(before)) {
    expect(after[id]?.id).toBe(node.id)
    expect(after[id]?.type).toBe(node.type)
    expect(after[id]?.parentId).toBe(node.parentId)
  }
  for (const id of ['window_materials', 'door_materials']) expect(after[id]).toEqual(before[id])
  const original = before.wall_material_south
  const painted = after.wall_material_south
  if (original?.type !== 'wall' || painted?.type !== 'wall') throw new Error('Fixture wall missing')
  expect(painted.id).toBe(original.id)
  expect(painted.parentId).toBe(original.parentId)
  expect(painted.children).toEqual(original.children)
  expect(painted.start).toEqual(original.start)
  expect(painted.end).toEqual(original.end)
  expect(painted.slots?.a).toBe(original.slots?.a)
  expect(painted.faceRegions?.filter(region => region.face === 'a')).toEqual(original.faceRegions?.filter(region => region.face === 'a'))
}
