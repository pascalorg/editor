import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { BlockNode, useScene } from '@pascal-app/core'
import { applyBlockCommand } from './commands'
import {
  recordCommittedBlockOperation,
  repeatCommittedBlockOperation,
  replaceCommittedBlockOperation,
} from './last-operation'

globalThis.requestAnimationFrame ??= (callback: FrameRequestCallback) => {
  callback(0)
  return 0
}
globalThis.cancelAnimationFrame ??= () => {}

describe('block last operation history transaction', () => {
  const node = BlockNode.parse({ name: 'Adjustable block' })

  beforeEach(() => {
    useScene.setState({ nodes: { [node.id]: node }, dirtyNodes: new Set(), readOnly: false })
    useScene.temporal.getState().clear()
  })

  afterEach(() => {
    useScene.setState({ nodes: {}, dirtyNodes: new Set(), readOnly: false })
    useScene.temporal.getState().clear()
  })

  test('replaces the committed result while preserving one undo step', () => {
    const firstCommand = { type: 'extrude-face', faceId: 'f-top', distance: 0.25 } as const
    const first = applyBlockCommand(node.topology, firstCommand)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    useScene.getState().updateNode(node.id, { topology: first.topology })
    const record = recordCommittedBlockOperation(
      node.id,
      'Extrude',
      node.topology,
      firstCommand,
      first,
    )

    const adjusted = replaceCommittedBlockOperation(record, {
      ...firstCommand,
      distance: 0.5,
    })

    expect(adjusted.ok).toBe(true)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    const current = useScene.getState().nodes[node.id]
    expect(current?.type).toBe('block')
    if (current?.type !== 'block') return
    const top = current.topology.faces.find((face) => face.id === 'f-top')
    expect(
      top?.vertexIds.map(
        (id) => current.topology.vertices.find((vertex) => vertex.id === id)!.position[1],
      ),
    ).toEqual([2.9, 2.9, 2.9, 2.9])
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes[node.id]).toEqual(node)
  })

  test('repeats the operation from its latest result as a new undo step', () => {
    const command = { type: 'extrude-face', faceId: 'f-top', distance: 0.25 } as const
    const first = applyBlockCommand(node.topology, command)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    useScene.getState().updateNode(node.id, { topology: first.topology })
    const record = recordCommittedBlockOperation(node.id, 'Extrude', node.topology, command, first)

    const repeated = repeatCommittedBlockOperation(record, {
      mode: 'face',
      ids: ['f-top'],
      activeId: 'f-top',
    })

    expect(repeated.ok).toBe(true)
    expect(useScene.temporal.getState().pastStates).toHaveLength(2)
    const current = useScene.getState().nodes[node.id]
    expect(current?.type).toBe('block')
    if (current?.type !== 'block') return
    const top = current.topology.faces.find((face) => face.id === 'f-top')
    expect(
      top?.vertexIds.map(
        (id) => current.topology.vertices.find((vertex) => vertex.id === id)!.position[1],
      ),
    ).toEqual([2.9, 2.9, 2.9, 2.9])
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes[node.id]).toMatchObject({ topology: first.topology })
  })
})
