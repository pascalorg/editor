import {
  type AnyNode,
  DEFAULT_WALL_HEIGHT,
  DEFAULT_WALL_THICKNESS,
  type DoorNode,
  type WallNode,
  type WindowNode,
} from '@pascal-app/core'

type SceneNodes = Record<string, AnyNode>
type OpeningNode = DoorNode | WindowNode

export type IfcConversionSimplificationOptions = {
  enabled?: boolean
  maxWallJoinGap?: number
}

export type IfcConversionSimplificationStats = {
  input: {
    walls: number
    doors: number
    windows: number
  }
  output: {
    walls: number
    doors: number
    windows: number
  }
  removedTinyWalls: number
  mergedWallGroups: number
  removedMergedWalls: number
  removedDuplicateOpenings: number
}

type WallSegment = {
  id: string
  wall: WallNode
  parentId: string | null
  axisX: number
  axisY: number
  normalX: number
  normalY: number
  offset: number
  t0: number
  t1: number
  length: number
  height: number
  thickness: number
  angleBucket: number
}

const MIN_WALL_LENGTH = 0.08
const WALL_ANGLE_BUCKET_RAD = Math.PI / 180
const DEFAULT_MAX_WALL_JOIN_GAP = 1.25
const WALL_HEIGHT_TOLERANCE = 0.35
const OPENING_DUPLICATE_TOLERANCE = 0.05

function countNodes(nodes: SceneNodes, type: AnyNode['type']) {
  return Object.values(nodes).filter((node) => node.type === type).length
}

function getInitialStats(nodes: SceneNodes): IfcConversionSimplificationStats {
  return {
    input: {
      walls: countNodes(nodes, 'wall'),
      doors: countNodes(nodes, 'door'),
      windows: countNodes(nodes, 'window'),
    },
    output: {
      walls: 0,
      doors: 0,
      windows: 0,
    },
    removedTinyWalls: 0,
    mergedWallGroups: 0,
    removedMergedWalls: 0,
    removedDuplicateOpenings: 0,
  }
}

function finishStats(nodes: SceneNodes, stats: IfcConversionSimplificationStats) {
  stats.output = {
    walls: countNodes(nodes, 'wall'),
    doors: countNodes(nodes, 'door'),
    windows: countNodes(nodes, 'window'),
  }
}

function isOpeningNode(node: AnyNode | undefined): node is OpeningNode {
  return node?.type === 'door' || node?.type === 'window'
}

function getOpeningWallId(opening: OpeningNode, nodes: SceneNodes) {
  if (opening.wallId && nodes[opening.wallId]?.type === 'wall') return opening.wallId
  if (opening.parentId && nodes[opening.parentId]?.type === 'wall') return opening.parentId
  return null
}

function uniqueExistingChildren(children: string[] | undefined, nodes: SceneNodes) {
  const next: string[] = []
  const seen = new Set<string>()
  for (const childId of children ?? []) {
    if (!(childId in nodes) || seen.has(childId)) continue
    seen.add(childId)
    next.push(childId)
  }
  return next
}

function normalizeChildren(nodes: SceneNodes) {
  for (const node of Object.values(nodes)) {
    const withChildren = node as { children?: string[] }
    if (Array.isArray(withChildren.children)) {
      withChildren.children = uniqueExistingChildren(withChildren.children, nodes)
    }
  }
}

function syncWallOpeningChildren(nodes: SceneNodes) {
  for (const node of Object.values(nodes)) {
    if (node.type !== 'wall') continue
    node.children = uniqueExistingChildren(node.children, nodes) as WallNode['children']
  }

  for (const node of Object.values(nodes)) {
    if (!isOpeningNode(node)) continue
    const wallId = getOpeningWallId(node, nodes)
    const wall = wallId ? nodes[wallId] : undefined
    if (wall?.type !== 'wall') continue
    if (!wall.children.includes(node.id)) {
      wall.children.push(node.id)
    }
  }
}

function removeNodeFromParents(nodes: SceneNodes, nodeId: string) {
  for (const node of Object.values(nodes)) {
    const withChildren = node as { children?: string[] }
    if (!Array.isArray(withChildren.children)) continue
    withChildren.children = withChildren.children.filter((childId) => childId !== nodeId)
  }
}

function wallLength(wall: WallNode) {
  return Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
}

