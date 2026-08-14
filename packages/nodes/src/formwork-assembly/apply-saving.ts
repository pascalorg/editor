import {
  type FormworkSavings,
  moveKey,
  noSuchSaving,
  type SavingClass,
  type SavingProposal,
  type SavingWrite,
  savingByKey,
  savingKey,
} from '@pascal-app/core/formwork'
import type { AnyNode } from '@pascal-app/core/schema'
import { type FormworkMovePlan, plannedMove } from './apply-move'
import type { ProjectFormwork, ProjectFormworkScope } from './solve-project'
import { formworkValueOptions } from './value-engineer'

/**
 * The cheaper way to form the same building, offered and then measured.
 *
 * `compare_formwork_systems` says the job could be built in another system and prices the
 * difference; `resequence` says a pour could move and re-sweeps the peak. Both are reads — a
 * reader who agreed had nowhere to go but the element inspector. This is the third instance of
 * the keyed-proposal shape, and it is the one that prices the decision: a saving is a
 * substitution or a move reported in money, keyed by the decision and never by the money, taken
 * whole by key, and judged by a second solve rather than by its own claim.
 *
 * ## Why the classes are what they are, and why three of the five say nothing
 *
 * The spec names five classes. Two of them are derived here from data the solution already
 * carries: substitution comes off `compare_formwork_systems`' own options (the same whole-scope
 * re-solve, so the money is the same cost model the printed total uses), and cycle comes off the
 * resequencer's own moves priced against the hire the acquisition records. The other three are
 * answered with a reason rather than with invented arithmetic — the distinction the spec calls
 * "nothing cheaper exists here" against "could not be evaluated, missing input". Grid relaxation
 * finds nothing because the tie spacing is either the panel system's published tie arrangement or
 * the conventional design's computed limit, and widening it past that fails the pressure check
 * the layout applies. Reuse and standardisation cannot be evaluated: a hold-period change is a
 * second sweep of the set count over per-pour quantities the solution does not carry, and
 * collapsing near-identical marks is priced off the marks themselves, which no surface exposes.
 * Each says so, and each names the input that would let it run.
 *
 * ## Why the cycle key carries the days
 *
 * The general rule is that a saving's key holds the decision and never the money — but for a
 * move the days *are* the decision, as `moveKey` already establishes: a proposal to push a pour
 * 35 days and one to push it 30 are two different acts. So the cycle key is
 * `cycle|{catalogId}|{pourId}|{days}` — a rate edit restates the same offer with new money, and
 * a re-measured shift is a different offer, superseding the first.
 *
 * ## Why nothing here mutates
 *
 * `fix-finding.ts`'s reason, and `apply-move.ts`'s: the panel writes through the store inside
 * one history step, the chat tools mutate a plain graph on the server, MCP goes through its
 * bridge. What is shared is the decision — the writes — and the verdict, which are the two parts
 * that must not diverge between a button and a tool call.
 *
 * ## Why taking a saving never commits anything
 *
 * The spec's rule, and the same division `apply-move.ts` draws: accepting a saving records a
 * design decision. Nothing is marked committed, hired or ordered by it, and the commitment to a
 * supplier remains a separate act.
 */

/** How the AI surfaces describe the read, in one place. */
export const FORMWORK_SAVINGS_DESCRIPTION =
  "Name the cheaper way to form this scope: each saving is a substitution or a move reported in money, priced from the same cost model as the printed total, and keyed by the decision it proposes rather than by the money. A class that produced no saving says whether nothing cheaper exists or it could not be evaluated for a named missing input, and no total of claimed savings is offered — proposals are mutually exclusive. Taking a saving is one write by its key, applies the whole change or none of it, and reports a second solve's measured saving beside the claimed one; the measurement is the answer in either direction. It is not a quotation and it commits, hires or orders nothing."

/**
 * The whole read: every saving this scope admits, and each class's answer.
 *
 * `solution` is the current build, passed in rather than solved here, for
 * `formworkValueOptions`' reason: the money a proposal is compared against has to be the money
 * the reader is already looking at.
 */
