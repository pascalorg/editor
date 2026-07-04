import { resolveProcessEquipmentContract } from './process-equipment-contracts'
import type {
  ProcessConnectionMedium,
  ProcessConnectionPlan,
  ProcessEquipmentContract,
  ProcessEquipmentPort,
  ProcessLinePlan,
  ProcessStationClearanceBox,
  ProcessStationPlan,
  StationPlacement,
} from './process-line-types'

export type ProcessRoutePoint = [number, number]

export type ProcessRouteSegment = {
  start: ProcessRoutePoint
  end: ProcessRoutePoint
}

export type ProcessConnectionRoute = {
  routeId: string
  style: 'direct' | 'orthogonal'
  points: ProcessRoutePoint[]
  segments: ProcessRouteSegment[]
  avoidedStationIds: string[]
  fallback: boolean
  fromPort?: ProcessRoutePortEndpoint
  toPort?: ProcessRoutePortEndpoint
  elevation?: number
}

export type ProcessRoutePortEndpoint = {
  stationId: string
  portId: string
  medium: ProcessConnectionMedium
  point: ProcessRoutePoint
  height: number
  side: ProcessEquipmentPort['side']
  profileId: string
  source?: 'profile' | 'artifact' | 'node'
}

export type ProcessRoutePortOverrides = Record<string, ProcessRoutePortEndpoint[]>

export type ProcessRouteObstacle = {
  stationId: string
  box: ProcessStationClearanceBox
  source?: 'layout' | 'artifact' | 'factory-node' | 'native' | 'catalog' | 'profile-parts'
  minHeight?: number
  maxHeight?: number
}

type ProcessRouteBoundary = {
  length: number
  width: number
  centerX?: number
  centerZ?: number
}

