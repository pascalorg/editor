import { z } from 'zod'
import { BuildingNode } from './nodes/building'
import { CeilingNode } from './nodes/ceiling'
import { ColumnNode } from './nodes/column'
import { DoorNode } from './nodes/door'
import { EnvironmentNode } from './nodes/environment'
import { FloorNode } from './nodes/floor'
import { GroupNode } from './nodes/group'
import { ItemNode } from './nodes/item'
import { LevelNode } from './nodes/level'
import { RoofNode } from './nodes/roof'
import { RootNode } from './nodes/root'
import { SiteNode } from './nodes/site'
import { WallNode } from './nodes/wall'
import { WindowNode } from './nodes/window'

export const SceneSchema = z.object({
  root: RootNode.default(RootNode.parse({})),
  metadata: z.json().default({}),
})

export type Scene = z.infer<typeof SceneSchema>

export function initScene(): Scene {
  return SceneSchema.parse({
    root: RootNode.parse({}),
  })
}

export function loadScene(scene: unknown) {
  const result = SceneSchema.safeParse(scene)
  if (!result.success) {
    throw new Error(`Failed to load scene: ${result.error.message}`)
  }
  return result.data as Scene
}

export const AnyNode = z.discriminatedUnion('type', [
  EnvironmentNode,
  SiteNode,
  BuildingNode,
  LevelNode,
  WallNode,
  DoorNode,
  WindowNode,
  FloorNode,
  CeilingNode,
  RoofNode,
  ColumnNode,
  GroupNode,
  ItemNode,
])
export type AnyNode = z.infer<typeof AnyNode>
export type AnyNodeType = AnyNode['type']
export type AnyNodeId = AnyNode['id']

// Type mapping for extracting specific node types
export type NodeTypeMap = {
  environment: z.infer<typeof EnvironmentNode>
  site: z.infer<typeof SiteNode>
  building: z.infer<typeof BuildingNode>
  level: z.infer<typeof LevelNode>
  wall: z.infer<typeof WallNode>
  door: z.infer<typeof DoorNode>
  window: z.infer<typeof WindowNode>
  floor: z.infer<typeof FloorNode>
  ceiling: z.infer<typeof CeilingNode>
  roof: z.infer<typeof RoofNode>
  column: z.infer<typeof ColumnNode>
  group: z.infer<typeof GroupNode>
  item: z.infer<typeof ItemNode>
}

export const loadNode = (node: unknown): AnyNode => {
  const result = AnyNode.safeParse(node)
  if (!result.success) {
    throw new Error(`Failed to load node: ${result.error.message}`)
  }
  return result.data as AnyNode
}
export type byIdNodeIndex = {
  id: AnyNodeId
  type: AnyNodeType
  path: (string | number)[]
  parent: AnyNodeId | null
  children: AnyNodeId[]
}
export type SceneIndex = {
  byId: Map<AnyNodeId, byIdNodeIndex>
  byType: Map<AnyNodeType, Set<AnyNodeId>>
}
/**
 * Check if a value looks like a node (has type and id properties)
 */
function isNodeLike(value: unknown): value is AnyNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    'id' in value &&
    typeof value.type === 'string' &&
    typeof value.id === 'string'
  )
}

