import { z } from 'zod'
import type { Finding, FormworkRemedy, InvariantId } from './types'

/**
 * What to do about each finding — the fix half of the plan's verify/fix loop.
 *
 * `invariants.ts` says a bill is for something nobody can build. This says which
 * call clears it, and the interesting part is how often the answer is *none*: of
 * the 21 invariants, three name a call whose arguments the check itself supplies,
 * seven name a call with one argument that is a human's to choose, and eleven
 * cannot be cleared by any write this feature has. A fix button on those eleven
 * would be a button that appears to work.
 *
 * ## The rule that decides which is which
 *
 * A remedy may change **the building or the plan**. It may not change the
 * *recorded fact the check reads*. Those two are easy to confuse because both are
 * writes to the same node: capping a wall's lifts so its joint clears a window is
 * a plan change and the window stays where it is, whereas declaring a face cast
 * against earth so the single-sided check stops firing changes nothing on site and
 * only makes the report agree with itself. The second is not a fix, it is the
 * input being edited until the check passes, and it is the failure mode this
 * module exists to refuse. Every `choice` below is a choice precisely because
 * somebody has to confirm the world matches what is about to be written.
 *
 * ## Why the classification is per finding and not per invariant
 *
 * `POUR_VOLUME_OVER_SUPPLY` is the case that settles it. On a wall the segment
 * split acts on `maxPourLength`, so a shorter bay is a real fix with a computable
 * length; on a slab no cap divides anything — `pourUnitsForElement` returns a
 * polygon as one pour by construction — so the same invariant has no reachable
 * write at all. A table keyed on the invariant would have to be wrong for one of
 * the two. So the table below is the *default*, and a check that knows better
 * overrides it on the finding it emits.
 *
 * That is also why the arguments travel on the finding rather than being derived
 * here. A remedy needing the pour's volume, the permitted elevation or the
 * opening's soffit would have to compute them a second time, and a second
 * derivation is how a fix comes to disagree with the finding it was offered for —
 * the same hazard `ValidateOptions` refuses by taking the packs and the envelopes
 * as inputs rather than re-solving them.
 *
 * ## The table is exhaustive on purpose
 *
 * `REMEDIES` is a `Record<InvariantId, …>`, so a new invariant does not compile
 * until somebody has decided whether anything can fix it. A check that grew with
 * no entry here would be quietly reported as unfixable, which is the same class of
 * silent wrong answer as an invariant that cannot fire.
 */

/**
 * The default for each invariant, and the note for every finding that carries no
 * arguments of its own.
 *
 * The notes are about *what the caller does next* rather than about the defect —
 * the finding's own `message` already names the figures, and a remedy that
 * restated them would be a second sentence to keep in step with the first.
 */
