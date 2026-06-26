import { describe, expect, test } from 'bun:test'
import { getDuctFittingPorts } from '../duct-fitting/ports'
import { type DuctProfile, planElbowAtPort, planElbowRealign } from './auto-fitting'
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

const ROUND_6: DuctProfile = { shape: 'round', diameter: 6, width: 14, height: 8 }

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
  const plan = planElbowAtPort(joint, away, ROUND_6)
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
    expect(planElbowAtPort(port([3, 0, 0], [1, 0, 0]), [1, 0, 0], ROUND_6)).toBeNull()
  })

  test('shallow 10° turn → no fitting (below the 15° elbow minimum)', () => {
    const t = (10 * Math.PI) / 180
    expect(
      planElbowAtPort(port([3, 0, 0], [1, 0, 0]), [Math.cos(t), 0, Math.sin(t)], ROUND_6),
    ).toBeNull()
  })

  test('doubling back past 90° → no fitting', () => {
    const t = (135 * Math.PI) / 180
    expect(
      planElbowAtPort(port([3, 0, 0], [1, 0, 0]), [Math.cos(t), 0, Math.sin(t)], ROUND_6),
    ).toBeNull()
  })

  test('rect profile: elbow carries the trunk W×H and equivalent diameter', () => {
    const rect: DuctProfile = { shape: 'rect', diameter: 6, width: 14, height: 8 }
    const plan = planElbowAtPort(port([3, 2.4, 0], [1, 0, 0]), [0, 0, 1], rect)
    expect(plan).not.toBeNull()
    expect(plan!.fitting.shape).toBe('rect')
    expect(plan!.fitting.width).toBe(14)
    expect(plan!.fitting.height).toBe(8)
    expect(plan!.fitting.diameter).toBeCloseTo(2 * Math.sqrt((14 * 8) / Math.PI), 6)
  })

  test('oval profile: elbow carries the trunk W×H and oval equivalent diameter', () => {
    const oval: DuctProfile = { shape: 'oval', diameter: 6, width: 14, height: 8 }
    const plan = planElbowAtPort(port([3, 2.4, 0], [1, 0, 0]), [0, 0, 1], oval)
    expect(plan).not.toBeNull()
    expect(plan!.fitting.shape).toBe('oval')
    expect(plan!.fitting.width).toBe(14)
    expect(plan!.fitting.height).toBe(8)
    // Flat-oval area: (14 − 8) × 8 + π(8/2)²
    const area = (14 - 8) * 8 + Math.PI * 16
    expect(plan!.fitting.diameter).toBeCloseTo(2 * Math.sqrt(area / Math.PI), 6)
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

import { DuctFittingNode, DuctSegmentNode } from '@pascal-app/core'
import { planCrossAtRunBody, planTeeAtRunBody } from './auto-fitting'
import type { RunBodyHit } from './ports'

function trunk(path: Point[]): DuctSegmentNode {
  return DuctSegmentNode.parse({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    name: 'Trunk',
    path,
    diameter: 8,
    ductMaterial: 'sheet-metal',
    insulationR: 0,
    system: 'supply',
  })
}

function bodyHit(node: DuctSegmentNode, segmentIndex: number, point: Point): RunBodyHit {
  return { nodeId: node.id, segmentIndex, point }
}

describe('planTeeAtRunBody', () => {
  test('mid-trunk tap: junction on the hit, run legs mate the split halves', () => {
    const run = trunk([
      [0, 2.4, 0],
      [6, 2.4, 0],
    ])
    const plan = planTeeAtRunBody(run, bodyHit(run, 0, [3, 2.4, 0]), [0, 0, 1], ROUND_6)
    expect(plan).not.toBeNull()

    const ports = getDuctFittingPorts(plan!.fitting)
    const inlet = ports.find((p) => p.id === 'inlet')!
    const outlet = ports.find((p) => p.id === 'outlet')!
    const branch = ports.find((p) => p.id === 'branch')!

    // Junction exactly on the centerline hit.
    expect(dist(plan!.fitting.position, [3, 2.4, 0])).toBeLessThan(1e-6)
    // Trunk keeps the upstream half, ending at the inlet collar.
    const upstream = plan!.trunkUpdate.data.path
    expect(dist(upstream[upstream.length - 1]!, inlet.position)).toBeLessThan(1e-6)
    expect(dot(inlet.direction, [-1, 0, 0])).toBeCloseTo(1, 6)
    // Tail carries the rest, starting at the outlet collar.
    expect(dist(plan!.trunkTail.path[0]!, outlet.position)).toBeLessThan(1e-6)
    expect(dist(plan!.trunkTail.path[1]!, [6, 2.4, 0])).toBeLessThan(1e-6)
    // Branch collar square to the run, where the new duct starts.
    expect(dist(plan!.branchCollar, branch.position)).toBeLessThan(1e-6)
    expect(dot(branch.direction, [0, 0, 1])).toBeCloseTo(1, 6)
    // Tee carries trunk diameter on the run, branch diameter on the collar.
    expect(plan!.fitting.diameter).toBe(8)
    expect(plan!.fitting.diameter2).toBe(6)
  })

  test('45° drawn branch builds a 45° lateral that follows the drawn run', () => {
    const run = trunk([
      [0, 0, 0],
      [6, 0, 0],
    ])
    const d = Math.SQRT1_2
    // Drawn 45° downstream off the +X trunk. The tee becomes a lateral whose
    // branch points along the drawn direction, so the new duct continues
    // straight out of the collar instead of kinking square.
    const plan = planTeeAtRunBody(run, bodyHit(run, 0, [3, 0, 0]), [d, 0, d], ROUND_6)
    expect(plan).not.toBeNull()
    expect(plan!.fitting.branchAngle).toBeCloseTo(45, 6)
    const branch = getDuctFittingPorts(plan!.fitting).find((p) => p.id === 'branch')!
    expect(dot(branch.direction, [d, 0, d])).toBeCloseTo(1, 6)
  })

  test('tap too close to a run end → null (use the end port instead)', () => {
    const run = trunk([
      [0, 0, 0],
      [6, 0, 0],
    ])
    expect(planTeeAtRunBody(run, bodyHit(run, 0, [0.1, 0, 0]), [0, 0, 1], ROUND_6)).toBeNull()
    expect(planTeeAtRunBody(run, bodyHit(run, 0, [5.95, 0, 0]), [0, 0, 1], ROUND_6)).toBeNull()
  })

  test('branch parallel to the trunk → null', () => {
    const run = trunk([
      [0, 0, 0],
      [6, 0, 0],
    ])
    expect(planTeeAtRunBody(run, bodyHit(run, 0, [3, 0, 0]), [1, 0, 0], ROUND_6)).toBeNull()
  })

  test('vertical drop off a horizontal trunk', () => {
    const run = trunk([
      [0, 2.4, 0],
      [6, 2.4, 0],
    ])
    const plan = planTeeAtRunBody(run, bodyHit(run, 0, [3, 2.4, 0]), [0, -1, 0], ROUND_6)
    expect(plan).not.toBeNull()
    const branch = getDuctFittingPorts(plan!.fitting).find((p) => p.id === 'branch')!
    expect(dot(branch.direction, [0, -1, 0])).toBeCloseTo(1, 6)
    expect(plan!.branchCollar[1]).toBeLessThan(2.4)
  })

  test('rect trunk: tee sized to the equivalent diameter, tail stays rect', () => {
    const rect = DuctSegmentNode.parse({
      object: 'node',
      parentId: null,
      visible: true,
      metadata: {},
      name: 'Trunk',
      path: [
        [0, 2.4, 0],
        [6, 2.4, 0],
      ],
      shape: 'rect',
      diameter: 6,
      width: 14,
      height: 8,
      ductMaterial: 'sheet-metal',
      insulationR: 0,
      system: 'supply',
    })
    const plan = planTeeAtRunBody(rect, bodyHit(rect, 0, [3, 2.4, 0]), [0, 0, 1], ROUND_6)
    expect(plan).not.toBeNull()
    // Tee run legs carry the area-equivalent round size of 14×8.
    expect(plan!.fitting.diameter).toBeCloseTo(2 * Math.sqrt((14 * 8) / Math.PI), 6)
    expect(plan!.fitting.diameter2).toBe(6)
    // The downstream half keeps the trunk's rect profile.
    expect(plan!.trunkTail.shape).toBe('rect')
    expect(plan!.trunkTail.width).toBe(14)
    expect(plan!.trunkTail.height).toBe(8)
  })

  test('rect branch: tee carries the branch W×H profile and equivalent diameter', () => {
    const run = trunk([
      [0, 2.4, 0],
      [6, 2.4, 0],
    ])
    const rectBranch: DuctProfile = { shape: 'rect', diameter: 6, width: 12, height: 6 }
    const plan = planTeeAtRunBody(run, bodyHit(run, 0, [3, 2.4, 0]), [0, 0, 1], rectBranch)
    expect(plan).not.toBeNull()
    expect(plan!.fitting.shape2).toBe('rect')
    expect(plan!.fitting.width2).toBe(12)
    expect(plan!.fitting.height2).toBe(6)
    expect(plan!.fitting.diameter2).toBeCloseTo(2 * Math.sqrt((12 * 6) / Math.PI), 6)
  })

  test('oval branch: tee carries the branch W×H profile and oval equivalent diameter', () => {
    const run = trunk([
      [0, 2.4, 0],
      [6, 2.4, 0],
    ])
    const ovalBranch: DuctProfile = { shape: 'oval', diameter: 6, width: 12, height: 6 }
    const plan = planTeeAtRunBody(run, bodyHit(run, 0, [3, 2.4, 0]), [0, 0, 1], ovalBranch)
    expect(plan).not.toBeNull()
    expect(plan!.fitting.shape2).toBe('oval')
    expect(plan!.fitting.width2).toBe(12)
    expect(plan!.fitting.height2).toBe(6)
    const area = (12 - 6) * 6 + Math.PI * 9
    expect(plan!.fitting.diameter2).toBeCloseTo(2 * Math.sqrt(area / Math.PI), 6)
  })

  test('polyline trunk: split lands in the hit segment, other points preserved', () => {
    const run = trunk([
      [0, 0, 0],
      [4, 0, 0],
      [4, 0, 4],
    ])
    const plan = planTeeAtRunBody(run, bodyHit(run, 1, [4, 0, 2]), [1, 0, 0], ROUND_6)
    expect(plan).not.toBeNull()
    // Upstream half keeps both leading points.
    expect(plan!.trunkUpdate.data.path.length).toBe(3)
    expect(dist(plan!.trunkUpdate.data.path[0]!, [0, 0, 0])).toBeLessThan(1e-6)
    expect(dist(plan!.trunkUpdate.data.path[1]!, [4, 0, 0])).toBeLessThan(1e-6)
    // Tail runs from past the tap to the original end.
    expect(dist(plan!.trunkTail.path[1]!, [4, 0, 4])).toBeLessThan(1e-6)
  })
})

describe('planCrossAtRunBody', () => {
  test('drawn run through a trunk: junction on the hit, four legs mate', () => {
    const run = trunk([
      [0, 2.4, 0],
      [6, 2.4, 0],
    ])
    // Drawn run goes -Z → +Z straight through the trunk at x=3.
    const plan = planCrossAtRunBody(run, bodyHit(run, 0, [3, 2.4, 0]), [0, 0, 1], ROUND_6)
    expect(plan).not.toBeNull()

    const ports = getDuctFittingPorts(plan!.fitting)
    const inlet = ports.find((p) => p.id === 'inlet')!
    const outlet = ports.find((p) => p.id === 'outlet')!
    const branch = ports.find((p) => p.id === 'branch')!
    const branch2 = ports.find((p) => p.id === 'branch2')!

    // Junction exactly on the centerline hit.
    expect(dist(plan!.fitting.position, [3, 2.4, 0])).toBeLessThan(1e-6)
    // Run legs along the trunk axis; trunk split halves mate them.
    const upstream = plan!.trunkUpdate.data.path
    expect(dist(upstream[upstream.length - 1]!, inlet.position)).toBeLessThan(1e-6)
    expect(dist(plan!.trunkTail.path[0]!, outlet.position)).toBeLessThan(1e-6)
    expect(dist(plan!.trunkTail.path[1]!, [6, 2.4, 0])).toBeLessThan(1e-6)
    // Opposed branches square to the run; collars where the drawn halves meet.
    expect(dot(branch.direction, [0, 0, 1])).toBeCloseTo(1, 6)
    expect(dot(branch2.direction, [0, 0, -1])).toBeCloseTo(1, 6)
    expect(dist(plan!.branchCollarFar, branch.position)).toBeLessThan(1e-6)
    expect(dist(plan!.branchCollarNear, branch2.position)).toBeLessThan(1e-6)
    // Cross carries trunk diameter on the run, branch diameter on the collars.
    expect(plan!.fitting.diameter).toBe(8)
    expect(plan!.fitting.diameter2).toBe(6)
  })

  test('near / far collars sit on opposite sides of the trunk', () => {
    const run = trunk([
      [0, 0, 0],
      [6, 0, 0],
    ])
    const plan = planCrossAtRunBody(run, bodyHit(run, 0, [3, 0, 0]), [0, 0, 1], ROUND_6)
    expect(plan).not.toBeNull()
    // awayDir is +Z, so the far collar (drawn end side) is +Z, near is -Z.
    expect(plan!.branchCollarFar[2]).toBeGreaterThan(0)
    expect(plan!.branchCollarNear[2]).toBeLessThan(0)
  })

  test('crossing too close to a trunk end → null', () => {
    const run = trunk([
      [0, 0, 0],
      [6, 0, 0],
    ])
    expect(planCrossAtRunBody(run, bodyHit(run, 0, [0.1, 0, 0]), [0, 0, 1], ROUND_6)).toBeNull()
    expect(planCrossAtRunBody(run, bodyHit(run, 0, [5.95, 0, 0]), [0, 0, 1], ROUND_6)).toBeNull()
  })

  test('drawn run parallel to the trunk → null', () => {
    const run = trunk([
      [0, 0, 0],
      [6, 0, 0],
    ])
    expect(planCrossAtRunBody(run, bodyHit(run, 0, [3, 0, 0]), [1, 0, 0], ROUND_6)).toBeNull()
  })

  test('rect trunk: cross sized to the equivalent diameter, tail stays rect', () => {
    const rect = DuctSegmentNode.parse({
      object: 'node',
      parentId: null,
      visible: true,
      metadata: {},
      name: 'Trunk',
      path: [
        [0, 2.4, 0],
        [6, 2.4, 0],
      ],
      shape: 'rect',
      diameter: 6,
      width: 14,
      height: 8,
      ductMaterial: 'sheet-metal',
      insulationR: 0,
      system: 'supply',
    })
    const plan = planCrossAtRunBody(rect, bodyHit(rect, 0, [3, 2.4, 0]), [0, 0, 1], ROUND_6)
    expect(plan).not.toBeNull()
    expect(plan!.fitting.shape).toBe('rect')
    expect(plan!.fitting.diameter).toBeCloseTo(2 * Math.sqrt((14 * 8) / Math.PI), 6)
    expect(plan!.trunkTail.shape).toBe('rect')
    expect(plan!.trunkTail.width).toBe(14)
  })
})

describe('cross ports', () => {
  function cross(): DuctFittingNode {
    return DuctFittingNode.parse({
      object: 'node',
      parentId: null,
      visible: true,
      metadata: {},
      name: 'Cross',
      fittingType: 'cross',
      diameter: 8,
      diameter2: 6,
      system: 'supply',
    })
  }

  test('four opposed ports: run ±X at diameter, branches ±Z at diameter2', () => {
    const ports = getDuctFittingPorts(cross())
    expect(ports).toHaveLength(4)
    const inlet = ports.find((p) => p.id === 'inlet')!
    const outlet = ports.find((p) => p.id === 'outlet')!
    const branch = ports.find((p) => p.id === 'branch')!
    const branch2 = ports.find((p) => p.id === 'branch2')!
    expect(dot(inlet.direction, [-1, 0, 0])).toBeCloseTo(1, 6)
    expect(dot(outlet.direction, [1, 0, 0])).toBeCloseTo(1, 6)
    expect(dot(branch.direction, [0, 0, 1])).toBeCloseTo(1, 6)
    expect(dot(branch2.direction, [0, 0, -1])).toBeCloseTo(1, 6)
    expect(inlet.diameter).toBe(8)
    expect(branch.diameter).toBe(6)
    expect(branch2.diameter).toBe(6)
  })
})

describe('tee branchAngle (lateral)', () => {
  function tee(branchAngle: number): DuctFittingNode {
    return DuctFittingNode.parse({
      object: 'node',
      parentId: null,
      visible: true,
      metadata: {},
      name: 'Tee',
      fittingType: 'tee',
      diameter: 8,
      diameter2: 6,
      branchAngle,
      system: 'supply',
    })
  }

  test('90° branch leaves square to the run (+Z), run legs untouched', () => {
    const ports = getDuctFittingPorts(tee(90))
    const branch = ports.find((p) => p.id === 'branch')!
    expect(dot(branch.direction, [0, 0, 1])).toBeCloseTo(1, 6)
    expect(dot(ports.find((p) => p.id === 'inlet')!.direction, [-1, 0, 0])).toBeCloseTo(1, 6)
    expect(dot(ports.find((p) => p.id === 'outlet')!.direction, [1, 0, 0])).toBeCloseTo(1, 6)
  })

  test('45° lateral sweeps the branch downstream toward the outlet', () => {
    const d = Math.SQRT1_2
    const branch = getDuctFittingPorts(tee(45)).find((p) => p.id === 'branch')!
    // Leans equally toward +X (outlet) and +Z; collar sits along that ray.
    expect(dot(branch.direction, [d, 0, d])).toBeCloseTo(1, 6)
    expect(branch.position[0]).toBeGreaterThan(0)
    expect(branch.position[2]).toBeGreaterThan(0)
  })

  test('135° lateral leans the branch upstream toward the inlet', () => {
    const d = Math.SQRT1_2
    const branch = getDuctFittingPorts(tee(135)).find((p) => p.id === 'branch')!
    // Mirror of 45°: leans toward -X (inlet) and +Z.
    expect(dot(branch.direction, [-d, 0, d])).toBeCloseTo(1, 6)
    expect(branch.position[0]).toBeLessThan(0)
    expect(branch.position[2]).toBeGreaterThan(0)
  })
})

describe('planElbowRealign', () => {
  // A 90° elbow as the draw tool mints it: horizontal run arrives along
  // +X (inlet mated), free outlet pointing +Z.
  function existingElbow() {
    const plan = planElbowAtPort(port([3, 0, 0], [1, 0, 0]), [0, 0, 1], ROUND_6)!
    return plan.fitting
  }

  function realigned(elbow: ReturnType<typeof existingElbow>, away: Point) {
    const plan = planElbowRealign(elbow, 'outlet', away)
    expect(plan).not.toBeNull()
    const patched = { ...elbow, ...plan!.update.data } as typeof elbow
    return { plan: plan!, ports: getDuctFittingPorts(patched) }
  }

  test('free collar swings to the incoming run; mated collar stays put', () => {
    const elbow = existingElbow()
    const before = getDuctFittingPorts(elbow)
    const inletBefore = before.find((p) => p.id === 'inlet')!

    // Incoming slope: up at 60° from the trunk plane.
    const away: Point = [0, Math.sin(Math.PI / 3), Math.cos(Math.PI / 3)]
    const { plan, ports } = realigned(elbow, away)
    const inlet = ports.find((p) => p.id === 'inlet')!
    const outlet = ports.find((p) => p.id === 'outlet')!

    // Mated inlet collar unchanged — the horizontal run stays connected.
    expect(dist(inlet.position, inletBefore.position)).toBeLessThan(1e-6)
    expect(dot(inlet.direction, inletBefore.direction)).toBeCloseTo(1, 6)
    // Free outlet now faces the slope, collar one leg out along it.
    expect(dot(outlet.direction, away)).toBeCloseTo(1, 6)
    expect(dist(outlet.position, plan.collarPoint)).toBeLessThan(1e-6)
  })

  test('straight-on arrival keeps the same geometry (no-op realign)', () => {
    const elbow = existingElbow()
    const { ports } = realigned(elbow, [0, 0, 1])
    const outlet = ports.find((p) => p.id === 'outlet')!
    expect(dot(outlet.direction, [0, 0, 1])).toBeCloseTo(1, 6)
  })

  test('shallow arrival flattens the elbow toward a straight coupling', () => {
    const elbow = existingElbow()
    // Away nearly opposite the fixed inlet direction → turn < 15°. Unlike
    // fresh-fitting creation, an existing elbow flattens to this small angle
    // instead of bailing, so the run can be dragged dead straight.
    const plan = planElbowRealign(elbow, 'outlet', [0.99, 0, 0.14])
    expect(plan).not.toBeNull()
    expect(plan!.update.data.angle).toBeLessThan(15)
    expect(plan!.update.data.angle).toBeGreaterThanOrEqual(0)
  })

  test('run dragged into line flattens the elbow to a straight 0° coupling', () => {
    const elbow = existingElbow()
    // The free outlet pulled exactly opposite the mated inlet → no turn left.
    const inlet = getDuctFittingPorts(elbow).find((p) => p.id === 'inlet')!
    const away: Point = [-inlet.direction[0], -inlet.direction[1], -inlet.direction[2]]
    const plan = planElbowRealign(elbow, 'outlet', away)
    expect(plan).not.toBeNull()
    expect(plan!.update.data.angle).toBeCloseTo(0, 5)
  })

  test('a back-turn sharper than 90° still bails', () => {
    const elbow = existingElbow()
    // Away aligned WITH the fixed collar direction → turn > 90°.
    expect(planElbowRealign(elbow, 'outlet', [-0.99, 0, 0.14])).toBeNull()
  })

  test('non-elbow fittings are left alone', () => {
    const elbow = existingElbow()
    const tee = { ...elbow, fittingType: 'tee' as const }
    expect(planElbowRealign(tee, 'outlet', [0, 1, 0])).toBeNull()
  })
})

import { PipeFittingNode, PipeSegmentNode } from '@pascal-app/core'
import { getPipeFittingPorts } from '../pipe-fitting/ports'
import { planPipeBranchTap, planPipeCrossAtRunBody } from './auto-fitting'

function pipeRun(path: Point[]): PipeSegmentNode {
  return PipeSegmentNode.parse({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    name: 'Drain',
    path,
    diameter: 2,
    system: 'waste',
  })
}

function pipeBodyHit(node: PipeSegmentNode, segmentIndex: number, point: Point): RunBodyHit {
  return { nodeId: node.id, segmentIndex, point }
}

describe('planPipeBranchTap', () => {
  test('horizontal drain tap mints a SQUARE sanitary tee (not a wye)', () => {
    const run = pipeRun([
      [0, 0, 0],
      [6, 0, 0],
    ])
    const plan = planPipeBranchTap(run, pipeBodyHit(run, 0, [3, 0, 0]), [0, 0, 1], 2)
    expect(plan).not.toBeNull()
    expect(plan!.fitting.fittingType).toBe('sanitary-tee')
    const branch = getPipeFittingPorts(plan!.fitting).find((p) => p.id === 'branch')!
    // Branch leaves square to the run regardless of the drawn lead-in.
    expect(dot(branch.direction, [0, 0, 1])).toBeCloseTo(1, 6)
  })

  test('45° drawn branch still enters square (projected perpendicular)', () => {
    const run = pipeRun([
      [0, 0, 0],
      [6, 0, 0],
    ])
    const d = Math.SQRT1_2
    const plan = planPipeBranchTap(run, pipeBodyHit(run, 0, [3, 0, 0]), [d, 0, d], 2)
    expect(plan).not.toBeNull()
    const branch = getPipeFittingPorts(plan!.fitting).find((p) => p.id === 'branch')!
    expect(dot(branch.direction, [0, 0, 1])).toBeCloseTo(1, 6)
  })

  test('junction on the hit, run legs mate the split halves', () => {
    const run = pipeRun([
      [0, 0, 0],
      [6, 0, 0],
    ])
    const plan = planPipeBranchTap(run, pipeBodyHit(run, 0, [3, 0, 0]), [0, 0, 1], 2)
    expect(plan).not.toBeNull()
    const ports = getPipeFittingPorts(plan!.fitting)
    const inlet = ports.find((p) => p.id === 'inlet')!
    const outlet = ports.find((p) => p.id === 'outlet')!
    const branch = ports.find((p) => p.id === 'branch')!
    expect(dist(plan!.fitting.position, [3, 0, 0])).toBeLessThan(1e-6)
    const upstream = plan!.runUpdate.data.path
    expect(dist(upstream[upstream.length - 1]!, inlet.position)).toBeLessThan(1e-6)
    expect(dist(plan!.runTail.path[0]!, outlet.position)).toBeLessThan(1e-6)
    expect(dist(plan!.branchCollar, branch.position)).toBeLessThan(1e-6)
  })

  test('tap too close to a run end → null', () => {
    const run = pipeRun([
      [0, 0, 0],
      [6, 0, 0],
    ])
    expect(planPipeBranchTap(run, pipeBodyHit(run, 0, [0.02, 0, 0]), [0, 0, 1], 2)).toBeNull()
  })
})

describe('planPipeCrossAtRunBody', () => {
  test('drawn run through a run: junction on the hit, four legs mate', () => {
    const run = pipeRun([
      [0, 0, 0],
      [6, 0, 0],
    ])
    const plan = planPipeCrossAtRunBody(run, pipeBodyHit(run, 0, [3, 0, 0]), [0, 0, 1], 2)
    expect(plan).not.toBeNull()
    expect(plan!.fitting.fittingType).toBe('cross')
    const ports = getPipeFittingPorts(plan!.fitting)
    expect(ports).toHaveLength(4)
    const inlet = ports.find((p) => p.id === 'inlet')!
    const outlet = ports.find((p) => p.id === 'outlet')!
    const branch = ports.find((p) => p.id === 'branch')!
    const branch2 = ports.find((p) => p.id === 'branch2')!
    expect(dist(plan!.fitting.position, [3, 0, 0])).toBeLessThan(1e-6)
    const upstream = plan!.runUpdate.data.path
    expect(dist(upstream[upstream.length - 1]!, inlet.position)).toBeLessThan(1e-6)
    expect(dist(plan!.runTail.path[0]!, outlet.position)).toBeLessThan(1e-6)
    // awayDir +Z → far collar (drawn end) on +Z branch, near on -Z branch2.
    expect(dot(branch.direction, [0, 0, 1])).toBeCloseTo(1, 6)
    expect(dot(branch2.direction, [0, 0, -1])).toBeCloseTo(1, 6)
    expect(dist(plan!.branchCollarFar, branch.position)).toBeLessThan(1e-6)
    expect(dist(plan!.branchCollarNear, branch2.position)).toBeLessThan(1e-6)
  })

  test('crossing too close to a run end → null', () => {
    const run = pipeRun([
      [0, 0, 0],
      [6, 0, 0],
    ])
    expect(planPipeCrossAtRunBody(run, pipeBodyHit(run, 0, [0.02, 0, 0]), [0, 0, 1], 2)).toBeNull()
  })

  test('drawn run parallel to the run → null', () => {
    const run = pipeRun([
      [0, 0, 0],
      [6, 0, 0],
    ])
    expect(planPipeCrossAtRunBody(run, pipeBodyHit(run, 0, [3, 0, 0]), [1, 0, 0], 2)).toBeNull()
  })
})

describe('cross pipe ports', () => {
  test('four opposed ports: run ±X at diameter, branches ±Z at diameter2', () => {
    const cross = PipeFittingNode.parse({
      object: 'node',
      parentId: null,
      visible: true,
      metadata: {},
      name: 'Cross',
      fittingType: 'cross',
      diameter: 3,
      diameter2: 2,
      system: 'waste',
    })
    const ports = getPipeFittingPorts(cross)
    expect(ports).toHaveLength(4)
    const branch = ports.find((p) => p.id === 'branch')!
    const branch2 = ports.find((p) => p.id === 'branch2')!
    expect(dot(branch.direction, [0, 0, 1])).toBeCloseTo(1, 6)
    expect(dot(branch2.direction, [0, 0, -1])).toBeCloseTo(1, 6)
    expect(branch.diameter).toBe(2)
    expect(branch2.diameter).toBe(2)
  })
})