function pruneTinyWalls(nodes: SceneNodes, stats: IfcConversionSimplificationStats) {
  for (const node of Object.values(nodes)) {
    if (node.type !== 'wall') continue
    if (wallLength(node) >= MIN_WALL_LENGTH) continue
    if (node.children.length > 0) continue
    delete nodes[node.id]
    removeNodeFromParents(nodes, node.id)
    stats.removedTinyWalls += 1
  }
}

function toWallSegment(wall: WallNode): WallSegment | null {
  if (wall.curveOffset !== undefined && Math.abs(wall.curveOffset) > 1e-6) return null

  const dx = wall.end[0] - wall.start[0]
  const dy = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dy)
  if (length < MIN_WALL_LENGTH) return null

  let axisX = dx / length
  let axisY = dy / length

  if (axisX < -1e-6 || (Math.abs(axisX) <= 1e-6 && axisY < 0)) {
    axisX = -axisX
    axisY = -axisY
  }

  const normalX = -axisY
  const normalY = axisX
  const startT = wall.start[0] * axisX + wall.start[1] * axisY
  const endT = wall.end[0] * axisX + wall.end[1] * axisY
  const startOffset = wall.start[0] * normalX + wall.start[1] * normalY
  const endOffset = wall.end[0] * normalX + wall.end[1] * normalY
  const angle = Math.atan2(axisY, axisX)

  return {
    id: wall.id,
    wall,
    parentId: wall.parentId ?? null,
    axisX,
    axisY,
    normalX,
    normalY,
    offset: (startOffset + endOffset) / 2,
    t0: Math.min(startT, endT),
    t1: Math.max(startT, endT),
    length,
    height: wall.height ?? DEFAULT_WALL_HEIGHT,
    thickness: wall.thickness ?? DEFAULT_WALL_THICKNESS,
    angleBucket: Math.round(angle / WALL_ANGLE_BUCKET_RAD),
  }
}

function wallLineTolerance(a: WallSegment, b: WallSegment) {
  return Math.max(0.06, Math.min(0.14, Math.max(a.thickness, b.thickness) * 0.5))
}

function wallHeightCompatible(a: WallSegment, b: WallSegment) {
  return Math.abs(a.height - b.height) <= WALL_HEIGHT_TOLERANCE
}

function wallIntervalsCompatible(a: WallSegment, b: WallSegment, maxJoinGap: number) {
  const gap = Math.max(a.t0, b.t0) - Math.min(a.t1, b.t1)
  if (gap <= maxJoinGap) return true

  const overlap = Math.min(a.t1, b.t1) - Math.max(a.t0, b.t0)
  if (overlap <= 0) return false
  return overlap / Math.min(a.length, b.length) >= 0.5
}

function wallsCanMerge(a: WallSegment, b: WallSegment, maxJoinGap: number) {
  if (a.parentId !== b.parentId) return false
  if (Math.abs(a.angleBucket - b.angleBucket) > 1) return false
  if (Math.abs(a.offset - b.offset) > wallLineTolerance(a, b)) return false
  if (!wallHeightCompatible(a, b)) return false
  return wallIntervalsCompatible(a, b, maxJoinGap)
}

function find(parent: number[], index: number): number {
  let current = index
  while (parent[current] !== current) {
    parent[current] = parent[parent[current]]
    current = parent[current]
  }
  return current
}

function union(parent: number[], a: number, b: number) {
  const rootA = find(parent, a)
  const rootB = find(parent, b)
  if (rootA !== rootB) parent[rootB] = rootA
}

function openingWorldPosition(opening: OpeningNode, wall: WallNode): [number, number] {
  const length = wallLength(wall)
  if (length < 1e-6) return [wall.start[0], wall.start[1]]
  const axisX = (wall.end[0] - wall.start[0]) / length
  const axisY = (wall.end[1] - wall.start[1]) / length
  const normalX = -axisY
  const normalY = axisX
  const [localX, , localZ] = opening.position
  return [
    wall.start[0] + axisX * localX + normalX * localZ,
    wall.start[1] + axisY * localX + normalY * localZ,
  ]
}

function clampOpeningAlongWall(opening: OpeningNode, along: number, wallLengthValue: number) {
  const width = opening.width ?? (opening.type === 'door' ? 0.9 : 1.0)
  const half = width / 2
  const lo = Math.min(half, wallLengthValue / 2)
  const hi = Math.max(wallLengthValue - half, wallLengthValue / 2)
  return Math.max(lo, Math.min(hi, along))
}

