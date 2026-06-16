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
