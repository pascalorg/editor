import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import useArrayDuplicate, {
  clearLastMove,
  getLastMove,
  isArrayCommandArmed,
  runArrayCommand,
  startArrayDuplicateTracking,
  stopArrayDuplicateTracking,
} from './use-array-duplicate'

// Polyfills for bun:test (no DOM) — scene writes schedule their dirty flush on
// an animation frame.
type RafFn = (cb: (t: number) => void) => number
;(globalThis as unknown as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= ((
  cb: (t: number) => void,
) => {
  cb(0)
  return 0
}) as RafFn
;(globalThis as unknown as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??=
  () => {}

const LEVEL_ID = 'level_arraytest' as AnyNodeId

const item = (id: string, position: [number, number, number], children: string[] = []): AnyNode =>
  ({
    object: 'node',
    id,
    type: 'item',
    parentId: LEVEL_ID,
    visible: true,
    metadata: {},
    position,
    rotation: [0, 0, 0],
    children,
  }) as unknown as AnyNode

function seed(...nodes: AnyNode[]) {
  const level = {
    object: 'node',
    id: LEVEL_ID,
    type: 'level',
    parentId: null,
    visible: true,
    metadata: {},
    level: 0,
    children: nodes.filter((n) => n.parentId === LEVEL_ID).map((n) => n.id),
  } as unknown as AnyNode

  useScene.setState({
    nodes: Object.fromEntries([[LEVEL_ID, level], ...nodes.map((n) => [n.id, n])]) as Record<
      AnyNodeId,
      AnyNode
    >,
    rootNodeIds: [LEVEL_ID],
    readOnly: false,
  })
}

const itemsAt = (): number[] =>
  Object.values(useScene.getState().nodes)
    .filter((n) => n.type === 'item')
    .map((n) => (n as unknown as { position: [number, number, number] }).position[0])
    .sort((a, b) => a - b)

beforeEach(() => {
  startArrayDuplicateTracking()
  seed(item('item_1', [0, 0, 0]))
  clearLastMove()
})

afterEach(() => {
  stopArrayDuplicateTracking()
  clearLastMove()
  useScene.setState({ nodes: {}, rootNodeIds: [] })
})

describe('last-move tracking', () => {
  test('a move through the ordinary store action arms the command', () => {
    expect(isArrayCommandArmed()).toBe(false)

    useScene.getState().updateNode(
      'item_1' as AnyNodeId,
      {
        position: [2, 0, 0],
      } as Partial<AnyNode>,
    )

    expect(isArrayCommandArmed()).toBe(true)
    expect(getLastMove()).toMatchObject({
      nodeIds: ['item_1' as AnyNodeId],
      translation: [2, 0, 0],
    })
  })

  test('a non-move edit disarms rather than leaving a stale move behind', () => {
    useScene.getState().updateNode(
      'item_1' as AnyNodeId,
      {
        position: [2, 0, 0],
      } as Partial<AnyNode>,
    )
    expect(isArrayCommandArmed()).toBe(true)

    useScene.getState().updateNode('item_1' as AnyNodeId, { name: 'Renamed' } as Partial<AnyNode>)

    expect(isArrayCommandArmed()).toBe(false)
  })

  test('creating a node disarms — an array must not repeat a placement', () => {
    useScene.getState().updateNode(
      'item_1' as AnyNodeId,
      {
        position: [2, 0, 0],
      } as Partial<AnyNode>,
    )

    useScene.getState().createNode(item('item_new', [9, 0, 0]), LEVEL_ID)

    expect(isArrayCommandArmed()).toBe(false)
  })
})

describe('runArrayCommand', () => {
  function moveThenArray(command: Parameters<typeof runArrayCommand>[0]) {
    useScene.getState().updateNode(
      'item_1' as AnyNodeId,
      {
        position: [2, 0, 0],
      } as Partial<AnyNode>,
    )
    return runArrayCommand(command)
  }

  test('*3 lays three more copies along the same vector', () => {
    const result = moveThenArray({ kind: 'repeat', count: 3 })

    expect(result?.copies).toBe(3)
    // Moved node at 2, copies at 4, 6, 8.
    expect(itemsAt()).toEqual([2, 4, 6, 8])
  })

  test('/4 fills the gap the move opened', () => {
    const result = moveThenArray({ kind: 'divide', count: 4 })

    expect(result?.copies).toBe(3)
    expect(itemsAt()).toEqual([0.5, 1, 1.5, 2])
  })

  test('copies are fresh nodes, not aliases of the source', () => {
    moveThenArray({ kind: 'repeat', count: 2 })
    const ids = Object.values(useScene.getState().nodes)
      .filter((n) => n.type === 'item')
      .map((n) => n.id)

    expect(new Set(ids).size).toBe(ids.length)
    expect(ids as string[]).toContain('item_1')
  })

  test('the whole array is one undo step', () => {
    useScene.getState().updateNode(
      'item_1' as AnyNodeId,
      {
        position: [2, 0, 0],
      } as Partial<AnyNode>,
    )

    const before = useScene.temporal.getState().pastStates.length
    runArrayCommand({ kind: 'repeat', count: 5 })
    const after = useScene.temporal.getState().pastStates.length

    expect(after - before).toBeLessThanOrEqual(1)
    expect(itemsAt()).toHaveLength(6)
  })

  test('copies land under the same parent as the source', () => {
    moveThenArray({ kind: 'repeat', count: 2 })

    for (const node of Object.values(useScene.getState().nodes)) {
      if (node.type !== 'item') continue
      expect(node.parentId).toBe(LEVEL_ID)
    }
  })

  test('a subtree is copied whole', () => {
    seed(item('item_parent', [0, 0, 0], ['item_child']), {
      ...item('item_child', [0.5, 0, 0]),
      parentId: 'item_parent',
    } as unknown as AnyNode)
    clearLastMove()

    useScene.getState().updateNode(
      'item_parent' as AnyNodeId,
      {
        position: [3, 0, 0],
      } as Partial<AnyNode>,
    )
    const result = runArrayCommand({ kind: 'repeat', count: 2 })

    expect(result?.copies).toBe(2)
    // Two roots cloned, each bringing one child: 2 originals + 4 new.
    expect(Object.values(useScene.getState().nodes).filter((n) => n.type === 'item')).toHaveLength(
      6,
    )
  })

  test('does nothing when no move is armed', () => {
    expect(runArrayCommand({ kind: 'repeat', count: 3 })).toBeNull()
    expect(itemsAt()).toEqual([0])
  })

  test('a divide-by-one produces no copies and no history entry', () => {
    const before = useScene.temporal.getState().pastStates.length
    const result = moveThenArray({ kind: 'divide', count: 1 })
    // Only the move itself should have been recorded.
    expect(result).toBeNull()
    expect(useScene.temporal.getState().pastStates.length - before).toBeLessThanOrEqual(1)
  })

  test('a read-only scene refuses the command', () => {
    useScene.getState().updateNode(
      'item_1' as AnyNodeId,
      {
        position: [2, 0, 0],
      } as Partial<AnyNode>,
    )
    useScene.setState({ readOnly: true })

    expect(runArrayCommand({ kind: 'repeat', count: 3 })).toBeNull()
    useScene.setState({ readOnly: false })
  })

  test('the store hook exposes the same armed state', () => {
    useScene.getState().updateNode(
      'item_1' as AnyNodeId,
      {
        position: [1, 0, 0],
      } as Partial<AnyNode>,
    )

    expect(useArrayDuplicate.getState().lastMove?.translation).toEqual([1, 0, 0])
  })
})
