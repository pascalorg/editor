import { describe, expect, it } from 'bun:test'
import { ColumnNode } from '../../../schema/nodes/column'
import { WallNode } from '../../../schema/nodes/wall'
import type { AnyNode, AnyNodeId } from '../../../schema/types'
import { classifyCoverage, coverageForElement } from './faces'

/**
 * Corner overlap ownership. Two walls meeting at an L share one prism of
 * concrete that falls inside both walls' face rectangles; the earlier-cast one
 * owns it. Without this every junction is counted twice on the physical
 * take-off, which is what the plan's invariant
 * `sum(trimmed physical areas) === trueWrappedArea` guards.
 */

function wall(overrides: Record<string, unknown> = {}) {
  return WallNode.parse({
    start: [0, 0],
    end: [5, 0],
    thickness: 0.2,
    height: 3,
    formworkType: 'plywood',
    ...overrides,
  })
}

function physicalOf(nodes: AnyNode[], id: string, role: string): number {
  const face = coverageForElement(id as AnyNodeId, nodes)?.faces.find((f) => f.role === role)
  return face?.physicalArea ?? 0
}

describe('an L corner', () => {
  const a = wall({ castOrder: 1 })
  const b = wall({ start: [5, 0], end: [5, 4], castOrder: 2 })
  const nodes = [a, b] as AnyNode[]

  it('leaves the earlier wall its full side faces', () => {
    expect(physicalOf(nodes, a.id, 'side-a')).toBeCloseTo(15, 6)
    expect(physicalOf(nodes, a.id, 'side-b')).toBeCloseTo(15, 6)
  })

  it('trims the later wall where it runs into the earlier one', () => {
    // B's outer side is buried for A's half-thickness; its inner side sits
    // clear along A's face, so only one side loses area.
    const inner = physicalOf(nodes, b.id, 'side-a')
    const outer = physicalOf(nodes, b.id, 'side-b')
    expect(Math.min(inner, outer)).toBeCloseTo(4 * 3 - 0.1 * 3, 6)
    expect(Math.max(inner, outer)).toBeCloseTo(4 * 3, 6)
  })

  it('never trims the measured area — intersections are not deducted', () => {
    const faces = coverageForElement(b.id as AnyNodeId, nodes)?.faces ?? []
    for (const face of faces.filter((f) => f.role.startsWith('side'))) {
      expect(face.measuredArea).toBeCloseTo(12, 6)
    }
  })

  it('reverses ownership when the cast order reverses', () => {
    const early = wall({ castOrder: 3 })
    const late = wall({ start: [5, 0], end: [5, 4], castOrder: 1 })
    const flipped = [early, late] as AnyNode[]
    const sides = [physicalOf(flipped, early.id, 'side-a'), physicalOf(flipped, early.id, 'side-b')]
    expect(Math.min(...sides)).toBeCloseTo(15 - 0.1 * 3, 6)
  })

  it('assigns the overlap to exactly one wall when both share a cast order', () => {
    const a2 = wall({ castOrder: 1 })
    const b2 = wall({ start: [5, 0], end: [5, 4], castOrder: 1 })
    const tied = [a2, b2] as AnyNode[]
    const trimmed = [a2, b2].filter((w) => {
      const sides = [physicalOf(tied, w.id, 'side-a'), physicalOf(tied, w.id, 'side-b')]
      const gross = w.id === a2.id ? 15 : 12
      return Math.min(...sides) < gross - 1e-9
    })
    expect(trimmed).toHaveLength(1)
  })
})

describe('a T junction', () => {
  it('buries both sides of the later stem inside the earlier wall', () => {
    const spine = wall({ start: [0, 0], end: [6, 0], castOrder: 1 })
    const stem = wall({ start: [3, 0], end: [3, 4], castOrder: 2 })
    const nodes = [spine, stem] as AnyNode[]
    expect(physicalOf(nodes, stem.id, 'side-a')).toBeCloseTo(4 * 3 - 0.1 * 3, 6)
    expect(physicalOf(nodes, stem.id, 'side-b')).toBeCloseTo(4 * 3 - 0.1 * 3, 6)
    expect(physicalOf(nodes, spine.id, 'side-a')).toBeCloseTo(18, 6)
  })
})

describe('a collinear butt joint', () => {
  it('trims nothing — the footprints meet but do not overlap', () => {
    const a = wall({ start: [0, 0], end: [5, 0], castOrder: 1 })
    const b = wall({ start: [5, 0], end: [9, 0], castOrder: 2 })
    const nodes = [a, b] as AnyNode[]
    expect(physicalOf(nodes, b.id, 'side-a')).toBeCloseTo(12, 6)
    expect(physicalOf(nodes, b.id, 'side-b')).toBeCloseTo(12, 6)
  })
})

describe('a wall running into a column', () => {
  it('trims both sides of the wall by the column it ends inside', () => {
    const column = ColumnNode.parse({
      position: [5, 0, 0],
      crossSection: 'square',
      width: 0.4,
      depth: 0.4,
      height: 3,
      castOrder: 1,
    })
    const w = wall({ castOrder: 2 })
    const nodes = [column, w] as AnyNode[]
    // The wall's centreline stops at the column centre, so 0.2 m of each side
    // face lies inside the column footprint.
    expect(physicalOf(nodes, w.id, 'side-a')).toBeCloseTo(15 - 0.2 * 3, 6)
    expect(physicalOf(nodes, w.id, 'side-b')).toBeCloseTo(15 - 0.2 * 3, 6)
  })
})

