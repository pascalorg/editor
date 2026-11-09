import type { AnyNode, AnyNodeId, StairNode, StairSegmentNode } from '../../schema'

type StairUpdate = { id: AnyNodeId; data: Partial<AnyNode> }

export function planStairRiseEdit(
  stair: StairNode,
  totalRise: number,
  nodes: Readonly<Record<string, AnyNode | undefined>>,
): StairUpdate[] {
  if (!Number.isFinite(totalRise) || totalRise <= 0) throw new RangeError('Rise must be positive')
  const updates: StairUpdate[] = [{ id: stair.id, data: { totalRise } }]
  if (stair.stairType !== 'straight') return updates
  const segments = stair.children
    .map((id) => nodes[id])
    .filter((node): node is StairSegmentNode => node?.type === 'stair-segment')
  const flights = segments.filter((node) => node.segmentType === 'stair')
  if (!flights.length) return updates
  const landingRise = segments
    .filter((node) => node.segmentType === 'landing')
    .reduce((sum, node) => sum + node.height, 0)
  const flightRise = totalRise - landingRise
  if (flightRise <= 0) throw new RangeError('Rise must exceed the accumulated landing rise')
  const weightOf = (node: StairSegmentNode) =>
    Math.max(0, stair.uniformRisers ? node.stepCount : node.height)
  const weight = flights.reduce((sum, node) => sum + weightOf(node), 0)
  let remaining = flightRise
  for (const [index, flight] of flights.entries()) {
    const height =
      index === flights.length - 1
        ? remaining
        : weight > 0
          ? (flightRise * weightOf(flight)) / weight
          : flightRise / flights.length
    remaining -= height
    updates.push({ id: flight.id, data: { height } })
  }
  return updates
}

export function planStairFlightHeightEdit(
  segment: StairSegmentNode,
  height: number,
  nodes: Readonly<Record<string, AnyNode | undefined>>,
): StairUpdate[] {
  if (!Number.isFinite(height) || height <= 0)
    throw new RangeError('Flight height must be positive')
  const updates: StairUpdate[] = [{ id: segment.id, data: { height } }]
  const stair = nodes[segment.parentId ?? '']
  if (stair?.type !== 'stair' || stair.stairType !== 'straight') return updates
  const totalRise = stair.children.reduce((sum, id) => {
    const child = nodes[id]
    return child?.type === 'stair-segment' ? sum + (id === segment.id ? height : child.height) : sum
  }, 0)
  updates.push({ id: stair.id, data: { totalRise, uniformRisers: false } })
  return updates
}