export const buildSceneIndex = (scene: Scene): SceneIndex => {
  const byId: SceneIndex['byId'] = new Map()
  const byType: SceneIndex['byType'] = new Map()

  function visitNode(node: AnyNode, parentId: AnyNodeId | null, path: (string | number)[]) {
    // Collect children by traversing all properties
    const childIds: AnyNodeId[] = []

    // Traverse all properties looking for nodes or arrays of nodes
    for (const [key, value] of Object.entries(node)) {
      // Skip metadata properties
      if (key === 'id' || key === 'type') continue

      // Check if value is a node
      if (isNodeLike(value)) {
        childIds.push(value.id)
        visitNode(value, node.id, [...path, key])
      }
      // Check if value is an array of nodes
      else if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          const item = value[i]
          if (isNodeLike(item)) {
            childIds.push(item.id)
            visitNode(item, node.id, [...path, key, i])
          }
        }
      }
    }

    // Index by id
    byId.set(node.id, {
      id: node.id,
      type: node.type,
      path,
      parent: parentId,
      children: childIds,
    })

    // Index by type
    if (!byType.has(node.type)) {
      byType.set(node.type, new Set())
    }
    byType.get(node.type)?.add(node.id)
  }

  // Start traversal from root
  const root = scene.root
  const rootChildIds: AnyNodeId[] = []

  for (const [key, value] of Object.entries(root)) {
    if (key === 'id' || key === 'type') continue

    if (isNodeLike(value)) {
      rootChildIds.push(value.id)
      visitNode(value, null, ['root', key])
    } else if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const item = value[i]
        if (isNodeLike(item)) {
          rootChildIds.push(item.id)
          visitNode(item, null, ['root', key, i])
        }
      }
    }
  }

  return { byId, byType }
}

/**
 * Get a node from the scene by following a path
 * @param scene The scene to traverse
 * @param path Array of keys/indices to follow (e.g., ['root', 'buildings', 0, 'levels', 1])
 * @param nodeType Optional runtime type to validate the result
 * @returns The node at the path, or null if not found or type doesn't match
 *
 * @example
 * // Using generic type parameter
 * const wall = getNodeByPath<"wall">(scene, ['root', 'buildings', 0, 'levels', 0])
 *
 * @example
 * // Using runtime type parameter for validation
 * const wall = getNodeByPath(scene, ['root', 'buildings', 0, 'levels', 0], 'wall')
 *
 * @example
 * // Without type parameter - returns AnyNode
 * const node = getNodeByPath(scene, ['root', 'buildings', 0])
 */
export function getNodeByPath<T extends keyof NodeTypeMap>(
  scene: Scene,
  path: (string | number)[],
  nodeType?: T,
): NodeTypeMap[T] | null
export function getNodeByPath(
  scene: Scene,
  path: (string | number)[],
  nodeType?: AnyNodeType,
): AnyNode | null
export function getNodeByPath<T extends keyof NodeTypeMap>(
  scene: Scene,
  path: (string | number)[],
  nodeType?: T,
): NodeTypeMap[T] | AnyNode | null {
  let current: unknown = scene

  for (const segment of path) {
    if (typeof current !== 'object' || current === null) {
      return null
    }

    if (typeof segment === 'number') {
      if (!Array.isArray(current)) return null
      current = current[segment]
    } else {
      current = (current as Record<string, unknown>)[segment]
    }
  }

  const node = isNodeLike(current) ? current : null

  // If a specific type was requested, validate it
  if (nodeType !== undefined && node !== null) {
    return node.type === nodeType ? node : null
  }

  return node
}

/**
 * Update a node in the scene by path (immutably)
 * @param scene The scene to update
 * @param path Path to the node to update
 * @param updater Function that takes the current node and returns the updated node
 * @returns New scene with the node updated
 */
export function updateNodeByPath(
  scene: Scene,
  path: (string | number)[],
  updater: (node: AnyNode) => AnyNode,
): Scene {
  if (path.length === 0) {
    throw new Error('Path cannot be empty')
  }

  const updateRecursive = (obj: unknown, pathSegments: (string | number)[]): unknown => {
    if (pathSegments.length === 0) {
      if (isNodeLike(obj)) {
        return updater(obj)
      }
      return obj
    }

    if (typeof obj !== 'object' || obj === null) {
      return obj
    }

    const [head, ...tail] = pathSegments

    if (typeof head === 'number') {
      if (!Array.isArray(obj)) return obj
      const newArray = [...obj]
      newArray[head] = updateRecursive(obj[head], tail)
      return newArray
    }

    const record = obj as Record<string, unknown>
    return {
      ...record,
      [head]: updateRecursive(record[head], tail),
    }
  }

  return updateRecursive(scene, path) as Scene
}
