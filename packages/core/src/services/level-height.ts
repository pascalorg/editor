import { sceneRegistry } from '../hooks/scene-registry/scene-registry'
import type { CeilingNode, LevelNode, WallNode } from '../schema'
import type { AnyNode, AnyNodeId } from '../schema/types'

export const DEFAULT_LEVEL_HEIGHT = 2.5

// Cache: levelId → computed height. Invalidated when the nodes reference changes.
// Zustand produces a new `nodes` object on every mutation, so reference equality
// is a zero-cost way to detect stale data without any subscription overhead.
const heightCache = new Map<string, number>()
let lastNodesRef: object | null = null

export function getLevelHeight(levelId: string, nodes: Record<AnyNodeId, AnyNode>): number {
  if (nodes !== lastNodesRef) {
    heightCache.clear()
    lastNodesRef = nodes
  }

  if (heightCache.has(levelId)) return heightCache.get(levelId)!

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
      let meshY = sceneRegistry.nodes.get(childId as AnyNodeId)?.position.y ?? 0
      if (meshY < 0) meshY = 0
      const top = meshY + ((child as WallNode).height ?? DEFAULT_LEVEL_HEIGHT)
      if (top > maxTop) maxTop = top
    }
  }

  const height = maxTop > 0 ? maxTop : DEFAULT_LEVEL_HEIGHT
  heightCache.set(levelId, height)
  return height
}
