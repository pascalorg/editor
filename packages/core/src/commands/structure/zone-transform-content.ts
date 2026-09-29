import { containsPoint, difference, distanceToBoundary, union } from '../../lib/polygon-boolean'
import type { AnyNode, WallNode, ZoneNode } from '../../schema'
import { isDerivedNode } from '../../store/derived-node-guard'
import { calculateLevelMiters, getWallPlanFootprint } from '../../systems/wall/wall-footprint'
import { containedMezzanines, electedIntentPlate, isFloorPlacedIntent } from './mezzanine-content'
import { type Point, project, roomFace, type StructureNodes } from './shared'

const isIntent = (node: AnyNode): boolean => !isDerivedNode(node)

export function collectTransformContents(nodes: StructureNodes, zone: ZoneNode) {
  if (zone.floor?.support === 'open') {
    return new Set(
      Object.values(nodes)
        .filter((node) => {
          if (!isIntent(node)) return false
          if (node.type === 'floor-opening' && node.hostZoneId === zone.id) return true
          const parent = nodes[node.parentId ?? '']
          if (parent?.type === 'ceiling' && parent.zoneId === zone.id) return true
          return (
            node.parentId === zone.parentId &&
            isFloorPlacedIntent(node) &&
            !!electedIntentPlate(nodes, node)?.zoneIds?.includes(zone.id)
          )
        })
        .map((node) => node.id),
    )
  }
  const ids = new Set(containedMezzanines(nodes, zone).map((node) => node.id as string))
  const face = roomFace(nodes, zone)
  const footprint = [
    { outer: face?.referencePolygon ?? zone.polygon, holes: face?.holes ?? zone.holes },
  ]
  const walls = Object.values(nodes).filter(
    (node): node is WallNode => node.type === 'wall' && node.parentId === zone.parentId,
  )
  const boundaryWalls = walls.filter((wall) =>
    face?.spans.some((span) => span.boundaryId === wall.id),
  )
  const miters = calculateLevelMiters(walls)
  const clear = difference(
    footprint,
    union(
      boundaryWalls.map((wall) =>
        getWallPlanFootprint(wall, miters).map(({ x, y }): Point => [x, y]),
      ),
    ),
  )
  const inside = (point: Point) => {
    if (!containsPoint(footprint, point)) return false
    if (containsPoint(clear, point)) return true
    const nearest = boundaryWalls
      .map((wall) => ({ wall, distance: project(point, wall.start, wall.end).distance }))
      .sort((a, b) => a.distance - b.distance)[0]
    return (
      !!nearest && distanceToBoundary(clear, point) <= (nearest.wall.thickness ?? 0.1) / 2 + 1e-6
    )
  }
  const furnishingKinds = new Set(['item', 'procedural-item', 'cabinet', 'shelf', 'stair'])
  for (const node of Object.values(nodes)) {
    if (node.parentId === zone.parentId && isIntent(node)) {
      if (
        node.type === 'floor-opening' &&
        !node.hostZoneId &&
        node.polygon.every((point) => containsPoint(clear, point))
      )
        ids.add(node.id)
      if (
        furnishingKinds.has(node.type) &&
        'position' in node &&
        Array.isArray(node.position) &&
        !('wallId' in node && node.wallId) &&
        inside([node.position[0], node.position[2]])
      )
        ids.add(node.id)
      if (
        (node.type === 'slab' || node.type === 'ceiling') &&
        node.polygon.length >= 3 &&
        node.polygon.every((p) => containsPoint(footprint, p))
      )
        ids.add(node.id)
    }
    const parent = node.parentId ? nodes[node.parentId] : undefined
    if (
      parent &&
      isDerivedNode(parent) &&
      furnishingKinds.has(node.type) &&
      'position' in node &&
      Array.isArray(node.position) &&
      parent.parentId === zone.parentId &&
      inside([node.position[0], node.position[2]])
    )
      ids.add(node.id)
  }
  return ids
}

export function includeDescendants(nodes: StructureNodes, ids: Set<string>) {
  let changed = true
  while (changed) {
    changed = false
    for (const node of Object.values(nodes))
      if (!isDerivedNode(node) && node.parentId && ids.has(node.parentId) && !ids.has(node.id)) {
        ids.add(node.id)
        changed = true
      }
  }
}

export function repairTransformChildren(nodes: Record<string, AnyNode>, before: StructureNodes) {
  const affected = new Set<string>()
  const byParent = new Map<string, string[]>()
  for (const node of Object.values(nodes)) {
    if (node.parentId) {
      const children = byParent.get(node.parentId) ?? []
      children.push(node.id)
      byParent.set(node.parentId, children)
    }
    if (node !== before[node.id]) {
      affected.add(node.id)
      if (node.parentId) affected.add(node.parentId)
      const previousParent = before[node.id]?.parentId
      if (previousParent) affected.add(previousParent)
    }
  }
  for (const node of Object.values(before))
    if (!nodes[node.id] && node.parentId) affected.add(node.parentId)
  for (const id of affected) {
    const node = nodes[id]
    if (!node || isDerivedNode(node) || !('children' in node) || !Array.isArray(node.children))
      continue
    const children = new Set(byParent.get(id) ?? [])
    const ordered = [
      ...node.children.filter((id) => children.has(id)),
      ...[...children].filter((id) => !node.children.includes(id as never)),
    ]
    if (JSON.stringify(ordered) !== JSON.stringify(node.children))
      nodes[node.id] = { ...node, children: ordered } as AnyNode
  }
}
