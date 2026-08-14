import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  getActiveRoofHeight,
  getLevelElevations,
  type LeanToExtensionNode,
  type RoofNode,
  type RoofSegmentNode,
  type WallNode,
} from '@pascal-app/core'
import { resolveLeanToLayout } from './layout'

const CLEARANCE = 0.05

function overlaps(aCenter: number, aWidth: number, bCenter: number, bWidth: number) {
  return Math.abs(aCenter - bCenter) < (aWidth + bWidth) / 2 + CLEARANCE
}

function planBounds(leanTo: LeanToExtensionNode, wall: WallNode) {
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const length = Math.max(1e-6, Math.hypot(dx, dz))
  const along = [dx / length, dz / length] as const
  const normal = [-along[1], along[0]] as const
  const side = Math.cos(leanTo.rotation[1]) >= 0 ? 1 : -1
  const outward = [normal[0] * side, normal[1] * side] as const
  const center = [
    wall.start[0] + along[0] * leanTo.position[0] + normal[0] * leanTo.position[2],
    wall.start[1] + along[1] * leanTo.position[0] + normal[1] * leanTo.position[2],
  ] as const
  const minAlong = -leanTo.span / 2 - leanTo.leftOverhang
  const maxAlong = leanTo.span / 2 + leanTo.rightOverhang
  const minOutward = -leanTo.highOverhang
  const maxOutward = leanTo.projection + leanTo.lowOverhang
  const points = [minAlong, maxAlong].flatMap((x) =>
    [minOutward, maxOutward].map((z) => [
      center[0] + along[0] * x + outward[0] * z,
      center[1] + along[1] * x + outward[1] * z,
    ]),
  )
  return {
    minX: Math.min(...points.map((point) => point[0]!)),
    maxX: Math.max(...points.map((point) => point[0]!)),
    minZ: Math.min(...points.map((point) => point[1]!)),
    maxZ: Math.max(...points.map((point) => point[1]!)),
  }
}

function boundsOverlap(a: ReturnType<typeof planBounds>, b: ReturnType<typeof planBounds>) {
  return (
    a.minX < b.maxX - CLEARANCE &&
    a.maxX > b.minX + CLEARANCE &&
    a.minZ < b.maxZ - CLEARANCE &&
    a.maxZ > b.minZ + CLEARANCE
  )
}

type Bounds = ReturnType<typeof planBounds>
type PlanPoint = readonly [number, number]

function ancestorBuilding(
  node: AnyNode | undefined,
  nodes: Record<AnyNodeId, AnyNode>,
): BuildingNode | undefined {
  let current = node
  const seen = new Set<string>()
  while (current?.parentId && !seen.has(current.id)) {
    seen.add(current.id)
    const parent = nodes[current.parentId as AnyNodeId]
    if (parent?.type === 'building') return parent
    current = parent
  }
  return undefined
}

function transformBounds(bounds: Bounds, building?: BuildingNode): Bounds {
  const rotation = building?.rotation[1] ?? 0
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const points = [
    [bounds.minX, bounds.minZ],
    [bounds.minX, bounds.maxZ],
    [bounds.maxX, bounds.minZ],
    [bounds.maxX, bounds.maxZ],
  ].map(([x, z]) => [
    (building?.position[0] ?? 0) + x! * cos + z! * sin,
    (building?.position[2] ?? 0) - x! * sin + z! * cos,
  ])
  return {
    minX: Math.min(...points.map((point) => point[0]!)),
    maxX: Math.max(...points.map((point) => point[0]!)),
    minZ: Math.min(...points.map((point) => point[1]!)),
    maxZ: Math.max(...points.map((point) => point[1]!)),
  }
}

function transformPoint(point: PlanPoint, building?: BuildingNode): PlanPoint {
  const rotation = building?.rotation[1] ?? 0
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  return [
    (building?.position[0] ?? 0) + point[0] * cos + point[1] * sin,
    (building?.position[2] ?? 0) - point[0] * sin + point[1] * cos,
  ]
}