type RouteBounds = {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

type RouteObstacle = ProcessRouteObstacle

type RouteNode = {
  key: string
  point: ProcessRoutePoint
}

type SearchState = {
  stateKey: string
  nodeKey: string
  direction: RouteDirection
  cost: number
}

type RouteDirection = 'start' | 'x' | 'z'

const EPSILON = 1e-6
const ROUTE_CLEARANCE = 0.18
const ROUTE_LANE_MARGIN = 0.24
const TERMINAL_STUB_LENGTH = 0.55
const TERMINAL_SURFACE_STANDOFF = 0.32
const WALL_CLEARANCE = 0.35
const BEND_PENALTY = 0.08

function rounded(value: number) {
  return Math.round(value * 1000) / 1000
}

function routePoint(x: number, z: number): ProcessRoutePoint {
  return [rounded(x), rounded(z)]
}

function stationById(plan: ProcessLinePlan, stationId: string) {
  return plan.stations.find((station) => station.id === stationId)
}

function localPortPoint(port: ProcessEquipmentPort, contract: ProcessEquipmentContract) {
  const halfLength = contract.envelope.length / 2
  const halfWidth = contract.envelope.width / 2
  const offset = port.offset ?? 0
  switch (port.side) {
    case 'left':
      return [-halfLength, offset] as const
    case 'right':
      return [halfLength, offset] as const
    case 'front':
      return [offset, halfWidth] as const
    case 'back':
      return [offset, -halfWidth] as const
    case 'top':
      return [offset, 0] as const
  }
}

function worldPortPoint(
  port: ProcessEquipmentPort,
  contract: ProcessEquipmentContract,
  placement: StationPlacement,
) {
  const [localX, localZ] = localPortPoint(port, contract)
  const yaw = placement.rotation[1] ?? 0
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  return routePoint(
    placement.position[0] + localX * cos - localZ * sin,
    placement.position[2] + localX * sin + localZ * cos,
  )
}

function mediumMatches(
  port: Pick<ProcessEquipmentPort, 'medium'>,
  medium: ProcessConnectionMedium | undefined,
) {
  if (!medium) return true
  if (port.medium === medium) return true
  return port.medium === 'material' && (medium === 'hydrogen' || medium === 'oxygen')
}

function directionScore(port: Pick<ProcessEquipmentPort, 'id'>, endpoint: 'from' | 'to') {
  const id = port.id.toLowerCase()
  if (endpoint === 'from') {
    if (/\bout\b|out$|supply|product|dc_power_out/.test(id)) return 40
    if (/\bin\b|in$|return|feed/.test(id)) return -20
    return 0
  }
  if (/\bin\b|in$|feed|return/.test(id)) return 40
  if (/\bout\b|out$|supply|product|dc_power_out/.test(id)) return -20
  return 0
}

function sideScore(port: Pick<ProcessEquipmentPort, 'side'>, endpoint: 'from' | 'to') {
  if (endpoint === 'from' && (port.side === 'right' || port.side === 'front')) return 8
  if (endpoint === 'to' && (port.side === 'left' || port.side === 'back')) return 8
  return 0
}

function selectPort(input: {
  plan: ProcessLinePlan
  station: ProcessStationPlan
  placement: StationPlacement
  connection: ProcessConnectionPlan
  endpoint: 'from' | 'to'
  portOverrides?: ProcessRoutePortOverrides
}): ProcessRoutePortEndpoint | undefined {
  const preferredPortId =
    input.endpoint === 'from' ? input.connection.fromPortId : input.connection.toPortId
  const override = selectOverridePort({
    stationId: input.station.id,
    connection: input.connection,
    endpoint: input.endpoint,
    preferredPortId,
    portOverrides: input.portOverrides,
  })
  if (override) return override

  const contract = resolveProcessEquipmentContract({ plan: input.plan, station: input.station })
  if (!contract) return undefined
  if (preferredPortId) {
    const preferredPort = contract.ports.find((port) => port.id === preferredPortId)
    if (preferredPort) {
      return {
        stationId: input.station.id,
        portId: preferredPort.id,
        medium: preferredPort.medium,
        point: worldPortPoint(preferredPort, contract, input.placement),
        height: preferredPort.height,
        side: preferredPort.side,
        profileId: contract.profileId,
        source: 'profile',
      }
    }
  }

  let best:
    | {
        port: ProcessEquipmentPort
        score: number
      }
    | undefined
  for (const port of contract.ports) {
    const score =
      (mediumMatches(port, input.connection.medium) ? 100 : 0) +
      directionScore(port, input.endpoint) +
      sideScore(port, input.endpoint)
    if (!best || score > best.score) best = { port, score }
  }
  if (!best || best.score < 80) return undefined

  return {
    stationId: input.station.id,
    portId: best.port.id,
    medium: best.port.medium,
    point: worldPortPoint(best.port, contract, input.placement),
    height: best.port.height,
    side: best.port.side,
    profileId: contract.profileId,
    source: 'profile',
  }
}

function selectOverridePort(input: {
  stationId: string
  connection: ProcessConnectionPlan
  endpoint: 'from' | 'to'
  preferredPortId?: string
  portOverrides?: ProcessRoutePortOverrides
}) {
  const ports = input.portOverrides?.[input.stationId] ?? []
  if (input.preferredPortId) {
    return ports.find((port) => port.portId === input.preferredPortId)
  }

  let best:
    | {
        port: ProcessRoutePortEndpoint
        score: number
      }
    | undefined
  for (const port of ports) {
    const score =
      (mediumMatches(port, input.connection.medium) ? 100 : 0) +
      directionScore({ id: port.portId }, input.endpoint) +
      sideScore(port, input.endpoint) +
      (port.source === 'artifact' || port.source === 'node' ? 12 : 0)
    if (!best || score > best.score) best = { port, score }
  }
  return best && best.score >= 80 ? best.port : undefined
}

function routeElevation(input: {
  connection: ProcessConnectionPlan
  fromPort?: ProcessRoutePortEndpoint
  toPort?: ProcessRoutePortEndpoint
}) {
  if (input.connection.visualKind === 'cable_tray') return 2.4
  if (input.connection.visualKind === 'material_conveyor') return 1.05
  const fromHeight = input.fromPort?.height
  const toHeight = input.toPort?.height
  if (fromHeight != null && toHeight != null) return rounded((fromHeight + toHeight) / 2)
  if (input.connection.visualKind === 'air_duct') return 2.35
  if (input.connection.visualKind === 'hot_gas_duct') return 2.65
  if (input.connection.visualKind === 'hot_material_chute') return 1.35
  return 1.15
}

function pointKey(point: ProcessRoutePoint) {
  return `${point[0]},${point[1]}`
}

function sameNumber(left: number, right: number) {
  return Math.abs(left - right) < EPSILON
}

function samePoint(left: ProcessRoutePoint, right: ProcessRoutePoint) {
  return sameNumber(left[0], right[0]) && sameNumber(left[1], right[1])
}

function sameAxis(left: ProcessRoutePoint, right: ProcessRoutePoint) {
  return sameNumber(left[0], right[0]) || sameNumber(left[1], right[1])
}

function manhattanDistance(left: ProcessRoutePoint, right: ProcessRoutePoint) {
  return Math.abs(left[0] - right[0]) + Math.abs(left[1] - right[1])
}

function routeBounds(boundary: ProcessRouteBoundary): RouteBounds {
  const centerX = boundary.centerX ?? 0
  const centerZ = boundary.centerZ ?? 0
  return {
    minX: centerX - boundary.length / 2,
    maxX: centerX + boundary.length / 2,
    minZ: centerZ - boundary.width / 2,
    maxZ: centerZ + boundary.width / 2,
  }
}

function insetBounds(bounds: RouteBounds): RouteBounds {
  const canInsetX = bounds.maxX - bounds.minX > WALL_CLEARANCE * 2
  const canInsetZ = bounds.maxZ - bounds.minZ > WALL_CLEARANCE * 2
  return {
    minX: canInsetX ? bounds.minX + WALL_CLEARANCE : bounds.minX,
    maxX: canInsetX ? bounds.maxX - WALL_CLEARANCE : bounds.maxX,
    minZ: canInsetZ ? bounds.minZ + WALL_CLEARANCE : bounds.minZ,
    maxZ: canInsetZ ? bounds.maxZ - WALL_CLEARANCE : bounds.maxZ,
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function expandBox(box: ProcessStationClearanceBox, clearance: number): ProcessStationClearanceBox {
  return {
    minX: box.minX - clearance,
    maxX: box.maxX + clearance,
    minZ: box.minZ - clearance,
    maxZ: box.maxZ + clearance,
  }
}

function pointInsideBox(point: ProcessRoutePoint, box: ProcessStationClearanceBox) {
  return (
    point[0] > box.minX + EPSILON &&
    point[0] < box.maxX - EPSILON &&
    point[1] > box.minZ + EPSILON &&
    point[1] < box.maxZ - EPSILON
  )
}

function rangesOverlapStrict(leftMin: number, leftMax: number, rightMin: number, rightMax: number) {
  return Math.max(leftMin, rightMin) < Math.min(leftMax, rightMax) - EPSILON
}

export function routeSegmentIntersectsClearanceBox(
  start: ProcessRoutePoint,
  end: ProcessRoutePoint,
  box: ProcessStationClearanceBox,
) {
  if (samePoint(start, end)) return false

  const minX = Math.min(start[0], end[0])
  const maxX = Math.max(start[0], end[0])
  const minZ = Math.min(start[1], end[1])
  const maxZ = Math.max(start[1], end[1])

  if (sameNumber(start[1], end[1])) {
    return (
      start[1] > box.minZ + EPSILON &&
      start[1] < box.maxZ - EPSILON &&
      rangesOverlapStrict(minX, maxX, box.minX, box.maxX)
    )
  }

  if (sameNumber(start[0], end[0])) {
    return (
      start[0] > box.minX + EPSILON &&
      start[0] < box.maxX - EPSILON &&
      rangesOverlapStrict(minZ, maxZ, box.minZ, box.maxZ)
    )
  }

  return segmentIntersectsRectangle(start, end, box)
}

function segmentIntersectsRectangle(
  start: ProcessRoutePoint,
  end: ProcessRoutePoint,
  box: ProcessStationClearanceBox,
) {
  if (pointInsideBox(start, box) || pointInsideBox(end, box)) return true

  const corners: [ProcessRoutePoint, ProcessRoutePoint][] = [
    [
      [box.minX, box.minZ],
      [box.maxX, box.minZ],
    ],
    [
      [box.maxX, box.minZ],
      [box.maxX, box.maxZ],
    ],
    [
      [box.maxX, box.maxZ],
      [box.minX, box.maxZ],
    ],
    [
      [box.minX, box.maxZ],
      [box.minX, box.minZ],
    ],
  ]
  return corners.some(([edgeStart, edgeEnd]) => segmentsIntersect(start, end, edgeStart, edgeEnd))
}

function orientation(a: ProcessRoutePoint, b: ProcessRoutePoint, c: ProcessRoutePoint) {
  const value = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1])
  if (Math.abs(value) < EPSILON) return 0
  return value > 0 ? 1 : 2
}

function onSegment(a: ProcessRoutePoint, b: ProcessRoutePoint, c: ProcessRoutePoint) {
  return (
    b[0] <= Math.max(a[0], c[0]) + EPSILON &&
    b[0] >= Math.min(a[0], c[0]) - EPSILON &&
    b[1] <= Math.max(a[1], c[1]) + EPSILON &&
    b[1] >= Math.min(a[1], c[1]) - EPSILON
  )
}

function segmentsIntersect(
  firstStart: ProcessRoutePoint,
  firstEnd: ProcessRoutePoint,
  secondStart: ProcessRoutePoint,
  secondEnd: ProcessRoutePoint,
) {
  const firstOrientation = orientation(firstStart, firstEnd, secondStart)
  const secondOrientation = orientation(firstStart, firstEnd, secondEnd)
  const thirdOrientation = orientation(secondStart, secondEnd, firstStart)
  const fourthOrientation = orientation(secondStart, secondEnd, firstEnd)

  if (firstOrientation !== secondOrientation && thirdOrientation !== fourthOrientation) return true
  if (firstOrientation === 0 && onSegment(firstStart, secondStart, firstEnd)) return true
  if (secondOrientation === 0 && onSegment(firstStart, secondEnd, firstEnd)) return true
  if (thirdOrientation === 0 && onSegment(secondStart, firstStart, secondEnd)) return true
  if (fourthOrientation === 0 && onSegment(secondStart, firstEnd, secondEnd)) return true
  return false
}

function segmentBlocked(
  start: ProcessRoutePoint,
  end: ProcessRoutePoint,
  obstacles: RouteObstacle[],
) {
  return obstacles.some((obstacle) => routeSegmentIntersectsClearanceBox(start, end, obstacle.box))
}

function uniqueSorted(values: number[]) {
  return [...new Set(values.map(rounded))].sort((left, right) => left - right)
}

function inBounds(point: ProcessRoutePoint, bounds: RouteBounds) {
  return (
    point[0] >= bounds.minX - EPSILON &&
    point[0] <= bounds.maxX + EPSILON &&
    point[1] >= bounds.minZ - EPSILON &&
    point[1] <= bounds.maxZ + EPSILON
  )
}

function routeGrid(input: {
  start: ProcessRoutePoint
  end: ProcessRoutePoint
  bounds: RouteBounds
  obstacles: RouteObstacle[]
}) {
  const innerBounds = insetBounds(input.bounds)
  const xValues = [input.start[0], input.end[0], innerBounds.minX, innerBounds.maxX]
  const zValues = [input.start[1], input.end[1], innerBounds.minZ, innerBounds.maxZ]

  for (const obstacle of input.obstacles) {
    xValues.push(obstacle.box.minX - ROUTE_LANE_MARGIN, obstacle.box.maxX + ROUTE_LANE_MARGIN)
    zValues.push(obstacle.box.minZ - ROUTE_LANE_MARGIN, obstacle.box.maxZ + ROUTE_LANE_MARGIN)
  }

  const xCoords = uniqueSorted(
    xValues.map((value) => clamp(value, input.bounds.minX, input.bounds.maxX)),
  )
  const zCoords = uniqueSorted(
    zValues.map((value) => clamp(value, input.bounds.minZ, input.bounds.maxZ)),
  )
  const nodes: RouteNode[] = []
  const byKey = new Map<string, RouteNode>()

  for (const x of xCoords) {
    for (const z of zCoords) {
      const point = routePoint(x, z)
      const key = pointKey(point)
      const isTerminal = samePoint(point, input.start) || samePoint(point, input.end)
      const blocked = input.obstacles.some((obstacle) => pointInsideBox(point, obstacle.box))
      if (!isTerminal && blocked) continue
      if (!inBounds(point, input.bounds)) continue
      const node = { key, point }
      byKey.set(key, node)
      nodes.push(node)
    }
  }

  return { nodes, byKey }
}

function stateKey(nodeKey: string, direction: RouteDirection) {
  return `${nodeKey}:${direction}`
}

function routeDirection(
  from: ProcessRoutePoint,
  to: ProcessRoutePoint,
): Exclude<RouteDirection, 'start'> {
  return sameNumber(from[0], to[0]) ? 'z' : 'x'
}

function routeNeighbors(input: {
  current: RouteNode
  nodes: RouteNode[]
  obstacles: RouteObstacle[]
}) {
  return input.nodes.filter((candidate) => {
    if (candidate.key === input.current.key) return false
    if (!sameAxis(candidate.point, input.current.point)) return false
    return !segmentBlocked(input.current.point, candidate.point, input.obstacles)
  })
}

function reconstructPath(input: {
  endStateKey: string
  previous: Map<string, string>
  stateNodes: Map<string, string>
  nodesByKey: Map<string, RouteNode>
}) {
  const nodeKeys: string[] = []
  let currentKey: string | undefined = input.endStateKey
  while (currentKey) {
    const nodeKey = input.stateNodes.get(currentKey)
    if (nodeKey) nodeKeys.push(nodeKey)
    currentKey = input.previous.get(currentKey)
  }
  return nodeKeys
    .reverse()
    .map((key) => input.nodesByKey.get(key)?.point)
    .filter((point): point is ProcessRoutePoint => Boolean(point))
}

function searchOrthogonalPath(input: {
  start: ProcessRoutePoint
  end: ProcessRoutePoint
  bounds: RouteBounds
  obstacles: RouteObstacle[]
}) {
  const grid = routeGrid(input)
  const startKey = pointKey(input.start)
  const endKey = pointKey(input.end)
  const startNode = grid.byKey.get(startKey)
  if (!startNode || !grid.byKey.has(endKey)) return undefined

  const open: SearchState[] = [
    { stateKey: stateKey(startKey, 'start'), nodeKey: startKey, direction: 'start', cost: 0 },
  ]
  const bestCost = new Map<string, number>([[open[0]!.stateKey, 0]])
  const previous = new Map<string, string>()
  const stateNodes = new Map<string, string>([[open[0]!.stateKey, startKey]])

  while (open.length) {
    open.sort((left, right) => left.cost - right.cost)
    const current = open.shift()
    if (!current) break

    const recordedCost = bestCost.get(current.stateKey)
    if (recordedCost == null || current.cost > recordedCost + EPSILON) continue
    if (current.nodeKey === endKey) {
      return simplifyRoutePoints(
        reconstructPath({
          endStateKey: current.stateKey,
          previous,
          stateNodes,
          nodesByKey: grid.byKey,
        }),
      )
    }

    const currentNode = grid.byKey.get(current.nodeKey)
    if (!currentNode) continue

    for (const nextNode of routeNeighbors({
      current: currentNode,
      nodes: grid.nodes,
      obstacles: input.obstacles,
    })) {
      const nextDirection = routeDirection(currentNode.point, nextNode.point)
      const turnCost =
        current.direction !== 'start' && current.direction !== nextDirection ? BEND_PENALTY : 0
      const nextCost =
        current.cost + manhattanDistance(currentNode.point, nextNode.point) + turnCost
      const nextStateKey = stateKey(nextNode.key, nextDirection)
      const previousBest = bestCost.get(nextStateKey)
      if (previousBest != null && previousBest <= nextCost + EPSILON) continue
      bestCost.set(nextStateKey, nextCost)
      previous.set(nextStateKey, current.stateKey)
      stateNodes.set(nextStateKey, nextNode.key)
      open.push({
        stateKey: nextStateKey,
        nodeKey: nextNode.key,
        direction: nextDirection,
        cost: nextCost,
      })
    }
  }

  return undefined
}

function simplifyRoutePoints(points: ProcessRoutePoint[]) {
  const withoutDuplicates: ProcessRoutePoint[] = []
  for (const point of points) {
    const previous = withoutDuplicates.at(-1)
    if (previous && samePoint(previous, point)) continue
    withoutDuplicates.push(point)
  }

  const simplified: ProcessRoutePoint[] = []
  for (const point of withoutDuplicates) {
    const previous = simplified.at(-1)
    const beforePrevious = simplified.at(-2)
    if (
      previous &&
      beforePrevious &&
      sameAxis(beforePrevious, previous) &&
      sameAxis(previous, point)
    ) {
      const sameDirection =
        (sameNumber(beforePrevious[0], previous[0]) && sameNumber(previous[0], point[0])) ||
        (sameNumber(beforePrevious[1], previous[1]) && sameNumber(previous[1], point[1]))
      if (sameDirection) {
        simplified[simplified.length - 1] = point
        continue
      }
    }
    simplified.push(point)
  }

  return simplified
}

function buildSegments(points: ProcessRoutePoint[]): ProcessRouteSegment[] {
  const segments: ProcessRouteSegment[] = []
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]
    const end = points[index + 1]
    if (!start || !end || samePoint(start, end)) continue
    segments.push({ start, end })
  }
  return segments
}

