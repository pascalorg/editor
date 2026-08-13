import type {
  BomLine,
  FormworkPart,
  PartProvenance,
  ShutterElevation,
} from '@pascal-app/core/formwork'
import {
  bomLines,
  bomWeightKg,
  duplicateMarks,
  orphanedOverrides,
  overUtilisedParts,
  partLabel,
  worstUtilisation,
} from '@pascal-app/core/formwork'
import type { AnyNode } from '@pascal-app/core/schema'
import { type CastableHostNode, pourUnitsForHost } from './attach'
import { shutterLabel, solveShuttersForHost } from './solve'

/**
 * One element's shutter, as an agent should read it.
 *
 * The report is here rather than at each tool for the reason `solve.ts` is: two
 * surfaces answering the same question must not answer it differently. The numbers
 * are the same either way — both call the same solver — but the *shape* is where the
 * divergence lands, and it lands silently. `duplicateMarks` flattened across lifts
 * rather than kept per shutter turns a correctly built three-lift wall into a clash
 * list containing every part it has; `partCount` following the `kind` filter has the
 * model quoting twelve parts for a wall. Neither is a wrong figure, and both are
 * wrong answers.
 *
 * Rounded here for the same reason. A panel count is exact and a utilisation is not,
 * and two surfaces rounding at different places report the same shutter as working at
 * 0.87 and 0.8746 — a difference a user reading both will take for two designs.
 */

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

/** One part of a shutter, in the terms a reply quotes it in. */
export interface ReportedPart {
  mark: string
  kind: string
  /** Refined by the member it is: a column clamp is not a waler, a bearer is not a joist. */
  label: string
  description: string
  catalogId: string | null
  provenance: PartProvenance
  weightKg: number | null
  utilisation: number | null
  governingCheck: string | null
  omittedFromOrder: boolean
  note: string | null
}

export interface ReportedShutter {
  assemblyId: string
  segment: number
  lift: number
  /**
   * Every part of this shutter, whatever the `kind` filter was. The filter trims the
   * itemised list only: a count that followed it would be quoted as the shutter's.
   */
  partCount: number
  parts: ReportedPart[]
}

export interface ReportedBomLine {
  description: string
  catalogId: string | null
  provenance: PartProvenance
  quantity: number
  unit: string
  totalWeightKg: number | null
  /** The marks this line covers, so a quantity can be traced back to the drawing. */
  marks: string[]
}

export interface FormworkPartsReport {
  kind: string
  shutters: ReportedShutter[]
  /**
   * Grouped for ordering rather than per shutter: a wall cast in three lifts is one
   * delivery of the same panels.
   */
  bom: ReportedBomLine[]
  totalWeightKg: number
  /**
   * False means some part has no published weight, so the total is the sum of the ones
   * that do — not the lifting weight of the set.
   */
  totalWeightComplete: boolean
  hardestWorked: { mark: string; utilisation: number; governingCheck: string | null } | null
  beyondCapacity: Array<{ mark: string; utilisation: number; governingCheck: string | null }>
  /**
   * Per shutter, the way the parts panel checks it. A mark's station and elevation are
   * measured within its own pour unit, so lift 0 and lift 1 of one wall share every
   * mark by design — flattened, a correctly shuttered three-lift wall reports every
   * part it has as a clash, and a clash list that is always full is one nobody reads.
   */
  duplicateMarks: Array<{ assemblyId: string; mark: string }>
  /** Overrides against marks the solve no longer produces — somebody's edit, stranded. */
  staleEdits: Array<{ assemblyId: string; mark: string }>
  /** The one caveat that invalidates every figure above it. */
  coversWholeElement: boolean
  coverageCaveat: string | null
}

function reportPart(part: FormworkPart): ReportedPart {
  return {
    mark: part.mark,
    kind: part.kind,
    label: partLabel(part),
    description: part.description,
    catalogId: part.catalogId ?? null,
    provenance: part.provenance,
    weightKg: part.weightKg ?? null,
    utilisation: part.structure ? round(part.structure.utilisation) : null,
    governingCheck: part.structure?.governingCheck ?? null,
    omittedFromOrder: part.omitted === true,
    note: part.note ?? null,
  }
}

function reportLine(line: BomLine): ReportedBomLine {
  return {
    description: line.description,
    catalogId: line.catalogId ?? null,
    provenance: line.provenance,
    quantity: line.quantity,
    unit: line.unit,
    totalWeightKg: line.totalWeightKg === undefined ? null : round(line.totalWeightKg),
    marks: line.marks,
  }
}

/**
 * Whether this element's shutters still match how it is cast, in words a reply can
 * pass on.
 *
 * A pour limit decides how many shutters an element needs, and changing one does not
 * build or remove any: a 9 m wall shuttered as one pour and then capped at 3 m lifts is
 * cast in three and formed in one, so its takeoff is two-thirds short with nothing on
 * screen to say so. Silence is the failure — the numbers all look reasonable, they are
 * just for less wall than the element has.
 *
 * Separate from `projectFormworkCaveats`, which says the same thing at project scope
 * without the remedy: at one element the remedy is a call the agent can make, and
 * naming it is the whole value of the sentence.
 */
