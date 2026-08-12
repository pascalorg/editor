import { describe, expect, it } from 'bun:test'
import { ColumnNode } from '../../../schema/nodes/column'
import { ConstructionJointNode } from '../../../schema/nodes/construction-joint'
import { SlabNode } from '../../../schema/nodes/slab'
import { WallNode } from '../../../schema/nodes/wall'
import { WindowNode } from '../../../schema/nodes/window'
import type { AnyNode, AnyNodeId } from '../../../schema/types'
import type { AcquireLine, FormworkAcquisition } from '../acquire'
import { DOKA_FRAMAX_XLIFE, formworkSystem } from '../catalog'
import { layOutFace } from '../layout/courses'
import { type FaceGangs, gangFace } from '../layout/gangs'
import { packStrip } from '../layout/strip-pack'
import { pressureEnvelope } from '../pressure'
import { DEFAULT_FORMWORK_SETTINGS } from '../settings'
import { failingElementIds, validateFormwork, validationSummary } from './invariants'
import type { InvariantId } from './types'

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

function ids(nodes: AnyNode[], invariant: InvariantId): AnyNodeId[][] {
  return validateFormwork(nodes)
    .findings.filter((finding) => finding.invariant === invariant)
    .map((finding) => finding.elementIds)
}

function fired(nodes: AnyNode[], invariant: InvariantId): boolean {
  return validateFormwork(nodes).findings.some((finding) => finding.invariant === invariant)
}

describe('cast order cycles', () => {
  it('does not fire on a plain sequence of unpoured elements', () => {
    // Three walls in a run, each cast after the last. `castOrder` is one integer
    // per element, so a graph over elements alone can never close a ring.
    const a = wall({ start: [0, 0], end: [5, 0], castOrder: 1 })
    const b = wall({ start: [5, 0], end: [5, 5], castOrder: 2 })
    const c = wall({ start: [5, 5], end: [0, 0], castOrder: 3 })
    expect(fired([a, b, c] as AnyNode[], 'CAST_ORDER_CYCLE')).toBe(false)
  })

  it('does not fire when a pour is wholly before or after its neighbour', () => {
    const first = wall({ start: [0, 0], end: [5, 0], castOrder: 1, pourId: 'P' })
    const second = wall({ start: [5, 5], end: [0, 0], castOrder: 2, pourId: 'P' })
    const other = wall({ start: [5, 0], end: [5, 5], castOrder: 3, pourId: 'Q' })
    expect(fired([first, second, other] as AnyNode[], 'CAST_ORDER_CYCLE')).toBe(false)
  })

  it('fires when one pour is cast both before and after another', () => {
    // P's two walls sit either side of Q in the sequence, so P must be cast
    // before Q and after it — and P is one monolithic operation that cannot be
    // split in two. Neither wall's own order is wrong.
    const early = wall({ start: [0, 0], end: [5, 0], castOrder: 1, pourId: 'P' })
    const middle = wall({ start: [5, 0], end: [5, 5], castOrder: 2, pourId: 'Q' })
    const late = wall({ start: [5, 5], end: [0, 0], castOrder: 3, pourId: 'P' })
    expect(fired([early, middle, late] as AnyNode[], 'CAST_ORDER_CYCLE')).toBe(true)
  })

  it('names every element in the ring, not the one that closed it', () => {
    const early = wall({ start: [0, 0], end: [5, 0], castOrder: 1, pourId: 'P' })
    const middle = wall({ start: [5, 0], end: [5, 5], castOrder: 2, pourId: 'Q' })
    const late = wall({ start: [5, 5], end: [0, 0], castOrder: 3, pourId: 'P' })
    const rings = ids([early, middle, late] as AnyNode[], 'CAST_ORDER_CYCLE')
    expect(rings.length).toBeGreaterThan(0)
    expect([...(rings[0] as AnyNodeId[])].sort()).toEqual(
      [early.id, middle.id, late.id].sort() as AnyNodeId[],
    )
  })

  it('names the pours in the message, since the fix is to split one', () => {
    const early = wall({ start: [0, 0], end: [5, 0], castOrder: 1, pourId: 'P' })
    const middle = wall({ start: [5, 0], end: [5, 5], castOrder: 2, pourId: 'Q' })
    const late = wall({ start: [5, 5], end: [0, 0], castOrder: 3, pourId: 'P' })
    const finding = validateFormwork([early, middle, late] as AnyNode[]).findings.find(
      (f) => f.invariant === 'CAST_ORDER_CYCLE',
    )
    expect(finding?.message).toContain('pour P')
    expect(finding?.message).toContain('pour Q')
  })

  it('is silent when nothing is sequenced — that is a gap, not a contradiction', () => {
    const a = wall({ start: [0, 0], end: [5, 0], pourId: 'P' })
    const b = wall({ start: [5, 0], end: [5, 5], pourId: 'Q' })
    expect(fired([a, b] as AnyNode[], 'CAST_ORDER_CYCLE')).toBe(false)
  })
})

describe('single-sided anchors', () => {
  it('accepts a single-sided wall cast against earth', () => {
    const w = wall({ formworkMode: 'single-sided-a', againstEarthSide: 'b' })
    expect(fired([w] as AnyNode[], 'SINGLE_SIDED_ANCHOR_NOT_EARLIER')).toBe(false)
  })

  it('rejects the same wall once the earth side is dropped', () => {
    const w = wall({ formworkMode: 'single-sided-a' })
    expect(fired([w] as AnyNode[], 'SINGLE_SIDED_ANCHOR_NOT_EARLIER')).toBe(true)
  })

  it('accepts one bearing back onto a wall cast before it', () => {
    const earlier = wall({ start: [5, 0], end: [5, 5], castOrder: 1 })
    const later = wall({ start: [0, 0], end: [5, 0], castOrder: 2, formworkMode: 'single-sided-a' })
    expect(fired([earlier, later] as AnyNode[], 'SINGLE_SIDED_ANCHOR_NOT_EARLIER')).toBe(false)
  })

  it('rejects it when the anchor is cast after — nothing has hardened yet', () => {
    const neighbour = wall({ start: [5, 0], end: [5, 5], castOrder: 2 })
    const single = wall({
      start: [0, 0],
      end: [5, 0],
      castOrder: 1,
      formworkMode: 'single-sided-a',
    })
    expect(fired([neighbour, single] as AnyNode[], 'SINGLE_SIDED_ANCHOR_NOT_EARLIER')).toBe(true)
  })

  it('leaves double-sided walls alone', () => {
    const w = wall()
    expect(fired([w] as AnyNode[], 'SINGLE_SIDED_ANCHOR_NOT_EARLIER')).toBe(false)
  })
})

describe('overlap ownership', () => {
  it('passes a sequenced corner, where exactly one wall deducts', () => {
    const a = wall({ start: [0, 0], end: [5, 0], castOrder: 1 })
    const b = wall({ start: [5, 0], end: [5, 5], castOrder: 2 })
    expect(fired([a, b] as AnyNode[], 'AREA_DOUBLE_COUNTED')).toBe(false)
  })

  it('passes an unsequenced corner, where the id tie-break still picks one', () => {
    const a = wall({ start: [0, 0], end: [5, 0] })
    const b = wall({ start: [5, 0], end: [5, 5] })
    expect(fired([a, b] as AnyNode[], 'AREA_DOUBLE_COUNTED')).toBe(false)
  })

  it('passes a monolithic corner — the overlap is nobody’s surface', () => {
    const a = wall({ start: [0, 0], end: [5, 0], pourId: 'P1' })
    const b = wall({ start: [5, 0], end: [5, 5], pourId: 'P1' })
    expect(fired([a, b] as AnyNode[], 'AREA_DOUBLE_COUNTED')).toBe(false)
  })

  it('passes a whole level of walls and columns', () => {
    const nodes: AnyNode[] = [
      wall({ start: [0, 0], end: [6, 0], castOrder: 2 }),
      wall({ start: [6, 0], end: [6, 4], castOrder: 3 }),
      wall({ start: [6, 4], end: [0, 4], castOrder: 4 }),
      wall({ start: [0, 4], end: [0, 0], castOrder: 5 }),
      ColumnNode.parse({
        position: [0, 0, 0],
        crossSection: 'square',
        width: 0.4,
        depth: 0.4,
        height: 3,
        castOrder: 1,
        formworkType: 'steel-panel',
      }),
    ] as AnyNode[]
    expect(fired(nodes, 'AREA_DOUBLE_COUNTED')).toBe(false)
  })
})

describe('openings across lift joints', () => {
  const limits = { maxLiftHeight: 1.5 }
  const window = (wallId: string, centreY: number, height = 1.2) =>
    WindowNode.parse({
      wallId,
      parentId: wallId,
      position: [2.5, centreY, 0],
      width: 1.2,
      height,
    })

  it('fires when the joint runs through the void', () => {
    // A 3 m wall capped at 1.5 m joints at 1.5 m, and a window centred there
    // spans 0.9–2.1 m — so the bulkhead crosses a hole with nothing to bear on.
    const w = wall({ height: 3 })
    const report = validateFormwork([w, window(w.id, 1.5)] as AnyNode[], { limits })
    const finding = report.findings.find((f) => f.invariant === 'OPENING_STRADDLES_LIFT_JOINT')
    expect(finding?.severity).toBe('error')
    expect(finding?.locus?.elevationM).toBeCloseTo(1.5, 6)
  })

  it('names both the wall and the opening, so either can be moved', () => {
    const w = wall({ height: 3 })
    const opening = window(w.id, 1.5)
    const finding = validateFormwork([w, opening] as AnyNode[], { limits }).findings.find(
      (f) => f.invariant === 'OPENING_STRADDLES_LIFT_JOINT',
    )
    expect([...(finding?.elementIds ?? [])].sort()).toEqual(
      [w.id, opening.id].sort() as AnyNodeId[],
    )
  })

  it('passes once the opening sits wholly within one lift', () => {
    // Centred at 0.7 m the window spans 0.1–1.3 m, clear below the 1.5 m joint.
    const w = wall({ height: 3 })
    const report = validateFormwork([w, window(w.id, 0.7)] as AnyNode[], { limits })
    expect(report.findings.some((f) => f.invariant === 'OPENING_STRADDLES_LIFT_JOINT')).toBe(false)
  })

  it('is silent on a wall with no lift joint at all', () => {
    const w = wall({ height: 1.2 })
    const report = validateFormwork([w, window(w.id, 0.6, 0.4)] as AnyNode[], { limits })
    expect(report.findings.some((f) => f.invariant === 'OPENING_STRADDLES_LIFT_JOINT')).toBe(false)
  })

  it('is silent when no lift cap is configured, however tall the wall', () => {
    const w = wall({ height: 8 })
    const report = validateFormwork([w, window(w.id, 4)] as AnyNode[])
    expect(report.findings.some((f) => f.invariant === 'OPENING_STRADDLES_LIFT_JOINT')).toBe(false)
  })
})

