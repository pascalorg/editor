import { describe, expect, it } from 'bun:test'
import { ColumnNode } from '../../../schema/nodes/column'
import { WallNode } from '../../../schema/nodes/wall'
import type { AnyNode, AnyNodeId } from '../../../schema/types'
import { classifyCoverage, coverageForElement } from './faces'
import { cornerLegLength, findJunctions, outsideCornerLeg } from './junctions'
import { collectCastableElements } from './elements'
import type { CornerLeg, FaceRole, JunctionCorner } from './types'

function wall(overrides: Partial<Parameters<typeof WallNode.parse>[0]> = {}) {
  return WallNode.parse({
    start: [0, 0],
    end: [5, 0],
    thickness: 0.2,
    height: 3,
    formworkType: 'plywood',
    ...overrides,
  })
}

function formedRoles(nodes: AnyNode[], id: AnyNodeId): FaceRole[] {
  const coverage = coverageForElement(id, nodes)
  return (coverage?.faces ?? []).filter((f) => f.formed).map((f) => f.role)
}

describe('freestanding wall', () => {
  it('forms all four faces — both sides plus a stop-end at each free end', () => {
    const w = wall()
    const roles = formedRoles([w], w.id as AnyNodeId)
    expect(roles.sort()).toEqual(['end-end', 'end-start', 'side-a', 'side-b'])
  })

  it('never forms the bottom', () => {
    const w = wall()
    const bottom = coverageForElement(w.id as AnyNodeId, [w])?.faces.find((f) => f.role === 'bottom')
    expect(bottom?.formed).toBe(false)
    expect(bottom?.reason).toBe('BEARS_ON_KICKER_OR_SUBSTRATE')
  })

  it('leaves a flat top screeded open', () => {
    const w = wall()
    const top = coverageForElement(w.id as AnyNodeId, [w])?.faces.find((f) => f.role === 'top')
    expect(top?.formed).toBe(false)
    expect(top?.reason).toBe('SCREEDED_OPEN')
  })
})

describe('wall between two earlier-cast columns', () => {
  const columnA = ColumnNode.parse({
    position: [0, 0, 0],
    crossSection: 'square',
    width: 0.4,
    depth: 0.4,
    height: 3,
    castOrder: 1,
  })
  const columnB = ColumnNode.parse({
    position: [5, 0, 0],
    crossSection: 'square',
    width: 0.4,
    depth: 0.4,
    height: 3,
    castOrder: 1,
  })
  const w = wall({ castOrder: 2 })
  const nodes = [columnA, columnB, w] as AnyNode[]

  it('forms only the two sides — the ends butt hardened concrete', () => {
    expect(formedRoles(nodes, w.id as AnyNodeId).sort()).toEqual(['side-a', 'side-b'])
  })

  it('records why each end is unformed, naming the column', () => {
    const faces = coverageForElement(w.id as AnyNodeId, nodes)?.faces ?? []
    const start = faces.find((f) => f.role === 'end-start')
    expect(start?.reason).toBe('ABUTS_HARDENED_CONCRETE')
    expect(start?.neighbourId).toBe(columnA.id)
    expect(faces.find((f) => f.role === 'end-end')?.neighbourId).toBe(columnB.id)
  })

  it('reverses to stop-ends when the wall is cast first instead', () => {
    const early = wall({ castOrder: 0 })
    const roles = formedRoles([columnA, columnB, early] as AnyNode[], early.id as AnyNodeId)
    expect(roles.sort()).toEqual(['end-end', 'end-start', 'side-a', 'side-b'])
  })

  it('marks a cast-first stop-end as penetrated by starter bars', () => {
    const early = wall({ castOrder: 0 })
    const faces =
      coverageForElement(early.id as AnyNodeId, [columnA, columnB, early] as AnyNode[])?.faces ?? []
    const start = faces.find((f) => f.role === 'end-start')
    expect(start?.reason).toBe('STOP_END_FOR_LATER_ABUTMENT')
    expect(start?.starterPenetrations).toBe(true)
  })
})

