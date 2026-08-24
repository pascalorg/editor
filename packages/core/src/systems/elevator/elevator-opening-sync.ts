import { resolveLevelId } from '../../hooks/spatial-grid/spatial-grid-sync'
import { nodeRegistry } from '../../registry/registry'
import type { Capabilities } from '../../registry/types'
import type {
  AnyNode,
  AnyNodeId,
  CeilingNode,
  ElevatorNode,
  SlabNode,
  SurfaceHoleMetadata,
} from '../../schema'
import { isAutoHoleSource } from '../../schema/nodes/surface-hole-metadata'
import { resolveElevatorServiceLevels } from './elevator-service'

type Point2D = [number, number]

const ELEVATOR_OPENING_PADDING = 0.08
const DEFAULT_ELEVATOR_SHAFT_WALL_THICKNESS = 0.09

function pointsEqual(a: Point2D, b: Point2D, tolerance = 1e-5) {
  const dx = a[0] - b[0]
  const dz = a[1] - b[1]
  return dx * dx + dz * dz <= tolerance * tolerance
}

function polygonsEqual(left: Point2D[][], right: Point2D[][]) {
  if (left.length !== right.length) return false
  return left.every((polygon, polygonIndex) => {
    const other = right[polygonIndex]
    if (!(other && polygon.length === other.length)) return false
    return polygon.every((point, pointIndex) => {
      const otherPoint = other[pointIndex]
      if (!otherPoint) return false
      return pointsEqual(point, otherPoint)
    })
  })
}

function metadataEqual(left: SurfaceHoleMetadata[], right: SurfaceHoleMetadata[]) {
  if (left.length !== right.length) return false
  return left.every(
    (entry, index) =>
      entry.source === right[index]?.source &&
      (entry.elevatorId ?? null) === (right[index]?.elevatorId ?? null) &&
      (entry.stairId ?? null) === (right[index]?.stairId ?? null) &&
      (entry.ownerId ?? null) === (right[index]?.ownerId ?? null),
  )
}

/**
 * Nodes that declare `capabilities.verticalOpening` and are visible.
 *
 * Read from the registry rather than matched on `type`, so a kind contributed
 * by a plugin gets its floors cut without this file naming it — the elevator's
 * own cutouts have worked this way since they were written, and the only reason
 * a plugin could not have them was that the lookup was hardcoded to one type.
 */
function collectOpeningOwners(nodes: Record<string, AnyNode>) {
  const owners: Array<{ node: AnyNode; config: NonNullable<Capabilities['verticalOpening']> }> = []
  for (const node of Object.values(nodes)) {
    if (node.visible === false) continue
    const config = nodeRegistry.get(node.type)?.capabilities?.verticalOpening
    if (config) owners.push({ node, config })
  }
  return owners
}

function normalizeExistingMetadata(
  holes: Point2D[][],
  metadata: SurfaceHoleMetadata[] | undefined,
): SurfaceHoleMetadata[] {
  return holes.map((_, index) => metadata?.[index] ?? { source: 'manual' })
}

function rotateXZ(x: number, z: number, angle: number): [number, number] {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return [x * cos + z * sin, -x * sin + z * cos]
}

function pointOnSegment(point: Point2D, a: Point2D, b: Point2D, tolerance = 1e-6) {
  const cross = (point[1] - a[1]) * (b[0] - a[0]) - (point[0] - a[0]) * (b[1] - a[1])
  if (Math.abs(cross) > tolerance) return false
  const dot = (point[0] - a[0]) * (b[0] - a[0]) + (point[1] - a[1]) * (b[1] - a[1])
  if (dot < -tolerance) return false
  const lenSq = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2
  return dot <= lenSq + tolerance
}

function pointInPolygon(point: Point2D, polygon: Point2D[]) {
  if (polygon.length < 3) return false
  let inside = false
  const [x, z] = point

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!
    const b = polygon[j]!
    if (pointOnSegment(point, a, b)) return true
    const intersects =
      a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]
    if (intersects) inside = !inside
  }

  return inside
}

function polygonContainsPolygon(outer: Point2D[], inner: Point2D[]) {
  return inner.every((point) => pointInPolygon(point, outer))
}

function isCoveredByExistingHole(existingHoles: Point2D[][], autoHole: Point2D[]) {
  return existingHoles.some((existingHole) => polygonContainsPolygon(existingHole, autoHole))
}

function getServedLevelRange(elevator: ElevatorNode, nodes: Record<string, AnyNode>) {
  const servedLevels = resolveElevatorServiceLevels(elevator, nodes)
  if (servedLevels.length < 2) return null

  const levelNumbers = servedLevels.map((level) => level.level)
  return {
    max: Math.max(...levelNumbers),
    min: Math.min(...levelNumbers),
    sortedServedLevels: servedLevels,
  }
}

function getLevelNumber(levelId: string | null, nodes: Record<string, AnyNode>) {
  if (!levelId) return undefined
  const node = nodes[levelId as AnyNodeId]
  return node?.type === 'level' ? node.level : undefined
}

function shouldApplyElevatorToSlab(
  elevator: ElevatorNode,
  slabLevelId: string,
  nodes: Record<string, AnyNode>,
) {
  const range = getServedLevelRange(elevator, nodes)
  if (!range) return false

  const slabLevel = getLevelNumber(slabLevelId, nodes)
  if (slabLevel !== undefined) {
    return slabLevel > range.min && slabLevel <= range.max
  }

  const servedIndex = range.sortedServedLevels.findIndex((level) => level.id === slabLevelId)
  return servedIndex > 0
}

