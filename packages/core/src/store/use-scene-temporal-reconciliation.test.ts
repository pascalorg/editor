import { afterEach, beforeEach, expect, test } from 'bun:test'
import { initSpaceDetectionSync, type SpaceTopologyReconcileEvent } from '../lib/space-detection'
import { AnyNode, type AnyNodeId } from '../schema'
import fixture from './fixtures/maxi-8x-endpoint.json'
import { runAsSingleSceneHistoryStep } from './history-control'
import useScene, { clearSceneHistory } from './use-scene'

const originalRaf = globalThis.requestAnimationFrame
const originalCancelRaf = globalThis.cancelAnimationFrame
beforeEach(() => {
  globalThis.requestAnimationFrame = (callback) => {
    callback(0)
    return 0
  }
  globalThis.cancelAnimationFrame = () => {}
})

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  useScene.getState().unloadScene()
  clearSceneHistory()
  globalThis.requestAnimationFrame = originalRaf
  globalThis.cancelAnimationFrame = originalCancelRaf
})

function watch(nodes: Record<AnyNodeId, AnyNode>) {
  useScene.setState({ nodes, rootNodeIds: [], readOnly: false })
  clearSceneHistory()
  const events: SpaceTopologyReconcileEvent[] = []
  const editor = {
    spaces: {},
    setSpaces(spaces: Record<string, unknown>) {
      this.spaces = spaces
    },
  }
  const stop = initSpaceDetectionSync(
    useScene,
    { getState: () => editor },
    { onTopologyReconcile: (event) => events.push(event) },
  )
  cleanups.push(stop)
  return { events, stop, editor }
}

function canonicalPolygon(points: number[][]) {
  const rotations = points.map((_, i) =>
    JSON.stringify([...points.slice(i), ...points.slice(0, i)]),
  )
  return rotations.sort()[0]
}

function graph(nodes: Record<AnyNodeId, AnyNode>) {
  return Object.fromEntries(
    Object.entries(nodes).map(([id, node]) => [
      id,
      'polygon' in node && Array.isArray(node.polygon)
        ? { ...node, polygon: canonicalPolygon(node.polygon) }
        : node,
    ]),
  )
}

const baseline = () =>
  Object.fromEntries(
    fixture.nodes.map((node) => {
      const parsed = AnyNode.parse(node)
      return [parsed.id, parsed]
    }),
  ) as Record<AnyNodeId, AnyNode>

function forward() {
  runAsSingleSceneHistoryStep(useScene, () =>
    useScene.getState().updateNodes(fixture.updates as { id: AnyNodeId; data: Partial<AnyNode> }[]),
  )
}

test('Maxi 8× endpoint undo/redo matches full-level graph and preserves unrelated surface identities', () => {
  const initial = baseline()
  const indexed = watch(initial)
  forward()
  const moved = useScene.getState().nodes
  const target = useScene.temporal.getState().pastStates.at(-1)!.nodes
  indexed.events.length = 0
  useScene.temporal.getState().undo()
  const undone = useScene.getState().nodes
  expect(indexed.events).toHaveLength(1)
  expect(indexed.events[0]?.strategy).toBe('indexed')
  const remoteSlab = 'slab_02warzosdw17ko2n' as AnyNodeId
  expect(undone[remoteSlab]).toBe(target[remoteSlab])
  const undoGraph = graph(undone)
  useScene.temporal.getState().redo()
  const redoGraph = graph(useScene.getState().nodes)
  expect(indexed.events).toHaveLength(2)
  indexed.stop()

  const fullUndo = watch(moved)
  useScene.setState({ nodes: target })
  expect(undoGraph).toEqual(graph(useScene.getState().nodes))
  fullUndo.stop()
  const fullRedo = watch(undone)
  useScene.setState({ nodes: moved })
  expect(redoGraph).toEqual(graph(useScene.getState().nodes))
  fullRedo.stop()
})

test('multi-step temporal jumps scope the complete target diff', () => {
  const initial = baseline()
  const { events } = watch(initial)
  forward()
  const wallId = fixture.updates[0]!.id as AnyNodeId
  useScene.getState().updateNode(wallId, { thickness: 0.4 })
  events.length = 0
  useScene.temporal.getState().undo(2)
  expect(events).toHaveLength(1)
  expect(useScene.getState().nodes[wallId]).toEqual(initial[wallId])
  useScene.temporal.getState().redo(2)
  expect(events).toHaveLength(2)
  expect((useScene.getState().nodes[wallId] as { thickness: number }).thickness).toBe(0.4)
})

test('level hierarchy changes keep full-level reconciliation', () => {
  const initial = baseline()
  const { events } = watch(initial)
  useScene.getState().updateNode(fixture.levelId as AnyNodeId, { height: 4 })
  events.length = 0
  useScene.temporal.getState().undo()
  expect(events).toHaveLength(0)
  expect(useScene.getState().nodes[fixture.levelId as AnyNodeId]).toEqual(
    initial[fixture.levelId as AnyNodeId],
  )
})
