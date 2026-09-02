import { nearestWall } from '../anchor'
import { isServicePoint } from '../kind-guards'
import type { ServicePointNode } from '../schema'
import type { LooseNodes } from '../site-frame'

/**
 * AUTO-METER — the rule that stops an overhead service drop landing on the
 * ground beside the house.
 *
 * When the last click of a POWER OVERHEAD run lands within
 * `METER_SNAP_RADIUS` of a wall and has not already snapped to a pole or a
 * service point, the run terminates at an `electric-meter` on that wall: the
 * nearest existing one if there is one within `EXISTING_METER_TOLERANCE`
 * along the wall, otherwise a new one created at the projected `wallT`. The
 * drop then lands on the meter's derived anchor — at the NEC 230.24(B)(1)
 * drip-loop height, see `utility-line/endpoints.ts` — instead of at grade.
 *
 * LIMIT, stated plainly: "exterior wall face" is not something this package
 * can test for. Nothing in the wall schema marks a wall as exterior, and this
 * package does not own wall topology, so `nearestWall` considers EVERY wall
 * in the scene. A click near an interior partition would host the meter
 * there. In practice the click that ends an overhead drop is outside the
 * building, where the nearest wall is the exterior one — but it is a
 * proximity rule, not an exterior test.
 */

/** How near a wall the final click must land to host a meter, metres. */
export const METER_SNAP_RADIUS = 1.5

/**
 * How far along the wall an existing meter may be and still be reused,
 * metres. Beyond this the drop gets its own meter rather than dragging the
 * neighbour's service across the elevation.
 */
export const EXISTING_METER_TOLERANCE = 2

export type AutoMeterPlan =
  | { kind: 'bind'; nodeId: string }
  | { kind: 'create'; wallId: string; wallT: number }
  | { kind: 'none' }

/**
 * What the final click of an overhead power run should terminate on.
 * `localPlan` is BUILDING-LOCAL metres — the frame `wall.start` / `wall.end`
 * live in (`anchor.ts`).
 *
 * Pure, so the tool and the tests decide identically.
 */
export function planAutoMeter(
  nodes: LooseNodes,
  localPlan: readonly [number, number],
  radius = METER_SNAP_RADIUS,
): AutoMeterPlan {
  const hit = nearestWall(nodes, localPlan, radius)
  if (!hit) return { kind: 'none' }

  const wallLength = Math.hypot(
    hit.geom.end[0] - hit.geom.start[0],
    hit.geom.end[1] - hit.geom.start[1],
  )
  let best: { id: string; distance: number } | null = null
  for (const candidate of Object.values(nodes)) {
    if (!isServicePoint(candidate)) continue
    const point = candidate as ServicePointNode
    if (point.serviceKind !== 'electric-meter') continue
    if (point.wallId !== hit.geom.id || typeof point.wallT !== 'number') continue
    const distance = Math.abs(point.wallT - hit.t) * wallLength
    if (!best || distance < best.distance) best = { id: point.id, distance }
  }
  if (best && best.distance <= EXISTING_METER_TOLERANCE) {
    return { kind: 'bind', nodeId: best.id }
  }
  return { kind: 'create', wallId: hit.geom.id, wallT: hit.t }
}
