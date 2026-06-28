import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  DuctFittingNode,
  DuctSegmentNode,
  type PortConnection,
} from '@pascal-app/core'
import { getDuctFittingPorts } from '../duct-fitting/ports'
import { type DuctProfile, planElbowAtPort, profileDiameterIn } from './auto-fitting'
import type { ScenePort } from './ports'
import { planRunTranslationOffsets } from './run-translation-offset'

type Point = [number, number, number]

const RECT_PROFILE: DuctProfile = { shape: 'rect', diameter: 6, width: 14, height: 8 }

function rectRun(path: Point[]): DuctSegmentNode {
  return DuctSegmentNode.parse({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    name: 'Trunk',
    path,
    shape: 'rect',
    diameter: 6,
    width: 14,
    height: 8,
    roll: 0,
    ductMaterial: 'sheet-metal',
    insulationR: 0,
    system: 'supply',
  })
}

function runConnection(run: DuctSegmentNode): PortConnection {
  return {
    kind: 'run',
    nodeId: run.id,
    startPath: run.path,
  }
}

function fittingConnection(fitting: DuctFittingNode): PortConnection {
  return {
    kind: 'rigid-node',
    nodeId: fitting.id,
    startPosition: fitting.position,
  }
}

function runPort(run: DuctSegmentNode, point: Point, direction: Point): ScenePort {
  return {
    id: 'end',
    nodeId: run.id,
    position: point,
    direction,
    diameter: 12,
    system: 'supply',
  }
}

function portLike(position: Point, direction: Point): ScenePort {
  return {
    id: 'x',
    nodeId: 'x' as AnyNode['id'],
    position,
    direction,
    diameter: 12,
    system: 'supply',
  }
}

function distSq(a: readonly number[], b: readonly number[]): number {
  const dx = a[0]! - b[0]!
  const dy = a[1]! - b[1]!
  const dz = a[2]! - b[2]!
  return dx * dx + dy * dy + dz * dz
}

describe('planRunTranslationOffsets', () => {
  test('slides a connected run sideways by adding elbows and a connector', () => {
    const moved = rectRun([
      [0, 0, 0],
      [4, 0, 0],
    ])
    const partner = rectRun([
      [-4, 0, 0],
      [0, 0, 0],
    ])
    const translatedPath = moved.path.map((p) => [p[0], p[1], p[2] - 1.2] as Point)

    const result = planRunTranslationOffsets({
      duct: moved,
      translatedPath,
      profile: RECT_PROFILE,
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
    expect(result.ductPath[0]![2]).toBeLessThan(0)
    expect(result.connectors[0]!.path[0]![2]).toBeLessThan(0)
    expect(result.connectors[0]!.path[1]![2]).toBeGreaterThan(-1.2)
    expect(result.connectors[0]!.path[0]![2]).toBeGreaterThan(result.connectors[0]!.path[1]![2])
  })

  test('re-aims an existing elbow and inserts the missing connector', () => {
    const elbowPlan = planElbowAtPort(portLike([0, 0, 0], [1, 0, 0]), [0, 0, -1], RECT_PROFILE)
    expect(elbowPlan).toBeTruthy()
    if (!elbowPlan) return
    const elbow = DuctFittingNode.parse({
      ...elbowPlan.fitting,
      diameter: profileDiameterIn(RECT_PROFILE),
      diameter2: profileDiameterIn(RECT_PROFILE),
    })
    const branchPort = getDuctFittingPorts(elbow).find(
      (p) => distSq(p.position, elbowPlan.collarPoint) < 1e-9,
    )!
    const moved = rectRun([
      [...branchPort.position],
      [branchPort.position[0] + 4, branchPort.position[1], branchPort.position[2]],
    ])
    const translatedPath = moved.path.map((p) => [p[0], p[1], p[2] - 1.2] as Point)

    const result = planRunTranslationOffsets({
      duct: moved,
      translatedPath,
      profile: RECT_PROFILE,
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
