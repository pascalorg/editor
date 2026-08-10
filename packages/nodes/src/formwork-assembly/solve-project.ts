import type {
  BomCost,
  BomHire,
  BomLine,
  BomSupply,
  FormworkAcquisition,
  FormworkResequence,
  FormworkSchedule,
  FormworkSequence,
  FormworkSetCount,
  PourQuantities,
  SchedulablePour,
  SequenceablePour,
  StrikeTarget,
  StrikingTime,
} from '@pascal-app/core/formwork'
import {
  acquireCaveats,
  bomCost,
  bomCostCaveats,
  bomHire,
  bomLines,
  bomSupply,
  bomWeightKg,
  formworkAcquisition,
  formworkResequence,
  formworkSchedule,
  formworkScheduleCaveats,
  formworkSequence,
  formworkSequenceCaveats,
  formworkSetCaveats,
  formworkSetCount,
  formworkSettingsFor,
  isReturnableLine,
  isSubstitutedStrikingStandard,
  overUtilisedParts,
  resequenceCaveats,
  strikeTargetForPartKind,
  strikingInputFor,
  strikingStandardFor,
} from '@pascal-app/core/formwork'
import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'
import { type CastableHostNode, pourUnitsForHost } from './attach'
import { type SolvedShutter, solveShuttersForHost } from './solve'

/**
 * The whole job's formwork, in one answer.
 *
 * Every formwork consumer before this was per-host: a panel showing one wall's
 * parts, a chat tool billing one element. That is the wrong scope for the question
 * anybody actually asks. A yard does not order the formwork for a wall, it orders
 * the formwork for a floor, and a bill split element by element cannot be added up
 * afterwards — the same panel type on two walls is one line on a delivery note and
 * two lines in two separate takeoffs.
 *
 * This is the simplest useful form of the plan's project-wide `FormworkSolution`
 * (§6 phase 12). It is not that type: there is no clash pass, no schedule, no
 * serialisable cache. What it is, is the aggregation the export and the AI both
 * needed, built on the per-host solve rather than beside it — a second enumeration
 * at project scope would reintroduce exactly the divergence `solve.ts` exists to
 * prevent, one level up.
 */

const CASTABLE_TYPES = ['wall', 'column', 'slab'] as const

/** One element's contribution to the job, and whether it is fully formed. */
export interface SolvedElement {
  host: CastableHostNode
  shutters: SolvedShutter[]
  /** How many pours the element is cast in, which is how many shutters it needs. */
  pourUnitCount: number
  /**
   * True where the shutters match the pour.
   *
   * False is the case that matters and the reason this is on the element rather
   * than computed by each caller: an element cast in three pours and formed for
   * one bills a third of its own formwork, and every figure in that third is
   * individually correct. A project total over such an element is short by an
   * amount nothing else in the numbers reveals.
   */
  coversWholePour: boolean
}

