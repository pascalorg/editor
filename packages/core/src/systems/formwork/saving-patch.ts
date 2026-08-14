import { z } from 'zod'

/**
 * Naming a cheaper way to form the same building, so a reader can come back and take it.
 *
 * The fourth keyed proposal in this feature, and the second that changes what the shutters
 * are made of or when they stand. `fix-finding.ts` proposes a repair to a defect, `resequence`
 * proposes a date, `compare_formwork_systems` proposes a system and is answered against a job
 * with nothing wrong with it at all — and none of the three could be *taken* for its money.
 * This is the shape that says a saving, prices it from the same cost model as the printed
 * total, and lets the reader take it whole and then have it measured.
 *
 * ## Why the key holds the decision and never the money
 *
 * The opposite of `moveKey` and the same as `findingKey`. For a resequencing the figure is the
 * decision — a 35-day shift and a 30-day shift are two different moves, so the days belong in
 * the key. For a saving the money is a *consequence* of the decision: substituting grade A for
 * grade B is the same offer whether it saves £400 or £380 after a rate edit. So a rate change
 * must not invalidate the key, and a design change that removes the substitution must — the
 * key outlives its own arithmetic only while the decision it names is still on the table.
 *
 * ## Why the target and alternative are what they are
 *
 * `${class}|${target}|${alternative}`. For a substitution the target is the build in use now
 * (the systems the scope is actually formed in, joined) and the alternative is the candidate
 * system; for a cycle the target is the short item and the alternative is the pour that moves.
 * Both halves are stable against rate edits and both change when the scene does, which is the
 * whole contract of the key.
 *
 * ## Why there is no total
 *
 * Savings are not additive — a substitution and a cycle can be the same decision from two
 * directions, and two substitutions are alternatives, not a stack — so no total of claimed
 * savings is ever presented, and each proposal's mutual exclusivity is stated beside it. A
 * reader will add the column otherwise, and the sum is a number nothing will ever deliver.
 */

/** The five saving classes the value-engineering spec names. */
export type SavingClass = 'substitution' | 'cycle' | 'reuse' | 'grid-relaxation' | 'standardisation'

export const SAVING_CLASSES: readonly SavingClass[] = [
  'substitution',
  'cycle',
  'reuse',
  'grid-relaxation',
  'standardisation',
]

export const SAVING_CLASS_LABELS: Record<SavingClass, string> = {
  substitution: 'Substitution',
  cycle: 'Cycle',
  reuse: 'Reuse',
  'grid-relaxation': 'Grid relaxation',
  standardisation: 'Standardisation',
}

/** Why a class offers no proposal — the two states a reader has to be able to tell apart. */
export type SavingClassRefusal =
  /** The analysis ran and found nothing cheaper — no offer, at any price. */
  | { kind: 'nothing-cheaper'; note: string }
  /** The class could not be evaluated, and the missing input is named. */
  | { kind: 'missing-input'; needs: string }

/** One priced axis of a proposal: what the build measures now, what it would, and the difference. */
export interface SavingAxis {
  /** The figure, in the reader's own units. */
  label: string
  from: number
  to: number
  /** `to` − `from`. Negative is the proposal doing better on this axis. */
  delta: number
  unit: string
}

/** The write that takes a proposal, as the surfaces name it. */
export type SavingWrite = 'system' | 'pour-move'

/**
 * One saving: the change, the money it claims, and what the reader gives up.
 *
 * The claimed money is `saving`, present only where the same cost model as the printed total
 * produced it — a proposal whose figure the totals cannot reproduce is never offered.
 */
export interface SavingProposal {
  class: SavingClass
  /** `${class}|${target}|${alternative}` — the decision, never the money. */
  key: string
  /** What the proposal changes. */
  target: string
  /** What it proposes instead. */
  alternative: string
  /** One sentence naming the proposal, in the words every surface uses. */
  description: string
  /** The money it claims, from the same cost model as the printed total. */
  saving?: SavingAxis
  currency?: string
  /** What the reader gives up to get it, in their own units. */
  tradeOffs: SavingAxis[]
  /** The write that takes it. */
  write: SavingWrite
}

/** One class's outcome: the proposals it found, or why it found none. */
export interface SavingClassOutcome {
  proposals: SavingProposal[]
  refusal?: SavingClassRefusal
}

/** The whole read: every proposal flat, and each class's outcome for the "why nothing" question. */
export interface FormworkSavings {
  currency?: string
  proposals: SavingProposal[]
  classes: Record<SavingClass, SavingClassOutcome>
}

