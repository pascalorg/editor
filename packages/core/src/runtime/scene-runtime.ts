import { type AgentHostRuntime, applyAgentOutcome } from '../agent-operations/apply-outcome'
import { writeCollections } from '../agent-operations/collections'
import type {
  AgentContext,
  AgentOperation,
  SceneChanges,
  SceneNodes,
} from '../agent-operations/types'
import {
  createSnapshotSpatialGrid,
  type SpatialGridManager,
  withSpatialGrid,
} from '../hooks/spatial-grid/spatial-grid-manager'
import { resolveLevelId } from '../lib/node-ancestry'
import { getNodePluginId, nodeRegistry } from '../registry/registry'
import type { AnyNode, AnyNodeId, Collection } from '../schema'
import { type IdAllocator, withIdAllocator } from '../schema/base'
import { runSettlingDocument } from '../store/document-settling'
import {
  pauseSceneHistory,
  resumeSceneHistory,
  runAsSingleSceneHistoryStep,
  type SceneSnapshot,
} from '../store/history-control'
import { createSceneEnvironment, type SceneEnvironment } from '../store/scene-environment'
import useScene, { createSceneStore, type SceneStore, sceneDocumentOf } from '../store/use-scene'
import { reconcileDocument } from '../systems/document-reconcile'
import type { Dependency } from './dependencies'
import { diffSceneDocuments } from './patch'
import {
  createDocumentReader,
  DependencyRecorder,
  type DocumentReader,
  type DocumentSource,
  materialize,
  untracked,
} from './reader'

/** The saved scene a computation starts from: a draft revision, or an authority sequence. */
export type SceneRevision =
  | { kind: 'draft'; id: string; updatedAt: string }
  | { kind: 'authority'; seq: number }

/**
 * What a computation knows besides the document, frozen when it starts: the floor the person was
 * viewing, their selection and units, the catalog revision, and the node registry it ran against.
 */
export type ExecutionContext = {
  activeLevelId: string | null
  selection: readonly string[]
  units: 'metric' | 'imperial'
  catalogVersion: string
  /** `captureRegistryVersions()` once the host's plugins are loaded. */
  registryVersions: Record<string, string>
}

/** Each registered node kind and the schema version it parses with (`plugin@version`). */
export function captureRegistryVersions(): Record<string, string> {
  const versions: Record<string, string> = {}
  for (const [kind, definition] of [...nodeRegistry.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  ))
    versions[kind] = `${getNodePluginId(kind) ?? 'core'}@${definition.schemaVersion}`
  return versions
}

export class RegistryVersionMismatchError extends Error {
  constructor(readonly kinds: string[]) {
    super(
      `The node registry differs from the one the computation was captured with: ${kinds.join(', ')}.`,
    )
    this.name = 'RegistryVersionMismatchError'
  }
}

/**
 * A scene store with the means to compute on it: the reader agent code reads through, the scope
 * (environment, id allocator, support index) its writes run in, and the document reconciliation.
 * The editor's store is one (`liveSceneRuntime`); a detached scene is another.
 */
export interface SceneRuntime {
  readonly store: SceneStore
  reader(): DocumentReader
  /** Runs `run` in this scene's scope: its history environment, ids and support index. */
  run<T>(run: () => T): T
  /** Settles every derived write owed since `before` (`reconcileDocument`), reading through `reader`. */
  reconcile(before: SceneNodes, options?: { allLevels?: boolean }): void
}

function sourceOf(store: SceneStore, environment: SceneEnvironment | null): DocumentSource {
  return {
    nodes: () => store.getState().nodes,
    collections: () => store.getState().collections,
    materials: () => store.getState().materials,
    rootNodeIds: () => store.getState().rootNodeIds,
    installedPlugins: () => store.getState().installedPlugins,
    assertActive: () => environment?.assertActive(),
  }
}

/** The editor's own store: plain reads, random ids, the editor's environment. */
export const liveSceneRuntime: SceneRuntime = {
  store: useScene,
  reader: () => createDocumentReader(sourceOf(useScene, null), null),
  run: (run) => run(),
  reconcile: (before, options) => reconcileDocument(useScene, before, options),
}

