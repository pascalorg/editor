import { afterEach, expect, test } from 'bun:test'
import { createZone, setZoneIntent, structureChangeBatch } from '../commands/structure'
import type { StructurePlan } from '../commands/structure/types'
import { type AnyNode, BuildingNode, DoorNode, LevelNode, type WallNode } from '../schema'
import useScene, { clearSceneHistory } from '../store/use-scene'
import { initSpaceDetectionSync } from './space-detection'
import { createLevelStructurePreview } from './structure-kernel'

// A drag's live floors are the kernel run on the moved walls. They must be the
// floors its release commits, and only those: a room raised through a doorway
// (its plate steps down through the opening) next to the moved room keeps its
// stored shape while the other room's wall moves.

globalThis.requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
globalThis.cancelAnimationFrame ??= () => {}

const LEVEL = 'level_preview'
let stop = () => {}
afterEach(() => {
  stop()
  clearSceneHistory()
})

const nodes = () => useScene.getState().nodes as Record<string, AnyNode>
const apply = (plan: StructurePlan) =>
  useScene.getState().applyNodeChanges(structureChangeBatch(plan.changes))

function seed() {
  const level = LevelNode.parse({ id: LEVEL, parentId: 'building_preview' })
  const building = BuildingNode.parse({ id: 'building_preview', children: [level.id] })
  useScene.setState({
    nodes: { [level.id]: level, [building.id]: building },
    rootNodeIds: [building.id],
    dirtyNodes: new Set(),
    collections: {},
    materials: {},
    readOnly: false,
  })
  useScene.temporal.getState().resume()
  stop = initSpaceDetectionSync(useScene, { getState: () => ({ spaces: {}, setSpaces: () => {} }) })
  let i = 0
  const mintId = (kind: string) => `${kind}_preview${++i}`
  const room = (polygon: [number, number][]) => {
    const plan = createZone(nodes(), { levelId: LEVEL, polygon, enclose: true, mintId })
    apply(plan)
    return plan.zoneId
  }
  room([
    [0, 0],
    [6, 0],
    [6, 4],
    [0, 4],
  ])
  const raised = room([
    [-4, 0],
    [0, 0],
    [0, 4],
    [-4, 4],
  ])
  const shared = Object.values(nodes()).find(
    (n): n is WallNode => n.type === 'wall' && n.start[0] === 0 && n.end[0] === 0,
  )!
  const door = DoorNode.parse({ parentId: shared.id, wallId: shared.id, position: [2, 0, 0] })
  useScene.getState().applyNodeChanges({ create: [{ node: door, parentId: shared.id }] })
  apply(setZoneIntent(nodes(), { zoneId: raised, patch: { floor: { elevation: 0.45 } } }))
  clearSceneHistory()
  return raised
}

/** The east wall at x = 6 moved to x = 7, its neighbours' corners following. */
function movedWalls(): WallNode[] {
  const move = ([x, z]: [number, number]): [number, number] => [x === 6 ? 7 : x, z]
  return Object.values(nodes()).flatMap((n) =>
    n.type === 'wall' && n.parentId === LEVEL
      ? [{ ...n, start: move(n.start), end: move(n.end) }]
      : [],
  )
}

test('a live wall move previews exactly the floors its release commits, and no others', () => {
  const raised = seed()
  const raisedPlate = Object.values(nodes()).find(
    (n) => n.type === 'slab' && n.plateRole === 'platform' && n.zoneIds?.includes(raised),
  )!
  // The doorway step is part of the raised plate's stored outline.
  expect((raisedPlate as { polygon: unknown[] }).polygon.length).toBeGreaterThan(4)

  const before = nodes()
  const preview = createLevelStructurePreview(LEVEL, before)
  // Nothing moved yet: nothing to draw from a preview.
  expect(preview(Object.values(before).filter((n): n is WallNode => n.type === 'wall'))).toEqual([])
  const walls = movedWalls()
  const patches = preview(walls)
  expect(patches.map((patch) => patch.id)).not.toContain(raisedPlate.id)
  expect(patches.length).toBeGreaterThan(0)

  useScene.getState().updateNodes(walls.map(({ id, start, end }) => ({ id, data: { start, end } })))
  const after = nodes()
  const json = (value: unknown) => JSON.stringify(value ?? null)
  for (const patch of patches) {
    if (patch.op !== 'update') continue
    for (const [key, value] of Object.entries(patch.data))
      expect(`${patch.id}.${key}=${json(value)}`).toBe(
        `${patch.id}.${key}=${json((after[patch.id] as Record<string, unknown>)[key])}`,
      )
  }
  const reshaped = Object.keys(after).filter(
    (id) =>
      ['slab', 'ceiling', 'zone'].includes(after[id]!.type) &&
      before[id] &&
      json((before[id] as { polygon?: unknown }).polygon) !==
        json((after[id] as { polygon?: unknown }).polygon),
  )
  expect(reshaped.sort()).toEqual(
    patches
      .filter((patch) => patch.op === 'update' && 'polygon' in patch.data)
      .map((patch) => patch.id)
      .sort(),
  )
})
