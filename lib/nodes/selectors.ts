import type { AnyNode, SceneNode, WallNode } from '../scenegraph/schema/index'

export const selectWallsFromLevel =
  (levelId: string) =>
  (state: { nodeIndex: Map<string, SceneNode> }): WallNode[] => {
    const level = state.nodeIndex.get(levelId)
    if (!level || level.type !== 'level') {
      return []
    }

    const walls: WallNode[] = []

    // Helper to traverse children (handling groups)
    const traverse = (nodes: AnyNode[]) => {
      for (const node of nodes) {
        if (node.type === 'wall') {
          walls.push(node as WallNode)
        } else if (node.type === 'group' && 'children' in node && Array.isArray(node.children)) {
          traverse(node.children as AnyNode[])
        }
      }
    }

    if ('children' in level && Array.isArray(level.children)) {
      traverse(level.children as AnyNode[])
    }

    return walls
  }