function pointSegmentDistance(point: PlanPoint, start: PlanPoint, end: PlanPoint): number {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const lengthSq = dx * dx + dz * dz
  if (lengthSq <= 1e-12) return Math.hypot(point[0] - start[0], point[1] - start[1])
  const t = Math.max(
    0,
    Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSq),
  )
  return Math.hypot(point[0] - (start[0] + dx * t), point[1] - (start[1] + dz * t))
}

function segmentDistance(a: PlanPoint, b: PlanPoint, c: PlanPoint, d: PlanPoint): number {
  const orientation = (p: PlanPoint, q: PlanPoint, r: PlanPoint) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  const abC = orientation(a, b, c)
  const abD = orientation(a, b, d)
  const cdA = orientation(c, d, a)
  const cdB = orientation(c, d, b)
  if (abC * abD <= 0 && cdA * cdB <= 0) return 0
  return Math.min(
    pointSegmentDistance(a, c, d),
    pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b),
    pointSegmentDistance(d, a, b),
  )
}

function leanToEndEdges(
  leanTo: LeanToExtensionNode,
  wall: WallNode,
  building?: BuildingNode,
): { left: readonly [PlanPoint, PlanPoint]; right: readonly [PlanPoint, PlanPoint] } {
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const length = Math.max(1e-6, Math.hypot(dx, dz))
  const along: PlanPoint = [dx / length, dz / length]
  const normal: PlanPoint = [-along[1], along[0]]
  const side = Math.cos(leanTo.rotation[1]) >= 0 ? 1 : -1
  const outward: PlanPoint = [normal[0] * side, normal[1] * side]
  const center: PlanPoint = [
    wall.start[0] + along[0] * leanTo.position[0] + normal[0] * leanTo.position[2],
    wall.start[1] + along[1] * leanTo.position[0] + normal[1] * leanTo.position[2],
  ]
  const edge = (alongOffset: number): readonly [PlanPoint, PlanPoint] => [
    transformPoint(
      [
        center[0] + along[0] * alongOffset - outward[0] * leanTo.highOverhang,
        center[1] + along[1] * alongOffset - outward[1] * leanTo.highOverhang,
      ],
      building,
    ),
    transformPoint(
      [
        center[0] + along[0] * alongOffset + outward[0] * (leanTo.projection + leanTo.lowOverhang),
        center[1] + along[1] * alongOffset + outward[1] * (leanTo.projection + leanTo.lowOverhang),
      ],
      building,
    ),
  ]
  return {
    left: edge(-leanTo.span / 2 - leanTo.leftOverhang),
    right: edge(leanTo.span / 2 + leanTo.rightOverhang),
  }
}

function wallEndHits(
  edges: ReturnType<typeof leanToEndEdges>,
  wall: WallNode,
  building: BuildingNode,
): { left: boolean; right: boolean } {
  const start = transformPoint([wall.start[0], wall.start[1]], building)
  const end = transformPoint([wall.end[0], wall.end[1]], building)
  const tolerance = Math.max(CLEARANCE, (wall.thickness ?? 0.1) / 2 + CLEARANCE)
  return {
    left: segmentDistance(edges.left[0], edges.left[1], start, end) <= tolerance,
    right: segmentDistance(edges.right[0], edges.right[1], start, end) <= tolerance,
  }
}

function adjacentBuildingEndHits(
  leanTo: LeanToExtensionNode,
  wall: WallNode,
  nodes: Record<AnyNodeId, AnyNode>,
): { left: boolean; right: boolean } {
  const hostBuilding = ancestorBuilding(wall, nodes)
  const edges = leanToEndEdges(leanTo, wall, hostBuilding)
  let left = false
  let right = false
  for (const node of Object.values(nodes)) {
    if (node.type !== 'wall') continue
    const building = ancestorBuilding(node, nodes)
    if (!(building && hostBuilding && building.id !== hostBuilding.id)) continue
    const hits = wallEndHits(edges, node, building)
    left ||= hits.left
    right ||= hits.right
  }
  return { left, right }
}

