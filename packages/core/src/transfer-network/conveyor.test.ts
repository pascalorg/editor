import { describe, expect, test } from 'bun:test'
import type { AnyNode } from '../schema'
import { ConveyorBeltNode } from '../schema/nodes/conveyor-belt'
import {
  addTransferConnectionToMetadata,
  createConveyorEndpointConnection,
  getConveyorPortPoint,
  getTransferConnections,
  removeTransferConnectionsFromMetadata,
  resolveConveyorEndpointSnap,
} from './conveyor'

function belt(id: string, points: Array<[number, number, number]>) {
  return ConveyorBeltNode.parse({ id, name: id, points })
}

describe('conveyor transfer network', () => {
  test('resolves nearby conveyor endpoints with compatible port preference', () => {
    const existing = belt('conveyor-belt_a', [
      [0, 0, 0],
      [4, 0, 0],
    ])
    const nodes = { [existing.id]: existing } as Record<string, AnyNode>

    const snap = resolveConveyorEndpointSnap({
      point: [4.08, 0, 0.03],
      nodes,
      preferredTargetPort: 'out',
    })

    expect(snap?.targetNodeId).toBe(existing.id)
    expect(snap?.targetPort).toBe('out')
    expect(snap?.point).toEqual([4, 0, 0])
  })

  test('ignores endpoints outside the snap threshold', () => {
    const existing = belt('conveyor-belt_a', [
      [0, 0, 0],
      [4, 0, 0],
    ])

    expect(
      resolveConveyorEndpointSnap({
        point: [4.3, 0, 0],
        nodes: { [existing.id]: existing } as Record<string, AnyNode>,
      }),
    ).toBeNull()
  })

  test('stores transfer connections without duplicates', () => {
    const connection = createConveyorEndpointConnection({
      selfNodeId: 'conveyor-belt_b',
      selfPort: 'in',
      targetNodeId: 'conveyor-belt_a',
      targetPort: 'out',
    })

    const metadata = addTransferConnectionToMetadata(
      addTransferConnectionToMetadata({}, connection),
      connection,
    )

    expect(getTransferConnections({ metadata } as AnyNode)).toEqual([
      {
        fromNodeId: 'conveyor-belt_a',
        fromPort: 'out',
        toNodeId: 'conveyor-belt_b',
        toPort: 'in',
      },
    ])
  })

  test('reads input and output port coordinates', () => {
    const node = belt('conveyor-belt_a', [
      [1, 0, 2],
      [3, 0, 4],
    ])

    expect(getConveyorPortPoint(node, 'in')).toEqual([1, 0, 2])
    expect(getConveyorPortPoint(node, 'out')).toEqual([3, 0, 4])
  })

  test('removes existing connections for a moved port', () => {
    const metadata = addTransferConnectionToMetadata(
      {},
      {
        fromNodeId: 'conveyor-belt_a',
        fromPort: 'out',
        toNodeId: 'conveyor-belt_b',
        toPort: 'in',
      },
    )

    expect(
      getTransferConnections({
        metadata: removeTransferConnectionsFromMetadata(metadata, {
          nodeId: 'conveyor-belt_a',
          port: 'out',
        }),
      } as AnyNode),
    ).toEqual([])
  })
})
