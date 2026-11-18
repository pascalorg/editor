import {
  distanceToBoundary,
  type FloorplanGeometry,
  floorplanGeometryMetadata,
  type GeometryContext,
  type LawnNode,
} from '@pascal-app/core'
import { buildVisibleLawn } from './render-build'

const ringPath = (ring: [number, number][]) => `M${ring.map(([x, z]) => `${x} ${z}`).join('L')}Z`

function outlineHandles(node: LawnNode): FloorplanGeometry[] {
  const edges: FloorplanGeometry[] = []
  const midpoints: FloorplanGeometry[] = []
  const corners: FloorplanGeometry[] = []
  node.outline.forEach((point, index) => {
    const next = node.outline[(index + 1) % node.outline.length]
    if (!next) return
    edges.push({
      kind: 'edge-handle',
      x1: point[0],
      y1: point[1],
      x2: next[0],
      y2: next[1],
      affordance: 'move-edge',
      payload: { edgeIndex: index },
    })
    midpoints.push({
      kind: 'midpoint-handle',
      point: [(point[0] + next[0]) / 2, (point[1] + next[1]) / 2],
      affordance: 'add-vertex',
      payload: { edgeIndex: index },
    })
    corners.push({
      kind: 'endpoint-handle',
      point: [point[0], point[1]],
      state: 'idle',
      affordance: 'move-vertex',
      payload: { vertexIndex: index },
    })
  })
  return [...edges, ...midpoints, ...corners]
}

export function buildLawnFloorplan(
  node: LawnNode,
  ctx?: Partial<GeometryContext>,
): FloorplanGeometry | null {
  const built = buildVisibleLawn(node, ctx)
  if (!built?.polygons.length) return null
  const view = ctx?.viewState
  const marked = view?.selected || view?.highlighted
  const body: FloorplanGeometry = {
    kind: 'path',
    d: built.polygons
      .map((polygon) => [polygon.outer, ...polygon.holes].map(ringPath).join(''))
      .join(''),
    fillRule: 'evenodd',
    fill: marked ? (view?.palette?.selectedFill ?? '#dbeafe') : node.color,
    fillOpacity: 0.55,
    stroke: marked ? (view?.palette?.selectedStroke ?? '#0ea5e9') : '#526443',
    strokeWidth: 1.2,
    vectorEffect: 'non-scaling-stroke',
    strokeLinejoin: 'round',
    metadata: floorplanGeometryMetadata({ annotationObstacle: 'outline' }),
  }
  const marks: FloorplanGeometry[] = []
  const stride = Math.max(1, Math.ceil(built.blades.count / 64))
  for (let index = 0; index < built.blades.count; index += stride) {
    const x = built.blades.rootHeight[index * 4] ?? 0
    const z = built.blades.rootHeight[index * 4 + 2] ?? 0
    marks.push({
      kind: 'circle',
      cx: x,
      cy: z,
      r: Math.min(0.025, distanceToBoundary(built.polygons, [x, z]) / 2),
      fill: '#3f5c2e',
      stroke: 'none',
      pointerEvents: 'none',
    })
  }
  const flowerStride = Math.max(1, Math.ceil(built.flowers.count / 24))
  for (let head = 0; head < built.flowers.count; head += flowerStride) {
    const start = head ? (built.flowers.headIndexEnds[head - 1] ?? 0) : 0
    const first = (built.flowers.indices[start] ?? 0) * 3
    const second = (built.flowers.indices[start + 1] ?? 0) * 3
    const x = ((built.flowers.positions[first] ?? 0) + (built.flowers.positions[second] ?? 0)) / 2
    const z =
      ((built.flowers.positions[first + 2] ?? 0) + (built.flowers.positions[second + 2] ?? 0)) / 2
    marks.push({
      kind: 'circle',
      cx: x,
      cy: z,
      r: Math.min(0.04, distanceToBoundary(built.polygons, [x, z]) / 2),
      fill: '#eee8cb',
      stroke: 'none',
      pointerEvents: 'none',
    })
  }
  return {
    kind: 'group',
    children: [body, ...marks, ...(view?.selected ? outlineHandles(node) : [])],
  }
}
