import {
  DEFAULT_FORMWORK_SYSTEM_ID,
  FORMWORK_SYSTEMS,
  type FormworkSystem,
} from '@pascal-app/core/formwork'
import type { AnyNode } from '@pascal-app/core/schema'
import type { FormworkAssemblyNode } from './schema'
import {
  type ProjectFormwork,
  type ProjectFormworkScope,
  solveProjectFormwork,
} from './solve-project'

/**
 * Would another system build this job cheaper — and the honest form of that question is
 * *cheaper by what*.
 *
 * The third proposal in this feature, and the first that changes what the shutters are made
 * of rather than when they stand. `fix-finding.ts` proposes a repair to a defect;
 * `resequence.ts` proposes a date. Both are answers to something the model has already called
 * wrong. This one is answered against a job with nothing wrong with it at all, which is what
 * makes it value engineering rather than validation, and what makes it the easiest of the three
 * to state dishonestly: every figure it moves is a figure somebody quotes.
 *
 * ## Why a whole re-solve, and why nothing is converted
 *
 * A system is not a price list applied to a layout. Framax's widths are a 15 cm grid and TRIO's
 * are six discrete sizes; their tie holes are at different heights, their permissible pressures
 * differ, their corners fit different wall thicknesses. So the same wall gets a *different
 * layout* — a different panel count, different fillers, different ties, a different weight and
 * a different number of picks. Converting the current bill into the other system's part numbers
 * would produce a quantity that no layout ever placed.
 *
 * So the candidate is written onto a copy of the scene and the whole project is solved again,
 * exactly as `resequence.ts` re-sweeps a copy of the programme rather than adjusting the peak.
 * The reported figures are the ones a second solve actually measured, including the ones that
 * move the wrong way.
 *
 * ## Why the substitution is uniform, and what that costs a project that mixes
 *
 * `systemId` is a field on the assembly, so a job can genuinely form one wall in TRIO and the
 * next in Framax. A candidate here overwrites it on every shutter in scope, which is a stronger
 * change than the one the reader may have in mind: the option answers "build all of this in one
 * system" rather than "swap this wall". That is deliberate — the reason to standardise is that
 * one system on site is one delivery, one rack, one set of couplers and one thing for the gang
 * to learn — but a project already mixing two on purpose is being offered something it has
 * already decided against, so the systems currently in use are reported beside the options and
 * the caveats say what the substitution did.
 *
 * ## Why there is no cost per m² per use here
 *
 * That is the figure the plan names, and it cannot be produced from this model without inventing
 * its denominator. A cost per use needs an expected life — 300 uses on a steel frame, 30 on its
 * formlining — and nothing in the catalog carries one that came from a manufacturer rather than
 * from a plausible-sounding band. `cost.ts` refuses to produce untraceable money and this
 * refuses to produce an untraceable divisor. What is here instead is what the project itself
 * stated: the hire and recharge over the days the plant is genuinely held, the gang's hours
 * against its own norms, and the picks and the loads. A yard that wants a per-use figure has to
 * record what it paid and how long it expects the panel to last, and neither is a fact this
 * model can supply on its behalf.
 *
 * ## Why an unpriced project still gets options
 *
 * Because most of what a system change moves is not money. A lighter bill is fewer lorries, a
 * different panel grid is a different number of picks, and a smaller peak is a shortage that
 * does not have to be hired at all — and every one of those is countable with no rate recorded
 * anywhere. So the physical deltas are always reported and the verdict says the money is
 * missing, rather than the whole comparison going quiet the way `cost` does.
 *
 * ## This is not a quotation
 *
 * There is no availability in it, no delivery lead time, no hire desk's minimum quantity, no
 * discount for the yard's standing account and no gang that already knows one of the two
 * systems. Any of those can reverse the answer. It says which system this job's own recorded
 * figures favour, which is an argument to take to the desk rather than a decision.
 */

