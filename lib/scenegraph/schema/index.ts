import { z } from 'zod'
import type { EnvironmentNode } from './environment'
import { BuildingNode } from './nodes/building'
import { CeilingNode } from './nodes/ceiling'
import { ColumnNode } from './nodes/column'
import { DoorNode } from './nodes/door'
import { FloorNode } from './nodes/floor'
import { GroupNode } from './nodes/group'
import { ImageNode } from './nodes/image'
import { ItemNode } from './nodes/item'
import { LevelNode } from './nodes/level'
import { RoofNode } from './nodes/roof'
import { ScanNode } from './nodes/scan'
import type { SiteNode } from './nodes/site'
import { SlabNode } from './nodes/slab'
import { WallNode } from './nodes/wall'
import { WindowNode } from './nodes/window'
import { RootNode } from './root'

export * from '../common-types'
export * from './base'
export * from './environment'
// Export all specific node types
export * from './nodes/building'
export * from './nodes/ceiling'
export * from './nodes/column'
export * from './nodes/door'
export * from './nodes/floor'
export * from './nodes/group'
export * from './nodes/image'
export * from './nodes/item'
export * from './nodes/level'
export * from './nodes/roof'
export * from './nodes/scan'
export * from './nodes/site'
export * from './nodes/slab'
export * from './nodes/wall'
export * from './nodes/window'
export * from './root'

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

// Nodes that should not be included in the AnyNode are: RootNode, EnvironmentNode, SiteNode
export const AnyNode = z.discriminatedUnion('type', [
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
  ImageNode,
  ScanNode,
  SlabNode,
])
export type AnyNode = z.infer<typeof AnyNode>
export type AnyNodeType = AnyNode['type']
export type AnyNodeId = AnyNode['id']

export type SceneNode = AnyNode | RootNode | EnvironmentNode | SiteNode
export type SceneNodeId = SceneNode['id']
export type SceneNodeType = SceneNode['type']

// Type mapping for extracting specific node types
export type NodeTypeMap = {
  root: RootNode
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
  'reference-image': z.infer<typeof ImageNode>
  scan: z.infer<typeof ScanNode>
  slab: z.infer<typeof SlabNode>
}

export const loadNode = (node: unknown): AnyNode => {
  const result = AnyNode.safeParse(node)
  if (!result.success) {
    throw new Error(`Failed to load node: ${result.error.message}`)
  }
  return result.data as AnyNode
}
export type byIdNodeIndex = {
  id: SceneNodeId
  type: SceneNodeType
  path: (string | number)[]
  parent: SceneNodeId | null
  children: SceneNodeId[]
  levelId: SceneNodeId | null
  isPreview: boolean
}
export type SceneGraphIndex = {
  byId: Map<SceneNodeId, byIdNodeIndex>
  byType: Map<SceneNodeType, Set<SceneNodeId>>
  byLevel: Map<SceneNodeId, Set<SceneNodeId>>
  previewIds: Set<SceneNodeId>
}
/**
 * Check if a value looks like a node (has type and id properties)
 */
function isNodeLike(value: unknown): value is SceneNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as any).object === 'node' &&
    'type' in value &&
    'id' in value
  )
}