describe('cast order is required to suppress a stop-end', () => {
  it('forms the abutting end when neither element is sequenced, and says why', () => {
    const columnA = ColumnNode.parse({ position: [0, 0, 0], height: 3 })
    const nodes = [columnA, wall()] as AnyNode[]
    const w = nodes[1] as { id: string }
    const start = coverageForElement(w.id as AnyNodeId, nodes)?.faces.find(
      (f) => f.role === 'end-start',
    )
    expect(start?.formed).toBe(true)
    expect(start?.reason).toBe('STOP_END_UNSEQUENCED')
    expect(start?.neighbourId).toBe(columnA.id)
  })

  it('drops that end once both elements are sequenced', () => {
    const columnA = ColumnNode.parse({ position: [0, 0, 0], height: 3, castOrder: 1 })
    const w = wall({ castOrder: 2 })
    const start = coverageForElement(w.id as AnyNodeId, [columnA, w] as AnyNode[])?.faces.find(
      (f) => f.role === 'end-start',
    )
    expect(start?.formed).toBe(false)
    expect(start?.reason).toBe('ABUTS_HARDENED_CONCRETE')
  })
})

describe('monolithic pours', () => {
  it('continues through a shared pourId without a stop-end', () => {
    const a = wall({ end: [5, 0], pourId: 'P1', castOrder: 1 })
    const b = wall({ start: [5, 0], end: [5, 4], pourId: 'P1', castOrder: 1 })
    const faces = coverageForElement(a.id as AnyNodeId, [a, b] as AnyNode[])?.faces ?? []
    const end = faces.find((f) => f.role === 'end-end')
    expect(end?.formed).toBe(false)
    expect(end?.reason).toBe('MONOLITHIC_CONTINUATION')
  })

  it('gives exactly one of two same-order walls the stop-end', () => {
    const a = wall({ end: [5, 0], castOrder: 1 })
    const b = wall({ start: [5, 0], end: [5, 4], castOrder: 1 })
    const nodes = [a, b] as AnyNode[]
    const aEnd = coverageForElement(a.id as AnyNodeId, nodes)?.faces.find(
      (f) => f.role === 'end-end',
    )
    const bStart = coverageForElement(b.id as AnyNodeId, nodes)?.faces.find(
      (f) => f.role === 'end-start',
    )
    expect([aEnd?.formed, bStart?.formed].filter(Boolean)).toHaveLength(1)
  })
})

describe('single-sided and against-earth', () => {
  it('forms one side only when the other is braced', () => {
    const w = wall({ formworkMode: 'single-sided-a' })
    const roles = formedRoles([w], w.id as AnyNodeId)
    expect(roles).toContain('side-a')
    expect(roles).not.toContain('side-b')
  })

  it('does not form a face cast against earth', () => {
    const w = wall({ againstEarthSide: 'b' })
    const b = coverageForElement(w.id as AnyNodeId, [w])?.faces.find((f) => f.role === 'side-b')
    expect(b?.reason).toBe('AGAINST_EARTH')
  })

  it('emits nothing when formwork is disabled', () => {
    const w = wall({ formworkType: 'none' })
    expect(formedRoles([w], w.id as AnyNodeId)).toEqual([])
  })
})

describe('top surface', () => {
  it('forms a sloping top and loads it in uplift', () => {
    const w = wall({ topSurface: { kind: 'open', slopeDeg: 25 } })
    const top = coverageForElement(w.id as AnyNodeId, [w])?.faces.find((f) => f.role === 'top')
    expect(top?.formed).toBe(true)
    expect(top?.reason).toBe('FORMED_SLOPING_TOP')
    expect(top?.upliftLoaded).toBe(true)
  })

  it('leaves a top cast against a soffit unformed', () => {
    const w = wall({ topSurface: { kind: 'bounded', slopeDeg: 0 } })
    const top = coverageForElement(w.id as AnyNodeId, [w])?.faces.find((f) => f.role === 'top')
    expect(top?.reason).toBe('CAST_AGAINST_SOFFIT_ABOVE')
  })
})

describe('areas', () => {
  it('measures sides by length x height and ends by thickness x height', () => {
    const w = wall({ start: [0, 0], end: [5, 0], thickness: 0.2, height: 3 })
    const faces = coverageForElement(w.id as AnyNodeId, [w])?.faces ?? []
    expect(faces.find((f) => f.role === 'side-a')?.physicalArea).toBeCloseTo(15, 6)
    expect(faces.find((f) => f.role === 'end-start')?.physicalArea).toBeCloseTo(0.6, 6)
  })

  it('totals a freestanding wall as both sides plus both ends', () => {
    const w = wall({ start: [0, 0], end: [5, 0], thickness: 0.2, height: 3 })
    const coverage = coverageForElement(w.id as AnyNodeId, [w])
    expect(coverage?.physicalArea).toBeCloseTo(31.2, 6)
    expect(coverage?.measuredArea).toBeCloseTo(31.2, 6)
  })

  it('reports zero area on unformed faces', () => {
    const w = wall({ againstEarthSide: 'a' })
    const a = coverageForElement(w.id as AnyNodeId, [w])?.faces.find((f) => f.role === 'side-a')
    expect(a?.physicalArea).toBe(0)
    expect(a?.measuredArea).toBe(0)
  })
})