/**
 * How both AI surfaces describe this, in one place, so the chat and MCP promise the same thing.
 *
 * The last sentence is the one that earns its length: an agent handed a "cheaper" verdict with no
 * warning will apply it, and applying it changes the panel system of every wall in scope.
 */
export const FORMWORK_VALUE_DESCRIPTION =
  'Weigh this job against the other panel systems in the catalog. Each option is the whole scope re-solved in that system — a genuinely different layout, so the panel count, the fittings, the tonnage, the picks and any shortage all move — reported as a difference from the build in use now, with money where the project has rates and hours where it has output norms. Read it before quoting a takeoff nobody has costed a second way. It is not a quotation: there is no availability, lead time, minimum hire quantity or account discount in it. Taking an option is one write, set_formwork_settings parts.systemId, and it changes the system for every shutter that has not named its own.'

/** Why a scope has no system options to weigh. */
export type ValueRefusal =
  /** Nothing in scope is formed, so there is no bill to build a second way. */
  | 'nothing-formed'
  /** One system in the catalog, so there is nothing to compare the current one against. */
  | 'single-system-catalog'
  /** Every alternative solved to nothing — a scope whose walls no other system can form. */
  | 'no-alternative-forms'

export const VALUE_REFUSAL_LABELS: Record<ValueRefusal, string> = {
  'nothing-formed':
    'Nothing in this scope has shutters, so there is no bill to build a second way — generate the formwork first',
  'single-system-catalog':
    'The catalog ships one panel system, so there is no alternative to weigh this job against',
  'no-alternative-forms':
    'No other system in the catalog forms this scope at all — the panels or the corners do not fit these walls, and the current system is the only one that lays out',
}

/** Why one axis of a comparison carries no figure. */
export type ValueGap =
  /** No rates recorded, so neither build has a price. */
  | 'no-rates'
  /** No output norms recorded, so neither build has hours. */
  | 'no-norms'
  /** No payload or cycle time recorded, so neither build has loads or hook time. */
  | 'no-logistics'
  /** Nothing is dated, or no rack is recorded, so neither build has a shortage. */
  | 'no-shortfall'
  /** A weight is missing from one of the two bills, so the tonnage delta is a floor. */
  | 'incomplete-weight'

export const VALUE_GAP_LABELS: Record<ValueGap, string> = {
  'no-rates': 'No rates recorded, so neither build is priced',
  'no-norms': 'No output norms recorded, so neither build has the gang’s hours',
  'no-logistics':
    'No lorry payload or pick cycle recorded, so neither build has transport or hook time',
  'no-shortfall':
    'No shortage to compare: either the pours are not dated or the yard’s stock is not recorded',
  'incomplete-weight':
    'A part in one of the two bills has no published weight, so the tonnage delta is a floor',
}

/** One axis: what the current build measures, what the candidate measures, and the difference. */
export interface ValueDelta {
  /** The figure for the system in use now. */
  from: number
  /** The same figure after the substitution. */
  to: number
  /** `to` − `from`. Negative is the candidate doing better on every axis here. */
  delta: number
}

function deltaOf(from: number | undefined, to: number | undefined): ValueDelta | undefined {
  if (from === undefined || to === undefined) return undefined
  return { from, to, delta: to - from }
}

/**
 * Which build the recorded figures favour.
 *
 * Off the money alone where there is money, because that is the axis a reader is asking about
 * and folding hours into it would be a total nobody agreed the weights of. Where there is no
 * money the verdict says so rather than being taken off the tonnage — a lighter bill is not
 * automatically a cheaper one, and a panel system's economy is in its tie spacing rather than
 * in its steel.
 */
export type ValueVerdict =
  /** Cheaper over this scope's own recorded rates, by more than a twentieth. */
  | 'cheaper'
  /** Dearer over the same rates. */
  | 'dearer'
  /** Within a twentieth either way — too close for this model to call. */
  | 'level'
  /** Nothing is priced, so the physical deltas are the whole answer. */
  | 'not-priced'

