import { describe, expect, test } from 'bun:test'
import { getDuctFittingPorts } from '../duct-fitting/ports'
import { planElbowAtPort } from './auto-fitting'
import type { ScenePort } from './ports'

type Point = [number, number, number]

function port(position: Point, direction: Point): ScenePort {
  return {
    id: 'end',
    nodeId: 'duct-segment_test' as ScenePort['nodeId'],
    position,
    direction,
    diameter: 6,
    system: 'supply',
  }
}

function dist(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!)
}

function dot(a: readonly number[], b: readonly number[]): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!
}

/**
 * The real invariant: run the planned elbow back through the fitting
 * kind's OWN port math and check the joint composes — junction centered
 * on the drawn corner, inlet collar sitting where the trimmed run now
 * ends (facing back into it), outlet sitting on the returned collar
 * point facing along the new run.
 */
function expectMated(joint: ScenePort, away: Point) {
  const plan = planElbowAtPort(joint, away, 6)
  expect(plan).not.toBeNull()
  const ports = getDuctFittingPorts(plan!.fitting)
  const inlet = ports.find((p) => p.id === 'inlet')!
  const outlet = ports.find((p) => p.id === 'outlet')!

  expect(dist(plan!.fitting.position, joint.position)).toBeLessThan(1e-6)
  expect(dist(inlet.position, plan!.trimmedPortPoint)).toBeLessThan(1e-6)
  expect(dot(inlet.direction, joint.direction)).toBeCloseTo(-1, 6)
  expect(dist(outlet.position, plan!.collarPoint)).toBeLessThan(1e-6)
  expect(dot(outlet.direction, away)).toBeCloseTo(1, 6)
  return plan!
}

describe('planElbowAtPort', () => {
  test('90° horizontal turn (+X run turning to +Z)', () => {
    const plan = expectMated(port([3, 2.4, 0], [1, 0, 0]), [0, 0, 1])
    expect(plan.fitting.angle).toBeCloseTo(90, 6)
  })

  test('45° horizontal turn', () => {
    const d = Math.SQRT1_2
    const plan = expectMated(port([3, 2.4, 0], [1, 0, 0]), [d, 0, d])
    expect(plan.fitting.angle).toBeCloseTo(45, 6)
  })

  test('vertical riser turn (horizontal run turning straight up)', () => {
    const plan = expectMated(port([3, 0, 1], [1, 0, 0]), [0, 1, 0])
    expect(plan.fitting.angle).toBeCloseTo(90, 6)
  })

  test('riser topping out into a horizontal run', () => {
    expectMated(port([3, 2.4, 1], [0, 1, 0]), [0, 0, -1])
  })

  test('straight continuation → no fitting', () => {
    expect(planElbowAtPort(port([3, 0, 0], [1, 0, 0]), [1, 0, 0], 6)).toBeNull()
  })

  test('shallow 10° turn → no fitting (below the 15° elbow minimum)', () => {
    const t = (10 * Math.PI) / 180
    expect(planElbowAtPort(port([3, 0, 0], [1, 0, 0]), [Math.cos(t), 0, Math.sin(t)], 6)).toBeNull()
  })

  test('doubling back past 90° → no fitting', () => {
    const t = (135 * Math.PI) / 180
    expect(planElbowAtPort(port([3, 0, 0], [1, 0, 0]), [Math.cos(t), 0, Math.sin(t)], 6)).toBeNull()
  })

  test('junction on the corner; trim and collar one leg out on each side', () => {
    const plan = expectMated(port([0, 0, 0], [1, 0, 0]), [0, 0, 1])
    // Junction exactly at the drawn corner.
    expect(dist(plan.fitting.position, [0, 0, 0])).toBeLessThan(1e-6)
    // Existing run (arriving along +X) trims back along -X...
    expect(plan.trimmedPortPoint[0]).toBeLessThan(0)
    expect(plan.trimmedPortPoint[1]).toBeCloseTo(0, 6)
    expect(plan.trimmedPortPoint[2]).toBeCloseTo(0, 6)
    // ...and the new run starts one leg out along +Z.
    expect(plan.collarPoint[0]).toBeCloseTo(0, 6)
    expect(plan.collarPoint[2]).toBeGreaterThan(0)
    // Symmetric legs.
    expect(dist(plan.trimmedPortPoint, [0, 0, 0])).toBeCloseTo(dist(plan.collarPoint, [0, 0, 0]), 6)
  })
})