function removeDuplicateRoutePoints(points: ProcessRoutePoint[]) {
  const withoutDuplicates: ProcessRoutePoint[] = []
  for (const point of points) {
    const previous = withoutDuplicates.at(-1)
    if (previous && samePoint(previous, point)) continue
    withoutDuplicates.push(point)
  }
  return withoutDuplicates
}

function routeCandidateBlocked(points: ProcessRoutePoint[], obstacles: RouteObstacle[]) {
  return buildSegments(points).some((segment) =>
    segmentBlocked(segment.start, segment.end, obstacles),
  )
}

function routeCandidateDistance(points: ProcessRoutePoint[]) {
  return buildSegments(points).reduce(
    (total, segment) => total + manhattanDistance(segment.start, segment.end),
    0,
  )
}

function obstacleLaneValues(input: {
  bounds: RouteBounds
  obstacles: RouteObstacle[]
  axis: 'x' | 'z'
}) {
  const innerBounds = insetBounds(input.bounds)
  const values =
    input.axis === 'x' ? [innerBounds.minX, innerBounds.maxX] : [innerBounds.minZ, innerBounds.maxZ]
  for (const obstacle of input.obstacles) {
    if (input.axis === 'x') {
      values.push(obstacle.box.minX - ROUTE_LANE_MARGIN, obstacle.box.maxX + ROUTE_LANE_MARGIN)
    } else {
      values.push(obstacle.box.minZ - ROUTE_LANE_MARGIN, obstacle.box.maxZ + ROUTE_LANE_MARGIN)
    }
  }
  const min = input.axis === 'x' ? input.bounds.minX : input.bounds.minZ
  const max = input.axis === 'x' ? input.bounds.maxX : input.bounds.maxZ
  return uniqueSorted(values.map((value) => clamp(value, min, max)))
}

