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

const CLEARANCE = 0.05

function overlaps(aCenter: number, aWidth: number, bCenter: number, bWidth: number) {
  return Math.abs(aCenter - bCenter) < (aWidth + bWidth) / 2 + CLEARANCE
}

function planBounds(leanTo: LeanToExtensionNode, wall: WallNode) {
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const length = Math.max(1e-6, Math.hypot(dx, dz))
  const along = [dx / length, dz / length] as const
  const side = Math.cos(leanTo.rotation[1]) >= 0 ? 1 : -1
  const outward = [-along[1] * side, along[0] * side] as const
  const center = [
    wall.start[0] + along[0] * leanTo.position[0],
    wall.start[1] + along[1] * leanTo.position[0],
  ] as const
  const halfSpan = leanTo.span / 2 + leanTo.sideOverhang
  const run = leanTo.projection + leanTo.eaveOverhang
  const points = [-halfSpan, halfSpan].flatMap((x) =>
    [0, run].map((z) => [
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
  for (const node of Object.values(nodes)) {
    if (node.type !== 'lean-to-extension' || node.id === leanTo.id || node.parentId === wall.id)
      continue
    const host = node.parentId ? nodes[node.parentId as AnyNodeId] : undefined
    if (host?.type === 'wall' && boundsOverlap(candidateBounds, planBounds(node, host))) {
      conflicts.push(`adjacent extension ${node.id}`)
    }
  }

  for (const node of Object.values(nodes)) {
    if (node.type !== 'wall' || node.id === wall.id) continue
    const building = ancestorBuilding(node, nodes)
    if (!(building && hostBuilding && building.id !== hostBuilding.id)) continue
    if (boundsOverlap(candidateWorldBounds, wallWorldBounds(node, building))) {
      conflicts.push(`adjacent building ${building.id}`)
      break
    }
  }

  const elevations = getLevelElevations(nodes)
  const wallLevelY = wall.parentId ? (elevations.get(wall.parentId)?.baseY ?? 0) : 0
  const buildingY = hostBuilding?.position[1] ?? 0
  const candidateMinY = buildingY + wallLevelY + leanTo.position[1] + leanTo.lowEdgeHeight
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
