import type { AnyNode, AnyNodeId } from '../schema/types'
import { deriveLegacyLevelHeight } from '../services/level-height'
import { getCeilingClampBound } from '../services/storey'
import { computeWallSlabSupport } from '../systems/slab/slab-support'
import { DEFAULT_WALL_HEIGHT } from '../systems/wall/wall-footprint'

export type VerticalSceneMigration = {
  changed: boolean
  nodes: Record<string, unknown>
}

function getFiniteNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function getStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

// Walls whose top lands within this of the storey plane become plane-bound;
// ceilings whose stored height lands within this of their clamp bound become
// follows-mode. The strict comparison preserves intentional 0.20-short walls.
const PLANE_BOUND_EPSILON = 0.2

/**
 * Applies the vertical-model load migration to serialized scene nodes.
 *
 * This must remain pure, idempotent, and server-safe: the editor loader and
 * hosted scene authority both call it so they compare and persist the same
 * canonical fields during collaboration.
 */
export function migrateVerticalSceneNodes(
  sourceNodes: Record<string, unknown>,
): VerticalSceneMigration {
  const nodes: Record<string, any> = { ...sourceNodes }
  let changed = false
  const replaceNode = (id: string, node: Record<string, unknown>) => {
    nodes[id] = node
    changed = true
  }

  // A level without `height` marks a scene saved before the vertical model
  // landed. Compute the gate before mutating anything so stair and ceiling
  // intent on already-migrated scenes is never reclassified.
  const isLegacyScene = Object.values(nodes).some(
    (node) => node?.type === 'level' && !('height' in node),
  )

  // Ordinals are semantic and compact independently within each building.
  const buildingNodes = Object.values(nodes).filter((node) => node?.type === 'building')
  const levelsByBuilding = new Map<string | null, Array<{ id: string; ordinal: number }>>()
  for (const [id, node] of Object.entries(nodes)) {
    if (node?.type !== 'level') continue
    const buildingId =
      buildingNodes.find((building) => building.id === node.parentId)?.id ??
      buildingNodes.find((building) => getStringArray(building.children).includes(id))?.id ??
      null
    const bucket = levelsByBuilding.get(buildingId) ?? []
    bucket.push({ id, ordinal: getFiniteNumber(node.level, 0) })
    levelsByBuilding.set(buildingId, bucket)
  }
  for (const bucket of levelsByBuilding.values()) {
    const sorted = [...bucket].sort((a, b) => a.ordinal - b.ordinal)
    const negativeCount = sorted.filter((entry) => entry.ordinal < 0).length
    sorted.forEach((entry, index) => {
      const nextOrdinal = index - negativeCount
      const current = nodes[entry.id]
      if (current.level !== nextOrdinal) {
        replaceNode(entry.id, { ...current, level: nextOrdinal })
      }
    })
  }

  // Materialize exact legacy storey planes before classifying wall tops.
  const legacyLevelIds = Object.entries(nodes)
    .filter(([, node]) => node?.type === 'level' && !('height' in node))
    .map(([id]) => id)
  const derivedHeights = new Map<string, number>()
  for (const levelId of legacyLevelIds) {
    derivedHeights.set(
      levelId,
      deriveLegacyLevelHeight(levelId, nodes as Record<AnyNodeId, AnyNode>),
    )
  }

  for (const levelId of legacyLevelIds) {
    const plane = derivedHeights.get(levelId)!
    const level = nodes[levelId]
    replaceNode(levelId, { ...level, height: plane })

    const children = getStringArray(level.children)
      .map((childId) => nodes[childId])
      .filter((child) => child !== undefined)
    const slabs = children.filter((child) => child.type === 'slab')
    const walls = children.filter((child) => child.type === 'wall')
    for (const wall of walls) {
      const electedBase = computeWallSlabSupport(
        {
          start: wall.start,
          end: wall.end,
          curveOffset: wall.curveOffset,
          thickness: wall.thickness,
        },
        slabs,
        walls,
      ).elevation
      const effectiveHeight = wall.height ?? DEFAULT_WALL_HEIGHT
      const top = Math.max(0, electedBase) + effectiveHeight
      if (Math.abs(plane - top) < PLANE_BOUND_EPSILON) {
        if ('height' in wall) {
          const { height: _height, ...planeBound } = wall
          replaceNode(wall.id, planeBound)
        }
      } else if (wall.height !== effectiveHeight) {
        replaceNode(wall.id, { ...wall, height: effectiveHeight })
      }
    }
  }

  if (isLegacyScene) {
    for (const [id, node] of Object.entries(nodes)) {
      if (node?.type !== 'stair' || node.totalRise !== 2.5) continue
      const { totalRise: _totalRise, ...derivedRise } = node
      replaceNode(id, derivedRise)
    }
  }

  // Preserve the exact occupied interval of legacy slabs.
  for (const [id, node] of Object.entries(nodes)) {
    if (node?.type !== 'slab' || 'thickness' in node) continue
    const elevation = getFiniteNumber(node.elevation, 0.05)
    replaceNode(
      id,
      elevation < 0
        ? { ...node, thickness: 0.05, recessed: true }
        : { ...node, thickness: elevation },
    )
  }

  if (isLegacyScene) {
    for (const [id, node] of Object.entries(nodes)) {
      if (node?.type !== 'ceiling' || !('height' in node)) continue
      const dropHeight = () => {
        const { height: _height, ...follows } = node
        replaceNode(id, follows)
      }
      if (node.autoFromWalls === true) {
        dropHeight()
        continue
      }
      if (typeof node.parentId !== 'string') continue
      const bound = getCeilingClampBound(
        node.parentId,
        nodes as Record<AnyNodeId, AnyNode>,
        Array.isArray(node.polygon) ? node.polygon : [],
      )
      const stored = getFiniteNumber(node.height, Number.NaN)
      if (Number.isFinite(bound) && Math.abs(stored - bound) < PLANE_BOUND_EPSILON) {
        dropHeight()
      }
    }
  }

  return changed ? { changed, nodes } : { changed, nodes: sourceNodes }
}
