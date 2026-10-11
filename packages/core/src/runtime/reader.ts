import type { SceneNodes } from '../agent-operations/types'
import type { AnyNode, Collection } from '../schema'
import type { SceneMaterial } from '../schema/scene-material'
import {
  type CollectionPredicate,
  type Dependency,
  type EntityQuery,
  type NodePredicate,
  type QueryDependency,
  queryIds,
} from './dependencies'

/** Where a reader reads: a scene store's current document. */
export type DocumentSource = {
  nodes(): Readonly<Record<string, AnyNode>>
  collections(): Readonly<Record<string, Collection>>
  materials(): Readonly<Record<string, SceneMaterial>>
  rootNodeIds(): readonly string[]
  installedPlugins(): readonly string[]
  /** Throws once the scene is disposed. */
  assertActive(): void
}

/**
 * Reads a scene's document. A tracked reader records each read as a `Dependency`; values it
 * returns (nodes, collections, the `nodes` and `collections` records) are read-only views whose
 * field reads are recorded too. Code that only copies an entity through to a write wraps it in
 * `untracked` first: copying is not a read.
 */
export interface DocumentReader {
  /** The node, or undefined: either way its presence is recorded. */
  get(id: string): AnyNode | undefined
  /** Entities matching a query; the matching ids are recorded, absent matches included. */
  query(query: { entity: 'node'; where?: NodePredicate }): AnyNode[]
  query(query: { entity: 'collection'; where?: CollectionPredicate }): Collection[]
  query(query: { entity: 'material' }): SceneMaterial[]
  query(query: { entity: 'root' }): AnyNode[]
  /** A parent's children in order, recording the order: for reads whose result depends on it. */
  orderedChildren(id: string): string[]
  collection(id: string): Collection | undefined
  material(id: string): SceneMaterial | undefined
  installedPlugins(): readonly string[]
  /**
   * The nodes as a record, for operations written against `SceneNodes`. A node read through it is
   * recorded like `get`; enumerating it records a query over every node (conservative: any
   * created or deleted node then conflicts). Prefer `query`.
   */
  readonly nodes: SceneNodes
  /** The collections as a record, recorded like `nodes`. */
  readonly collections: Readonly<Record<string, Collection>>
  /**
   * The view of another version of the nodes record (one this scene held earlier), recorded like
   * `nodes`; comparing two versions node by node by identity holds across views.
   */
  track(nodes: SceneNodes): SceneNodes
}

/** Accumulates a computation's reads. */
export class DependencyRecorder {
  private readonly nodes = new Map<string, Set<string>>()
  private readonly collections = new Map<string, Set<string>>()
  private readonly materials = new Set<string>()
  private readonly queries = new Map<string, QueryDependency>()
  private readonly orders = new Map<string, readonly string[]>()
  private readonly declared = new Map<string, Dependency>()
  private plugins = false

  node(id: string, field?: string): void {
    const fields = this.nodes.get(id) ?? new Set<string>()
    this.nodes.set(id, fields)
    if (field !== undefined) fields.add(field)
  }

  collection(id: string, field?: string): void {
    const fields = this.collections.get(id) ?? new Set<string>()
    this.collections.set(id, fields)
    if (field !== undefined) fields.add(field)
  }

  material(id: string): void {
    this.materials.add(id)
  }

  installedPlugins(): void {
    this.plugins = true
  }

  query(dependency: QueryDependency): void {
    this.queries.set(JSON.stringify([dependency.entity, dependency.predicate]), dependency)
  }

  order(parentId: string, childIds: readonly string[]): void {
    if (!this.orders.has(parentId)) this.orders.set(parentId, [...childIds])
  }

  /** A dependency the host declares: a file or artifact it read, or a conservative scope. */
  declare(dependency: Dependency): void {
    this.declared.set(JSON.stringify(dependency), dependency)
  }

  dependencies(): Dependency[] {
    return [
      ...[...this.nodes].map(([id, fields]) => ({
        kind: 'node' as const,
        id,
        fields: [...fields].sort(),
      })),
      ...this.queries.values(),
      ...[...this.orders].map(([parentId, childIds]) => ({
        kind: 'order' as const,
        parentId,
        childIds,
      })),
      ...[...this.collections].map(([id, fields]) => ({
        kind: 'collection' as const,
        id,
        fields: [...fields].sort(),
      })),
      ...[...this.materials].map((id) => ({ kind: 'material' as const, id })),
      ...(this.plugins ? [{ kind: 'plugins' as const }] : []),
      ...this.declared.values(),
    ]
  }
}

const rawOfView = new WeakMap<object, object>()
const readerOfRecord = new WeakMap<object, DocumentReader>()

/**
 * The tracked reader behind a `nodes` record, when it is one (a detached scene's): helpers that
 * receive `SceneNodes` query through it, so they record what they select rather than everything.
 */
export function readerOf(nodes: object): DocumentReader | undefined {
  return readerOfRecord.get(nodes)
}