function routeFallback(
  start: ProcessRoutePoint,
  end: ProcessRoutePoint,
  bounds?: RouteBounds,
  obstacles: RouteObstacle[] = [],
) {
  const naive = sameAxis(start, end)
    ? [start, end]
    : simplifyRoutePoints([start, routePoint(start[0], end[1]), end])
  if (!bounds || obstacles.length === 0) return naive
  if (!routeCandidateBlocked(naive, obstacles)) return naive

  const candidates: ProcessRoutePoint[][] = []
  for (const z of obstacleLaneValues({ bounds, obstacles, axis: 'z' })) {
    candidates.push(
      simplifyRoutePoints([start, routePoint(start[0], z), routePoint(end[0], z), end]),
    )
  }
  for (const x of obstacleLaneValues({ bounds, obstacles, axis: 'x' })) {
    candidates.push(
      simplifyRoutePoints([start, routePoint(x, start[1]), routePoint(x, end[1]), end]),
    )
  }

  return (
    candidates
      .filter((candidate) => !routeCandidateBlocked(candidate, obstacles))
      .sort((left, right) => routeCandidateDistance(left) - routeCandidateDistance(right))[0] ??
    naive
  )
}

function portSideDirection(side: ProcessEquipmentPort['side']): ProcessRoutePoint | undefined {
  switch (side) {
    case 'left':
      return [-1, 0]
    case 'right':
      return [1, 0]
    case 'front':
      return [0, 1]
    case 'back':
      return [0, -1]
    case 'top':
      return undefined
  }
}

