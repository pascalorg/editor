import { produce } from 'immer'
import {
  type AnyNode,
  type AnyNodeId,
  type AnyNodeType,
  NodeSchemas,
  type SceneNode,
  type SceneNodeId,
  type SceneNodeType,
} from '@/lib/scenegraph/schema/types'
import { initScene, type NodeCreateTypeMap, type Scene } from './schema'

// Re-export from schema that are used elsewhere
export type {
  AnyNode,
  AnyNodeId,
  AnyNodeType,
  SceneNode,
  SceneNodeId,
  SceneNodeType,
} from '@/lib/scenegraph/schema/types'
// ============================================================================
// Scene Graph Index Types
// ============================================================================

export type byIdNodeIndex = {
  id: SceneNodeId
  type: SceneNodeType
  path: (string | number)[]
  parent: SceneNodeId | null
  children: SceneNodeId[]
  levelId: SceneNodeId | null
  buildingId: SceneNodeId | null
  siteId: SceneNodeId | null
  isPreview: boolean
}

export type NodeTreeIndex = {
  byId: Map<SceneNodeId, byIdNodeIndex>
  byType: Map<SceneNodeType, Set<SceneNodeId>>
  byLevel: Map<SceneNodeId, Set<SceneNodeId>>
  byBuilding: Map<SceneNodeId, Set<SceneNodeId>>
  bySite: Map<SceneNodeId, Set<SceneNodeId>>
  previewIds: Set<SceneNodeId>
}

// ============================================================================
// Traversal & Indexing
// ============================================================================

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

