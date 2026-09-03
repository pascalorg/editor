/**
 * ATTACH A FREE END — the repair for a run that "doesn't actually connect to
 * anything".
 *
 * A `utility-line` drawn before the auto-meter rule existed, or ended with a
 * click that missed every snap target, keeps a stored last vertex and
 * `toRef: null`. On paper that is a wire that stops in the yard. This module
 * finds what that end SHOULD land on and produces the patch that binds it:
 *
 *   - power / overhead  → the nearest `electric-meter` service point, or the
 *     nearest pole (a pole-to-pole span) — whichever is closer to the end,
 *     within `radius`;
 *   - every other system → the nearest service point of that system
 *     (water meter, gas meter, cleanout …), else nothing.
 *
 * Binding an end DROPS the stored vertex for it (`endpoints.ts` derives the
 * attachment from the node), so the run is measured to the meter and follows
 * it. Pure; the panel applies the patch through the scene store.
 */
import { isServicePoint, isUtilityPole } from '../kind-guards'
import type { ServicePointNode, UtilityLineNode, UtilityPoleNode } from '../schema'
import { SERVICE_POINT_SYSTEM } from '../schema'
import type { LooseNodes } from '../site-frame'
import { polePlan, resolveLineEndpoints, servicePointAnchor } from './endpoints'
import { resolveFrame } from '../site-frame'

/** How far a free end may be from a meter / pole and still be bound, metres. */
export const ATTACH_RADIUS = 12

export type AttachPlan = {
  end: 'from' | 'to'
  nodeId: string
  kind: 'pole' | 'service-point'
  distance: number
  /** The node patch that binds the end. */
  patch: Partial<UtilityLineNode>
}

/** The free ends of a line, if any. */
export function freeEnds(line: UtilityLineNode): ('from' | 'to')[] {
  const ends: ('from' | 'to')[] = []
  if (!line.fromRef) ends.push('from')
  if (!line.toRef) ends.push('to')
  return ends
}

/**
 * The best attachment for `end` of `line`, or null when nothing suitable is
 * within `radius`. Uses the RESOLVED path so a linked far end is measured
 * from where it really is.
 */
export function planAttach(
  nodes: LooseNodes,
  line: UtilityLineNode,
  end: 'from' | 'to',
  radius = ATTACH_RADIUS,
): AttachPlan | null {
  const resolved = resolveLineEndpoints(nodes, line)
  const path = resolved.path
  if (path.length < 2) return null
  const vertex = end === 'from' ? path[0] : path[path.length - 1]
  if (!vertex) return null
  const at: [number, number] = [vertex[0], vertex[2]]
  const other = end === 'from' ? line.toRef : line.fromRef
  const frame = resolveFrame(nodes, line as unknown as Record<string, unknown>)
  const ctx = { resolve: (id: string) => nodes[id], frame }

  let best: AttachPlan | null = null
  const consider = (
    nodeId: string,
    kind: AttachPlan['kind'],
    plan: readonly [number, number],
  ) => {
    if (nodeId === other) return
    const distance = Math.hypot(plan[0] - at[0], plan[1] - at[1])
    if (distance > radius) return
    if (best && best.distance <= distance) return
    best = { end, nodeId, kind, distance, patch: bindPatch(line, end, nodeId) }
  }

  for (const [id, node] of Object.entries(nodes)) {
    if (isServicePoint(node)) {
      const point = node as ServicePointNode
      if (SERVICE_POINT_SYSTEM[point.serviceKind] !== line.system) continue
      const anchor = servicePointAnchor(ctx, point)
      consider(id, 'service-point', [anchor[0], anchor[2]])
    } else if (isUtilityPole(node) && line.system === 'power' && line.routing === 'overhead') {
      consider(id, 'pole', polePlan(node as UtilityPoleNode))
    }
  }
  return best
}

/**
 * The patch that binds one end to `nodeId`: the ref, and the stored path
 * with that end's vertex removed when the run has an intermediate vertex to
 * spare (a two-vertex run keeps its shape; the derived end overrides it).
 */
export function bindPatch(
  line: UtilityLineNode,
  end: 'from' | 'to',
  nodeId: string,
): Partial<UtilityLineNode> {
  const path = line.path.map((p) => [p[0], p[1], p[2]] as [number, number, number])
  if (path.length > 2) {
    if (end === 'from') path.shift()
    else path.pop()
  }
  return end === 'from' ? { fromRef: nodeId, path } : { toRef: nodeId, path }
}
