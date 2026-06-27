import { describe, expect, test } from 'bun:test'
import {
  addTransferConnectionToMetadata,
  type AnyNode,
  type AnyNodeId,
  getTransferConnections,
  type TransferConnection,
} from '@pascal-app/core'
import {
  addConnectionToPeerNode,
  removeMovingEndpointConnectionsFromPeers,
} from './connection-sync'
import { ConveyorBeltNode } from './schema'

function belt(id: string, metadata?: unknown) {
  return ConveyorBeltNode.parse({
    id,
    name: id,
    points: [
      [0, 0, 0],
      [2, 0, 0],
    ],
    metadata,
  })
}

function createScene(nodes: AnyNode[]) {
  const state = Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<string, AnyNode>
  const dirty = new Set<AnyNodeId>()
  return {
    nodes: state,
    dirty,
    updateNode(id: AnyNodeId, updates: Partial<AnyNode>) {
      state[id] = { ...state[id], ...updates } as AnyNode
    },
    markDirty(id: AnyNodeId) {
      dirty.add(id)
    },
  }
}

describe('conveyor connection sync', () => {
  test('adds a snapped connection to the peer node metadata', () => {
    const source = belt('conveyor-belt_source')
    const target = belt('conveyor-belt_target')
    const scene = createScene([source, target])
    const connection: TransferConnection = {
      fromNodeId: source.id,
      fromPort: 'out',
      toNodeId: target.id,
      toPort: 'in',
    }

    addConnectionToPeerNode({
      nodes: scene.nodes,
      selfNodeId: source.id,
      connection,
      updateNode: scene.updateNode,
      markDirty: scene.markDirty,
    })

    expect(getTransferConnections(scene.nodes[target.id] as AnyNode)).toEqual([connection])
    expect(scene.dirty.has(target.id as AnyNodeId)).toBe(true)
  })

  test('removes stale moved-port connections from previous peer nodes', () => {
    const source = belt('conveyor-belt_source')
    const previousTargetConnection: TransferConnection = {
      fromNodeId: source.id,
      fromPort: 'out',
      toNodeId: 'conveyor-belt_old_target',
      toPort: 'in',
    }
    const oldTarget = belt(
      'conveyor-belt_old_target',
      addTransferConnectionToMetadata({}, previousTargetConnection),
    )
    const unrelated = belt(
      'conveyor-belt_unrelated',
      addTransferConnectionToMetadata({}, {
        fromNodeId: 'conveyor-belt_other',
        fromPort: 'out',
        toNodeId: 'conveyor-belt_unrelated',
        toPort: 'in',
      }),
    )
    const scene = createScene([source, oldTarget, unrelated])

    removeMovingEndpointConnectionsFromPeers({
      nodes: scene.nodes,
      movingNodeId: source.id,
      movingPort: 'out',
      updateNode: scene.updateNode,
      markDirty: scene.markDirty,
    })

    expect(getTransferConnections(scene.nodes[oldTarget.id] as AnyNode)).toEqual([])
    expect(getTransferConnections(scene.nodes[unrelated.id] as AnyNode)).toHaveLength(1)
    expect(scene.dirty.has(oldTarget.id as AnyNodeId)).toBe(true)
    expect(scene.dirty.has(unrelated.id as AnyNodeId)).toBe(false)
  })
})