export interface ProjectFormwork {
  elements: SolvedElement[]
  /** One bill across every shutter in scope, because it is one order. */
  bom: BomLine[]
  totalWeightKg: number
  /** False where any line has no published weight — do not quote the total as a lifting weight. */
  totalWeightComplete: boolean
  /**
   * The bill split into what the yard owns and what it hires, or absent.
   *
   * Absent means nobody has recorded a rack, and that is the whole reason it is
   * optional rather than a split with zeros in it: a project that has said nothing
   * about what it owns has not said its formwork is all on hire, and a takeoff that
   * fills the answer in makes a claim on the project's behalf.
   */
  supply?: BomSupply
  /**
   * How long each line is held, under the striking table the project's own code
   * family publishes — the other factor a hire charge needs.
   *
   * Always present, unlike `supply`, and the asymmetry is deliberate: ownership is a
   * fact about the yard that silence says nothing about, while a strike period is a
   * consequence of the code the project is already designed under. Unstated curing
   * inputs are named in `hire.assumed` rather than withholding the answer.
   */
  hire: BomHire
  /**
   * What the scope costs to hold, or absent where the project has recorded no rates.
   *
   * Optional like `supply` rather than always present like `hire`, and for the strongest
   * version of that reason in the whole feature: a strike period is a consequence of a
   * published code, so silence about it has a conservative answer. A price has no code
   * behind it at all. There is nothing to assume, so a project that has stated no rate
   * gets no money — not a zero, and not a figure derived from a plausible market rate.
   */
  cost?: BomCost
  /**
   * When each pour happens and when its plant arrives and comes free, or absent where no
   * pour in scope carries a date.
   *
   * Optional like `cost` rather than always present like `hire`, and the reason is the
   * same shape: a period is a consequence of a published code, and a *date* has no code
   * behind it at all. A project that has not programmed its pours has not said when it
   * pours, and deriving a date from the solve order would be a programme nobody agreed to
   * printed beside geometry that is actually derived.
   */
  schedule?: FormworkSchedule
  /**
   * How many of each thing the job needs to own or hire, or absent where the programme
   * cannot support the question.
   *
   * The figure the whole commercial chain has been working towards, and the last one to
   * arrive because it is the only one that needs *two* answers at once: the bill says what a
   * pour needs standing, and the programme says which pours stand at the same time. Neither
   * alone is a set count.
   *
   * Absent for a stronger reason than `cost` or `schedule` are. Those are absent because an
   * input is missing and their own output shows it — an unpriced bill has no money in it. A
   * set count off a partial programme is a *plausible small number*, so below the coverage
   * threshold there is no count rather than a low one. See `sets.ts`.
   */
  sets?: FormworkSetCount
  /**
   * What the yard has to go out and get, and whether to buy it or hire it.
   *
   * Present only where `sets` and `supply` both are, which makes it the *second* field
   * derived from other fields of this same solution rather than from the scene — and the
   * first whose absence has two unrelated causes. No count means no peak to compare; no
   * rack recorded means nothing to compare against, and neither is a yard that owns
   * nothing. Both silences are carried to the surfaces as reasons rather than gaps.
   */
  acquisition?: FormworkAcquisition
  /**
   * What has to happen before what, and how far each pour can move.
   *
   * Present wherever there is a programme at all, unlike `sets` and `acquisition`, because
   * precedence is a fact about the scene rather than about the commercial inputs: an element
   * cast in three lifts states two dependencies whether or not anybody has priced anything.
   * The float inside it is per pour and absent where that pour is undated, which is the same
   * rule the schedule follows.
   *
   * No new field on any node produces this. The scene has always stated order three ways —
   * `liftIndex`, `castOrder` and `pourId` — and this is the first reader to use them together.
   */
  sequence?: FormworkSequence
  /**
   * Which pour to move, to stop being short — or why nothing can move.
   *
   * The first output in this feature that proposes a change to the project rather than
   * describing one, and the only one derived from three other fields of this same solution: it
   * needs the shortfall to know what is short, the sequence to know what can move, and the
   * programme to re-sweep the peak after a candidate move. Absent where any of the three is.
   */
  resequence?: FormworkResequence
  /**
   * True where the striking table came from a different code family than the pressure
   * standard, because the project's own family publishes none.
   *
   * Only DIN, whose family answers removal in EN 13670 §5.5 rather than in DIN 18218.
   * Falling to BS 8110's formulas is the right answer and it is a substitution across
   * families rather than a match, which is a thing to say out loud.
   */
  strikingStandardSubstituted: boolean
  /** Elements formed for fewer or more pours than they are cast in. */
  incomplete: SolvedElement[]
  /** Parts working beyond capacity anywhere in scope. A bill for these is not an order. */
  beyondCapacityMarks: Array<{ hostId: string; mark: string; utilisation: number }>
  shutterCount: number
}

/**
 * Which elements a takeoff covers.
 *
 * `hostIds` scopes it to a selection; `parentId` to a level, which is the scope a
 * pour is actually planned at. Neither given means the whole scene.
 */