/** The plain value behind a tracked view (copying it records nothing); other values as they are. */
export function untracked<T>(value: T): T {
  return value && typeof value === 'object' ? ((rawOfView.get(value) as T) ?? value) : value
}

/**
 * `value` with every tracked view inside it replaced by a plain copy, recursively: what a
 * computation hands out of its scene (a tool's result) so it outlives the scene. Copying a view
 * reads all of it, and is recorded so.
 */
export function materialize<T>(value: T): T {
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    const items = value.map((item) => materialize(item))
    return (items.some((item, index) => item !== value[index]) ? items : value) as T
  }
  const isView = rawOfView.has(value)
  if (!isView && Object.getPrototypeOf(value) !== Object.prototype) return value
  let copy: Record<string, unknown> | null = isView ? {} : null
  for (const [key, item] of Object.entries(value)) {
    const next = materialize(item)
    if (copy) copy[key] = next
    else if (next !== item) {
      copy = { ...(value as Record<string, unknown>) }
      copy[key] = next
    }
  }
  return (copy ?? value) as T
}

const readOnly = () => {
  throw new TypeError('A scene read through a DocumentReader is read-only; write through the host.')
}

/**
 * A read-only view of `raw` whose every own-field access calls `onRead(field)`. The proxy target
 * is an empty shell, not `raw`, so frozen records stay viewable.
 */
function fieldView<T extends object>(
  raw: T,
  assertActive: () => void,
  onRead: (field: string) => void,
): T {
  const view = new Proxy(Object.create(null) as T, {
    get(_, key) {
      assertActive()
      if (typeof key === 'string') onRead(key)
      return Reflect.get(raw, key)
    },
    has(_, key) {
      assertActive()
      if (typeof key === 'string') onRead(key)
      return Reflect.has(raw, key)
    },
    ownKeys() {
      assertActive()
      const keys = Reflect.ownKeys(raw)
      for (const key of keys) if (typeof key === 'string') onRead(key)
      return keys
    },
    getOwnPropertyDescriptor(_, key) {
      assertActive()
      if (typeof key === 'string') onRead(key)
      const descriptor = Reflect.getOwnPropertyDescriptor(raw, key)
      return (
        descriptor && {
          value: descriptor.value,
          writable: true,
          enumerable: true,
          configurable: true,
        }
      )
    },
    getPrototypeOf: () => Object.prototype,
    set: readOnly,
    defineProperty: readOnly,
    deleteProperty: readOnly,
  })
  rawOfView.set(view, raw)
  return view
}

/**
 * A read-only view of one version of a record of entities: a key read records the entity's
 * presence and returns its tracked view; enumerating the record records `enumerate()`. A view
 * belongs to one version, as the record does, so identity-keyed memos stay correct.
 */
function recordView<T extends object>(
  current: Readonly<Record<string, T>>,
  assertActive: () => void,
  entity: (id: string, raw: T | undefined) => T | undefined,
  enumerate: () => void,
): Readonly<Record<string, T>> {
  return new Proxy(Object.create(null) as Record<string, T>, {
    get(_, key) {
      assertActive()
      if (typeof key !== 'string') return Reflect.get(current, key)
      if (Object.hasOwn(current, key)) return entity(key, current[key])
      entity(key, undefined)
      return Reflect.get(current, key)
    },
    has(_, key) {
      assertActive()
      if (typeof key === 'string')
        entity(key, Object.hasOwn(current, key) ? current[key] : undefined)
      return Reflect.has(current, key)
    },
    ownKeys() {
      assertActive()
      enumerate()
      return Reflect.ownKeys(current)
    },
    getOwnPropertyDescriptor(_, key) {
      assertActive()
      if (typeof key !== 'string') return Reflect.getOwnPropertyDescriptor(current, key)
      if (!Object.hasOwn(current, key)) {
        entity(key, undefined)
        return undefined
      }
      return {
        value: entity(key, current[key]),
        writable: true,
        enumerable: true,
        configurable: true,
      }
    },
    getPrototypeOf: () => Object.prototype,
    set: readOnly,
    defineProperty: readOnly,
    deleteProperty: readOnly,
  })
}

/**
 * A reader over `source`. With a recorder, every read is recorded; without one (the editor's own
 * runtime) it reads the raw document.
 */