describe('expansion joints', () => {
  it('fires when the two sides share a pour id', () => {
    const a = wall({ start: [0, 0], end: [5, 0], pourId: 'P1' })
    const b = wall({ start: [5, 0], end: [10, 0], pourId: 'P1' })
    const joint = ConstructionJointNode.parse({
      kind: 'expansion',
      elementIds: [a.id, b.id],
    })
    const found = ids([a, b, joint] as AnyNode[], 'EXPANSION_JOINT_BRIDGED')
    expect(found.length).toBe(1)
    expect([...(found[0] as AnyNodeId[])].sort()).toEqual([a.id, b.id].sort() as AnyNodeId[])
  })

  it('passes once the two sides are given different pours', () => {
    const a = wall({ start: [0, 0], end: [5, 0], pourId: 'P1' })
    const b = wall({ start: [5, 0], end: [10, 0], pourId: 'P2' })
    const joint = ConstructionJointNode.parse({
      kind: 'expansion',
      elementIds: [a.id, b.id],
    })
    expect(fired([a, b, joint] as AnyNode[], 'EXPANSION_JOINT_BRIDGED')).toBe(false)
  })

  it('ignores a construction joint, which the solver is allowed to move', () => {
    const a = wall({ start: [0, 0], end: [5, 0], pourId: 'P1' })
    const b = wall({ start: [5, 0], end: [10, 0], pourId: 'P1' })
    const joint = ConstructionJointNode.parse({
      kind: 'construction',
      elementIds: [a.id, b.id],
    })
    expect(fired([a, b, joint] as AnyNode[], 'EXPANSION_JOINT_BRIDGED')).toBe(false)
  })

  it('splits an interior joint rather than bridging it', () => {
    const w = wall({ start: [0, 0], end: [10, 0] })
    const joint = ConstructionJointNode.parse({
      kind: 'expansion',
      elementIds: [w.id],
      along: 5,
    })
    expect(fired([w, joint] as AnyNode[], 'EXPANSION_JOINT_BRIDGED')).toBe(false)
  })

  it('fires when an interior joint sits so close to the end it was dropped', () => {
    const w = wall({ start: [0, 0], end: [10, 0] })
    const joint = ConstructionJointNode.parse({
      kind: 'expansion',
      elementIds: [w.id],
      // Inside the wall but under `MIN_SEGMENT_LENGTH`, so the split discards it
      // and the whole wall comes back as one pour that crosses it.
      along: 0.0005,
    })
    expect(fired([w, joint] as AnyNode[], 'EXPANSION_JOINT_BRIDGED')).toBe(true)
  })
})

describe('waterstop runs', () => {
  const waterstopJoint = (elementId: string, along: number) =>
    ConstructionJointNode.parse({
      kind: 'construction',
      elementIds: [elementId],
      along,
      treatments: [{ kind: 'waterstop', waterstopType: 'pvc-central' }],
    })
  const bareJoint = (elementId: string, along: number) =>
    ConstructionJointNode.parse({
      kind: 'construction',
      elementIds: [elementId],
      along,
      treatments: [{ kind: 'roughening' }],
    })

  it('fires when one joint of a water-retaining wall has no waterstop', () => {
    const w = wall({ exposureClass: 'water-retaining' })
    const nodes = [w, waterstopJoint(w.id, 2), bareJoint(w.id, 4)] as AnyNode[]
    expect(fired(nodes, 'WATERSTOP_RUN_NOT_CLOSED')).toBe(true)
  })

  it('names the unsealed joint, so the reader knows which one to fix', () => {
    const w = wall({ exposureClass: 'water-retaining' })
    const bare = bareJoint(w.id, 4)
    const found = ids([w, waterstopJoint(w.id, 2), bare] as AnyNode[], 'WATERSTOP_RUN_NOT_CLOSED')
    expect(found[0]).toContain(bare.id as AnyNodeId)
  })

  it('passes once every joint carries one', () => {
    const w = wall({ exposureClass: 'water-retaining' })
    const nodes = [w, waterstopJoint(w.id, 2), waterstopJoint(w.id, 4)] as AnyNode[]
    expect(fired(nodes, 'WATERSTOP_RUN_NOT_CLOSED')).toBe(false)
  })

  it('accepts an injectable hose as the other way a joint is sealed', () => {
    const w = wall({ exposureClass: 'water-retaining' })
    const hose = ConstructionJointNode.parse({
      kind: 'construction',
      elementIds: [w.id],
      along: 4,
      treatments: [{ kind: 'injectable-hose' }],
    })
    expect(fired([w, waterstopJoint(w.id, 2), hose] as AnyNode[], 'WATERSTOP_RUN_NOT_CLOSED')).toBe(
      false,
    )
  })

  it('says nothing about a wall that is not water-retaining', () => {
    const w = wall()
    const nodes = [w, waterstopJoint(w.id, 2), bareJoint(w.id, 4)] as AnyNode[]
    expect(fired(nodes, 'WATERSTOP_RUN_NOT_CLOSED')).toBe(false)
  })

  it('does not fire when no joint is sealed — that is a wall nobody has detailed', () => {
    const w = wall({ exposureClass: 'water-retaining' })
    const nodes = [w, bareJoint(w.id, 2), bareJoint(w.id, 4)] as AnyNode[]
    expect(fired(nodes, 'WATERSTOP_RUN_NOT_CLOSED')).toBe(false)
  })
})

