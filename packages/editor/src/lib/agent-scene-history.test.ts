import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  clearSceneHistory,
  LevelNode,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { applyAgentSceneGraphToEditor, applySceneGraphToEditor, type SceneGraph } from './scene'

/**
 * An AI edit is undoable; a load is not.
 *
 * Both used to run the same function, and the failure that caused was silent in
 * the worst way: the user pressed Ctrl+Z after an AI edit, nothing happened,
 * and their own work from before the edit had already been discarded too. There
 * is no error state to notice — an empty history looks exactly like a history
 * with nothing left to undo.
 *
 * These assert the two paths stay different, and that the AI path costs exactly
 * one press.
 */

type RafFn = (cb: (time: number) => void) => number
;(globalThis as unknown as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= (cb) => {
  cb(0)
  return 0
}
;(globalThis as unknown as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??=
  () => {}

const BUILDING_ID = 'building_agent_history' as AnyNodeId
const LEVEL_ID = 'level_agent_history' as AnyNodeId
const WALL_ID = 'wall_agent_history' as AnyNodeId

function sceneWith(wallEnd: [number, number], extra?: Record<string, AnyNode>): SceneGraph {
  const wall = WallNode.parse({ id: WALL_ID, parentId: LEVEL_ID, start: [0, 0], end: wallEnd })
  const level = LevelNode.parse({
    id: LEVEL_ID,
    parentId: BUILDING_ID,
    level: 0,
    children: [WALL_ID],
  })
  const building = BuildingNode.parse({ id: BUILDING_ID, parentId: null, children: [LEVEL_ID] })
  return {
    nodes: { [BUILDING_ID]: building, [LEVEL_ID]: level, [WALL_ID]: wall, ...extra },
    rootNodeIds: [BUILDING_ID],
  }
}

function wallLength(): number {
  const wall = useScene.getState().nodes[WALL_ID] as { end: [number, number] } | undefined
  return wall?.end[0] ?? -1
}

function pastStateCount(): number {
  return useScene.temporal.getState().pastStates.length
}

describe('applying an agent-produced graph', () => {
  beforeEach(() => {
    applySceneGraphToEditor(sceneWith([4, 0]))
    clearSceneHistory()
  })

  test('is undoable, where a load is not', () => {
    // The whole defect. Routing an AI edit through the load path cleared the
    // history it should have been appended to, so the edit could not be undone
    // and everything the user did before it was gone as well.
    applyAgentSceneGraphToEditor(sceneWith([9, 0]))

    expect(wallLength()).toBe(9)
    expect(pastStateCount()).toBe(1)

    useScene.temporal.getState().undo()

    expect(wallLength()).toBe(4)
  })

  test('costs exactly one Ctrl+Z, not one per store write', () => {
    // A second entry is worse than a missing one here: the first press appears
    // to do nothing, so the user presses again and loses an edit they wanted.
    applyAgentSceneGraphToEditor(sceneWith([9, 0]))
    useScene.temporal.getState().undo()

    expect(wallLength()).toBe(4)
    expect(pastStateCount()).toBe(0)
  })

  test('a read-only turn consumes no undo slot, and leaves earlier ones alone', () => {
    // An agent that answered a question without touching anything still
    // publishes a snapshot. Recording it spends a press on a no-op, and the
    // user reads that as undo being broken.
    //
    // The earlier entry is here because `pastStates` being empty is also what a
    // cleared history looks like: without something already on the stack, this
    // passes just as well when the no-op path wipes everything.
    applyAgentSceneGraphToEditor(sceneWith([9, 0]))
    expect(pastStateCount()).toBe(1)

    applyAgentSceneGraphToEditor(sceneWith([9, 0]))

    expect(pastStateCount()).toBe(1)

    useScene.temporal.getState().undo()

    expect(wallLength()).toBe(4)
  })

  test('an empty graph costs one Ctrl+Z, though it is two store writes', () => {
    // The case the collapse is actually for. A populated graph is a single
    // tracked `set`, so tracking alone would look correct; an empty one takes
    // `clearScene` + `setInstalledPlugins`, and two entries mean the first
    // press appears to do nothing.
    applyAgentSceneGraphToEditor({ nodes: {}, rootNodeIds: [] })

    expect(useScene.getState().nodes[BUILDING_ID]).toBeUndefined()
    expect(pastStateCount()).toBe(1)

    useScene.temporal.getState().undo()

    expect(wallLength()).toBe(4)
  })

  test('a load still clears history, so undo cannot step past it', () => {
    // The reason the two paths exist. Undo past a load reaches the previous
    // project — or an empty scene — and wipes what was just opened.
    applyAgentSceneGraphToEditor(sceneWith([9, 0]))
    expect(pastStateCount()).toBe(1)

    applySceneGraphToEditor(sceneWith([12, 0]))

    expect(wallLength()).toBe(12)
    expect(pastStateCount()).toBe(0)
  })

  test('undoing an agent edit restores a node it deleted', () => {
    // The asymmetry worth pinning: an agent removing something is the case a
    // user most wants back, and a graph-level apply has to restore it from the
    // snapshot rather than from a delete op nobody recorded.
    const withWall = sceneWith([4, 0])
    const withoutWall: SceneGraph = {
      nodes: {
        [BUILDING_ID]: withWall.nodes[BUILDING_ID] as AnyNode,
        [LEVEL_ID]: { ...(withWall.nodes[LEVEL_ID] as AnyNode), children: [] } as AnyNode,
      },
      rootNodeIds: [BUILDING_ID],
    }

    applyAgentSceneGraphToEditor(withoutWall)
    expect(useScene.getState().nodes[WALL_ID]).toBeUndefined()

    useScene.temporal.getState().undo()

    expect(useScene.getState().nodes[WALL_ID]).toBeDefined()
    expect(wallLength()).toBe(4)
  })
})
