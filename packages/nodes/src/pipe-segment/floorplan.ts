import type { FloorplanGeometry, FloorplanPoint, GeometryContext } from '@pascal-app/core'
import { INCHES_TO_METERS } from '../duct-segment/geometry'
import type { PipeSegmentNode } from './schema'

const WASTE_COLOR = '#57534e'
const VENT_COLOR = '#78716c'

/**
 * Floor-plan representation of a DWV run, following drafting convention:
 * waste lines draw SOLID at the pipe's width, vent lines draw DASHED and
 * thin. Vertical stacks collapse to a circle.
 */
export function buildPipeSegmentFloorplan(
  node: PipeSegmentNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  if (node.path.length < 2) return null

  const points: FloorplanPoint[] = []
  // Plan point k ← original path index indexMap[k] (stacks collapse to one
  // plan point), so the path-point drag handle edits the right vertex.
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
  const isVent = node.system === 'vent'
  const stroke =
    showSelectedChrome && palette ? palette.selectedStroke : isVent ? VENT_COLOR : WASTE_COLOR

  // Vertical stack — a single plan point: hub circle.
  if (points.length < 2) {
    const p = points[0] ?? [node.path[0]![0], node.path[0]![2]]
    return {
      kind: 'group',
      children: [
        {
          kind: 'circle',
          cx: p[0],
          cy: p[1],
          r: diameterM / 2 + 0.01,
          fill: 'none',
          stroke,
          strokeWidth: 2,
          vectorEffect: 'non-scaling-stroke',
          opacity: 0.95,
        },
      ],
    }
  }

  const children: FloorplanGeometry[] = [
    isVent
      ? {
          kind: 'polyline',
          points,
          stroke,
          strokeWidth: 1.5,
          vectorEffect: 'non-scaling-stroke',
          strokeDasharray: '6 4',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          opacity: 0.9,
        }
      : {
          kind: 'polyline',
          points,
          stroke,
          strokeWidth: diameterM,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          opacity: showSelectedChrome ? 0.95 : 0.85,
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