export function resolveLeanToEndAbutments(
  leanTo: LeanToExtensionNode,
  wall: WallNode,
  nodes: Record<AnyNodeId, AnyNode>,
): LeanToExtensionNode {
  const hits = adjacentBuildingEndHits(leanTo, wall, nodes)
  if (!hits.left && !hits.right) return leanTo
  return {
    ...leanTo,
    leftEndCondition: hits.left ? 'wall-abutment' : leanTo.leftEndCondition,
    rightEndCondition: hits.right ? 'wall-abutment' : leanTo.rightEndCondition,
    downspoutPosition: hits.left && hits.right ? 0 : hits.right ? -1 : 1,
  }
}

function wallWorldBounds(wall: WallNode, building?: BuildingNode): Bounds {
  const half = Math.max(CLEARANCE, (wall.thickness ?? 0.1) / 2)
  return transformBounds(
    {
      minX: Math.min(wall.start[0], wall.end[0]) - half,
      maxX: Math.max(wall.start[0], wall.end[0]) + half,
      minZ: Math.min(wall.start[1], wall.end[1]) - half,
      maxZ: Math.max(wall.start[1], wall.end[1]) + half,
    },
    building,
  )
}

function roofSegmentWorldBounds(
  roof: RoofNode,
  segment: RoofSegmentNode,
  building?: BuildingNode,
): Bounds {
  const points = roofSegmentLevelPoints(roof, segment)
  return transformBounds(
    {
      minX: Math.min(...points.map((point) => point[0]!)),
      maxX: Math.max(...points.map((point) => point[0]!)),
      minZ: Math.min(...points.map((point) => point[1]!)),
      maxZ: Math.max(...points.map((point) => point[1]!)),
    },
    building,
  )
}

function roofSegmentLevelPoints(roof: RoofNode, segment: RoofSegmentNode): [number, number][] {
  const halfX = segment.width / 2 + segment.overhang
  const halfZ = segment.depth / 2 + segment.overhang
  const segmentCos = Math.cos(segment.rotation)
  const segmentSin = Math.sin(segment.rotation)
  const roofCos = Math.cos(roof.rotation)
  const roofSin = Math.sin(roof.rotation)
  return [
    [-halfX, -halfZ],
    [-halfX, halfZ],
    [halfX, -halfZ],
    [halfX, halfZ],
  ].map(([x, z]) => {
    const sx = segment.position[0] + x! * segmentCos + z! * segmentSin
    const sz = segment.position[2] - x! * segmentSin + z! * segmentCos
    return [
      roof.position[0] + sx * roofCos + sz * roofSin,
      roof.position[2] - sx * roofSin + sz * roofCos,
    ]
  })
}

function hostRoofIntrudesBeyondConnection(
  leanTo: LeanToExtensionNode,
  wall: WallNode,
  roof: RoofNode,
  segment: RoofSegmentNode,
): boolean {
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const length = Math.max(1e-6, Math.hypot(dx, dz))
  const along: readonly [number, number] = [dx / length, dz / length]
  const side = Math.cos(leanTo.rotation[1]) >= 0 ? 1 : -1
  const outward: readonly [number, number] = [-along[1] * side, along[0] * side]
  const origin: readonly [number, number] = [
    wall.start[0] + along[0] * leanTo.position[0],
    wall.start[1] + along[1] * leanTo.position[0],
  ]
  const furthestOutward = Math.max(
    ...roofSegmentLevelPoints(roof, segment).map(
      ([x, z]) => (x - origin[0]) * outward[0] + (z - origin[1]) * outward[1],
    ),
  )
  return furthestOutward > leanTo.connectionInset + CLEARANCE
}

