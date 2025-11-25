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
    for (const propValue of Object.values(node) as any[]) {
      if (isNode(propValue)) {
        traverse(propValue)
        continue
      }

      if (Array.isArray(propValue)) {
        for (const item of propValue as any[]) {
          if (isNode(item)) {
            traverse(item)
          }
        }
      }
    }
  }

  // Start traversal from sites (root is not a node anymore)
  scene.root.children.forEach((site) => {
    traverse(site)
  })

  return index
}

/**
 * Helper to get the main building from the root
 */
export function getMainBuilding(root: RootNode): BuildingNode | undefined {
  const site = root.children?.[0]
  if (!site) return
  return site.children.find((child) => child.type === 'building') as BuildingNode | undefined
}

/**
 * Get levels from root node
 */
export function getLevels(root: RootNode): LevelNode[] {
  const building = getMainBuilding(root)
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
  while (currentNode.parentId) {
    const parent = nodeIndex.get(currentNode.parentId)
    if (!parent) break

    if (parent.type === 'level') {
      return parent.id
    }
    currentNode = parent
  }

  return null
}
