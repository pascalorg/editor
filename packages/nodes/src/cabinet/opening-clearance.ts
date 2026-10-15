import {
  type AnyNode,
  type AnyNodeId,
  type CabinetModuleNode,
  floorPlacedCollides,
  getFloorPlacedFootprints,
  getWallBodyLine,
  nodeRegistry,
  resolveLevelId,
} from '@pascal-app/core'
import { compartmentDoorType, normalizeCabinetStack } from './stack'

/** Conservative opening envelopes: warnings, not a collision veto. */
export function cabinetOpeningFootprints(
  node: CabinetModuleNode,
  position: [number, number, number],
  yaw: number,
) {
  if (node.moduleKind !== 'standard') return []
  const plinth = node.showPlinth ? node.plinthHeight : 0
  return normalizeCabinetStack(node).flatMap(({ compartment, y0, height }) => {
    let reach = 0
    switch (compartment.type) {
      case 'door':
        reach =
          node.width /
          (['double', 'glass'].includes(compartmentDoorType(compartment, node.width)) ? 2 : 1)
        break
      case 'sink':
        reach = node.width / 2
        break
      case 'drawer':
        reach = Math.min(node.depth * 0.9, 0.35)
        break
      case 'pull-out-pantry':
        reach = node.depth * 0.9
        break
      case 'fridge-double':
        reach = node.width / 2
        break
      case 'fridge-single':
      case 'fridge-top-freezer':
      case 'fridge-bottom-freezer':
      case 'microwave':
        reach = node.width
        break
      case 'oven':
      case 'dishwasher':
        reach = height
        break
      default:
        return []
    }
    const z = node.depth / 2 + node.frontThickness + reach / 2 + 0.005
    return [
      {
        position: [
          position[0] + Math.sin(yaw) * z,
          position[1] + plinth + y0,
          position[2] + Math.cos(yaw) * z,
        ] as [number, number, number],
        dimensions: [Math.max(0.01, node.width - 0.01), height, reach] as [number, number, number],
        rotation: [0, yaw, 0] as [number, number, number],
      },
    ]
  })
}

export type OpeningFootprint = ReturnType<typeof cabinetOpeningFootprints>[number]

export function openingFootprintsOverlap(a: OpeningFootprint, b: OpeningFootprint) {
  if (
    a.position[1] + a.dimensions[1] <= b.position[1] + 0.001 ||
    b.position[1] + b.dimensions[1] <= a.position[1] + 0.001
  )
    return false
  const axes = (yaw: number) =>
    [
      [Math.cos(yaw), -Math.sin(yaw)],
      [Math.sin(yaw), Math.cos(yaw)],
    ] as const
  const aa = axes(a.rotation[1]),
    bb = axes(b.rotation[1])
  const delta = [b.position[0] - a.position[0], b.position[2] - a.position[2]]
  return [...aa, ...bb].every((axis) => {
    const radius = (fp: OpeningFootprint, basis: ReturnType<typeof axes>) =>
      (Math.abs(axis[0] * basis[0][0] + axis[1] * basis[0][1]) * fp.dimensions[0]) / 2 +
      (Math.abs(axis[0] * basis[1][0] + axis[1] * basis[1][1]) * fp.dimensions[2]) / 2
    return (
      Math.abs(delta[0]! * axis[0] + delta[1]! * axis[1]) < radius(a, aa) + radius(b, bb) - 0.001
    )
  })
}

export function cabinetOpeningConflicts(
  node: CabinetModuleNode,
  position: [number, number, number],
  yaw: number,
  levelId: string,
  nodes: Record<AnyNodeId, AnyNode>,
  ignoreIds: readonly string[] = [],
) {
  const openings = cabinetOpeningFootprints(node, position, yaw)
  if (!openings.length) return []
  const ignored = new Set([...ignoreIds, node.id])
  const ignoredNode = (candidate: AnyNode) => {
    let current: AnyNode | undefined = candidate
    const visited = new Set<string>()
    while (current && !visited.has(current.id)) {
      if (ignored.has(current.id) || current.visible === false) return true
      visited.add(current.id)
      current = current.parentId ? nodes[current.parentId as AnyNodeId] : undefined
    }
    return false
  }
  return Object.values(nodes)
    .filter((candidate) => {
      if (ignoredNode(candidate) || resolveLevelId(candidate, nodes) !== levelId) return false
      if (candidate.type === 'wall' && !candidate.curveOffset) {
        const body = getWallBodyLine({ ...candidate, thickness: candidate.thickness ?? 0.2 })
        const dx = body.end.x - body.start.x,
          dz = body.end.y - body.start.y
        const level = nodes[levelId as AnyNodeId]
        const wall: OpeningFootprint = {
          position: [
            (body.start.x + body.end.x) / 2,
            candidate.supportOffset ?? 0,
            (body.start.y + body.end.y) / 2,
          ],
          dimensions: [
            Math.hypot(dx, dz),
            candidate.height ?? (level?.type === 'level' ? (level.height ?? 3) : 3),
            candidate.thickness ?? 0.2,
          ],
          rotation: [0, -Math.atan2(dz, dx), 0],
        }
        return openings.some((opening) => openingFootprintsOverlap(opening, wall))
      }
      const capability = nodeRegistry.get(candidate.type)?.capabilities?.floorPlaced
      if (
        !capability ||
        !floorPlacedCollides(capability, candidate) ||
        (capability.applies && !capability.applies(candidate))
      )
        return false
      return getFloorPlacedFootprints(capability, candidate, { nodes }).some((fp) => {
        const position = fp.position ?? ('position' in candidate ? candidate.position : undefined)
        if (position?.length !== 3) return false
        return openings.some((opening) =>
          openingFootprintsOverlap(opening, {
            position: [position[0], position[1], position[2]],
            dimensions: fp.dimensions,
            rotation: fp.rotation ?? [0, 0, 0],
          }),
        )
      })
    })
    .map((candidate) => candidate.id)
}
