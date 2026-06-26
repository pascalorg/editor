import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  PipeFittingNode,
  PipeSegmentNode,
  type PortConnection,
} from '@pascal-app/core'
import { getPipeFittingPorts } from '../pipe-fitting/ports'
import { planPipeElbowAtPort } from './auto-fitting'
import { planVerticalOffsets } from './pipe-vertical-offset'
import type { ScenePort } from './ports'

type Point = [number, number, number]

function distSq(a: readonly number[], b: readonly number[]): number {
  const dx = a[0]! - b[0]!
  const dy = a[1]! - b[1]!
  const dz = a[2]! - b[2]!
  return dx * dx + dy * dy + dz * dz
}

function drain(path: Point[]): PipeSegmentNode {
  return PipeSegmentNode.parse({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    name: 'Drain',
    path,
    diameter: 3,
    pipeMaterial: 'pvc',
    system: 'waste',
  })
}

function portLike(position: Point, direction: Point): ScenePort {
  return {
    id: 'x',
    nodeId: 'x' as AnyNode['id'],
    position,
    direction,
    diameter: 3,
    system: 'waste',
  }
}

function runConnection(run: PipeSegmentNode): PortConnection {
  return {
    kind: 'run',
    nodeId: run.id,
    startPath: run.path,
  }
}

function fittingConnection(fitting: PipeFittingNode): PortConnection {
  return {
    kind: 'rigid-node',
    nodeId: fitting.id,
    startPosition: fitting.position,
  }
}

function runPort(run: PipeSegmentNode, point: Point, direction: Point): ScenePort {
  return {
    id: 'end',
    nodeId: run.id,
    position: point,
    direction,
    diameter: run.diameter,
    system: run.system,
  }
}

function branchFitting(fittingType: 'wye' | 'sanitary-tee' | 'cross'): PipeFittingNode {
  return PipeFittingNode.parse({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    name: fittingType,
    fittingType,
    diameter: 3,
    diameter2: 3,
    pipeMaterial: 'pvc',
    system: 'waste',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    angle: 90,
  })
}

