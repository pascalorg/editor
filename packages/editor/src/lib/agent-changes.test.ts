import { beforeEach, describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { BuildingNode, LevelNode, SiteNode, useScene, WallNode } from '@pascal-app/core'
import useAgentActivity from '../store/use-agent-activity'
import {
  applyAgentSceneGraph,
  applyPendingAgentChange,
  currentSceneGraph,
  receiveAgentSceneChange,
  rejectPendingAgentChange,
} from './agent-changes'
import type { SceneGraph } from './scene'

function baseScene() {
  const site = SiteNode.parse({})
  const building = BuildingNode.parse({ parentId: site.id })
  const level = LevelNode.parse({ parentId: building.id, level: 0, children: [] })
  const nodes: Record<AnyNodeId, AnyNode> = {
    [site.id]: { ...site, children: [building.id] },
    [building.id]: { ...building, children: [level.id] },
    [level.id]: level,
  }
  return { nodes, rootNodeIds: [site.id] as AnyNodeId[], levelId: level.id }
}

/** The base scene plus `count` walls — stands in for whatever an agent tool built. */
function graphWithWalls(count: number): SceneGraph {
  const { nodes, rootNodeIds, levelId } = baseScene()
  const level = nodes[levelId] as { children: AnyNodeId[] }
  for (let i = 0; i < count; i++) {
    const wall = WallNode.parse({ parentId: levelId, start: [0, i], end: [4, i] })
    nodes[wall.id] = wall as AnyNode
    level.children = [...level.children, wall.id]
  }
  return { nodes, rootNodeIds } as unknown as SceneGraph
}

const nodeCount = () => Object.keys(useScene.getState().nodes).length
const pastCount = () => useScene.temporal.getState().pastStates.length

beforeEach(() => {
  const { nodes, rootNodeIds } = baseScene()
  useScene.getState().setScene(nodes, rootNodeIds)
  useScene.temporal.getState().clear()
  useAgentActivity.getState().clear()
  useAgentActivity.getState().setAutoApply(false)
})

describe('applyAgentSceneGraph', () => {
  // The defect this exists to fix: the live-sync path used
  // `applySceneGraphToEditor`, which ends in `clearSceneHistory()`. An agent
  // edit therefore threw away everything the user had done beforehand.
  test('keeps the history the user built before the agent touched the scene', () => {
    const level = Object.values(useScene.getState().nodes).find((n) => n.type === 'level')!
    const wall = WallNode.parse({ parentId: level.id, start: [0, 0], end: [1, 0] })
    useScene.getState().createNode(wall as AnyNode, level.id)
    const userSteps = pastCount()
    expect(userSteps).toBeGreaterThan(0)

    applyAgentSceneGraph(graphWithWalls(3))

    expect(pastCount()).toBe(userSteps + 1)
  })

  test('a whole agent operation collapses into exactly one undo step', () => {
    applyAgentSceneGraph(graphWithWalls(5))
    expect(nodeCount()).toBe(8) // site + building + level + 5 walls

    useScene.temporal.getState().undo()

    expect(nodeCount()).toBe(3)
  })
})

describe('receiveAgentSceneChange', () => {
  const change = (eventId: number, walls: number, kind = 'create_wall') => ({
    eventId,
    kind,
    version: eventId,
    graph: graphWithWalls(walls),
  })

  test('holds the change and leaves the scene alone when review is on', () => {
    const applied = receiveAgentSceneChange(change(1, 4))

    expect(applied).toBe(false)
    expect(nodeCount()).toBe(3)
    expect(useAgentActivity.getState().pending?.entry.kind).toBe('create_wall')
    expect(useAgentActivity.getState().entries[0]?.status).toBe('pending')
  })

  test('applies immediately when the user opted into auto-apply', () => {
    useAgentActivity.getState().setAutoApply(true)
    const applied = receiveAgentSceneChange(change(1, 4))

    expect(applied).toBe(true)
    expect(nodeCount()).toBe(7)
    expect(useAgentActivity.getState().pending).toBeNull()
    expect(useAgentActivity.getState().entries[0]?.status).toBe('applied')
  })

  test('records the tool name and the node delta for the feed', () => {
    receiveAgentSceneChange(change(1, 4, 'furnish_room'))
    const entry = useAgentActivity.getState().entries[0]

    expect(entry?.kind).toBe('furnish_room')
    expect(entry?.nodesBefore).toBe(3)
    expect(entry?.nodesAfter).toBe(7)
  })

  test('ignores a redelivered event id rather than double-listing it', () => {
    receiveAgentSceneChange(change(1, 4))
    receiveAgentSceneChange(change(1, 4))

    expect(useAgentActivity.getState().entries).toHaveLength(1)
  })

  // A second proposal supersedes the first — the agent moved on, and the older
  // graph no longer matches what the server holds. Rejecting must still land on
  // the last state the *user* approved, not on the superseded proposal.
  test('a newer proposal supersedes the held one but keeps the original baseline', () => {
    receiveAgentSceneChange(change(1, 4))
    receiveAgentSceneChange(change(2, 9))

    const state = useAgentActivity.getState()
    expect(state.pending?.entry.id).toBe(2)
    expect(state.entries.find((e) => e.id === 1)?.status).toBe('rejected')
    expect(Object.keys(state.pending?.previousGraph.nodes ?? {})).toHaveLength(3)
  })
})

describe('deciding on a held change', () => {
  test('applying lands the agent graph and clears the gate', () => {
    receiveAgentSceneChange({
      eventId: 1,
      kind: 'create_wall',
      version: 1,
      graph: graphWithWalls(4),
    })
    applyPendingAgentChange()

    expect(nodeCount()).toBe(7)
    expect(useAgentActivity.getState().pending).toBeNull()
    expect(useAgentActivity.getState().entries[0]?.status).toBe('applied')
  })

  test('rejecting restores exactly what the editor held before', () => {
    const before = Object.keys(currentSceneGraph().nodes).length
    receiveAgentSceneChange({
      eventId: 1,
      kind: 'create_wall',
      version: 1,
      graph: graphWithWalls(4),
    })
    rejectPendingAgentChange()

    expect(nodeCount()).toBe(before)
    expect(useAgentActivity.getState().entries[0]?.status).toBe('rejected')
  })

  test('a rejection is itself one undo step, so it can be taken back', () => {
    useAgentActivity.getState().setAutoApply(true)
    receiveAgentSceneChange({
      eventId: 1,
      kind: 'create_wall',
      version: 1,
      graph: graphWithWalls(4),
    })
    expect(nodeCount()).toBe(7)

    useScene.temporal.getState().undo()
    expect(nodeCount()).toBe(3)
  })
})
