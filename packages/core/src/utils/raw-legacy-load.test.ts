import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { z } from 'zod'
import { type AnyNode, AnyNode as AnyNodeSchema, nodeKindOf } from '../schema/types'
import useScene, { clearSceneHistory } from '../store/use-scene'
import * as m from './scene-migrations'

// The hosted authority's load (`normalize-authority-scene.ts` in the hosted
// app) without its plugin and reachability steps: every structure migration,
// called one by one on the stored nodes.
function authorityLoad(source: Record<string, unknown>) {
  const healed = m.healSceneNodes(m.normalizeLegacyStructure(source))
  const { nodes: retained } = m.removeRetiredDrawingSheetNodes(healed.nodes)
  const legacyMaterials = m.migrateStructuralMaterialSlots(retained)
  const vertical = m.migrateVerticalSceneNodes(legacyMaterials.nodes)
  const rooms = m.migrateRoomZones(vertical.nodes)
  const ceilings = m.migrateCeilingRoomLinks(rooms.nodes)
  const nodes = Object.values(ceilings.nodes) as AnyNode[]
  const legacyOpeningsPrepared =
    nodes.some((node) => node.type === 'slab' && node.autoFromWalls && !node.plateRole) &&
    nodes.some((node) => node.type === 'stair' || node.type === 'elevator')
  const plates = m.migrateFloorPlates(m.materializeLegacyAutoOpenings(ceilings.nodes, true))
  const slots = m.migrateSlabSlots(plates.nodes)
  const openings = m.ensureSceneOpenings(slots.nodes)
  const wallFaces = m.migrateWallFaceKeys(openings.nodes)
  const wallBands = m.migrateWallFaceBands(wallFaces.nodes)
  const structure = m.reconcileStructureOnLoad(wallBands.nodes, vertical.nodes, {
    legacyOpeningsPrepared,
  })
  return m.materializeNodeDefaults(structure.nodes, m.STRUCTURE_NODE_KINDS).nodes
}

function clientLoad(source: Record<string, unknown>, rootNodeIds?: string[]) {
  const roots =
    rootNodeIds ??
    Object.values(source)
      .filter((node) => (node as AnyNode).type === 'site')
      .map((node) => (node as AnyNode).id)
  useScene.getState().setScene(source as Record<string, AnyNode>, roots as AnyNode['id'][])
  return useScene.getState().nodes as Record<string, AnyNode>
}

// Shaped like the oldest stored scenes: walls without `children`, openings
// placed by a legacy `offset` with no `position`, a slab drawn by `vertices`,
// a documentation-only zone, no level `height`.
function rawLegacyScene(): Record<string, Record<string, unknown>> {
  const wall = (id: string, start: number[], end: number[]) => ({
    id,
    type: 'wall',
    object: 'node',
    visible: true,
    parentId: 'level_floor1',
    start,
    end,
    height: 3,
    thickness: 0.2,
    frontSide: 'exterior',
    backSide: 'interior',
  })
  return {
    site: {
      id: 'site',
      type: 'site',
      object: 'node',
      visible: true,
      metadata: {},
      parentId: null,
    },
    building: {
      id: 'building',
      type: 'building',
      object: 'node',
      visible: true,
      metadata: {},
      parentId: 'site',
    },
    level_floor1: {
      id: 'level_floor1',
      type: 'level',
      object: 'node',
      name: 'First Floor',
      visible: true,
      metadata: { elevation: 0 },
      parentId: 'building',
    },
    wall_north: wall('wall_north', [0, 0], [5, 0]),
    wall_east: wall('wall_east', [5, 0], [5, 4]),
    wall_south: wall('wall_south', [5, 4], [0, 4]),
    wall_west: wall('wall_west', [0, 4], [0, 0]),
    door_001: {
      id: 'door_001',
      type: 'door',
      object: 'node',
      visible: true,
      width: 0.9,
      height: 2.1,
      offset: 1,
      metadata: { type: 'single', swing: 'inward' },
      parentId: 'wall_south',
    },
    window_001: {
      id: 'window_001',
      type: 'window',
      object: 'node',
      visible: true,
      width: 1.5,
      height: 1.2,
      offset: 1.5,
      sillHeight: 0.9,
      metadata: { type: 'fixed' },
      parentId: 'wall_west',
    },
    slab_floor: {
      id: 'slab_floor',
      type: 'slab',
      object: 'node',
      visible: true,
      metadata: { material: 'concrete' },
      parentId: 'level_floor1',
      vertices: [
        [0, 0],
        [5, 0],
        [5, 4],
        [0, 4],
      ],
      thickness: 0.15,
    },
    zone_ward_room: {
      id: 'zone_ward_room',
      type: 'zone',
      object: 'node',
      name: 'Patient Ward #101',
      visible: true,
      metadata: { area: 20, capacity: 2, function: 'patient_room' },
      parentId: 'level_floor1',
    },
  }
}

