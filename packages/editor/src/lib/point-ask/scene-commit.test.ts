import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  clearSceneHistory,
  ItemNode,
  LevelNode,
  type SceneCommit,
  type SceneSnapshot,
  subscribeSceneCommits,
  useScene,
  ZoneNode,
} from '@pascal-app/core'
import { markHistory, stepsSince } from './history-marks'
import { createPin, type PinModel, reducePin } from './pin-machine'
import { pointCommitEvent } from './scene-commit'

function fixture() {
  const building = BuildingNode.parse({})
  const level = LevelNode.parse({ parentId: building.id })
  const room = ZoneNode.parse({
    parentId: level.id,
    name: 'Kitchen',
    polygon: [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ],
  })
  const item = (position: [number, number, number]) =>
    ItemNode.parse({
      parentId: level.id,
      position,
      asset: {
        id: 'fixture',
        name: 'Fridge',
        category: 'furniture',
        thumbnail: '',
        src: 'https://example.invalid/fridge.glb',
        dimensions: [1, 1, 1],
      },
    })
  const fridge = item([2, 0, 2])
  const outside = item([8, 0, 2])
  building.children = [level.id]
  level.children = [room.id, fridge.id, outside.id]
  const snapshot: SceneSnapshot = {
    nodes: {
      [building.id]: building,
      [level.id]: level,
      [room.id]: room,
      [fridge.id]: fridge,
      [outside.id]: outside,
    },
    rootNodeIds: [building.id],
    collections: {},
    materials: {},
    installedPlugins: [],
    hasExplicitPluginInstallState: false,
  }
  return { snapshot, room, fridge, outside }
}

const beginPin = (target: string): PinModel =>
  reducePin(createPin({ askId: 'ask_scope', text: 'Move the fridge', targetIds: [target] }), {
    type: 'status',
    status: { askId: 'ask_scope', status: 'working' },
  })
const finishPin = (pin: PinModel, wroteScene = true) =>
  reducePin(pin, {
    type: 'status',
    status: { askId: pin.askId, status: 'ended', outcome: 'completed', asked: false, wroteScene },
  })

const original = useScene.getState()
const originalRaf = globalThis.requestAnimationFrame
const originalCancelRaf = globalThis.cancelAnimationFrame
let unsubscribe = () => {}
beforeEach(() => {
  globalThis.requestAnimationFrame = (callback) => {
    callback(0)
    return 0
  }
  globalThis.cancelAnimationFrame = () => {}
})
afterEach(() => {
  unsubscribe()
  unsubscribe = () => {}
  useScene.setState(original)
  clearSceneHistory()
  if (originalRaf) globalThis.requestAnimationFrame = originalRaf
  else Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
  if (originalCancelRaf) globalThis.cancelAnimationFrame = originalCancelRaf
  else Reflect.deleteProperty(globalThis, 'cancelAnimationFrame')
})

function watch(snapshot: SceneSnapshot, target: string) {
  useScene.setState({ ...snapshot, dirtyNodes: new Set<AnyNodeId>(), readOnly: false })
  clearSceneHistory()
  let pin = beginPin(target)
  const commits: SceneCommit[] = []
  unsubscribe = subscribeSceneCommits((commit) => {
    commits.push(commit)
    pin = reducePin(pin, pointCommitEvent(commit, [target]))
  })
  return { commits, pin: () => pin, mark: markHistory(useScene.temporal.getState().pastStates) }
}

