import {
  type AnyNode,
  emitter,
  getLevelBelow,
  getLevelElevations,
  isCurvedWall,
  type LevelNode,
  type RoofFootprintTarget,
  type RoofType,
  resolveLevelId,
  resolveRoofWallTopElevation,
  type WallEvent,
  type WallNode,
} from '@pascal-app/core'

export type RoofFootprintSource = 'room' | 'walls' | 'draw'

const ROOF_AXIS_ALIGNMENT_EPSILON = 1e-4

export function isStandardRoofWallEligible(wall: WallNode): boolean {
  if (isCurvedWall(wall)) return false
  const deltaX = Math.abs(wall.end[0] - wall.start[0])
  const deltaZ = Math.abs(wall.end[1] - wall.start[1])
  return deltaX <= ROOF_AXIS_ALIGNMENT_EPSILON || deltaZ <= ROOF_AXIS_ALIGNMENT_EPSILON
}

export function isConicalRoofWallEligible(
  targetLevelId: LevelNode['id'],
  wall: WallNode,
  nodes: Readonly<Record<string, AnyNode>>,
): boolean {
  const completeNodes = nodes as Record<string, AnyNode>
  const sourceLevelId = resolveLevelId(wall, completeNodes)
  if (!sourceLevelId) return false
  if (sourceLevelId === targetLevelId) return true
  return getLevelBelow(targetLevelId, completeNodes)?.id === sourceLevelId
}

export function parseRoofFootprintSource(value: unknown, roofType: RoofType): RoofFootprintSource {
  if (roofType === 'conical') return 'walls'
  return value === 'room' ? 'room' : 'draw'
}

export function subscribeToConicalRoofWallClicks(options: {
  footprintSource: RoofFootprintSource
  currentLevelId: LevelNode['id'] | null
  getNodes: () => Readonly<Record<string, AnyNode>>
  onPreview?: (wall: WallNode | null) => void
  onSelect: (wall: WallNode) => void
  roofType: RoofType
}): () => void {
  if (!(options.roofType === 'conical' && options.footprintSource === 'walls')) return () => {}

  let previewedWallId: WallNode['id'] | null = null
  const onWallHover = (event: WallEvent) => {
    const wall =
      isCurvedWall(event.node) &&
      options.currentLevelId &&
      isConicalRoofWallEligible(options.currentLevelId, event.node, options.getNodes())
        ? event.node
        : null
    const nextId = wall?.id ?? null
    if (nextId === previewedWallId) return
    previewedWallId = nextId
    options.onPreview?.(wall)
  }
  const onWallLeave = (event: WallEvent) => {
    if (event.node.id !== previewedWallId) return
    previewedWallId = null
    options.onPreview?.(null)
  }
  const onWallClick = (event: WallEvent) => {
    if (
      !isCurvedWall(event.node) ||
      !options.currentLevelId ||
      !isConicalRoofWallEligible(options.currentLevelId, event.node, options.getNodes())
    ) {
      return
    }
    event.stopPropagation()
    options.onSelect(event.node)
  }
  emitter.on('wall:enter', onWallHover)
  emitter.on('wall:move', onWallHover)
  emitter.on('wall:leave', onWallLeave)
  emitter.on('wall:click', onWallClick)
  return () => {
    emitter.off('wall:enter', onWallHover)
    emitter.off('wall:move', onWallHover)
    emitter.off('wall:leave', onWallLeave)
    emitter.off('wall:click', onWallClick)
  }
}

export function resolveRoofFootprintElevation(
  targetLevelId: LevelNode['id'],
  target: RoofFootprintTarget,
  nodes: Readonly<Record<string, AnyNode>>,
): number {
  const completeNodes = nodes as Record<string, AnyNode>
  const elevations = getLevelElevations(completeNodes)
  const tops = target.wallIds.flatMap((id) => {
    const wall = nodes[id]
    return wall?.type === 'wall'
      ? [resolveRoofWallTopElevation(targetLevelId, wall, completeNodes, elevations)]
      : []
  })
  return tops.length ? Math.max(...tops) : 0
}

export function resolveRoofFootprintWorldElevation(
  targetLevelId: LevelNode['id'],
  target: RoofFootprintTarget,
  nodes: Readonly<Record<string, AnyNode>>,
): number {
  const completeNodes = nodes as Record<string, AnyNode>
  const elevations = getLevelElevations(completeNodes)
  return (
    (elevations.get(targetLevelId)?.baseY ?? 0) +
    resolveRoofFootprintElevation(targetLevelId, target, nodes)
  )
}

/**
 * World/building-local Y for a wall-top preview rendered outside a level node.
 *
 * Roof nodes are parented to a level, so their stored position is relative to
 * that level's floor. The conical wall hover ghost is rendered directly in the
 * building group instead, and therefore needs the active level's world base
 * added back after resolving the level-relative placement.
 */
export function resolveRoofWallTopWorldElevation(
  targetLevelId: LevelNode['id'],
  wall: WallNode,
  nodes: Readonly<Record<string, AnyNode>>,
  elevations = getLevelElevations(nodes as Record<string, AnyNode>),
): number {
  return (
    (elevations.get(targetLevelId)?.baseY ?? 0) +
    resolveRoofWallTopElevation(targetLevelId, wall, nodes, elevations)
  )
}
