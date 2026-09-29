import type { FloorOpeningNode, FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import {
  createPolygonAddVertexAffordance,
  createPolygonDeleteVertexAffordance,
  createPolygonMoveEdgeAffordance,
  createPolygonVertexAffordance,
} from '../shared/polygon-vertex-affordance'

const COLOR = '#f59e0b'

/**
 * A floor opening on the plan: a dashed amber outline (the void the surfaces
 * around it show), and — while selected — the same corner, midpoint and edge
 * handles slabs and zones use.
 */
export function buildFloorOpeningFloorplan(
  node: FloorOpeningNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const polygon = node.polygon
  if (polygon.length < 3) return null
  const selected = ctx.viewState?.selected ?? false
  const d = `M ${polygon.map(([x, z]) => `${x} ${z}`).join(' L ')} Z`
  const children: FloorplanGeometry[] = [
    {
      kind: 'path',
      d,
      fill: COLOR,
      fillOpacity: selected ? 0.22 : 0.1,
      stroke: COLOR,
      strokeWidth: selected ? 0.04 : 0.03,
      strokeOpacity: 0.95,
      strokeDasharray: '0.12 0.08',
    },
  ]
  if (selected) {
    polygon.forEach((a, i) => {
      const b = polygon[(i + 1) % polygon.length]!
      children.push({
        kind: 'edge-handle',
        x1: a[0],
        y1: a[1],
        x2: b[0],
        y2: b[1],
        affordance: 'move-edge',
        payload: { edgeIndex: i },
      })
    })
    polygon.forEach((a, i) => {
      const b = polygon[(i + 1) % polygon.length]!
      children.push({
        kind: 'midpoint-handle',
        point: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
        affordance: 'add-vertex',
        payload: { edgeIndex: i },
      })
    })
    polygon.forEach(([x, z], i) => {
      children.push({
        kind: 'endpoint-handle',
        point: [x, z],
        state: 'idle',
        affordance: 'move-vertex',
        payload: { vertexIndex: i },
      })
    })
  }
  return { kind: 'group', children }
}

export const floorOpeningMoveVertexAffordance =
  createPolygonVertexAffordance<FloorOpeningNode>('floor-opening')
export const floorOpeningAddVertexAffordance =
  createPolygonAddVertexAffordance<FloorOpeningNode>('floor-opening')
export const floorOpeningMoveEdgeAffordance =
  createPolygonMoveEdgeAffordance<FloorOpeningNode>('floor-opening')
export const floorOpeningDeleteVertexAffordance =
  createPolygonDeleteVertexAffordance<FloorOpeningNode>('floor-opening')
