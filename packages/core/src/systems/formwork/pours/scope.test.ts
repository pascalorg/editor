import { describe, expect, it } from 'bun:test'
import { ColumnNode } from '../../../schema/nodes/column'
import { DoorNode } from '../../../schema/nodes/door'
import { WallNode } from '../../../schema/nodes/wall'
import type { AnyNode, AnyNodeId } from '../../../schema/types'
import { pourCoverageForElement } from '../coverage/faces'
import type { FaceRole } from '../coverage/types'

/**
 * Pour-unit scoping seen through the coverage engine, which is where it has to
 * be right: a lift is only worth modelling if the shutter it implies differs
 * from the whole-element one.
 */

function wall(overrides: Partial<Parameters<typeof WallNode.parse>[0]> = {}) {
  return WallNode.parse({
    start: [0, 0],
    end: [40, 0],
    thickness: 0.3,
    height: 9,
    formworkType: 'plywood',
    ...overrides,
  })
}

function reasonFor(
  nodes: AnyNode[],
  id: AnyNodeId,
  limits: Parameters<typeof pourCoverageForElement>[2],
  pick: { segment: number; lift: number },
  role: FaceRole,
): string | undefined {
  const entry = pourCoverageForElement(id, nodes, limits).find(
    (e) => e.unit.segmentIndex === pick.segment && e.unit.liftIndex === pick.lift,
  )
  return entry?.coverage.faces.find((f) => f.role === role)?.reason
}

describe('unsplit element', () => {
  it('yields one unit whose coverage matches the whole element', () => {
    const w = wall({ height: 3, end: [5, 0] })
    const entries = pourCoverageForElement(w.id as AnyNodeId, [w], {})
    expect(entries).toHaveLength(1)
    const roles = entries[0]?.coverage.faces.filter((f) => f.formed).map((f) => f.role) ?? []
    expect(roles.sort()).toEqual(['end-end', 'end-start', 'side-a', 'side-b'])
  })
})

describe('lift joints', () => {
  const limits = { maxLiftHeight: 4 }

  it('leaves a non-topmost lift’s top open for the lift above', () => {
    const w = wall()
    expect(reasonFor([w], w.id as AnyNodeId, limits, { segment: 0, lift: 0 }, 'top')).toBe(
      'LIFT_JOINT_OPEN',
    )
  })

  it('still screeds the topmost lift’s top', () => {
    const w = wall()
    expect(reasonFor([w], w.id as AnyNodeId, limits, { segment: 0, lift: 2 }, 'top')).toBe(
      'SCREEDED_OPEN',
    )
  })

  it('bears a non-bottom lift on the hardened lift below', () => {
    const w = wall()
    expect(reasonFor([w], w.id as AnyNodeId, limits, { segment: 0, lift: 1 }, 'bottom')).toBe(
      'BEARS_ON_LIFT_BELOW',
    )
  })

  it('bears the bottom lift on the kicker, as before', () => {
    const w = wall()
    expect(reasonFor([w], w.id as AnyNodeId, limits, { segment: 0, lift: 0 }, 'bottom')).toBe(
      'BEARS_ON_KICKER_OR_SUBSTRATE',
    )
  })

  it('does not apply the element’s formed top to a lift joint', () => {
    // The wall's eventual top is a 30° slope needing a soffit, but a lift joint
    // partway up is struck off level whatever the top eventually does.
    const w = wall({ topSurface: { kind: 'formed', slopeDeg: 30 } })
    expect(reasonFor([w], w.id as AnyNodeId, limits, { segment: 0, lift: 0 }, 'top')).toBe(
      'LIFT_JOINT_OPEN',
    )
    expect(reasonFor([w], w.id as AnyNodeId, limits, { segment: 0, lift: 2 }, 'top')).toBe(
      'FORMED_SLOPING_TOP',
    )
  })

  it('scales each lift’s side area to the lift, not the element', () => {
    const w = wall()
    const entries = pourCoverageForElement(w.id as AnyNodeId, [w], limits)
    const sideA = entries[0]?.coverage.faces.find((f) => f.role === 'side-a')
    expect(sideA?.physicalArea).toBeCloseTo(40 * 3, 6)
  })

  it('keeps the ends of every lift, since the wall is freestanding', () => {
    const w = wall()
    for (const lift of [0, 1, 2]) {
      expect(reasonFor([w], w.id as AnyNodeId, limits, { segment: 0, lift }, 'end-start')).toBe(
        'FREE_END_STOP_END',
      )
    }
  })
})