const REMEDIES: Record<InvariantId, FormworkRemedy> = {
  CAST_ORDER_CYCLE: {
    kind: 'choice',
    tool: 'set_element_construction',
    field: 'castOrder',
    note: 'Renumber one element in the ring so it is no longer waiting on the next. Which one is a sequencing decision: a cycle has no order to derive, which is what makes it a cycle, and the ring breaks only by deciding that one of these abutments need not be cast against hardened concrete.',
  },
  SINGLE_SIDED_ANCHOR_NOT_EARLIER: {
    kind: 'choice',
    tool: 'set_element_construction',
    field: 'castOrder',
    note: 'Give this element a cast order later than the neighbour it bears back onto, so the anchor is hardened before the pour. The other answer is againstEarthSide, and it is not a fix unless the face really is against earth — writing it to quieten the check leaves the shutter with nothing resisting it.',
  },
  AREA_DOUBLE_COUNTED: {
    kind: 'choice',
    tool: 'set_element_construction',
    field: 'castOrder',
    note: 'Where two elements each deduct the overlap they share, the one cast first forms and bills the corner — so a cast order that separates them leaves the deduction on one side only. Where more has been deducted than a neighbour buries, no write clears it: the pair overlap by more than the geometry supports and one of them has to move.',
  },
  UNFORMABLE_STRIP: {
    kind: 'none',
    note: 'A run with a stretch nothing closes needs a different division of the run — the make-up piece moved, or a panel width the stretch is a multiple of. Both are layout inputs on the assembly and no write here reaches them, so this is a change to the panel run rather than a call. Concrete leaves through the gap, so it cannot be left as it stands.',
  },
  FILLER_BELOW_MINIMUM: {
    kind: 'none',
    note: 'Move the make-up piece, which is the assembly’s filler position and reachable from no write here — or accept a site-built closure, which is a decision rather than an edit.',
  },
  WALL_OUTSIDE_TIE_RANGE: {
    kind: 'choice',
    tool: 'set_element_construction',
    field: 'formworkMode',
    note: 'Single-sided forms carry the load into an anchored base rather than through the wall, so they are the answer where no tie reaches the thickness — but they need something to bear back onto, and stating the mode does not provide it. The other answer is a system whose ties do reach, which is the assembly’s own system and reachable from no write here.',
  },
  ARCHITECTURAL_TIE_GRID_ASYMMETRIC: {
    kind: 'none',
    note: 'A symmetric grid comes from a symmetric filler position, which is a layout input on the assembly. Nothing about the bill changes either way — the panel count is identical — so this is only ever fixed deliberately, and never by a call from here.',
  },
  OPENING_STRADDLES_LIFT_JOINT: {
    kind: 'choice',
    tool: 'set_pour_limits',
    field: 'maxLiftHeight',
    thenAttach: true,
    note: 'Cap the lift so the joint lands clear of the opening, above it or below it, and the bulkhead has wall to bear on for its whole length. The cap is a choice because the joint has to clear every opening at once and the tie capacity still bounds it from above — a height that clears this window can put the next joint through the next one.',
  },
  JUNCTION_ANGLE_UNFITTABLE: {
    kind: 'none',
    note: 'No hinged unit sweeps this angle, so the corner is built bespoke in timber — a carpenter’s item at its own rate and lead time. The only write that would clear it is one that changes the angle, which means moving a wall.',
  },
  EXPANSION_JOINT_BRIDGED: {
    kind: 'choice',
    tool: 'set_element_construction',
    field: 'pourId',
    note: 'The two sides need different pour ids, so the concrete is not continuous across a joint whose whole purpose is to separate them. Which side changes, and to what, is a decision about the pour sequence.',
  },
  WATERSTOP_RUN_NOT_CLOSED: {
    kind: 'none',
    note: 'The seal is a treatment on the construction joint and no write here sets one. Either the open joints get a waterstop or an injectable hose, or the element is not water-retaining — and the second is a change to what the structure is for, not a way of closing the run.',
  },
  TIE_THROUGH_WATERSTOP: {
    kind: 'none',
    note: 'Move the joint clear of the tie row, or tie this pour with a watertight assembly — a taper tie or a sealed cone, plugged and patched. The first moves a joint node and the second is a tie type on the assembly; neither is reachable from a write here.',
  },
  LIFT_JOINT_OFF_PERMITTED_ELEVATION: {
    kind: 'write',
    tool: 'set_pour_limits',
    thenAttach: true,
    note: 'Cap the lift at the permitted elevation nearest the joint, so it lands where the structure offers one rather than in the middle of a storey.',
  },
  POUR_VOLUME_OVER_SUPPLY: {
    kind: 'none',
    note: 'The pour has to be divided or supplied faster. Which of the two, and where the division falls, depends on the element — the check itself says whether a cap reaches this one.',
  },
  DESIGN_OUTSIDE_CODE_ENVELOPE: {
    kind: 'choice',
    tool: 'set_formwork_settings',
    field: 'pressureStandard',
    note: 'A design past its code’s bounds is unsupported rather than wrong, and the honest answer is a standard validated over this job — not a slump or a rate of rise edited until the gate stops firing. Those two are facts about the concrete and the placing, and writing them to pass a check produces a certified-looking number for a pour nobody is doing.',
  },
  OPENING_LEAVES_TIE_GAP: {
    kind: 'none',
    note: 'The frames arrive drilled, so there is no tie to add: strut the two forms across the box-out, or back them with a strongback spanning the opening. Both are erection details, and neither is a field any write here sets.',
  },
  CORNER_UNITS_OVERLAP: {
    kind: 'none',
    note: 'Two units cannot occupy one stretch of face. Notch one back or form the return as a single bespoke box — both decisions about hardware, and the return is only short because the wall is the length it is.',
  },
  OPENING_INSIDE_CORNER_UNIT: {
    kind: 'none',
    note: 'A corner unit arrives framed, so the box-out is cut into the unit — a modification to plant rather than a panel joint to move — or the corner is built bespoke in timber. Moving the opening is the third answer and it is an architectural change.',
  },
  SET_COUNT_SHORTAGE: {
    kind: 'choice',
    tool: 'set_pour_date',
    field: 'pourAt',
    note: 'Moving one of the overlapping pours out of the overlap is the answer that costs nothing, and the takeoff’s resequence has already worked out which pour and how many days — take the date from there rather than picking one. The other answer is acquiring the difference, which is a purchase and not a write: recording it in the yard’s rack before it is bought reports plant the job does not have.',
  },
  GANG_WEIGHT_OVER_CRANE_CAPACITY: {
    kind: 'none',
    note: 'relayoutForCrane already computes the answer — the face split at a joint every course shares, so each gang is inside the chart — and no write here applies a layout. This is the finding whose fix is a different drawing rather than a different figure. A bigger crane is the alternative, and it is a site decision.',
  },
  GANG_HEADROOM_OVER_HOOK_HEIGHT: {
    kind: 'choice',
    tool: 'set_formwork_settings',
    field: 'crane',
    note: 'A hook height is a fact about the crane on the site, so this is a write only where the recorded figure is wrong. Where it is right, the gang is picked with shorter slings or split — both rigging and layout decisions, and neither a call.',
  },
  POUR_RATE_OVER_CONCRETE_SUPPLY: {
    kind: 'choice',
    tool: 'set_formwork_settings',
    field: 'riseRateMH',
    note: 'Two answers and both are calls somebody makes off the software: state the rate the concrete actually supports, or raise the supply — more plant, or a bigger pump. Writing the slower rate is the honest design, because the pressure this form is built for is a pressure this pour never develops; it is offered rather than applied because a rate is a project setting and re-designs every shutter in the scene.',
  },
  PANEL_PRESSURE_OVER_RATING: {
    kind: 'choice',
    tool: 'set_formwork_settings',
    field: 'riseRateMH',
    note: 'Pour slower, warm the mix, or stiffen the consistency — the frame is rated what it is rated and no arrangement of it carries more. Only the rate is a call, and it is a project setting, so it re-designs every shutter in the scene. The finding carries the rate that clears this one where its code inverts.',
  },
  TIES_THROUGH_REBAR: {
    kind: 'none',
    note: 'The cage is the engineer’s, and no write here moves a bar. The tie can move within the grid where the finding says one is clear; where it cannot, the answer is a different bar arrangement, a different tie grid, or a different system — all design decisions, and a fixed grid with no clear position is the proof that one of them has to change.',
  },
  PROPS_ONTO_SLAB_BELOW: {
    kind: 'none',
    note: 'The capacity is a property of the slab below, and no write here strengthens it. Where backpropping is possible the finding names the storeys the load must be carried through; otherwise the prop grid tightens, the slab is poured in stages, or a stiffer falsework stage is chosen — all design decisions the report cannot apply for the reader.',
  },
  FORMWORK_OUTSIDE_BOUNDARY: {
    kind: 'none',
    note: 'The boundary is a fact of the site and no write here moves it. The formwork has to stay inside it — the element moves, the scaffold is set differently, or the boundary is wrong as recorded — and each of those is a decision about the world rather than a call this feature makes.',
  },
}

