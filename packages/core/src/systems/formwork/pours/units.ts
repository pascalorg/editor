import type { AnyNode, AnyNodeId } from '../../../schema/types'
import type { CastableElement } from '../coverage/elements'
import { collectCastableElements } from '../coverage/elements'
import { splitIntoLifts } from './lifts'
import type { HardCut } from './segments'
import { splitIntoSegments } from './segments'
import type { PourLimits, PourUnit } from './types'

/**
 * The cross product of the plan split and the vertical split: every
 * (segment × lift) is one pour unit, and one formwork assembly.
 *
 * Both splits are computed against the whole element rather than per-slice
 * because the two constraints are independent — the lift height comes from the
 * pressure envelope and the segment length from shrinkage and supply — so the
 * grid is rectangular and there is no ordering dependency between them.
 */

/**
 * Hard cuts on `element`, read from the expansion and isolation joint nodes
 * that name it. Construction joints are excluded deliberately: they are the
 * solver's own soft cuts, so treating them as hard input would freeze whatever
 * split a previous run happened to produce.
 */
export function hardCutsForElement(elementId: AnyNodeId, nodes: AnyNode[]): HardCut[] {
  const out: HardCut[] = []
  for (const node of nodes) {
    if (node.type !== 'construction-joint') continue
    if (node.kind !== 'expansion' && node.kind !== 'isolation') continue
    if (!node.elementIds.includes(elementId)) continue
    if (node.along === undefined) continue
    out.push({ along: node.along })
  }
  return out
}

/**
 * Lift joints somebody specified, read off the joint nodes that name `elementId`.
 *
 * The counterpart to `hardCutsForElement` in the other axis, and the answer to a gap
 * that had been recorded as "joint-elevation snapping has no schema home": the home
 * was there all along. A `construction-joint` node carries an `elevation` above the
 * host's base and a `solverPlaced` flag, and `splitIntoLifts` has been able to snap to
 * permitted elevations since it was written — but nothing in the app ever passed it
 * any, so an engineer could draw a lift joint at 4.6 m and the split would divide the
 * wall uniformly straight through it.
 *
 * `solverPlaced` is what makes this safe to read. A joint the solver placed is a record
 * of the split it already produced, so feeding it back in would freeze whatever the
 * last run happened to choose — the same trap `hardCutsForElement` avoids by excluding
 * construction joints from the *plan* cuts. Only a joint somebody else put there is an
 * input.
 *
 * Expansion and isolation joints are absent for a different reason: they are vertical
 * partitions between independent structures, and `elevation` on one of those is not a
 * lift joint. `sliding` is out for the same reason.
 */
export function specifiedLiftJoints(elementId: AnyNodeId, nodes: readonly AnyNode[]): number[] {
  const out = new Set<number>()
  for (const node of nodes) {
    if (node.type !== 'construction-joint') continue
    if (node.kind !== 'construction' && node.kind !== 'contraction') continue
    if (node.solverPlaced) continue
    if (!node.elementIds.includes(elementId)) continue
    if (node.elevation === undefined || node.elevation <= 0) continue
    out.add(node.elevation)
  }
  return [...out].sort((a, b) => a - b)
}

/**
 * The project's limits plus what this element's own joint nodes require.
 *
 * A specified elevation goes in as *required* and as *permitted*: required because a
 * joint the engineer drew is a constraint rather than a suggestion, and permitted
 * because otherwise the validator would fault the engineer's own joint for not being
 * on a permitted elevation — the check would be reporting the constraint as the defect.
 */
export function pourLimitsForElement(
  elementId: AnyNodeId,
  nodes: readonly AnyNode[],
  limits: PourLimits = {},
): PourLimits {
  const specified = specifiedLiftJoints(elementId, nodes)
  if (specified.length === 0) return limits
  return {
    ...limits,
    requiredJointElevations: [...(limits.requiredJointElevations ?? []), ...specified],
    permittedJointElevations: [...(limits.permittedJointElevations ?? []), ...specified],
  }
}

/**
 * The pour units of one element as the *scene* states them — the project's limits with
 * this element's own hard cuts and specified lift joints folded in.
 *
 * Every live caller wants this rather than `pourUnitsForElement`, and the reason is the
 * reason `parts.ts` and `design.ts` exist: the split is what a shutter, a bill and a
 * validation report are all about, so two derivations of it disagree about how many
 * pours a wall has and nothing on any screen looks wrong.
 */
export function pourUnitsInScene(
  element: CastableElement,
  nodes: readonly AnyNode[],
  limits: PourLimits = {},
): PourUnit[] {
  return pourUnitsForElement(
    element,
    pourLimitsForElement(element.id, nodes, limits),
    hardCutsForElement(element.id, [...nodes]),
  )
}

export function pourUnitsForElement(
  element: CastableElement,
  limits: PourLimits = {},
  hardCuts: readonly HardCut[] = [],
): PourUnit[] {
  // A slab is one pour in this phase: both splits cut along a centreline, and a
  // slab has none — dividing it into bays is a polygon partition. Its lift cap
  // would otherwise slice it through its own thickness.
  if (element.kind === 'slab') {
    return [
      {
        elementId: element.id,
        segmentIndex: 0,
        liftIndex: 0,
        startAlong: 0,
        endAlong: 0,
        baseElevation: 0,
        topElevation: element.height,
        volumeCuM: (element.plan?.netAreaSqM ?? 0) * element.coreThickness,
        hasJointBelow: false,
      },
    ]
  }

  const segments = splitIntoSegments(element, limits, hardCuts)
  const lifts = splitIntoLifts(element, limits)
  const out: PourUnit[] = []
  for (const segment of segments) {
    const segmentLength = segment.endAlong - segment.startAlong
    for (const lift of lifts) {
      const liftHeight = lift.topElevation - lift.baseElevation
      // A column has no length along a centreline, so its concrete comes from
      // its plan area instead — `length × thickness` would report zero.
      const crossSection =
        element.kind === 'column'
          ? (element.plan?.netAreaSqM ?? 0)
          : segmentLength * element.coreThickness
      out.push({
        elementId: element.id,
        segmentIndex: segment.index,
        liftIndex: lift.index,
        startAlong: segment.startAlong,
        endAlong: segment.endAlong,
        baseElevation: lift.baseElevation,
        topElevation: lift.topElevation,
        volumeCuM: crossSection * liftHeight,
        hasJointBelow: lift.hasJointBelow,
        startCutReason: segment.startCutReason,
        endCutReason: segment.endCutReason,
      })
    }
  }
  return out
}

/** Every pour unit in `nodes`, keyed by element. */
export function pourUnits(nodes: AnyNode[], limits: PourLimits = {}): Map<AnyNodeId, PourUnit[]> {
  const out = new Map<AnyNodeId, PourUnit[]>()
  for (const element of collectCastableElements(nodes)) {
    out.set(element.id, pourUnitsInScene(element, nodes, limits))
  }
  return out
}
