import type { AnyNodeId } from '../../../schema/types'
import { findingKey, formworkRemedy } from './remedy'
import type { Finding, InvariantId } from './types'

/**
 * The findings that are somebody else's to answer — the plan's RFI-candidate
 * generator.
 *
 * `remedy.ts` says which call clears a finding. This says which findings are not the
 * contractor's to clear at all, and the two questions turn out to be **orthogonal**.
 * That is the whole result of this module and the reason it is a second table rather
 * than a field on the first: a cast-order cycle has a `choice` remedy and is still
 * the contractor's own decision, because under every standard form of contract the
 * sequence of construction is means and methods; a waterstop run that does not close
 * has no remedy here at all and is squarely the engineer's, because a seal across a
 * joint in a water-retaining structure is permanent works. Neither the remedy kind nor
 * the severity predicts the addressee.
 *
 * Counted out, **11 of the 21 invariants are a question for somebody else and 10 are
 * the contractor's own problem** — and the second group is not a shortcoming. A run
 * with an unformable strip, a filler too narrow to fix, a gang over the chart: these
 * are answered by a different layout, and an RFI about one is a designer being asked
 * to do the temporary-works engineering the sender is responsible for.
 *
 * One of the eleven, `LIFT_JOINT_OFF_PERMITTED_ELEVATION`, is a question only on the
 * elements where no cap clears it, because its default remedy is the one that is
 * argument-complete — see the suppression below.
 *
 * ## Why the addressee is a field and not a comment
 *
 * Sending a question about the tie pattern on an exposed face to the structural
 * engineer gets a correct and useless answer — the pattern is a matter of appearance
 * and the architect owns it, and the two are different people with different
 * turnarounds. Where the recipient is wrong the RFI is late, not answered.
 *
 * ## Why a `write` remedy suppresses the RFI
 *
 * A question sent about something one call fixes wastes the answer: the reply arrives
 * days later and the cap could have moved the joint before the pour. So a finding
 * whose own remedy is argument-complete raises no candidate, whatever this table says
 * about its invariant — which is why the suppression is per *finding*. The same
 * invariant is an RFI on the element where no cap clears it and a fix on the element
 * where one does, exactly as `remedy.ts` classifies per finding rather than per kind.
 *
 * ## Why identical findings are grouped
 *
 * A register carrying the same question thirty times over thirty walls is a register
 * nobody reads, and it is not how the question is asked: an RFI names the locations it
 * covers and asks once. So candidates group by invariant and addressee, and carry every
 * element and every finding key behind them.
 *
 * ## What this deliberately does not produce
 *
 * No number, no date, no submitted-or-answered status. There is no RFI register in this
 * model, and a document carrying a reference and a status that nothing tracks reads as
 * having been sent. These are *candidates* — the questions worth asking, in the words
 * they would be asked in, for somebody to put on their own form.
 */

/**
 * Who answers it.
 *
 * Two, because these are the two the findings actually reach. A temporary-works
 * designer would be a third and no finding here is addressed to one: the temporary
 * works are what this feature *is*, so a question about them is a question this engine
 * either answers or has no business asking.
 */
export type RfiAddressee = 'engineer-of-record' | 'architect'

export const RFI_ADDRESSEE_LABELS: Record<RfiAddressee, string> = {
  'engineer-of-record': 'Engineer of record',
  architect: 'Architect',
}

/** The question for one invariant, in the words it would be asked in. */
interface RfiTemplate {
  addressee: RfiAddressee
  /** One line for the subject field of the form. */
  subject: string
  /** The question itself. Carries no figures — the finding's message does. */
  question: string
  /** What the answer lets somebody do, so a chaser can say what is waiting on it. */
  unblocks: string
}

/**
 * One question, over every finding that asks it.
 *
 * `context` is the findings' own messages rather than a sentence written here. The
 * figures belong to the check that found them, and a description restating them is a
 * second version to keep in step with the first.
 */
export interface RfiCandidate {
  invariant: InvariantId
  addressee: RfiAddressee
  subject: string
  question: string
  unblocks: string
  /** Every element the question covers, deduplicated, in the order the sweep found them. */
  elementIds: AnyNodeId[]
  /** The findings behind it, so a surface can select them or re-validate. */
  findingKeys: string[]
  /** What was found, verbatim — one entry per finding grouped here. */
  context: string[]
  /**
   * True where an answer is wanted before concrete goes in.
   *
   * Read off severity, which already carries it: an error is a thing the crew cannot
   * do, so the pour waits on the answer; a warning is an exception somebody accepts,
   * so the question can travel alongside the work. A separate priority field would be
   * a second judgement about the same fact.
   */
  beforePour: boolean
}

/**
 * The question each invariant raises, or `null` where it raises none.
 *
 * Exhaustive over `InvariantId` for the reason `REMEDIES` is: a new check with no entry
 * here would silently never be asked about, and "no RFI" is a claim about liability
 * rather than an absence of work.
 */