/**
 * Loads an already-migrated document into `store` as it is: no migration, healing or
 * normalisation runs again (a load through `setScene` would, and could change it — closing level
 * gaps, re-cutting openings). The store's history starts empty at this document.
 */
export function loadCanonicalSnapshot(store: SceneStore, snapshot: SceneSnapshot): void {
  pauseSceneHistory(store)
  try {
    store.setState({
      nodes: snapshot.nodes,
      rootNodeIds: snapshot.rootNodeIds,
      collections: snapshot.collections,
      materials: snapshot.materials,
      installedPlugins: [...snapshot.installedPlugins],
      hasExplicitPluginInstallState: snapshot.hasExplicitPluginInstallState ?? false,
      hydrationToken: null,
      hydrationId: null,
      readOnly: false,
    })
  } finally {
    resumeSceneHistory(store)
  }
  store.temporal.getState().clear()
}

/** A scene detached from the editor: computed on, then turned into a patch. */
export interface DetachedScene extends SceneRuntime {
  readonly base: SceneRevision
  readonly context: ExecutionContext
  /** Applies agent changes and settles their derived writes, recording what they read. */
  host(): AgentHostRuntime
  /**
   * Runs an agent operation on this scene, as `applyAgentOutcome` through `host()`, and returns its
   * result as plain data (`materialize`) that outlives the scene.
   */
  execute<Input>(
    operation: AgentOperation<Input>,
    input: Input,
    context: AgentContext,
  ): Record<string, unknown>
  /** Records a read the reader cannot see: a project file, an artifact, a conservative scope. */
  declare(dependency: Dependency): void
  dependencies(): Dependency[]
  /** The document change since the snapshot, field by field, derived writes settled. */
  patch(): ReturnType<typeof diffSceneDocuments>
  /** Ends the scene: every later read or write of it throws. */
  dispose(): void
  readonly disposed: boolean
}

/** Unwraps tracked views an operation put in its changes, so the store holds plain records. */
function plainChanges(changes: SceneChanges): SceneChanges {
  const plainData = (data: Partial<AnyNode>) =>
    Object.fromEntries(
      Object.entries(untracked(data)).map(([key, value]) => [key, untracked(value)]),
    ) as Partial<AnyNode>
  return {
    ...(changes.create && {
      create: changes.create.map(({ node, parentId }) => ({
        node: untracked(node),
        ...(parentId === undefined ? {} : { parentId }),
      })),
    }),
    ...(changes.update && {
      update: changes.update.map(({ id, data }) => ({ id, data: plainData(data) })),
    }),
    ...(changes.delete && { delete: [...changes.delete] }),
    ...(changes.collections && {
      collections: Object.fromEntries(
        Object.entries(changes.collections).map(([id, collection]) => [id, untracked(collection)]),
      ),
    }),
  }
}

/** Applies agent changes to a store as the editor's actions do. */
export function applySceneChangesToStore(store: SceneStore, changes: SceneChanges): void {
  const { create, update, delete: remove, collections } = plainChanges(changes)
  if (create?.length || update?.length || remove?.length)
    store.getState().applyNodeChanges({
      create: create as { node: AnyNode; parentId?: AnyNodeId }[] | undefined,
      update: update as { id: AnyNodeId; data: Partial<AnyNode> }[] | undefined,
      delete: remove as AnyNodeId[] | undefined,
    })
  if (collections && Object.keys(collections).length)
    store.setState({
      collections: writeCollections(store.getState().collections, collections) as Record<
        Collection['id'],
        Collection
      >,
    })
}

/**
 * What a runtime lends an agent operation's outcome (`applyAgentOutcome`): its changes applied as
 * the editor's actions apply them, each followed by the document reconciliation, and an explicit
 * reconcile of every level. One undo step per call.
 */
