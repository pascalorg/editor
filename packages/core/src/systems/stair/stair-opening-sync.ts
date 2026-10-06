import { resolveBuildingForLevel, resolveLevelId } from '../../lib/node-ancestry'
import { area, difference, union } from '../../lib/polygon-boolean'
import { type Point2D, polygonContainsPolygon, polygonsOverlap } from '../../lib/polygon-relations'
import type {
  AnyNode,
  AnyNodeId,
  CeilingNode,
  SlabNode,
  StairNode,
  SurfaceHoleMetadata,
} from '../../schema'
import { StairDesignTargets } from '../../schema/nodes/stair-design-targets'
import { resolveCeilingHeight } from '../../services/level-height'
import { getLevelElevations } from '../../services/storey'
import { stairClearanceOpening } from './stair-clearance'
import { resolveStairTotalRise } from './stair-rise-query'

const buildingLevelsMemo = new WeakMap<object, Map<string, Extract<AnyNode, { type: 'level' }>[]>>()
const stairLevelsMemo = new WeakMap<
  object,
  WeakMap<StairNode, { fromLevelId: string | null; toLevelId: string | null }>
>()

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
      (entry.openingId ?? null) === (right[index]?.openingId ?? null),
  )
}

function normalizeExistingMetadata(
  holes: Point2D[][],
  metadata: SurfaceHoleMetadata[] | undefined,
): SurfaceHoleMetadata[] {
  return holes.map((_, index) => metadata?.[index] ?? { source: 'manual' })
}

function getLevelNumber(levelId: string | null, nodes: Record<string, AnyNode>) {
  if (!levelId) return
  const node = nodes[levelId as AnyNodeId]
  return node?.type === 'level' ? node.level : undefined
}

function getLevelBuildingId(levelId: string | null, nodes: Record<string, AnyNode>) {
  if (!levelId) return null
  return resolveBuildingForLevel(levelId as AnyNodeId, nodes as Record<AnyNodeId, AnyNode>)
}

function normalizeLevelId(levelId: string | null | undefined, nodes: Record<string, AnyNode>) {
  if (!levelId) return null
  return nodes[levelId as AnyNodeId]?.type === 'level' ? levelId : null
}

function getBuildingLevels(buildingId: string | null, nodes: Record<string, AnyNode>) {
  const building = buildingId ? nodes[buildingId as AnyNodeId] : null
  if (building?.type !== 'building') return []

  let cache = buildingLevelsMemo.get(nodes)
  if (!cache) {
    cache = new Map()
    buildingLevelsMemo.set(nodes, cache)
  }
  const cached = cache.get(building.id)
  if (cached) return cached

  const levels = new Map<string, Extract<AnyNode, { type: 'level' }>>()
  for (const childId of building.children ?? []) {
    const child = nodes[childId as AnyNodeId]
    if (child?.type === 'level') levels.set(child.id, child)
  }
  for (const candidate of Object.values(nodes)) {
    if (candidate?.type === 'level' && candidate.parentId === building.id) {
      levels.set(candidate.id, candidate)
    }
  }

  const sorted = Array.from(levels.values()).sort((left, right) => left.level - right.level)
  cache.set(building.id, sorted)
  return sorted
}

function inferSourceLevelForDestination(
  destinationLevelId: string | null,
  nodes: Record<string, AnyNode>,
) {
  if (!destinationLevelId) return null
  const destination = nodes[destinationLevelId as AnyNodeId]
  if (destination?.type !== 'level') return null

  const buildingId = getLevelBuildingId(destinationLevelId, nodes)
  return (
    getBuildingLevels(buildingId, nodes)
      .filter((level) => level.level < destination.level)
      .at(-1)?.id ?? null
  )
}

function inferDestinationLevelForSource(
  sourceLevelId: string | null,
  nodes: Record<string, AnyNode>,
) {
  if (!sourceLevelId) return null
  const source = nodes[sourceLevelId as AnyNodeId]
  if (source?.type !== 'level') return null

  const buildingId = getLevelBuildingId(sourceLevelId, nodes)
  return (
    getBuildingLevels(buildingId, nodes).find((level) => level.level > source.level)?.id ?? null
  )
}

