import type { AnyNode, AnyNodeId, DuctFittingNode } from '@pascal-app/core'
import { getDuctFittingPorts } from '../duct-fitting/ports'
import { planElbowRealign } from './auto-fitting'

/**
 * Shared "drag a duct end, the connected elbow re-aims" logic for the
 * selection-time endpoint drag (3D `selection.tsx` and its 2D
 * `move-path-point` twin).
 *
 * The motivating behaviour (mirrors how a wall corner drags): when you grab
 * the free end of a straight duct whose OTHER end sits on an elbow collar,
 * the elbow's junction and its far (mated) collar stay put while the near
 * collar swings to face the dragged end — the bend `angle` adjusts to fit.
 * The duct then runs from the re-aimed collar to wherever you drag, in ANY
 * direction, instead of being locked to the segment's original axis.
 *
 * Detection is done ONCE at drag start (`detectDuctElbowEndpoint`) against a
 * snapshot of the elbow; the per-frame plan (`planDuctElbowEndpointReaim`)
 * always re-derives from that original snapshot, so live mutation of the
 * elbow's angle/rotation never compounds.
 */

type Point = [number, number, number]

/** Distance (m) under which a duct end counts as sitting on an elbow collar —
 *  matches core's port-coincidence epsilon. */
const COINCIDENT_EPS_M = 0.05

export type DuctElbowEndpoint = {
  /** The elbow node as it stood at drag start (the stable reference). */
  elbow: DuctFittingNode
  /** Which elbow collar the duct's non-dragged end is mated to. */
  portId: 'inlet' | 'outlet'
}

export type ElbowEndpointReaimPlan = {
  /** New path for the dragged duct: the dragged end at the cursor, the
   *  elbow end pulled onto the re-aimed collar. */
  path: Point[]
  /** Patch re-aiming the elbow (new turn angle + orientation). */
  elbowUpdate: { id: AnyNodeId; data: { angle: number; rotation: Point } }
}

function distSq(a: Point | readonly number[], b: Point | readonly number[]): number {
  const dx = a[0]! - b[0]!
  const dy = a[1]! - b[1]!
  const dz = a[2]! - b[2]!
  return dx * dx + dy * dy + dz * dz
}

/**
 * If `ductPath` is a straight two-point run whose NON-dragged end sits on an
 * elbow's inlet/outlet collar, return that elbow snapshot + the mated port id.
 * Otherwise null — the caller falls back to plain free-drag.
 */
export function detectDuctElbowEndpoint(
  ductPath: ReadonlyArray<readonly [number, number, number]>,
  draggedIndex: number,
  nodes: Record<string, AnyNode>,
): DuctElbowEndpoint | null {
  if (ductPath.length !== 2) return null
  const elbowEnd = ductPath[draggedIndex === 0 ? 1 : 0]!
  const eps2 = COINCIDENT_EPS_M * COINCIDENT_EPS_M
  for (const node of Object.values(nodes)) {
    if (!node || node.type !== 'duct-fitting') continue
    const elbow = node as DuctFittingNode
    if (elbow.fittingType !== 'elbow') continue
    for (const port of getDuctFittingPorts(elbow)) {
      if (port.id !== 'inlet' && port.id !== 'outlet') continue
      if (distSq(port.position, elbowEnd) <= eps2) {
        return { elbow, portId: port.id }
      }
    }
  }
  return null
}

/**
 * Plan the duct path + elbow re-aim for the dragged end at `draggedPoint`.
 * The elbow swings its mated collar to face the junction→cursor direction;
 * the duct runs from that collar to the cursor. Returns null when the
 * required turn falls outside the elbow's buildable 15–90° range (caller
 * keeps the plain free-drag for that frame).
 */
export function planDuctElbowEndpointReaim(
  endpoint: DuctElbowEndpoint,
  draggedIndex: number,
  draggedPoint: Point,
): ElbowEndpointReaimPlan | null {
  const { elbow, portId } = endpoint
  const j = elbow.position
  const away: Point = [draggedPoint[0] - j[0], draggedPoint[1] - j[1], draggedPoint[2] - j[2]]
  if (away[0] * away[0] + away[1] * away[1] + away[2] * away[2] < 1e-10) return null
  const realign = planElbowRealign(elbow, portId, away)
  if (!realign) return null
  const path: Point[] =
    draggedIndex === 0 ? [draggedPoint, realign.collarPoint] : [realign.collarPoint, draggedPoint]
  return { path, elbowUpdate: realign.update }
}