export interface ProjectFormworkScope {
  hostIds?: readonly string[]
  /** Elements whose `parentId` is this — a level, normally. */
  parentId?: string
}

function isCastable(node: AnyNode | undefined): node is CastableHostNode {
  return node !== undefined && (CASTABLE_TYPES as readonly string[]).includes(node.type)
}

/**
 * Elements in scope, in a stable order.
 *
 * Sorted by id rather than left in node-map order because the node map's order is
 * insertion order, which an undo reshuffles — and a CSV whose rows move between two
 * downloads of an unchanged scene is a CSV nobody can diff.
 */
function hostsInScope(
  nodes: Record<string, AnyNode>,
  scope: ProjectFormworkScope,
): CastableHostNode[] {
  const wanted = scope.hostIds ? new Set(scope.hostIds) : undefined
  const out: CastableHostNode[] = []
  for (const node of Object.values(nodes)) {
    if (!isCastable(node)) continue
    if (wanted && !wanted.has(node.id as string)) continue
    if (scope.parentId !== undefined && node.parentId !== scope.parentId) continue
    out.push(node)
  }
  return out.sort((a, b) => (a.id as string).localeCompare(b.id as string))
}

/**
 * Every shuttered element in scope, solved, plus the one bill across them.
 *
 * Elements with no shutter are left out entirely rather than carried as empty rows:
 * a wall nobody has formed yet is not a wall that needs nothing, and an empty row in
 * a bill reads as the latter. `incomplete` is where the under-formed ones are named.
 */