describe('ties through waterstops', () => {
  /**
   * The same 6 m Framax face `ties around openings` uses: drilled at 1.35, 3.00 and
   * 4.65 m along, and at 0.775 and 2.125 m up. Those are the catalog's own positions
   * rather than the test's, so a catalog change is a test failure rather than a check
   * that quietly stops describing the wall.
   *
   * The grid crossing a construction joint at all is the premise of the check:
   * `hardCutsForElement` cuts a pour on `expansion` and `isolation` only, so a
   * construction joint is not a shutter boundary and the run — with its holes — goes
   * straight over it.
   */
  const field = (fromM = 0, toM = 6) => ({
    fromM,
    toM,
    holes: [1.35, 3.0, 4.65]
      .filter((alongM) => alongM >= fromM && alongM <= toM)
      .flatMap((alongM) => [
        { alongM, elevationM: 0.775 },
        { alongM, elevationM: 2.125 },
      ]),
  })
  const fieldsFor = (w: { id: string }, ...entries: ReturnType<typeof field>[]) =>
    new Map([[w.id as AnyNodeId, entries.length > 0 ? entries : [field()]]])
  /** A pour break inside one wall, carrying a bar at `along`. */
  const break_ = (
    elementId: string,
    along: number,
    treatment: Record<string, unknown> = { kind: 'waterstop', waterstopType: 'pvc-central' },
  ) =>
    ConstructionJointNode.parse({
      kind: 'construction',
      elementIds: [elementId],
      along,
      treatments: [treatment],
    })
  const found = (nodes: AnyNode[], fields: ReturnType<typeof fieldsFor>) =>
    validateFormwork(nodes, { tieFields: fields }).findings.filter(
      (f) => f.invariant === 'TIE_THROUGH_WATERSTOP',
    )

  it('fires when a drilled hole falls inside the bar', () => {
    // A 200 mm central bar at 3.00 m spans 2.90–3.10, and the middle panel column is
    // drilled at exactly 3.00. Every other check passes on this wall: the tie is
    // inside capacity, the run packs, and the waterstop run closes — the seal has a
    // rod through it and nothing else in the feature says so.
    const w = wall({ end: [6, 0], height: 3, exposureClass: 'water-retaining' })
    const joint = break_(w.id, 3.0)
    const hits = found([w, joint] as AnyNode[], fieldsFor(w))
    expect(hits.length).toBe(1)
    expect(hits[0]?.severity).toBe('error')
  })

  it('says nothing about a bar set out clear of the tie columns', () => {
    // 2.20 m: the bar spans 2.10–2.30 and the nearest holes are at 1.35 and 3.00.
    // This is the ordinary case and has to stay silent, or the check fires on every
    // water-retaining wall with a pour break in it.
    const w = wall({ end: [6, 0], height: 3, exposureClass: 'water-retaining' })
    expect(found([w, break_(w.id, 2.2)] as AnyNode[], fieldsFor(w))).toEqual([])
  })

  it('reads the bar’s own width, so a hydrophilic strip clears what PVC does not', () => {
    // A 25 mm strip at 2.96 m spans 2.9475–2.9725 and misses the hole at 3.00; a
    // 200 mm PVC bar at the same station spans 2.86–3.06 and catches it. Same joint,
    // same grid, and the treatment is the whole difference.
    const w = wall({ end: [6, 0], height: 3, exposureClass: 'water-retaining' })
    const strip = break_(w.id, 2.96, { kind: 'waterstop', waterstopType: 'hydrophilic' })
    const pvc = break_(w.id, 2.96, { kind: 'waterstop', waterstopType: 'pvc-central' })
    expect(found([w, strip] as AnyNode[], fieldsFor(w))).toEqual([])
    expect(found([w, pvc] as AnyNode[], fieldsFor(w)).length).toBe(1)
  })

  it('honours a stated width over the type’s default', () => {
    // A 500 mm bar at 2.8 m reaches 2.55–3.05 and catches the hole at 3.00, where the
    // 200 mm default spans 2.70–2.90 and clears it. A width nobody can override is a
    // check that passes the wide section somebody actually specified.
    const w = wall({ end: [6, 0], height: 3, exposureClass: 'water-retaining' })
    const wide = break_(w.id, 2.8, {
      kind: 'waterstop',
      waterstopType: 'pvc-central',
      width: 0.5,
    })
    expect(found([w, break_(w.id, 2.8)] as AnyNode[], fieldsFor(w))).toEqual([])
    expect(found([w, wide] as AnyNode[], fieldsFor(w)).length).toBe(1)
  })

  it('counts a vertical bar’s crossings once, and names how many', () => {
    // A bar at a pour break is crossed by every row of the grid. Two findings about
    // one bar reads as two problems, so the rows are counted in the message.
    const w = wall({ end: [6, 0], height: 3, exposureClass: 'water-retaining' })
    const hits = found([w, break_(w.id, 3.0)] as AnyNode[], fieldsFor(w))
    expect(hits.length).toBe(1)
    expect(hits[0]?.message).toContain('2 drilled tie holes fall')
  })

  it('catches a horizontal bar at a lift joint against the row elevations', () => {
    // A lift joint carries `elevation` rather than `along`, so the bar runs across the
    // wall and it is the hole *elevations* it has to clear. 0.775 m is a drilled row,
    // so a bar there is crossed by all three columns.
    const w = wall({ end: [6, 0], height: 3, exposureClass: 'water-retaining' })
    const lift = ConstructionJointNode.parse({
      kind: 'construction',
      elementIds: [w.id],
      elevation: 0.775,
      treatments: [{ kind: 'waterstop', waterstopType: 'pvc-central' }],
    })
    const hits = found([w, lift] as AnyNode[], fieldsFor(w))
    expect(hits.length).toBe(1)
    expect(hits[0]?.message).toContain('3 drilled tie holes fall')
    expect(hits[0]?.message).toContain('lift joint at 0.78 m')
  })

  it('names the wall and the joint, so a panel can select both', () => {
    const w = wall({ end: [6, 0], height: 3, exposureClass: 'water-retaining' })
    const joint = break_(w.id, 3.0)
    const hits = found([w, joint] as AnyNode[], fieldsFor(w))
    expect(hits[0]?.elementIds).toEqual([w.id, joint.id] as AnyNodeId[])
  })

  it('puts the locus on the bar, not on one of the holes crossing it', () => {
    // The fix is to the joint or the tie assembly, and both are about the bar. A
    // locus on a crossing would send the reader to one hole of several — so the bar
    // is offset from the hole here, or the two loci are the same number and the
    // assertion cannot tell them apart.
    const w = wall({ end: [6, 0], height: 3, exposureClass: 'water-retaining' })
    const hits = found([w, break_(w.id, 2.95)] as AnyNode[], fieldsFor(w))
    expect(hits.length).toBe(1)
    expect(hits[0]?.locus?.alongM).toBeCloseTo(2.95, 6)
  })

  it('says nothing about a joint carrying no waterstop', () => {
    const w = wall({ end: [6, 0], height: 3, exposureClass: 'water-retaining' })
    const rough = break_(w.id, 3.0, { kind: 'roughening' })
    expect(found([w, rough] as AnyNode[], fieldsFor(w))).toEqual([])
  })

  it('says nothing about an injectable hose, which is sealed by grout after the pour', () => {
    // `WATERSTOP_RUN_NOT_CLOSED` accepts a hose as the other way a joint is sealed,
    // and it has to be excluded here for the same reason it is accepted there: a hose
    // is a tube injected once the concrete has set, so a tie beside it is a tie
    // beside a tube rather than a rod through an unbroken bar.
    const w = wall({ end: [6, 0], height: 3, exposureClass: 'water-retaining' })
    const hose = break_(w.id, 3.0, { kind: 'injectable-hose' })
    expect(found([w, hose] as AnyNode[], fieldsFor(w))).toEqual([])
  })

  it('says nothing about a joint between two elements', () => {
    // The bar there sits at the plane where the two meet, and the panels stop at that
    // plane — there is no drilled hole over it. A check that treated the interface as
    // a station inside either wall would compare the grid against a bar that is not
    // in it.
    const a = wall({ start: [0, 0], end: [6, 0], height: 3, exposureClass: 'water-retaining' })
    const b = wall({ start: [6, 0], end: [12, 0], height: 3 })
    const between = ConstructionJointNode.parse({
      kind: 'construction',
      elementIds: [a.id, b.id],
      along: 3.0,
      treatments: [{ kind: 'waterstop', waterstopType: 'pvc-central' }],
    })
    expect(found([a, b, between] as AnyNode[], fieldsFor(a))).toEqual([])
  })

  it('says nothing about a conventional shutter, which is bored clear of the bar', () => {
    // No drilled grid means no fixed station a bar can be under: the carpenter bores
    // the ply where the calculation asks, and clear of the waterstop.
    const w = wall({ end: [6, 0], height: 3, exposureClass: 'water-retaining' })
    const fields = new Map([[w.id as AnyNodeId, [{ fromM: 0, toM: 6, holes: [] }]]])
    expect(found([w, break_(w.id, 3.0)] as AnyNode[], fields)).toEqual([])
  })

  it('reads each stretch on its own, so a hole in another pour is not over the bar', () => {
    // Two segments meeting at 3 m, each with its own field. The bar at 4.65 m is in
    // the second, and the first segment's holes stop at 1.35 — merged, the stations
    // would still be compared against the right axis, but a field for a stretch the
    // bar is not in must contribute nothing.
    const w = wall({ end: [6, 0], height: 3, exposureClass: 'water-retaining' })
    const hits = found([w, break_(w.id, 4.65)] as AnyNode[], fieldsFor(w, field(0, 3)))
    expect(hits).toEqual([])
  })

  it('fires on a wall that is not water-retaining, because the bar is the spec', () => {
    // Unlike `WATERSTOP_RUN_NOT_CLOSED`, which asks about a water-retaining envelope,
    // this asks about a bar somebody has actually specified. A basement wall with a
    // waterstop at a pour break leaks through a tie hole whatever its exposure class
    // says, and gating on the class would pass every joint detailed without one.
    const w = wall({ end: [6, 0], height: 3 })
    expect(found([w, break_(w.id, 3.0)] as AnyNode[], fieldsFor(w)).length).toBe(1)
  })

  it('declares itself unrun when no tie fields are passed', () => {
    const w = wall({ end: [6, 0], height: 3, exposureClass: 'water-retaining' })
    const report = validateFormwork([w, break_(w.id, 3.0)] as AnyNode[])
    expect(report.findings.some((f) => f.invariant === 'TIE_THROUGH_WATERSTOP')).toBe(false)
    expect(report.notChecked.some((entry) => entry.invariant === 'TIE_THROUGH_WATERSTOP')).toBe(
      true,
    )
  })

  it('is silent on a wall with no joints at all', () => {
    const w = wall({ end: [6, 0], height: 3, exposureClass: 'water-retaining' })
    expect(found([w] as AnyNode[], fieldsFor(w))).toEqual([])
  })
})

describe('lift joints against permitted elevations', () => {
  it('is silent when the project states none', () => {
    const w = wall({ height: 6 })
    const report = validateFormwork([w] as AnyNode[], { limits: { maxLiftHeight: 2 } })
    expect(report.findings.some((f) => f.invariant === 'LIFT_JOINT_OFF_PERMITTED_ELEVATION')).toBe(
      false,
    )
  })

  it('passes when the joints reach a permitted elevation', () => {
    const w = wall({ height: 6 })
    // The uniform split gives 2.0 and 4.0, and these are within the default
    // 0.3 m tolerance, so both joints move onto them.
    const report = validateFormwork([w] as AnyNode[], {
      limits: { maxLiftHeight: 2, permittedJointElevations: [2.1, 3.9] },
    })
    expect(report.findings.some((f) => f.invariant === 'LIFT_JOINT_OFF_PERMITTED_ELEVATION')).toBe(
      false,
    )
  })

  it('fires when the nearest permitted elevation is out of reach', () => {
    const w = wall({ height: 6 })
    // 5.5 m is more than the 0.3 m tolerance from either joint, so neither snaps
    // and both land where the structure offered nothing.
    const report = validateFormwork([w] as AnyNode[], {
      limits: { maxLiftHeight: 2, permittedJointElevations: [5.5] },
    })
    const found = report.findings.filter(
      (f) => f.invariant === 'LIFT_JOINT_OFF_PERMITTED_ELEVATION',
    )
    expect(found.length).toBe(2)
    expect(found[0]?.message).toContain('5.50')
  })

  it('warns rather than errors — an off-elevation joint is still buildable', () => {
    const w = wall({ height: 6 })
    const report = validateFormwork([w] as AnyNode[], {
      limits: { maxLiftHeight: 2, permittedJointElevations: [5.5] },
    })
    const finding = report.findings.find(
      (f) => f.invariant === 'LIFT_JOINT_OFF_PERMITTED_ELEVATION',
    )
    expect(finding?.severity).toBe('warning')
  })
})

