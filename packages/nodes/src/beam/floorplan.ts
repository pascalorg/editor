import {
  type BeamNode,
  beamOutline,
  beamPlan,
  beamSizeLabel,
  type FloorplanGeometry,
  type GeometryContext,
} from '@pascal-app/core'
import {
  floorplanGeometryMetadata,
  formatLinearMeasurement,
  readFloorplanMetricNotationOverride,
} from '@pascal-app/editor'

/** Hidden work: a beam is over the plan's cut, so it is drawn dashed, as a framing plan draws it. */
const HIDDEN_DASH = '8 4'
const MOVE_ARROW_OFFSET = 0.17
/** Screen pixels between the beam's line and its size label (and, selected, its length). */
const LABEL_OFFSET_PX = 11

export type BeamEndpointPayload = { endpoint: 'start' | 'end' }

/**
 * A beam in the plan, the way a framing plan draws one: its width as a dashed double outline and
 * its size beside it ("6x8", "(2) 2x10"), over a clear hit area. Selected, it gets its end handles,
 * a move arrow either side and its length.
 */
export function buildBeamFloorplan(node: BeamNode, ctx: GeometryContext): FloorplanGeometry | null {
  const plan = beamPlan(node)
  if (plan.length < 1e-6) return null
  const view = ctx.viewState
  const selected = view?.selected ?? false
  const chrome = selected || (view?.highlighted ?? false)
  const stroke =
    chrome && view?.palette
      ? view.palette.selectedStroke
      : view?.hovered && view.palette
        ? view.palette.wallHoverStroke
        : '#374151'
  const mid: [number, number] = [
    (plan.start[0] + plan.end[0]) / 2,
    (plan.start[1] + plan.end[1]) / 2,
  ]
  const angle = Math.atan2(plan.direction[1], plan.direction[0])

  const children: FloorplanGeometry[] = [
    {
      kind: 'polygon',
      points: beamOutline(node),
      fill: chrome ? '#fed7aa' : 'transparent',
      fillOpacity: chrome ? 0.35 : undefined,
      stroke,
      strokeWidth: chrome ? 1.75 : 1.25,
      strokeDasharray: HIDDEN_DASH,
      vectorEffect: 'non-scaling-stroke',
      // A room's name and area move off a beam rather than hide it.
      metadata: floorplanGeometryMetadata({ annotationObstacle: 'outline' }),
    },
    // A beam is a few inches wide: a click near its line picks it at any zoom.
    {
      kind: 'hit-line',
      x1: plan.start[0],
      y1: plan.start[1],
      x2: plan.end[0],
      y2: plan.end[1],
      strokeWidthPx: 12,
    },
    {
      kind: 'dimension-label',
      cx: mid[0],
      cy: mid[1],
      text: beamSizeLabel(node),
      angle,
      offsetPx: LABEL_OFFSET_PX,
      appearance: 'outlined',
    },
  ]

  if (selected) {
    for (const endpoint of ['start', 'end'] as const)
      children.push({
        kind: 'endpoint-handle',
        point: plan[endpoint],
        state: 'idle',
        affordance: 'move-endpoint',
        payload: { endpoint } satisfies BeamEndpointPayload,
      })
    for (const side of [1, -1] as const) {
      // No affordance: the layer hands the beam to `floorplanMoveTarget`.
      const offset = (plan.width / 2 + MOVE_ARROW_OFFSET) * side
      children.push({
        kind: 'move-arrow',
        point: [mid[0] + plan.normal[0] * offset, mid[1] + plan.normal[1] * offset],
        angle: Math.atan2(plan.normal[1] * side, plan.normal[0] * side),
      })
    }
    if (plan.length >= 0.1)
      children.push({
        kind: 'dimension-label',
        cx: mid[0],
        cy: mid[1],
        text: formatLinearMeasurement(
          plan.length,
          view?.unit ?? 'metric',
          readFloorplanMetricNotationOverride(ctx) ?? 'meters',
        ),
        angle,
        offsetPx: -LABEL_OFFSET_PX - 4,
      })
  }
  return { kind: 'group', children }
}
