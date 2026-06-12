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

stubDef('duct-segment', 'run', (node) => {
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
})
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
