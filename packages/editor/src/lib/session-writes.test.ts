import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  applySceneOperationPatch,
  BuildingNode,
  clearSceneHistory,
  LevelNode,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { createSessionWrites } from './session-writes'

// A live session (a floor-plan drag, a height scrub) takes back only what it
// wrote itself: an edit a collaborator lands on the same node mid-drag survives
// the cancel and the commit.

globalThis.requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
globalThis.cancelAnimationFrame ??= () => {}

const level = LevelNode.parse({ id: 'level_writes', parentId: 'building_writes' })
const building = BuildingNode.parse({ id: 'building_writes', children: [level.id] })
const wall = WallNode.parse({ id: 'wall_writes', parentId: level.id, start: [0, 0], end: [4, 0] })
const nodes = () => useScene.getState().nodes as Record<string, AnyNode>
const data = () => JSON.parse(JSON.stringify(nodes()))
const id = wall.id as AnyNodeId

beforeEach(() => {
  useScene.setState({
    nodes: {
      [building.id]: building,
      [level.id]: { ...level, children: [wall.id] },
      [wall.id]: wall,
    },
    rootNodeIds: [building.id],
    dirtyNodes: new Set(),
    collections: {},
    materials: {},
    readOnly: false,
  })
  clearSceneHistory()
})

/** A collaborator's change, applied outside the session like a remote operation. */
const remote = (patch: Partial<WallNode>) =>
  useScene.setState({ nodes: { ...nodes(), [id]: { ...nodes()[id]!, ...patch } as AnyNode } })

describe('session writes', () => {
  test('cancel takes back the session’s fields and keeps a collaborator’s edit', () => {
    const writes = createSessionWrites()
    writes.record(() => useScene.getState().updateNodes([{ id, data: { end: [6, 0] } }]))
    remote({ name: 'Kitchen wall' })
    writes.record(() => useScene.getState().updateNodes([{ id, data: { end: [7, 0] } }]))
    writes.revert()
    expect(nodes()[id]).toMatchObject({ end: [4, 0], name: 'Kitchen wall' })
  })

  test('commit re-applies only the session’s fields', () => {
    const writes = createSessionWrites()
    writes.record(() => useScene.getState().updateNodes([{ id, data: { end: [6, 0] } }]))
    remote({ name: 'Kitchen wall' })
    const changes = writes.changes()
    expect(changes.update).toEqual([{ id, data: { end: [6, 0] } }])
    writes.revert()
    useScene.getState().applyNodeChanges(changes)
    expect(nodes()[id]).toMatchObject({ end: [6, 0], name: 'Kitchen wall' })
  })

  test('a session that previews through overrides writes nothing back', () => {
    const writes = createSessionWrites()
    writes.record(() => {})
    remote({ name: 'Kitchen wall' })
    const before = data()
    writes.revert()
    expect(data()).toEqual(before)
    expect(writes.changes()).toEqual({ create: [], update: [], delete: [] })
  })

  test('nodes the session created go, nodes it deleted come back, outside history', () => {
    const writes = createSessionWrites()
    const extra = WallNode.parse({
      id: 'wall_extra',
      parentId: level.id,
      start: [4, 0],
      end: [4, 4],
    })
    const before = data()
    writes.record(() => {
      useScene.getState().createNode(extra, level.id as AnyNodeId)
      useScene.getState().deleteNode(id)
    })
    const past = useScene.temporal.getState().pastStates.length
    writes.revert()
    expect(data()).toEqual(before)
    expect(useScene.temporal.getState().pastStates).toHaveLength(past)
  })

  test('a watched node: another local writer’s draft goes back, a collaborator’s change stays', () => {
    const writes = createSessionWrites()
    writes.watch([id])
    // The 3D tool mounted beside the plan drafts the same node…
    useScene.getState().updateNodes([{ id, data: { metadata: { isTransient: true } } }])
    // …while a collaborator's rename arrives from the host.
    applySceneOperationPatch({
      materialChanges: [],
      nodeUpdates: [{ id, data: { name: 'Kitchen wall' }, removeFields: [] }],
      nodeCreates: [],
      nodeDeletes: [],
    })
    writes.revert()
    expect(nodes()[id]).toMatchObject({ metadata: {}, name: 'Kitchen wall' })
    // The revert ended the watch: later writes are no longer the session's.
    useScene.getState().updateNodes([{ id, data: { end: [5, 0] } }])
    writes.revert()
    expect(nodes()[id]).toMatchObject({ end: [5, 0] })
  })
})
