import type { FloorplanGeometry, FloorplanPoint, GeometryContext } from '@pascal-app/core'
import { INCHES_TO_METERS } from './geometry'
import type { DuctSegmentNode } from './schema'

const SUPPLY_CENTERLINE = '#d4825a'
const RETURN_CENTERLINE = '#5a8ad4'
const BODY_COLOR = '#9ca3af'
/** Move-arrow stand-off past the duct body, in plan meters. */
const SIDE_ARROW_GAP = 0.27
/** Below this plan length a segment / end has no usable direction. */
const MIN_SEGMENT_LEN = 0.05

/**
 * Floor-plan representation of a duct run: the path drawn at the duct's
 * real width (plan-unit stroke so it scales with zoom), with a dashed
 * centerline tinted by system — orange for supply, blue for return, the
 * same hues the 3D tint uses. Vertical risers collapse to a point in
 * plan; consecutive duplicate plan points are dropped so they don't
 * render zero-length artifacts.
 */
export function buildDuctSegmentFloorplan(
  node: DuctSegmentNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  if (node.path.length < 2) return null

  // Project to plan, dropping consecutive duplicates (risers). `indexMap[k]`
  // is the original path index plan point k came from, so the drag handle
  // edits the right vertex.
  const points: FloorplanPoint[] = []
  const indexMap: number[] = []
  for (let i = 0; i < node.path.length; i++) {
    const [x, , z] = node.path[i]!
    const prev = points[points.length - 1]
    if (prev && Math.abs(prev[0] - x) < 1e-6 && Math.abs(prev[1] - z) < 1e-6) continue
    points.push([x, z])
    indexMap.push(i)
  }

  // Plan width: rect / oval runs draw at their actual width; round at diameter.
  const diameterM = (node.shape === 'round' ? node.diameter : node.width) * INCHES_TO_METERS
  const view = ctx.viewState
  const palette = view?.palette
  const showSelectedChrome = (view?.selected || view?.highlighted) ?? false
  const centerline = node.system === 'supply' ? SUPPLY_CENTERLINE : RETURN_CENTERLINE

  // A pure riser (single plan point) still gets a marker: a circle at
  // the duct's diameter so the vertical run is visible in plan.
  if (points.length < 2) {
    const p = points[0] ?? [node.path[0]![0], node.path[0]![2]]
    return {
      kind: 'group',
      children: [
        {
          kind: 'circle',
          cx: p[0],
          cy: p[1],
          r: diameterM / 2,
          fill: BODY_COLOR,
          stroke: showSelectedChrome && palette ? palette.selectedStroke : centerline,
          strokeWidth: 0.02,
          opacity: 0.9,
        },
      ],
    }
  }

  const children: FloorplanGeometry[] = [
    {
      kind: 'polyline',
      points,
      stroke: showSelectedChrome && palette ? palette.selectedStroke : BODY_COLOR,
      strokeWidth: diameterM,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      opacity: showSelectedChrome ? 0.95 : 0.8,
    },
    {
      kind: 'polyline',
      points,
      stroke: centerline,
      strokeWidth: 1.5,
      vectorEffect: 'non-scaling-stroke',
      strokeDasharray: '5 4',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      opacity: 0.9,
    },
  ]

  // Selection chrome: one draggable handle per path vertex (2D twin of the
  // 3D selection handles). Routes to the shared `move-path-point` affordance.
  if (view?.selected) {
    for (let k = 0; k < points.length; k++) {
      children.push({
        kind: 'endpoint-handle',
        point: points[k]!,
        state: 'idle',
        affordance: 'move-path-point',
        payload: { pointIndex: indexMap[k]! },
      })
    }

    // Side-move arrows: a front / back pair at each segment midpoint, sliding
    // that segment perpendicular to itself. 2D twin of the 3D side-move
    // arrows. The arrows stand one duct-radius + gap off the body; `angle`
    // points each chevron outward along the segment normal.
    const offset = diameterM / 2 + SIDE_ARROW_GAP
    for (let k = 0; k < points.length - 1; k++) {
      const a = points[k]!
      const b = points[k + 1]!
      const dx = b[0] - a[0]
      const dz = b[1] - a[1]
      const len = Math.hypot(dx, dz)
      if (len < MIN_SEGMENT_LEN) continue
      const normal: [number, number] = [-dz / len, dx / len]
      const mid: FloorplanPoint = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      for (const side of [1, -1] as const) {
        const n: [number, number] = [normal[0] * side, normal[1] * side]
        children.push({
          kind: 'move-arrow',
          point: [mid[0] + n[0] * offset, mid[1] + n[1] * offset],
          angle: Math.atan2(n[1], n[0]),
          affordance: 'move-segment',
          payload: { segmentIndex: indexMap[k]!, normal: n },
        })
      }
    }
  }

  return { kind: 'group', children }
}