export function formworkSavings(
  nodes: Record<string, AnyNode>,
  scope: ProjectFormworkScope,
  solution: ProjectFormwork,
): FormworkSavings {
  const classes: FormworkSavings['classes'] = {
    substitution: substitutionClass(nodes, scope, solution),
    cycle: cycleClass(solution),
    reuse: refusedClass('reuse'),
    'grid-relaxation': refusedClass('grid-relaxation'),
    standardisation: refusedClass('standardisation'),
  }
  return {
    ...(solution.cost?.currency === undefined ? {} : { currency: solution.cost.currency }),
    proposals: [...classes.substitution.proposals, ...classes.cycle.proposals],
    classes,
  }
}

/** The three classes with no derivable offer, each answered with the reason the spec names. */
function refusedClass(
  savingClass: 'reuse' | 'grid-relaxation' | 'standardisation',
): FormworkSavings['classes'][SavingClass] {
  if (savingClass === 'grid-relaxation') {
    return {
      proposals: [],
      refusal: {
        kind: 'nothing-cheaper',
        note: 'The tie spacing is either the panel system’s published tie arrangement or the conventional design’s computed limit, and widening it past that fails the pressure check the layout applies — so there is no relaxation to offer, at any price.',
      },
    }
  }
  if (savingClass === 'reuse') {
    return {
      proposals: [],
      refusal: {
        kind: 'missing-input',
        needs:
          'the per-pour quantities the set count was swept over — changing a hold period is a second sweep of the peak, and the solution carries the schedule but not the quantities',
      },
    }
  }
  return {
    proposals: [],
    refusal: {
      kind: 'missing-input',
      needs:
        'the per-mark geometry — collapsing near-identical panel or cut marks is priced off the marks themselves, and the solution carries the bill but not the marks',
    },
  }
}

/** The one class priced off the shipped system comparison, filtered by the spec's refusal rule. */
function substitutionClass(
  nodes: Record<string, AnyNode>,
  scope: ProjectFormworkScope,
  solution: ProjectFormwork,
): FormworkSavings['classes']['substitution'] {
  const value = formworkValueOptions(nodes, scope, solution)
  if (value.refusal === 'nothing-formed') {
    return {
      proposals: [],
      refusal: {
        kind: 'nothing-cheaper',
        note: 'There is no bill to build a second way — nothing in this scope has shutters.',
      },
    }
  }
  if (value.refusal === 'single-system-catalog') {
    return {
      proposals: [],
      refusal: {
        kind: 'nothing-cheaper',
        note: 'The catalog ships one panel system, so there is nothing to substitute this build against.',
      },
    }
  }
  if (value.refusal === 'no-alternative-forms') {
    return {
      proposals: [],
      refusal: {
        kind: 'nothing-cheaper',
        note: 'No other system in the catalog forms this scope at all, so there is nothing to substitute.',
      },
    }
  }
  const priced = value.options.filter((option) => option.cost !== undefined)
  if (priced.length === 0) {
    return {
      proposals: [],
      refusal: {
        kind: 'missing-input',
        needs:
          'the project’s rates — a substitution saving is priced off the same cost model as the printed total, and none of these options carries money without them',
      },
    }
  }
  const cheaper = priced.filter((option) => option.verdict === 'cheaper')
  if (cheaper.length === 0) {
    return {
      proposals: [],
      refusal: {
        kind: 'nothing-cheaper',
        note: 'No option is cheaper than the current build on the project’s own rates — a lighter bill is not automatically a cheaper one.',
      },
    }
  }
  // The spec's refusal rule: a substitution that fails a design check in the candidate build is
  // not offered at all, at any price — not offered with a warning, because a priced offer the
  // reader can accept is not the place to disclose non-compliance.
  const suppressed = cheaper.filter(
    (option) => option.beyondCapacity > 0 || option.incompleteElements > 0,
  )
  const offered = cheaper.filter(
    (option) => option.beyondCapacity === 0 && option.incompleteElements === 0,
  )
  if (offered.length === 0) {
    return {
      proposals: [],
      refusal: {
        kind: 'nothing-cheaper',
        note: `${suppressed.length} ${suppressed.length === 1 ? 'option is cheaper but' : 'options are cheaper but'} ${suppressed.length === 1 ? 'it fails' : 'they fail'} a design check in the candidate build — parts beyond capacity or elements left incomplete — so none is offered, at any price.`,
      },
    }
  }

  const currency = value.currency
  const current = value.currentSystemIds.join('+')
  const proposals: SavingProposal[] = offered.map((option) => {
    const saving = option.cost as NonNullable<typeof option.cost>
    const tradeOffs: SavingProposal['tradeOffs'] = []
    if (option.hours !== undefined && option.hours.delta !== 0) {
      tradeOffs.push({
        label: 'The gang’s hours',
        from: option.hours.from,
        to: option.hours.to,
        delta: option.hours.delta,
        unit: 'h',
      })
    }
    if (option.picks !== undefined && option.picks.delta !== 0) {
      tradeOffs.push({
        label: 'Picks the hook makes',
        from: option.picks.from,
        to: option.picks.to,
        delta: option.picks.delta,
        unit: 'picks',
      })
    }
    if (option.fittings.delta !== 0) {
      tradeOffs.push({
        label: 'Fittings',
        from: option.fittings.from,
        to: option.fittings.to,
        delta: option.fittings.delta,
        unit: 'fittings',
      })
    }
    if (option.shortfall !== undefined && option.shortfall.delta !== 0) {
      tradeOffs.push({
        label: 'What the job is short of',
        from: option.shortfall.from,
        to: option.shortfall.to,
        delta: option.shortfall.delta,
        unit: 'units',
      })
    }
    return {
      class: 'substitution',
      key: savingKey('substitution', current, option.systemId),
      target: current,
      alternative: option.systemId,
      description: `${option.label} forms this scope ${saving.delta < 0 ? 'cheaper' : 'dearer'} than the build in use now — a genuinely different layout, re-solved, so the fittings and the tonnage move with the money.`,
      saving: {
        label: 'Hire, recharge and consumables over this job',
        from: saving.from,
        to: saving.to,
        delta: saving.delta,
        unit: currency ?? '',
      },
      ...(currency === undefined ? {} : { currency }),
      tradeOffs,
      write: 'system',
    }
  })
  return { proposals }
}

