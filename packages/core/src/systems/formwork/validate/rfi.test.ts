import { describe, expect, it } from 'bun:test'
import { WallNode } from '../../../schema/nodes/wall'
import { WindowNode } from '../../../schema/nodes/window'
import type { AnyNode } from '../../../schema/types'
import { validateFormwork } from './invariants'
import { formworkRemedy } from './remedy'
import { formworkRfiCandidates, RFI_ADDRESSEE_LABELS, rfiSummary } from './rfi'
import { type Finding, INVARIANT_LABELS, type InvariantId } from './types'

/**
 * The questions that are somebody else's to answer.
 *
 * What is worth asserting here is not the wording. It is that the addressee is not
 * derivable from anything already on a finding — if it were, this module would be a
 * getter and not a table — and that the two suppressions hold: a finding one call
 * fixes raises no question, and a finding that is the contractor's own temporary-works
 * problem raises none either. An RFI generator that emitted one question per finding
 * would produce a register that sends our own layout problems to the engineer, which is
 * both slower and wrong about who is liable.
 */

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

function window(wallId: string, centreY: number, height = 1, along = 4) {
  return WindowNode.parse({
    wallId,
    parentId: wallId,
    position: [along, centreY, 0],
    width: 1.2,
    height,
  })
}

/** A finding of a given kind, carrying no remedy of its own. */
function bare(invariant: InvariantId, severity: Finding['severity'] = 'error'): Finding {
  return { invariant, severity, elementIds: ['wall_x' as never], message: `${invariant} happened` }
}

describe('who answers it is a judgement, not a field on the finding', () => {
  it('decides for all 21 invariants, so a new check cannot be silently never asked about', () => {
    // Sweeping `INVARIANT_LABELS` for the reason the remedy suite does: it is the other
    // exhaustive record over `InvariantId`, so a check reaches both tables or neither.
    // "No RFI" is a claim about liability, and an unmade claim reads as one made.
    for (const invariant of Object.keys(INVARIANT_LABELS) as InvariantId[]) {
      const candidates = formworkRfiCandidates([bare(invariant)])
      expect(candidates.length, invariant).toBeLessThanOrEqual(1)
      for (const candidate of candidates) {
        expect(RFI_ADDRESSEE_LABELS[candidate.addressee], invariant).toBeTruthy()
        // Every one of them has to *ask* for something. A template that only described
        // the defect would be a finding restated on a form — the recipient reads it,
        // agrees, and returns nothing that unblocks the pour. Either a question or a
        // request in the imperative the trade actually writes them in.
        expect(
          /\?/.test(candidate.question) || /(Confirm|Specify|State) /.test(candidate.question),
          invariant,
        ).toBe(true)
        expect(candidate.unblocks.length, invariant).toBeGreaterThan(20)
        expect(candidate.subject.length, invariant).toBeGreaterThan(10)
      }
    }
  })

  it('asks about half of them, and the silent half is the deliberate part', () => {
    // The proportion is the result this module reports. If every finding raised a
    // question the table would be doing no work, and the ten it stays quiet about are
    // the contractor's own temporary-works decisions.
    //
    // Ten of the eleven templates are reached from a bare finding. The eleventh,
    // LIFT_JOINT_OFF_PERMITTED_ELEVATION, is the one invariant whose *default* remedy is
    // argument-complete, so a bare instance is suppressed by the write rule and it
    // becomes a question only on the element where no cap lands the joints on the set.
    const asked = (Object.keys(INVARIANT_LABELS) as InvariantId[]).filter(
      (invariant) => formworkRfiCandidates([bare(invariant)]).length > 0,
    )
    expect(asked.length).toBe(10)
    expect(asked).not.toContain('LIFT_JOINT_OFF_PERMITTED_ELEVATION')
    expect(
      formworkRfiCandidates([
        { ...bare('LIFT_JOINT_OFF_PERMITTED_ELEVATION'), remedy: { kind: 'none', note: 'x' } },
      ]),
    ).toHaveLength(1)
  })

  it('sends the tie pattern on an exposed face to the architect, not the engineer', () => {
    // The reason the addressee is a field at all: a question about how the concrete
    // looks gets a correct and useless answer from a structural engineer, and the
    // turnaround is spent.
    const [appearance] = formworkRfiCandidates([bare('ARCHITECTURAL_TIE_GRID_ASYMMETRIC')])
    expect(appearance?.addressee).toBe('architect')

    const [structural] = formworkRfiCandidates([bare('WATERSTOP_RUN_NOT_CLOSED')])
    expect(structural?.addressee).toBe('engineer-of-record')
  })

  it('is not predicted by the remedy kind, which is why it is a second table', () => {
    // The load-bearing claim. A cast-order cycle has a real remedy and is nobody
    // else's question; a waterstop that does not close has no remedy at all and is
    // squarely somebody else's. A field derived from `kind` would be wrong about both.
    const cycle = bare('CAST_ORDER_CYCLE')
    expect(formworkRemedy(cycle).kind).toBe('choice')
    expect(formworkRfiCandidates([cycle])).toHaveLength(1)

    const strip = bare('UNFORMABLE_STRIP')
    expect(formworkRemedy(strip).kind).toBe('none')
    expect(formworkRfiCandidates([strip])).toHaveLength(0)
  })

  it('stays quiet about the findings that are our own layout to fix', () => {
    // An RFI about a filler too narrow to fix is a designer being asked to do the
    // temporary-works engineering the sender is responsible for.
    const ours: InvariantId[] = [
      'UNFORMABLE_STRIP',
      'FILLER_BELOW_MINIMUM',
      'AREA_DOUBLE_COUNTED',
      'CORNER_UNITS_OVERLAP',
      'GANG_WEIGHT_OVER_CRANE_CAPACITY',
      'SET_COUNT_SHORTAGE',
    ]
    expect(formworkRfiCandidates(ours.map((invariant) => bare(invariant)))).toEqual([])
  })
})