describe('Point commits through the real scene authority and history', () => {
  test('a room sibling move lands, finishes done and the turn history restores it', () => {
    const f = fixture()
    const observed = watch(f.snapshot, f.room.id)

    useScene.getState().updateNode(f.fridge.id, { position: [3, 0, 2] })
    const pin = finishPin(observed.pin())

    expect(observed.commits).toHaveLength(1)
    expect(pin.state).toBe('done')
    expect(pin.changedTargetIds).toContain(f.fridge.id)
    expect(pin.landed).toBe(1)
    const steps = stepsSince(useScene.temporal.getState().pastStates, observed.mark)
    expect(steps).toBe(1)
    useScene.temporal.getState().undo(steps!)
    expect((useScene.getState().nodes[f.fridge.id] as typeof f.fridge).position).toEqual([2, 0, 2])
  })

  test('an outside-only durable move still finishes done and has a real Undo step', () => {
    const f = fixture()
    const observed = watch(f.snapshot, f.room.id)

    useScene.getState().updateNode(f.outside.id, { position: [9, 0, 2] })
    const pin = finishPin(observed.pin(), false)

    expect(pin.state).toBe('done')
    expect(pin.landed).toBe(0)
    expect(pin.changedTargetIds).toEqual([])
    expect(pin.alsoChangedIds).toContain(f.outside.id)
    useScene.temporal
      .getState()
      .undo(stepsSince(useScene.temporal.getState().pastStates, observed.mark)!)
    expect((useScene.getState().nodes[f.outside.id] as typeof f.outside).position).toEqual([
      8, 0, 2,
    ])
  })

  test('a collection-only write is done and reversible without a node landing', () => {
    const f = fixture()
    const observed = watch(f.snapshot, f.room.id)

    const collection = useScene.getState().createCollection('Kitchen furniture')
    const pin = finishPin(observed.pin())

    expect(observed.commits).toHaveLength(1)
    expect(pin.state).toBe('done')
    expect(pin.landed).toBe(0)
    expect(pin.changedTargetIds).toEqual([])
    expect(pin.alsoChangedIds).toEqual([])
    useScene.temporal
      .getState()
      .undo(stepsSince(useScene.temporal.getState().pastStates, observed.mark)!)
    expect(useScene.getState().collections[collection]).toBeUndefined()
  })

  test('a semantically unchanged writing call stays no-change with no history step', () => {
    const f = fixture()
    const observed = watch(f.snapshot, f.room.id)

    useScene.getState().updateNode(f.fridge.id, { position: [2, 0, 2] })

    expect(observed.commits).toEqual([])
    expect(finishPin(observed.pin()).state).toBe('no-change')
    expect(stepsSince(useScene.temporal.getState().pastStates, observed.mark)).toBe(0)
  })
})

describe('optional node metadata on a semantic commit', () => {
  test('derives creation and deletion IDs and classifies both snapshots', () => {
    const f = fixture()
    const created = ItemNode.parse({ ...f.fridge, id: 'item_created' })
    const nodes: Record<AnyNodeId, AnyNode> = { ...f.snapshot.nodes, [created.id]: created }
    delete nodes[f.fridge.id]
    const event = pointCommitEvent(
      {
        origin: 'local',
        before: f.snapshot,
        current: { ...f.snapshot, nodes },
      },
      [f.room.id],
    )

    expect(new Set(event.changedNodeIds)).toEqual(new Set([f.fridge.id, created.id]))
    expect(event.isInTargets?.(f.fridge.id)).toBe(true)
    expect(event.isInTargets?.(created.id)).toBe(true)
  })

  test('derives exact changed IDs when node IDs are absent or empty', () => {
    const f = fixture()
    const current: SceneSnapshot = {
      ...f.snapshot,
      nodes: { ...f.snapshot.nodes, [f.fridge.id]: { ...f.fridge, position: [8, 0, 2] } },
    }
    for (const changedNodeIds of [undefined, new Set<AnyNodeId>()]) {
      const event = pointCommitEvent(
        { origin: 'local', before: f.snapshot, current, changedNodeIds },
        [f.room.id],
      )
      expect(event.changedNodeIds).toEqual([f.fridge.id])
      expect(event.isInTargets?.(f.fridge.id)).toBe(true)
    }
  })

  test('does not count semantically equal cloned nodes or reordered keys as changed', () => {
    const f = fixture()
    const nodes: Record<AnyNodeId, AnyNode> = Object.fromEntries(
      Object.entries(f.snapshot.nodes).map(([id, node]) => [
        id,
        Object.fromEntries(Object.entries(structuredClone(node)).reverse()),
      ]),
    ) as Record<AnyNodeId, AnyNode>
    const current = { ...f.snapshot, nodes, installedPlugins: ['test:plugin'] }
    const event = pointCommitEvent({ origin: 'local', before: f.snapshot, current }, [f.room.id])

    expect(event.changedNodeIds).toEqual([])
    expect(finishPin(reducePin(beginPin(f.room.id), event)).state).toBe('done')
  })
})