/** The one class priced off the shipped resequencer, in money rather than in pieces. */
function cycleClass(solution: ProjectFormwork): FormworkSavings['classes']['cycle'] {
  const resequence = solution.resequence
  if (resequence === undefined) {
    return {
      proposals: [],
      refusal: {
        kind: 'missing-input',
        needs: 'a dated programme and a rack — the resequencer proposes no moves without them',
      },
    }
  }
  if (resequence.answers.length === 0) {
    return {
      proposals: [],
      refusal: {
        kind: 'nothing-cheaper',
        note: 'No item is short of its peak, so there is no hire to avoid by moving a pour.',
      },
    }
  }
  const lines = new Map((solution.acquisition?.lines ?? []).map((line) => [line.catalogId, line]))
  const currency = solution.cost?.currency
  const proposals: SavingProposal[] = []
  let sawClearable = false
  for (const answer of resequence.answers) {
    const hireCost = lines.get(answer.catalogId)?.hireCost
    for (const move of answer.moves) {
      // Only a move that clears the shortage claims the whole hire it avoids. A move that only
      // reduces the peak avoids part of a hire that the acquisition priced whole, and a partial
      // saving this model cannot derive is not claimed.
      if (!move.clearsShortage) continue
      sawClearable = true
      if (hireCost === undefined) continue
      proposals.push({
        class: 'cycle',
        key: savingKey('cycle', answer.catalogId, `${move.pourId}|${move.days}`),
        target: answer.catalogId,
        alternative: `${move.pourId}|${move.days}`,
        description: `Moving ${move.pourId} ${Math.abs(move.days)} d ${move.days < 0 ? 'earlier' : 'later'} clears the ${answer.description} shortage, so the ${answer.ownedQuantity}-strong rack is enough and the hire of the shortfall is never placed.`,
        saving: {
          label: 'Hire of the shortfall avoided',
          from: hireCost,
          to: 0,
          delta: -hireCost,
          unit: currency ?? '',
        },
        ...(currency === undefined ? {} : { currency }),
        tradeOffs: [
          {
            label: 'Days the pour moves',
            from: 0,
            to: move.days,
            delta: move.days,
            unit: 'd',
          },
          ...move.raises.map((rise) => ({
            label: `${rise.description} short`,
            from: rise.from,
            to: rise.to,
            delta: rise.to - rise.from,
            unit: 'units',
          })),
        ],
        write: 'pour-move',
      })
    }
  }
  if (proposals.length === 0) {
    if (!sawClearable) {
      return {
        proposals: [],
        refusal: {
          kind: 'nothing-cheaper',
          note: 'No move clears a shortage outright, so none avoids the shortfall’s hire cost — the moves that only reduce a peak are not claimed as savings.',
        },
      }
    }
    return {
      proposals: [],
      refusal: {
        kind: 'missing-input',
        needs:
          'the hire rates — a cycle saving is priced off the hire it avoids, and no short item here carries one',
      },
    }
  }
  return { proposals }
}