let loadErrors: unknown[][] = []
let restoreSpies: Array<() => void> = []
const previous = useScene.getState()
beforeEach(() => {
  loadErrors = []
  // A load migration that throws is reported and skipped; these tests demand
  // none is, so a crash cannot hide behind the fallback.
  const error = spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (String(args[0]).startsWith('[scene load]')) loadErrors.push(args)
  })
  const warn = spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    if (String(args[0]).startsWith('[floor plates] Keeping existing')) loadErrors.push(args)
  })
  restoreSpies = [() => error.mockRestore(), () => warn.mockRestore()]
})
afterEach(() => {
  for (const restore of restoreSpies) restore()
  useScene.setState(previous, true)
  clearSceneHistory()
})

test('a raw legacy scene loads through the hosted authority without crashing', () => {
  const source = rawLegacyScene()
  const snapshot = structuredClone(source)
  const loaded = authorityLoad(source)
  expect(loadErrors).toEqual([])
  expect(source).toEqual(snapshot)
  for (const id of Object.keys(source)) expect(loaded).toHaveProperty(id)
  // The room the four walls enclose exists, with its floor built.
  const room = Object.values(loaded).find(
    (node) =>
      (node as AnyNode).type === 'zone' &&
      (node as AnyNode & { autoFromWalls?: boolean }).autoFromWalls,
  )
  expect(room).toBeDefined()
  // Openings keep main's stored shape: the legacy `offset` stays, and the load
  // writes no `position` main never stored.
  expect(loaded.door_001).toMatchObject({ offset: 1, parentId: 'wall_south' })
  expect(loaded.door_001).not.toHaveProperty('position')
  expect(loaded.window_001).not.toHaveProperty('position')
  expect(loaded.wall_north).toMatchObject({ start: [0, 0], end: [5, 0], thickness: 0.2 })
  // A second load (the authority re-normalizes what it serves) changes nothing.
  expect(authorityLoad(loaded)).toEqual(loaded)
})

test('a raw legacy scene loads through setScene without crashing', () => {
  const loaded = clientLoad(rawLegacyScene())
  expect(loadErrors).toEqual([])
  for (const id of Object.keys(rawLegacyScene())) expect(loaded).toHaveProperty(id)
  // As main loaded it: the schema default pose, the legacy offset untouched.
  expect(loaded.door_001).toMatchObject({ position: [0, 0, 0], offset: 1 })
  expect((loaded.wall_south as AnyNode & { children: string[] }).children).toContain('door_001')
  expect(loaded.wall_east).toMatchObject({ children: [], start: [5, 0], end: [5, 4] })
})

// Robustness gate: stored nodes may omit any field the schema defaults or
// leaves optional. Strip them at random (seeded) and demand every load
// migration still runs.
const optionalKeys = new Map<string, string[]>()
for (const option of AnyNodeSchema.options) {
  optionalKeys.set(
    nodeKindOf(option),
    Object.entries(option.shape as Record<string, z.ZodType>)
      .filter(
        ([key, schema]) =>
          !['id', 'type', 'object', 'parentId'].includes(key) &&
          schema.safeParse(undefined).success,
      )
      .map(([key]) => key),
  )
}

function stripOptionalFields(nodes: Record<string, unknown>, seed: number, rate: number) {
  let state = seed >>> 0
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 2 ** 32
  }
  return Object.fromEntries(
    Object.entries(nodes).map(([id, value]) => {
      const node = { ...(value as Record<string, unknown>) }
      for (const key of optionalKeys.get(node.type as string) ?? [])
        if (random() < rate) delete node[key]
      return [id, node]
    }),
  )
}

const corpus = [
  'plate-corpus/frozen-gate/scene-10.json',
  'plate-corpus/frozen-gate/scene-21.json',
  'plate-corpus/legacy-load/scene-04.json',
  'plate-corpus/legacy-load/scene-22.json',
  'plate-corpus/review/scene-06.json',
  'plate-corpus/review/scene-17.json',
]

for (const file of ['raw legacy scene', ...corpus]) {
  test(`raw legacy robustness: ${file} loads with optional fields stripped`, () => {
    const scene =
      file === 'raw legacy scene'
        ? { nodes: rawLegacyScene() }
        : JSON.parse(readFileSync(new URL(`../lib/__fixtures__/${file}`, import.meta.url), 'utf8'))
    const nodes = (scene.nodes ?? scene) as Record<string, unknown>
    const roots = Array.isArray(scene.rootNodeIds) ? scene.rootNodeIds : undefined
    for (const [seed, rate] of [
      [1, 1],
      [2, 0.5],
      [3, 0.5],
      [4, 0.25],
    ] as const) {
      const stripped = stripOptionalFields(nodes, seed, rate)
      expect(() => authorityLoad(stripped)).not.toThrow()
      expect(() => clientLoad(stripped, roots)).not.toThrow()
      expect({ seed, errors: loadErrors }).toEqual({ seed, errors: [] })
    }
  })
}