describe('a question one call answers is not asked', () => {
  it('drops the finding whose own remedy is argument-complete', () => {
    // An 8 m wall capped at 4 m joints in a window at 3.5–4.5 m, and the check finds a
    // cap that clears it. The answer to an RFI about it would arrive after the pour.
    const w = wall()
    const nodes = [w, window(w.id, 4)] as AnyNode[]
    const report = validateFormwork(nodes, { limits: { maxLiftHeight: 4 } })
    const straddle = report.findings.find((f) => f.invariant === 'OPENING_STRADDLES_LIFT_JOINT')

    expect(formworkRemedy(straddle as Finding).kind).toBe('write')
    expect(
      formworkRfiCandidates(report.findings).some(
        (candidate) => candidate.invariant === 'OPENING_STRADDLES_LIFT_JOINT',
      ),
    ).toBe(false)
  })

  it('asks about the same invariant where no cap on that element clears it', () => {
    // Same check, same wording, opposite answer — which is why the suppression is per
    // finding rather than per invariant. A 3 m wall with a window across the middle has
    // no practical division that keeps every joint out of the void.
    const w = wall({ height: 3 })
    const nodes = [w, window(w.id, 1.5, 1.2)] as AnyNode[]
    const report = validateFormwork(nodes, { limits: { maxLiftHeight: 1.5 } })
    const straddle = report.findings.find((f) => f.invariant === 'OPENING_STRADDLES_LIFT_JOINT')

    expect(formworkRemedy(straddle as Finding).kind).toBe('none')
    const [candidate] = formworkRfiCandidates(report.findings).filter(
      (entry) => entry.invariant === 'OPENING_STRADDLES_LIFT_JOINT',
    )
    expect(candidate).toBeDefined()
    expect(candidate?.addressee).toBe('engineer-of-record')
    // The figures come from the check rather than from a sentence written here.
    expect(candidate?.context[0]).toBe(straddle?.message)
  })
})

describe('one question over many walls', () => {
  it('groups identical questions and carries every element behind them', () => {
    // A register with the same question thirty times is one nobody reads, and it is not
    // how the question is asked: an RFI names its locations and asks once.
    const findings: Finding[] = [
      { ...bare('WATERSTOP_RUN_NOT_CLOSED'), elementIds: ['wall_1' as never] },
      { ...bare('WATERSTOP_RUN_NOT_CLOSED'), elementIds: ['wall_2' as never] },
      { ...bare('WATERSTOP_RUN_NOT_CLOSED'), elementIds: ['wall_2' as never] },
    ]
    const candidates = formworkRfiCandidates(findings)

    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.elementIds).toEqual(['wall_1', 'wall_2'])
    // Three findings, three lines of context, two distinct keys — the keys dedupe
    // because two findings on one element share a remedy and therefore a question.
    expect(candidates[0]?.context).toHaveLength(3)
    expect(candidates[0]?.findingKeys).toHaveLength(2)
  })

  it('holds the pour for the group where any one of them is an error', () => {
    // The pour that cannot proceed is waiting on this answer whatever the others are,
    // so the flag is the group's rather than the last finding's.
    const mixed: Finding[] = [
      { ...bare('DESIGN_OUTSIDE_CODE_ENVELOPE', 'warning'), elementIds: ['wall_1' as never] },
      { ...bare('DESIGN_OUTSIDE_CODE_ENVELOPE', 'error'), elementIds: ['wall_2' as never] },
    ]
    expect(formworkRfiCandidates(mixed)[0]?.beforePour).toBe(true)

    const warningsOnly = [{ ...bare('DESIGN_OUTSIDE_CODE_ENVELOPE', 'warning') }]
    expect(formworkRfiCandidates(warningsOnly)[0]?.beforePour).toBe(false)
  })
})

describe('the summary says what it is and what it is not', () => {
  it('says nothing at all where a scope raises no questions', () => {
    // Rather than reporting zero: the validation has already said it found nothing, and
    // "0 RFIs" beside it invites the reader to ask which register that came out of.
    expect(rfiSummary([])).toEqual([])
  })

  it('splits by addressee, names the hold points, and refuses to look like a register', () => {
    const candidates = formworkRfiCandidates([
      bare('WATERSTOP_RUN_NOT_CLOSED'),
      bare('ARCHITECTURAL_TIE_GRID_ASYMMETRIC', 'warning'),
    ])
    const summary = rfiSummary(candidates).join(' ')

    expect(summary).toContain('engineer of record')
    expect(summary).toContain('architect')
    expect(summary).toContain('before concrete goes in')
    // The sentence that keeps a list of questions from being read as sent ones.
    expect(summary).toContain('not a register')
  })
})