export function formworkCoverageCaveat(
  elementId: string,
  shutterCount: number,
  pourUnitCount: number,
): string | undefined {
  if (shutterCount === 0 || shutterCount === pourUnitCount) return undefined
  if (shutterCount < pourUnitCount) {
    const short = pourUnitCount - shutterCount
    return `${shutterCount} of the ${pourUnitCount} ${pourUnitCount === 1 ? 'pour is' : 'pours are'} shuttered, so the takeoff is short by the rest — call attach_formwork on ${elementId} to shutter ${short === 1 ? 'the other one' : `the other ${short}`}`
  }
  const extra = shutterCount - pourUnitCount
  return `${shutterCount} shutters for ${pourUnitCount} ${pourUnitCount === 1 ? 'pour' : 'pours'} — call attach_formwork on ${elementId} to remove the ${extra} that ${extra === 1 ? 'forms a pour unit' : 'form pour units'} this element no longer has`
}

/** The same check for a caller that has the host rather than the two counts. */
export function coverageCaveatForHost(
  host: CastableHostNode,
  nodes: Record<string, AnyNode>,
  shutterCount: number,
): string | undefined {
  const units = pourUnitsForHost(host, Object.values(nodes))
  return formworkCoverageCaveat(host.id as string, shutterCount, Math.max(1, units.length))
}

/**
 * One host's shutters, solved and reported — or `undefined` where nobody has formed it.
 *
 * `undefined` rather than an empty report, because the two are different answers and
 * only one of them is safe to print: a bill of nothing reads as an element that needs
 * nothing, which is the opposite of an element awaiting a shutter.
 */
export function formworkPartsReport(
  host: CastableHostNode,
  nodes: Record<string, AnyNode>,
  options: { kind?: string } = {},
): FormworkPartsReport | undefined {
  const shutters = solveShuttersForHost(host, nodes)
  if (shutters.length === 0) return undefined

  const every = shutters.flatMap((shutter) => shutter.parts)
  const lines = bomLines(every)
  const weight = bomWeightKg(lines)
  const worst = worstUtilisation(every)
  const caveat = coverageCaveatForHost(host, nodes, shutters.length)

  return {
    kind: host.type,
    shutters: shutters.map((shutter) => ({
      assemblyId: shutter.assembly.id as string,
      segment: shutter.assembly.segmentIndex,
      lift: shutter.assembly.liftIndex,
      partCount: shutter.parts.length,
      // Trimmed by kind because a 6 m slab deck is hundreds of sheets and props, and a
      // full dump of them crowds out the bill underneath.
      parts: (options.kind === undefined
        ? shutter.parts
        : shutter.parts.filter((part) => part.kind === options.kind)
      ).map(reportPart),
    })),
    bom: lines.map(reportLine),
    totalWeightKg: round(weight.totalKg),
    totalWeightComplete: weight.complete,
    hardestWorked: worst
      ? {
          mark: worst.part.mark,
          utilisation: round(worst.utilisation),
          governingCheck: worst.part.structure?.governingCheck ?? null,
        }
      : null,
    beyondCapacity: overUtilisedParts(every).map((part) => ({
      mark: part.mark,
      utilisation: round(part.structure?.utilisation ?? 0),
      governingCheck: part.structure?.governingCheck ?? null,
    })),
    duplicateMarks: shutters.flatMap((shutter) =>
      duplicateMarks(shutter.parts).map((mark) => ({
        assemblyId: shutter.assembly.id as string,
        mark,
      })),
    ),
    staleEdits: shutters.flatMap((shutter) =>
      orphanedOverrides(shutter.parts, shutter.assembly.partOverrides).map((mark) => ({
        assemblyId: shutter.assembly.id as string,
        mark,
      })),
    ),
    coversWholeElement: caveat === undefined,
    coverageCaveat: caveat ?? null,
  }
}

/** One pour's shop elevation, named the way every other surface names that pour. */
export interface ReportedElevation {
  assemblyId: string
  pour: string
  elevation: ShutterElevation
}

/**
 * Every drawn face of one element, for a caller with no screen.
 *
 * The drawings come out of the same `solveShuttersForHost` the parts table and the bill read,
 * so a mark on the AI's drawing is the mark on the user's — which is the only reason this
 * function exists rather than each surface reaching into `SolvedShutter` itself.
 *
 * Three answers rather than two, because they call for three different replies.
 * `undefined` is "nobody has formed this element", which is a call to `attach_formwork`. An
 * empty array is "formed, and no face of it is a shutter face to draw" — a column, a slab, or a
 * wall whose faces are all buried — which is not a missing input and not something to fix. And
 * a populated array is the drawing. Folding the first two together would have an agent calling
 * `attach_formwork` on a column that is already fully shuttered.
 */
export function shutterElevations(
  host: CastableHostNode,
  nodes: Record<string, AnyNode>,
): ReportedElevation[] | undefined {
  const shutters = solveShuttersForHost(host, nodes)
  if (shutters.length === 0) return undefined

  const drawings: ReportedElevation[] = []
  for (const shutter of shutters) {
    if (!shutter.elevation) continue
    drawings.push({
      assemblyId: shutter.assembly.id as string,
      pour: shutterLabel(shutter.assembly),
      elevation: shutter.elevation,
    })
  }
  return drawings
}
