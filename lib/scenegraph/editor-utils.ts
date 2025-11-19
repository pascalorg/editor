import { current } from 'immer'
import type {
  AnyNode,
  BuildingNode,
  LevelNode,
  RootNode,
  Scene,
  SceneNode,
} from '@/lib/scenegraph/schema/index'

/**
 * Build a mutable index of nodes for use within Immer draft state
 * Maps ID -> Node reference (draft)
 */
export function buildDraftNodeIndex(scene: Scene): Map<string, AnyNode> {
  const index = new Map<string, AnyNode>()

  const isNode = (value: unknown): value is AnyNode =>
    typeof value === 'object' &&
    value !== null &&
    (value as any).object === 'node' &&
    'id' in value &&
    'type' in value

  const traverse = (node: SceneNode) => {
    index.set(node.id, node as AnyNode)

    // Traverse all properties looking for nodes or arrays of nodes
    for (const value of Object.values(node)) {
      if (isNode(value)) {
        traverse(value)
      } else if (Array.isArray(value)) {
        for (const item of value) {
          if (isNode(item)) {
            traverse(item)
          }
        }
      }
    }
  }

  traverse(scene.root)
  return index
}

/**
 * Get levels from root node
 */
export function getLevels(root: RootNode): LevelNode[] {
  const building = root.buildings?.[0] as BuildingNode | undefined
  // Ensure we return a valid array even if building or children are missing
  if (!building?.children) return []
  return building.children as LevelNode[]
}

/**
 * Helper to get level ID from a node using draft index
 * Traverses up the parent chain
 */
export function getLevelIdFromDraft(
  node: SceneNode,
  nodeIndex: Map<string, SceneNode>,
): string | null {
  if (node.type === 'level') {
    return node.id
  }

  let currentNode = node
  // @ts-expect-error
  while (currentNode.parent) {
    // @ts-expect-error
    const parent = nodeIndex.get(currentNode.parent)
    if (!parent) break

    if (parent.type === 'level') {
      return parent.id
    }
    currentNode = parent
  }

  return null
}
