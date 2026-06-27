import {
  getConveyorPortPoint,
  getTransferConnections,
  isConveyorBeltRouteNode,
  type AnyNodeId,
  type FloorplanGeometry,
  type FloorplanPoint,
  type GeometryContext,
  type TransferPort,
} from '@pascal-app/core'
import type { ConveyorBeltNode } from './schema'

function buildPathD(points: FloorplanPoint[]) {
  const first = points[0]
  if (!first) return ''
  return [`M ${first[0]} ${first[1]}`, ...points.slice(1).map((point) => `L ${point[0]} ${point[1]}`)].join(' ')
}

function routeLength(points: FloorplanPoint[]) {
  let length = 0
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!
    const b = points[index]!
    length += Math.hypot(b[0] - a[0], b[1] - a[1])
  }
  return length
}

function portPoint2D(node: ConveyorBeltNode, port: TransferPort): FloorplanPoint | null {
  const point = port === 'in' ? node.points[0] : node.points[node.points.length - 1]
  return point ? [point[0], point[2]] : null
}

function connectedPorts(node: ConveyorBeltNode) {
  const ports = new Set<TransferPort>()
  for (const connection of getTransferConnections(node)) {
    if (connection.fromNodeId === node.id) ports.add(connection.fromPort)
    if (connection.toNodeId === node.id) ports.add(connection.toPort)
  }
  return ports
}

export function buildConveyorBeltFloorplan(
  node: ConveyorBeltNode,
  ctx?: GeometryContext,
): FloorplanGeometry | null {
  const points = node.points.map((point) => [point[0], point[2]] as FloorplanPoint)
  if (points.length < 2) return null
  const length = routeLength(points)
  const mid = points[Math.floor(points.length / 2)] ?? points[0]!
  const isSelected = ctx?.viewState?.selected ?? false
  const ports = connectedPorts(node)

  const children: FloorplanGeometry[] = [
    {
      kind: 'path',
      d: buildPathD(points),
      stroke: node.edgeColor,
      strokeWidth: Math.max(node.width * 46, 8),
      fill: 'none',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      vectorEffect: 'non-scaling-stroke',
      opacity: 0.95,
    },
    {
      kind: 'path',
      d: buildPathD(points),
      stroke: node.color,
      strokeWidth: Math.max(node.width * 34, 5),
      fill: 'none',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      vectorEffect: 'non-scaling-stroke',
    },
    {
      kind: 'text',
      x: mid[0],
      y: mid[1] - 0.16,
      text: `${length.toFixed(1)}m`,
      fontSize: 0.11,
      fill: '#111827',
      textAnchor: 'middle',
    },
  ]

  for (const port of ports) {
    const point = portPoint2D(node, port)
    if (!point) continue
    children.push({
      kind: 'circle',
      cx: point[0],
      cy: point[1],
      r: 0.09,
      fill: '#22c55e',
      stroke: '#dcfce7',
      strokeWidth: 2,
      vectorEffect: 'non-scaling-stroke',
    })
    children.push({
      kind: 'circle',
      cx: point[0],
      cy: point[1],
      r: 0.16,
      fill: 'none',
      stroke: '#22c55e',
      strokeWidth: 1.5,
      strokeDasharray: '3 3',
      vectorEffect: 'non-scaling-stroke',
      opacity: 0.85,
    })
  }

  if (isSelected) {
    const start = points[0]
    const end = points[points.length - 1]
    if (start) {
      children.push({
        kind: 'endpoint-handle',
        point: start,
        state: 'idle',
        affordance: 'move-endpoint',
        payload: { conveyorBeltId: node.id, endpoint: 'start' },
      })
    }
    if (end) {
      children.push({
        kind: 'endpoint-handle',
        point: end,
        state: 'idle',
        affordance: 'move-endpoint',
        payload: { conveyorBeltId: node.id, endpoint: 'end' },
      })
    }

    for (const connection of getTransferConnections(node)) {
      const currentPort =
        connection.fromNodeId === node.id
          ? connection.fromPort
          : connection.toNodeId === node.id
            ? connection.toPort
            : null
      const targetId = connection.fromNodeId === node.id ? connection.toNodeId : connection.fromNodeId
      const targetPort = connection.fromNodeId === node.id ? connection.toPort : connection.fromPort
      const current = currentPort ? portPoint2D(node, currentPort) : null
      const target = ctx?.resolve(targetId as AnyNodeId)
      const targetPoint =
        target && isConveyorBeltRouteNode(target) ? getConveyorPortPoint(target, targetPort) : null
      if (!(current && targetPoint)) continue
      children.push({
        kind: 'line',
        x1: current[0],
        y1: current[1],
        x2: targetPoint[0],
        y2: targetPoint[2],
        stroke: '#22c55e',
        strokeWidth: 2,
        strokeDasharray: '5 4',
        vectorEffect: 'non-scaling-stroke',
        opacity: 0.9,
      })
    }
  }

  return {
    kind: 'group',
    children,
  }
}
