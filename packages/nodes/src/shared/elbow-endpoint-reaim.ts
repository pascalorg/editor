import type { AnyNode, AnyNodeId, DuctFittingNode, PipeFittingNode } from '@pascal-app/core'
import { getDuctFittingPorts } from '../duct-fitting/ports'
import { getPipeFittingPorts } from '../pipe-fitting/ports'
import { planElbowRealign, planPipeElbowRealign } from './auto-fitting'

/**
 * Shared "drag a run end, the connected elbow re-aims" logic for the
 * selection-time endpoint drag — duct (`duct-segment`) and DWV pipe
 * (`pipe-segment`) alike, plus their 2D `move-path-point` twins.
 *
 * The motivating behaviour (mirrors how a wall corner drags): when you grab
 * the free end of a straight run whose OTHER end sits on an elbow collar,
 * the elbow's junction and its far (mated) collar stay put while the near
 * collar swings to face the dragged end — the bend `angle` adjusts to fit.
 * The run then goes from the re-aimed collar to wherever you drag, in ANY
 * direction, instead of being locked to the segment's original axis.
 *
 * Detection is done ONCE at drag start (`detectElbowEndpoint`) against a
 * snapshot of the elbow; the per-frame plan (`planElbowEndpointReaim`)
 * always re-derives from that original snapshot, so live mutation of the
 * elbow's angle/rotation never compounds.
 */

type Point = [number, number, number]

/** Distance (m) under which a run end counts as sitting on an elbow collar —
 *  matches core's port-coincidence epsilon. */
const COINCIDENT_EPS_M = 0.05

/** Which run kind we're editing decides which fitting kind to look for. */
type ElbowFitting = DuctFittingNode | PipeFittingNode

export type ElbowEndpoint = {
  /** The elbow node as it stood at drag start (the stable reference). */
  elbow: ElbowFitting
  /** Which elbow collar the run's non-dragged end is mated to. */
  portId: 'inlet' | 'outlet'
  /** The fitting kind, so the per-frame plan calls the right realign. */
  fittingType: 'duct-fitting' | 'pipe-fitting'
}

export type ElbowEndpointReaimPlan = {
  /** New path for the dragged run: the dragged end at the cursor, the
   *  elbow end pulled onto the re-aimed collar. */
  path: Point[]
  /** Patch re-aiming the elbow (new turn angle + orientation). */
  elbowUpdate: { id: AnyNodeId; data: { angle: number; rotation: Point } }
}

/** A run kind ('duct-segment' / 'pipe-segment') → the elbow fitting kind it
 *  mates to. Anything else has no elbow re-aim. */
function fittingTypeForRun(runKind: string): 'duct-fitting' | 'pipe-fitting' | null {
  if (runKind === 'duct-segment') return 'duct-fitting'
  if (runKind === 'pipe-segment') return 'pipe-fitting'
  return null
}

function distSq(a: Point | readonly number[], b: Point | readonly number[]): number {
  const dx = a[0]! - b[0]!
  const dy = a[1]! - b[1]!
  const dz = a[2]! - b[2]!
  return dx * dx + dy * dy + dz * dz
}

/**
 * If `runPath` is a straight two-point run whose NON-dragged end sits on an
 * elbow's inlet/outlet collar, return that elbow snapshot + the mated port
 * id. `runKind` selects which fitting kind to scan for. Otherwise null —
 * the caller falls back to plain free-drag.
 */
export function detectElbowEndpoint(
  runKind: string,
  runPath: ReadonlyArray<readonly [number, number, number]>,
  draggedIndex: number,
  nodes: Record<string, AnyNode>,
): ElbowEndpoint | null {
  if (runPath.length !== 2) return null
  const fittingType = fittingTypeForRun(runKind)
  if (!fittingType) return null
  const elbowEnd = runPath[draggedIndex === 0 ? 1 : 0]!
  const eps2 = COINCIDENT_EPS_M * COINCIDENT_EPS_M
  for (const node of Object.values(nodes)) {
    if (!node || node.type !== fittingType) continue
    const elbow = node as ElbowFitting
    if (elbow.fittingType !== 'elbow') continue
    const ports =
      fittingType === 'duct-fitting'
        ? getDuctFittingPorts(elbow as DuctFittingNode)
        : getPipeFittingPorts(elbow as PipeFittingNode)
    for (const port of ports) {
      if (port.id !== 'inlet' && port.id !== 'outlet') continue
      if (distSq(port.position, elbowEnd) <= eps2) {
        return { elbow, portId: port.id, fittingType }
      }
    }
  }
  return null
}

/**
 * Plan the run path + elbow re-aim for the dragged end at `draggedPoint`.
 * The elbow swings its mated collar to face the junction→cursor direction;
 * the run goes from that collar to the cursor. Returns null when the
 * required turn falls outside the elbow's buildable 15–90° range (caller
 * keeps the plain free-drag for that frame).
 */
export function planElbowEndpointReaim(
  endpoint: ElbowEndpoint,
  draggedIndex: number,
  draggedPoint: Point,
): ElbowEndpointReaimPlan | null {
  const { elbow, portId, fittingType } = endpoint
  const j = elbow.position
  const away: Point = [draggedPoint[0] - j[0], draggedPoint[1] - j[1], draggedPoint[2] - j[2]]
  if (away[0] * away[0] + away[1] * away[1] + away[2] * away[2] < 1e-10) return null
  const realign =
    fittingType === 'duct-fitting'
      ? planElbowRealign(elbow as DuctFittingNode, portId, away)
      : planPipeElbowRealign(elbow as PipeFittingNode, portId, away)
  if (!realign) return null
  const path: Point[] =
    draggedIndex === 0 ? [draggedPoint, realign.collarPoint] : [realign.collarPoint, draggedPoint]
  return { path, elbowUpdate: realign.update }
}
