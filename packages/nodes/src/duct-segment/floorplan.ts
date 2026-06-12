import type { FloorplanGeometry, FloorplanPoint, GeometryContext } from '@pascal-app/core'
import { INCHES_TO_METERS } from './geometry'
import type { DuctSegmentNode } from './schema'

const SUPPLY_CENTERLINE = '#d4825a'
const RETURN_CENTERLINE = '#5a8ad4'
const BODY_COLOR = '#9ca3af'

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

  // Project to plan, dropping consecutive duplicates (risers).
  const points: FloorplanPoint[] = []
  for (const [x, , z] of node.path) {
    const prev = points[points.length - 1]
    if (prev && Math.abs(prev[0] - x) < 1e-6 && Math.abs(prev[1] - z) < 1e-6) continue
    points.push([x, z])
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

  return { kind: 'group', children }
}