describe('pour volume against supply', () => {
  it('does not fire on a wall — the plan split cuts it to fit', () => {
    const w = wall({ start: [0, 0], end: [40, 0], height: 3, thickness: 0.3 })
    const report = validateFormwork([w] as AnyNode[], { limits: { maxPourVolume: 10 } })
    expect(report.findings.some((f) => f.invariant === 'POUR_VOLUME_OVER_SUPPLY')).toBe(false)
  })

  it('fires on a slab, which this solver returns as one pour', () => {
    const slab = SlabNode.parse({
      polygon: [
        [0, 0],
        [30, 0],
        [30, 20],
        [0, 20],
      ],
      thickness: 0.4,
      formworkType: 'plywood',
    })
    const report = validateFormwork([slab] as AnyNode[], { limits: { maxPourVolume: 60 } })
    const finding = report.findings.find((f) => f.invariant === 'POUR_VOLUME_OVER_SUPPLY')
    expect(finding?.severity).toBe('error')
    // 30 × 20 × 0.4 = 240 m³, and the message has to carry the figure.
    expect(finding?.message).toContain('240.0')
  })

  it('passes the same slab under a limit it fits', () => {
    const slab = SlabNode.parse({
      polygon: [
        [0, 0],
        [30, 0],
        [30, 20],
        [0, 20],
      ],
      thickness: 0.4,
      formworkType: 'plywood',
    })
    const report = validateFormwork([slab] as AnyNode[], { limits: { maxPourVolume: 300 } })
    expect(report.findings.some((f) => f.invariant === 'POUR_VOLUME_OVER_SUPPLY')).toBe(false)
  })

  it('honours a tighter per-element cap over the project one', () => {
    const slab = SlabNode.parse({
      polygon: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      thickness: 0.3,
      formworkType: 'plywood',
      maxPourVolume: 10,
    })
    const report = validateFormwork([slab] as AnyNode[], { limits: { maxPourVolume: 500 } })
    expect(report.findings.some((f) => f.invariant === 'POUR_VOLUME_OVER_SUPPLY')).toBe(true)
  })
})

describe('tie reach and corner fit', () => {
  const system = formworkSystem('doka-framax-xlife')
  if (!system) throw new Error('the Framax catalog is missing')
  const trio = formworkSystem('peri-trio')
  if (!trio) throw new Error('the TRIO catalog is missing')
  const formedIn = (...nodes: Array<{ id: string }>) =>
    new Map(nodes.map((node) => [node.id as AnyNodeId, system]))

  it('accepts an ordinary 200 mm wall', () => {
    const w = wall({ thickness: 0.2 })
    const report = validateFormwork([w] as AnyNode[], { systems: formedIn(w) })
    expect(report.findings.some((f) => f.invariant === 'WALL_OUTSIDE_TIE_RANGE')).toBe(false)
  })

  it('warns on one past every stated range — cut rod, not a system tie', () => {
    // Framax publishes a 150–350 mm assembly and a DW 15 through-rod with no
    // range at all, because rod is cut to length. So a 2.5 m wall is tieable, and
    // what changes is the item and the labour rather than whether it stands up.
    const w = wall({ thickness: 2.5 })
    const report = validateFormwork([w] as AnyNode[], { systems: formedIn(w) })
    const finding = report.findings.find((f) => f.invariant === 'WALL_OUTSIDE_TIE_RANGE')
    expect(finding?.severity).toBe('warning')
    expect(finding?.message).toContain('2500')
    expect(finding?.message).toContain('150–350')
  })

  it('says nothing about a single-sided wall, which is not tied through', () => {
    const w = wall({ thickness: 2.5, formworkMode: 'single-sided-a', againstEarthSide: 'b' })
    const report = validateFormwork([w] as AnyNode[], { systems: formedIn(w) })
    expect(report.findings.some((f) => f.invariant === 'WALL_OUTSIDE_TIE_RANGE')).toBe(false)
  })

  it('checks each wall against its own system, not the first one it saw', () => {
    // The whole reason `systems` is a map. Both walls are 2.5 m thick, and only the
    // one carrying a system is checked — a scope-wide system would have faulted the
    // unformed wall against a catalog that is not on it.
    const framax = wall({ start: [0, 0], end: [5, 0], thickness: 2.5 })
    const unformed = wall({ start: [0, 9], end: [5, 9], thickness: 2.5 })
    const report = validateFormwork([framax, unformed] as AnyNode[], {
      systems: new Map([[framax.id as AnyNodeId, system]]),
    })
    const faulted = report.findings
      .filter((f) => f.invariant === 'WALL_OUTSIDE_TIE_RANGE')
      .flatMap((f) => f.elementIds)
    expect(faulted).toEqual([framax.id as AnyNodeId])
  })

  it('accepts a right-angle corner, which every system turns', () => {
    const a = wall({ start: [0, 0], end: [5, 0], castOrder: 1, pourId: 'P1' })
    const b = wall({ start: [5, 0], end: [5, 5], castOrder: 1, pourId: 'P1' })
    const report = validateFormwork([a, b] as AnyNode[], { systems: formedIn(a, b) })
    expect(report.findings.some((f) => f.invariant === 'JUNCTION_ANGLE_UNFITTABLE')).toBe(false)
  })

  it('accepts a shallow skew, which the hinged unit still sweeps', () => {
    // 127° is inside Framax's 60–180° hinged inside corner, so this is a catalog
    // item and not a finding.
    const a = wall({ start: [0, 0], end: [5, 0], castOrder: 1, pourId: 'P1' })
    const b = wall({ start: [5, 0], end: [8, 4], castOrder: 1, pourId: 'P1' })
    const report = validateFormwork([a, b] as AnyNode[], { systems: formedIn(a, b) })
    expect(report.findings.some((f) => f.invariant === 'JUNCTION_ANGLE_UNFITTABLE')).toBe(false)
  })

  it('flags an acute corner as a carpenter’s item, not a catalog one', () => {
    // 45° is past the 60° the hinged unit closes to, so no unit in the system
    // turns it and the corner is site-built timber.
    const a = wall({ start: [0, 0], end: [5, 0], castOrder: 1, pourId: 'P1' })
    const b = wall({ start: [5, 0], end: [2, 3], castOrder: 1, pourId: 'P1' })
    const report = validateFormwork([a, b] as AnyNode[], { systems: formedIn(a, b) })
    const finding = report.findings.find((f) => f.invariant === 'JUNCTION_ANGLE_UNFITTABLE')
    expect(finding?.severity).toBe('warning')
    expect(finding?.elementIds.length).toBe(2)
    expect(finding?.message).toContain('45')
  })

  it('names both catalogs where the two walls are formed in different systems', () => {
    // A corner unit spans both walls, so it may come from either yard's stock. The
    // fault is only real when neither turns it, and the message has to say which
    // two were tried or the reader cannot check the claim.
    const a = wall({ start: [0, 0], end: [5, 0], castOrder: 1, pourId: 'P1' })
    const b = wall({ start: [5, 0], end: [2, 3], castOrder: 1, pourId: 'P1' })
    const report = validateFormwork([a, b] as AnyNode[], {
      systems: new Map([
        [a.id as AnyNodeId, system],
        [b.id as AnyNodeId, trio],
      ]),
    })
    const finding = report.findings.find((f) => f.invariant === 'JUNCTION_ANGLE_UNFITTABLE')
    expect(finding?.message).toContain(system.label)
    expect(finding?.message).toContain(trio.label)
  })

  it('skips both checks when no system is passed, and says so', () => {
    const w = wall({ thickness: 2.5 })
    const report = validateFormwork([w] as AnyNode[])
    expect(report.findings.some((f) => f.invariant === 'WALL_OUTSIDE_TIE_RANGE')).toBe(false)
    expect(report.notChecked.some((entry) => entry.invariant === 'WALL_OUTSIDE_TIE_RANGE')).toBe(
      true,
    )
  })
})

describe('layout findings', () => {
  const system = formworkSystem('doka-framax-xlife')
  if (!system) throw new Error('the Framax catalog is missing')

  it('reports an unformable strip as an error', () => {
    const w = wall()
    // A run shorter than the narrowest thing anybody can make leaves the whole
    // width open, which is what `packStrip` records rather than hides.
    const pack = packStrip(system, 40, { heightMm: 2700 })
    expect(pack.unfilledMm).toBeGreaterThan(0)
    const report = validateFormwork([w] as AnyNode[], {
      packs: new Map([[w.id as AnyNodeId, [pack]]]),
    })
    const finding = report.findings.find((f) => f.invariant === 'UNFORMABLE_STRIP')
    expect(finding?.severity).toBe('error')
    expect(finding?.elementIds).toEqual([w.id as AnyNodeId])
  })

  it('says nothing about a run that packs cleanly', () => {
    const w = wall()
    const pack = packStrip(system, 2700, { heightMm: 2700 })
    expect(pack.unfilledMm).toBe(0)
    const report = validateFormwork([w] as AnyNode[], {
      packs: new Map([[w.id as AnyNodeId, [pack]]]),
    })
    expect(report.findings.some((f) => f.invariant === 'UNFORMABLE_STRIP')).toBe(false)
  })

  it('declares the layout checks unrun when no packs are passed', () => {
    const w = wall()
    const report = validateFormwork([w] as AnyNode[])
    expect(report.notChecked.some((entry) => entry.invariant === 'UNFORMABLE_STRIP')).toBe(true)
  })
})

describe('code envelope', () => {
  it('reports a pressure warning against the element it came from', () => {
    const w = wall()
    // 12 m/h is past DIN's 7 m/h ceiling, so the envelope carries a warning.
    const envelope = pressureEnvelope('din-18218', DEFAULT_FORMWORK_SETTINGS.concrete, {
      ...DEFAULT_FORMWORK_SETTINGS.placement,
      riseRateMH: 12,
      concreteTemperatureC: 20,
      pourHeightM: 3,
      elementKind: 'wall',
    })
    expect(envelope.warnings.length).toBeGreaterThan(0)
    const report = validateFormwork([w] as AnyNode[], {
      envelopes: new Map([[w.id as AnyNodeId, envelope]]),
    })
    const finding = report.findings.find((f) => f.invariant === 'DESIGN_OUTSIDE_CODE_ENVELOPE')
    expect(finding?.severity).toBe('warning')
    expect(finding?.elementIds).toEqual([w.id as AnyNodeId])
  })

  it('declares itself unrun when no envelopes are passed', () => {
    const w = wall()
    const report = validateFormwork([w] as AnyNode[])
    expect(
      report.notChecked.some((entry) => entry.invariant === 'DESIGN_OUTSIDE_CODE_ENVELOPE'),
    ).toBe(true)
  })
})