function terminalStubPointForDirection(
  port: ProcessRoutePortEndpoint,
  direction: ProcessRoutePoint,
) {
  return routePoint(
    port.point[0] + direction[0] * TERMINAL_STUB_LENGTH,
    port.point[1] + direction[1] * TERMINAL_STUB_LENGTH,
  )
}

function terminalStubDirections(port: ProcessRoutePortEndpoint) {
  const preferred = portSideDirection(port.side)
  if (!preferred) return []
  const sideAlternates: ProcessRoutePoint[] =
    port.side === 'left' || port.side === 'right'
      ? [
          [0, 1],
          [0, -1],
        ]
      : [
          [1, 0],
          [-1, 0],
        ]
  const directions = [preferred, ...sideAlternates]
  return directions.filter(
    (direction, index) => directions.findIndex((item) => samePoint(item, direction)) === index,
  )
}

function safeTerminalStubPoint(
  port: ProcessRoutePortEndpoint | undefined,
  obstacles: RouteObstacle[],
) {
  if (!port) return undefined
  for (const direction of terminalStubDirections(port)) {
    const candidate = terminalStubPointForDirection(port, direction)
    const blocked =
      obstacles.some((obstacle) => pointInsideBox(candidate, obstacle.box)) ||
      segmentBlocked(port.point, candidate, obstacles)
    if (!blocked) return candidate
  }
  return undefined
}

