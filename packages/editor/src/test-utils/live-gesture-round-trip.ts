import { expect } from 'bun:test'
import {
  type AnyNodeId,
  acquireSceneHistoryPause,
  BuildingNode,
  createZone,
  DoorNode,
  generateId,
  getSceneHistoryPauseDepth,
  initSpaceDetectionSync,
  LevelNode,
  useLiveNodeOverrides,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { commitRoomElevation } from '../lib/room-handle-drag'
import { applyRoomPlan } from '../lib/room-structure-commands'

/**
 * The harness scene, reconciled live: a 6 × 4 m room (`zoneId`, its east wall
 * at x = 6 the one gestures move) and, west of it through a door, a room raised
 * 0.45 m (`raisedZoneId`) whose floor steps down through the doorway. Returns
 * the reconciler's stop.
 */
export function seedRoundTripScene(buildingId: string, levelId: string) {
  const building = BuildingNode.parse({ id: buildingId, children: [levelId] })
  const level = LevelNode.parse({ id: levelId, parentId: building.id })
  useScene.setState({
    nodes: { [building.id]: building, [level.id]: level },
    rootNodeIds: [building.id],
    dirtyNodes: new Set(),
    materials: {},
    collections: {},
    readOnly: false,
  })
  const stop = initSpaceDetectionSync(useScene, {
    getState: () => ({ spaces: {}, setSpaces: () => {} }),
  })
  const room = (polygon: [number, number][]) => {
    const plan = createZone(useScene.getState().nodes, {
      levelId,
      polygon,
      enclose: true,
      mintId: generateId,
    })
    applyRoomPlan(plan)
    return plan.zoneId
  }
  const zoneId = room([
    [0, 0],
    [6, 0],
    [6, 4],
    [0, 4],
  ])
  const raisedZoneId = room([
    [-4, 0],
    [0, 0],
    [0, 4],
    [-4, 4],
  ])
  const shared = Object.values(useScene.getState().nodes).find(
    (n): n is WallNode => n.type === 'wall' && n.start[0] === 0 && n.end[0] === 0,
  )!
  const door = DoorNode.parse({ parentId: shared.id, wallId: shared.id, position: [2, 0, 0] })
  useScene.getState().applyNodeChanges({ create: [{ node: door, parentId: shared.id }] })
  commitRoomElevation(raisedZoneId, 0.45)
  return { stop, zoneId, raisedZoneId }
}

/**
 * A live gesture as the harness drives it: `start` begins it and moves it far
 * enough that its preview reshapes the building (derived plates, ceilings,
 * zones included); then either `cancel` or `commit` ends it.
 */
export type LiveGesture = {
  start: () => unknown
  cancel: () => unknown
  commit: () => unknown
  /** Whether the preview ran (an override, a ghost…), checked after `start`. */
  previewed?: () => boolean
}

/** Every node, as plain data (JSON also folds -0 into 0, as the transport does). */
export const sceneData = (): Record<string, unknown> =>
  JSON.parse(JSON.stringify(useScene.getState().nodes))

function expectReleased() {
  expect([...useLiveNodeOverrides.getState().overrides.keys()]).toEqual([])
  expect(getSceneHistoryPauseDepth()).toBe(0)
  expect(useScene.temporal.getState().isTracking).toBe(true)
}

/**
 * start → move → cancel leaves every node deep-equal to before (derived ones
 * included), no history entry, history tracking again, no override left, and
 * every node the preview drew from an override marked to rebuild — else its
 * mesh stays at the preview.
 */
export async function expectCancelRestores(gesture: LiveGesture) {
  const before = sceneData()
  const past = useScene.temporal.getState().pastStates.length
  await gesture.start()
  if (gesture.previewed) expect(gesture.previewed()).toBe(true)
  const drawnFromPreview = [...useLiveNodeOverrides.getState().overrides.keys()] as AnyNodeId[]
  useScene.getState().dirtyNodes.clear()
  await gesture.cancel()
  expect(sceneData()).toEqual(before)
  expect(useScene.temporal.getState().pastStates.length).toBe(past)
  expectReleased()
  const { nodes, dirtyNodes, markDirty } = useScene.getState()
  const stale = drawnFromPreview.filter((id) => {
    if (!nodes[id] || dirtyNodes.has(id)) return false
    // A kind that opts out of dirty tracking redraws from the override store itself.
    markDirty(id)
    return dirtyNodes.has(id)
  })
  expect(stale).toEqual([])
}

/**
 * start → move → commit writes one undo step that reshapes derived nodes of
 * `derivedTypes` too, releases everything, and one undo brings every node back.
 */
export async function expectCommitIsOneUndoStep(
  gesture: LiveGesture,
  derivedTypes: readonly string[] = ['slab', 'zone'],
) {
  const before = sceneData()
  const past = useScene.temporal.getState().pastStates.length
  await gesture.start()
  await gesture.commit()
  const after = sceneData()
  expect(useScene.temporal.getState().pastStates.length).toBe(past + 1)
  expectReleased()
  const changedTypes = new Set(
    Object.keys({ ...before, ...after })
      .filter((id) => JSON.stringify(before[id]) !== JSON.stringify(after[id]))
      .map((id) => ((after[id] ?? before[id]) as { type: string }).type),
  )
  for (const type of derivedTypes) expect([...changedTypes]).toContain(type)
  useScene.temporal.getState().undo()
  expect(sceneData()).toEqual(before)
}

/**
 * During the drag only the surfaces (plates, ceilings, zones) the release
 * reshapes are drawn from a preview, and each is drawn exactly as the release
 * leaves it — the floors it never touches keep their stored shape.
 */
export async function expectPreviewMatchesCommit(
  gesture: LiveGesture,
  surfaceTypes: readonly string[] = ['slab', 'ceiling', 'zone'],
) {
  const before = sceneData() as Record<string, Record<string, unknown>>
  await gesture.start()
  const previews = new Map(
    [...useLiveNodeOverrides.getState().overrides].filter(([id]) =>
      surfaceTypes.includes(before[id]?.type as string),
    ),
  )
  await gesture.commit()
  const after = sceneData() as Record<string, Record<string, unknown>>
  const json = (value: unknown) => JSON.stringify(value ?? null)
  const untouched = [...previews.keys()].filter(
    (id) => after[id] && json(before[id]) === json(after[id]),
  )
  expect(untouched).toEqual([])
  const drawn: Record<string, Record<string, string>> = {}
  const committed: Record<string, Record<string, string>> = {}
  for (const [id, values] of previews) {
    if (!after[id]) continue
    drawn[id] = {}
    committed[id] = {}
    for (const key of Object.keys(values)) {
      drawn[id][key] = json(values[key])
      committed[id][key] = json(after[id][key])
    }
  }
  expect(drawn).toEqual(committed)
  const reshapedUnseen = Object.keys(after).filter(
    (id) =>
      before[id] &&
      surfaceTypes.includes(after[id]!.type as string) &&
      (json(before[id].polygon) !== json(after[id]!.polygon) ||
        json(before[id].holes) !== json(after[id]!.holes)) &&
      !previews.get(id)?.polygon,
  )
  expect(reshapedUnseen).toEqual([])
}

/**
 * A collaborator's edit landing mid-gesture (here: a field the gesture never
 * writes) survives both the cancel and the commit. `target` names the node,
 * read once the gesture has started.
 */
export async function expectRemoteEditSurvives(
  gesture: () => LiveGesture,
  target: () => AnyNodeId,
  patch: Record<string, unknown> = { name: 'Edited by a collaborator' },
) {
  const remote = (id: AnyNodeId) => {
    const nodes = useScene.getState().nodes
    const release = acquireSceneHistoryPause(useScene)
    try {
      useScene.setState({ nodes: { ...nodes, [id]: { ...nodes[id]!, ...patch } } })
    } finally {
      release()
    }
  }
  for (const end of ['cancel', 'commit'] as const) {
    const run = gesture()
    const before = sceneData() as Record<string, Record<string, unknown>>
    await run.start()
    const id = target()
    remote(id)
    await run[end]()
    const after = sceneData() as Record<string, Record<string, unknown>>
    expect({ end, ...pick(after[id], patch) }).toEqual({ end, ...patch })
    if (end === 'cancel') expect(after).toEqual({ ...before, [id]: { ...before[id], ...patch } })
  }
}

const pick = (node: Record<string, unknown> | undefined, patch: Record<string, unknown>) =>
  Object.fromEntries(Object.keys(patch).map((key) => [key, node?.[key]]))
