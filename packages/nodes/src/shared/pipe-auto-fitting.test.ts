import { describe, expect, test } from 'bun:test'
import { PipeSegmentNode } from '@pascal-app/core'
import { getPipeFittingPorts } from '../pipe-fitting/ports'
import { planPipeBranchTap, planPipeElbowAtPort } from './auto-fitting'
import type { RunBodyHit, ScenePort } from './ports'

type Point = [number, number, number]

function port(position: Point, direction: Point): ScenePort {
  return {
    id: 'end',
    nodeId: 'pipe-segment_test' as ScenePort['nodeId'],
    position,
    direction,
    diameter: 2,
    system: 'waste',
  }
}

function drain(path: Point[], system: 'waste' | 'vent' = 'waste'): PipeSegmentNode {
  return PipeSegmentNode.parse({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    name: 'Drain',
    path,
    diameter: 3,
    pipeMaterial: 'pvc',
    system,
  })
}

function dist(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!)
}

function dot(a: readonly number[], b: readonly number[]): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!
}

describe('planPipeElbowAtPort', () => {
  test('90° bend mates both collars through the fitting port math', () => {
    const plan = planPipeElbowAtPort(port([3, -0.05, 0], [1, 0, 0]), [0, 0, 1], 2)
    expect(plan).not.toBeNull()
    const ports = getPipeFittingPorts(plan!.fitting)
    const inlet = ports.find((p) => p.id === 'inlet')!
    const outlet = ports.find((p) => p.id === 'outlet')!
    expect(dist(plan!.fitting.position, [3, -0.05, 0])).toBeLessThan(1e-6)
    expect(dist(inlet.position, plan!.trimmedPortPoint)).toBeLessThan(1e-6)
    expect(dot(inlet.direction, [1, 0, 0])).toBeCloseTo(-1, 6)
    expect(dist(outlet.position, plan!.collarPoint)).toBeLessThan(1e-6)
    expect(dot(outlet.direction, [0, 0, 1])).toBeCloseTo(1, 6)
    expect(plan!.fitting.system).toBe('waste')
  })

  test('straight continuation → no fitting', () => {
    expect(planPipeElbowAtPort(port([3, 0, 0], [1, 0, 0]), [1, 0, 0], 2)).toBeNull()
  })
})

describe('planPipeBranchTap', () => {
  function hit(node: PipeSegmentNode, segmentIndex: number, point: Point): RunBodyHit {
    return { nodeId: node.id, segmentIndex, point }
  }

  test('horizontal drain tap → square sanitary tee', () => {
    const run = drain([
      [0, 0, 0],
      [6, -0.125, 0],
    ])
    const plan = planPipeBranchTap(run, hit(run, 0, [3, -0.0625, 0]), [0, 0, 1], 2)
    expect(plan).not.toBeNull()
    // DWV side taps mint a SQUARE sanitary tee (see planPipeBranchTap /
    // PipeFittingNode schema): the branch enters perpendicular to the run
    // regardless of the drawn lead-in angle, matching the duct tee tap.
    expect(plan!.fitting.fittingType).toBe('sanitary-tee')

    const ports = getPipeFittingPorts(plan!.fitting)
    const branch = ports.find((p) => p.id === 'branch')!
    const inlet = ports.find((p) => p.id === 'inlet')!
    const outlet = ports.find((p) => p.id === 'outlet')!
    // Branch leaves square to the run axis (the projected-perpendicular entry).
    const axis = [6 / Math.hypot(6, 0.125), -0.125 / Math.hypot(6, 0.125), 0]
    expect(Math.abs(dot(branch.direction, axis))).toBeLessThan(1e-6)
    expect(branch.direction[2]).toBeGreaterThan(0.6)
    // Split halves mate the run collars.
    const upstream = plan!.runUpdate.data.path
    expect(dist(upstream[upstream.length - 1]!, inlet.position)).toBeLessThan(1e-6)
    expect(dist(plan!.runTail.path[0]!, outlet.position)).toBeLessThan(1e-6)
    // Branch starts at the collar.
    expect(dist(plan!.branchCollar, branch.position)).toBeLessThan(1e-6)
  })

  test('vertical stack tap → sanitary tee, branch square', () => {
    const stack = drain([
      [0, 0, 0],
      [0, 3, 0],
    ])
    const plan = planPipeBranchTap(stack, hit(stack, 0, [0, 1.5, 0]), [1, 0, 0], 2)
    expect(plan).not.toBeNull()
    expect(plan!.fitting.fittingType).toBe('sanitary-tee')
    const branch = getPipeFittingPorts(plan!.fitting).find((p) => p.id === 'branch')!
    expect(dot(branch.direction, [1, 0, 0])).toBeCloseTo(1, 6)
    expect(Math.abs(branch.direction[1])).toBeLessThan(1e-6)
  })

  test('tap too close to a run end → null', () => {
    const run = drain([
      [0, 0, 0],
      [6, 0, 0],
    ])
    expect(planPipeBranchTap(run, hit(run, 0, [0.05, 0, 0]), [0, 0, 1], 2)).toBeNull()
  })

  test('branch parallel to the run → null', () => {
    const run = drain([
      [0, 0, 0],
      [6, 0, 0],
    ])
    expect(planPipeBranchTap(run, hit(run, 0, [3, 0, 0]), [1, 0, 0], 2)).toBeNull()
  })
})
