import { describe, expect, it } from 'bun:test'
import { ColumnNode } from '../../../schema/nodes/column'
import { ConstructionJointNode } from '../../../schema/nodes/construction-joint'
import { SlabNode } from '../../../schema/nodes/slab'
import { WallNode } from '../../../schema/nodes/wall'
import { WindowNode } from '../../../schema/nodes/window'
import type { AnyNode, AnyNodeId } from '../../../schema/types'
import { formworkSystem } from '../catalog'
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