export function solveProjectFormwork(
  nodes: Record<string, AnyNode>,
  scope: ProjectFormworkScope = {},
): ProjectFormwork {
  const allNodes = Object.values(nodes)
  const elements: SolvedElement[] = []
  for (const host of hostsInScope(nodes, scope)) {
    const shutters = solveShuttersForHost(host, nodes)
    if (shutters.length === 0) continue
    const pourUnitCount = Math.max(1, pourUnitsForHost(host, allNodes).length)
    elements.push({
      host,
      shutters,
      pourUnitCount,
      coversWholePour: shutters.length === pourUnitCount,
    })
  }

  const everyPart = elements.flatMap((element) =>
    element.shutters.flatMap((shutter) => shutter.parts),
  )
  const bom = bomLines(everyPart)
  const weight = bomWeightKg(bom)
  const settings = formworkSettingsFor(allNodes)

  // Mark → what that mark is struck as, which is the only join between a striking
  // table and a bill. Built here because this is the layer that knows a part's host:
  // core's `strikeTargetForPartKind` can say a prop under a slab is a shore and a prop
  // against a wall is a raker, and it cannot tell them apart on its own.
  //
  // A list per mark rather than one target, because `bomLines` groups across hosts and
  // a mark is unique within a shutter rather than across a project — `duplicateMarks`
  // exists for that. Collapsing to one would silently keep whichever element sorted
  // last; accumulating makes the line `mixed`, which is the honest answer.
  const targetsByMark = new Map<string, Set<StrikeTarget>>()
  for (const element of elements) {
    const hostKind = element.host.type as 'wall' | 'column' | 'slab'
    for (const shutter of element.shutters) {
      for (const part of shutter.parts) {
        if (part.omitted) continue
        const target = strikeTargetForPartKind(part.kind, hostKind)
        if (target === undefined) continue
        const existing = targetsByMark.get(part.mark)
        if (existing) existing.add(target)
        else targetsByMark.set(part.mark, new Set([target]))
      }
    }
  }
  const hire = bomHire(
    bom,
    (mark) => [...(targetsByMark.get(mark) ?? [])],
    strikingStandardFor(settings.pressureStandard),
    strikingInputFor(settings),
  )

  const beyondCapacityMarks = elements.flatMap((element) =>
    overUtilisedParts(element.shutters.flatMap((shutter) => shutter.parts)).map((part) => ({
      hostId: element.host.id as string,
      mark: part.mark,
      utilisation: part.structure?.utilisation ?? 0,
    })),
  )

  const supply = settings.ownedStock ? bomSupply(bom, settings.ownedStock) : undefined

  // A pour per shutter, because a shutter *is* a pour unit — and the periods per shutter
  // rather than per bill line, which is the difference from `bomHire`. A line spans hosts
  // and a date does not: the same panel type on a wall poured in March and one poured in
  // May is one line and two pours, so the calendar has to be built off the assemblies.
  //
  // The periods come off the hire rather than being solved again. They are the same call
  // with the same inputs, so a second solve could not produce a different figure today —
  // it could the day either path gained a case, and a strike date that disagreed with the
  // hire duration behind it is the one inconsistency this scope cannot explain.
  const periods = new Map<StrikeTarget, StrikingTime>(
    hire.periods.map((time) => [time.target, time]),
  )
  const pours: SchedulablePour[] = []
  // The same walk builds the per-pour quantities the set count needs. Per shutter rather
  // than off `bom`, and that is the whole reason this cannot be done from the project bill:
  // a bill line is one catalog id across every pour in scope, so it has no pour to belong to
  // and a sweep over it would find one interval covering the job.
  const pourQuantities: PourQuantities[] = []
  // And the precedence, off the same walk and for the same layer reason `targetsByMark` is built
  // here: `castOrder` and `pourId` are stated on the *element* and a pour is a shutter, so only
  // the layer holding both can join them. Core's sequencer never sees a node.
  const sequenceable: SequenceablePour[] = []
  for (const element of elements) {
    const hostKind = element.host.type as 'wall' | 'column' | 'slab'
    const host = element.host as CastableHostNode & { castOrder?: number; pourId?: string }
    for (const shutter of element.shutters) {
      const targets = new Set<StrikeTarget>()
      for (const part of shutter.parts) {
        if (part.omitted) continue
        const target = strikeTargetForPartKind(part.kind, hostKind)
        if (target !== undefined) targets.add(target)
      }
      const striking = [...targets]
        .map((target) => periods.get(target))
        .filter((time): time is StrikingTime => time !== undefined)
      const id = shutter.assembly.id as string
      pours.push({
        id,
        ...(shutter.assembly.pourAt === undefined ? {} : { pourAt: shutter.assembly.pourAt }),
        striking,
      })
      sequenceable.push({
        id,
        elementId: element.host.id as string,
        // Defaulted to the bottom lift of the only segment where the assembly says nothing, which
        // is what an unsplit element is: one pour at the base. A missing index left absent would
        // put every shutter on the element in one chain and invent a bearing between them.
        segmentIndex: shutter.assembly.segmentIndex ?? 0,
        liftIndex: shutter.assembly.liftIndex ?? 0,
        ...(host.castOrder === undefined ? {} : { castOrder: host.castOrder }),
        ...(host.pourId === undefined ? {} : { pourId: host.pourId }),
      })
      // Through `bomLines` rather than counting parts directly, so a shutter's quantities are
      // the same arithmetic as the bill's — a consumable is measured in its own unit and a
      // part can stand for more than one item, and `partQuantity` is where that lives.
      //
      // Only returnable lines: a cut board is made for this pour and a drum of release agent
      // is used up in it, and neither is stock a set is counted out of. Reported as reused
      // they would say a board serves five pours.
      pourQuantities.push({
        id,
        quantities: bomLines(shutter.parts)
          .filter(isReturnableLine)
          .map((line) => {
            const target = strikeTargetForPartKind(line.kind, hostKind)
            return {
              catalogId: line.catalogId as string,
              kind: line.kind,
              description: line.description,
              quantity: line.quantity,
              ...(target === undefined ? {} : { target }),
            }
          }),
      })
    }
  }
  // Absent where nothing is dated, rather than a programme of empty rows: a takeoff for a
  // project nobody has programmed should carry no calendar at all, the same way it carries
  // no money until a rate exists.
  const schedule = formworkSchedule(pours, settings.schedule)
  const anyDated = schedule.scheduledCount > 0
  // Off the schedule rather than beside it, so a peak cannot fall on a day the programme
  // above it does not have. Absent where the programme is too partial to sweep, which is the
  // module's own refusal rather than a condition tested here.
  const sets = anyDated ? formworkSetCount(schedule, pourQuantities) : undefined
  // Both inputs are the solution's own, so this cannot disagree with the peak printed above
  // it — and `ownedStock` rather than `supply` because the acquisition compares against the
  // rack itself, while the split has already spent it line by line.
  const acquisition =
    sets && settings.ownedStock
      ? formworkAcquisition(sets, settings.ownedStock, settings.rates)
      : undefined
  // Off the same schedule, so a float cannot be measured against a date the programme above it
  // does not have. Only where something is dated: precedence without dates is a graph with no
  // float in it, and reporting the edges alone would put a dependency list on a panel whose every
  // allowance column is blank.
  const sequence = anyDated ? formworkSequence(sequenceable, schedule) : undefined
  // The one output derived from three others. Every input is this solution's own, so a proposed
  // move cannot be compared against a peak the reader is not looking at.
  const resequence =
    sequence && acquisition && acquisition.shortfalls.length > 0
      ? formworkResequence(acquisition, schedule, pourQuantities, sequence)
      : undefined

  return {
    elements,
    bom,
    totalWeightKg: weight.totalKg,
    totalWeightComplete: weight.complete,
    ...(supply ? { supply } : {}),
    hire,
    // Priced from the split and the periods above rather than from a second pass over the
    // parts, so a cost and the quantity it prices cannot disagree. `supply` is passed
    // through as it stands, including absent: a project with rates and no stock list has
    // said it owns none of this, which is a different claim from having said nothing.
    ...(settings.rates ? { cost: bomCost(bom, settings.rates, hire, supply) } : {}),
    ...(anyDated ? { schedule } : {}),
    ...(sets ? { sets } : {}),
    ...(acquisition ? { acquisition } : {}),
    ...(sequence ? { sequence } : {}),
    ...(resequence ? { resequence } : {}),
    strikingStandardSubstituted: isSubstitutedStrikingStandard(settings.pressureStandard),
    incomplete: elements.filter((element) => !element.coversWholePour),
    beyondCapacityMarks,
    shutterCount: elements.reduce((total, element) => total + element.shutters.length, 0),
  }
}