function levelsShareBuilding(
  leftLevelId: string | null,
  rightLevelId: string | null,
  nodes: Record<string, AnyNode>,
) {
  if (!(leftLevelId && rightLevelId)) return true
  const leftBuildingId = getLevelBuildingId(leftLevelId, nodes)
  const rightBuildingId = getLevelBuildingId(rightLevelId, nodes)
  return !(leftBuildingId && rightBuildingId && leftBuildingId !== rightBuildingId)
}

function isInStairBuildingScope(
  stair: StairNode,
  surfaceLevelId: string,
  nodes: Record<string, AnyNode>,
) {
  const { fromLevelId, toLevelId } = getResolvedStairLevelIds(stair, nodes)
  const fromBuildingId = getLevelBuildingId(fromLevelId, nodes)
  const toBuildingId = getLevelBuildingId(toLevelId, nodes)
  const surfaceBuildingId = getLevelBuildingId(surfaceLevelId, nodes)

  if (fromBuildingId && toBuildingId && fromBuildingId !== toBuildingId) return false
  if (fromBuildingId && surfaceBuildingId && fromBuildingId !== surfaceBuildingId) return false
  if (toBuildingId && surfaceBuildingId && toBuildingId !== surfaceBuildingId) return false

  return true
}

function getResolvedStairLevelIds(stair: StairNode, nodes: Record<string, AnyNode>) {
  let cache = stairLevelsMemo.get(nodes)
  if (!cache) {
    cache = new WeakMap()
    stairLevelsMemo.set(nodes, cache)
  }
  const cached = cache.get(stair)
  if (cached) return cached
  const parentLevelId = normalizeLevelId(resolveLevelId(stair, nodes), nodes)
  const explicitToLevelId = normalizeLevelId(stair.toLevelId, nodes)
  const fromLevelId =
    normalizeLevelId(stair.fromLevelId, nodes) ??
    parentLevelId ??
    inferSourceLevelForDestination(explicitToLevelId, nodes)
  const explicitToLevelIsUsable =
    explicitToLevelId &&
    explicitToLevelId !== fromLevelId &&
    levelsShareBuilding(fromLevelId, explicitToLevelId, nodes)
  const toLevelId = explicitToLevelIsUsable
    ? explicitToLevelId
    : inferDestinationLevelForSource(fromLevelId, nodes)
  const resolved = { fromLevelId, toLevelId }
  cache.set(stair, resolved)
  return resolved
}

const defaultMinimumHeadroom = StairDesignTargets.parse({}).minimumHeadroom

function openingGeometry(node: AnyNode | undefined) {
  if (!node) return null
  const fields =
    node.type === 'stair'
      ? [
          'parentId',
          'visible',
          'position',
          'rotation',
          'supportSlabId',
          'stairType',
          'fromLevelId',
          'toLevelId',
          'deckSlabId',
          'slabOpeningMode',
          'openingOffset',
          'width',
          'totalRise',
          'designTargets',
          'stepCount',
          'thickness',
          'fillToFloor',
          'construction',
          'innerRadius',
          'sweepAngle',
          'topLandingMode',
          'topLandingDepth',
          'children',
        ]
      : [
          'parentId',
          'visible',
          'position',
          'rotation',
          'segmentType',
          'width',
          'length',
          'height',
          'stepCount',
          'attachmentSide',
          'fillToFloor',
          'construction',
          'winder',
          'thickness',
        ]
  return JSON.stringify(
    fields.map((field) =>
      field === 'designTargets' && node.type === 'stair'
        ? (node.designTargets?.minimumHeadroom ?? defaultMinimumHeadroom)
        : (node as unknown as Record<string, unknown>)[field],
    ),
  )
}

