import { describe, expect, test } from 'bun:test'
import type { AnyNodeDefinition, DistributionRole, NodePort } from '../registry'
import { registerNode } from '../registry'
import type { AnyNode, AnyNodeId } from '../schema'
import { analyzePortConnectivity, resolveConnectivityUpdates } from './port-connectivity'

type Point = [number, number, number]

// Stub registrations mirroring the real kinds' port + role conventions
// without importing the nodes package (which pulls in CSG and can't load
// under the test runner). A run exposes start/end at its path tips; the
// fitting here is a simple two-collar elbow at ±X around its position.
function stubDef(
  kind: string,
  distributionRole: DistributionRole,
  ports: (node: AnyNode) => NodePort[],
): void {
  registerNode({
    kind,
    schemaVersion: 1,
    schema: {},
    category: 'utility',
    distributionRole,
    defaults: () => ({}),
    capabilities: {},
    ports,
  } as unknown as AnyNodeDefinition)
}

stubDef('duct-segment', 'run', (node) => {
  const path = (node as unknown as { path: Point[] }).path
  const system = (node as unknown as { system: string }).system
  return [
    { id: 'start', position: path[0]!, direction: [-1, 0, 0], diameter: 6, system },
    { id: 'end', position: path[path.length - 1]!, direction: [1, 0, 0], diameter: 6, system },
  ]
})
stubDef('duct-fitting', 'fitting', (node) => {
  const position = (node as unknown as { position: Point }).position
  const system = (node as unknown as { system: string }).system
  return [
    {
      id: 'inlet',
      position: [position[0] - 0.2, position[1], position[2]],
      direction: [-1, 0, 0],
      diameter: 6,
      system,
    },
    {
      id: 'outlet',
      position: [position[0] + 0.2, position[1], position[2]],
      direction: [1, 0, 0],
      diameter: 6,
      system,
    },
  ]
})

let nextId = 0
function makeNode(type: string, fields: Record<string, unknown>): AnyNode {
  nextId += 1
  return { id: `${type}_${nextId}`, type, object: 'node', parentId: null, ...fields } as AnyNode
}

function sceneOf(...nodes: AnyNode[]): Record<AnyNodeId, AnyNode> {
  return Object.fromEntries(nodes.map((n) => [n.id, n])) as Record<AnyNodeId, AnyNode>
}

describe('port connectivity — fitting joint second hop', () => {
  // Layout: duct A ends at the fitting's inlet (−0.2,0,0); duct B starts at the
  // fitting's outlet (+0.2,0,0). Dragging A's far end toward/through the
  // fitting carries the fitting AND duct B's near endpoint along.
  function joint() {
    const fitting = makeNode('duct-fitting', { position: [0, 0, 0], system: 'supply' })
    const ductA = makeNode('duct-segment', {
      path: [
        [-3, 0, 0],
        [-0.2, 0, 0],
      ],
      system: 'supply',
    })
    const ductB = makeNode('duct-segment', {
      path: [
        [0.2, 0, 0],
        [3, 0, 0],
      ],
      system: 'supply',
    })
    return { fitting, ductA, ductB }
  }

  test('dragging duct A carries the fitting (rigid) and duct B (sibling endpoint)', () => {
    const { fitting, ductA, ductB } = joint()
    const nodes = sceneOf(fitting, ductA, ductB)

    const connectivity = analyzePortConnectivity(ductA, nodes)
    // The fitting follows rigidly…
    expect(
      connectivity.connections.find((c) => c.kind === 'rigid-node' && c.nodeId === fitting.id),
    ).toBeDefined()
    // …and duct B is picked up as a second-hop sibling endpoint.
    expect(
      connectivity.connections.find(
        (c) => c.kind === 'duct-endpoint-follow' && c.nodeId === ductB.id,
      ),
    ).toBeDefined()

    // Move duct A's mated endpoint (the 'end' port, path index 1) by +1 in Z.
    const moved = {
      ...(ductA as Record<string, unknown>),
      path: [
        [-3, 0, 0],
        [-0.2, 0, 1],
      ],
    } as AnyNode
    const updates = resolveConnectivityUpdates(connectivity, moved)

    const fittingUpdate = updates.find((u) => u.id === fitting.id)
    expect((fittingUpdate!.data as { position: Point }).position).toEqual([0, 0, 1])

    const bUpdate = updates.find((u) => u.id === ductB.id)
    const bPath = (bUpdate!.data as { path: Point[] }).path
    // Duct B's near end (index 0, on the outlet collar) rode +1 in Z…
    expect(bPath[0]).toEqual([0.2, 0, 1])
    // …its far end stayed put (the run stretches).
    expect(bPath[1]).toEqual([3, 0, 0])
  })

  test('an unrelated run not on the fitting is left alone', () => {
    const { fitting, ductA, ductB } = joint()
    const distant = makeNode('duct-segment', {
      path: [
        [10, 0, 0],
        [13, 0, 0],
      ],
      system: 'supply',
    })
    const nodes = sceneOf(fitting, ductA, ductB, distant)
    const connectivity = analyzePortConnectivity(ductA, nodes)
    expect(connectivity.connections.find((c) => c.nodeId === distant.id)).toBeUndefined()
  })
})
