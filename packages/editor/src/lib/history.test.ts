import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  clearSceneHistory,
  LevelNode,
  useScene,
} from '@pascal-app/core'
import {
  getHistoryCommandState,
  installHistoryCommandDelegate,
  runRedo,
  runUndo,
  subscribeHistoryCommandState,
} from './history'

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
    const undo = mock(() => ({ kind: 'applied', persistence: 'queued' }) as const)
    const redo = mock(() => ({ kind: 'empty' }) as const)
    disposeController = installHistoryCommandDelegate({
      getState: () => ({
        canRedo: false,
        canUndo: true,
        mode: 'collaborative',
        status: 'syncing',
      }),
      redo,
      subscribe: () => () => {},
      undo,
    })

    expect(runUndo()).toEqual({ kind: 'applied', persistence: 'queued' })
    expect(runRedo()).toEqual({ kind: 'empty' })
    expect(getHistoryCommandState()).toEqual({
      canRedo: false,
      canUndo: true,
      mode: 'collaborative',
      status: 'syncing',
    })

    expect(undo).toHaveBeenCalledTimes(1)
    expect(redo).toHaveBeenCalledTimes(1)
    expect(levelNumber()).toBe(1)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  })

  test('falls back to standalone Zundo undo and redo when no controller is installed', () => {
    expect(runUndo()).toEqual({ kind: 'applied', persistence: 'local' })
    expect(levelNumber()).toBe(0)
    expect(useScene.temporal.getState().futureStates).toHaveLength(1)

    expect(runRedo()).toEqual({ kind: 'applied', persistence: 'local' })
    expect(levelNumber()).toBe(1)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  })

  test('an older cleanup cannot uninstall a newer controller', () => {
    const firstUndo = mock(() => {})
    const delegate = (undo: () => void) => ({
      getState: () => ({
        canRedo: false,
        canUndo: true,
        mode: 'collaborative' as const,
        status: 'ready' as const,
      }),
      redo: () => ({ kind: 'empty' as const }),
      subscribe: () => () => {},
      undo: () => {
        undo()
        return { kind: 'applied' as const, persistence: 'queued' as const }
      },
    })
    const stopFirst = installHistoryCommandDelegate(delegate(firstUndo))
    const secondUndo = mock(() => {})
    disposeController = installHistoryCommandDelegate(delegate(secondUndo))

    stopFirst()
    runUndo()

    expect(firstUndo).toHaveBeenCalledTimes(0)
    expect(secondUndo).toHaveBeenCalledTimes(1)
  })

  test('publishes delegate state changes and restores standalone availability on teardown', () => {
    const listeners = new Set<() => void>()
    const observed: string[] = []
    const unsubscribe = subscribeHistoryCommandState(() => {
      observed.push(getHistoryCommandState().mode)
    })
    disposeController = installHistoryCommandDelegate({
      getState: () => ({
        canRedo: false,
        canUndo: true,
        mode: 'collaborative',
        status: 'offline',
      }),
      redo: () => ({ kind: 'empty' }),
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      undo: () => ({ kind: 'applied', persistence: 'queued' }),
    })

    for (const listener of listeners) listener()
    disposeController()
    disposeController = () => {}
    unsubscribe()

    expect(observed).toEqual(['collaborative', 'collaborative', 'standalone'])
  })
})