describe('ties around openings', () => {
  /**
   * A 6 m Framax face over a 3 m lift, which is what the catalog actually produces:
   * 2700 + 600 + 2700 panels, drilled at 1.35, 3.00 and 4.65 m along and at 0.775
   * and 2.125 m up. Those are the only places a rod passes, so a band of concrete
   * that contains none of them is a band with no tie in it — and the numbers are the
   * layout's rather than the test's, so a catalog change is a test failure rather
   * than a check that quietly stops describing the wall.
   */
  const field = (fromM = 0, toM = 6) => ({
    fromM,
    toM,
    holes: [1.35, 3.0, 4.65]
      .filter((alongM) => alongM >= fromM && alongM <= toM)
      .flatMap((alongM) => [
        { alongM, elevationM: 0.775 },
        { alongM, elevationM: 2.125 },
      ]),
  })
  const fieldsFor = (w: { id: string }, ...entries: ReturnType<typeof field>[]) =>
    new Map([[w.id as AnyNodeId, entries.length > 0 ? entries : [field()]]])
  const opening = (wallId: string, along: number, width: number, centreY = 1.5, height = 2.4) =>
    WindowNode.parse({ wallId, parentId: wallId, position: [along, centreY, 0], width, height })

  it('fires on a pier between an opening and the wall end with no hole in it', () => {
    // A window from 0.8 to 5.6 m leaves 800 mm at the start and 400 mm at the end.
    // Every drilled station is inside the void, so both bands are untied — and the
    // wall builder already drops those ties, silently, which is why nothing else
    // reports this.
    const w = wall({ end: [6, 0], height: 3 })
    const window = opening(w.id, 3.2, 4.8)
    const report = validateFormwork([w, window] as AnyNode[], { tieFields: fieldsFor(w) })
    const found = report.findings.filter((f) => f.invariant === 'OPENING_LEAVES_TIE_GAP')
    expect(found.length).toBe(2)
    expect(found[0]?.severity).toBe('warning')
  })

  it('names the wall and the opening, and the width somebody has to strut', () => {
    const w = wall({ end: [6, 0], height: 3 })
    const window = opening(w.id, 3.2, 4.8)
    const finding = validateFormwork([w, window] as AnyNode[], {
      tieFields: fieldsFor(w),
    }).findings.find((f) => f.invariant === 'OPENING_LEAVES_TIE_GAP')
    expect(finding?.elementIds).toEqual([w.id, window.id] as AnyNodeId[])
    expect(finding?.message).toContain('800 mm')
    expect(finding?.message).toContain('strut')
  })

  it('says nothing about a band a drilled hole falls in', () => {
    // A 1.2 m window centred at 3 m leaves 2.4 m either side, and 1.35 and 4.65 are
    // both in concrete. This is the ordinary case, and it has to stay silent or the
    // check fires on every wall with a window in it.
    const w = wall({ end: [6, 0], height: 3 })
    const window = opening(w.id, 3.0, 1.2)
    const report = validateFormwork([w, window] as AnyNode[], { tieFields: fieldsFor(w) })
    expect(report.findings.some((f) => f.invariant === 'OPENING_LEAVES_TIE_GAP')).toBe(false)
  })

  it('leaves a nib too narrow to tie to the carpenter, not to the report', () => {
    // A window from 0.2 to 5.8 m leaves 200 mm at each end, and a nib that narrow is
    // strutted form to form. Reporting it would put a finding on every wall whose
    // opening lands near its end.
    const w = wall({ end: [6, 0], height: 3 })
    const window = opening(w.id, 3.0, 5.6)
    const report = validateFormwork([w, window] as AnyNode[], { tieFields: fieldsFor(w) })
    expect(report.findings.some((f) => f.invariant === 'OPENING_LEAVES_TIE_GAP')).toBe(false)
  })

  it('cuts only the rows the opening crosses, not every row', () => {
    // A 1 m window centred at 0.6 m spans 0.1–1.1 m. It cuts the row at 0.775 m and
    // leaves the one at 2.125 m whole, so the pier beside it is short of one tie
    // rather than of both — and a check that cut every row would say two.
    const w = wall({ end: [6, 0], height: 3 })
    const window = opening(w.id, 3.0, 4.8, 0.6, 1.0)
    const finding = validateFormwork([w, window] as AnyNode[], {
      tieFields: fieldsFor(w),
    }).findings.find((f) => f.invariant === 'OPENING_LEAVES_TIE_GAP')
    expect(finding?.message).toContain('the row at 0.78 m')
    expect(finding?.message).not.toContain('tie rows')
  })

  it('reports one band once, however many rows it fails on', () => {
    // A full-height opening fails the pier beside it at every course. Four findings
    // about one 800 mm band reads as four problems.
    const w = wall({ end: [6, 0], height: 3 })
    const window = opening(w.id, 3.2, 4.8)
    const found = validateFormwork([w, window] as AnyNode[], {
      tieFields: fieldsFor(w),
    }).findings.filter((f) => f.invariant === 'OPENING_LEAVES_TIE_GAP')
    const bands = found.map((f) => f.locus?.alongM)
    expect(new Set(bands).size).toBe(bands.length)
    expect(found.some((f) => f.message.includes('2 tie rows'))).toBe(true)
  })

  it('puts the locus at the lowest failing row, where the pressure is worst', () => {
    const w = wall({ end: [6, 0], height: 3 })
    const window = opening(w.id, 3.2, 4.8)
    const finding = validateFormwork([w, window] as AnyNode[], {
      tieFields: fieldsFor(w),
    }).findings.find((f) => f.invariant === 'OPENING_LEAVES_TIE_GAP')
    expect(finding?.locus?.elevationM).toBeCloseTo(0.775, 6)
  })

  it('is silent on a band bounded only by the shutter’s own ends', () => {
    // That is `tieGrid`'s `untied-stretch`, and it is a different fault with a
    // different fix. Reported here too it would be one problem in two lists.
    const w = wall({ end: [6, 0], height: 3 })
    const report = validateFormwork([w] as AnyNode[], {
      tieFields: new Map([[w.id as AnyNodeId, [{ fromM: 0, toM: 6, holes: [] }]]]),
    })
    expect(report.findings.some((f) => f.invariant === 'OPENING_LEAVES_TIE_GAP')).toBe(false)
  })

  it('says nothing about a conventional shutter, which is bored to suit', () => {
    // No drilled grid means no fixed stations to fall between: the carpenter bores
    // the ply beside the opening, so the band is tied by asking for it.
    const w = wall({ end: [6, 0], height: 3 })
    const window = opening(w.id, 3.2, 4.8)
    const report = validateFormwork([w, window] as AnyNode[], {
      tieFields: new Map([[w.id as AnyNodeId, [{ fromM: 0, toM: 6, holes: [] }]]]),
    })
    expect(report.findings.some((f) => f.invariant === 'OPENING_LEAVES_TIE_GAP')).toBe(false)
  })

  it('reads each stretch on its own, not the element merged', () => {
    // Two pour segments meeting at 3 m. The 800 mm at 0–0.8 m is untied in the first
    // segment's field and the second segment's holes are nowhere near it — merged,
    // 3.00 would be read as tying a band it is not over.
    const w = wall({ end: [6, 0], height: 3 })
    const window = opening(w.id, 1.9, 2.2)
    const report = validateFormwork([w, window] as AnyNode[], {
      tieFields: fieldsFor(w, field(0, 3), field(3, 6)),
    })
    const found = report.findings.filter((f) => f.invariant === 'OPENING_LEAVES_TIE_GAP')
    expect(found.length).toBe(1)
    expect(found[0]?.message).toContain('0.00 to 0.80 m')
  })

  it('declares itself unrun when no tie fields are passed', () => {
    const w = wall({ end: [6, 0], height: 3 })
    const report = validateFormwork([w, opening(w.id, 3.2, 4.8)] as AnyNode[])
    expect(report.findings.some((f) => f.invariant === 'OPENING_LEAVES_TIE_GAP')).toBe(false)
    expect(report.notChecked.some((entry) => entry.invariant === 'OPENING_LEAVES_TIE_GAP')).toBe(
      true,
    )
  })

  it('is silent on a wall with no openings at all', () => {
    const w = wall({ end: [6, 0], height: 3 })
    const report = validateFormwork([w] as AnyNode[], { tieFields: fieldsFor(w) })
    expect(report.findings.some((f) => f.invariant === 'OPENING_LEAVES_TIE_GAP')).toBe(false)
  })
})

