import type { FloorplanGeometry, FloorplanPoint, GeometryContext } from '@pascal-app/core'
import { INCHES_TO_METERS } from '../duct-segment/geometry'
import type { WaterLineNode } from './schema'

const COLD_COLOR = '#3b82f6'
const HOT_COLOR = '#ef4444'

/**
 * Floor-plan representation of a water supply run. Cold lines draw solid
 * blue; hot lines draw solid red. Both at the pipe's nominal width for
 * readability at residential scale.
 */
export function buildWaterLineFloorplan(
  node: WaterLineNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  if (node.path.length < 2) return null

  const points: FloorplanPoint[] = []
  const indexMap: number[] = []
  for (let i = 0; i < node.path.length; i++) {
    const [x, , z] = node.path[i]!
    const prev = points[points.length - 1]
    if (prev && Math.abs(prev[0] - x) < 1e-6 && Math.abs(prev[1] - z) < 1e-6) continue
    points.push([x, z])
    indexMap.push(i)
  }

  const diameterM = node.diameter * INCHES_TO_METERS
  const view = ctx.viewState
  const palette = view?.palette
  const showSelectedChrome = (view?.selected || view?.highlighted) ?? false
  const baseColor = node.system === 'hot-water' ? HOT_COLOR : COLD_COLOR
  const stroke = showSelectedChrome && palette ? palette.selectedStroke : baseColor

  // Vertical stack — collapse to a circle.
  if (points.length < 2) {
    const p = points[0] ?? [node.path[0]![0], node.path[0]![2]]
    return {
      kind: 'circle',
      cx: p[0],
      cy: p[1],
      r: diameterM / 2 + 0.01,
      fill: 'none',
      stroke,
      strokeWidth: 2,
      vectorEffect: 'non-scaling-stroke',
      opacity: 0.9,
    }
  }

  const children: FloorplanGeometry[] = [
    {
      kind: 'polyline',
      points,
      stroke,
      strokeWidth: diameterM,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      opacity: showSelectedChrome ? 0.95 : 0.8,
    },
  ]

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
