import { beforeAll, describe, expect, test } from 'bun:test'
import {
  analyzePortConnectivity,
  type AnyNode,
  loadPlugin,
  nodeRegistry,
  PipeFittingNode,
  PipeSegmentNode,
  resolveConnectivityUpdates,
} from '@pascal-app/core'
import { builtinPlugin } from '../index'

/**
 * Regression coverage for the generalized (HVAC duct + DWV pipe)
 * port-connectivity service. Before PR #402's follow-up fix the service
 * only tracked `duct-segment` / `duct-fitting`, so moving a `pipe-fitting`
 * left attached `pipe-segment` endpoints behind. These tests assert the
 * role-based generalization carries pipe runs along.
 */
describe('port connectivity — DWV pipe family', () => {
  beforeAll(async () => {
    nodeRegistry._reset()
    await loadPlugin(builtinPlugin)
  })

  test('moving a pipe-fitting stretches the connected pipe-segment endpoint', () => {
    // A sanitary tee at the origin; its run ports sit on ±X at the hub legs.
    const fitting = PipeFittingNode.parse({
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

    const fittingPorts = nodeRegistry.get('pipe-fitting')!.ports!(fitting) as ReadonlyArray<{
      id: string
      position: [number, number, number]
    }>
    const outlet = fittingPorts.find((p) => p.id === 'outlet')!

    // A pipe run whose START port coincides with the fitting's outlet collar.
    const run = PipeSegmentNode.parse({
      object: 'node',
      parentId: null,
      visible: true,
      metadata: {},
      diameter: 2,
      pipeMaterial: 'pvc',
      system: 'waste',
      path: [
        [outlet.position[0], outlet.position[1], outlet.position[2]],
        [outlet.position[0] + 3, outlet.position[1], outlet.position[2]],
      ],
    })

    const nodes: Record<string, AnyNode> = {
      [fitting.id]: fitting as AnyNode,
      [run.id]: run as AnyNode,
    }

    const connectivity = analyzePortConnectivity(fitting as AnyNode, nodes)
    // The run must be picked up as a stretchable endpoint partner.
    const endpoint = connectivity.connections.find(
      (c) => c.kind === 'duct-endpoint' && c.nodeId === run.id,
    )
    expect(endpoint).toBeDefined()

    // Move the fitting +1m in Z; the run's mated endpoint should follow.
    const moved = { ...(fitting as Record<string, unknown>), position: [0, 0, 1] } as AnyNode
    const updates = resolveConnectivityUpdates(connectivity, moved)
    const runUpdate = updates.find((u) => u.id === run.id)
    expect(runUpdate).toBeDefined()
    const newPath = (runUpdate!.data as { path: [number, number, number][] }).path
    // Tracked endpoint moved by the same +1m in Z; far end stayed put.
    expect(newPath[0]![2]).toBeCloseTo(outlet.position[2] + 1, 6)
    expect(newPath[1]![2]).toBeCloseTo(outlet.position[2], 6)
  })

  test('incompatible systems do not fuse (a supply duct is not dragged by a waste fitting)', () => {
    const fitting = PipeFittingNode.parse({
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
    const fittingPorts = nodeRegistry.get('pipe-fitting')!.ports!(fitting) as ReadonlyArray<{
      id: string
      position: [number, number, number]
    }>
    const outlet = fittingPorts.find((p) => p.id === 'outlet')!

    // A vent pipe sharing the same point but a different system.
    const ventRun = PipeSegmentNode.parse({
      object: 'node',
      parentId: null,
      visible: true,
      metadata: {},
      diameter: 2,
      pipeMaterial: 'pvc',
      system: 'vent',
      path: [
        [outlet.position[0], outlet.position[1], outlet.position[2]],
        [outlet.position[0] + 3, outlet.position[1], outlet.position[2]],
      ],
    })

    const nodes: Record<string, AnyNode> = {
      [fitting.id]: fitting as AnyNode,
      [ventRun.id]: ventRun as AnyNode,
    }
    const connectivity = analyzePortConnectivity(fitting as AnyNode, nodes)
    expect(connectivity.connections.find((c) => c.nodeId === ventRun.id)).toBeUndefined()
  })
})