export const VALUE_VERDICT_LABELS: Record<ValueVerdict, string> = {
  cheaper: 'Cheaper to hold over this job, on the project’s own rates',
  dearer: 'Dearer to hold over this job, on the project’s own rates',
  level: 'Within a twentieth of the current system — no call either way',
  'not-priced': 'No rates recorded, so this is a comparison of quantities rather than of money',
}

/** The band inside which this model will not call a money difference either way. */
const LEVEL_BAND = 0.05

/** One alternative system, solved, and what changed. */
export interface ValueOption {
  /**
   * How every surface names this option.
   *
   * The candidate id and nothing else, unlike `moveKey` — there is no figure in it to be
   * superseded. A system substitution is not measured against anything that can move
   * underneath it, so a key that still resolves is still the same proposal, and the
   * measurement is taken again anyway by whoever applies it.
   */
  key: string
  systemId: string
  label: string
  /** Money over this job, where the project has rates. */
  cost?: ValueDelta
  /** The gang's man-hours, where the project has norms. */
  hours?: ValueDelta
  /** Picks the hook makes. */
  picks?: ValueDelta
  /** Lorry loads both ways, where a payload is recorded. */
  loads?: ValueDelta
  /** The bill's tonnage — the one axis that needs no commercial input at all. */
  weightKg: ValueDelta
  /** Parts in the bill, as a count of fittings rather than of line items. */
  fittings: ValueDelta
  /** What the yard would have to acquire, where there is a peak and a rack to compare. */
  shortfall?: ValueDelta
  /** Parts working beyond capacity in the candidate build — a cheaper bill that does not stand. */
  beyondCapacity: number
  /** Elements the candidate forms for fewer pours than they are cast in. */
  incompleteElements: number
  verdict: ValueVerdict
  gaps: ValueGap[]
}

export interface FormworkValueEngineering {
  currency?: string
  /** The systems the scope is formed in now — more than one where the job mixes. */
  currentSystemIds: string[]
  /** Every alternative that forms the scope, best money first. Empty on a refusal. */
  options: ValueOption[]
  /** Options cheaper than the current build, which is the list worth reading. */
  cheaper: ValueOption[]
  /** Present where no option is offered. */
  refusal?: ValueRefusal
}

/** The systems the scope's shutters were actually laid out in. */
function systemsInUse(solution: ProjectFormwork): string[] {
  const ids = new Set<string>()
  for (const element of solution.elements) {
    for (const shutter of element.shutters) {
      const system: FormworkSystem | undefined = shutter.evidence.system
      ids.add(system?.id ?? shutter.assembly.systemId ?? DEFAULT_FORMWORK_SYSTEM_ID)
    }
  }
  return [...ids].sort()
}

/**
 * The scene with one system written onto every shutter in scope.
 *
 * Onto the assemblies rather than into the settings node, and that is what makes the
 * substitution total: a project that named TRIO on one wall would keep it through a settings
 * change, and the option would silently be a comparison of one system against a mixture. The
 * settings node is left alone for the same reason — nothing here writes the scene, so a copy
 * that also moved the project default would be a second difference the caller did not ask for.
 */
function nodesWithSystem(
  nodes: Record<string, AnyNode>,
  assemblyIds: readonly string[],
  systemId: string,
): Record<string, AnyNode> {
  const copy = { ...nodes }
  for (const id of assemblyIds) {
    const assembly = copy[id] as unknown as FormworkAssemblyNode | undefined
    if (assembly === undefined) continue
    copy[id] = { ...assembly, systemId } as unknown as AnyNode
  }
  return copy
}

/**
 * What else this job could be built in, and what that would change.
 *
 * `solution` is the current build, passed in rather than solved here, for `resequence.ts`'s
 * reason: the figures an option is compared against have to be the figures the reader is
 * already looking at, and a second solve of the same scene could differ from the first the day
 * either path gains a case.
 */
