import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  clearSceneHistory,
  LevelNode,
  useScene,
} from '@pascal-app/core'
import { installHistoryCommandDelegate, runRedo, runUndo } from './history'

type RafFn = (cb: (time: number) => void) => number
;(globalThis as unknown as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= (cb) => {
  cb(0)
  return 0
}
;(globalThis as unknown as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??=
  () => {}

const BUILDING_ID = 'building_history_controller' as AnyNodeId
const LEVEL_ID = 'level_history_controller' as AnyNodeId
let disposeController = () => {}

function levelNumber(): number {
  return (useScene.getState().nodes[LEVEL_ID] as { level: number }).level
}

describe('editor history controller', () => {
  beforeEach(() => {
    disposeController()
    disposeController = () => {}
    const level = LevelNode.parse({
      id: LEVEL_ID,
      parentId: BUILDING_ID,
      children: [],
      level: 0,
    })
    const building = BuildingNode.parse({
      id: BUILDING_ID,
      parentId: null,
      children: [LEVEL_ID],
    })
    useScene.setState({
      nodes: { [BUILDING_ID]: building, [LEVEL_ID]: level },
      rootNodeIds: [BUILDING_ID],
      dirtyNodes: new Set<AnyNodeId>(),
      collections: {},
      materials: {},
      readOnly: false,
    } as never)
    clearSceneHistory()
    useScene.getState().updateNode(LEVEL_ID, { level: 1 } as Partial<AnyNode>)
  })

  afterEach(() => {
    disposeController()
    disposeController = () => {}
  })

  test('delegates undo and redo while a host delegate is installed', () => {
    const undo = mock(() => {})
    const redo = mock(() => {})
    disposeController = installHistoryCommandDelegate({ undo, redo })

    runUndo()
    runRedo()

    expect(undo).toHaveBeenCalledTimes(1)
    expect(redo).toHaveBeenCalledTimes(1)
    expect(levelNumber()).toBe(1)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  })

  test('falls back to standalone Zundo undo and redo when no controller is installed', () => {
    runUndo()
    expect(levelNumber()).toBe(0)
    expect(useScene.temporal.getState().futureStates).toHaveLength(1)

    runRedo()
    expect(levelNumber()).toBe(1)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  })

  test('an older cleanup cannot uninstall a newer controller', () => {
    const firstUndo = mock(() => {})
    const stopFirst = installHistoryCommandDelegate({ undo: firstUndo, redo: () => {} })
    const secondUndo = mock(() => {})
    disposeController = installHistoryCommandDelegate({ undo: secondUndo, redo: () => {} })

    stopFirst()
    runUndo()

    expect(firstUndo).toHaveBeenCalledTimes(0)
    expect(secondUndo).toHaveBeenCalledTimes(1)
  })
})