/**
 * A trimmed face has to say who took the area. "12 m² instead of 15" is an
 * argument, and the estimator's next question is always which neighbour has the
 * other 3 — so the loss is a `Deduction` naming it rather than a bare number.
 */
describe('every trim leaves an audit line', () => {
  function sideDeductions(nodes: AnyNode[], id: string) {
    const faces = coverageForElement(id as AnyNodeId, nodes)?.faces ?? []
    return faces
      .filter((face) => face.role.startsWith('side'))
      .flatMap((face) => face.deductions)
      .filter(
        (d) => d.reason === 'CORNER_OVERLAP_REASSIGNED' || d.reason === 'INTERSECTION',
      )
  }

  it('names the neighbour that owns the overlap, and deducts nothing measured', () => {
    const a = wall({ castOrder: 1 })
    const b = wall({ start: [5, 0], end: [5, 4], castOrder: 2 })
    const deductions = sideDeductions([a, b] as AnyNode[], b.id)
    expect(deductions).toHaveLength(1)
    expect(deductions[0]?.sourceId).toBe(a.id)
    expect(deductions[0]?.physicalSqM).toBeCloseTo(0.1 * 3, 6)
    // No standard deducts at an intersection, so the contract keeps the full
    // rectangle — the reason is recorded rather than the deduction skipped.
    expect(deductions[0]?.measuredSqM).toBe(0)
  })

  it('calls a sequenced overlap reassigned and a monolithic one an intersection', () => {
    const sequenced = (() => {
      const a = wall({ castOrder: 1 })
      const b = wall({ start: [5, 0], end: [5, 4], castOrder: 2 })
      return sideDeductions([a, b] as AnyNode[], b.id)
    })()
    // A real joint exists and someone formed it — just not us.
    expect(sequenced[0]?.reason).toBe('CORNER_OVERLAP_REASSIGNED')

    const monolithic = (() => {
      const a = wall({ castOrder: 1, pourId: 'P1' })
      const b = wall({ start: [5, 0], end: [5, 4], castOrder: 2, pourId: 'P1' })
      return sideDeductions([a, b] as AnyNode[], b.id)
    })()
    // Poured together, so there is no surface here for anyone to form.
    expect(monolithic[0]?.reason).toBe('INTERSECTION')
  })

  it('charges a stretch buried by three walls once, to the one that formed it', () => {
    // All three bury the same 0.2 m of the stem's face. Summing overlaps would
    // take it off three times; the deductions have to sum to the actual trim.
    const stem = wall({ start: [5, 0], end: [5, 4], castOrder: 4 })
    const spine = wall({ start: [0, 0], end: [10, 0], castOrder: 1 })
    const second = wall({ start: [0, 0], end: [10, 0], castOrder: 2 })
    const third = wall({ start: [0, 0], end: [10, 0], castOrder: 3 })
    const nodes = [stem, spine, second, third] as AnyNode[]
    const deductions = sideDeductions(nodes, stem.id)
    const perSide = deductions.filter((d) => d.sourceId === spine.id)
    expect(perSide).toHaveLength(2)
    // The earliest-cast wall is credited with the whole run; the later two add
    // nothing and so leave no line.
    expect(deductions.every((d) => d.sourceId === spine.id)).toBe(true)
    const physical = coverageForElement(stem.id as AnyNodeId, nodes)?.faces.find(
      (f) => f.role === 'side-a',
    )?.physicalArea
    expect(physical).toBeCloseTo(4 * 3 - 0.1 * 3, 6)
  })

  it('leaves no line where nothing was trimmed', () => {
    const a = wall({ start: [0, 0], end: [5, 0], castOrder: 1 })
    const b = wall({ start: [5, 0], end: [9, 0], castOrder: 2 })
    expect(sideDeductions([a, b] as AnyNode[], b.id)).toHaveLength(0)
  })
})

describe('no region is ever counted twice', () => {
  it('keeps the summed physical side area at or below the untrimmed total', () => {
    const a = wall({ start: [0, 0], end: [5, 0], castOrder: 1 })
    const b = wall({ start: [5, 0], end: [5, 4], castOrder: 2 })
    const c = wall({ start: [5, 4], end: [0, 4], castOrder: 3 })
    const coverage = classifyCoverage([a, b, c] as AnyNode[])
    let physical = 0
    for (const element of coverage.values()) {
      for (const face of element.faces) {
        if (face.role.startsWith('side')) physical += face.physicalArea
      }
    }
    const gross = 2 * (5 * 3) + 2 * (4 * 3) + 2 * (5 * 3)
    expect(physical).toBeLessThan(gross)
    // Two corners, each trimming one outer side of the later wall by half the
    // earlier wall's core over the full height.
    expect(physical).toBeCloseTo(gross - 2 * (0.1 * 3), 6)
  })
})