export const buildSceneGraphIndex = (scene: Scene): SceneGraphIndex => {
  const byId: SceneGraphIndex['byId'] = new Map()
  const byType: SceneGraphIndex['byType'] = new Map()
  const byLevel: SceneGraphIndex['byLevel'] = new Map()
  const previewIds: SceneGraphIndex['previewIds'] = new Set()

  function ensureSet<K>(map: Map<K, Set<SceneNodeId>>, key: K) {
    if (!map.has(key)) {
      map.set(key, new Set())
    }
    return map.get(key)!
  }

  function visitNode(
    node: SceneNode,
    parentId: SceneNodeId | null,
    path: (string | number)[],
    currentLevelId: SceneNodeId | null,
  ) {
    // Collect children
    const childIds: SceneNodeId[] = []
    const levelId = node.type === 'level' ? node.id : currentLevelId
    const isPreview = Boolean((node as { editor?: { preview?: boolean } }).editor?.preview)

    if (node.type === 'root') {
      const root = node as RootNode

      // Visit environment
      childIds.push(root.environment.id)
      visitNode(root.environment, node.id, [...path, 'environment'], levelId)

      // Visit site
      childIds.push(root.site.id)
      visitNode(root.site, node.id, [...path, 'site'], levelId)

      // Visit buildings
      root.buildings.forEach((building, index) => {
        childIds.push(building.id)
        visitNode(building, node.id, [...path, 'buildings', index], levelId)
      })
    } else if (node.type !== 'environment' && 'children' in node && Array.isArray(node.children)) {
      // AnyNode or SiteNode - verify children array
      const children = node.children as SceneNode[]
      children.forEach((child, index) => {
        childIds.push(child.id)
        visitNode(child, node.id, [...path, 'children', index], levelId)
      })
    }

    // Index by id
    const meta: byIdNodeIndex = {
      id: node.id,
      type: node.type,
      path,
      parent: parentId,
      children: childIds,
      levelId,
      isPreview,
    }
    byId.set(node.id, meta)
    if (levelId) {
      ensureSet(byLevel, levelId).add(node.id)
    }
    if (isPreview) {
      previewIds.add(node.id)
    }

    // Index by type
    const type = node.type
    if (!byType.has(type)) {
      byType.set(type, new Set())
    }
    byType.get(type)?.add(node.id)
  }

  // Start traversal from root
  const root = scene.root

  // Index root itself
  visitNode(root, null, ['root'], null)

  return { byId, byType, byLevel, previewIds }
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
  nodeType?: SceneNodeType,
): SceneNode | null
export function getNodeByPath<T extends keyof NodeTypeMap>(
  scene: Scene,
  path: (string | number)[],
  nodeType?: T,
): NodeTypeMap[T] | SceneNode | null {
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
  updater: (node: SceneNode) => SceneNode,
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

// ============================================================================
// Scene Graph Helper Utilities
// ============================================================================

export const getNodeMeta = (index: SceneGraphIndex, nodeId: SceneNodeId): byIdNodeIndex | null =>
  index.byId.get(nodeId) ?? null

export const getParentId = (index: SceneGraphIndex, nodeId: SceneNodeId): SceneNodeId | null =>
  index.byId.get(nodeId)?.parent ?? null

export const getAncestorChain = (index: SceneGraphIndex, nodeId: SceneNodeId): byIdNodeIndex[] => {
  const chain: byIdNodeIndex[] = []
  let current = index.byId.get(nodeId)

  while (current?.parent) {
    const parentMeta = index.byId.get(current.parent)
    if (!parentMeta) {
      break
    }
    chain.push(parentMeta)
    current = parentMeta
  }

  return chain
}

export const getLevelIdForNode = (
  index: SceneGraphIndex,
  nodeId: SceneNodeId,
): SceneNodeId | null => index.byId.get(nodeId)?.levelId ?? null

export const listNodeIdsByLevel = (
  index: SceneGraphIndex,
  levelId: SceneNodeId,
  types?: SceneNodeType[],
): SceneNodeId[] => {
  const ids = index.byLevel.get(levelId)
  if (!ids) {
    return []
  }

  if (!types || types.length === 0) {
    return Array.from(ids)
  }

  const typeSet = new Set(types)
  return Array.from(ids).filter((nodeId) => {
    const meta = index.byId.get(nodeId)
    return meta ? typeSet.has(meta.type) : false
  })
}

export const listChildrenIds = (index: SceneGraphIndex, parentId: SceneNodeId): SceneNodeId[] =>
  index.byId.get(parentId)?.children ?? []

export const listChildrenIdsOfType = (
  index: SceneGraphIndex,
  parentId: SceneNodeId,
  types?: SceneNodeType[],
): SceneNodeId[] => {
  const children = listChildrenIds(index, parentId)
  if (!types || types.length === 0) {
    return children
  }
  const typeSet = new Set(types)
  return children.filter((childId) => {
    const meta = index.byId.get(childId)
    return meta ? typeSet.has(meta.type) : false
  })
}

export const listPreviewNodeIds = (index: SceneGraphIndex): SceneNodeId[] =>
  Array.from(index.previewIds)

export const isPreviewNode = (index: SceneGraphIndex, nodeId: SceneNodeId): boolean =>
  index.previewIds.has(nodeId)
