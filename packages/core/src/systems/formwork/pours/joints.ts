import type { JointTreatment } from '../../../schema/nodes/construction-joint'
import type { AnyNodeId } from '../../../schema/types'
import type { CastableElement } from '../coverage/elements'
import { splitIntoLifts } from './lifts'
import type { HardCut } from './segments'
import { splitIntoSegments } from './segments'
import type { PourLimits } from './types'

/**
 * The joints a split implies — solver output, not solver input.
 *
 * Every soft cut the solver makes is a real construction joint with real work
 * attached: the concrete either side has to bond, so the face is roughened, and
 * reinforcement continues through it, so the bulkhead needs penetrations. Emitting
 * the joint as a node is what makes that work visible and payable instead of an
 * implicit consequence of a layout decision.
 *
 * Returned as plain specs rather than written to the scene: the store owns node
 * creation, and a solver that mutated the scene as a side effect of answering
 * "where would the joints go" could not be used to preview a change.
 */

export interface JointSpec {
  kind: 'construction'
  elementIds: AnyNodeId[]
  /** Set for a horizontal lift joint. */
  elevation?: number
  /** Set for a vertical pour break. */
  along?: number
  treatments: JointTreatment[]
  solverPlaced: true
}

/**
 * A horizontal lift joint takes the load of the lift above across it, so it
 * needs bond (roughening) and continuity (starters). A vertical pour break
 * carries no bearing, but reinforcement still runs through it, so it takes the
 * starters without the roughening — the vertical face is formed, not screeded,
 * and a formed face is already keyed enough to bond.
 */
const LIFT_JOINT_TREATMENTS: JointTreatment[] = [{ kind: 'roughening' }, { kind: 'starter-bars' }]

const POUR_BREAK_TREATMENTS: JointTreatment[] = [{ kind: 'starter-bars' }]

export function jointsForElement(
  element: CastableElement,
  limits: PourLimits = {},
  hardCuts: readonly HardCut[] = [],
): JointSpec[] {
  const out: JointSpec[] = []

  for (const lift of splitIntoLifts(element, limits)) {
    if (!lift.hasJointBelow) continue
    out.push({
      kind: 'construction',
      elementIds: [element.id],
      elevation: lift.baseElevation,
      treatments: LIFT_JOINT_TREATMENTS,
      solverPlaced: true,
    })
  }

  // Hard cuts already exist as their own joint nodes — they were the input to
  // the split — so only the solver's own soft cuts are emitted here.
  for (const segment of splitIntoSegments(element, limits, hardCuts)) {
    if (segment.startCutReason === undefined || segment.startCutReason === 'HARD_JOINT') continue
    out.push({
      kind: 'construction',
      elementIds: [element.id],
      along: segment.startAlong,
      treatments: POUR_BREAK_TREATMENTS,
      solverPlaced: true,
    })
  }

  return out
}