export function formworkValueOptions(
  nodes: Record<string, AnyNode>,
  scope: ProjectFormworkScope,
  solution: ProjectFormwork,
): FormworkValueEngineering {
  const currentSystemIds = systemsInUse(solution)
  const base: FormworkValueEngineering = {
    ...(solution.cost?.currency === undefined ? {} : { currency: solution.cost.currency }),
    currentSystemIds,
    options: [],
    cheaper: [],
  }
  if (solution.shutterCount === 0) return { ...base, refusal: 'nothing-formed' }
  if (Object.keys(FORMWORK_SYSTEMS).length < 2) {
    return { ...base, refusal: 'single-system-catalog' }
  }

  const assemblyIds = solution.elements.flatMap((element) =>
    element.shutters.map((shutter) => shutter.assembly.id as string),
  )
  const options: ValueOption[] = []
  for (const system of Object.values(FORMWORK_SYSTEMS)) {
    // A system already in use is not an alternative to itself. On a mixed job the other half of
    // the mixture *is* an option, because standardising on it is a real change — so this
    // excludes a system only where it is the single one in use.
    if (currentSystemIds.length === 1 && currentSystemIds[0] === system.id) continue
    const candidate = solveProjectFormwork(nodesWithSystem(nodes, assemblyIds, system.id), scope)
    // A candidate that formed nothing is dropped rather than reported as a bill of zero: it
    // means the layout could not place a panel on these walls, which is a system that does not
    // fit rather than a job that got free.
    if (candidate.shutterCount === 0) continue
    options.push(optionFor(system, solution, candidate))
  }

  if (options.length === 0) return { ...base, refusal: 'no-alternative-forms' }

  // Money first where there is money, then hours, then tonnage — the same order of authority the
  // caveats state. An unpriced comparison sorts on the axes that survive rather than falling back
  // to the catalog's own order, which would read as a ranking and be an insertion order.
  options.sort(
    (a, b) =>
      (a.cost?.delta ?? 0) - (b.cost?.delta ?? 0) ||
      (a.hours?.delta ?? 0) - (b.hours?.delta ?? 0) ||
      a.weightKg.delta - b.weightKg.delta ||
      a.systemId.localeCompare(b.systemId),
  )
  return {
    ...base,
    options,
    cheaper: options.filter((option) => option.verdict === 'cheaper'),
  }
}

function optionFor(
  system: FormworkSystem,
  current: ProjectFormwork,
  candidate: ProjectFormwork,
): ValueOption {
  const gaps: ValueGap[] = []
  const cost = deltaOf(current.cost?.totalCost, candidate.cost?.totalCost)
  if (cost === undefined) gaps.push('no-rates')
  const hours = deltaOf(current.labour?.totalHours, candidate.labour?.totalHours)
  if (hours === undefined) gaps.push('no-norms')
  const picks = deltaOf(current.lifts?.pickCount, candidate.lifts?.pickCount)
  const loads = deltaOf(current.logistics?.totalLoads, candidate.logistics?.totalLoads)
  if (loads === undefined) gaps.push('no-logistics')
  const shortfall = deltaOf(
    current.acquisition?.shortfallQuantity,
    candidate.acquisition?.shortfallQuantity,
  )
  if (shortfall === undefined) gaps.push('no-shortfall')
  if (!current.totalWeightComplete || !candidate.totalWeightComplete) {
    gaps.push('incomplete-weight')
  }

  // Off `totalCost` and not off `totalCost + ownedCost`, matching what `cost.ts` calls the cost
  // to deliver the job. The recharge on the yard's own stock moves with a substitution too, and
  // including it would mean an option read as cheaper because the same business charged itself
  // less — which is not money the job saves.
  let verdict: ValueVerdict = 'not-priced'
  if (cost !== undefined && cost.from > 0) {
    const ratio = cost.delta / cost.from
    verdict = Math.abs(ratio) <= LEVEL_BAND ? 'level' : ratio < 0 ? 'cheaper' : 'dearer'
  }

  return {
    key: valueOptionKey(system.id),
    systemId: system.id,
    label: `${system.manufacturer} ${system.label}`,
    ...(cost ? { cost } : {}),
    ...(hours ? { hours } : {}),
    ...(picks ? { picks } : {}),
    ...(loads ? { loads } : {}),
    weightKg: deltaOf(current.totalWeightKg, candidate.totalWeightKg) as ValueDelta,
    fittings: deltaOf(fittings(current), fittings(candidate)) as ValueDelta,
    ...(shortfall ? { shortfall } : {}),
    beyondCapacity: candidate.beyondCapacityMarks.length,
    incompleteElements: candidate.incomplete.length,
    verdict,
    gaps,
  }
}

