import type { FloorplanGeometry, GeometryContext, RockNode } from '@pascal-app/core'

/** The footprint and its editing handles remain in Site metres in every drawing. */
export function buildRockFloorplan(node: RockNode, ctx: GeometryContext): FloorplanGeometry | null {
  const view = ctx.viewState
  const palette = view?.palette
  const selected = view?.selected ?? false
  const marked = selected || (view?.highlighted ?? false)
  const body: FloorplanGeometry = {
    kind: 'polygon',
    points: node.polygon.map(([x, z]): [number, number] => [x, z]),
    fill: marked ? (palette?.selectedFill ?? '#dbeafe') : '#b9b4aa',
    fillOpacity: 0.7,
    stroke: marked ? (palette?.selectedStroke ?? '#0ea5e9') : '#6f6a62',
    strokeWidth: 1.2,
    vectorEffect: 'non-scaling-stroke',
    strokeLinejoin: 'round',
  }
  if (!selected) return body
  const edges: FloorplanGeometry[] = []
  const midpoints: FloorplanGeometry[] = []
  const corners: FloorplanGeometry[] = []
  node.polygon.forEach((point, index) => {
    const next = node.polygon[(index + 1) % node.polygon.length]!
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
  return { kind: 'group', children: [body, ...edges, ...midpoints, ...corners] }
}