describe('every face carries a reason', () => {
  it('holds for all six roles on every wall in a network', () => {
    const a = wall({ end: [5, 0] })
    const b = wall({ start: [5, 0], end: [5, 4] })
    const coverage = classifyCoverage([a, b] as AnyNode[])
    expect(coverage.size).toBe(2)
    for (const element of coverage.values()) {
      expect(element.faces).toHaveLength(6)
      for (const f of element.faces) expect(f.reason).toBeTruthy()
    }
  })
})

describe('junctions own the corner hardware', () => {
  it('emits one inside and one outside unit for an L', () => {
    const a = wall({ end: [5, 0] })
    const b = wall({ start: [5, 0], end: [5, 4] })
    const junctions = findJunctions(collectCastableElements([a, b] as AnyNode[]))
    const corner = junctions.find((j) => j.kind === 'corner-l')
    expect(corner?.insideCornerCount).toBe(1)
    expect(corner?.outsideCornerCount).toBe(1)
    expect(corner?.elementIds).toHaveLength(2)
  })

  it('emits two inside units for a T', () => {
    const a = wall({ end: [5, 0] })
    const b = wall({ start: [5, 0], end: [5, 4] })
    const c = wall({ start: [5, 0], end: [5, -4] })
    const junctions = findJunctions(collectCastableElements([a, b, c] as AnyNode[]))
    expect(junctions.find((j) => j.kind === 't-junction')?.insideCornerCount).toBe(2)
  })

  it('makes the outside leg longer than the inside leg by the core thickness', () => {
    expect(outsideCornerLeg(0.1, 0.2)).toBeCloseTo(0.3, 6)
  })

  it('lands each unit’s two legs on facing sides of the angle', () => {
    // The inside unit fills the re-entrant angle, so both its legs are on the
    // faces looking into it; the outside unit wraps the other two. Getting these
    // backwards puts the hardware on the wrong skin of both walls.
    const a = wall({ end: [5, 0] })
    const b = wall({ start: [5, 0], end: [5, 4] })
    const junction = findJunctions(collectCastableElements([a, b] as AnyNode[]))[0]
    const inside = junction?.corners.find((c) => c.side === 'inside')
    const outside = junction?.corners.find((c) => c.side === 'outside')
    expect(inside?.legs.map((leg) => leg.face)).toEqual(['a', 'a'])
    expect(outside?.legs.map((leg) => leg.face)).toEqual(['b', 'b'])
    expect(inside?.angleDeg).toBeCloseTo(90, 6)
    expect(outside?.angleDeg).toBeCloseTo(270, 6)
  })

  it('runs a T’s two spine legs opposite ways out of the same face', () => {
    // Both land on the spine's face `a` at the same point, so `towardEnd` is the
    // only thing distinguishing them — a layout keyed on (end, face) would
    // collapse them into one.
    const spine = wall({ start: [0, 0], end: [6, 0] })
    const stem = wall({ start: [3, 0], end: [3, 4] })
    const junction = findJunctions(collectCastableElements([spine, stem] as AnyNode[]))[0]
    const spineLegs = (junction?.corners ?? []).flatMap((corner) =>
      corner.legs.filter((leg) => leg.elementId === spine.id),
    )
    expect(spineLegs).toHaveLength(2)
    expect(spineLegs.every((leg) => leg.face === 'a')).toBe(true)
    expect(spineLegs.every((leg) => leg.alongM === 3)).toBe(true)
    expect(spineLegs.map((leg) => leg.towardEnd).sort()).toEqual([false, true])
    expect(spineLegs.every((leg) => leg.end === undefined)).toBe(true)
  })

  it('records the other wall’s core on each leg, not its own', () => {
    // An outside leg wraps the core it turns onto, so a corner between walls of
    // different thickness has legs of different lengths.
    const a = wall({ end: [5, 0], thickness: 0.2 })
    const b = wall({ start: [5, 0], end: [5, 4], thickness: 0.3 })
    const junction = findJunctions(collectCastableElements([a, b] as AnyNode[]))[0]
    const outside = junction?.corners.find((c) => c.side === 'outside')
    const onA = outside?.legs.find((leg) => leg.elementId === a.id)
    const onB = outside?.legs.find((leg) => leg.elementId === b.id)
    expect(onA?.turnsOntoThicknessM).toBeCloseTo(0.3, 6)
    expect(onB?.turnsOntoThicknessM).toBeCloseTo(0.2, 6)
    expect(cornerLegLength(outside as JunctionCorner, onA as CornerLeg, 0.3)).toBeCloseTo(0.6, 6)
    expect(cornerLegLength(outside as JunctionCorner, onB as CornerLeg, 0.3)).toBeCloseTo(0.5, 6)
  })
})

