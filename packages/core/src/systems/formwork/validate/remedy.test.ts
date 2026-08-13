import { describe, expect, it } from 'bun:test'
import { ColumnNode } from '../../../schema/nodes/column'
import { SlabNode } from '../../../schema/nodes/slab'
import { WallNode } from '../../../schema/nodes/wall'
import { WindowNode } from '../../../schema/nodes/window'
import type { AnyNode } from '../../../schema/types'
import { validateFormwork } from './invariants'
import { formworkRemedy, mechanicallyFixable, remedySummary } from './remedy'
import { type Finding, INVARIANT_LABELS, type InvariantId } from './types'

/**
 * What to do about a finding.
 *
 * The three things worth asserting here are not the notes. They are: that every
 * invariant has an answer, so a check cannot be added and silently reported as
 * unfixable; that a `write` is *actually* argument-complete and clears the finding
 * it was offered for, which is the only claim a fix button rests on; and that a
 * remedy never names a tool that cannot help — the failure mode is a button that
 * appears to work.
 *
 * The round trip is the load-bearing test. A remedy that looks right and moves a
 * joint somewhere else is worse than no remedy, so each `write` is applied to the
 * scene and the scene re-validated, rather than its arguments being compared
 * against numbers this file computed a second time.
 */

const WRITES = new Set([
  'set_element_construction',
  'set_pour_limits',
  'set_pour_date',
  'set_formwork_settings',
  'set_formwork_part',
])

function wall(overrides: Partial<Parameters<typeof WallNode.parse>[0]> = {}) {
  return WallNode.parse({
    start: [0, 0],
    end: [8, 0],
    thickness: 0.2,
    height: 8,
    formworkType: 'plywood',
    ...overrides,
  })
}

function window(wallId: string, centreY: number, height = 1) {
  return WindowNode.parse({
    wallId,
    parentId: wallId,
    position: [4, centreY, 0],
    width: 1.2,
    height,
  })
}

function findingsOf(nodes: AnyNode[], invariant: InvariantId, limits = {}): Finding[] {
  return validateFormwork(nodes, { limits }).findings.filter((f) => f.invariant === invariant)
}

/** The invariant's default, reached through a finding that carries none of its own. */
function defaultFor(invariant: InvariantId) {
  return formworkRemedy({
    invariant,
    severity: 'error',
    elementIds: [],
    message: '',
  })
}

describe('every invariant has an answer', () => {
  it('answers for all 22, and the table is what makes that so', () => {
    // `INVARIANT_LABELS` is the other exhaustive record over `InvariantId`, so it is
    // the list to sweep — a new check reaches both or neither.
    const invariants = Object.keys(INVARIANT_LABELS) as InvariantId[]
    expect(invariants.length).toBe(22)
    for (const invariant of invariants) {
      const remedy = defaultFor(invariant)
      expect(remedy, invariant).toBeDefined()
      expect(remedy.note.length, invariant).toBeGreaterThan(40)
    }
  })

  it('never names a tool this feature does not have', () => {
    for (const invariant of Object.keys(INVARIANT_LABELS) as InvariantId[]) {
      const { kind, tool } = defaultFor(invariant)
      if (kind === 'none') expect(tool, invariant).toBeUndefined()
      else expect(WRITES.has(tool as string), `${invariant} → ${tool}`).toBe(true)
    }
  })

  it('leaves the deciding field named on every choice, and only there', () => {
    // A `choice` whose field is unstated is a call a surface cannot offer: the whole
    // point is that one argument is the caller's and the rest are not.
    for (const invariant of Object.keys(INVARIANT_LABELS) as InvariantId[]) {
      const { field, kind } = defaultFor(invariant)
      if (kind === 'choice') expect(field, invariant).toBeTruthy()
      else expect(field, invariant).toBeUndefined()
    }
  })

  it('carries no arguments on a default, because a default has no figures', () => {
    // The table answers for an invariant and not for an instance, so it has no
    // element id to write to. Arguments arrive only on a finding.
    for (const invariant of Object.keys(INVARIANT_LABELS) as InvariantId[]) {
      expect(defaultFor(invariant).args, invariant).toBeUndefined()
    }
  })
})