/** The handle for one proposal: the class, the target, the alternative. No figures. */
export function savingKey(savingClass: SavingClass, target: string, alternative: string): string {
  return `${savingClass}|${target}|${alternative}`
}

/** The proposal a key names, or nothing. */
export function savingByKey(savings: FormworkSavings, key: string): SavingProposal | undefined {
  return savings.proposals.find((proposal) => proposal.key === key)
}

/**
 * The refusal for a key the current read does not carry.
 *
 * Its own sentence, and it names the likeliest cause rather than reporting a missing record:
 * the proposal was real when it was read and the scene has moved since — the system changed,
 * the pour was re-dated, or a rate edit removed the money the offer was priced on. So the key
 * is superseded, not invalid, and the reader re-reads the takeoff. Shared, so all three
 * surfaces say it once.
 */
export function noSuchSaving(key: string): string {
  return `Error: no current saving proposal keyed ${key}. That is usually a proposal that has been superseded rather than a bad key: a saving's key is the decision it proposes, and the decision no longer exists when the scene has moved on — the system changed, the pour was re-dated, or a rate edit removed the money the offer was priced on. Read the takeoff again and take a key from the savings in that reply.`
}

/**
 * The whole write, as a tool's input shape.
 *
 * One field, for `applyPourMovePatch`'s reason: everything else about the saving — the class,
 * the target, the alternative, the writes — comes off the proposal, and a tool that also took
 * a value would let a caller apply its own figure under the proposal's name.
 */
export const applySavingInput = {
  savingKey: z
    .string()
    .min(1)
    .describe(
      "the saving to take, from the takeoff's value-engineering proposals — not composed by hand. Read the proposals in the same call you apply from: a key from an earlier reply may name a decision the scene no longer carries",
    ),
}

export const ApplySavingPatch = z.object(applySavingInput)
export type ApplySavingPatch = z.infer<typeof ApplySavingPatch>

export const APPLY_SAVING_DESCRIPTION =
  "Take one saving proposal: apply the whole change it names, re-solve, and report the saving a second solve actually measured beside the one the proposal claimed. This is the write that closes the loop the value-engineering read opens — it says the same building can be formed cheaper, and until this was called the reader had to make the change by hand and re-read the takeoff. Pass the key from a proposal in that reply and nothing else: the class, the target, the alternative and the writes are all the engine's, and a call that also took a value would apply your figure under the proposal's name. Two things to carry back from the answer rather than assuming them. It reports the measured saving against the predicted one, and the measurement is the answer in either direction — a saving that over-delivered is the same fault as one that under-delivered, because both mean the sweep that proposed it was wrong. And it applies the whole proposal or none of it: a substitution spans every shutter in scope and a cycle spans the whole pour, and a partial application prices as neither the old design nor the new one. A key from an earlier read is refused rather than applied, because the decision it names may no longer exist — re-read the takeoff first. Taking a saving records a design decision and nothing else: nothing is committed, hired or ordered by it, and the commitment to a supplier remains a separate act."

/**
 * What a savings read has to say beyond the proposals themselves.
 *
 * The first two are printed whenever there is any proposal at all, and they are the two things
 * a reader will otherwise assume: that the claimed savings add up, and that a class that
 * produced nothing means the job is already as cheap as it gets.
 */
export function savingCaveats(savings: FormworkSavings): string[] {
  const out: string[] = []
  if (savings.proposals.length === 0) return out

  out.push(
    'These savings do not add up, and no total of them is offered. Proposals are mutually exclusive — two substitutions are alternatives and a substitution and a cycle can be the same decision from two directions — so each one is the whole of its offer rather than a line in a sum.',
  )
  const missing = SAVING_CLASSES.filter(
    (savingClass) => savings.classes[savingClass]?.refusal?.kind === 'missing-input',
  )
  if (missing.length > 0) {
    const named = missing.map((savingClass) => {
      const outcome = savings.classes[savingClass]
      const needs = outcome?.refusal?.kind === 'missing-input' ? outcome.refusal.needs : ''
      return `${SAVING_CLASS_LABELS[savingClass]} — ${needs}`
    })
    out.push(
      `${missing.length} ${missing.length === 1 ? 'class could' : 'classes could'} not be evaluated, each for its own missing input: ${named.join('; ')}. Nothing here is claimed as cheaper than it is — a class that could not run is said so, not passed over.`,
    )
  }
  return out
}
