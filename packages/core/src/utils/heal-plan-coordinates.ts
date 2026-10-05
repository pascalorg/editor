type PlanPoint = [number, number]
type NodeData = Record<string, unknown>

function record(value: unknown): value is NodeData {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function planPoint(value: unknown, allowXY: boolean): PlanPoint | undefined {
  if (Array.isArray(value)) {
    if (!value.every(finite)) return
    if (value.length === 2) return value as PlanPoint
    if (value.length === 3) return [value[0]!, value[2]!]
    return
  }
  if (!(record(value) && finite(value.x))) return
  if (finite(value.z)) return [value.x, value.z]
  if (allowXY && !('z' in value) && finite(value.y)) return [value.x, value.y]
}

function planRing(value: unknown, allowXY: boolean): PlanPoint[] | undefined {
  let points = record(value) ? value.points : value
  if (Array.isArray(points) && points.length === 1) points = points[0]
  if (!Array.isArray(points) || points.length < 3) return
  const ring = points.map((point) => planPoint(point, allowXY))
  if (!ring.every((point): point is PlanPoint => point !== undefined)) return
  return ring.every((point, i) => point === points[i]) ? (points as PlanPoint[]) : ring
}

function healNode(node: NodeData): NodeData {
  // A separately authored vertical dimension identifies legacy XY plan data;
  // otherwise a missing Z is ambiguous and must not be guessed.
  const allowXY = [node.height, node.thickness, node.elevation].some(finite)
  if (node.type === 'wall') {
    const points =
      node.start === undefined && node.end === undefined && Array.isArray(node.points)
        ? node.points
        : undefined
    const start = planPoint(points?.length === 2 ? points[0] : node.start, allowXY)
    const end = planPoint(points?.length === 2 ? points[1] : node.end, allowXY)
    if (start && end && (start !== node.start || end !== node.end)) return { ...node, start, end }
  }
  if (node.type === 'slab') {
    const source = node.polygon === undefined ? (node.points ?? node.vertices) : node.polygon
    const polygon = planRing(source, allowXY)
    if (polygon && polygon !== node.polygon) return { ...node, polygon }
  }
  return node
}

export function healScenePlanCoordinates(input: Record<string, unknown>): Record<string, unknown> {
  let nodes = input
  for (const [id, node] of Object.entries(input)) {
    if (!record(node)) continue
    const healed = healNode(node)
    if (healed === node) continue
    if (nodes === input) nodes = { ...input }
    nodes[id] = healed
  }
  return nodes
}