describe('corner units against each other, and against openings', () => {
  const system = formworkSystem('doka-framax-xlife')
  if (!system) throw new Error('the Framax catalog is missing')

  /**
   * A U — a link wall with a return at each end, all one pour, so every corner is
   * formed out of corner units rather than closed with a bulkhead.
   *
   * Framax turns a right angle on a 300 mm inside leg and wraps the 200 mm core on
   * a 500 mm outside one, so whatever the link's length its face `a` carries 600 mm
   * of corner unit and its face `b` carries 1000 mm. Both figures are the catalog's,
   * so a catalog change is a test failure rather than a check that quietly stops
   * describing the wall.
   */
  const u = (linkM: number) => {
    const link = wall({ start: [0, 0], end: [linkM, 0], castOrder: 1, pourId: 'P1' })
    const left = wall({ start: [0, 0], end: [0, 3], castOrder: 1, pourId: 'P1' })
    const right = wall({ start: [linkM, 0], end: [linkM, 3], castOrder: 1, pourId: 'P1' })
    return { link, left, right, nodes: [link, left, right] as AnyNode[] }
  }
  const inSystem = (nodes: AnyNode[]) =>
    new Map(nodes.map((node) => [(node as { id: string }).id as AnyNodeId, system]))
  const overlaps = (nodes: AnyNode[], link: { id: string }) =>
    validateFormwork(nodes, { systems: inSystem(nodes) }).findings.filter(
      (f) => f.invariant === 'CORNER_UNITS_OVERLAP' && f.elementIds[0] === (link.id as AnyNodeId),
    )

  it('says nothing about a link wall with room for both units', () => {
    // 1.4 m leaves 400 mm of panel run between the outside legs and 800 mm between
    // the inside ones. This is the ordinary case and has to stay silent, or the
    // check fires on every wall between two returns.
    const { link, nodes } = u(1.4)
    expect(overlaps(nodes, link)).toEqual([])
  })

  it('fires when the two units reach into the same stretch of one face', () => {
    // 700 mm: the inside legs run 0.1–0.4 and 0.3–0.6, so 100 mm of concrete is
    // claimed twice. Nothing downstream notices — `panelRuns` subtracts each
    // blocked stretch in turn, so an overlap just leaves less run, and the takeoff
    // stays self-consistent while listing two units for a wall with room for one.
    const { link, nodes } = u(0.7)
    const face = overlaps(nodes, link).find((f) => f.message.includes('face a'))
    expect(face?.severity).toBe('warning')
    expect(face?.message).toContain('100 mm')
    expect(face?.message).toContain('notch one back')
    expect(face?.locus?.alongM).toBeCloseTo(0.35, 5)
  })

  it('reports each face separately, because the outside leg is the longer one', () => {
    // The same 700 mm wall is two different problems on its two skins: face `a`
    // needs 600 mm and has 700, so its units can be notched back; face `b` needs
    // 1000 and there is no run left between them at all. One finding averaged over
    // both faces would name a stretch that is on neither.
    const { link, nodes } = u(0.7)
    const found = overlaps(nodes, link)
    expect(found.length).toBe(2)
    expect(found.map((f) => f.severity).sort()).toEqual(['error', 'warning'])
    const outside = found.find((f) => f.severity === 'error')
    expect(outside?.message).toContain('face b')
    expect(outside?.message).toContain('1000 mm')
    expect(outside?.message).toContain('one bespoke box')
  })

  it('escalates to an error once the legs want more face than there is', () => {
    // 500 mm, and the inside legs alone need 600. There is no stretch between them
    // to notch back to, so this is not a unit to trim — the return is too short to
    // form out of corner units at all.
    const { link, nodes } = u(0.5)
    const found = overlaps(nodes, link)
    expect(found.length).toBe(2)
    expect(found.every((f) => f.severity === 'error')).toBe(true)
    expect(found[0]?.message).toContain('500 mm long')
  })

  it('names the walls whose units these are, not just the wall between them', () => {
    // The decision is about hardware spanning three walls, and a finding naming only
    // the link sends the reader to a wall whose own geometry is unremarkable.
    const { link, left, right, nodes } = u(0.6)
    const found = overlaps(nodes, link)
    expect(found[0]?.elementIds).toEqual([link.id, left.id, right.id] as AnyNodeId[])
  })

  it('accepts two legs that meet exactly, which is a fit and not a clash', () => {
    // 800 mm: the face `a` legs run 0.1–0.4 and 0.4–0.7 and share a line, which is the
    // intended geometry on a return exactly twice the leg length.
    const { link, nodes } = u(0.8)
    expect(overlaps(nodes, link).some((f) => f.message.includes('face a'))).toBe(false)
  })

  it('does not fault a millimetre, which is one joint on site', () => {
    // 799 mm, so the face `a` legs cross by 1 mm. Two panel edges that close are one
    // joint whichever side of the line the drawing put them, and a check without a
    // tolerance reports every wall dimensioned a millimetre off a round number.
    const { link, nodes } = u(0.799)
    expect(overlaps(nodes, link).some((f) => f.message.includes('face a'))).toBe(false)
  })

  it('says nothing where the returns are cast later and the ends get stop-ends', () => {
    // The same 500 mm link, sequenced instead of monolithic. Its ends are free when it
    // is poured, so they are closed with bulkheads and there is no corner unit at
    // either — checking the legs a monolithic pour would have had reports hardware
    // nobody sets.
    const { link, left, right } = u(0.5)
    const nodes = [
      link,
      wall({ ...left, castOrder: 2, pourId: 'P2' }),
      wall({ ...right, castOrder: 3, pourId: 'P3' }),
    ] as AnyNode[]
    expect(overlaps(nodes, link)).toEqual([])
  })

  it('says nothing about an L, where each face carries one unit', () => {
    const a = wall({ start: [0, 0], end: [5, 0], castOrder: 1, pourId: 'P1' })
    const b = wall({ start: [0, 0], end: [0, 5], castOrder: 1, pourId: 'P1' })
    const nodes = [a, b] as AnyNode[]
    expect(fired(nodes, 'CORNER_UNITS_OVERLAP')).toBe(false)
    expect(
      validateFormwork(nodes, { systems: inSystem(nodes) }).findings.some(
        (f) => f.invariant === 'CORNER_UNITS_OVERLAP',
      ),
    ).toBe(false)
  })

  it('checks the same short return with no system named at all', () => {
    // Which is why neither check appears in `notChecked`. Both shipped catalogs turn
    // a right angle on the same 300 mm leg, so the fallback is the figure they agree
    // on rather than a guess, and a scene that has never opened the formwork settings
    // is told its 500 mm return is unformable just the same.
    const { link, nodes } = u(0.5)
    const found = validateFormwork(nodes).findings.filter(
      (f) => f.invariant === 'CORNER_UNITS_OVERLAP' && f.elementIds[0] === (link.id as AnyNodeId),
    )
    expect(found.length).toBe(2)
    expect(found.every((f) => f.severity === 'error')).toBe(true)
    const report = validateFormwork(nodes)
    expect(report.notChecked.some((entry) => entry.invariant === 'CORNER_UNITS_OVERLAP')).toBe(
      false,
    )
    expect(
      report.notChecked.some((entry) => entry.invariant === 'OPENING_INSIDE_CORNER_UNIT'),
    ).toBe(false)
  })

  it('fires when an opening jamb lands inside a corner unit', () => {
    // A 600 mm window centred at 600 mm has its near jamb at 300 mm, and the unit at
    // that end of the wall runs to 400. There is no panel joint there to move: the
    // box-out has to be cut into a framed unit.
    const { link, nodes } = u(3)
    const window = WindowNode.parse({
      wallId: link.id,
      parentId: link.id,
      position: [0.6, 1.5, 0],
      width: 0.6,
      height: 1.2,
    })
    const found = validateFormwork([...nodes, window] as AnyNode[], {
      systems: inSystem(nodes),
    }).findings.filter((f) => f.invariant === 'OPENING_INSIDE_CORNER_UNIT')
    expect(found.length).toBe(2)
    expect(found[0]?.severity).toBe('warning')
    expect(found[0]?.elementIds).toEqual([link.id, window.id] as AnyNodeId[])
    expect(found[0]?.message).toContain('cut into the unit')
    expect(found.map((f) => f.locus?.alongM)).toEqual([0.6, 0.6])
  })

  it('reports the face whose unit the jamb is actually in', () => {
    // The outside leg reaches 100 mm past the junction centreline and the inside one
    // starts 100 mm short of it, so a jamb at 50 mm is inside the outer unit and clear
    // of the inner. Reporting both would claim hardware to modify that is not there.
    const { link, nodes } = u(3)
    const window = WindowNode.parse({
      wallId: link.id,
      parentId: link.id,
      position: [0.35, 1.5, 0],
      width: 0.6,
      height: 1.2,
    })
    const found = validateFormwork([...nodes, window] as AnyNode[], {
      systems: inSystem(nodes),
    }).findings.filter((f) => f.invariant === 'OPENING_INSIDE_CORNER_UNIT')
    expect(found.length).toBe(1)
    expect(found[0]?.message).toContain('face b')
  })

  it('leaves an opening merely near a corner alone', () => {
    // Jambs at 450 and 1050 mm, against units ending at 400. An opening 50 mm off a
    // corner unit is the ordinary case — it forms with a filler — and a check using a
    // comfort distance instead of the overlap would fault walls the crew forms daily.
    const { link, nodes } = u(3)
    const window = WindowNode.parse({
      wallId: link.id,
      parentId: link.id,
      position: [0.75, 1.5, 0],
      width: 0.6,
      height: 1.2,
    })
    const report = validateFormwork([...nodes, window] as AnyNode[], { systems: inSystem(nodes) })
    expect(report.findings.some((f) => f.invariant === 'OPENING_INSIDE_CORNER_UNIT')).toBe(false)
  })

  it('leaves an opening in the middle of the wall alone', () => {
    const { link, nodes } = u(3)
    const window = WindowNode.parse({
      wallId: link.id,
      parentId: link.id,
      position: [1.5, 1.5, 0],
      width: 0.6,
      height: 1.2,
    })
    const report = validateFormwork([...nodes, window] as AnyNode[], { systems: inSystem(nodes) })
    expect(report.findings.some((f) => f.invariant === 'OPENING_INSIDE_CORNER_UNIT')).toBe(false)
  })
})

