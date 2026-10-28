import type {
  FloorplanGeometry,
  FloorplanPoint,
  FoundationNode,
  GeometryContext,
} from '@pascal-app/core'
import { formatLinearMeasurement, readFloorplanMetricNotationOverride } from '@pascal-app/editor'

/** The tool's draft, shown before the outline closes: drawn in full, open or closed. */
export const FOUNDATION_DRAFT_ID = 'foundation_draft'

const OUTLINE = '#475569'
/** A side's push arrow stands this far out of the outline, metres, clear of its midpoint handle. */
const ARROW_OFFSET = 0.3
/** The push arrow at this times the usual size: a foundation is seen whole, zoomed out. */
const ARROW_SCALE = 2.5

/**
 * A foundation outline in the plan, only ever shown in the foundation view (the concrete itself is
 * the foundation layer's drawing). At rest it is its own hit area, clear; hovered or selected its
 * edge shows, and selected it carries the polygon editor: a corner handle at every corner (it
 * squares up to its neighbours), a midpoint handle that adds one, each side draggable square to
 * itself by its line or by the arrow out of it, every side's length. The tool's draft draws as a
 * solid line, open until it closes.
 */
export function buildFoundationFloorplan(
  node: FoundationNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const polygon = node.polygon
  const view = ctx.viewState
  const draft = node.id === FOUNDATION_DRAFT_ID
  if (polygon.length < (draft ? 2 : 3)) return null
  const selected = view?.selected ?? false
  const chrome = selected || (view?.highlighted ?? false)
  const points: FloorplanPoint[] = polygon.map(([x, z]) => [x, z])
  const closed = polygon.length >= 3

  const stroke =
    chrome && view?.palette
      ? view.palette.selectedStroke
      : view?.hovered && view.palette
        ? view.palette.wallHoverStroke
        : draft
          ? OUTLINE
          : 'none'
  const children: FloorplanGeometry[] = [
    closed
      ? {
          kind: 'polygon',
          points,
          fill: chrome ? (view?.palette?.selectedFill ?? 'transparent') : 'transparent',
          fillOpacity: chrome ? 0.12 : undefined,
          stroke,
          strokeWidth: chrome ? 2 : 1.6,
          vectorEffect: 'non-scaling-stroke',
        }
      : {
          kind: 'line',
          x1: points[0]![0],
          y1: points[0]![1],
          x2: points[1]![0],
          y2: points[1]![1],
          stroke,
          strokeWidth: 1.6,
          vectorEffect: 'non-scaling-stroke',
          pointerEvents: 'none',
        },
  ]

  if (selected && !draft) {
    const unit = view?.unit ?? 'metric'
    const notation = readFloorplanMetricNotationOverride(ctx) ?? 'meters'
    // Out of the outline: to the right of each side as a counter-clockwise ring winds (x, z).
    let area = 0
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!
      const b = points[(i + 1) % points.length]!
      area += a[0] * b[1] - b[0] * a[1]
    }
    const out = area > 0 ? 1 : -1
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!
      const b = points[(i + 1) % points.length]!
      children.push({
        kind: 'edge-handle',
        x1: a[0],
        y1: a[1],
        x2: b[0],
        y2: b[1],
        affordance: 'move-edge',
        payload: { edgeIndex: i },
      })
      const side = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (side >= 0.2) {
        const [nx, nz] = [((b[1] - a[1]) / side) * out, (-(b[0] - a[0]) / side) * out]
        children.push({
          kind: 'move-arrow',
          point: [(a[0] + b[0]) / 2 + nx * ARROW_OFFSET, (a[1] + b[1]) / 2 + nz * ARROW_OFFSET],
          angle: Math.atan2(nz, nx),
          affordance: 'move-edge',
          payload: { edgeIndex: i },
          scale: ARROW_SCALE,
        })
      }
      const length = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (length >= 0.2)
        children.push({
          kind: 'dimension-label',
          cx: (a[0] + b[0]) / 2,
          cy: (a[1] + b[1]) / 2,
          text: formatLinearMeasurement(length, unit, notation),
          angle: Math.atan2(b[1] - a[1], b[0] - a[0]),
        })
    }
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!
      const b = points[(i + 1) % points.length]!
      children.push({
        kind: 'midpoint-handle',
        point: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
        affordance: 'add-vertex',
        payload: { edgeIndex: i },
      })
    }
    points.forEach((point, i) => {
      children.push({
        kind: 'endpoint-handle',
        point,
        state: 'idle',
        affordance: 'move-vertex',
        payload: { vertexIndex: i },
      })
    })
  }
  return { kind: 'group', children }
}
