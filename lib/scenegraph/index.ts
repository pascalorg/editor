import { produce } from 'immer'
import {
  type AnyNode,
  type AnyNodeId,
  type AnyNodeType,
  buildSceneIndex,
  getNodeByPath,
  type NodeTypeMap,
  type Scene,
  type SceneIndex,
  updateNodeByPath,
} from '@/lib/scenegraph/schema/index'

type SceneGraphOptions = {
  index?: SceneIndex | null
  onChange?: (nextScene: Scene) => void
}

type NodeVisitor = (handle: SceneNodeHandle) => void

const toArray = <T>(value: Iterable<T> | undefined): T[] => {
  if (!value) {
    return []
  }
  return Array.from(value)
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

export class SceneGraph {
  readonly scene: Scene
  readonly index: SceneIndex
  private readonly onChange?: (nextScene: Scene) => void

  constructor(scene: Scene, options?: SceneGraphOptions) {
    this.scene = scene
    this.index = options?.index ?? buildSceneIndex(scene)
    this.onChange = options?.onChange
  }

  get root() {
    return this.scene.root
  }

  get size() {
    return this.index.byId.size
  }

  getNodeById<T extends keyof NodeTypeMap>(id: AnyNodeId): SceneNodeHandle<NodeTypeMap[T]> | null
  getNodeById(id: AnyNodeId): SceneNodeHandle | null
  getNodeById(id: AnyNodeId) {
    const meta = this.index.byId.get(id)
    if (!meta) {
      return null
    }
    const node = getNodeByPath(this.scene, meta.path)
    if (!node) {
      return null
    }
    return new SceneNodeHandle(this, node, meta)
  }

  getNodesByType<T extends keyof NodeTypeMap>(type: T): SceneNodeHandle<NodeTypeMap[T]>[] {
    const ids = this.index.byType.get(type as AnyNodeType)
    return toArray(ids)
      .map((id) => this.getNodeById<T>(id))
      .filter((value): value is SceneNodeHandle<NodeTypeMap[T]> => value !== null)
  }

  getAllNodes() {
    const handles: SceneNodeHandle[] = []
    this.index.byId.forEach((_, id) => {
      const handle = this.getNodeById(id)
      if (handle) {
        handles.push(handle)
      }
    })
    return handles
  }

  traverse(visitor: NodeVisitor) {
    this.index.byId.forEach((_, id) => {
      const handle = this.getNodeById(id)
      if (handle) {
        visitor(handle)
      }
    })
  }

  updateNode(id: AnyNodeId, updates: Partial<AnyNode>) {
    const meta = this.index.byId.get(id)
    if (!(meta && this.onChange)) {
      return
    }

    const nextScene = updateNodeByPath(
      this.scene,
      meta.path,
      (node) =>
        ({
          ...node,
          ...updates,
        }) as AnyNode,
    ) as Scene

    this.onChange(nextScene)
  }

  deleteNode(id: AnyNodeId) {
    const meta = this.index.byId.get(id)
    if (!(meta && this.onChange)) {
      return
    }

    const nextScene = removeNodeAtPath(this.scene, meta.path)
    this.onChange(nextScene)
  }
}

type SceneNodeMeta = SceneIndex['byId'] extends Map<AnyNodeId, infer Meta> ? Meta : never

export class SceneNodeHandle<T extends AnyNode = AnyNode> {
  private readonly graph: SceneGraph
  private readonly node: T
  private readonly meta: SceneNodeMeta

  constructor(graph: SceneGraph, node: AnyNode, meta: SceneNodeMeta) {
    this.graph = graph
    this.node = node as T
    this.meta = meta
  }

  get id() {
    return this.node.id
  }

  get type() {
    return this.node.type
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
    if (!this.meta.parent) {
      return null
    }

    return this.graph.getNodeById(this.meta.parent)
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
    this.graph.updateNode(this.meta.id, patch)
  }

  delete() {
    this.graph.deleteNode(this.meta.id)
  }

  toJSON() {
    return this.node
  }
}