/** Fittings in a bill — quantities rather than line items, which is what a gang handles. */
function fittings(solution: ProjectFormwork): number {
  return solution.bom.reduce((total, line) => total + line.quantity, 0)
}

/** How every surface names one option, so a reply that printed one can be given it back. */
export function valueOptionKey(systemId: string): string {
  return `system:${systemId}`
}

/** The option a key names, or `undefined` where the catalog no longer offers it. */
export function valueOptionByKey(
  value: FormworkValueEngineering,
  key: string,
): ValueOption | undefined {
  return value.options.find((option) => option.key === key)
}

/**
 * What makes a system comparison wrong, in words.
 *
 * The last two are printed whenever there is any option at all, because they are the two things
 * a reader will otherwise assume: that the substitution is per wall, and that the cheaper column
 * is a quotation.
 */
export function valueCaveats(value: FormworkValueEngineering): string[] {
  const out: string[] = []
  if (value.refusal !== undefined) {
    out.push(`${VALUE_REFUSAL_LABELS[value.refusal]}.`)
    return out
  }
  if (value.options.length === 0) return out

  const beyond = value.options.filter((option) => option.beyondCapacity > 0)
  if (beyond.length > 0) {
    out.push(
      `${beyond.length} ${beyond.length === 1 ? 'option leaves a part' : 'options leave parts'} beyond capacity. A cheaper bill for a shutter that does not stand up is not a saving — read the validation for that option's system before quoting its figure.`,
    )
  }
  const dearerElsewhere = value.options.filter(
    (option) => option.verdict === 'cheaper' && (option.hours?.delta ?? 0) > 0,
  )
  if (dearerElsewhere.length > 0) {
    out.push(
      'An option can be cheaper to hold and dearer to fit. The money here is hire, recharge and consumables; the hours are the gang’s, priced separately, and on most jobs the larger of the two — so a saving on the plant that adds fittings is usually not a saving at all.',
    )
  }
  if (value.options.some((option) => option.verdict === 'not-priced')) {
    out.push(
      'These options carry no money, because the project has recorded no rates. What is left is countable without one — tonnage, fittings, picks and any shortage — and none of it is a price: a panel system’s economy is in how far apart its ties are rather than in how little its panels weigh.',
    )
  }
  if (value.currentSystemIds.length > 1) {
    out.push(
      `This scope is formed in ${value.currentSystemIds.length} systems (${value.currentSystemIds.join(', ')}). Each option above replaces all of them, so the comparison is against standardising rather than against the mixture — which is the change worth costing, and a larger one than it looks.`,
    )
  }
  out.push(
    'Each option is the whole scope re-solved in that system, not this bill converted into it. The panel widths, the tie holes and the corners all differ, so the layout is genuinely different — which is why the fitting count moves and why a face that laid out cleanly in one system may need a filler in the other.',
  )
  out.push(
    'Taking an option is a change to the project default: set_formwork_settings parts.systemId. Any shutter carrying its own systemId keeps it, so a job that has named a system per wall has to have those cleared as well — otherwise the bill stays mixed and none of the figures above apply.',
  )
  out.push(
    'None of this is a quotation. There is no availability, no lead time, no minimum hire quantity, no account discount and no gang that already knows one of the two systems, and any of the five can reverse the answer. It says which system this job’s own recorded figures favour.',
  )
  return out
}
