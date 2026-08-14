import type { AnyNode, AnyNodeId } from '../../../schema/types'
import type { CastableElement } from '../coverage/elements'
import { pourLiftConflicts, resolveMaxLiftHeight, splitIntoLifts } from './lifts'
import type { PourLift, PourLiftConflict, PourLimits } from './types'
import { pourLimitsForElement } from './units'

/**
 * The project's pour plan as the solution carries it: every split element's lifts,
 * each boundary labelled with who decided it, and the boundaries a stated permitted
 * set could not satisfy.
 *
 * The split lives in `splitIntoLifts`; what this adds is the *labels* travelling with
 * the solution and the *conflicts* as findings. Scenario 1 of the permitted-joints
 * contract wants each lift's height reported against the joint it used, which the
 * `jointSource` and `snappedTo` on the lift carry; scenario 3 wants solver-chosen
 * boundaries labelled as such, which the same field carries when nothing was stated;
 * and scenario 2 wants the conflict named with the limit and the permitted joints,
 * which is `conflicts`.
 *
 * Deliberately derived from the same limits and the same joint nodes the split used,
 * so a boundary cannot be reported as one thing while the shutters are built as
 * another.
 */

/** One split element's lifts, with how each joint below a lift was decided. */
export interface FormworkPoursElement {
  elementId: AnyNodeId
  lifts: PourLift[]
}

export interface FormworkPours {
  /**
   * The project's stated permitted elevations, or null where none are stated — what a
   * conflict names and what scenario 3's "no stated joints" is.
   */
  permittedJointElevations: readonly number[] | null
  /** How far a joint may move to reach one, or null where not stated. */
  jointSnapTolerance: number | null
  /** Every element the split divides into more than one lift. */
  elements: FormworkPoursElement[]
  /** Boundaries the split needed that land on no permitted elevation. */
  conflicts: PourLiftConflict[]
}

export function formworkPours(
  elements: readonly CastableElement[],
  nodes: readonly AnyNode[],
  limits: PourLimits,
): FormworkPours {
  const split: FormworkPoursElement[] = []
  const conflicts: PourLiftConflict[] = []
  for (const element of elements) {
    // The element's own joints merged in, the same merge the split uses — a joint the
    // engineer drew is a permitted boundary on this element whatever the project said.
    const merged = pourLimitsForElement(element.id, nodes, limits)
    const lifts = splitIntoLifts(element, merged)
    if (lifts.length <= 1) continue
    split.push({ elementId: element.id, lifts })
    conflicts.push(
      ...pourLiftConflicts(element.id, lifts, limits, resolveMaxLiftHeight(element, merged)),
    )
  }
  return {
    permittedJointElevations: limits.permittedJointElevations ?? null,
    jointSnapTolerance: limits.jointSnapTolerance ?? null,
    elements: split,
    conflicts,
  }
}

/**
 * What is wrong with the pour plan, in words, or nothing.
 *
 * The one sentence a stated permitted set can earn. A conflict names both halves of the
 * problem — the limit that forced the boundary and the permitted joints it is on none
 * of — because naming one and not the other sends the reader to the wrong remedy: the
 * fix for "no permitted joint satisfies the limits" is usually more permitted joints,
 * and the fix for a boundary merely near one is a wider tolerance, and the two are not
 * the same conversation.
 */
export function formworkPoursCaveats(pours: FormworkPours): string[] {
  return pours.conflicts.map((conflict) => {
    const list = conflict.permittedJointElevations.map((elevation) => `${elevation} m`).join(', ')
    return `${conflict.elementId} is cast in lifts, and a joint the split needs at ${conflict.boundaryElevation} m above the base lands on none of the permitted joints (${list || 'none stated'}) — the ${conflict.maxLiftHeight} m lift cap cannot be met on the project's stated set. The joint is placed there anyway: it is a site decision the solver could not make, and it is reported rather than passed over silently.`
  })
}