export function createDocumentReader(
  source: DocumentSource,
  recorder: DependencyRecorder | null,
): DocumentReader {
  if (!recorder) return createPlainReader(source)
  const { assertActive } = source
  const nodeViews = new WeakMap<AnyNode, AnyNode>()
  const collectionViews = new WeakMap<Collection, Collection>()
  const trackNode = (id: string, raw: AnyNode | undefined) => {
    recorder.node(id)
    if (!raw) return undefined
    let view = nodeViews.get(raw)
    if (!view) {
      view = fieldView(raw, assertActive, (field) => recorder.node(raw.id, field))
      nodeViews.set(raw, view)
    }
    return view
  }
  const trackCollection = (id: string, raw: Collection | undefined) => {
    recorder.collection(id)
    if (!raw) return undefined
    let view = collectionViews.get(raw)
    if (!view) {
      view = fieldView(raw, assertActive, (field) => recorder.collection(raw.id, field))
      collectionViews.set(raw, view)
    }
    return view
  }
  const document = () => ({
    nodes: source.nodes() as Record<string, AnyNode>,
    collections: source.collections() as Record<string, Collection>,
    materials: source.materials() as Record<string, SceneMaterial>,
    rootNodeIds: source.rootNodeIds() as string[],
  })
  const recordQuery = (query: QueryDependency['entity'], predicate: unknown): string[] => {
    const resultIds = queryIds(document() as never, {
      entity: query,
      predicate: (predicate ?? null) as never,
    })
    recorder.query({ kind: 'query', entity: query, predicate, resultIds } as QueryDependency)
    return resultIds
  }

  // One view per version of each record, created as the reader meets it.
  const recordViews = new WeakMap<object, Readonly<Record<string, unknown>>>()
  const viewOf = <T extends object>(
    raw: Readonly<Record<string, T>>,
    entity: (id: string, raw: T | undefined) => T | undefined,
    enumerate: () => void,
  ): Readonly<Record<string, T>> => {
    let view = recordViews.get(raw) as Readonly<Record<string, T>> | undefined
    if (!view) {
      view = recordView(raw, assertActive, entity, enumerate)
      recordViews.set(raw, view)
      readerOfRecord.set(view, reader)
    }
    return view
  }

  function query(query: EntityQuery): unknown[] {
    assertActive()
    const current = document()
    switch (query.entity) {
      case 'node':
        return recordQuery('node', query.where ?? null).map((id) =>
          trackNode(id, current.nodes[id]),
        )
      case 'collection':
        return recordQuery('collection', query.where ?? null).map((id) =>
          trackCollection(id, current.collections[id]),
        )
      case 'material':
        return recordQuery('material', null).map((id) => current.materials[id])
      case 'root':
        return recordQuery('root', null).flatMap((id) => trackNode(id, current.nodes[id]) ?? [])
    }
  }

  const reader: DocumentReader = {
    get: (id) => {
      assertActive()
      return trackNode(id, source.nodes()[id])
    },
    query: query as DocumentReader['query'],
    orderedChildren: (id) => {
      assertActive()
      const node = source.nodes()[id]
      recorder.node(id)
      const children = childIdsOf(node)
      recorder.order(id, children)
      return [...children]
    },
    collection: (id) => {
      assertActive()
      return trackCollection(id, source.collections()[id])
    },
    material: (id) => {
      assertActive()
      recorder.material(id)
      return source.materials()[id]
    },
    installedPlugins: () => {
      assertActive()
      recorder.installedPlugins()
      return [...source.installedPlugins()]
    },
    get nodes() {
      assertActive()
      return viewOf(source.nodes(), trackNode, () => recordQuery('node', null)) as SceneNodes
    },
    track: (raw) => {
      assertActive()
      return viewOf(raw, trackNode, () => recordQuery('node', null)) as SceneNodes
    },
    get collections() {
      assertActive()
      return viewOf(source.collections(), trackCollection, () => recordQuery('collection', null))
    },
  }
  return reader
}

function childIdsOf(node: AnyNode | undefined): string[] {
  return node && 'children' in node && Array.isArray(node.children)
    ? (node.children as unknown[]).filter((id): id is string => typeof id === 'string')
    : []
}

function createPlainReader(source: DocumentSource): DocumentReader {
  const { assertActive } = source
  const document = () => ({
    nodes: source.nodes() as Record<string, AnyNode>,
    collections: source.collections() as Record<string, Collection>,
    materials: source.materials() as Record<string, SceneMaterial>,
    rootNodeIds: source.rootNodeIds() as string[],
  })
  function query(query: EntityQuery): unknown[] {
    assertActive()
    const current = document()
    const ids = queryIds(current, {
      entity: query.entity,
      predicate: ('where' in query ? (query.where ?? null) : null) as never,
    })
    switch (query.entity) {
      case 'node':
      case 'root':
        return ids.flatMap((id) => current.nodes[id] ?? [])
      case 'collection':
        return ids.map((id) => current.collections[id])
      case 'material':
        return ids.map((id) => current.materials[id])
    }
  }
  return {
    get: (id) => source.nodes()[id],
    query: query as DocumentReader['query'],
    orderedChildren: (id) => childIdsOf(source.nodes()[id]),
    collection: (id) => source.collections()[id],
    material: (id) => source.materials()[id],
    installedPlugins: () => [...source.installedPlugins()],
    get nodes() {
      return source.nodes() as SceneNodes
    },
    track: (raw) => raw,
    get collections() {
      return source.collections()
    },
  }
}
