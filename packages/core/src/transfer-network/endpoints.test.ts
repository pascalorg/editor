import { describe, expect, test } from 'bun:test'
import type { AnyNode } from '../schema'
import { PipeNode } from '../schema/nodes/pipe'
import {
  createTransferEndpointConnection,
  getTransferPortPoint,
  resolveTransferEndpointSnap,
} from './endpoints'

function pipe(id: string, start: [number, number], end: [number, number]) {
  return PipeNode.parse({ id, name: id, start, end, elevation: 1, rotate: 0 })
}

describe('transfer endpoints', () => {
  test('resolves pipe endpoints through the generic transfer snapper', () => {
    const existing = pipe('pipe_existing', [0, 0], [4, 0])
    const snap = resolveTransferEndpointSnap({
      point: [4.08, 1, 0.03],
      nodes: { [existing.id]: existing } as Record<string, AnyNode>,
      preferredTargetPort: 'out',
      nodeTypes: ['pipe'],
    })

    expect(snap?.targetNodeId).toBe(existing.id)
    expect(snap?.targetPort).toBe('out')
    expect(snap?.point).toEqual([4, 1, 0])
  })

  test('reads pipe port coordinates from the 3D centerline', () => {
    const node = pipe('pipe_existing', [1, 2], [3, 4])

    expect(getTransferPortPoint(node, 'in')).toEqual([1, 1, 2])
    expect(getTransferPortPoint(node, 'out')).toEqual([3, 1, 4])
  })

  test('creates directional endpoint connections', () => {
    expect(
      createTransferEndpointConnection({
        selfNodeId: 'pipe_b',
        selfPort: 'in',
        targetNodeId: 'pipe_a',
        targetPort: 'out',
      }),
    ).toEqual({
      fromNodeId: 'pipe_a',
      fromPort: 'out',
      toNodeId: 'pipe_b',
      toPort: 'in',
    })
  })
})
