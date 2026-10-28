import {
  type FloorplanGeometry,
  type FootingNode,
  footingOutline,
  footingPlan,
  type GeometryContext,
} from '@pascal-app/core'
import {
  floorplanGeometryMetadata,
  formatLinearMeasurement,
  readFloorplanMetricNotationOverride,
} from '@pascal-app/editor'

/** Hidden work: footings are drawn dashed, as a plan draws what is under the floor. */
const HIDDEN_DASH = '6 4'
const CENTRELINE_DASH = '12 3 2 3'
const HANDLE_OFFSET = 0.12
const ROTATE_OFFSET = 0.22

export type FootingEndpointPayload = { endpoint: 'start' | 'end' }
export type FootingWidthPayload = { side: 1 | -1 }
export type FootingSizePayload = { dim: 'width' | 'length'; planAxis: [number, number] }

/**
 * A footing in the plan: its outline and centreline dashed as hidden lines, over a clear hit
 * area. Selected, a strip gets its end handles, side width handles and the two move arrows; a pad
 * its move dot, a size arrow per side and the rotate arrow.
 */
export function buildFootingFloorplan(
  node: FootingNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const plan = footingPlan(node)
  if (!plan) return null
  const view = ctx.viewState
  const selected = view?.selected ?? false
  const chrome = selected || (view?.highlighted ?? false)
  const stroke =
    chrome && view?.palette
      ? view.palette.selectedStroke
      : view?.hovered && view.palette
        ? view.palette.wallHoverStroke
        : '#6b7280'
  const outline = footingOutline(plan)
  const line = (a: [number, number], b: [number, number]): FloorplanGeometry => ({
    kind: 'line',
    x1: a[0],
    y1: a[1],
    x2: b[0],
    y2: b[1],
    stroke,
    strokeWidth: 1,
    strokeDasharray: CENTRELINE_DASH,
    vectorEffect: 'non-scaling-stroke',
    pointerEvents: 'none',
  })

  const children: FloorplanGeometry[] = [
    {
      kind: 'polygon',
      points: outline,
      fill: chrome ? '#fed7aa' : 'transparent',
      fillOpacity: chrome ? 0.35 : undefined,
      stroke,
      strokeWidth: chrome ? 1.75 : 1.25,
      strokeDasharray: HIDDEN_DASH,
      vectorEffect: 'non-scaling-stroke',
      // The room's name and area move off a footing rather than hide it.
      metadata: floorplanGeometryMetadata({ annotationObstacle: 'outline' }),
    },
  ]

  if (plan.shape === 'strip') {
    children.push(line(plan.start, plan.end))
    if (selected) {
      const dx = plan.end[0] - plan.start[0]
      const dz = plan.end[1] - plan.start[1]
      const length = Math.hypot(dx, dz)
      const [nx, nz] = length > 1e-9 ? [-dz / length, dx / length] : [0, 1]
      const mid: [number, number] = [
        (plan.start[0] + plan.end[0]) / 2,
        (plan.start[1] + plan.end[1]) / 2,
      ]
      for (const endpoint of ['start', 'end'] as const)
        children.push({
          kind: 'endpoint-handle',
          point: plan[endpoint],
          state: 'idle',
          affordance: 'move-endpoint',
          payload: { endpoint } satisfies FootingEndpointPayload,
        })
      for (const side of [1, -1] as const) {
        children.push({
          kind: 'endpoint-handle',
          point: [mid[0] + nx * (plan.width / 2) * side, mid[1] + nz * (plan.width / 2) * side],
          state: 'idle',
          affordance: 'width',
          payload: { side } satisfies FootingWidthPayload,
        })
        // No affordance: the layer hands the footing to `floorplanMoveTarget`.
        const offset = plan.width / 2 + HANDLE_OFFSET + 0.05
        children.push({
          kind: 'move-arrow',
          point: [mid[0] + nx * offset * side, mid[1] + nz * offset * side],
          angle: Math.atan2(nz * side, nx * side),
        })
      }
      if (length >= 0.1)
        children.push({
          kind: 'dimension-label',
          cx: mid[0],
          cy: mid[1],
          text: formatLinearMeasurement(
            length,
            view?.unit ?? 'metric',
            readFloorplanMetricNotationOverride(ctx) ?? 'meters',
          ),
          angle: Math.atan2(dz, dx),
        })
    }
    return { kind: 'group', children }
  }

  const { center, width, length, rotation } = plan
  const ax: [number, number] = [Math.cos(rotation), -Math.sin(rotation)]
  const az: [number, number] = [Math.sin(rotation), Math.cos(rotation)]
  const along = (axis: [number, number], distance: number): [number, number] => [
    center[0] + axis[0] * distance,
    center[1] + axis[1] * distance,
  ]
  children.push(line(along(ax, -width / 2), along(ax, width / 2)))
  children.push(line(along(az, -length / 2), along(az, length / 2)))
  if (selected) {
    children.push({ kind: 'move-handle', point: center })
    for (const [dim, axis, half] of [
      ['width', ax, width / 2],
      ['length', az, length / 2],
    ] as const)
      children.push({
        kind: 'move-arrow',
        point: along(axis, half + HANDLE_OFFSET),
        angle: Math.atan2(axis[1], axis[0]),
        affordance: 'size',
        payload: { dim, planAxis: [axis[0], axis[1]] } satisfies FootingSizePayload,
      })
    const corner: [number, number] = [
      center[0] + ax[0] * (width / 2 + ROTATE_OFFSET) + az[0] * (length / 2 + ROTATE_OFFSET),
      center[1] + ax[1] * (width / 2 + ROTATE_OFFSET) + az[1] * (length / 2 + ROTATE_OFFSET),
    ]
    children.push({
      kind: 'rotate-arrow',
      point: corner,
      angle: Math.atan2(corner[1] - center[1], corner[0] - center[0]),
      affordance: 'rotate',
      pivot: center,
    })
  }
  return { kind: 'group', children }
}