/** Existing cuts are user data: a surface edit alone must not upgrade their geometry. */
export function changedStairOpeningOwners(
  before: Record<string, AnyNode>,
  after: Record<string, AnyNode>,
): Set<string> {
  const owners = new Set<string>()
  const beforeElevations = getLevelElevations(before)
  const afterElevations = getLevelElevations(after)
  const span = (
    stair: StairNode,
    nodes: Record<string, AnyNode>,
    elevations: typeof beforeElevations,
  ) => {
    const { fromLevelId, toLevelId } = getResolvedStairLevelIds(stair, nodes)
    const from = elevations.get(fromLevelId ?? '')
    const to = elevations.get(toLevelId ?? '')
    return JSON.stringify([
      fromLevelId,
      toLevelId,
      from?.height,
      to?.height,
      from && to
        ? [...elevations]
            .filter(
              ([, level]) =>
                level.buildingId === from.buildingId &&
                level.ordinal >= Math.min(from.ordinal, to.ordinal) &&
                level.ordinal <= Math.max(from.ordinal, to.ordinal),
            )
            .map(([id, level]) => [id, level.height, level.baseY - from.baseY])
        : null,
    ])
  }
  for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const previous = before[id]
    const current = after[id]
    if (previous?.type !== 'stair' && current?.type !== 'stair') continue
    if (
      previous?.type !== 'stair' ||
      current?.type !== 'stair' ||
      openingGeometry(previous) !== openingGeometry(current) ||
      current.children.some(
        (childId) => openingGeometry(before[childId]) !== openingGeometry(after[childId]),
      ) ||
      span(previous, before, beforeElevations) !== span(current, after, afterElevations) ||
      resolveStairTotalRise(previous, before) !== resolveStairTotalRise(current, after)
    ) {
      owners.add(id)
    }
  }
  return owners
}

function isCoveredByExistingHole(existingHoles: Point2D[][], autoHole: Point2D[]) {
  if (existingHoles.some((existingHole) => polygonContainsPolygon(existingHole, autoHole)))
    return true
  return area(difference(autoHole, union(existingHoles))) <= 1e-6
}

function getStairOpeningPolygons(
  stair: StairNode,
  nodes: Record<string, AnyNode>,
  targetElevation: number,
  openingOffset: number,
  thickness: number,
) {
  if ((stair.slabOpeningMode ?? 'none') !== 'destination') return []
  const { fromLevelId } = getResolvedStairLevelIds(stair, nodes)
  const source = fromLevelId
    ? getLevelElevations(nodes as Record<AnyNodeId, AnyNode>).get(fromLevelId)
    : undefined
  const underside = (source?.baseY ?? 0) + stair.position[1] + targetElevation - thickness
  return stairClearanceOpening(stair, nodes, underside, openingOffset, underside + thickness)
}

type OpeningResolver = typeof getStairOpeningPolygons

function getApplicableStairOpeningPolygons(
  stair: StairNode,
  nodes: Record<string, AnyNode>,
  targetElevation: number,
  surfacePolygon: Point2D[],
  thickness = 0,
  resolveOpening: OpeningResolver = getStairOpeningPolygons,
) {
  const configuredOffset = Math.max(stair.openingOffset ?? 0, 0)
  const polygons = resolveOpening(stair, nodes, targetElevation, configuredOffset, thickness)
  if (polygons === null) return null
  const overlappingPolygons = polygons.filter((polygon) => polygonsOverlap(surfacePolygon, polygon))

  if (overlappingPolygons.length === polygons.length || configuredOffset <= 1e-6) {
    return overlappingPolygons
  }

  const fallbackPolygons = resolveOpening(stair, nodes, targetElevation, 0, thickness)
  if (fallbackPolygons === null) return null
  const overlappingFallbackPolygons = fallbackPolygons.filter((polygon) =>
    polygonsOverlap(surfacePolygon, polygon),
  )

  return overlappingFallbackPolygons.length === fallbackPolygons.length
    ? overlappingFallbackPolygons
    : overlappingPolygons
}

function getTargetSlabElevationForStair(
  stair: StairNode,
  slab: SlabNode,
  slabLevelId: string,
  nodes: Record<string, AnyNode>,
) {
  const { fromLevelId } = getResolvedStairLevelIds(stair, nodes)
  const elevations = getLevelElevations(nodes as Record<AnyNodeId, AnyNode>)
  const fromElevation = fromLevelId ? elevations.get(fromLevelId) : undefined
  const slabElevation = elevations.get(slabLevelId)

  if (!(fromElevation && slabElevation) || fromElevation.buildingId !== slabElevation.buildingId) {
    return slab.elevation ?? 0.05
  }

  return (
    slabElevation.baseY - fromElevation.baseY + (slab.elevation ?? 0.05) - (stair.position[1] ?? 0)
  )
}

