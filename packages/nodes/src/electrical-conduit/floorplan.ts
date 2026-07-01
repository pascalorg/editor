import type { FloorplanGeometry, FloorplanPoint, GeometryContext } from '@pascal-app/core'
import { INCHES_TO_METERS } from '../duct-segment/geometry'
import type { ElectricalConduitNode } from './schema'

// Conduit system colors — distinct enough to read at plan scale.
const POWER_COLOR = '#f59e0b'
const LIGHTING_COLOR = '#a78bfa'
const DATA_COLOR = '#34d399'

function getConduitColor(node: ElectricalConduitNode): string {
  if (node.system === 'lighting') return LIGHTING_COLOR
  if (node.system === 'data') return DATA_COLOR
  return POWER_COLOR
}

/**
 * Floor-plan representation of an electrical conduit run. Lines are drawn
 * dashed (electrical convention) and color-coded by system: power (amber),
 * lighting (violet), data (green).
 */
export function buildElectricalConduitFloorplan(
  node: ElectricalConduitNode,
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

  const view = ctx.viewState
  const palette = view?.palette
  const showSelectedChrome = (view?.selected || view?.highlighted) ?? false
  const baseColor = getConduitColor(node)
  const stroke = showSelectedChrome && palette ? palette.selectedStroke : baseColor
  const diameterM = node.diameter * INCHES_TO_METERS

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
    }
  }

  const children: FloorplanGeometry[] = [
    {
      kind: 'polyline',
      points,
      stroke,
      strokeWidth: 1.5,
      vectorEffect: 'non-scaling-stroke',
      strokeDasharray: '8 4',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      opacity: showSelectedChrome ? 0.95 : 0.85,
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