const RFI_TEMPLATES: Record<InvariantId, RfiTemplate | null> = {
  CAST_ORDER_CYCLE: {
    addressee: 'engineer-of-record',
    subject: 'Construction joint location in a ring of abutting elements',
    question:
      'These elements abut in a ring, so one of them must be cast against hardened concrete at a junction the drawings do not show a joint at. At which junction may a construction joint be formed, and what continuity reinforcement is required through it?',
    unblocks:
      'The cast order, and with it the pour sequence and the shutter sets the programme is built on.',
  },
  SINGLE_SIDED_ANCHOR_NOT_EARLIER: {
    addressee: 'engineer-of-record',
    subject: 'Anchor loads from single-sided formwork',
    question:
      'This pour is formed single-sided, so the whole lateral pressure goes into anchors in the element below rather than through ties. May that element be loaded by the anchors at the pour age proposed, and is a load or an embedment detail specified for them?',
    unblocks:
      'Whether the pour can be formed single-sided at all, and therefore the sequence its neighbours are cast in.',
  },
  // The one finding on this list that is a fault in the takeoff rather than in the
  // building. Asking a designer about it would be asking them to audit our arithmetic.
  AREA_DOUBLE_COUNTED: null,
  UNFORMABLE_STRIP: null,
  FILLER_BELOW_MINIMUM: null,
  WALL_OUTSIDE_TIE_RANGE: {
    addressee: 'engineer-of-record',
    subject: 'Wall thickness beyond the reach of a through-tie',
    question:
      'No tie in the specified system reaches through this wall, so it is formed single-sided against anchors or cast in two operations with a joint within the thickness. Which is acceptable, and if the second, where does the joint fall and what reinforcement crosses it?',
    unblocks: 'The formwork mode for the element, which every other figure for it follows from.',
  },
  ARCHITECTURAL_TIE_GRID_ASYMMETRIC: {
    addressee: 'architect',
    subject: 'Tie-hole pattern on an exposed face',
    question:
      'The tie holes on this face are not symmetric about the run, so the pattern of plugged cones on the finished concrete will read as off-centre. Is the pattern as laid out acceptable, or is a specified grid required for the face?',
    unblocks:
      'The panel layout for the face — a specified grid changes the make-up piece and every mark after it.',
  },
  OPENING_STRADDLES_LIFT_JOINT: {
    addressee: 'engineer-of-record',
    subject: 'Construction joint crossing an opening',
    question:
      'No lift height clears every opening on this element, so a construction joint runs through a void and the bulkhead has no wall to bear on for part of its length. May the joint cross the opening as shown, or is a joint elevation specified for this element?',
    unblocks: 'The lift heights, and therefore the shutter count and the pour programme.',
  },
  JUNCTION_ANGLE_UNFITTABLE: null,
  EXPANSION_JOINT_BRIDGED: {
    addressee: 'engineer-of-record',
    subject: 'Movement joint bridged by a single pour',
    question:
      'One pour continues across a joint whose purpose is to separate the two sides, so the concrete will be continuous where the design requires it to move. Confirm the joint is to be formed as a bulkhead in this pour, and state the sealant and dowel detail through it.',
    unblocks:
      'The pour division at the joint. Cast as one pour, the joint is not a joint and the remedy afterwards is a saw cut.',
  },
  WATERSTOP_RUN_NOT_CLOSED: {
    addressee: 'engineer-of-record',
    subject: 'Waterstop continuity across construction joints',
    question:
      'The joints in this water-retaining element do not carry a continuous seal, so there is a path through the joint at the locations listed. Specify the waterstop or injectable hose to be used and the detail at each junction and change of direction, including the laps.',
    unblocks:
      'The joint treatments, which are fixed before the pour and cannot be added to a joint after it is cast.',
  },
  TIE_THROUGH_WATERSTOP: {
    addressee: 'engineer-of-record',
    subject: 'Tie penetration within the width of a waterstop',
    question:
      'A tie hole falls inside the waterstop, so a rod would pass through the seal. Is a watertight tie — a taper tie or a sealed cone, plugged and patched — acceptable at these positions, or is the joint to be relocated clear of the tie row?',
    unblocks: 'The tie type for the pour, which is ordered rather than substituted on site.',
  },
  LIFT_JOINT_OFF_PERMITTED_ELEVATION: {
    addressee: 'engineer-of-record',
    subject: 'Lift joint away from a permitted elevation',
    question:
      'No lift height puts this joint on one of the elevations the drawings permit. May the joint be formed at the elevation reported, or is a lift arrangement specified for this element?',
    unblocks: 'The lift heights, and the reinforcement laps that are set out from the joint.',
  },
  POUR_VOLUME_OVER_SUPPLY: null,
  DESIGN_OUTSIDE_CODE_ENVELOPE: {
    addressee: 'engineer-of-record',
    subject: 'Formwork pressure design outside the standard’s validated envelope',
    question:
      'The pour falls outside the boundary conditions the pressure standard is validated over, so the design pressure is an extrapolation rather than a code figure. Confirm the standard to be designed to for this pour, or state a design pressure for it.',
    unblocks:
      'Every member size, tie spacing and prop position on the pour — they are all solved from the pressure.',
  },
  OPENING_LEAVES_TIE_GAP: null,
  CORNER_UNITS_OVERLAP: null,
  OPENING_INSIDE_CORNER_UNIT: {
    addressee: 'architect',
    subject: 'Opening within the width of a corner unit',
    question:
      'This opening falls inside the stretch a corner unit occupies, so the box-out is cut into a framed unit or the corner is built bespoke. May the opening move clear of the corner, and if not, is the resulting finish at the corner acceptable?',
    unblocks:
      'The corner detail, and whether a hired unit is modified — which the hirer must agree.',
  },
  SET_COUNT_SHORTAGE: null,
  GANG_WEIGHT_OVER_CRANE_CAPACITY: null,
  GANG_HEADROOM_OVER_HOOK_HEIGHT: null,
  // The rate, the mix and the consistency are all temporary-works decisions, and the
  // rating is published — so there is a call to make and none of it is a question for the
  // designer of the permanent work. Only where the finding's own code cannot name a rate
  // is anything genuinely unanswerable here, and that is a note on the finding rather than
  // a different addressee this list has.
  PANEL_PRESSURE_OVER_RATING: null,
}