function routeObstacleForStation(obstacles: ProcessRouteObstacle[] | undefined, stationId: string) {
  return obstacles?.find((obstacle) => obstacle.stationId === stationId)
}

function projectPortToObstacleSurface(
  port: ProcessRoutePortEndpoint | undefined,
  obstacle: ProcessRouteObstacle | undefined,
  blockingObstacles: RouteObstacle[] = [],
) {
  if (!port || !obstacle || port.side === 'top') return port
  if (!pointInsideBox(port.point, obstacle.box)) return port
  const box = obstacle.box
  let projected: ProcessRoutePortEndpoint
  switch (port.side) {
    case 'left':
      projected = {
        ...port,
        point: routePoint(
          box.minX - TERMINAL_SURFACE_STANDOFF,
          clamp(port.point[1], box.minZ, box.maxZ),
        ),
      }
      break
    case 'right':
      projected = {
        ...port,
        point: routePoint(
          box.maxX + TERMINAL_SURFACE_STANDOFF,
          clamp(port.point[1], box.minZ, box.maxZ),
        ),
      }
      break
    case 'front':
      projected = {
        ...port,
        point: routePoint(
          clamp(port.point[0], box.minX, box.maxX),
          box.maxZ + TERMINAL_SURFACE_STANDOFF,
        ),
      }
      break
    case 'back':
      projected = {
        ...port,
        point: routePoint(
          clamp(port.point[0], box.minX, box.maxX),
          box.minZ - TERMINAL_SURFACE_STANDOFF,
        ),
      }
      break
  }
  const projectedBlocked = blockingObstacles.some((blockingObstacle) =>
    pointInsideBox(projected.point, blockingObstacle.box),
  )
  const originalBlocked = blockingObstacles.some((blockingObstacle) =>
    pointInsideBox(port.point, blockingObstacle.box),
  )
  return projectedBlocked && !originalBlocked ? port : projected
}

