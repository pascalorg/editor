import { afterEach, beforeEach, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  ElevatorNode,
  LevelNode,
  SlabNode,
  StairNode,
  StairSegmentNode,
} from '../schema'
import useScene, { clearSceneHistory } from '../store/use-scene'
import { initializeElevatorOpeningSync } from '../systems/elevator/elevator-opening-system'
import { initializeStairOpeningSync } from '../systems/stair/stair-opening-system'
import { materializeLegacyAutoOpenings } from './owned-floor-opening-migration'
import {
  ensureSceneOpenings,
  healSceneNodes,
  materializeNodeDefaults,
  migrateCeilingRoomLinks,
  migrateFloorPlates,
  migrateRoomZones,
  migrateSlabSlots,
  migrateVerticalSceneNodes,
  migrateWallFaceBands,
  migrateWallFaceKeys,
  normalizeLegacyStructure,
  reconcileStructureOnLoad,
} from './scene-migrations'

const directory = new URL('../lib/__fixtures__/plate-corpus/legacy-load/', import.meta.url)
const fixtures = readdirSync(directory)
  .filter((file) => file.endsWith('.json'))
  .map(
    (file) =>
      JSON.parse(readFileSync(new URL(file, directory), 'utf8')) as {
        sceneId: string
        levelId: string
        rootNodeIds: AnyNodeId[]
        nodes: Record<string, AnyNode>
      },
  )
for (const sceneId of ['scene-19', 'scene-10']) {
  fixtures.push(
    JSON.parse(
      readFileSync(
        new URL(`../lib/__fixtures__/plate-corpus/frozen-gate/${sceneId}.json`, import.meta.url),
        'utf8',
      ),
    ),
  )
}
function migrate(source: Record<string, unknown>) {
  const healed = healSceneNodes(normalizeLegacyStructure(source)).nodes
  const vertical = migrateVerticalSceneNodes(healed).nodes
  const rooms = migrateRoomZones(vertical).nodes
  const ceilings = migrateCeilingRoomLinks(rooms).nodes
  const legacyOpeningsPrepared =
    Object.values(ceilings).some(
      (node) => node.type === 'slab' && node.autoFromWalls && !node.plateRole,
    ) && Object.values(ceilings).some((node) => node.type === 'stair' || node.type === 'elevator')
  const plates = migrateFloorPlates(materializeLegacyAutoOpenings(ceilings, true)).nodes
  const openings = ensureSceneOpenings(migrateSlabSlots(plates).nodes).nodes
  return materializeNodeDefaults(
    reconcileStructureOnLoad(
      migrateWallFaceBands(migrateWallFaceKeys(openings).nodes).nodes,
      vertical,
      { legacyOpeningsPrepared },
    ).nodes,
  ).nodes
}
function geometry(nodes: Record<string, unknown>) {
  return Object.values(nodes)
    .filter((node): node is SlabNode => (node as AnyNode).type === 'slab')
    .map(
      ({
        id,
        polygon,
        holes,
        holeMetadata,
        elevation,
        thickness,
        recessed = false,
        boundary,
        zoneIds,
        autoFromWalls,
      }) => ({
        id,
        polygon,
        holes,
        holeMetadata,
        elevation,
        thickness,
        recessed,
        boundary,
        zoneIds,
        autoFromWalls,
      }),
    )
    .sort((a, b) => a.id.localeCompare(b.id))
}
let stopOpenings = () => {}
let previous: ReturnType<typeof useScene.getState>
const originalRaf = globalThis.requestAnimationFrame
const originalCancelRaf = globalThis.cancelAnimationFrame
beforeEach(() => {
  previous = useScene.getState()
  globalThis.requestAnimationFrame = (callback) => {
    callback(0)
    return 0
  }
  globalThis.cancelAnimationFrame = () => {}
  useScene.setState({ readOnly: false })
  clearSceneHistory()
})
afterEach(() => {
  stopOpenings()
  stopOpenings = () => {}
  useScene.setState(previous, true)
  clearSceneHistory()
  globalThis.requestAnimationFrame = originalRaf
  globalThis.cancelAnimationFrame = originalCancelRaf
})

test.each(
  fixtures.flatMap((fixture) =>
    ['none', 'before', 'after'].map((mount) => ({ ...fixture, mount })),
  ),
)('$sceneId loads with opening systems mounted $mount hydration and stable floor geometry', async (fixture) => {
  const bytes = JSON.stringify(fixture.nodes)
  const server = migrate(fixture.nodes)
  expect(JSON.stringify(fixture.nodes)).toBe(bytes)
  expect(migrate(server)).toEqual(server)
  const mountOpenings = () => {
    const stopStair = initializeStairOpeningSync()
    const stopElevator = initializeElevatorOpeningSync()
    stopOpenings = () => {
      stopStair()
      stopElevator()
    }
  }
  if (fixture.mount === 'before') mountOpenings()
  useScene.getState().setScene(structuredClone(fixture.nodes), fixture.rootNodeIds)
  await new Promise<void>((resolve) => queueMicrotask(resolve))
  if (fixture.mount === 'after') {
    mountOpenings()
    await new Promise<void>((resolve) => queueMicrotask(resolve))
  }
  const client = useScene.getState().nodes
  expect(geometry(client)).toEqual(geometry(server))
  for (const node of Object.values(server)) {
    if (node.type === 'stair-segment')
      expect((client[node.id] as StairSegmentNode).height).toBe(node.height)
  }
  useScene.getState().setScene(client, fixture.rootNodeIds)
  await new Promise<void>((resolve) => queueMicrotask(resolve))
  expect(geometry(useScene.getState().nodes)).toEqual(geometry(server))
})