/** The writes that would take proposal `key`, or the reason there are none. */
export interface FormworkSavingPlan {
  key: string
  class: SavingClass
  description: string
  /** The claimed saving, kept so the outcome has something to disagree with. */
  predicted?: { amount: number; currency?: string }
  /** The write that takes it, as the surfaces name it. */
  write: SavingWrite
  /** Per-assembly system writes — the substitution's whole change. */
  writes?: Array<{ assemblyId: string; systemId: string }>
  /** The item a cycle is measured on. */
  catalogId?: string
  /** The underlying move plan, for a cycle — applied as any move is applied. */
  movePlan?: FormworkMovePlan
  /** Why this cannot be applied. Absent where it can. */
  refusal?: string
}

/**
 * The write that would take `key`, or the reason there is none.
 *
 * Takes the read and the solution: the read names the proposal and its class, the solution
 * supplies what the write needs — the shutters in scope for a substitution, the programme for a
 * move. A key the read no longer carries is refused as superseded rather than reported as a
 * missing record.
 */
export function plannedSaving(
  savings: FormworkSavings,
  solution: ProjectFormwork,
  key: string,
): FormworkSavingPlan {
  const proposal = savingByKey(savings, key)
  if (proposal === undefined) {
    // `write` is nominal here: nothing is applied, so the refusal is the whole answer.
    return {
      key,
      class: 'substitution',
      description: '',
      write: 'system',
      refusal: noSuchSaving(key),
    }
  }

  const base = {
    key,
    class: proposal.class,
    description: proposal.description,
    write: proposal.write,
  }

  if (proposal.class === 'substitution') {
    const saving = proposal.saving
    if (saving === undefined) {
      return {
        ...base,
        refusal:
          'This substitution carries no money, so there is nothing to measure against — record rates and read the takeoff again.',
      }
    }
    const assemblyIds = solution.elements.flatMap((element) =>
      element.shutters.map((shutter) => shutter.assembly.id as string),
    )
    return {
      ...base,
      predicted: {
        amount: -saving.delta,
        ...(savings.currency === undefined ? {} : { currency: savings.currency }),
      },
      writes: assemblyIds.map((assemblyId) => ({ assemblyId, systemId: proposal.alternative })),
    }
  }

  // Cycle: the underlying move, planned through the move's own plan so the two surfaces of the
  // same decision cannot disagree about the dates.
  const [pourId, daysText] = proposal.alternative.split('|')
  const days = Number(daysText)
  const answer = solution.resequence?.answers.find((entry) => entry.catalogId === proposal.target)
  const move = answer?.moves.find((entry) => entry.pourId === pourId && entry.days === days)
  if (answer === undefined || move === undefined) {
    return { ...base, refusal: noSuchSaving(key) }
  }
  const hireCost = solution.acquisition?.lines.find(
    (entry) => entry.catalogId === proposal.target,
  )?.hireCost
  if (hireCost === undefined) {
    return {
      ...base,
      refusal: `The hire this move avoids is no longer priced on ${proposal.target} — record a hire rate and read the takeoff again.`,
    }
  }
  const movePlan = plannedMove(solution, moveKey(answer.catalogId, move))
  return {
    ...base,
    predicted: {
      amount: hireCost,
      ...(savings.currency === undefined ? {} : { currency: savings.currency }),
    },
    catalogId: proposal.target,
    movePlan,
    ...(movePlan.refusal ? { refusal: movePlan.refusal } : {}),
  }
}