function directBlockedStationIds(
  start: ProcessRoutePoint,
  end: ProcessRoutePoint,
  obstacles: RouteObstacle[],
) {
  return obstacles
    .filter((obstacle) => routeSegmentIntersectsClearanceBox(start, end, obstacle.box))
    .map((obstacle) => obstacle.stationId)
}

export function routeProcessConnection(input: {
  plan: ProcessLinePlan
  connection: ProcessConnectionPlan
  connectionIndex: number
  placements: Map<string, StationPlacement>
  stationPlacements: StationPlacement[]
  boundary: ProcessRouteBoundary
  portOverrides?: ProcessRoutePortOverrides
  routeObstacles?: ProcessRouteObstacle[]
}): ProcessConnectionRoute | undefined {
  const fromPlacement = input.placements.get(input.connection.fromStationId)
  const toPlacement = input.placements.get(input.connection.toStationId)
  const fromStation = stationById(input.plan, input.connection.fromStationId)
  const toStation = stationById(input.plan, input.connection.toStationId)
  if (!fromPlacement || !toPlacement || !fromStation || !toStation) return undefined

  const selectedFromPort = selectPort({
    plan: input.plan,
    station: fromStation,
    placement: fromPlacement,
    connection: input.connection,
    endpoint: 'from',
    portOverrides: input.portOverrides,
  })
  const selectedToPort = selectPort({
    plan: input.plan,
    station: toStation,
    placement: toPlacement,
    connection: input.connection,
    endpoint: 'to',
    portOverrides: input.portOverrides,
  })
  const replacementObstacleStationIds = new Set(
    (input.routeObstacles ?? [])
      .filter(
        (item) =>
          item.source === 'artifact' || item.source === 'factory-node',
      )
      .map((item) => item.stationId),
  )
  const placementObstacles: RouteObstacle[] = input.stationPlacements
    .filter(
      (placement) =>
        placement.stationId !== input.connection.fromStationId &&
        placement.stationId !== input.connection.toStationId &&
        !replacementObstacleStationIds.has(placement.stationId),
    )
    .map((placement) => ({
      stationId: placement.stationId,
      box: expandBox(placement.clearanceBox, ROUTE_CLEARANCE),
      source: 'layout',
    }))
  const artifactObstacles: RouteObstacle[] = (input.routeObstacles ?? [])
    .filter(
      (obstacle) =>
        obstacle.stationId !== input.connection.fromStationId &&
        obstacle.stationId !== input.connection.toStationId,
    )
    .map((obstacle) => ({ ...obstacle }))
  const obstacles = [...placementObstacles, ...artifactObstacles]
  const bounds = routeBounds(input.boundary)
  const fromPort = projectPortToObstacleSurface(
    selectedFromPort,
    routeObstacleForStation(input.routeObstacles, input.connection.fromStationId),
    obstacles,
  )
  const toPort = projectPortToObstacleSurface(
    selectedToPort,
    routeObstacleForStation(input.routeObstacles, input.connection.toStationId),
    obstacles,
  )
  const fromTerminal =
    fromPort?.point ?? routePoint(fromPlacement.position[0], fromPlacement.position[2])
  const toTerminal = toPort?.point ?? routePoint(toPlacement.position[0], toPlacement.position[2])
  const fromStub = safeTerminalStubPoint(fromPort, obstacles)
  const toStub = safeTerminalStubPoint(toPort, obstacles)
  const start = fromStub ?? fromTerminal
  const end = toStub ?? toTerminal

  const directAvoidedStationIds = directBlockedStationIds(start, end, obstacles)
  const directIsSafe = sameAxis(start, end) && directAvoidedStationIds.length === 0
  const searchedPoints = directIsSafe
    ? [start, end]
    : searchOrthogonalPath({
        start,
        end,
        bounds,
        obstacles,
      })
  const routedPoints = searchedPoints ?? routeFallback(start, end, bounds, obstacles)
  const points = removeDuplicateRoutePoints([
    ...(fromStub ? [fromTerminal] : []),
    ...routedPoints,
    ...(toStub ? [toTerminal] : []),
  ])
  const segments = buildSegments(points)
  const fallback = !searchedPoints
  const style = segments.length <= 1 && directIsSafe ? 'direct' : 'orthogonal'

  return {
    routeId: `${input.plan.processId ?? 'process'}:${input.connectionIndex}:${input.connection.fromStationId}->${input.connection.toStationId}`,
    style,
    points,
    segments,
    avoidedStationIds: directAvoidedStationIds,
    fallback,
    ...(fromPort ? { fromPort } : {}),
    ...(toPort ? { toPort } : {}),
    elevation: routeElevation({ connection: input.connection, fromPort, toPort }),
  }
}
