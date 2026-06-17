import { pointInPolygon } from '../hooks/spatial-grid/spatial-grid-manager'
import type { CeilingNode, LevelNode, WallNode } from '../schema'
import type { AnyNode, AnyNodeId } from '../schema/types'

export const DEFAULT_LEVEL_HEIGHT = 2.5

/**
 * Optional resolver for a wall's rendered base Y (mesh elevation).
 *
 * `packages/core` is pure domain logic and must not read viewer/Three.js
 * state (see AGENTS.md “Layer Boundaries”). Callers that legitimately have
 * registry access (viewer systems, node tools) may pass a resolver so the
 * mesh elevation is factored in; pure/headless callers (MCP, tests, server)
 * omit it and get a deterministic result from serialized node data alone.
 */
export type WallBaseYResolver = (wallId: AnyNodeId) => number | undefined

export function getLevelHeight(
  levelId: string,
  nodes: Record<AnyNodeId, AnyNode>,
  resolveWallBaseY?: WallBaseYResolver,
): number {
  const level = nodes[levelId as LevelNode['id']] as LevelNode | undefined
  if (!level) return DEFAULT_LEVEL_HEIGHT

  let maxTop = 0

  for (const childId of level.children) {
    const child = nodes[childId as keyof typeof nodes]
    if (!child) continue
    if (child.type === 'ceiling') {
      const ch = (child as CeilingNode).height ?? DEFAULT_LEVEL_HEIGHT
      if (ch > maxTop) maxTop = ch
    } else if (child.type === 'wall') {
      let baseY = resolveWallBaseY?.(childId as AnyNodeId) ?? 0
      if (baseY < 0) baseY = 0
      const top = baseY + ((child as WallNode).height ?? DEFAULT_LEVEL_HEIGHT)
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