test('missing level children are reconstructed from existing parent links before height migration', () => {
  const fixture = fixtures.find(({ sceneId }) => sceneId === 'scene-13')!
  const healed = healSceneNodes(fixture.nodes).nodes as Record<string, AnyNode>
  expect(healed[fixture.levelId]).toHaveProperty('children')
  expect(healSceneNodes(healed).nodes).toEqual(healed)
})

test.each([
  'none',
  'stair',
  'elevator',
] as const)('load ensures missing stair/elevator holes without redrawing existing ones (%s present)', async (present) => {
  const building = BuildingNode.parse({})
  const lower = LevelNode.parse({ parentId: building.id, level: 0, height: 3 })
  const upper = LevelNode.parse({ parentId: building.id, level: 1, height: 3 })
  const stair = StairNode.parse({
    parentId: lower.id,
    position: [10, 0, 10],
    fromLevelId: lower.id,
    toLevelId: upper.id,
    slabOpeningMode: 'destination',
  })
  const segment = StairSegmentNode.parse({ parentId: stair.id, height: 3, length: 4 })
  const elevator = ElevatorNode.parse({
    parentId: building.id,
    position: [3, 0, 3],
    fromLevelId: lower.id,
    toLevelId: upper.id,
  })
  const savedHole: [number, number][] = [
    [1.123_456_789, 1],
    [2, 1],
    [2, 2],
    [1.123_456_789, 2],
  ]
  const slab = SlabNode.parse({
    parentId: upper.id,
    polygon: [
      [0, 0],
      [20, 0],
      [20, 20],
      [0, 20],
    ],
    holes: present === 'none' ? [] : [savedHole],
    holeMetadata:
      present === 'none'
        ? []
        : [
            {
              source: present,
              ...(present === 'stair' ? { stairId: stair.id } : { elevatorId: elevator.id }),
            },
          ],
  })
  if (present === 'none') delete (slab as Partial<SlabNode>).holes
  building.children = [lower.id, upper.id, elevator.id]
  const floor = SlabNode.parse({ parentId: lower.id, elevation: 0.4, polygon: slab.polygon })
  lower.children = [stair.id, floor.id]
  upper.children = [slab.id]
  stair.children = [segment.id]
  const nodes = Object.fromEntries(
    [building, lower, upper, stair, segment, elevator, slab, floor].map((node) => [node.id, node]),
  )
  const before = JSON.stringify(nodes)
  const ensured = { nodes: materializeLegacyAutoOpenings(nodes) as Record<string, AnyNode> }
  expect(JSON.stringify(nodes)).toBe(before)
  expect(materializeLegacyAutoOpenings(ensured.nodes)).toBe(ensured.nodes)
  expect(ensured.nodes[slab.id]).toHaveProperty('holes')
  useScene.getState().setScene(nodes, [building.id])
  await new Promise<void>((resolve) => queueMicrotask(resolve))
  const result = useScene.getState().nodes[slab.id] as SlabNode
  const owned = Object.values(useScene.getState().nodes).filter(
    (node) =>
      node.type === 'floor-opening' && (node.ownerId === stair.id || node.ownerId === elevator.id),
  )
  expect(owned.some((node) => node.type === 'floor-opening' && node.ownerId === stair.id)).toBe(
    true,
  )
  expect(owned.some((node) => node.type === 'floor-opening' && node.ownerId === elevator.id)).toBe(
    true,
  )
  expect(result.holes).toHaveLength(2)
  expect((useScene.getState().nodes[segment.id] as StairSegmentNode).height).toBeCloseTo(2.6)
  expect(result.holes).toEqual((ensured.nodes[slab.id] as SlabNode).holes)
  expect(result.holeMetadata.every((entry) => entry.source === 'floor-opening')).toBe(true)
  if (present !== 'none') {
    expect(result.holes[0]).toEqual(savedHole)
    expect(result.holeMetadata?.[0]?.openingId).toBeTruthy()
  }
  const snapshot = JSON.stringify(result)
  const stopStair = initializeStairOpeningSync()
  const stopElevator = initializeElevatorOpeningSync()
  stopOpenings = () => {
    stopStair()
    stopElevator()
  }
  await new Promise<void>((resolve) => queueMicrotask(resolve))
  expect(JSON.stringify(useScene.getState().nodes[slab.id])).toBe(snapshot)
  useScene.getState().setScene(useScene.getState().nodes, [building.id])
  await new Promise<void>((resolve) => queueMicrotask(resolve))
  expect(JSON.stringify(useScene.getState().nodes[slab.id])).toBe(snapshot)
})
