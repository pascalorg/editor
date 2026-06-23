import type { AnyNode, AnyNodeId, DuctFittingNode, PipeFittingNode } from '@pascal-app/core'
import { getDuctFittingPorts } from '../duct-fitting/ports'
import { getPipeFittingPorts } from '../pipe-fitting/ports'
import { planElbowRealign, planPipeElbowRealign, planTeeBranchRealign } from './auto-fitting'

/**
 * Shared "drag a run end, the connected fitting re-aims" logic for the
 * selection-time endpoint drag — duct (`duct-segment`) and DWV pipe
 * (`pipe-segment`) alike, plus their 2D `move-path-point` twins.
 *
 * Two re-aim shapes share this path:
 *
 *  - **Elbow** (duct + pipe): when you grab the free end of a straight run
 *    whose OTHER end sits on an elbow collar, the elbow's junction and far
 *    (mated) collar stay put while the near collar swings to face the
 *    dragged end — the bend `angle` adjusts to fit. Mirrors a wall corner.
 *
 *  - **Tee branch** (duct only): when you grab the free end of a run mated
 *    to a tee's BRANCH collar, the tee's run legs stay locked to the trunk
 *    and only its `branchAngle` swings, so the branch keeps pointing at the
 *    dragged end.
 *
 * Detection runs ONCE at drag start (`detectFittingEndpoint`) against a
 * snapshot of the fitting; the per-frame plan (`planFittingEndpointReaim`)
 * always re-derives from that original snapshot, so live mutation of the
 * fitting never compounds.
 */

type Point = [number, number, number]

/** Distance (m) under which a run end counts as sitting on a fitting collar —
 *  matches core's port-coincidence epsilon. */
const COINCIDENT_EPS_M = 0.05

/** Which run kind we're editing decides which fitting kind to look for. */
type ReaimFitting = DuctFittingNode | PipeFittingNode

export type FittingEndpoint = {
  /** The fitting node as it stood at drag start (the stable reference). */
  fitting: ReaimFitting
  /** Whether the re-aim re-orients the whole elbow body or just swings a
   *  duct tee's branch lean. */
  reaim: 'elbow' | 'tee-branch'
  /** Which fitting collar the run's non-dragged end is mated to. */
  portId: 'inlet' | 'outlet' | 'branch'
  /** The fitting kind, so the per-frame plan calls the right realign. */
  fittingType: 'duct-fitting' | 'pipe-fitting'
  /** Patch that restores the fitting to its drag-start state, for the
   *  single-undo dance's pre-resume revert. */
  revert: { id: AnyNodeId; data: Partial<AnyNode> }
}

export type FittingEndpointReaimPlan = {
  /** New path for the dragged run: the dragged end at the cursor, the
   *  fitting end pulled onto the re-aimed collar. */
  path: Point[]
  /** Patch re-aiming the fitting (elbow: angle + rotation; tee: branchAngle). */
  fittingUpdate: { id: AnyNodeId; data: Partial<AnyNode> }
}

/** A run kind ('duct-segment' / 'pipe-segment') → the fitting kind it
 *  mates to. Anything else has no re-aim. */
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
 * If `runPath` is a straight two-point run whose NON-dragged end sits on a
 * fitting collar that can re-aim, return that fitting snapshot + the mated
 * port id and re-aim shape. `runKind` selects which fitting kind to scan
 * for. Elbow inlet/outlet collars re-aim the whole elbow; a duct tee's
 * branch collar swings only the branch. Otherwise null — the caller falls
 * back to plain free-drag.
 */
export function detectFittingEndpoint(
  runKind: string,
  runPath: ReadonlyArray<readonly [number, number, number]>,
  draggedIndex: number,
  nodes: Record<string, AnyNode>,
): FittingEndpoint | null {
  if (runPath.length !== 2) return null
  const fittingType = fittingTypeForRun(runKind)
  if (!fittingType) return null
  const fittingEnd = runPath[draggedIndex === 0 ? 1 : 0]!
  const eps2 = COINCIDENT_EPS_M * COINCIDENT_EPS_M
  for (const node of Object.values(nodes)) {
    if (!node || node.type !== fittingType) continue
    const fitting = node as ReaimFitting
    const isElbow = fitting.fittingType === 'elbow'
    // Tee-branch re-aim is duct-only (a sanitary tee has no adjustable
    // branch lean).
    const isDuctTee = fittingType === 'duct-fitting' && fitting.fittingType === 'tee'
    if (!isElbow && !isDuctTee) continue
    const ports =
      fittingType === 'duct-fitting'
        ? getDuctFittingPorts(fitting as DuctFittingNode)
        : getPipeFittingPorts(fitting as PipeFittingNode)
    for (const port of ports) {
      if (isElbow && port.id !== 'inlet' && port.id !== 'outlet') continue
      if (isDuctTee && port.id !== 'branch') continue
      if (distSq(port.position, fittingEnd) > eps2) continue
      if (isElbow) {
        return {
          fitting,
          reaim: 'elbow',
          portId: port.id as 'inlet' | 'outlet',
          fittingType,
          revert: {
            id: fitting.id as AnyNodeId,
            data: { angle: fitting.angle, rotation: fitting.rotation } as Partial<AnyNode>,
          },
        }
      }
      return {
        fitting,
        reaim: 'tee-branch',
        portId: 'branch',
        fittingType,
        revert: {
          id: fitting.id as AnyNodeId,
          data: { branchAngle: (fitting as DuctFittingNode).branchAngle } as Partial<AnyNode>,
        },
      }
    }
  }
  return null
}

/**
 * Plan the run path + fitting re-aim for the dragged end at `draggedPoint`.
 * The fitting swings its mated collar to face the junction→cursor direction;
 * the run goes from that collar to the cursor. Returns null when the
 * required turn falls outside the fitting's buildable range (caller keeps
 * the plain free-drag for that frame).
 */
export function planFittingEndpointReaim(
  endpoint: FittingEndpoint,
  draggedIndex: number,
  draggedPoint: Point,
): FittingEndpointReaimPlan | null {
  const { fitting, reaim, portId, fittingType } = endpoint
  const j = fitting.position
  const away: Point = [draggedPoint[0] - j[0], draggedPoint[1] - j[1], draggedPoint[2] - j[2]]
  if (away[0] * away[0] + away[1] * away[1] + away[2] * away[2] < 1e-10) return null

  if (reaim === 'tee-branch') {
    const realign = planTeeBranchRealign(fitting as DuctFittingNode, away)
    if (!realign) return null
    const path: Point[] =
      draggedIndex === 0 ? [draggedPoint, realign.collarPoint] : [realign.collarPoint, draggedPoint]
    return {
      path,
      fittingUpdate: {
        id: realign.update.id as AnyNodeId,
        data: realign.update.data as Partial<AnyNode>,
      },
    }
  }

  const realign =
    fittingType === 'duct-fitting'
      ? planElbowRealign(fitting as DuctFittingNode, portId, away)
      : planPipeElbowRealign(fitting as PipeFittingNode, portId, away)
  if (!realign) return null
  const path: Point[] =
    draggedIndex === 0 ? [draggedPoint, realign.collarPoint] : [realign.collarPoint, draggedPoint]
  return {
    path,
    fittingUpdate: {
      id: realign.update.id as AnyNodeId,
      data: realign.update.data as Partial<AnyNode>,
    },
  }
}