describe('planPipeVerticalOffsets', () => {
  test('mints a pipe bend-riser-bend offset for a run-connected lift', () => {
    const moved = drain([
      [0, 0, 0],
      [4, 0, 0],
    ])
    const partner = drain([
      [-4, 0, 0],
      [0, 0, 0],
    ])

    const result = planVerticalOffsets({
      pipe: moved,
      dy: 1.2,
      profile: { diameter: moved.diameter, pipeMaterial: moved.pipeMaterial },
      connections: [runConnection(partner)],
      scenePorts: [runPort(partner, [0, 0, 0], [1, 0, 0])],
      nodesById: {
        [moved.id]: moved as AnyNode,
        [partner.id]: partner as AnyNode,
      },
    })

    expect(result?.status).toBe('valid')
    if (result?.status !== 'valid') return
    expect(result.plan.fittings).toHaveLength(2)
    expect(result.plan.risers).toHaveLength(1)
    expect(result.plan.fittings.every((f) => f.type === 'pipe-fitting')).toBe(true)
    expect(result.plan.risers[0]?.type).toBe('pipe-segment')
  })

  test('re-aims an existing pipe elbow before routing the vertical L', () => {
    const elbow = PipeFittingNode.parse({
      object: 'node',
      parentId: null,
      visible: true,
      metadata: {},
      name: 'Bend',
      fittingType: 'elbow',
      diameter: 3,
      diameter2: 3,
      pipeMaterial: 'pvc',
      system: 'waste',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      angle: 90,
    })
    const inlet = getPipeFittingPorts(elbow).find((p) => p.id === 'inlet')!
    const moved = drain([
      [...inlet.position],
      [inlet.position[0] - 4, inlet.position[1], inlet.position[2]],
    ])

    const result = planVerticalOffsets({
      pipe: moved,
      dy: 1.2,
      profile: { diameter: moved.diameter, pipeMaterial: moved.pipeMaterial },
      connections: [fittingConnection(elbow)],
      scenePorts: [{ ...inlet, nodeId: elbow.id }],
      nodesById: {
        [moved.id]: moved as AnyNode,
        [elbow.id]: elbow as AnyNode,
      },
    })

    expect(result?.status).toBe('valid')
    if (result?.status !== 'valid') return
    expect(result.plan.fittings).toHaveLength(1)
    expect(result.plan.risers).toHaveLength(1)
    expect(result.plan.updates.some((u) => u.id === elbow.id)).toBe(true)
  })

  test.each([
    { fittingType: 'wye' as const, portId: 'branch' },
    { fittingType: 'sanitary-tee' as const, portId: 'branch' },
    { fittingType: 'cross' as const, portId: 'branch' },
  ])('routes a vertical offset from a stationary $fittingType collar', ({
    fittingType,
    portId,
  }) => {
    const fitting = branchFitting(fittingType)
    const ports = getPipeFittingPorts(fitting)
    const branch = ports.find((p) => p.id === portId)!
    const moved = drain([
      [...branch.position],
      [
        branch.position[0] + branch.direction[0] * 4,
        branch.position[1] + branch.direction[1] * 4,
        branch.position[2] + branch.direction[2] * 4,
      ],
    ])

    const result = planVerticalOffsets({
      pipe: moved,
      dy: 1.2,
      profile: { diameter: moved.diameter, pipeMaterial: moved.pipeMaterial },
      connections: [fittingConnection(fitting)],
      scenePorts: ports.map((p) => ({ ...p, nodeId: fitting.id })),
      nodesById: {
        [moved.id]: moved as AnyNode,
        [fitting.id]: fitting as AnyNode,
      },
    })

    expect(result?.status).toBe('valid')
    if (result?.status !== 'valid') return
    expect(result.plan.fittings).toHaveLength(2)
    expect(result.plan.risers).toHaveLength(1)
    expect(result.plan.updates.some((u) => u.id === fitting.id)).toBe(false)

    const bottomPorts = getPipeFittingPorts(result.plan.fittings[0]!)
    const topPorts = getPipeFittingPorts(result.plan.fittings[1]!)
    const riser = result.plan.risers[0]!
    expect(bottomPorts.some((p) => distSq(p.position, branch.position) < 1e-9)).toBe(true)
    expect(bottomPorts.some((p) => distSq(p.position, riser.path[0]!) < 1e-9)).toBe(true)
    expect(topPorts.some((p) => distSq(p.position, riser.path[1]!) < 1e-9)).toBe(true)
    expect(topPorts.some((p) => distSq(p.position, result.plan.pipePath[0]!) < 1e-9)).toBe(true)
  })

  test('continues routing after a pipe riser collapse without needing a new drag', () => {
    const bottom = planPipeElbowAtPort(portLike([0, 0, 0], [1, 0, 0]), [0, 1, 0], 3, 'pvc')
    expect(bottom).toBeTruthy()
    if (!bottom) return

    const bottomPorts = getPipeFittingPorts(bottom.fitting)
    const riserTop: Point = [bottom.collarPoint[0], 1.2, bottom.collarPoint[2]]
    const riser = drain([bottom.collarPoint, riserTop])
    const topRun = drain([riserTop, [4, riserTop[1], riserTop[2]]])

    const result = planVerticalOffsets({
      pipe: topRun,
      dy: -2.4,
      profile: { diameter: topRun.diameter, pipeMaterial: topRun.pipeMaterial },
      connections: [runConnection(riser), fittingConnection(bottom.fitting)],
      scenePorts: [
        ...bottomPorts.map((p) => ({ ...p, nodeId: bottom.fitting.id })),
        runPort(riser, bottom.collarPoint, [0, -1, 0]),
        runPort(riser, riserTop, [0, 1, 0]),
      ],
      nodesById: {
        [topRun.id]: topRun as AnyNode,
        [riser.id]: riser as AnyNode,
        [bottom.fitting.id]: bottom.fitting as AnyNode,
      },
    })

    expect(result?.status).toBe('valid')
    if (result?.status !== 'valid') return
    expect(result.plan.dy).toBeCloseTo(-2.4, 6)
    expect(result.plan.delete).toEqual(expect.arrayContaining([riser.id]))
    expect(result.plan.fittings.length).toBeGreaterThan(0)
    expect(result.plan.risers.length).toBeGreaterThan(0)
  })
})
