import type {
  CustomMeshNode,
  FloorplanGeometry,
  FloorplanPoint,
  GeometryContext,
} from '@pascal-app/core'

function cross(origin: FloorplanPoint, a: FloorplanPoint, b: FloorplanPoint) {
  return (a[0] - origin[0]) * (b[1] - origin[1]) - (a[1] - origin[1]) * (b[0] - origin[0])
}

function convexHull(points: FloorplanPoint[]): FloorplanPoint[] {
  const unique = [...new Map(points.map((point) => [`${point[0]}:${point[1]}`, point])).values()]
  if (unique.length <= 3) return unique
  unique.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const lower: FloorplanPoint[] = []
  for (const point of unique) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, point) <= 0) lower.pop()
    lower.push(point)
  }
  const upper: FloorplanPoint[] = []
  for (const point of [...unique].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, point) <= 0) upper.pop()
    upper.push(point)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

export function buildCustomMeshFloorplan(
  node: CustomMeshNode,
  ctx?: GeometryContext,
): FloorplanGeometry | null {
  const points = convexHull(
    node.topology.vertices.map((vertex) => [vertex.position[0], vertex.position[2]]),
  )
  if (points.length < 3) return null
  const selected = ctx?.viewState?.selected ?? false
  return {
    kind: 'group',
    transform: { translate: [node.position[0], node.position[2]], rotate: -node.rotation },
    children: [
      {
        kind: 'polygon',
        points,
        fill: selected ? '#fed7aa' : '#cbd5e1',
        fillOpacity: selected ? 0.55 : 0.72,
        stroke: selected ? (ctx?.viewState?.palette?.selectedStroke ?? '#f97316') : '#475569',
        strokeWidth: selected ? 0.03 : 0.018,
        pointerEvents: 'all',
      },
    ],
  }
}