/**
 * What clears this finding, or why nothing here does.
 *
 * The finding's own remedy wins where it has one, because it was built by the
 * check that held the numbers. Everything else falls to the invariant's default,
 * which is why a caller never has to know which of the two produced the answer.
 */
export function formworkRemedy(finding: Finding): FormworkRemedy {
  return finding.remedy ?? (REMEDIES[finding.invariant] as FormworkRemedy)
}

/**
 * A name for one defect, stable across two runs of the suite.
 *
 * Needed because applying a fix is two validations: a caller names a finding,
 * applies the write, and then has to ask whether *that* defect is gone. Comparing
 * reports by index would be wrong the moment the fix cleared an earlier finding, and
 * comparing by invariant alone would call a wall fixed because a different wall's
 * finding of the same kind survived.
 *
 * The invariant and the elements, and deliberately **not** the locus or the message.
 * Both of those carry figures, and the figures move when a fix half-works: a joint
 * that shifted from 4.00 m to 2.67 m and still crosses the opening is the same defect
 * unfixed, and a key holding the elevation would report it cleared — the exact wrong
 * answer, since the whole reason to re-validate is to catch that.
 *
 * So two off-elevation joints on one wall share a key. That is not a collision to
 * work around, it is the granularity the remedy already has: one cap governs every
 * joint on the element, so the fix for either is the same call, and "did it clear" is
 * properly a question about the element rather than about one joint. Two openings on
 * one wall stay separate because each finding names its own opening.
 *
 * Element ids are sorted, because a pair-wise finding names its two in whichever
 * order the sweep reached them, and a key that changed with the iteration order
 * would be no key at all.
 */
