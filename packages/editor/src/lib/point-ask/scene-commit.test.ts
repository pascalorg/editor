import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  applyScenePatch,
  applySceneSnapshot,
  BuildingNode,
  clearSceneHistory,
  ItemNode,
  LevelNode,
  type SceneCommit,
  SceneMaterial,
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
const finishPin = (
  pin: PinModel,
  wroteScene = true,
  outcome: 'completed' | 'cancelled' | 'errored' = 'completed',
) =>
  reducePin(pin, {
    type: 'status',
    status: { askId: pin.askId, status: 'ended', outcome, asked: false, wroteScene },
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
  const events: ReturnType<typeof pointCommitEvent>[] = []
  unsubscribe = subscribeSceneCommits((commit) => {
    commits.push(commit)
    const event = pointCommitEvent(commit, [target])
    events.push(event)
    if (event) pin = reducePin(pin, event)
  })
  return {
    commits,
    events,
    pin: () => pin,
    mark: markHistory(useScene.temporal.getState().pastStates),
  }
}

describe('Point commits through the real scene authority and history', () => {
  // A read-only ask is not a read-only scene: foreign edits really land, but belong
  // to neither this turn's local-write flag nor its Undo history.
  for (const origin of ['host', 'load'] as const) {
    test(`${origin} writes during a read-only ask do not claim a local edit or Undo`, () => {
      const f = fixture()
      const observed = watch(f.snapshot, f.room.id)
      const working = observed.pin()
      const applied =
        origin === 'host'
          ? applyScenePatch({
              materialChanges: [],
              nodeUpdates: [{ id: f.fridge.id, data: { position: [3, 0, 2] }, removeFields: [] }],
            })
          : applySceneSnapshot(
              {
                ...f.snapshot,
                nodes: {
                  ...f.snapshot.nodes,
                  [f.fridge.id]: { ...f.fridge, position: [3, 0, 2] },
                },
              },
              { origin: 'load' },
            )

      expect(applied).toBe(true)
      expect((useScene.getState().nodes[f.fridge.id] as typeof f.fridge).position).toEqual([
        3, 0, 2,
      ])
      expect(observed.commits.map((commit) => commit.origin)).toEqual([origin])
      expect(observed.events).toEqual([null])
      expect(observed.pin()).toBe(working)
      expect(observed.pin().state).toBe('working')
      expect(observed.pin().committed).toBe(false)
      expect(observed.pin().landed).toBe(0)
      expect(observed.pin().changedTargetIds).toEqual([])
      expect(observed.pin().alsoChangedIds).toEqual([])
      expect(finishPin(observed.pin(), false).state).toBe('no-change')
      expect(finishPin(observed.pin(), false, 'cancelled').state).toBe('no-change')
      expect(finishPin(observed.pin(), false, 'errored').state).toBe('error')
      expect(stepsSince(useScene.temporal.getState().pastStates, observed.mark)).toBe(0)
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
      expect(useScene.temporal.getState().futureStates).toHaveLength(0)
    })
  }

  test('ignoring a host write does not suppress the next local write or undo the foreign edit', () => {
    const f = fixture()
    const observed = watch(f.snapshot, f.room.id)
    expect(
      applyScenePatch({
        materialChanges: [],
        nodeUpdates: [{ id: f.outside.id, data: { position: [9, 0, 2] }, removeFields: [] }],
      }),
    ).toBe(true)
    useScene.getState().updateNode(f.fridge.id, { position: [3, 0, 2] })

    const pin = finishPin(observed.pin(), false)
    expect(observed.commits.map((commit) => commit.origin)).toEqual(['host', 'local'])
    expect(observed.events[0]).toBeNull()
    expect(pin.state).toBe('done')
    expect(pin.committed).toBe(true)
    expect(pin.landed).toBe(1)
    expect(pin.changedTargetIds).toEqual([f.fridge.id])
    expect(pin.alsoChangedIds).toEqual([])
    const steps = stepsSince(useScene.temporal.getState().pastStates, observed.mark)
    expect(steps).toBe(1)
    useScene.temporal.getState().undo(steps!)
    expect((useScene.getState().nodes[f.fridge.id] as typeof f.fridge).position).toEqual([2, 0, 2])
    expect((useScene.getState().nodes[f.outside.id] as typeof f.outside).position).toEqual([
      9, 0, 2,
    ])
  })

  // Actual store mutations, commit bus, reducer and temporal Undo. The host's
  // wroteScene hint is deliberately false: observed local writes are authoritative.
  for (const kind of ['inside', 'outside', 'collection', 'material'] as const) {
    for (const outcome of ['completed', 'cancelled', 'errored'] as const) {
      test(`${kind} local write remains reversible when the turn is ${outcome}`, () => {
        const f = fixture()
        const observed = watch(f.snapshot, f.room.id)
        if (kind === 'inside') {
          useScene.getState().updateNode(f.fridge.id, { position: [3, 0, 2] })
          expect((useScene.getState().nodes[f.fridge.id] as typeof f.fridge).position).toEqual([
            3, 0, 2,
          ])
        } else if (kind === 'outside') {
          useScene.getState().updateNode(f.outside.id, { position: [9, 0, 2] })
          expect((useScene.getState().nodes[f.outside.id] as typeof f.outside).position).toEqual([
            9, 0, 2,
          ])
        } else if (kind === 'collection') {
          const id = useScene.getState().createCollection('Kitchen furniture')
          expect(useScene.getState().collections[id]?.name).toBe('Kitchen furniture')
        } else {
          const material = SceneMaterial.parse({
            id: 'mat_point_finish',
            name: 'Kitchen finish',
            material: { properties: { color: '#336699' } },
          })
          useScene.getState().addSceneMaterial(material)
          expect(useScene.getState().materials.mat_point_finish).toEqual(material)
        }
        const pin = finishPin(observed.pin(), false, outcome)

        expect(observed.commits.map((commit) => commit.origin)).toEqual(['local'])
        expect(pin.state).toBe(outcome === 'errored' ? 'error' : 'done')
        expect(pin.committed).toBe(true)
        expect(pin.landed).toBe(kind === 'inside' ? 1 : 0)
        expect(pin.changedTargetIds).toEqual(kind === 'inside' ? [f.fridge.id] : [])
        expect(pin.alsoChangedIds).toEqual(kind === 'outside' ? [f.outside.id] : [])
        const steps = stepsSince(useScene.temporal.getState().pastStates, observed.mark)
        expect(steps).toBe(1)
        useScene.temporal.getState().undo(steps!)
        expect(useScene.getState().nodes).toEqual(f.snapshot.nodes)
        expect(useScene.getState().collections).toEqual(f.snapshot.collections)
        expect(useScene.getState().materials).toEqual(f.snapshot.materials)
      })
    }
  }

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

    if (!event) throw new Error('A local semantic commit must produce a Point event')
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
      if (!event) throw new Error('A local semantic commit must produce a Point event')
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

    if (!event) throw new Error('A local semantic commit must produce a Point event')
    expect(event.changedNodeIds).toEqual([])
    expect(finishPin(reducePin(beginPin(f.room.id), event)).state).toBe('done')
  })
})
