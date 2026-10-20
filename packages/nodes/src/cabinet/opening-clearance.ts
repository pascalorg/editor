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
import { type Frame, nodeLevelFrame, transformPoint } from '@pascal-app/core/procedural-items'
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

/** Something a cabinet's openings can run into, with the ids of it and its ancestors. */
export type ClearanceObstacle = {
  id: string
  chain: ReadonlySet<string>
  footprints: OpeningFootprint[]
}

/**
 * What openings on a level can run into: its visible straight walls and colliding floor-placed
 * objects. One pass over the scene, shared by every module a check reads.
 */
export function cabinetOpeningObstacles(
  levelId: string,
  nodes: Readonly<Record<string, AnyNode>>,
): ClearanceObstacle[] {
  const scene = nodes as Record<AnyNodeId, AnyNode>
  const cache = new Map<string, Frame>()
  const obstacles: ClearanceObstacle[] = []
  for (const candidate of Object.values(scene)) {
    const straightWall = candidate.type === 'wall' && !candidate.curveOffset
    const capability = straightWall
      ? undefined
      : nodeRegistry.get(candidate.type)?.capabilities?.floorPlaced
    if (
      !straightWall &&
      !(
        capability &&
        floorPlacedCollides(capability, candidate) &&
        (!capability.applies || capability.applies(candidate))
      )
    )
      continue
    const chain = new Set<string>()
    let current: AnyNode | undefined = candidate
    let hidden = false
    while (current && !chain.has(current.id)) {
      if (current.visible === false) {
        hidden = true
        break
      }
      chain.add(current.id)
      current = current.parentId ? scene[current.parentId as AnyNodeId] : undefined
    }
    if (hidden || resolveLevelId(candidate, scene) !== levelId) continue
    if (candidate.type === 'wall') {
      const body = getWallBodyLine({ ...candidate, thickness: candidate.thickness ?? 0.2 })
      const dx = body.end.x - body.start.x,
        dz = body.end.y - body.start.y
      const level = scene[levelId as AnyNodeId]
      obstacles.push({
        id: candidate.id,
        chain,
        footprints: [
          {
            position: [
              (body.start.x + body.end.x) / 2,
              nodeLevelFrame(candidate.id, scene, new Set(), { cache }).position[1],
              (body.start.y + body.end.y) / 2,
            ],
            dimensions: [
              Math.hypot(dx, dz),
              candidate.height ?? (level?.type === 'level' ? (level.height ?? 3) : 3),
              candidate.thickness ?? 0.2,
            ],
            rotation: [0, -Math.atan2(dz, dx), 0],
          },
        ],
      })
      continue
    }
    const pose = nodeLevelFrame(candidate.id, scene, new Set(), { cache })
    const yaw = Math.atan2(pose.axes[2][0], pose.axes[2][2])
    // Composite footprints include the node's pose. Resolve them at its origin before
    // composing the hosting frame, so neither translation nor yaw is applied twice.
    const local = {
      ...candidate,
      position: [0, 0, 0],
      rotation: typeof ('rotation' in candidate && candidate.rotation) === 'number' ? 0 : [0, 0, 0],
    } as AnyNode
    obstacles.push({
      id: candidate.id,
      chain,
      footprints: getFloorPlacedFootprints(capability!, local, { nodes: scene }).map((fp) => ({
        position: transformPoint(pose, fp.position ?? [0, 0, 0]),
        dimensions: fp.dimensions,
        rotation: [0, yaw + (fp.rotation?.[1] ?? 0), 0] as [number, number, number],
      })),
    })
  }
  return obstacles
}

export function cabinetOpeningConflicts(
  node: CabinetModuleNode,
  position: [number, number, number],
  yaw: number,
  levelId: string,
  nodes: Readonly<Record<string, AnyNode>>,
  ignoreIds: readonly string[] = [],
  obstacles: () => readonly ClearanceObstacle[] = () => cabinetOpeningObstacles(levelId, nodes),
) {
  const openings = cabinetOpeningFootprints(node, position, yaw)
  if (!openings.length) return []
  const ignored = [...ignoreIds, node.id]
  return obstacles()
    .filter(
      (obstacle) =>
        !ignored.some((id) => obstacle.chain.has(id)) &&
        obstacle.footprints.some((footprint) =>
          openings.some((opening) => openingFootprintsOverlap(opening, footprint)),
        ),
    )
    .map((obstacle) => obstacle.id)
}