export function findingKey(finding: Finding): string {
  return `${finding.invariant}|${[...finding.elementIds].sort().join(',')}`
}

/** The finding a caller named, or nothing where the report no longer has it. */
export function findingByKey(findings: readonly Finding[], key: string): Finding | undefined {
  return findings.find((finding) => findingKey(finding) === key)
}

/**
 * The findings a caller could clear without deciding anything, in report order.
 *
 * Separated out because it is the figure a fix loop is sized on, and because
 * "12 findings, 3 of them applicable" is a different conversation from "12
 * findings".
 */
export function mechanicallyFixable(findings: readonly Finding[]): Finding[] {
  return findings.filter((entry) => formworkRemedy(entry).kind === 'write')
}

/**
 * The remedy as one sentence — the call, then what applying it does, then the
 * rebuild where the call needs one.
 *
 * The rebuild clause is appended here rather than left to each surface because
 * every surface has to say it: a pour-limit write not followed by an attach leaves
 * the element cast in more pours than it is formed for, and a fix that quietly
 * does that is worse than the finding it cleared.
 */
export function remedySummary(finding: Finding): string {
  const remedy = formworkRemedy(finding)
  const call =
    remedy.kind === 'write'
      ? `Call ${remedy.tool}${remedy.args ? ` with ${formatArgs(remedy.args)}` : ''}.`
      : remedy.kind === 'choice'
        ? `Call ${remedy.tool}, deciding ${remedy.field} yourself.`
        : 'No write here clears this.'
  const attach = remedy.thenAttach
    ? ' Then call attach_formwork, or the element is cast in more pours than it is formed for.'
    : ''
  return `${call} ${remedy.note}${attach}`
}

function formatArgs(args: Record<string, string | number | null>): string {
  return Object.entries(args)
    .map(([key, value]) => `${key} ${value === null ? 'cleared' : value}`)
    .join(', ')
}

/**
 * The fix tool's input, as a raw shape both AI surfaces take without restating it.
 *
 * One key and nothing else, deliberately. An agent that could pass the cap as well
 * would be able to apply *its own* figure under the check's name, and the reply would
 * then report a finding cleared by an arithmetic nobody verified. The key names the
 * defect; the write comes from the check that found it.
 */
export const fixFindingInput = {
  findingKey: z
    .string()
    .min(1)
    .describe('the key from a validate_formwork finding — not a message and not an element id'),
}

/** The description every surface's fix carries. */
export const FIX_FORMWORK_FINDING_DESCRIPTION =
  'Apply the fix for one validate_formwork finding, then re-run the whole check and report whether that finding actually cleared. Pass the finding key from a validate_formwork reply — call it first, and take the key from the finding you mean rather than constructing one. Only findings whose fixable flag is true can be applied here: the rest either need a decision that is not yours to make (the refusal names the field and the tool) or cannot be fixed by any write this feature has, and for those you tell the user what would have to change instead. Do not pass a cap or any other value — the check computed and verified the arguments when it found the defect, and a figure of your own applied under its name is how a joint ends up somewhere the plan does not put it. The reply is the honest outcome and not a success flag: read cleared, and read raised, because a fix that clears one error and raises two is worth saying so before you move on. It rebuilds the shutters the new split needs, so no attach_formwork call is required afterwards.'