describe('set count shortage', () => {
  /**
   * The check's input, built by hand rather than from a real solve.
   *
   * `formworkAcquisition` is tested against real programmes in `acquire.test.ts`; what is
   * left to get wrong here is the join — which elements a shortfall names, and whether a
   * scope that excludes them still reports it against something.
   */
  const acquisition = (
    over: Partial<AcquireLine> & { peakPourIds: string[] },
  ): FormworkAcquisition => {
    const line: AcquireLine = {
      catalogId: 'PANEL_1200',
      kind: 'panel',
      description: '1200 mm panel',
      peakQuantity: 180,
      peakOn: '2026-03-02',
      ownedQuantity: 100,
      shortfall: 80,
      surplus: 0,
      reuseFactor: 2,
      committedDays: 30,
      utilisation: 0.5,
      gaps: [],
      ...over,
    }
    return {
      lines: [line],
      shortfalls: line.shortfall > 0 ? [line] : [],
      surpluses: line.surplus > 0 ? [line] : [],
      shortfallQuantity: line.shortfall,
      hireCost: 0,
      purchaseCost: 0,
      complete: true,
      gaps: [],
    }
  }

  it('is not checked at all until a count and a rack both exist', () => {
    // Three different silences reach this — no dates, no rack, or a programme too partial
    // to sweep — and a scene with any of them must not read as adequately stocked.
    const report = validateFormwork([wall()] as AnyNode[])
    const entry = report.notChecked.find((e) => e.invariant === 'SET_COUNT_SHORTAGE')
    expect(entry?.needs).toContain('ownedStock')
  })

  it('names the overlapping pours’ elements, and stops declaring itself unavailable', () => {
    const a = wall({ start: [0, 0], end: [5, 0] })
    const b = wall({ start: [0, 10], end: [5, 10] })
    const report = validateFormwork([a, b] as AnyNode[], {
      acquisition: acquisition({ peakPourIds: ['pour-a', 'pour-b'] }),
      elementIdByPourId: new Map([
        ['pour-a', a.id as AnyNodeId],
        ['pour-b', b.id as AnyNodeId],
      ]),
    })

    const found = report.findings.find((f) => f.invariant === 'SET_COUNT_SHORTAGE')
    expect(found?.elementIds).toEqual([a.id, b.id].sort())
    // A purchase order rather than an unbuildable shutter: the forms stand up fine.
    expect(found?.severity).toBe('warning')
    expect(found?.message).toContain('80 more have to be on site')
    // Both remedies, because acquiring is not the only one.
    expect(found?.message).toContain('moving one of those pours')
    expect(report.notChecked.some((e) => e.invariant === 'SET_COUNT_SHORTAGE')).toBe(false)
  })

  it('says nothing where the rack covers the peak', () => {
    const a = wall()
    const report = validateFormwork([a] as AnyNode[], {
      acquisition: acquisition({ peakPourIds: ['pour-a'], ownedQuantity: 200, shortfall: 0 }),
      elementIdByPourId: new Map([['pour-a', a.id as AnyNodeId]]),
    })
    expect(report.findings.some((f) => f.invariant === 'SET_COUNT_SHORTAGE')).toBe(false)
    // Checked and clean, so it is not unavailable either.
    expect(report.notChecked.some((e) => e.invariant === 'SET_COUNT_SHORTAGE')).toBe(false)
  })

  it('drops a shortage whose pours are all outside the scope rather than re-pointing it', () => {
    // The peak is a fact about the whole programme and a scope is a subset of it. Pinning
    // the finding on an element that is not in the overlap sends the reader to the wrong wall.
    const inScope = wall({ start: [0, 0], end: [5, 0] })
    const elsewhere = wall({ start: [0, 10], end: [5, 10] })
    const report = validateFormwork([inScope, elsewhere] as AnyNode[], {
      elementIds: [inScope.id as AnyNodeId],
      acquisition: acquisition({ peakPourIds: ['pour-b'] }),
      elementIdByPourId: new Map([['pour-b', elsewhere.id as AnyNodeId]]),
    })
    expect(report.findings.some((f) => f.invariant === 'SET_COUNT_SHORTAGE')).toBe(false)
  })

  it('reports a shortage in the summary alongside the geometric warnings', () => {
    const a = wall()
    const summary = validationSummary(
      validateFormwork([a] as AnyNode[], {
        acquisition: acquisition({ peakPourIds: ['pour-a'] }),
        elementIdByPourId: new Map([['pour-a', a.id as AnyNodeId]]),
      }),
    )
    expect(summary.some((entry) => entry.includes('80 more have to be on site'))).toBe(true)
  })
})

