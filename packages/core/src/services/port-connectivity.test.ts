import { afterAll, describe, expect, test } from 'bun:test'
import type { AnyNodeDefinition, DistributionRole, NodePort } from '../registry'
import { nodeRegistry, registerNode } from '../registry'
import type { AnyNode, AnyNodeId } from '../schema'
import { analyzePortConnectivity, resolveConnectivityUpdates } from './port-connectivity'

type Point = [number, number, number]

const restoreRegistry = nodeRegistry._snapshot()
afterAll(() => restoreRegistry())

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

  test('a fitting its own collars pull apart cannot follow', () => {
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

    expect(resolveConnectivityUpdates(connectivity, preview)).toBeNull()
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

// A corner elbow whose collars sit at the node's own offsets from its position.
stubDef('test:corner-elbow', 'fitting', (node) => {
  const { position, collars, system } = node as unknown as {
    position: Point
    collars: Point[]
    system: string
  }
  return collars.map((offset, index) => ({
    id: index === 0 ? 'inlet' : 'outlet',
    position: [position[0] + offset[0], position[1] + offset[1], position[2] + offset[2]],
    direction: offset,
    diameter: 6,
    system,
  }))
})

describe('port connectivity — closed loops', () => {
  // A square loop of four legs and four corner elbows. The west and north legs
  // fall `drop` metres toward the north-west corner; the south leg is moved.
  function loop(drop: number) {
    const low = 1 - drop
    const corner = (position: Point, collars: Point[]) =>
      makeNode('test:corner-elbow', { position, collars, system: 'supply' })
    const leg = (path: Point[]) => makeNode('duct-segment', { path, system: 'supply' })
    const south = leg([
      [0.2, 1, 0],
      [3.8, 1, 0],
    ])
    const others = [
      corner(
        [4, 1, 0],
        [
          [-0.2, 0, 0],
          [0, 0, 0.2],
        ],
      ),
      leg([
        [4, 1, 0.2],
        [4, 1, 3.8],
      ]),
      corner(
        [4, 1, 4],
        [
          [0, 0, -0.2],
          [-0.2, 0, 0],
        ],
      ),
      leg([
        [0.2, low, 4],
        [3.8, 1, 4],
      ]),
      corner(
        [0, low, 4],
        [
          [0.2, 0, 0],
          [0, 0, -0.2],
        ],
      ),
      leg([
        [0, 1, 0.2],
        [0, low, 3.8],
      ]),
      corner(
        [0, 1, 0],
        [
          [0.2, 0, 0],
          [0, 0, 0.2],
        ],
      ),
    ]
    return { south, nodes: sceneOf(south, ...others) }
  }

  function moveSouth(drop: number, delta: Point) {
    const { south, nodes } = loop(drop)
    const preview = {
      ...(south as Record<string, unknown>),
      path: (south as unknown as { path: Point[] }).path.map((p) => [
        p[0] + delta[0],
        p[1] + delta[1],
        p[2] + delta[2],
      ]),
    } as AnyNode
    const updates = resolveConnectivityUpdates(analyzePortConnectivity(south, nodes), preview)
    const after: Record<string, AnyNode> = { ...nodes, [south.id]: preview }
    for (const update of updates) after[update.id] = { ...after[update.id]!, ...update.data }
    return { nodes, updates, after }
  }

  test('a leg moved along its own axis carries a loop with a sloped leg rigidly', () => {
    const delta: Point = [0.5, 0, 0]
    const { nodes, updates } = moveSouth(0.08, delta)

    expect(updates).toHaveLength(7)
    for (const { id, data } of updates) {
      const before = nodes[id] as unknown as { position?: Point; path?: Point[] }
      const next = data as { position?: Point; path?: Point[] }
      if (before.position) {
        expectPointClose(next.position!, [
          before.position[0] + delta[0],
          before.position[1],
          before.position[2],
        ])
      }
      before.path?.forEach((point, index) => {
        expectPointClose(next.path![index]!, [point[0] + delta[0], point[1], point[2]])
      })
    }
  })

  test.each([
    ['a level loop moved obliquely', 0, [0.3, -0.1, 0.4]],
    ['a sloped loop raised', 0.08, [0, 0.2, 0]],
    ['a sloped loop moved diagonally in plan', 0.08, [-0.4, 0, 0.6]],
  ] as Array<[string, number, Point]>)('%s settles with every joint welded', (_, drop, delta) => {
    const { after } = moveSouth(drop, delta)

    const runEnds = Object.values(after)
      .filter((node) => node.type === 'duct-segment')
      .flatMap((node) => nodeRegistry.get('duct-segment')!.ports!(node as never))
    const collars = Object.values(after)
      .filter((node) => node.type === 'test:corner-elbow')
      .flatMap((node) => nodeRegistry.get('test:corner-elbow')!.ports!(node as never))
    expect(collars).toHaveLength(8)
    for (const collar of collars) {
      const gap = Math.min(
        ...runEnds.map((end) =>
          Math.hypot(
            end.position[0] - collar.position[0],
            end.position[1] - collar.position[1],
            end.position[2] - collar.position[2],
          ),
        ),
      )
      expect(gap).toBeLessThan(1e-6)
    }
  })
})

/** Largest distance from any port of `after` to its nearest mate, for the
 *  joints that coincided in `before`. */
function widestJointGap(before: Record<string, AnyNode>, after: Record<string, AnyNode>): number {
  const portsOf = (node: AnyNode) =>
    nodeRegistry.get(node.type)!.ports!(node as never) as Array<{ id: string; position: Point }>
  const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  let widest = 0
  for (const a of Object.values(before)) {
    for (const b of Object.values(before)) {
      if (a.id >= b.id) continue
      for (const pa of portsOf(a)) {
        for (const pb of portsOf(b)) {
          if (distance(pa.position, pb.position) > 1e-6) continue
          const na = portsOf(after[a.id]!).find((p) => p.id === pa.id)!
          const nb = portsOf(after[b.id]!).find((p) => p.id === pb.id)!
          widest = Math.max(widest, distance(na.position, nb.position))
        }
      }
    }
  }
  return widest
}

describe('port connectivity — polyline runs between fittings', () => {
  const corner = (position: Point) =>
    makeNode('test:corner-elbow', {
      position,
      collars: [
        [-0.07, 0, 0],
        [0, 0, 0.07],
      ],
      system: 'supply',
    })
  const run = (path: Point[]) => makeNode('duct-segment', { path, system: 'supply' })

  // A straight run, a corner, an L-shaped polyline run, a corner and a tail:
  // the far corner only ever follows the L, so it echoes the L's own move.
  function chain() {
    const south = run([
      [0.07, 1, 0],
      [3.93, 1, 0],
    ])
    const l = run([
      [4, 1, 0.07],
      [4, 1, 2],
      [6.93, 1, 2],
    ])
    const nodes = sceneOf(
      south,
      corner([4, 1, 0]),
      l,
      corner([7, 1, 2]),
      run([
        [7, 1, 2.07],
        [7, 1, 5],
      ]),
    )
    return { south, l, nodes }
  }

  function moved(node: AnyNode, path: Point[]): AnyNode {
    return { ...(node as Record<string, unknown>), path } as AnyNode
  }

  function applied(
    nodes: Record<string, AnyNode>,
    preview: AnyNode,
    updates: { id: AnyNodeId; data: Partial<AnyNode> }[],
  ): Record<string, AnyNode> {
    const after: Record<string, AnyNode> = { ...nodes, [preview.id]: preview }
    for (const update of updates) after[update.id] = { ...after[update.id]!, ...update.data }
    return after
  }

  test.each([
    [0.3, 0, 0.4],
    [0.05, 0, 0.05],
    [0.3, 0.2, 0.4],
  ] as Point[])('a diagonal move (%p, %p, %p) carries the L without stretching it', (...delta) => {
    const { south, l, nodes } = chain()
    const preview = moved(
      south,
      (south as unknown as { path: Point[] }).path.map(
        (p) => [p[0] + delta[0], p[1] + delta[1], p[2] + delta[2]] as Point,
      ),
    )

    const updates = resolveConnectivityUpdates(analyzePortConnectivity(south, nodes), preview)

    expect(updates).not.toBeNull()
    const after = applied(nodes, preview, updates!)
    expect(widestJointGap(nodes, after)).toBeLessThan(1e-6)
    const lPath = (after[l.id] as unknown as { path: Point[] }).path
    expect(Math.hypot(lPath[2]![0] - lPath[1]![0], lPath[2]![2] - lPath[1]![2])).toBeCloseTo(
      2.93,
      6,
    )
  })

  test('a loop back to the moved run refuses a drag that would pull its start corner off', () => {
    // The run's end corner leads around a U-shaped run back to its start corner.
    const looped = run([
      [0.07, 1, 0],
      [3.93, 1, 0],
    ])
    const nodes = sceneOf(
      makeNode('test:corner-elbow', {
        position: [0, 1, 0],
        collars: [
          [0.07, 0, 0],
          [0, 0, 0.07],
        ],
        system: 'supply',
      }),
      looped,
      corner([4, 1, 0]),
      run([
        [4, 1, 0.07],
        [4, 1, 2],
        [0, 1, 2],
        [0, 1, 0.07],
      ]),
    )
    const connectivity = analyzePortConnectivity(looped, nodes)
    const endAt = (end: Point) => moved(looped, [[0.07, 1, 0], end])

    // Across the run, the end corner slides the U's first leg; nothing else moves.
    const across = resolveConnectivityUpdates(connectivity, endAt([3.93, 1, 0.3]))
    expect(across).not.toBeNull()
    expect(widestJointGap(nodes, applied(nodes, endAt([3.93, 1, 0.3]), across!))).toBeLessThan(1e-6)
    // Along the run, the U translates whole and would carry the start corner
    // off the run's fixed start.
    expect(resolveConnectivityUpdates(connectivity, endAt([4.43, 1, 0]))).toBeNull()
  })
})

test('kind-owned connectivity keeps fixed neighbors and snapshots custom move followers', () => {
  registerNode({
    kind: 'test:connected-equipment',
    schemaVersion: 1,
    schema: {},
    category: 'utility',
    defaults: () => ({}),
    connectedMove: (_node: AnyNode, preview: AnyNode, nodes: Record<string, AnyNode>) => {
      const position = (preview as unknown as { position: Point }).position
      const path = (nodes['custom_run'] as unknown as { path: Point[] }).path
      return [{ id: 'custom_run' as AnyNodeId, data: { path: [position, path[1]] } }]
    },
  } as unknown as AnyNodeDefinition)
  const equipment = {
    id: 'equipment',
    type: 'test:connected-equipment',
    position: [0, 0, 0],
  } as unknown as AnyNode
  const run = {
    id: 'custom_run',
    type: 'duct-segment',
    path: [
      [0, 0, 0],
      [5, 0, 0],
    ],
  } as unknown as AnyNode
  const snapshot = analyzePortConnectivity(equipment, { [equipment.id]: equipment, [run.id]: run })
  expect(snapshot.connections).toEqual([
    {
      kind: 'run',
      nodeId: 'custom_run',
      startPath: [
        [0, 0, 0],
        [5, 0, 0],
      ],
    },
  ])
  const updated = resolveConnectivityUpdates(snapshot, {
    ...equipment,
    position: [2, 0, 3],
  } as unknown as AnyNode)
  expect(updated).toEqual([
    {
      id: 'custom_run',
      data: {
        path: [
          [2, 0, 3],
          [5, 0, 0],
        ],
      },
    },
  ])
  expect((run as unknown as { path: Point[] }).path).toEqual([
    [0, 0, 0],
    [5, 0, 0],
  ])
})
