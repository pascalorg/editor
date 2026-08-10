import type { BomCost, BomHire, BomLine, BomSupply, StrikeTarget } from '@pascal-app/core/formwork'
import {
  bomCost,
  bomCostCaveats,
  bomHire,
  bomLines,
  bomSupply,
  bomWeightKg,
  formworkSettingsFor,
  isSubstitutedStrikingStandard,
  overUtilisedParts,
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
  return out
}

/** The elements a scope names, for a caller that only needs the count. */
export function castableHostIds(
  nodes: Record<string, AnyNode>,
  scope: ProjectFormworkScope = {},
): AnyNodeId[] {
  return hostsInScope(nodes, scope).map((host) => host.id as AnyNodeId)
}