function getTargetCeilingElevationForStair(
  stair: StairNode,
  ceiling: CeilingNode,
  ceilingLevelId: string,
  nodes: Record<string, AnyNode>,
) {
  const { fromLevelId } = getResolvedStairLevelIds(stair, nodes)
  const elevations = getLevelElevations(nodes as Record<AnyNodeId, AnyNode>)
  const fromElevation = fromLevelId ? elevations.get(fromLevelId) : undefined
  const ceilingElevation = elevations.get(ceilingLevelId)

  const ceilingHeight = resolveCeilingHeight(ceiling, nodes as Record<AnyNodeId, AnyNode>)

  if (
    !(fromElevation && ceilingElevation) ||
    fromElevation.buildingId !== ceilingElevation.buildingId
  ) {
    return ceilingHeight
  }

  return ceilingElevation.baseY - fromElevation.baseY + ceilingHeight - (stair.position[1] ?? 0)
}

function shouldApplyStairToSlab(
  stair: StairNode,
  slabLevelId: string,
  nodes: Record<string, AnyNode>,
) {
  const { fromLevelId, toLevelId } = getResolvedStairLevelIds(stair, nodes)
  const fromLevel = getLevelNumber(fromLevelId, nodes)
  const toLevel = getLevelNumber(toLevelId, nodes)
  const slabLevel = getLevelNumber(slabLevelId, nodes)

  if (!isInStairBuildingScope(stair, slabLevelId, nodes)) return false

  if (slabLevel === undefined) {
    return toLevelId === slabLevelId
  }

  if (fromLevel === undefined || toLevel === undefined) {
    return toLevelId === slabLevelId
  }

  const minLevel = Math.min(fromLevel, toLevel)
  const maxLevel = Math.max(fromLevel, toLevel)
  return slabLevel > minLevel && slabLevel <= maxLevel
}

function shouldApplyStairToCeiling(
  stair: StairNode,
  ceilingLevelId: string,
  nodes: Record<string, AnyNode>,
) {
  const { fromLevelId, toLevelId } = getResolvedStairLevelIds(stair, nodes)
  const fromLevel = getLevelNumber(fromLevelId, nodes)
  const toLevel = getLevelNumber(toLevelId, nodes)
  const ceilingLevel = getLevelNumber(ceilingLevelId, nodes)

  if (!isInStairBuildingScope(stair, ceilingLevelId, nodes)) return false

  if (ceilingLevel === undefined) {
    return fromLevelId === ceilingLevelId
  }

  if (fromLevel === undefined || toLevel === undefined) {
    return fromLevelId === ceilingLevelId
  }

  const minLevel = Math.min(fromLevel, toLevel)
  const maxLevel = Math.max(fromLevel, toLevel)
  return ceilingLevel >= minLevel && ceilingLevel < maxLevel
}

