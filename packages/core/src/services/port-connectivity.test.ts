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
stubDef('duct-tee', 'fitting', (node) => {
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
    {
      id: 'branch',
      position: [position[0], position[1], position[2] + 0.2],
      direction: [0, 0, 1],
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

function expectPointClose(actual: Point, expected: Point) {
  expect(actual[0]).toBeCloseTo(expected[0], 6)
  expect(actual[1]).toBeCloseTo(expected[1], 6)
  expect(actual[2]).toBeCloseTo(expected[2], 6)
}

describe('port connectivity — joint follow (stretch vs translate)', () => {
  // Layout: duct A ends at the fitting's inlet (−0.2,0,0); duct B starts at the
  // fitting's outlet (+0.2,0,0). Both runs lie on the X axis. Dragging A's
  // mated endpoint carries the fitting and duct B; how B reacts depends on
  // whether the drag is along its axis (stretch) or across it (translate).
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

  function movedA(end: Point): AnyNode {
    const { ductA } = joint()
    return { ...(ductA as Record<string, unknown>), path: [[-3, 0, 0], end] } as AnyNode
  }

  test('the fitting and sibling run are picked up as carried connections', () => {
    const { fitting, ductA, ductB } = joint()
    const connectivity = analyzePortConnectivity(ductA, sceneOf(fitting, ductA, ductB))
    expect(
      connectivity.connections.find((c) => c.kind === 'rigid-node' && c.nodeId === fitting.id),
    ).toBeDefined()
    expect(
      connectivity.connections.find((c) => c.kind === 'run' && c.nodeId === ductB.id),
    ).toBeDefined()
  })

  test('perpendicular drag translates the WHOLE sibling run (no skew)', () => {
    const { fitting, ductA, ductB } = joint()
    const nodes = sceneOf(fitting, ductA, ductB)
    const connectivity = analyzePortConnectivity(ductA, nodes)

    // Move A's mated end +1 in Z — perpendicular to B's X axis.
    const updates = resolveConnectivityUpdates(connectivity, movedA([-0.2, 0, 1]))

    expect(
      (updates.find((u) => u.id === fitting.id)!.data as { position: Point }).position,
    ).toEqual([0, 0, 1])
    const bPath = (updates.find((u) => u.id === ductB.id)!.data as { path: Point[] }).path
    // Both ends ride +1 in Z: the run keeps its length and direction.
    expect(bPath[0]).toEqual([0.2, 0, 1])
    expect(bPath[1]).toEqual([3, 0, 1])
  })

  test('parallel drag stretches the sibling run (only the near end slides)', () => {
    const { fitting, ductA, ductB } = joint()
    const nodes = sceneOf(fitting, ductA, ductB)
    const connectivity = analyzePortConnectivity(ductA, nodes)

    // Move A's mated end +0.5 in X — along B's axis (the fitting slides toward B).
    const updates = resolveConnectivityUpdates(connectivity, movedA([0.3, 0, 0]))

    const bPath = (updates.find((u) => u.id === ductB.id)!.data as { path: Point[] }).path
    // Near end slid +0.5 in X; far end stayed put → the run shortened.
    expect(bPath[0]).toEqual([0.7, 0, 0])
    expect(bPath[1]).toEqual([3, 0, 0])
  })

  test('perpendicular slide propagates through the sibling run to its far joint', () => {
    // Extend the chain: duct B's far end (3,0,0) meets a second elbow, and duct
    // C hangs off that elbow. A perpendicular drag should carry the whole chain.
    const { fitting, ductA, ductB } = joint()
    const elbow2 = makeNode('duct-fitting', { position: [3.2, 0, 0], system: 'supply' })
    // elbow ports are ±0.2 on X around its position → inlet at (3,0,0) meets B.
    const ductC = makeNode('duct-segment', {
      path: [
        [3.4, 0, 0],
        [6, 0, 0],
      ],
      system: 'supply',
    })
    const nodes = sceneOf(fitting, ductA, ductB, elbow2, ductC)
    const connectivity = analyzePortConnectivity(ductA, nodes)

    const updates = resolveConnectivityUpdates(connectivity, movedA([-0.2, 0, 1]))

    // Whole chain rode +1 in Z.
    const bPath = (updates.find((u) => u.id === ductB.id)!.data as { path: Point[] }).path
    expect(bPath[1]).toEqual([3, 0, 1])
    expect((updates.find((u) => u.id === elbow2.id)!.data as { position: Point }).position).toEqual(
      [3.2, 0, 1],
    )
    const cPath = (updates.find((u) => u.id === ductC.id)!.data as { path: Point[] }).path
    expect(cPath[0]).toEqual([3.4, 0, 1])
    expect(cPath[1]).toEqual([6, 0, 1])
  })

  test('a run reached from both ends applies both endpoint deltas', () => {
    const moved = makeNode('duct-segment', {
      path: [
        [0, 0, 0],
        [3, 0, 0],
      ],
      system: 'supply',
    })
    const follower = makeNode('duct-segment', {
      path: [
        [0, 0, 0],
        [3, 0, 0],
      ],
      system: 'supply',
    })
    const nodes = sceneOf(moved, follower)
    const connectivity = analyzePortConnectivity(moved, nodes)
    const preview = {
      ...(moved as Record<string, unknown>),
      path: [
        [0, 0, 1],
        [3, 0, 2],
      ],
    } as AnyNode

    const updates = resolveConnectivityUpdates(connectivity, preview)

    const path = (updates.find((u) => u.id === follower.id)!.data as { path: Point[] }).path
    expect(path[0]).toEqual([0, 0, 1])
    expect(path[1]).toEqual([3, 0, 2])
  })

  test('a polyline run reached from both ends preserves interior bend shape', () => {
    const moved = makeNode('duct-segment', {
      path: [
        [0, 0, 0],
        [3, 0, 3],
      ],
      system: 'supply',
    })
    const follower = makeNode('duct-segment', {
      path: [
        [0, 0, 0],
        [1, 0, 0],
        [1, 0, 3],
        [3, 0, 3],
      ],
      system: 'supply',
    })
    const nodes = sceneOf(moved, follower)
    const connectivity = analyzePortConnectivity(moved, nodes)
    const preview = {
      ...(moved as Record<string, unknown>),
      path: [
        [-0.5, 0, 0],
        [3.5, 0, 3],
      ],
    } as AnyNode

    const updates = resolveConnectivityUpdates(connectivity, preview)

    const path = (updates.find((u) => u.id === follower.id)!.data as { path: Point[] }).path
    expect(path).toEqual([
      [-0.5, 0, 0],
      [1, 0, 0],
      [1, 0, 3],
      [3.5, 0, 3],
    ])
  })

  test('a fitting reached from both collars rebroadcasts its final compatible rigid delta', () => {
    const moved = makeNode('duct-segment', {
      path: [
        [-0.2, 0, 0],
        [0.2, 0, 0],
      ],
      system: 'supply',
    })
    const fitting = makeNode('duct-tee', { position: [0, 0, 0], system: 'supply' })
    const downstream = makeNode('duct-segment', {
      path: [
        [0, 0, 0.2],
        [3, 0, 0.2],
      ],
      system: 'supply',
    })
    const nodes = sceneOf(moved, fitting, downstream)
    const connectivity = analyzePortConnectivity(moved, nodes)
    const preview = {
      ...(moved as Record<string, unknown>),
      path: [
        [-0.2, 0, 1],
        [0.2, 0, 1.00005],
      ],
    } as AnyNode

    const updates = resolveConnectivityUpdates(connectivity, preview)

    expectPointClose(
      (updates.find((u) => u.id === fitting.id)!.data as { position: Point }).position,
      [0, 0, 1.000025],
    )
    const path = (updates.find((u) => u.id === downstream.id)!.data as { path: Point[] }).path
    expectPointClose(path[0]!, [0, 0, 1.200025])
    expectPointClose(path[1]!, [3, 0, 1.200025])
  })

  test('a fitting reached from incompatible collars merges constraints deterministically', () => {
    const moved = makeNode('duct-segment', {
      path: [
        [-0.2, 0, 0],
        [0.2, 0, 0],
      ],
      system: 'supply',
    })
    const fitting = makeNode('duct-fitting', { position: [0, 0, 0], system: 'supply' })
    const nodes = sceneOf(moved, fitting)
    const connectivity = analyzePortConnectivity(moved, nodes)
    const preview = {
      ...(moved as Record<string, unknown>),
      path: [
        [-0.2, 0, 1],
        [0.2, 0, -1],
      ],
    } as AnyNode

    const updates = resolveConnectivityUpdates(connectivity, preview)

    expectPointClose(
      (updates.find((u) => u.id === fitting.id)!.data as { position: Point }).position,
      [0, 0, 0],
    )
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
