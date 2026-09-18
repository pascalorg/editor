import { describe, expect, test } from 'bun:test'
import type { AnyNodeDefinition, DistributionRole, NodePort } from '../registry'
import { registerNode } from '../registry'
import type { AnyNode, AnyNodeId } from '../schema'
import { buildPortComponents, summarizeSystemFor } from './system-graph'

type Point = [number, number, number]

// Stub registrations: the graph consults `def.ports` for the connectivity
// graph and `def.distributionRole` to classify each node. Mirrors the real
// kinds' port + role conventions (duct runs expose start/end, equipment a
// supply collar, terminals one collar) without importing the nodes package.
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

const runPorts = (node: AnyNode): NodePort[] => {
  const path = (node as unknown as { path: Point[] }).path
  const system = (node as unknown as { system: string }).system
  return [
    { id: 'start', position: path[0]!, direction: [-1, 0, 0], diameter: 6, system },
    {
      id: 'end',
      position: path[path.length - 1]!,
      direction: [1, 0, 0],
      diameter: 6,
      system,
    },
  ]
}
stubDef('duct-segment', 'run', runPorts)
stubDef('pipe-segment', 'run', runPorts)
stubDef('hvac-equipment', 'equipment', (node) => {
  const position = (node as unknown as { position: Point }).position
  return [{ id: 'supply', position, direction: [0, 1, 0], diameter: 12, system: 'supply' }]
})
stubDef('duct-terminal', 'terminal', (node) => {
  const position = (node as unknown as { position: Point }).position
  return [{ id: 'collar', position, direction: [0, -1, 0], diameter: 6, system: 'supply' }]
})

let nextId = 0
function makeNode(type: string, fields: Record<string, unknown>): AnyNode {
  nextId += 1
  return { id: `${type}_${nextId}`, type, object: 'node', parentId: null, ...fields } as AnyNode
}

function sceneOf(...nodes: AnyNode[]): Record<AnyNodeId, AnyNode> {
  return Object.fromEntries(nodes.map((n) => [n.id, n])) as Record<AnyNodeId, AnyNode>
}

function run(path: Point[], system = 'supply'): AnyNode {
  return makeNode('duct-segment', { path, system, diameter: 6 })
}

describe('buildPortComponents', () => {
  test('chained runs land in one component; a distant run is separate', () => {
    const a = run([
      [0, 0, 0],
      [3, 0, 0],
    ])
    const b = run([
      [3, 0, 0],
      [3, 0, 4],
    ]) // shares a's end
    const c = run([
      [20, 0, 0],
      [24, 0, 0],
    ]) // far away
    const components = buildPortComponents(sceneOf(a, b, c))
    expect(components.length).toBe(2)
    const joined = components.find((g) => g.length === 2)!
    expect(new Set(joined)).toEqual(new Set([a.id, b.id]))
  })

  test('joints within tolerance still join; outside do not', () => {
    const a = run([
      [0, 0, 0],
      [3, 0, 0],
    ])
    const near = run([
      [3.03, 0, 0],
      [6, 0, 0],
    ]) // 3 cm — joined
    const far = run([
      [3.2, 0, 4],
      [6, 0, 4],
    ]) // 20 cm in another row — separate
    const components = buildPortComponents(sceneOf(a, near, far))
    expect(components.length).toBe(2)
  })

  test('coincident ports with different systems stay separate', () => {
    const supply = run([
      [0, 0, 0],
      [3, 0, 0],
    ])
    const returnRun = run(
      [
        [3, 0, 0],
        [6, 0, 0],
      ],
      'return',
    )
    expect(buildPortComponents(sceneOf(supply, returnRun))).toHaveLength(2)
  })

  test('matching local coordinates on separate floors stay separate', () => {
    const lower = makeNode('level', { level: 0, height: 3, children: [] })
    const upper = makeNode('level', { level: 1, height: 3, children: [] })
    const a = {
      ...run([
        [0, 0, 0],
        [3, 0, 0],
      ]),
      parentId: lower.id,
    }
    const b = {
      ...run([
        [0, 0, 0],
        [3, 0, 0],
      ]),
      parentId: upper.id,
    }
    expect(buildPortComponents(sceneOf(lower, upper, a, b))).toHaveLength(2)
  })

  test('a waste stack connects across floors at their actual elevation', () => {
    const lower = makeNode('level', { level: 0, height: 3, baseElevation: 0.5, children: [] })
    const upper = makeNode('level', { level: 1, height: 3, baseElevation: 0.2, children: [] })
    const a = makeNode('pipe-segment', {
      path: [
        [0, 0, 0],
        [0, 3.2, 0],
      ],
      system: 'waste',
      parentId: lower.id,
    })
    const b = makeNode('pipe-segment', {
      path: [
        [0, 0, 0],
        [0, 2, 0],
      ],
      system: 'waste',
      parentId: upper.id,
    })
    expect(buildPortComponents(sceneOf(lower, upper, a, b))).toEqual([[a.id, b.id]])
  })

  test('building rotation and translation determine the joint position', () => {
    const building = makeNode('building', {
      position: [10, 0, 0],
      rotation: [0, Math.PI / 2, 0],
      children: [],
    })
    const level = makeNode('level', { parentId: building.id, level: 0, height: 3, children: [] })
    const a = {
      ...run([
        [0, 0, 0],
        [2, 0, 0],
      ]),
      parentId: level.id,
    }
    const b = run([
      [10, 0, -2],
      [10, 0, -4],
    ])
    const unrelated = run([
      [2, 0, 0],
      [4, 0, 0],
    ])
    const groups = buildPortComponents(sceneOf(building, level, a, b, unrelated))
    expect(groups).toEqual([[a.id, b.id], [unrelated.id]])
  })

  test('nodes without ports do not participate', () => {
    const wall = makeNode('wall', {})
    const a = run([
      [0, 0, 0],
      [3, 0, 0],
    ])
    const components = buildPortComponents(sceneOf(wall, a))
    expect(components.length).toBe(1)
    expect(components[0]).toEqual([a.id])
  })
})

describe('summarizeSystemFor', () => {
  test('full tree: equipment → run → terminal, stats add up', () => {
    const furnace = makeNode('hvac-equipment', { position: [0, 0, 0] as Point })
    const trunk = run([
      [0, 0, 0],
      [4, 0, 0],
    ])
    const branch = run([
      [4, 0, 0],
      [4, 0, 3],
    ])
    const register = makeNode('duct-terminal', {
      position: [4, 0, 3] as Point,
      terminalType: 'supply-register',
    })
    const scene = sceneOf(furnace, trunk, branch, register)

    const summary = summarizeSystemFor(register.id, scene)!
    expect(summary.nodeIds.length).toBe(4)
    expect(summary.connectedToEquipment).toBe(true)
    expect(summary.runCount).toBe(2)
    expect(summary.runLengthM).toBeCloseTo(7, 6)
    expect(summary.terminalCount).toBe(1)
    expect(summary.equipmentCount).toBe(1)
    expect(summary.systems).toEqual(['supply'])
  })

  test('orphaned run reports no equipment', () => {
    const lonely = run([
      [10, 0, 10],
      [14, 0, 10],
    ])
    const summary = summarizeSystemFor(lonely.id, sceneOf(lonely))!
    expect(summary.connectedToEquipment).toBe(false)
    expect(summary.runCount).toBe(1)
    expect(summary.runLengthM).toBeCloseTo(4, 6)
  })

  test('port-less node → null', () => {
    const wall = makeNode('wall', {})
    expect(summarizeSystemFor(wall.id, sceneOf(wall))).toBeNull()
  })
})
