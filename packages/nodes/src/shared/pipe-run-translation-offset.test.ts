import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  PipeFittingNode,
  PipeSegmentNode,
  type PortConnection,
} from '@pascal-app/core'
import { getPipeFittingPorts } from '../pipe-fitting/ports'
import { planPipeElbowAtPort } from './auto-fitting'
import { planPipeRunTranslationOffsets } from './pipe-run-translation-offset'
import type { ScenePort } from './ports'

type Point = [number, number, number]

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

function distSq(a: readonly number[], b: readonly number[]): number {
  const dx = a[0]! - b[0]!
  const dy = a[1]! - b[1]!
  const dz = a[2]! - b[2]!
  return dx * dx + dy * dy + dz * dz
}

describe('planPipeRunTranslationOffsets', () => {
  test('slides a connected pipe sideways by adding bends and a connector', () => {
    const moved = drain([
      [0, 0, 0],
      [4, 0, 0],
    ])
    const partner = drain([
      [-4, 0, 0],
      [0, 0, 0],
    ])
    const translatedPath = moved.path.map((p) => [p[0], p[1], p[2] - 1.2] as Point)

    const result = planPipeRunTranslationOffsets({
      pipe: moved,
      translatedPath,
      profile: { diameter: moved.diameter, pipeMaterial: moved.pipeMaterial },
      connections: [runConnection(partner)],
      scenePorts: [runPort(partner, [0, 0, 0], [1, 0, 0])],
      nodesById: {
        [moved.id]: moved as AnyNode,
        [partner.id]: partner as AnyNode,
      },
    })

    expect(result).not.toBeNull()
    if (!result) return
    expect(result.fittings).toHaveLength(2)
    expect(result.connectors).toHaveLength(1)
    expect(result.updates.some((u) => u.id === partner.id)).toBe(true)
    expect(result.pipePath[0]![2]).toBeLessThan(0)
  })

  test('re-aims an existing pipe elbow and inserts the missing connector', () => {
    const elbowPlan = planPipeElbowAtPort(portLike([0, 0, 0], [1, 0, 0]), [0, 0, -1], 3, 'pvc')
    expect(elbowPlan).toBeTruthy()
    if (!elbowPlan) return
    const elbow = PipeFittingNode.parse(elbowPlan.fitting)
    const branchPort = getPipeFittingPorts(elbow).find(
      (p) => distSq(p.position, elbowPlan.collarPoint) < 1e-9,
    )!
    const moved = drain([
      [...branchPort.position],
      [branchPort.position[0] + 4, branchPort.position[1], branchPort.position[2]],
    ])
    const translatedPath = moved.path.map((p) => [p[0], p[1], p[2] - 1.2] as Point)

    const result = planPipeRunTranslationOffsets({
      pipe: moved,
      translatedPath,
      profile: { diameter: moved.diameter, pipeMaterial: moved.pipeMaterial },
      connections: [fittingConnection(elbow)],
      scenePorts: [{ ...branchPort, nodeId: elbow.id }],
      nodesById: {
        [moved.id]: moved as AnyNode,
        [elbow.id]: elbow as AnyNode,
      },
    })

    expect(result).not.toBeNull()
    if (!result) return
    expect(result.fittings).toHaveLength(1)
    expect(result.connectors).toHaveLength(1)
    expect(result.updates.some((u) => u.id === elbow.id)).toBe(true)
  })
})