export function createAgentHost(runtime: SceneRuntime): AgentHostRuntime {
  const nodes = () => runtime.store.getState().nodes as SceneNodes
  return {
    getNodes: () => runtime.reader().nodes,
    applyChanges: (changes) =>
      runtime.run(() =>
        runSettlingDocument(runtime.store, () =>
          runAsSingleSceneHistoryStep(runtime.store, () => {
            const before = nodes()
            applySceneChangesToStore(runtime.store, changes)
            runtime.reconcile(before)
          }),
        ),
      ),
    reconcile: () =>
      runtime.run(() =>
        runSettlingDocument(runtime.store, () => runtime.reconcile(nodes(), { allLevels: true })),
      ),
  }
}

/**
 * A support index over the scene's own nodes that records, for every query about a level, a
 * `scope` dependency on that level: support reads walk spatial indexes the reader cannot see.
 */
function recordingSupportGrid(
  store: SceneStore,
  recorder: DependencyRecorder,
): () => SpatialGridManager {
  let cached: { nodes: SceneNodes; grid: SpatialGridManager } | null = null
  return () => {
    const nodes = store.getState().nodes as SceneNodes
    if (cached?.nodes !== nodes) {
      const grid = createSnapshotSpatialGrid(() => store.getState().nodes, resolveLevelId)
      const recording = new Proxy(grid, {
        get(target, key, receiver) {
          const value = Reflect.get(target, key, receiver)
          if (typeof value !== 'function') return value
          return (...args: unknown[]) => {
            const [levelId] = args
            if (typeof levelId === 'string' && store.getState().nodes[levelId as AnyNodeId])
              recorder.declare({ kind: 'scope', level: levelId })
            return value.apply(target, args)
          }
        },
      })
      cached = { nodes, grid: recording }
    }
    return cached.grid
  }
}

/**
 * Opens a detached scene over a canonical snapshot (already migrated: `getSceneDocument()` of a
 * loaded editor, or a saved draft). It has its own store, history, commit bus, drafts and support
 * index, so nothing done on it reaches the editor. Every id it mints comes from `ids` (use
 * `effectIds(effectId)` to make a recomputation mint the same ones), and every read made through
 * its reader, host and reconciliation is recorded.
 */
export function openDetachedScene(
  snapshot: SceneSnapshot,
  options: { base: SceneRevision; context: ExecutionContext; ids: IdAllocator },
): DetachedScene {
  const current = captureRegistryVersions()
  const mismatched = [
    ...new Set([...Object.keys(current), ...Object.keys(options.context.registryVersions)]),
  ].filter((kind) => current[kind] !== options.context.registryVersions[kind])
  if (mismatched.length) throw new RegistryVersionMismatchError(mismatched)

  const environment = createSceneEnvironment(`detached at ${JSON.stringify(options.base)}`)
  const store = createSceneStore(environment)
  loadCanonicalSnapshot(store, snapshot)
  const base = sceneDocumentOf(store)
  const recorder = new DependencyRecorder()
  const reader = createDocumentReader(sourceOf(store, environment), recorder)
  const grid = recordingSupportGrid(store, recorder)
  const run = <T>(work: () => T): T =>
    environment.run(() => withIdAllocator(options.ids, () => withSpatialGrid(grid, work)))
  const rawNodes = () => store.getState().nodes as SceneNodes
  const reconcile = (before: SceneNodes, reconcileOptions: { allLevels?: boolean } = {}) => {
    run(() => reconcileDocument(store, before, { ...reconcileOptions, read: reader.track, grid }))
    settled = rawNodes()
  }
  let settled = rawNodes()

  const scene: DetachedScene = {
    base: options.base,
    context: options.context,
    store,
    reader: () => reader,
    run,
    reconcile,
    host: () => createAgentHost(scene),
    execute: (operation, input, context) =>
      run(() =>
        materialize(
          applyAgentOutcome(operation(reader.nodes, input, context), createAgentHost(scene)),
        ),
      ),
    declare: (dependency) => {
      environment.assertActive()
      recorder.declare(dependency)
    },
    dependencies: () => {
      environment.assertActive()
      return recorder.dependencies()
    },
    patch: () => {
      if (rawNodes() !== settled) reconcile(settled)
      return diffSceneDocuments(base, sceneDocumentOf(store))
    },
    dispose: () => environment.dispose(),
    get disposed() {
      return environment.disposed
    },
  }
  return scene
}
