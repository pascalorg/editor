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
    out.set(element.id, pourUnitsForElement(element, limits, hardCutsForElement(element.id, nodes)))
  }
  return out
}