describe('a gang against the crane', () => {
  /**
   * The inputs, both real. `gangs.test.ts` owns the grouping and `crane.test.ts` the chart,
   * so nothing here re-derives either — what is left to get wrong is the *verdict*: which
   * figure on the chart a pick is compared against, and whether a gang nothing can weigh
   * comes back as passed.
   */
  const faceOf = (runMm: number, liftHeightMm = 2700, capKg?: number): FaceGangs =>
    gangFace(
      layOutFace(DOKA_FRAMAX_XLIFE, { runMm, liftHeightMm }).courses,
      capKg === undefined ? {} : { maxPickWeightKg: capKg },
    )

  /** A 40 m jib rated 8 t at the mast and 2.2 t at the tip. */
  const CURVE = [
    { radiusM: 14, capacityKg: 8000 },
    { radiusM: 20, capacityKg: 5600 },
    { radiusM: 30, capacityKg: 3400 },
    { radiusM: 40, capacityKg: 2200 },
  ]

  it('is not checked at all until both the gangs and a chart exist', () => {
    // Two separate silences, and unlike the shortage's three they can be told apart — so
    // the report names the one that is actually missing rather than listing both inputs.
    const noCrane = validateFormwork([wall()] as AnyNode[], {
      gangs: new Map([['wall_x' as AnyNodeId, [faceOf(2700)]]]),
    })
    expect(
      noCrane.notChecked.find((e) => e.invariant === 'GANG_WEIGHT_OVER_CRANE_CAPACITY')?.needs,
    ).toContain('capacityCurve')

    const noGangs = validateFormwork([wall()] as AnyNode[], { crane: { capacityCurve: CURVE } })
    expect(
      noGangs.notChecked.find((e) => e.invariant === 'GANG_WEIGHT_OVER_CRANE_CAPACITY')?.needs,
    ).toContain('pass `gangs`')
  })

  it('a recorded crane with an empty chart is no crane', () => {
    // The group can exist with every field absent — somebody recorded a hook height and
    // nothing else. Reading its presence as the input would report a scope as checked
    // against a machine with no capacity anywhere on it.
    const w = wall()
    const report = validateFormwork([w] as AnyNode[], {
      crane: { hookHeightM: 40 },
      gangs: new Map([[w.id as AnyNodeId, [faceOf(2700)]]]),
    })
    expect(report.notChecked.some((e) => e.invariant === 'GANG_WEIGHT_OVER_CRANE_CAPACITY')).toBe(
      true,
    )
    expect(report.findings.some((f) => f.invariant === 'GANG_WEIGHT_OVER_CRANE_CAPACITY')).toBe(
      false,
    )
  })

  it('says nothing about a pick the whole chart takes', () => {
    // A single 2.7 m Framax panel is a 416 kg pick and the tip of this jib takes 2.2 t.
    const w = wall()
    const report = validateFormwork([w] as AnyNode[], {
      crane: { capacityCurve: CURVE },
      gangs: new Map([[w.id as AnyNodeId, [faceOf(2700)]]]),
    })
    expect(report.findings.some((f) => f.invariant === 'GANG_WEIGHT_OVER_CRANE_CAPACITY')).toBe(
      false,
    )
    expect(report.notChecked.some((e) => e.invariant === 'GANG_WEIGHT_OVER_CRANE_CAPACITY')).toBe(
      false,
    )
  })

  it('warns about a pick the tip will not take but the mast will, and names the radius', () => {
    // 8.1 m × 5.4 m as one gang is 2496 kg: over the 2200 kg at 40 m, inside the 3400 kg
    // at 30. That is a position to set it from rather than a face to re-lay, which is why
    // it is a warning and why the radius is in the message.
    const w = wall()
    const report = validateFormwork([w] as AnyNode[], {
      crane: { capacityCurve: CURVE },
      gangs: new Map([[w.id as AnyNodeId, [faceOf(8100, 5400)]]]),
    })

    const found = report.findings.find((f) => f.invariant === 'GANG_WEIGHT_OVER_CRANE_CAPACITY')
    expect(found?.severity).toBe('warning')
    expect(found?.message).toContain('2496 kg')
    expect(found?.message).toContain('set inside 30 m')
    // The published row inside the crossing, not the interpolated crossing itself: the
    // line between two rows sits above the sagging curve, so the crossing is optimistic.
    // Matched with the unit on it — a bare "33" also appears in a generated element id.
    expect(found?.message).not.toContain('33 m')
    expect(found?.elementIds).toEqual([w.id as AnyNodeId])
  })

  it('errors on a pick no radius on the jib lifts', () => {
    const w = wall()
    const report = validateFormwork([w] as AnyNode[], {
      crane: { capacityCurve: [{ radiusM: 30, capacityKg: 1000 }] },
      gangs: new Map([[w.id as AnyNodeId, [faceOf(8100, 5400)]]]),
    })

    const found = report.findings.find((f) => f.invariant === 'GANG_WEIGHT_OVER_CRANE_CAPACITY')
    expect(found?.severity).toBe('error')
    expect(found?.message).toContain('tops out at 1000 kg')
    expect(found?.message).toContain('no radius on the jib')
  })

  it('says the printed pick is lighter than the hook feels, in both severities', () => {
    // Walers, ties and the platform travel with a ganged face and are not in the figure.
    // A reader who takes the pick weight as the load on the hook is reading it low, and
    // that has to be in the finding rather than only in the caveats.
    const w = wall()
    const messages = (curve: Array<{ radiusM: number; capacityKg: number }>) =>
      validateFormwork([w] as AnyNode[], {
        crane: { capacityCurve: curve },
        gangs: new Map([[w.id as AnyNodeId, [faceOf(8100, 5400)]]]),
      })
        .findings.filter((f) => f.invariant === 'GANG_WEIGHT_OVER_CRANE_CAPACITY')
        .map((f) => f.message)

    expect(messages(CURVE)[0]).toContain('panels and make-up pieces only')
    expect(messages([{ radiusM: 30, capacityKg: 1000 }])[0]).toContain(
      'panels and make-up pieces only',
    )
  })

  it('says nothing about a gang it cannot weigh, rather than inventing a figure', () => {
    // 410 mm of Framax is a board cut on site, which has no catalog weight — so the gang
    // has no pick weight, and a gang with no weight is over no limit. Failing it against
    // a guessed figure would be the one thing worse than the silence.
    const w = wall()
    const face = faceOf(410)
    expect(face.totalWeightKg).toBeUndefined()

    const report = validateFormwork([w] as AnyNode[], {
      crane: { capacityCurve: [{ radiusM: 30, capacityKg: 5 }] },
      gangs: new Map([[w.id as AnyNodeId, [face]]]),
    })
    expect(report.findings.some((f) => f.invariant === 'GANG_WEIGHT_OVER_CRANE_CAPACITY')).toBe(
      false,
    )
  })

  it('faults every gang of every face, and locates each one', () => {
    // Three faces on one element is an ordinary 9 m wall in three lifts, and the heavy
    // pick can be in any of them. A check that took the first would pass the two above it.
    const w = wall()
    const report = validateFormwork([w] as AnyNode[], {
      crane: { capacityCurve: [{ radiusM: 30, capacityKg: 300 }] },
      gangs: new Map([[w.id as AnyNodeId, [faceOf(5400, 2700, 300), faceOf(2700)]]]),
    })

    const found = report.findings.filter((f) => f.invariant === 'GANG_WEIGHT_OVER_CRANE_CAPACITY')
    expect(found).toHaveLength(3)
    expect(found.map((f) => f.locus?.alongM).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([
      0, 0, 2.7,
    ])
    expect(found.some((f) => f.message.includes('face 2 gang 1'))).toBe(true)
  })

  it('drops an element outside the scope rather than reporting it', () => {
    const inScope = wall({ start: [0, 0], end: [5, 0] })
    const elsewhere = wall({ start: [0, 10], end: [5, 10] })
    const report = validateFormwork([inScope, elsewhere] as AnyNode[], {
      elementIds: [inScope.id as AnyNodeId],
      crane: { capacityCurve: [{ radiusM: 30, capacityKg: 100 }] },
      gangs: new Map([[elsewhere.id as AnyNodeId, [faceOf(2700)]]]),
    })
    expect(report.findings.some((f) => f.invariant === 'GANG_WEIGHT_OVER_CRANE_CAPACITY')).toBe(
      false,
    )
  })

  it('checks the headroom the slings need, which is not a lighter version of the weight', () => {
    // The 8.1 m gang's eyes are 4.744 m apart, so at 60° the hook sits 4.1 m over the top
    // of it. A crane with 2 m under the hook does not lift that gang however light it is.
    const w = wall()
    const report = validateFormwork([w] as AnyNode[], {
      crane: { capacityCurve: CURVE, hookHeightM: 2 },
      gangs: new Map([[w.id as AnyNodeId, [faceOf(8100, 5400)]]]),
    })

    const found = report.findings.find((f) => f.invariant === 'GANG_HEADROOM_OVER_HOOK_HEIGHT')
    expect(found?.severity).toBe('warning')
    expect(found?.message).toContain('4108 mm')
    expect(found?.message).toContain('2000 mm')
    // The remedy is hardware, and specifically not a flatter sling — that is what the
    // stated minimum angle exists to forbid.
    expect(found?.message).toContain('lifting beam')
  })

  it('leaves the headroom unchecked where no hook height was recorded, and says which half', () => {
    // The half-checked case, and the one that reads worst if it is silent: a report saying
    // the crane was checked, having weighed every gang and measured none of them.
    const w = wall()
    const report = validateFormwork([w] as AnyNode[], {
      crane: { capacityCurve: CURVE },
      gangs: new Map([[w.id as AnyNodeId, [faceOf(8100, 5400)]]]),
    })

    expect(report.notChecked.some((e) => e.invariant === 'GANG_WEIGHT_OVER_CRANE_CAPACITY')).toBe(
      false,
    )
    expect(
      report.notChecked.find((e) => e.invariant === 'GANG_HEADROOM_OVER_HOOK_HEIGHT')?.needs,
    ).toContain('hookHeightM')
  })

  it('stops telling a clean report that the crane was not verified', () => {
    // The sentence was a fixed pair — rebar and the crane — until the settings gained a
    // load chart. A clean scope that was checked against one and still says it was not is
    // understating what it did, which is the mirror of the failure `notChecked` prevents.
    const w = wall()
    const checked = validationSummary(
      validateFormwork([w] as AnyNode[], {
        crane: { capacityCurve: CURVE, hookHeightM: 40 },
        gangs: new Map([[w.id as AnyNodeId, [faceOf(2700)]]]),
      }),
    )
    expect(checked[0]).toContain('clashes against rebar')
    expect(checked[0]).not.toContain('crane')

    const unchecked = validationSummary(validateFormwork([w] as AnyNode[]))
    expect(unchecked[0]).toContain('what the crane lifts')
  })
})

describe('the report', () => {
  it('scopes to one level when asked', () => {
    const levelA = 'level-a'
    const levelB = 'level-b'
    const a = wall({ parentId: levelA })
    const b = wall({ start: [0, 10], end: [5, 10], parentId: levelB })
    expect(validateFormwork([a, b] as AnyNode[], { parentId: levelA }).elementIds).toEqual([
      a.id as AnyNodeId,
    ])
    expect(validateFormwork([a, b] as AnyNode[]).elementIds.length).toBe(2)
  })

  it('scopes to a named selection, and reads an empty one as empty', () => {
    // An empty array asked about nothing. Treating it as absent would report findings
    // about the whole scene to a caller who named no elements at all.
    const a = wall()
    const b = wall({ start: [0, 10], end: [5, 10] })
    expect(
      validateFormwork([a, b] as AnyNode[], { elementIds: [a.id as AnyNodeId] }).elementIds,
    ).toEqual([a.id as AnyNodeId])
    expect(validateFormwork([a, b] as AnyNode[], { elementIds: [] }).elementIds).toEqual([])
  })

  it('intersects a selection with a level rather than choosing one of them', () => {
    const levelA = 'level-a'
    const a = wall({ parentId: levelA })
    const upstairs = wall({ start: [0, 10], end: [5, 10], parentId: 'level-b' })
    const report = validateFormwork([a, upstairs] as AnyNode[], {
      parentId: levelA,
      elementIds: [a.id as AnyNodeId, upstairs.id as AnyNodeId],
    })
    expect(report.elementIds).toEqual([a.id as AnyNodeId])
  })

  it('sorts errors before warnings', () => {
    const system = formworkSystem('doka-framax-xlife')
    if (!system) throw new Error('the Framax catalog is missing')
    // An error (single-sided with nothing to bear on) and a warning (an acute
    // corner no unit turns) in one scope.
    const single = wall({
      start: [0, 0],
      end: [5, 0],
      castOrder: 1,
      pourId: 'P1',
      formworkMode: 'single-sided-a',
    })
    const acute = wall({ start: [5, 0], end: [2, 3], castOrder: 1, pourId: 'P1' })
    const report = validateFormwork([single, acute] as AnyNode[], {
      systems: new Map([
        [single.id as AnyNodeId, system],
        [acute.id as AnyNodeId, system],
      ]),
    })
    const severities = report.findings.map((f) => f.severity)
    expect(report.errorCount).toBeGreaterThan(0)
    expect(report.warningCount).toBeGreaterThan(0)
    expect(severities.lastIndexOf('error')).toBeLessThan(severities.indexOf('warning'))
  })

  it('always lists what it could not check, even on a clean scope', () => {
    const w = wall()
    const report = validateFormwork([w] as AnyNode[])
    expect(report.findings).toEqual([])
    expect(report.notChecked.length).toBeGreaterThan(0)
    expect(report.notChecked.some((entry) => entry.invariant === 'TIES_THROUGH_REBAR')).toBe(true)
  })

  it('says a clean scope is clean without implying everything was checked', () => {
    const w = wall()
    const summary = validationSummary(validateFormwork([w] as AnyNode[]))
    expect(summary.length).toBe(1)
    expect(summary[0]).toContain('1 element checked')
    expect(summary[0]).toContain('could not run')
  })

  it('distinguishes an empty scope from a passing one', () => {
    const summary = validationSummary(validateFormwork([]))
    expect(summary).toEqual(['Nothing in this scope to check.'])
    expect(validateFormwork([]).elementIds).toEqual([])
  })

  it('reports every finding message in the summary, errors first', () => {
    const w = wall({ formworkMode: 'single-sided-a' })
    const summary = validationSummary(validateFormwork([w] as AnyNode[]))
    expect(summary[0]).toContain('cannot be built as specified')
    expect(summary.some((line) => line.includes('formed on one side only'))).toBe(true)
  })

  it('lists only the elements an error names, for a panel to select', () => {
    const clean = wall({ start: [0, 10], end: [5, 10] })
    const broken = wall({ formworkMode: 'single-sided-a' })
    const report = validateFormwork([clean, broken] as AnyNode[])
    expect(failingElementIds(report)).toEqual([broken.id as AnyNodeId])
  })

  it('does not count a warning as a failing element', () => {
    const system = formworkSystem('doka-framax-xlife')
    if (!system) throw new Error('the Framax catalog is missing')
    const a = wall({ start: [0, 0], end: [5, 0], castOrder: 1, pourId: 'P1' })
    const b = wall({ start: [5, 0], end: [2, 3], castOrder: 1, pourId: 'P1' })
    const report = validateFormwork([a, b] as AnyNode[], {
      systems: new Map([
        [a.id as AnyNodeId, system],
        [b.id as AnyNodeId, system],
      ]),
    })
    expect(report.warningCount).toBeGreaterThan(0)
    expect(report.errorCount).toBe(0)
    expect(failingElementIds(report)).toEqual([])
  })
})