/**
 * The questions this scope raises, grouped, in the order the invariants first appear.
 *
 * Report order rather than severity order, deliberately: `beforePour` already carries
 * the urgency, and a list sorted by severity separates two questions about the same
 * element that would go on one form.
 */
export function formworkRfiCandidates(findings: readonly Finding[]): RfiCandidate[] {
  const grouped = new Map<string, RfiCandidate>()
  for (const finding of findings) {
    const template = RFI_TEMPLATES[finding.invariant]
    if (!template) continue
    // A question about something one call fixes is a question whose answer arrives
    // after the pour it was about.
    if (formworkRemedy(finding).kind === 'write') continue

    const id = `${finding.invariant}|${template.addressee}`
    const existing = grouped.get(id)
    if (!existing) {
      grouped.set(id, {
        invariant: finding.invariant,
        addressee: template.addressee,
        subject: template.subject,
        question: template.question,
        unblocks: template.unblocks,
        elementIds: [...new Set(finding.elementIds)],
        findingKeys: [findingKey(finding)],
        context: [finding.message],
        beforePour: finding.severity === 'error',
      })
      continue
    }
    for (const elementId of finding.elementIds) {
      if (!existing.elementIds.includes(elementId)) existing.elementIds.push(elementId)
    }
    const key = findingKey(finding)
    if (!existing.findingKeys.includes(key)) existing.findingKeys.push(key)
    existing.context.push(finding.message)
    // One error among a group of warnings makes the whole question a hold-point: the
    // pour that cannot proceed is waiting on this answer whatever the others are.
    existing.beforePour = existing.beforePour || finding.severity === 'error'
  }
  return [...grouped.values()]
}

/**
 * The candidates as sentences, for a panel heading or an AI reply.
 *
 * Says nothing at all where a scope raises none, rather than reporting zero: a clean
 * report has already said the check found nothing, and "0 RFIs" beside it invites the
 * reader to wonder which register that count came out of.
 */
export function rfiSummary(candidates: readonly RfiCandidate[]): string[] {
  if (candidates.length === 0) return []
  const holds = candidates.filter((candidate) => candidate.beforePour).length
  const byAddressee = new Map<RfiAddressee, number>()
  for (const candidate of candidates) {
    byAddressee.set(candidate.addressee, (byAddressee.get(candidate.addressee) ?? 0) + 1)
  }
  const split = [...byAddressee.entries()]
    .map(
      ([addressee, count]) => `${count} for the ${RFI_ADDRESSEE_LABELS[addressee].toLowerCase()}`,
    )
    .join(', ')
  return [
    `${candidates.length} ${candidates.length === 1 ? 'question' : 'questions'} here ${candidates.length === 1 ? 'is' : 'are'} somebody else’s to answer — ${split}.`,
    ...(holds > 0
      ? [
          `${holds} ${holds === 1 ? 'is wanted' : 'are wanted'} before concrete goes in: the work ${holds === 1 ? 'it covers' : 'they cover'} cannot proceed as specified.`,
        ]
      : []),
    'These are questions to ask, not a register — nothing here is numbered, dated or tracked, and no answer is recorded against them.',
  ]
}

/** The description both AI surfaces carry for the RFI read. */
export const FORMWORK_RFI_DESCRIPTION =
  'List the formwork findings that are not the contractor’s to resolve — the questions for the engineer of record or the architect, in the words they would be asked in. Derived from the same validate_formwork findings, so call this instead of writing your own questions from a validation reply: the split between "somebody else answers this" and "we fix this ourselves" is a liability judgement per invariant and not something to infer from a message. Each candidate names its addressee, the elements it covers, what was found, and what the answer unblocks. Report the questions as they are written rather than paraphrasing them, and never present the reply as a submitted RFI: there is no register in this model, so nothing here has a number, a date or an answer against it. A finding absent from this list is not a finding without consequence — most defects are resolved by a different layout or a different call, and validate_formwork already says which.'