function shouldApplyElevatorToCeiling(
  elevator: ElevatorNode,
  ceilingLevelId: string,
  nodes: Record<string, AnyNode>,
) {
  const range = getServedLevelRange(elevator, nodes)
  if (!range) return false

  const ceilingLevel = getLevelNumber(ceilingLevelId, nodes)
  if (ceilingLevel !== undefined) {
    return ceilingLevel >= range.min && ceilingLevel < range.max
  }

  const servedIndex = range.sortedServedLevels.findIndex((level) => level.id === ceilingLevelId)
  return servedIndex >= 0 && servedIndex < range.sortedServedLevels.length - 1
}

function getElevatorOpeningPolygon(elevator: ElevatorNode): Point2D[] {
  const wallThickness = Math.max(
    elevator.shaftWallThickness ?? DEFAULT_ELEVATOR_SHAFT_WALL_THICKNESS,
    0.04,
  )
  const shaftWidth = Math.max(elevator.shaftWidth ?? elevator.width, elevator.width, 0.8)
  const shaftDepth = Math.max(elevator.shaftDepth ?? elevator.depth, elevator.depth, 0.8)
  const halfWidth = shaftWidth / 2 + wallThickness + ELEVATOR_OPENING_PADDING
  const halfDepth = shaftDepth / 2 + wallThickness + ELEVATOR_OPENING_PADDING
  const corners: Point2D[] = [
    [-halfWidth, -halfDepth],
    [halfWidth, -halfDepth],
    [halfWidth, halfDepth],
    [-halfWidth, halfDepth],
  ]

  return corners.map(([x, z]) => {
    const [rotatedX, rotatedZ] = rotateXZ(x, z, elevator.rotation ?? 0)
    return [elevator.position[0] + rotatedX, elevator.position[2] + rotatedZ]
  })
}

export function syncAutoElevatorOpenings(nodes: Record<string, AnyNode>) {
  const elevators = Object.values(nodes).filter(
    (node): node is ElevatorNode => node.type === 'elevator' && node.visible !== false,
  )
  const openingOwners = collectOpeningOwners(nodes)
  const slabs = Object.values(nodes).filter((node): node is SlabNode => node.type === 'slab')
  const ceilings = Object.values(nodes).filter(
    (node): node is CeilingNode => node.type === 'ceiling',
  )
  const updates: Array<{ id: AnyNodeId; data: Partial<SlabNode | CeilingNode> }> = []

  /**
   * One pass for both surface kinds.
   *
   * Slabs and ceilings were two copies of this, which is how the stair-hole
   * preservation came to be written twice and why adding a third source meant
   * editing the same lines in two places. `appliesToSurface` is the only thing
   * that actually differed.
   */
  const syncSurface = (
    surface: SlabNode | CeilingNode,
    appliesToSurface: (elevator: ElevatorNode, levelId: string) => boolean,
  ) => {
    const levelId = resolveLevelId(surface, nodes)
    const existingHoles = surface.holes ?? []
    const existingMetadata = normalizeExistingMetadata(existingHoles, surface.holeMetadata)

    // The user's own cutouts, kept in front so their indices stay stable.
    const manualHoles = existingHoles
      .map((polygon, index) => ({ metadata: existingMetadata[index]!, polygon }))
      .filter((entry) => !isAutoHoleSource(entry.metadata.source))
    const manualPolygons = manualHoles.map((entry) => entry.polygon)

    // Stair openings are cut elsewhere; this sync only carries them through.
    const stairHoles = existingHoles
      .map((polygon, index) => ({ metadata: existingMetadata[index]!, polygon }))
      .filter((entry) => entry.metadata.source === 'stair')

    const elevatorHoles = elevators
      .filter((elevator) => appliesToSurface(elevator, levelId))
      .map((elevator) => ({
        polygon: getElevatorOpeningPolygon(elevator),
        metadata: { elevatorId: elevator.id, source: 'elevator' as const },
      }))

    const declaredHoles = openingOwners
      .filter(({ node, config }) => config.servesLevel(node, levelId, nodes))
      .map(({ node, config }) => ({
        polygon: config.polygon(node, nodes) as Point2D[],
        metadata: { ownerId: node.id, source: 'verticalOpening' as const },
      }))
      .filter((hole) => hole.polygon.length >= 3)

    const cutHoles = [...elevatorHoles, ...declaredHoles]
      .filter((hole) => polygonContainsPolygon(surface.polygon, hole.polygon))
      .filter((hole) => !isCoveredByExistingHole(manualPolygons, hole.polygon))

    const nextHoles = [
      ...manualPolygons,
      ...cutHoles.map((hole) => hole.polygon),
      ...stairHoles.map((hole) => hole.polygon),
    ]
    const nextMetadata = [
      ...manualHoles.map((hole) => ({ ...hole.metadata })),
      ...cutHoles.map((hole) => hole.metadata),
      ...stairHoles.map((hole) => ({ ...hole.metadata })),
    ]

    if (
      !polygonsEqual(existingHoles, nextHoles) ||
      !metadataEqual(existingMetadata, nextMetadata)
    ) {
      updates.push({ id: surface.id, data: { holes: nextHoles, holeMetadata: nextMetadata } })
    }
  }

  for (const slab of slabs) {
    syncSurface(slab, (elevator, levelId) => shouldApplyElevatorToSlab(elevator, levelId, nodes))
  }
  for (const ceiling of ceilings) {
    syncSurface(ceiling, (elevator, levelId) =>
      shouldApplyElevatorToCeiling(elevator, levelId, nodes),
    )
  }

  return updates
}