describe('pour breaks', () => {
  const limits = { maxPourLength: 12 }

  it('closes an internal segment cut with a bulkhead', () => {
    const w = wall()
    expect(reasonFor([w], w.id as AnyNodeId, limits, { segment: 1, lift: 0 }, 'end-start')).toBe(
      'POUR_BREAK_BULKHEAD',
    )
    expect(reasonFor([w], w.id as AnyNodeId, limits, { segment: 1, lift: 0 }, 'end-end')).toBe(
      'POUR_BREAK_BULKHEAD',
    )
  })

  it('keeps the element’s own ends classified against its neighbours', () => {
    const w = wall()
    expect(reasonFor([w], w.id as AnyNodeId, limits, { segment: 0, lift: 0 }, 'end-start')).toBe(
      'FREE_END_STOP_END',
    )
    expect(reasonFor([w], w.id as AnyNodeId, limits, { segment: 3, lift: 0 }, 'end-end')).toBe(
      'FREE_END_STOP_END',
    )
  })

  it('builds a bulkhead at a cut even where the element’s end butts hardened concrete', () => {
    // The end at the column needs no stop-end, but the cut inside the wall does:
    // the concrete beyond it is this same wall, cast later.
    const column = ColumnNode.parse({
      position: [0, 0, 0],
      width: 0.4,
      depth: 0.4,
      height: 9,
      castOrder: 1,
    })
    const w = wall({ castOrder: 2 })
    const nodes = [column, w] as AnyNode[]
    expect(reasonFor(nodes, w.id as AnyNodeId, limits, { segment: 0, lift: 0 }, 'end-start')).toBe(
      'ABUTS_HARDENED_CONCRETE',
    )
    expect(reasonFor(nodes, w.id as AnyNodeId, limits, { segment: 1, lift: 0 }, 'end-start')).toBe(
      'POUR_BREAK_BULKHEAD',
    )
  })

  it('penetrates a bulkhead with starters, like any other stop-end', () => {
    const w = wall()
    const entry = pourCoverageForElement(w.id as AnyNodeId, [w], limits).find(
      (e) => e.unit.segmentIndex === 1,
    )
    const face = entry?.coverage.faces.find((f) => f.role === 'end-start')
    expect(face?.starterPenetrations).toBe(true)
  })

  it('scales each segment’s side area to the segment', () => {
    const w = wall()
    const entries = pourCoverageForElement(w.id as AnyNodeId, [w], limits)
    const sideA = entries[0]?.coverage.faces.find((f) => f.role === 'side-a')
    expect(sideA?.physicalArea).toBeCloseTo(10 * 9, 6)
  })

  it('sums segment side areas back to the element’s side area', () => {
    const w = wall()
    const entries = pourCoverageForElement(w.id as AnyNodeId, [w], limits)
    const total = entries.reduce(
      (sum, e) => sum + (e.coverage.faces.find((f) => f.role === 'side-a')?.physicalArea ?? 0),
      0,
    )
    expect(total).toBeCloseTo(40 * 9, 6)
  })

  it('adds bulkhead area that the unsplit element did not need', () => {
    // The cost of the split, and the number a user needs to argue about it.
    const w = wall()
    const split = pourCoverageForElement(w.id as AnyNodeId, [w], limits)
    const unsplit = pourCoverageForElement(w.id as AnyNodeId, [w], {})
    const splitTotal = split.reduce((sum, e) => sum + e.coverage.physicalArea, 0)
    const unsplitTotal = unsplit.reduce((sum, e) => sum + e.coverage.physicalArea, 0)
    // 3 internal cuts, each closed on both sides: 6 plates of 0.3 × 9.
    expect(splitTotal - unsplitTotal).toBeCloseTo(6 * 0.3 * 9, 6)
  })
})

describe('openings', () => {
  function door(hostId: string, along: number, centreY: number, height: number) {
    return DoorNode.parse({
      wallId: hostId,
      parentId: hostId,
      position: [along, centreY, 0],
      width: 1,
      height,
    })
  }

  it('assigns an opening to the segment it falls in', () => {
    const w = wall()
    const d = door(w.id, 5, 1.05, 2.1)
    const entries = pourCoverageForElement(w.id as AnyNodeId, [w, d] as AnyNode[], {
      maxPourLength: 12,
    })
    const withOpening = entries.filter((e) => e.coverage.openings.length > 0)
    expect(withOpening.map((e) => e.unit.segmentIndex)).toEqual([0])
  })

  it('assigns an opening to the lift it falls in', () => {
    const w = wall()
    const d = door(w.id, 5, 1.05, 2.1)
    const entries = pourCoverageForElement(w.id as AnyNodeId, [w, d] as AnyNode[], {
      maxLiftHeight: 4,
    })
    const withOpening = entries.filter((e) => e.coverage.openings.length > 0)
    expect(withOpening.map((e) => e.unit.liftIndex)).toEqual([0])
  })

  it('clips an opening that straddles a lift joint into both lifts', () => {
    // A tall opening crossing the joint at 3 m is formed by both shutters, and
    // each carries the part of the void inside its own lift.
    const w = wall()
    const d = door(w.id, 5, 2, 4)
    const entries = pourCoverageForElement(w.id as AnyNodeId, [w, d] as AnyNode[], {
      maxLiftHeight: 4,
    })
    const areas = entries
      .filter((e) => e.coverage.openings.length > 0)
      .map((e) => e.coverage.openings[0]?.areaSqM ?? 0)
    expect(areas).toHaveLength(2)
    // The void runs 0–4 m; 3 m of it is in the bottom lift and 1 m in the next.
    expect(areas).toEqual([3, 1])
  })

  it('forms no reveal on a side that coincides with a lift joint', () => {
    // The head of the lower half and the sill of the upper half are not returned
    // faces — the void simply continues into the next pour, so a reveal there
    // would be formwork nobody builds.
    const w = wall()
    const d = door(w.id, 5, 2, 4)
    const entries = pourCoverageForElement(w.id as AnyNodeId, [w, d] as AnyNode[], {
      maxLiftHeight: 4,
    })
    const withOpening = entries.filter((e) => e.coverage.openings.length > 0)
    // Bottom lift: 2 jambs, no sill (floor level), no head (the joint).
    expect(withOpening[0]?.coverage.openings[0]?.revealSides).toBe(2)
    // Lift above: 2 jambs plus the head, no sill.
    expect(withOpening[1]?.coverage.openings[0]?.revealSides).toBe(3)
  })
})