/**
 * What makes this takeoff wrong, in words, or nothing.
 *
 * Shared by the panel, the CSV and the chat tool so all three warn identically —
 * three phrasings of one fault is how a user comes to believe two of them are
 * different problems. Each line names its element, because "the takeoff is short"
 * without saying where is not actionable.
 */
export function projectFormworkCaveats(solution: ProjectFormwork): string[] {
  const out: string[] = []
  for (const element of solution.incomplete) {
    const shutters = element.shutters.length
    const units = element.pourUnitCount
    out.push(
      shutters < units
        ? `${element.host.id} is cast in ${units} pours and formed for ${shutters} — this bill is short by the difference.`
        : `${element.host.id} has ${shutters} shutters for ${units} ${units === 1 ? 'pour' : 'pours'} — this bill counts formwork for a pour it no longer has.`,
    )
  }
  if (solution.beyondCapacityMarks.length > 0) {
    const count = solution.beyondCapacityMarks.length
    out.push(
      `${count} ${count === 1 ? 'part is' : 'parts are'} beyond capacity — a bill for a shutter that does not stand up is not an order to place.`,
    )
  }
  if (!solution.totalWeightComplete && solution.bom.length > 0) {
    out.push(
      'Some parts have no published weight, so the total is the sum of those that do — not the lifting weight of the set.',
    )
  }
  if (solution.supply && solution.supply.ownedQuantity > 0) {
    out.push(
      'The owned/hired split is for this scope alone. The same owned stock serves the next pour once it is stripped, so two scopes’ owned figures are not a total.',
    )
  }
  if (solution.supply && solution.supply.hiredModifiedQuantity > 0) {
    const count = solution.supply.hiredModifiedQuantity
    out.push(
      `${count} hired ${count === 1 ? 'part is' : 'parts are'} drilled or cut for this pour — expect a recharge at list price, not a hire charge.`,
    )
  }
  if (solution.strikingStandardSubstituted) {
    out.push(
      'DIN 18218 publishes no striking periods, so the hire durations below are BS 8110 Table 6.2’s — a substitution across code families, not this project’s own code.',
    )
  }
  // Verbatim from the striking solve rather than rephrased here, so a figure and the
  // reason it may be wrong travel together. The accumulator warning is the one that
  // matters most: under ACI these are qualifying hours above 10 °C, so a reader who
  // takes "4 days" off a cold-spring programme strikes early.
  for (const warning of solution.hire.warnings) out.push(warning.message)
  for (const entry of solution.hire.mixedLines) {
    out.push(`${entry.line.description}: ${entry.mixed?.message}`)
  }
  // Verbatim from the cost pass for the same reason the striking warnings are. Every one
  // of these makes the total a floor rather than a price, and a money figure is the one
  // number in this whole takeoff a reader will quote without reading anything beside it.
  if (solution.cost) out.push(...bomCostCaveats(solution.cost))
  // Verbatim again, and the qualifying-time line is the one that earns its place: under
  // ACI the strike dates are the earliest the forms could come off rather than the dates,
  // and a reader who takes a cold-spring programme off a summer calculation strikes early.
  if (solution.schedule) out.push(...formworkScheduleCaveats(solution.schedule))
  if (solution.sets) out.push(...formworkSetCaveats(solution.sets))
  // The refusal said out loud, because a reader who has seen a set count on one takeoff and
  // sees none on this one is owed the reason. Only where there is a programme at all: a
  // project that has dated nothing is already told that by the schedule's own absence, and
  // repeating it here would make one missing input read as two problems.
  else if (solution.schedule) {
    const dated = solution.schedule.scheduledCount
    const total = solution.schedule.pours.length
    out.push(
      `No set count: ${dated} of ${total} pours are dated, which is too few to sweep. Counting sets over part of a programme reports a peak the job never has, and it comes out low — so there is no figure here rather than a small one. Date the remaining pours to get it.`,
    )
  }
  if (solution.acquisition) out.push(...acquireCaveats(solution.acquisition))
  // The other half of the same refusal, and it needs its own sentence because the remedy is
  // different: a set count with nothing to compare it against is a rack nobody has recorded,
  // not a programme nobody has dated. Only where there *is* a count, so a project missing
  // both inputs is told about the dates once rather than about two separate absences.
  else if (solution.sets) {
    out.push(
      'Nothing here says what to buy or hire: the peak above is what the job needs at once, and no rack is recorded to compare it against. That is not a yard that owns nothing — record what it owns with set_formwork_settings ownedStock and the shortfall follows.',
    )
  }
  // After the acquisition, because a move is the alternative to acquiring and reads as one only
  // once the reader knows what is short. Both sets of caveats, and the sequence's first: "this is
  // not a critical path" has to arrive before any figure that was derived from the float.
  if (solution.sequence) out.push(...formworkSequenceCaveats(solution.sequence))
  if (solution.resequence) out.push(...resequenceCaveats(solution.resequence))
  return out
}

/** The elements a scope names, for a caller that only needs the count. */
export function castableHostIds(
  nodes: Record<string, AnyNode>,
  scope: ProjectFormworkScope = {},
): AnyNodeId[] {
  return hostsInScope(nodes, scope).map((host) => host.id as AnyNodeId)
}
