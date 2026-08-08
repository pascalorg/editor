import type { BomLine } from '@pascal-app/core/formwork'
import { bomLines, bomWeightKg, overUtilisedParts } from '@pascal-app/core/formwork'
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

  const beyondCapacityMarks = elements.flatMap((element) =>
    overUtilisedParts(element.shutters.flatMap((shutter) => shutter.parts)).map((part) => ({
      hostId: element.host.id as string,
      mark: part.mark,
      utilisation: part.structure?.utilisation ?? 0,
    })),
  )

  return {
    elements,
    bom,
    totalWeightKg: weight.totalKg,
    totalWeightComplete: weight.complete,
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
  return out
}

/** The elements a scope names, for a caller that only needs the count. */
export function castableHostIds(
  nodes: Record<string, AnyNode>,
  scope: ProjectFormworkScope = {},
): AnyNodeId[] {
  return hostsInScope(nodes, scope).map((host) => host.id as AnyNodeId)
}
