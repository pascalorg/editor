import type { FloorplanGeometry, GeometryContext, SeparatorNode } from '@pascal-app/core'
import { WALL_PUSH_AFFORDANCE, type WallPushArrowPayload } from '@pascal-app/editor'

/** How far off the line (m) a selected invisible wall's side arrows sit. */
const SIDE_ARROW_OFFSET = 0.12

/**
 * An invisible wall on the plan: a dashed line. Selected, it shows a wall's own
 * handles — an end handle at each end (drag it; the invisible walls joined
 * there follow) and a push arrow off each side (the wall push, the ones joined
 * to it following).
 */
export function buildSeparatorFloorplan(
  node: SeparatorNode,
  ctx: GeometryContext,
): FloorplanGeometry {
  const line: FloorplanGeometry = {
    kind: 'line',
    x1: node.start[0],
    y1: node.start[1],
    x2: node.end[0],
    y2: node.end[1],
    stroke: '#818cf8',
    strokeWidth: 2,
    strokeDasharray: '6 4',
    vectorEffect: 'non-scaling-stroke',
    pointerEvents: 'stroke',
  }
  if (!ctx.viewState?.selected) return line
  const children: FloorplanGeometry[] = [line]
  for (const endpoint of ['start', 'end'] as const)
    children.push({
      kind: 'endpoint-handle',
      point: [node[endpoint][0], node[endpoint][1]],
      state: 'idle',
      affordance: 'move-endpoint',
      payload: { separatorId: node.id, endpoint },
    })
  const dx = node.end[0] - node.start[0]
  const dz = node.end[1] - node.start[1]
  const length = Math.hypot(dx, dz)
  if (length > 1e-6) {
    const middle = [(node.start[0] + node.end[0]) / 2, (node.start[1] + node.end[1]) / 2] as const
    for (const side of ['a', 'b'] as const) {
      // Side `a` is the +normal one, as a wall's front.
      const sign = side === 'a' ? 1 : -1
      const nx = (-dz / length) * sign
      const nz = (dx / length) * sign
      children.push({
        kind: 'move-arrow',
        point: [middle[0] + nx * SIDE_ARROW_OFFSET, middle[1] + nz * SIDE_ARROW_OFFSET],
        angle: Math.atan2(nz, nx),
        affordance: WALL_PUSH_AFFORDANCE,
        payload: { wallId: node.id, side } satisfies WallPushArrowPayload,
      })
    }
  }
  return { kind: 'group', children }
}
