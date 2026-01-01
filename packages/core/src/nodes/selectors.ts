import type { SceneGraph } from '../scenegraph/index'
import type { AnyNode, WallNode } from '../scenegraph/schema/index'

export const selectWallsFromLevel =
  (levelId: string) =>
  (state: { graph: SceneGraph }): WallNode[] => {
    // Type assertion: runtime levelId is always a valid node ID string
    const levelHandle = state.graph.getNodeById(levelId as AnyNode['id'])
    if (!levelHandle || levelHandle.type !== 'level') {
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

    const children = levelHandle.children().map((h) => h.data())
    traverse(children as AnyNode[])

    return walls
  }