function rehostOpeningToWall(opening: OpeningNode, oldWall: WallNode, newWall: WallNode) {
  const [worldX, worldY] = openingWorldPosition(opening, oldWall)
  const newLength = wallLength(newWall)
  if (newLength < 1e-6) return

  const axisX = (newWall.end[0] - newWall.start[0]) / newLength
  const axisY = (newWall.end[1] - newWall.start[1]) / newLength
  const normalX = -axisY
  const normalY = axisX
  const relX = worldX - newWall.start[0]
  const relY = worldY - newWall.start[1]
  const along = clampOpeningAlongWall(opening, relX * axisX + relY * axisY, newLength)
  const across = relX * normalX + relY * normalY
  opening.parentId = newWall.id
  opening.wallId = newWall.id
  opening.position = [along, opening.position[1], across]
}

function pointOnLine(segment: WallSegment, t: number, offset: number): [number, number] {
  return [
    segment.axisX * t + segment.normalX * offset,
    segment.axisY * t + segment.normalY * offset,
  ]
}

function chooseKeptSegment(cluster: WallSegment[]) {
  return cluster.reduce((best, current) => {
    if (current.wall.children.length !== best.wall.children.length) {
      return current.wall.children.length > best.wall.children.length ? current : best
    }
    return current.length > best.length ? current : best
  }, cluster[0])
}

function collectOpeningIdsForWalls(nodes: SceneNodes, wallIds: Set<string>) {
  const childIds = new Set<string>()
  const childOriginWall = new Map<string, string>()

  for (const wallId of wallIds) {
    const wall = nodes[wallId]
    if (wall?.type !== 'wall') continue
    for (const childId of wall.children) {
      childIds.add(childId)
      childOriginWall.set(childId, wallId)
    }
  }

  for (const node of Object.values(nodes)) {
    if (!isOpeningNode(node)) continue
    const wallId = getOpeningWallId(node, nodes)
    if (!wallId || !wallIds.has(wallId)) continue
    childIds.add(node.id)
    childOriginWall.set(node.id, wallId)
  }

  return { childIds, childOriginWall }
}

function mergeWallCluster(
  nodes: SceneNodes,
  cluster: WallSegment[],
  stats: IfcConversionSimplificationStats,
) {
  const kept = chooseKeptSegment(cluster)
  const keptWall = kept.wall
  const wallIds = new Set(cluster.map((segment) => segment.id))
  const originalWalls = new Map(
    cluster.map((segment) => [
      segment.id,
      {
        ...segment.wall,
        start: [...segment.wall.start],
        end: [...segment.wall.end],
        children: [...segment.wall.children],
      } as WallNode,
    ]),
  )
  const { childIds, childOriginWall } = collectOpeningIdsForWalls(nodes, wallIds)
  const t0 = Math.min(...cluster.map((segment) => segment.t0))
  const t1 = Math.max(...cluster.map((segment) => segment.t1))
  const crossMin = Math.min(...cluster.map((segment) => segment.offset - segment.thickness / 2))
  const crossMax = Math.max(...cluster.map((segment) => segment.offset + segment.thickness / 2))
  const offset = (crossMin + crossMax) / 2
  const thickness = Math.max(...cluster.map((segment) => segment.thickness), crossMax - crossMin)
  const height = Math.max(...cluster.map((segment) => segment.height))
  const mergedExpressIds = cluster
    .map((segment) => (segment.wall.metadata as { expressID?: unknown } | undefined)?.expressID)
    .filter((expressID): expressID is number => typeof expressID === 'number')

  keptWall.start = pointOnLine(kept, t0, offset)
  keptWall.end = pointOnLine(kept, t1, offset)
  keptWall.thickness = thickness
  keptWall.height = height
  keptWall.metadata = {
    ...((keptWall.metadata as Record<string, unknown> | undefined) ?? {}),
    ifcSimplification: {
      mergedWallCount: cluster.length,
      mergedExpressIDs: mergedExpressIds,
    },
  }

  const nextChildren = new Set<string>()

  for (const childId of childIds) {
    const child = nodes[childId]
    if (!child) continue
    if (isOpeningNode(child)) {
      const originWallId = childOriginWall.get(childId)
      const originWall = originWallId ? originalWalls.get(originWallId) : undefined
      if (originWall) {
        rehostOpeningToWall(child, originWall, keptWall)
      } else {
        child.parentId = keptWall.id
        child.wallId = keptWall.id
      }
    } else {
      child.parentId = keptWall.id
    }
    nextChildren.add(childId)
  }

  keptWall.children = Array.from(nextChildren) as WallNode['children']

  for (const segment of cluster) {
    if (segment.id === keptWall.id) continue
    delete nodes[segment.id]
    removeNodeFromParents(nodes, segment.id)
  }

  const parent = keptWall.parentId ? nodes[keptWall.parentId] : undefined
  const parentWithChildren = parent as { children?: string[] } | undefined
  if (parentWithChildren?.children && !parentWithChildren.children.includes(keptWall.id)) {
    parentWithChildren.children.push(keptWall.id)
  }

  stats.mergedWallGroups += 1
  stats.removedMergedWalls += cluster.length - 1
}