export const buildNodeTreeIndex = (scene: Scene): NodeTreeIndex => {
  const byId: NodeTreeIndex['byId'] = new Map()
  const byType: NodeTreeIndex['byType'] = new Map()
  const byLevel: NodeTreeIndex['byLevel'] = new Map()
  const byBuilding: NodeTreeIndex['byBuilding'] = new Map()
  const bySite: NodeTreeIndex['bySite'] = new Map()
  const previewIds: NodeTreeIndex['previewIds'] = new Set()

  function ensureSet<K>(map: Map<K, Set<SceneNodeId>>, key: K) {
    if (!map.has(key)) {
      map.set(key, new Set())
    }
    return map.get(key)!
  }

  function visitNode(
    node: SceneNode,
    context: {
      parentId: SceneNodeId | null
      path: (string | number)[]
      levelId: SceneNodeId | null
      buildingId: SceneNodeId | null
      siteId: SceneNodeId | null
    },
  ) {
    // Determine context for current node and children
    const levelId = node.type === 'level' ? node.id : context.levelId
    const buildingId = node.type === 'building' ? node.id : context.buildingId
    const siteId = node.type === 'site' ? node.id : context.siteId

    // Collect children
    const childIds: SceneNodeId[] = []
    const isPreview = Boolean((node as { editor?: { preview?: boolean } }).editor?.preview)

    if ('children' in node && Array.isArray(node.children)) {
      // Verify children array
      const children = node.children as SceneNode[]
      children.forEach((child, index) => {
        childIds.push(child.id)
        visitNode(child, {
          parentId: node.id,
          path: [...context.path, 'children', index],
          levelId,
          buildingId,
          siteId,
        })
      })
    }

    // Index by id
    const meta: byIdNodeIndex = {
      id: node.id,
      type: node.type,
      path: context.path,
      parent: context.parentId,
      children: childIds,
      levelId,
      buildingId,
      siteId,
      isPreview,
    }
    byId.set(node.id, meta)

    if (levelId) {
      ensureSet(byLevel, levelId).add(node.id)
    }
    if (buildingId) {
      ensureSet(byBuilding, buildingId).add(node.id)
    }
    if (siteId) {
      ensureSet(bySite, siteId).add(node.id)
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

  // Start traversal from sites (children of root)
  // Root structure: { children: SiteNode[] }
  const sites = scene.root.children

  sites.forEach((site, index) => {
    visitNode(site, {
      parentId: null,
      path: ['root', 'children', index],
      levelId: null,
      buildingId: null,
      siteId: null,
    })
  })

  return { byId, byType, byLevel, byBuilding, bySite, previewIds }
}

// Alias for backward compatibility
export const buildNodeIndex = buildNodeTreeIndex

// ============================================================================
// Path Operations
// ============================================================================

/**
 * Get a node from the scene by following a path
 */
export function getNodeByPath(
  scene: Scene,
  path: (string | number)[],
  nodeType?: AnyNodeType,
): AnyNode | null {
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
 * Update a node in the scene by path using Immer
 */
export const updateNodeAtPath = (
  scene: Scene,
  path: (string | number)[],
  updater: (node: SceneNode) => void,
): Scene => {
  if (path.length === 0) return scene

  return produce(scene, (draft) => {
    // Use 'any' to avoid "Type instantiation is excessively deep" error
    // This is a known limitation with immer's Draft type and recursive structures
    const node = getNodeByPath(draft as any, path)
    if (node) {
      updater(node)
    }
  })
}

const removeNodeAtPath = (scene: Scene, path: (string | number)[]): Scene => {
  if (path.length === 0) {
    return scene
  }

  return produce(scene, (draft) => {
    let cursor: unknown = draft
    for (let i = 0; i < path.length - 1; i += 1) {
      const key = path[i]
      if (typeof cursor !== 'object' || cursor === null) {
        return
      }

      if (Array.isArray(cursor) && typeof key === 'number') {
        cursor = cursor[key]
      } else if (!Array.isArray(cursor) && typeof key === 'string') {
        cursor = (cursor as Record<string, unknown>)[key]
      } else {
        return
      }
    }

    if (typeof cursor !== 'object' || cursor === null) {
      return
    }

    const container = cursor as Record<string, unknown> | unknown[]
    const lastKey = path[path.length - 1]
    if (Array.isArray(container) && typeof lastKey === 'number') {
      container.splice(lastKey, 1)
    } else if (!Array.isArray(container) && typeof lastKey === 'string') {
      delete container[lastKey]
    }
  })
}

const addNodeAtPath = (scene: Scene, path: (string | number)[], node: SceneNode): Scene => {
  return produce(scene, (draft) => {
    let cursor: unknown = draft

    // Traverse to the parent container
    for (const key of path) {
      if (typeof cursor !== 'object' || cursor === null) {
        return
      }
      if (Array.isArray(cursor) && typeof key === 'number') {
        cursor = cursor[key]
      } else if (!Array.isArray(cursor) && typeof key === 'string') {
        cursor = (cursor as Record<string, unknown>)[key]
      }
    }

    // Cursor should now be the parent node (or root container)
    const parent = cursor as Record<string, unknown>

    if (!parent.children) {
      parent.children = []
    }

    if (Array.isArray(parent.children)) {
      parent.children.unshift(node)
    }
  })
}

// ============================================================================
// Scene Graph Helper Utilities
// ============================================================================

export const getNodeMeta = (index: NodeTreeIndex, nodeId: SceneNodeId): byIdNodeIndex | null =>
  index.byId.get(nodeId) ?? null

export const getParentId = (index: NodeTreeIndex, nodeId: SceneNodeId): SceneNodeId | null =>
  index.byId.get(nodeId)?.parent ?? null

export const getAncestorChain = (index: NodeTreeIndex, nodeId: SceneNodeId): byIdNodeIndex[] => {
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

export const getLevelIdForNode = (index: NodeTreeIndex, nodeId: SceneNodeId): SceneNodeId | null =>
  index.byId.get(nodeId)?.levelId ?? null

export const listNodeIdsByLevel = (
  index: NodeTreeIndex,
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

export const listChildrenIds = (index: NodeTreeIndex, parentId: SceneNodeId): SceneNodeId[] =>
  index.byId.get(parentId)?.children ?? []

export const listChildrenIdsOfType = (
  index: NodeTreeIndex,
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

export const listPreviewNodeIds = (index: NodeTreeIndex): SceneNodeId[] =>
  Array.from(index.previewIds)

export const isPreviewNode = (index: NodeTreeIndex, nodeId: SceneNodeId): boolean =>
  index.previewIds.has(nodeId)

// ============================================================================
// SceneGraph Class
// ============================================================================

type SceneGraphOptions = {
  index?: NodeTreeIndex | null
  onChange?: (nextScene: Scene, nextIndex: NodeTreeIndex) => void
}

type NodeVisitor = (handle: SceneNodeHandle) => void

const toArray = <T>(value: Iterable<T> | undefined): T[] => {
  if (!value) {
    return []
  }
  return Array.from(value)
}

export class SceneGraph {
  private _scene: Scene
  private _index: NodeTreeIndex
  private readonly onChange?: (nextScene: Scene, nextIndex: NodeTreeIndex) => void

  constructor(scene?: Scene, options?: SceneGraphOptions) {
    this._scene = scene ?? initScene()
    this._index = options?.index ?? buildNodeTreeIndex(this._scene)
    this.onChange = options?.onChange
  }

  get scene() {
    return this._scene
  }

  get index() {
    return this._index
  }

  get root() {
    return this._scene.root
  }

  get size() {
    return this._index.byId.size
  }

  static init() {
    return new SceneGraph(initScene())
  }

  getNodeById<T extends AnyNodeType>(id: SceneNodeId): SceneNodeHandle<AnyNode & { type: T }> | null
  getNodeById(id: SceneNodeId): SceneNodeHandle | null
  getNodeById(id: SceneNodeId) {
    const meta = this._index.byId.get(id)
    if (!meta) {
      return null
    }
    const node = getNodeByPath(this._scene, meta.path)
    if (!node) {
      return null
    }
    return new SceneNodeHandle(this, node, meta)
  }

  getNodesByType<T extends AnyNodeType>(type: T): SceneNodeHandle<AnyNode & { type: T }>[] {
    const ids = this._index.byType.get(type)
    return toArray(ids)
      .map((id) => this.getNodeById<T>(id))
      .filter((value): value is SceneNodeHandle<AnyNode & { type: T }> => value !== null)
  }

  getAllNodes() {
    const handles: SceneNodeHandle[] = []
    this._index.byId.forEach((_, id) => {
      const handle = this.getNodeById(id)
      if (handle) {
        handles.push(handle)
      }
    })
    return handles
  }

  get nodes() {
    return {
      find: (query: {
        type?: AnyNodeType
        levelId?: SceneNodeId
        buildingId?: SceneNodeId
        siteId?: SceneNodeId
      }) => {
        let candidateIds: Set<SceneNodeId> | null = null
        let criteriaCount = 0

        const applyCriteria = (ids: Set<SceneNodeId> | undefined) => {
          criteriaCount++
          if (!ids) return false // No matches for this criterion

          if (candidateIds === null) {
            candidateIds = new Set(ids)
          } else {
            // Intersect
            for (const id of candidateIds) {
              if (!ids.has(id)) {
                candidateIds.delete(id)
              }
            }
          }

          return candidateIds.size > 0
        }

        if (query.type && !applyCriteria(this._index.byType.get(query.type))) {
          return []
        }

        if (query.levelId && !applyCriteria(this._index.byLevel.get(query.levelId))) {
          return []
        }

        if (query.buildingId && !applyCriteria(this._index.byBuilding.get(query.buildingId))) {
          return []
        }

        if (query.siteId && !applyCriteria(this._index.bySite.get(query.siteId))) {
          return []
        }

        if (criteriaCount === 0) {
          // No criteria provided, return all nodes
          return this.getAllNodes()
        }

        if (!candidateIds || (candidateIds as Set<SceneNodeId>).size === 0) {
          return []
        }

        return toArray(candidateIds as Set<SceneNodeId>)
          .map((id) => this.getNodeById(id))
          .filter((value): value is SceneNodeHandle => value !== null)
      },

      create: (node: AnyNode, parentId?: SceneNodeId) => {
        // If no parentId, assume adding to site (if node is building) or root (if node is site)
        // But root structure is fixed: root -> children (sites).

        let path: (string | number)[] = []

        if (parentId) {
          const parentMeta = this._index.byId.get(parentId)
          if (!parentMeta) {
            throw new Error(`Parent node not found: ${parentId}`)
          }
          path = parentMeta.path
        } else if (node.type === 'site') {
          path = ['root']
        } else {
          throw new Error('Parent ID required for non-site nodes')
        }

        const nextScene = addNodeAtPath(this._scene, path, node)
        this.updateState(nextScene)

        return this.getNodeById(node.id)
      },
    }
  }

  traverse(visitor: NodeVisitor) {
    this._index.byId.forEach((_, id) => {
      const handle = this.getNodeById(id)
      if (handle) {
        visitor(handle)
      }
    })
  }

  private updateState(nextScene: Scene) {
    if (nextScene === this._scene) return
    this._scene = nextScene
    this._index = buildNodeTreeIndex(nextScene)
    this.onChange?.(nextScene, this._index)
  }

  updateNode(id: SceneNodeId, updates: Partial<AnyNode>) {
    const meta = this._index.byId.get(id)
    if (!meta) {
      return
    }

    const nextScene = updateNodeAtPath(this._scene, meta.path, (node) => {
      Object.assign(node, updates)
    })

    this.updateState(nextScene)
  }

  deleteNode(id: SceneNodeId) {
    const meta = this._index.byId.get(id)
    if (!meta) {
      return
    }

    const nextScene = removeNodeAtPath(this._scene, meta.path)
    this.updateState(nextScene)
  }

  [Symbol.for('nodejs.util.inspect.custom')]() {
    return `SceneGraph { nodes: ${this.size} }`
  }
}

type SceneNodeMeta = byIdNodeIndex

export class SceneNodeHandle<T extends AnyNode = AnyNode> {
  private readonly graph: SceneGraph
  private readonly _id: SceneNodeId

  constructor(graph: SceneGraph, node: SceneNode, _meta: SceneNodeMeta) {
    this.graph = graph
    this._id = node.id
  }

  private get meta() {
    const meta = this.graph.index.byId.get(this._id)
    if (!meta) {
      throw new Error(`Node ${this._id} is no longer in the scene graph`)
    }
    return meta
  }

  private get node() {
    const meta = this.meta
    const node = getNodeByPath(this.graph.scene, meta.path)
    if (!node) {
      throw new Error(`Node ${this._id} not found at path ${meta.path.join('.')}`)
    }
    return node as T
  }

  get id() {
    return this._id
  }

  get type() {
    return this.meta.type as T extends { type: infer U } ? U : never
  }

  get value() {
    return this.node
  }

  get path() {
    return [...this.meta.path]
  }

  data() {
    return this.node
  }

  parent() {
    const parentId = this.meta.parent
    if (!parentId) {
      return null
    }

    return this.graph.getNodeById(parentId)
  }

  children(filter?: (child: SceneNodeHandle) => boolean) {
    const handles = this.meta.children
      .map((childId) => this.graph.getNodeById(childId))
      .filter((value): value is SceneNodeHandle => value !== null)

    if (filter) {
      return handles.filter(filter)
    }

    return handles
  }

  update(patch: Partial<T>) {
    this.graph.updateNode(this._id, patch)
  }

  delete() {
    this.graph.deleteNode(this._id)
  }

  create<K extends keyof NodeCreateTypeMap>(
    type: K,
    data: Omit<NodeCreateTypeMap[K], 'id' | 'object' | 'type' | 'parentId' | 'children'>,
  ) {
    const schema = NodeSchemas[type]
    if (!schema) {
      throw new Error(`Unknown node type: ${type}`)
    }
    // Parse will handle defaults (like id generation)
    const node = schema.parse(data) as SceneNode
    return this.graph.nodes.create(node, this._id)
  }

  toJSON() {
    return this.node
  }
}