/** What a taken saving actually achieved, from the two solves rather than from the claim. */
export interface FormworkSavingOutcome {
  /** True where the measured saving is at least the predicted one. */
  achieved: boolean
  predicted?: { amount: number; currency?: string }
  measured?: { amount: number; currency?: string }
  /** Where the second derivation could not produce a figure. */
  unmeasured?: string
  /** What to tell the user, in one sentence. */
  message: string
}

/**
 * Whether the saving `key` named actually landed, and what it measured.
 *
 * Takes the two solutions rather than the proposal's arithmetic, for `moveOutcome`'s reason:
 * each caller re-solves through the path it already uses, and a verdict read off the prediction
 * that proposed the saving would only ever agree with itself.
 *
 * The disagreement between predicted and measured is reported whichever way it falls. A saving
 * that over-delivered is the same fault as one that under-delivered — both mean the sweep was
 * wrong — and printing whichever reads better would be choosing which sweep to believe on how it
 * sounds. A saving whose re-derivation fails is unmeasured, never "confirmed at the predicted
 * figure".
 */
export function savingOutcome(
  before: ProjectFormwork,
  after: ProjectFormwork,
  plan: FormworkSavingPlan,
): FormworkSavingOutcome {
  const predicted = plan.predicted?.amount ?? 0

  if (plan.class === 'substitution') {
    const beforeTotal = before.cost?.totalCost
    const afterTotal = after.cost?.totalCost
    if (beforeTotal === undefined || afterTotal === undefined) {
      return unmeasured(
        plan,
        'the second solve produced no total — the rates are gone or the scope changed',
      )
    }
    return outcomeOf(plan, predicted, beforeTotal - afterTotal)
  }

  // Cycle: the hire the move avoided, read off the acquisition's own lines in both solves.
  const beforeLine = before.acquisition?.lines.find((line) => line.catalogId === plan.catalogId)
  const afterLine = after.acquisition?.lines.find((line) => line.catalogId === plan.catalogId)
  const beforeHire = beforeLine?.hireCost
  // A line whose shortage the move cleared is still a line — the item is still a peak, it just
  // has nothing to hire — and the acquisition emits no hireCost against it. That zero is the
  // measurement, the hire that was never placed. Only a line that is still short and unpriced,
  // or a line gone from the acquisition entirely, is unmeasurable.
  const afterHire =
    afterLine === undefined ? undefined : afterLine.shortfall === 0 ? 0 : afterLine.hireCost
  if (beforeHire === undefined || afterHire === undefined) {
    return unmeasured(
      plan,
      'the written programme carries no hire for the item — the acquisition is gone or the shortage was never priced',
    )
  }
  return outcomeOf(plan, predicted, beforeHire - afterHire)
}

function unmeasured(plan: FormworkSavingPlan, why: string): FormworkSavingOutcome {
  return {
    achieved: false,
    predicted: plan.predicted,
    unmeasured: why,
    message: `The change was applied, but nothing could be measured: ${why}, so the saving is unmeasured rather than confirmed at the predicted figure. Read the takeoff rather than quoting the claim.`,
  }
}

function outcomeOf(
  plan: FormworkSavingPlan,
  predicted: number,
  measured: number,
): FormworkSavingOutcome {
  const currency = plan.predicted?.currency
  const money = (amount: number) =>
    `${currency === undefined ? '' : `${currency} `}${amount.toFixed(0)}`
  const achieved = measured >= predicted - 1e-9
  const asClaimed = Math.abs(measured - predicted) < 1e-9
  const head = achieved ? 'The saving was achieved' : 'The saving fell short of its claim'
  const comparison = asClaimed
    ? ` measured ${money(measured)}, as claimed`
    : ` measured ${money(measured)} against the claimed ${money(predicted)} — the measurement is the answer, in either direction, because the proposal was priced on a solve and this is priced on the scene`
  return {
    achieved,
    predicted: plan.predicted,
    measured: { amount: measured, ...(currency === undefined ? {} : { currency }) },
    message: `${head}:${comparison}.`,
  }
}

/** The proposal shape the surfaces render, carrying its own key so a reply can be given it back. */
export interface KeyedSaving extends SavingProposal {
  currency?: string
}

export function keyedSavings(savings: FormworkSavings): KeyedSaving[] {
  return savings.proposals.map((proposal) => ({
    ...proposal,
    ...(savings.currency === undefined ? {} : { currency: savings.currency }),
  }))
}