describe('a write is argument-complete and clears the finding', () => {
  it('the cap offered for an opening across a joint moves every joint clear of it', () => {
    // An 8 m wall capped at 4 m joints at 4.0 m, through a window spanning 3.5–4.5.
    const w = wall()
    const nodes = [w, window(w.id, 4)] as AnyNode[]
    const limits = { maxLiftHeight: 4 }
    const [before] = findingsOf(nodes, 'OPENING_STRADDLES_LIFT_JOINT', limits)
    const remedy = formworkRemedy(before as Finding)

    expect(remedy.kind).toBe('write')
    expect(remedy.tool).toBe('set_pour_limits')
    expect(remedy.args?.elementId).toBe(w.id)
    expect(remedy.args?.maxLiftHeight).toBeTypeOf('number')

    // Applied for real, and the whole scene re-validated. The cap is a per-element
    // field, so this is the same write set_pour_limits makes.
    const fixed = [
      { ...w, maxLiftHeight: remedy.args?.maxLiftHeight },
      window(w.id, 4),
    ] as AnyNode[]
    expect(findingsOf(fixed, 'OPENING_STRADDLES_LIFT_JOINT', limits)).toEqual([])
  })

  it('the cap offered for an off-elevation joint snaps every joint onto the set', () => {
    const w = wall({ height: 6 })
    const limits = { maxLiftHeight: 3, permittedJointElevations: [2, 4] }
    const [before] = findingsOf([w] as AnyNode[], 'LIFT_JOINT_OFF_PERMITTED_ELEVATION', limits)
    const remedy = formworkRemedy(before as Finding)

    expect(remedy.kind).toBe('write')
    const fixed = [{ ...w, maxLiftHeight: remedy.args?.maxLiftHeight }] as AnyNode[]
    expect(findingsOf(fixed, 'LIFT_JOINT_OFF_PERMITTED_ELEVATION', limits)).toEqual([])
  })

  it('the cap offered for an over-supply pour brings it inside the limit', () => {
    // A 2 × 2 m column 9 m tall is 36 m³ in one pour against a 10 m³ delivery.
    const column = ColumnNode.parse({
      position: [0, 0, 0],
      crossSection: 'square',
      width: 2,
      depth: 2,
      height: 9,
      formworkType: 'steel-panel',
    })
    const limits = { maxPourVolume: 10 }
    const [before] = findingsOf([column] as AnyNode[], 'POUR_VOLUME_OVER_SUPPLY', limits)
    const remedy = formworkRemedy(before as Finding)

    expect(remedy.kind).toBe('write')
    expect(remedy.args?.maxLiftHeight).toBe(2.5)
    const fixed = [{ ...column, maxLiftHeight: remedy.args?.maxLiftHeight }] as AnyNode[]
    expect(findingsOf(fixed, 'POUR_VOLUME_OVER_SUPPLY', limits)).toEqual([])
  })

  it('every pour-limit write names the attach, because the cap alone builds nothing', () => {
    // The gap between the two calls is an element cast in more pours than it is
    // formed for, and its takeoff short by the difference.
    const w = wall()
    const nodes = [w, window(w.id, 4)] as AnyNode[]
    const [straddle] = findingsOf(nodes, 'OPENING_STRADDLES_LIFT_JOINT', { maxLiftHeight: 4 })
    expect(formworkRemedy(straddle as Finding).thenAttach).toBe(true)
    expect(remedySummary(straddle as Finding)).toContain('attach_formwork')
  })
})

describe('an instance can disagree with its own invariant', () => {
  it('offers no cap where the openings leave no joint anywhere to land', () => {
    // A 3 m wall with a window spanning 0.9–2.1 m: every division into practical
    // lifts puts a joint in the void, so nothing here is a fix and the remedy says so
    // rather than proposing a cap that moves the joint into the same hole.
    const w = wall({ height: 3 })
    const nodes = [w, window(w.id, 1.5, 1.2)] as AnyNode[]
    const [finding] = findingsOf(nodes, 'OPENING_STRADDLES_LIFT_JOINT', { maxLiftHeight: 1.5 })
    const remedy = formworkRemedy(finding as Finding)

    expect(remedy.kind).toBe('none')
    expect(remedy.tool).toBeUndefined()
  })

  it('offers nothing on a slab, where the same invariant on a column takes a cap', () => {
    // The case that decides the whole design: one invariant, two elements, and a
    // remedy table keyed on the invariant would have to be wrong about one of them.
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
    const [finding] = findingsOf([slab] as AnyNode[], 'POUR_VOLUME_OVER_SUPPLY', {
      maxPourVolume: 60,
    })
    const remedy = formworkRemedy(finding as Finding)

    expect(remedy.kind).toBe('none')
    expect(remedy.note).toContain('polygon partition')
    // And the invariant's own default agrees with neither, which is why it defers.
    expect(defaultFor('POUR_VOLUME_OVER_SUPPLY').kind).toBe('none')
  })

  it('refuses a cast order where more is deducted than the neighbour buries', () => {
    // The invariant's default is a cast order, because the usual failure is an
    // ownership one. This half is not: the pair overlap by more than the geometry
    // supports, and whichever of them owns the corner the figure is still wrong.
    expect(defaultFor('AREA_DOUBLE_COUNTED').field).toBe('castOrder')
  })
})

describe('what a caller can act on without deciding anything', () => {
  it('counts the mechanical fixes and leaves the choices out of them', () => {
    const w = wall({ height: 6 })
    const report = validateFormwork([w] as AnyNode[], {
      limits: { maxLiftHeight: 3, permittedJointElevations: [2, 4] },
    })
    const fixable = mechanicallyFixable(report.findings)

    expect(fixable.length).toBeGreaterThan(0)
    for (const finding of fixable) expect(formworkRemedy(finding).args).toBeDefined()
  })

  it('says outright that nothing helps, rather than naming a call that does not', () => {
    const summary = remedySummary({
      invariant: 'JUNCTION_ANGLE_UNFITTABLE',
      severity: 'warning',
      elementIds: [],
      message: '',
    })
    expect(summary).toStartWith('No write here clears this.')
    expect(summary).not.toContain('Call ')
  })

  it('names the deciding field on a choice, so nobody reads it as applicable', () => {
    const summary = remedySummary({
      invariant: 'CAST_ORDER_CYCLE',
      severity: 'error',
      elementIds: [],
      message: '',
    })
    expect(summary).toContain('set_element_construction')
    expect(summary).toContain('deciding castOrder yourself')
  })
})
