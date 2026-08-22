import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { BlockNode, createSceneApi, runAsSingleSceneHistoryStep, useScene } from '@pascal-app/core'
import { applyBlockCommand } from './commands'
import {
  commitBlockOperation,
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
  const services = {
    historyApi: {
      depth: () => useScene.temporal.getState().pastStates.length,
      replaceLatest: (expectedDepth: number, replace: () => boolean) => {
        if (useScene.temporal.getState().pastStates.length !== expectedDepth) return false
        let replaced = false
        runAsSingleSceneHistoryStep(useScene, () => {
          useScene.temporal.getState().undo()
          replaced = replace()
          if (!replaced) useScene.temporal.getState().redo()
        })
        return replaced
      },
    },
    readOnly: false,
    sceneApi: createSceneApi(useScene),
  }

  beforeEach(() => {
    useScene.setState({ nodes: { [node.id]: node }, dirtyNodes: new Set(), readOnly: false })
    useScene.temporal.getState().clear()
  })

  afterEach(() => {
    useScene.setState({ nodes: {}, dirtyNodes: new Set(), readOnly: false })
    useScene.temporal.getState().clear()
  })

  test('replaces the committed result while preserving one undo step', () => {
    const firstCommand = { type: 'extrude-faces', faceIds: ['f-top'], distance: 0.25 } as const
    const first = applyBlockCommand(node.topology, firstCommand)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    useScene.getState().updateNode(node.id, { topology: first.topology })
    const record = recordCommittedBlockOperation(
      services,
      node.id,
      'Extrude',
      node.topology,
      firstCommand,
      first,
    )

    const adjusted = replaceCommittedBlockOperation(services, record, {
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
    const command = { type: 'extrude-faces', faceIds: ['f-top'], distance: 0.25 } as const
    const first = applyBlockCommand(node.topology, command)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    useScene.getState().updateNode(node.id, { topology: first.topology })
    const record = recordCommittedBlockOperation(
      services,
      node.id,
      'Extrude',
      node.topology,
      command,
      first,
    )

    const repeated = repeatCommittedBlockOperation(services, record, {
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

  test('does not create history or a last operation when a transform leaves topology unchanged', () => {
    const committed = commitBlockOperation(services, node.id, 'Scale', node.topology, {
      type: 'scale-components',
      selection: { mode: 'face', ids: ['f-top'] },
      pivot: [0, 2.4, 0],
      factors: [1, 2, 1],
    })

    expect(committed).toEqual({ ok: true, changed: false })
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    expect(useScene.getState().nodes[node.id]).toEqual(node)
  })
})
