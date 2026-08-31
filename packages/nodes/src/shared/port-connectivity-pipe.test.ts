import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  analyzePortConnectivity,
  DuctSegmentNode,
  loadPlugin,
  nodeRegistry,
  PipeFittingNode,
  PipeSegmentNode,
  PipeTrapNode,
  resolveConnectivityUpdates,
} from '@pascal-app/core'
import { builtinPlugin } from '../index'

type Port = { id: string; position: [number, number, number] }

function portsOf(kind: string, node: AnyNode): ReadonlyArray<Port> {
  return nodeRegistry.get(kind)!.ports!(node) as ReadonlyArray<Port>
}

function wasteTee(): PipeFittingNode {
  return PipeFittingNode.parse({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    fittingType: 'sanitary-tee',
    diameter: 2,
    diameter2: 2,
    pipeMaterial: 'pvc',
    system: 'waste',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
  })
}

function pipeRunFrom(point: [number, number, number], system: 'waste' | 'vent' = 'waste') {
  return PipeSegmentNode.parse({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    diameter: 2,
    pipeMaterial: 'pvc',
    system,
    path: [point, [point[0] + 3, point[1], point[2]]],
  })
}

/**
 * Regression coverage for the generalized (HVAC duct + DWV pipe)
 * port-connectivity service. Before PR #402's follow-up fix the service
 * only tracked `duct-segment` / `duct-fitting`, so moving a `pipe-fitting`
 * left attached `pipe-segment` endpoints behind. These tests assert the
 * role-based generalization carries pipe runs along without fusing unrelated
 * systems or anchored trap fixtures.
 */
describe('port connectivity — DWV pipe family', () => {
  beforeEach(async () => {
    nodeRegistry._reset()
    await loadPlugin(builtinPlugin)
  })

  afterEach(() => {
    nodeRegistry._reset()
  })

  test('moving a pipe-fitting carries the connected pipe-segment along', () => {
    // A sanitary tee at the origin; its run ports sit on ±X at the hub legs.
    const fitting = wasteTee()
    const outlet = portsOf('pipe-fitting', fitting as AnyNode).find((p) => p.id === 'outlet')!

    // A pipe run whose START port coincides with the fitting's outlet collar.
    const run = pipeRunFrom(outlet.position)

    const nodes: Record<string, AnyNode> = {
      [fitting.id]: fitting as AnyNode,
      [run.id]: run as AnyNode,
    }

    const connectivity = analyzePortConnectivity(fitting as AnyNode, nodes)
    // The run must be picked up as a carried partner.
    const endpoint = connectivity.connections.find((c) => c.kind === 'run' && c.nodeId === run.id)
    expect(endpoint).toBeDefined()

    // Move the fitting +1m in Z. That delta is PERPENDICULAR to the run's
    // X-axis, so the whole run translates +Z (preserving direction, no skew).
    const moved = { ...(fitting as Record<string, unknown>), position: [0, 0, 1] } as AnyNode
    const updates = resolveConnectivityUpdates(connectivity, moved)
    const runUpdate = updates.find((u) => u.id === run.id)
    expect(runUpdate).toBeDefined()
    const newPath = (runUpdate!.data as { path: [number, number, number][] }).path
    // Both endpoints rode +1m in Z; the run kept its length and direction.
    expect(newPath[0]![2]).toBeCloseTo(outlet.position[2] + 1, 6)
    expect(newPath[1]![2]).toBeCloseTo(outlet.position[2] + 1, 6)
  })

  test('incompatible systems do not fuse (a supply duct is not dragged by a waste fitting)', () => {
    const fitting = wasteTee()
    const outlet = portsOf('pipe-fitting', fitting as AnyNode).find((p) => p.id === 'outlet')!

    // A supply duct sharing the same point but a different distribution system.
    const duct = DuctSegmentNode.parse({
      object: 'node',
      parentId: null,
      visible: true,
      metadata: {},
      diameter: 6,
      ductMaterial: 'flex',
      system: 'supply',
      path: [outlet.position, [outlet.position[0] + 3, outlet.position[1], outlet.position[2]]],
    })

    const nodes: Record<string, AnyNode> = {
      [fitting.id]: fitting as AnyNode,
      [duct.id]: duct as AnyNode,
    }
    const connectivity = analyzePortConnectivity(fitting as AnyNode, nodes)
    expect(connectivity.connections.find((c) => c.nodeId === duct.id)).toBeUndefined()
  })

  test('pipe-trap is anchored when a connected pipe endpoint moves', () => {
    const trap = PipeTrapNode.parse({
      object: 'node',
      parentId: null,
      visible: true,
      metadata: {},
      position: [0, 0, 0],
      rotation: 0,
      diameter: 1.5,
      pipeMaterial: 'pvc',
      armLengthM: 0,
    })
    const outlet = portsOf('pipe-trap', trap as AnyNode).find((p) => p.id === 'outlet')!
    const run = pipeRunFrom(outlet.position)

    const nodes: Record<string, AnyNode> = {
      [trap.id]: trap as AnyNode,
      [run.id]: run as AnyNode,
    }

    // Moving the run endpoint must not translate the fixed-position trap.
    const runConnectivity = analyzePortConnectivity(run as AnyNode, nodes)
    expect(runConnectivity.connections.find((c) => c.nodeId === trap.id)).toBeUndefined()

    // Moving the trap itself still stretches the connected run endpoint.
    const trapConnectivity = analyzePortConnectivity(trap as AnyNode, nodes)
    expect(trapConnectivity.connections.find((c) => c.nodeId === run.id)).toBeDefined()
  })
})