function mergeWallFragments(
  nodes: SceneNodes,
  stats: IfcConversionSimplificationStats,
  options: Required<IfcConversionSimplificationOptions>,
) {
  const segments = Object.values(nodes)
    .filter((node): node is WallNode => node.type === 'wall')
    .map(toWallSegment)
    .filter((segment): segment is WallSegment => segment !== null)

  const groups = new Map<string, WallSegment[]>()
  for (const segment of segments) {
    const key = `${segment.parentId ?? 'root'}:${segment.angleBucket}`
    const group = groups.get(key)
    if (group) group.push(segment)
    else groups.set(key, [segment])
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue
    const parent = group.map((_, index) => index)

    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (wallsCanMerge(group[i], group[j], options.maxWallJoinGap)) {
          union(parent, i, j)
        }
      }
    }

    const clusters = new Map<number, WallSegment[]>()
    for (let i = 0; i < group.length; i++) {
      const root = find(parent, i)
      const cluster = clusters.get(root)
      if (cluster) cluster.push(group[i])
      else clusters.set(root, [group[i]])
    }

    for (const cluster of clusters.values()) {
      if (cluster.length < 2) continue
      mergeWallCluster(nodes, cluster, stats)
    }
  }
}

function signatureNumber(value: number | undefined, tolerance: number) {
  return Math.round((value ?? 0) / tolerance)
}

function openingSignature(opening: OpeningNode) {
  const [x, y, z] = opening.position
  const family =
    opening.type === 'door'
      ? `${opening.openingKind}:${opening.openingShape}:${opening.doorType}`
      : `${opening.openingKind}:${opening.openingShape}:${opening.windowType}`
  return [
    opening.type,
    family,
    signatureNumber(x, OPENING_DUPLICATE_TOLERANCE),
    signatureNumber(y, OPENING_DUPLICATE_TOLERANCE),
    signatureNumber(z, OPENING_DUPLICATE_TOLERANCE),
    signatureNumber(opening.width, OPENING_DUPLICATE_TOLERANCE),
    signatureNumber(opening.height, OPENING_DUPLICATE_TOLERANCE),
  ].join(':')
}

function dedupeOpenings(nodes: SceneNodes, stats: IfcConversionSimplificationStats) {
  const byWall = new Map<string, OpeningNode[]>()
  for (const node of Object.values(nodes)) {
    if (!isOpeningNode(node)) continue
    const wallId = getOpeningWallId(node, nodes)
    if (!wallId) continue
    const openings = byWall.get(wallId)
    if (openings) openings.push(node)
    else byWall.set(wallId, [node])
  }

  for (const openings of byWall.values()) {
    const seen = new Set<string>()
    for (const opening of openings) {
      const signature = openingSignature(opening)
      if (!seen.has(signature)) {
        seen.add(signature)
        continue
      }
      delete nodes[opening.id]
      removeNodeFromParents(nodes, opening.id)
      stats.removedDuplicateOpenings += 1
    }
  }
}

export function simplifyConvertedSceneGraph(
  nodes: SceneNodes,
  options: IfcConversionSimplificationOptions = {},
): IfcConversionSimplificationStats {
  const stats = getInitialStats(nodes)

  if (options.enabled === false) {
    finishStats(nodes, stats)
    return stats
  }

  const resolvedOptions: Required<IfcConversionSimplificationOptions> = {
    enabled: true,
    maxWallJoinGap: options.maxWallJoinGap ?? DEFAULT_MAX_WALL_JOIN_GAP,
  }

  pruneTinyWalls(nodes, stats)
  mergeWallFragments(nodes, stats, resolvedOptions)
  syncWallOpeningChildren(nodes)
  dedupeOpenings(nodes, stats)
  normalizeChildren(nodes)
  finishStats(nodes, stats)
  return stats
}