export function leanToPlacementConflicts(
  leanTo: LeanToExtensionNode,
  wall: WallNode,
  nodes: Record<AnyNodeId, AnyNode>,
): string[] {
  const conflicts: string[] = []
  for (const childId of wall.children ?? []) {
    const child = nodes[childId as AnyNodeId]
    if (!child || child.id === leanTo.id) continue
    if (child.type === 'door' || child.type === 'window') {
      if (overlaps(leanTo.position[0], leanTo.span, child.position[0], child.width)) {
        conflicts.push(`${child.type} ${child.id}`)
      }
      continue
    }
    if (
      child.type === 'lean-to-extension' &&
      Math.cos(child.rotation[1]) * Math.cos(leanTo.rotation[1]) > 0 &&
      overlaps(leanTo.position[0], leanTo.span, child.position[0], child.span)
    ) {
      conflicts.push(`lean-to extension ${child.id}`)
    }
  }
  const candidateBounds = planBounds(leanTo, wall)
  const hostBuilding = ancestorBuilding(wall, nodes)
  const candidateWorldBounds = transformBounds(candidateBounds, hostBuilding)
  const permittedEndHits = adjacentBuildingEndHits(leanTo, wall, nodes)
  const endEdges = leanToEndEdges(leanTo, wall, hostBuilding)
  for (const node of Object.values(nodes)) {
    if (node.type !== 'lean-to-extension' || node.id === leanTo.id || node.parentId === wall.id)
      continue
    const host = node.parentId ? nodes[node.parentId as AnyNodeId] : undefined
    if (
      host?.type === 'wall' &&
      boundsOverlap(
        candidateWorldBounds,
        transformBounds(planBounds(node, host), ancestorBuilding(host, nodes)),
      )
    ) {
      conflicts.push(`adjacent extension ${node.id}`)
    }
  }

  for (const node of Object.values(nodes)) {
    if (node.type !== 'wall' || node.id === wall.id) continue
    const building = ancestorBuilding(node, nodes)
    if (!(building && hostBuilding && building.id !== hostBuilding.id)) continue
    if (boundsOverlap(candidateWorldBounds, wallWorldBounds(node, building))) {
      const wallHits = wallEndHits(endEdges, node, building)
      if (
        (wallHits.left && permittedEndHits.left && leanTo.leftEndCondition === 'wall-abutment') ||
        (wallHits.right && permittedEndHits.right && leanTo.rightEndCondition === 'wall-abutment')
      ) {
        continue
      }
      conflicts.push(`adjacent building ${building.id}`)
      break
    }
  }

  const elevations = getLevelElevations(nodes)
  const wallLevelY = wall.parentId ? (elevations.get(wall.parentId)?.baseY ?? 0) : 0
  const buildingY = hostBuilding?.position[1] ?? 0
  const candidateMinY =
    buildingY + wallLevelY + leanTo.position[1] + resolveLeanToLayout(leanTo).lowEdgeHeight
  const candidateMaxY =
    buildingY + wallLevelY + leanTo.position[1] + leanTo.highEdgeHeight + leanTo.roofThickness
  for (const roof of Object.values(nodes)) {
    if (roof.type !== 'roof') continue
    if ((roof.metadata as Record<string, unknown> | undefined)?.managedByLeanTo === leanTo.id)
      continue
    const roofBuilding = ancestorBuilding(roof, nodes)
    if (roofBuilding?.id !== hostBuilding?.id) continue
    const roofLevelY = roof.parentId ? (elevations.get(roof.parentId)?.baseY ?? 0) : 0
    for (const childId of roof.children) {
      const segment = nodes[childId as AnyNodeId]
      if (segment?.type !== 'roof-segment') continue
      if (segment.id === leanTo.hostRoofSegmentId) {
        if (hostRoofIntrudesBeyondConnection(leanTo, wall, roof, segment)) {
          conflicts.push(`host roof/eave ${segment.id}`)
        }
        continue
      }
      if (!boundsOverlap(candidateWorldBounds, roofSegmentWorldBounds(roof, segment, roofBuilding)))
        continue
      const roofMinY = buildingY + roofLevelY + roof.position[1] + segment.position[1]
      const roofMaxY =
        roofMinY + segment.wallHeight + getActiveRoofHeight(segment) + segment.deckThickness
      if (candidateMinY < roofMaxY - CLEARANCE && candidateMaxY > roofMinY + CLEARANCE) {
        conflicts.push(`roof/eave ${segment.id}`)
      }
    }
  }
  return conflicts
}
