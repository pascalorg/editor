import type { FloorplanGeometry, FloorplanPoint, GeometryContext } from '@pascal-app/core'
import { INCHES_TO_METERS } from '../duct-segment/geometry'
import type { LinesetNode } from './schema'

const COPPER_LINE = '#b06b3f'
const BODY_COLOR = '#9ca3af'

/**
 * Floor-plan representation of a lineset: the path drawn at the suction
 * jacket's real width with a dashed copper centerline. Vertical risers
 * collapse to a point in plan; consecutive duplicate plan points are
 * dropped so they don't render zero-length artifacts.
 */
export function buildLinesetFloorplan(
  node: LinesetNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  if (node.path.length < 2) return null

  const points: FloorplanPoint[] = []
  // Plan point k ← original path index indexMap[k] (risers collapse to one
  // plan point), so the path-point drag handle edits the right vertex.
  const indexMap: number[] = []
  for (let i = 0; i < node.path.length; i++) {
    const [x, , z] = node.path[i]!
    const prev = points[points.length - 1]
    if (prev && Math.abs(prev[0] - x) < 1e-6 && Math.abs(prev[1] - z) < 1e-6) continue
    points.push([x, z])
    indexMap.push(i)
  }

  const widthM = Math.max(node.suctionDiameter, node.liquidDiameter) * INCHES_TO_METERS
  const view = ctx.viewState
  const palette = view?.palette
  const showSelectedChrome = (view?.selected || view?.highlighted) ?? false

  if (points.length < 2) {
    const p = points[0] ?? [node.path[0]![0], node.path[0]![2]]
    return {
      kind: 'circle',
      cx: p[0],
      cy: p[1],
      r: widthM,
      fill: BODY_COLOR,
      stroke: showSelectedChrome && palette ? palette.selectedStroke : COPPER_LINE,
      strokeWidth: 0.02,
      opacity: 0.9,
    }
  }

  const children: FloorplanGeometry[] = [
    {
      kind: 'polyline',
      points,
      stroke: showSelectedChrome && palette ? palette.selectedStroke : BODY_COLOR,
      strokeWidth: widthM * 2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      opacity: showSelectedChrome ? 0.95 : 0.8,
    },
    {
      kind: 'polyline',
      points,
      stroke: COPPER_LINE,
      strokeWidth: 1.5,
      vectorEffect: 'non-scaling-stroke',
      strokeDasharray: '4 3',
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
  }

  return { kind: 'group', children }
}
