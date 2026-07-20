import type { CeilingNode, LevelNode, SlabNode, WallNode } from '../schema'
import type { AnyNode, AnyNodeId } from '../schema/types'
import { computeWallSlabSupport, pointInPolygon } from '../systems/slab/slab-support'
import { resolveWallTop } from '../systems/wall/wall-top'

export const DEFAULT_LEVEL_HEIGHT = 2.5

export function deriveLegacyLevelHeight(
  levelId: string,
  nodes: Record<AnyNodeId, AnyNode>,
): number {
  const level = nodes[levelId as LevelNode['id']] as LevelNode | undefined
  if (!level) return DEFAULT_LEVEL_HEIGHT

  const levelChildren = level.children
    .map((childId) => nodes[childId as keyof typeof nodes])
    .filter((child): child is AnyNode => child !== undefined)
  const slabs = levelChildren.filter((child): child is SlabNode => child.type === 'slab')
  const walls = levelChildren.filter((child): child is WallNode => child.type === 'wall')

  let maxTop = 0

  for (const child of levelChildren) {
    if (child.type === 'ceiling') {
      const height = (child as CeilingNode).height ?? DEFAULT_LEVEL_HEIGHT
      if (height > maxTop) maxTop = height
    } else if (child.type === 'wall') {
      const wall = child as WallNode
      const electedElevation = computeWallSlabSupport(
        {
          start: wall.start,
          end: wall.end,
          curveOffset: wall.curveOffset,
          thickness: wall.thickness,
        },
        slabs,
        walls,
      ).elevation
      const top = resolveWallTop(wall, level.height ?? DEFAULT_LEVEL_HEIGHT, electedElevation)
      if (top > maxTop) maxTop = top
    }
  }

  return maxTop > 0 ? maxTop : DEFAULT_LEVEL_HEIGHT
}

/**
 * The ceiling covering level-local point `[x, z]`, or `null` when none
 * sits over it. Points inside a ceiling's hole are treated as uncovered.
 * When ceilings overlap, the lowest one wins — that's the surface a duct
 * would actually hang from.
 */
export function getCeilingAt(
  levelId: string,
  nodes: Record<AnyNodeId, AnyNode>,
  x: number,
  z: number,
): CeilingNode | null {
  const level = nodes[levelId as LevelNode['id']] as LevelNode | undefined
  if (!level) return null

  let best: CeilingNode | null = null
  for (const childId of level.children) {
    const child = nodes[childId as keyof typeof nodes]
    if (child?.type !== 'ceiling') continue
    const ceiling = child as CeilingNode
    if (ceiling.polygon.length < 3 || !pointInPolygon(x, z, ceiling.polygon)) continue
    if (ceiling.holes.some((hole) => hole.length >= 3 && pointInPolygon(x, z, hole))) continue
    const h = ceiling.height ?? DEFAULT_LEVEL_HEIGHT
    if (best === null || h < (best.height ?? DEFAULT_LEVEL_HEIGHT)) best = ceiling
  }
  return best
}

/**
 * Underside elevation (meters above the level floor) of the ceiling
 * covering level-local point `[x, z]`, or `null` when no ceiling sits
 * over that point. See {@link getCeilingAt}.
 */
export function getCeilingHeightAt(
  levelId: string,
  nodes: Record<AnyNodeId, AnyNode>,
  x: number,
  z: number,
): number | null {
  const ceiling = getCeilingAt(levelId, nodes, x, z)
  return ceiling ? (ceiling.height ?? DEFAULT_LEVEL_HEIGHT) : null
}