/** A load migration supplies its historical resolver; live edits use clearance geometry. */
export function syncAutoStairOpenings(
  nodes: Record<string, AnyNode>,
  resolveOpening: OpeningResolver = getStairOpeningPolygons,
) {
  const stairs = Object.values(nodes).filter(
    (node): node is StairNode => node.type === 'stair' && node.visible !== false,
  )
  const slabs = Object.values(nodes).filter((node): node is SlabNode => node.type === 'slab')
  const ceilings = Object.values(nodes).filter(
    (node): node is CeilingNode => node.type === 'ceiling',
  )
  const updates: Array<{ id: AnyNodeId; data: Partial<SlabNode | CeilingNode> }> = []
  const slabStairsByLevel = new Map<string, StairNode[]>()
  const ceilingStairsByLevel = new Map<string, StairNode[]>()
  const stairsFor = (levelId: string, ceiling: boolean) => {
    const cache = ceiling ? ceilingStairsByLevel : slabStairsByLevel
    let selected = cache.get(levelId)
    if (!selected) {
      selected = stairs.filter((stair) =>
        ceiling
          ? shouldApplyStairToCeiling(stair, levelId, nodes)
          : shouldApplyStairToSlab(stair, levelId, nodes),
      )
      cache.set(levelId, selected)
    }
    return selected
  }

  for (const slab of slabs) {
    const slabLevelId = resolveLevelId(slab, nodes)
    const existingHoles = slab.holes ?? []
    const existingMetadata = normalizeExistingMetadata(existingHoles, slab.holeMetadata)
    const preservedHoles = existingHoles
      .map((polygon, index) => ({ metadata: existingMetadata[index]!, polygon }))
      .filter((entry) => entry.metadata.source !== 'stair')
    const preservedHolePolygons = preservedHoles.map((entry) => entry.polygon)

    const unresolved = new Set<string>()
    const stairHoles = stairsFor(slabLevelId, false)
      .flatMap((stair) => {
        const polygons = getApplicableStairOpeningPolygons(
          stair,
          nodes,
          getTargetSlabElevationForStair(stair, slab, slabLevelId, nodes),
          slab.polygon,
          slab.thickness,
          resolveOpening,
        )
        if (polygons === null) {
          unresolved.add(stair.id)
          return existingHoles
            .map((polygon, index) => ({ polygon, metadata: existingMetadata[index]! }))
            .filter(
              (hole) => hole.metadata.source === 'stair' && hole.metadata.stairId === stair.id,
            )
        }
        return polygons.map((polygon) => ({
          polygon,
          metadata: { source: 'stair' as const, stairId: stair.id },
        }))
      })
      .filter(
        (hole) =>
          unresolved.has(hole.metadata.stairId ?? '') ||
          !isCoveredByExistingHole(preservedHolePolygons, hole.polygon),
      )

    const nextHoles = [
      ...preservedHoles.map((hole) => hole.polygon),
      ...stairHoles.map((hole) => hole.polygon),
    ]
    const nextMetadata = [
      ...preservedHoles.map((hole) => ({ ...hole.metadata })),
      ...stairHoles.map((hole) => hole.metadata),
    ]

    if (
      !(polygonsEqual(existingHoles, nextHoles) && metadataEqual(existingMetadata, nextMetadata))
    ) {
      updates.push({
        id: slab.id,
        data: {
          holes: nextHoles,
          holeMetadata: nextMetadata,
        },
      })
    }
  }

  for (const ceiling of ceilings) {
    const ceilingLevelId = resolveLevelId(ceiling, nodes)
    const existingHoles = ceiling.holes ?? []
    const existingMetadata = normalizeExistingMetadata(existingHoles, ceiling.holeMetadata)
    const preservedHoles = existingHoles
      .map((polygon, index) => ({ metadata: existingMetadata[index]!, polygon }))
      .filter((entry) => entry.metadata.source !== 'stair')
    const preservedHolePolygons = preservedHoles.map((entry) => entry.polygon)

    const unresolved = new Set<string>()
    const stairHoles = stairsFor(ceilingLevelId, true)
      .flatMap((stair) => {
        const polygons = getApplicableStairOpeningPolygons(
          stair,
          nodes,
          getTargetCeilingElevationForStair(stair, ceiling, ceilingLevelId, nodes),
          ceiling.polygon,
          0,
          resolveOpening,
        )
        if (polygons === null) {
          unresolved.add(stair.id)
          return existingHoles
            .map((polygon, index) => ({ polygon, metadata: existingMetadata[index]! }))
            .filter(
              (hole) => hole.metadata.source === 'stair' && hole.metadata.stairId === stair.id,
            )
        }
        return polygons.map((polygon) => ({
          polygon,
          metadata: { source: 'stair' as const, stairId: stair.id },
        }))
      })
      .filter(
        (hole) =>
          unresolved.has(hole.metadata.stairId ?? '') ||
          !isCoveredByExistingHole(preservedHolePolygons, hole.polygon),
      )

    const nextHoles = [
      ...preservedHoles.map((hole) => hole.polygon),
      ...stairHoles.map((hole) => hole.polygon),
    ]
    const nextMetadata = [
      ...preservedHoles.map((hole) => ({ ...hole.metadata })),
      ...stairHoles.map((hole) => hole.metadata),
    ]

    if (
      !(polygonsEqual(existingHoles, nextHoles) && metadataEqual(existingMetadata, nextMetadata))
    ) {
      updates.push({
        id: ceiling.id,
        data: {
          holes: nextHoles,
          holeMetadata: nextMetadata,
        },
      })
    }
  }

  return updates
}