describe('exactly one element bills each corner unit', () => {
  const monolithic = () => {
    const a = wall({ end: [5, 0], pourId: 'P1', castOrder: 1 })
    const b = wall({ start: [5, 0], end: [5, 4], pourId: 'P1', castOrder: 1 })
    return { a, b, nodes: [a, b] as AnyNode[] }
  }

  it('gives both walls the pair of units and only one the bill', () => {
    const { a, b, nodes } = monolithic()
    const onA = coverageForElement(a.id as AnyNodeId, nodes)?.corners ?? []
    const onB = coverageForElement(b.id as AnyNodeId, nodes)?.corners ?? []
    expect(onA).toHaveLength(2)
    expect(onB).toHaveLength(2)
    // Both walls have to lay out around the hardware, so both see it formed.
    expect(onA.every((corner) => corner.formed)).toBe(true)
    expect(onB.every((corner) => corner.formed)).toBe(true)
    // One inside and one outside across the pair, billed once each.
    const owned = [...onA, ...onB].filter((corner) => corner.owns)
    expect(owned.map((corner) => corner.corner.side).sort()).toEqual(['inside', 'outside'])
  })

  it('bills the earlier-cast wall of the pair', () => {
    // A sequence inside one pour decides ownership outright. (A shared cast order
    // ties on the lower id, which is generated — hence the pair-level assertion
    // in the test above rather than one naming a wall.)
    const early = wall({ end: [5, 0], pourId: 'P1', castOrder: 5 })
    const late = wall({ start: [5, 0], end: [5, 4], pourId: 'P1', castOrder: 1 })
    const flipped = [early, late] as AnyNode[]
    expect(
      (coverageForElement(early.id as AnyNodeId, flipped)?.corners ?? []).some((c) => c.owns),
    ).toBe(false)
    expect(
      (coverageForElement(late.id as AnyNodeId, flipped)?.corners ?? []).every((c) => c.owns),
    ).toBe(true)
  })

  it('forms no corner where the walls are cast in sequence', () => {
    // The later wall butts hardened concrete: its panels run up to that face and
    // there is nothing to turn. The unit is still reported so the layout knows
    // the junction is there.
    const a = wall({ end: [5, 0], castOrder: 1 })
    const b = wall({ start: [5, 0], end: [5, 4], castOrder: 2 })
    const corners = coverageForElement(b.id as AnyNodeId, [a, b] as AnyNode[])?.corners ?? []
    expect(corners).toHaveLength(2)
    expect(corners.some((corner) => corner.formed)).toBe(false)
  })

  it('never puts a corner unit and a stop-end at the same point', () => {
    // Contradictory hardware: a bulkhead closes the pour and a corner turns it.
    // Monolithic is the one case with no bulkhead, so it is the only case with a
    // corner — including the unsequenced pair, which keeps the bulkhead.
    for (const overrides of [
      { pourId: 'P1', castOrder: 1 },
      { castOrder: 1 },
      {},
    ] as Array<Record<string, unknown>>) {
      const a = wall({ end: [5, 0], ...overrides })
      const b = wall({ start: [5, 0], end: [5, 4], ...overrides })
      const nodes = [a, b] as AnyNode[]
      for (const element of [a, b]) {
        const coverage = coverageForElement(element.id as AnyNodeId, nodes)
        const plated = new Set(
          (coverage?.faces ?? [])
            .filter((f) => f.formed && (f.role === 'end-start' || f.role === 'end-end'))
            .map((f) => (f.role === 'end-start' ? 'start' : 'end')),
        )
        for (const corner of coverage?.corners ?? []) {
          if (!corner.formed) continue
          expect(plated.has(corner.leg.end as string)).toBe(false)
        }
      }
    }
  })
})
