// Side-effect import MUST come first: installs RAF polyfill before core loads.
import './node-shims'
import {
  applyStructureReconciliation,
  assertDerivedNodeWrites,
  HIDDEN_SITE_NOTE,
  type NodeDeletionPlan,
  type NodeDeletionScene,
  pauseSceneHistory,
  pauseSpaceDetection,
  planNodeDeletion,
  planWallDeletion,
  resumeSceneHistory,
  resumeSpaceDetection,
  structureChangeBatch,
} from '@pascal-app/core'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import {
  declareActionDependencies,
  liveSceneRuntime,
  materialize,
  runAsSettledSceneStep,
  type SceneRuntime,
} from '@pascal-app/core/runtime'
import type { AnyNode, Collection, CollectionId, SceneMaterialId } from '@pascal-app/core/schema'
import {
  type AnyNodeId,
  AnyNode as AnyNodeSchema,
  type AnyNodeType,
  generateId,
  parseNode,
  SceneMaterial,
} from '@pascal-app/core/schema'
import type { SceneMeta } from '../storage/types'
import { InMemoryAgentSession } from './agent-session'

export type ValidationError = { nodeId: string; path: string; message: string }
export type ValidationResult = {
  valid: boolean
  errors: ValidationError[]
  /** Advisories that do not fail validation, such as a hidden Site. */
  warnings: ValidationError[]
}

export type CreatePatch = { op: 'create'; node: AnyNode; parentId?: AnyNodeId }
export type UpdatePatch = { op: 'update'; id: AnyNodeId; data: Partial<AnyNode> }
export type DeletePatch = { op: 'delete'; id: AnyNodeId; cascade?: boolean }
/** Adds or replaces a scene material, written before the nodes of the same patch. */
export type MaterialUpsertPatch = { op: 'upsert_material'; material: SceneMaterial }
export type Patch = CreatePatch | UpdatePatch | DeletePatch | MaterialUpsertPatch
export type ActiveSceneMeta = Pick<
  SceneMeta,
  'id' | 'name' | 'projectId' | 'ownerId' | 'thumbnailUrl' | 'version' | 'graphHash'
>

/** The `extra` bag `setScene` accepts — collections, materials, plugin state. */
type SetSceneExtra = Parameters<ReturnType<SceneRuntime['store']['getState']>['setScene']>[2]

/**
 * Headless bridge to a `@pascal-app/core` scene store: the editor's own (the default), or a
 * detached scene's (`@pascal-app/core/runtime`), whose host passes it as `runtime`.
 *
 * All mutation flows through the real core store so undo/redo works via Zundo. Reads go through
 * the runtime's reader (recorded on a detached scene), and writes run in its scope: its history
 * environment, its id allocator, its disposal guard. No renderer is attached; `dirtyNodes`
 * accumulates and can be drained via `flushDirty()` for observability.
 */
export class SceneBridge {
  /** `applyPatch` takes `upsert_material` patches, in the patch's one history step. */
  readonly supportsMaterialUpserts = true
  private activeScene: ActiveSceneMeta | null = null
  private readonly runtime: SceneRuntime

  constructor(options: { runtime?: SceneRuntime } = {}) {
    this.runtime = options.runtime ?? liveSceneRuntime
  }

  private get store() {
    return this.runtime.store
  }

  private write<T>(run: () => T): T {
    return this.runtime.run(run)
  }

  /** What the agent's session has kept: its named moments, and what it made. */
  readonly agentSession = new InMemoryAgentSession()

  /**
   * Scene identity currently bound to this bridge. MCP tools use this to know
   * which editor scene should receive live events after mutations.
   */
  setActiveScene(meta: ActiveSceneMeta): void {
    this.activeScene = {
      id: meta.id,
      name: meta.name,
      projectId: meta.projectId,
      ownerId: meta.ownerId,
      thumbnailUrl: meta.thumbnailUrl,
      version: meta.version,
      ...(meta.graphHash === undefined ? {} : { graphHash: meta.graphHash }),
    }
  }

  getActiveScene(): ActiveSceneMeta | null {
    return this.activeScene
  }

  clearActiveScene(): void {
    this.activeScene = null
  }

  /** Load initial state; if empty, creates default Site → Building → Level. */
  loadDefault(): void {
    this.agentSession.replace()
    this.write(() => this.store.getState().loadScene())
  }

  /** Replace entire scene (undoable via Zundo). */
  setScene(
    nodes: Record<AnyNodeId, AnyNode>,
    rootNodeIds: AnyNodeId[],
    extra?: SetSceneExtra,
  ): void {
    this.agentSession.replace()
    // The store takes its own copy: a detached scene freezes what it holds.
    const owned = structuredClone(materialize({ nodes, rootNodeIds, extra }))
    this.write(() => this.store.getState().setScene(owned.nodes, owned.rootNodeIds, owned.extra))
  }

  /** Full snapshot for export, including collections and the material palette. */
  exportJSON(): SceneGraph & { collections: Record<string, unknown> } {
    const state = this.store.getState()
    const reader = this.runtime.reader()
    // Everything exported is read through the reader: materials and the plugin list included.
    const materials = Object.fromEntries(
      reader.query({ entity: 'material' }).map((material) => [material.id, material]),
    )
    const installedPlugins = reader.installedPlugins()
    // Deep-clone so callers can't mutate store state directly.
    return JSON.parse(
      JSON.stringify({
        nodes: reader.nodes,
        rootNodeIds: this.getRootNodeIds(),
        collections: reader.collections ?? {},
        materials,
        ...(state.hasExplicitPluginInstallState || installedPlugins.length > 0
          ? { installedPlugins }
          : {}),
      }),
    )
  }

  /**
   * Import. Accepts either a JSON string or a parsed SceneGraph object.
   * Throws on invalid JSON, unexpected shape, or prototype-polluting keys.
   */
  loadJSON(json: string | SceneGraph): void {
    let parsed: unknown
    if (typeof json === 'string') {
      try {
        parsed = JSON.parse(json)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throw new Error(`invalid JSON: ${msg}`)
      }
    } else {
      parsed = json
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('invalid scene: expected object with {nodes, rootNodeIds}')
    }

    const obj = parsed as Record<string, unknown>
    const nodes = obj.nodes
    const rootNodeIds = obj.rootNodeIds

    if (!nodes || typeof nodes !== 'object' || Array.isArray(nodes)) {
      throw new Error('invalid scene: `nodes` must be an object')
    }
    if (!Array.isArray(rootNodeIds)) {
      throw new Error('invalid scene: `rootNodeIds` must be an array')
    }

    // Reject prototype-polluting keys as top-level `nodes` keys.
    const BANNED = new Set(['__proto__', 'constructor', 'prototype'])
    for (const key of Object.keys(nodes)) {
      if (BANNED.has(key)) {
        throw new Error(`invalid scene: forbidden key "${key}" in nodes`)
      }
    }

    const record = (value: unknown) =>
      value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
    const collections = record(obj.collections) as NonNullable<SetSceneExtra>['collections']
    const materials = record(obj.materials) as NonNullable<SetSceneExtra>['materials']
    const installedPlugins = Array.isArray(obj.installedPlugins)
      ? obj.installedPlugins.filter((id): id is string => typeof id === 'string')
      : undefined

    // One `setScene` call rather than a follow-up `setInstalledPlugins`:
    // `setScene` overwrites `collections` and `materials` with `{}` whenever
    // they aren't in the `extra` bag, so anything applied afterwards is lost.
    // It also marks every node dirty at the end, and `markDirty` skips nodes
    // whose plugin isn't installed — so plugin state has to be in place by
    // then or plugin-owned nodes never get validated.
    this.setScene(nodes as Record<AnyNodeId, AnyNode>, rootNodeIds as AnyNodeId[], {
      ...(collections && { collections }),
      ...(materials && { materials }),
      ...(installedPlugins && { installedPlugins, hasExplicitPluginInstallState: true }),
    })
  }

  /** Read a single node, or `null` if not present. */
  getNode(id: AnyNodeId): AnyNode | null {
    return this.runtime.reader().get(id) ?? null
  }

  /** All nodes (a read-only view of the store's current nodes — do NOT mutate). */
  getNodes(): Record<AnyNodeId, AnyNode> {
    return this.runtime.reader().nodes as Record<AnyNodeId, AnyNode>
  }

  getCollections(): Record<CollectionId, Collection> {
    return this.runtime.reader().collections as Record<CollectionId, Collection>
  }

  getMaterials(): Record<SceneMaterialId, SceneMaterial> {
    return Object.fromEntries(
      this.runtime
        .reader()
        .query({ entity: 'material' })
        .map((material) => [material.id, material]),
    ) as Record<SceneMaterialId, SceneMaterial>
  }

  setCollections(collections: Record<CollectionId, Collection>): void {
    this.write(() => {
      if (this.store.getState().readOnly) return
      this.store.setState({ collections: structuredClone(materialize(collections)) })
    })
  }

  /** Root node IDs. */
  getRootNodeIds(): AnyNodeId[] {
    return this.runtime
      .reader()
      .query({ entity: 'root' })
      .map((node) => node.id as AnyNodeId)
  }

  /**
   * Resolve children via the flat `nodes` dict. Uses THREE fallbacks because
   * the codebase's parent-tracking is not uniform:
   *
   * 1. `node.parentId === parentId` (normal case post-store-mutation).
   * 2. Parent has `children: string[]` of IDs (building, level, wall, ...).
   * 3. Parent has `children: Array<node-object>` (the SiteNode quirk — see
   *    PLAN §0.7). We resolve each object to its flat-dict entry by `id`.
   *
   * The `loadScene()` default assembler skips the store mutation paths so the
   * default site/building/level tree has `parentId === null` on every node —
   * only the `children` arrays reflect the hierarchy.
   *
   * Results are de-duplicated by id, in flat-dict iteration order.
   */
  getChildren(parentId: AnyNodeId): AnyNode[] {
    const nodes = this.getNodes()
    const out: AnyNode[] = []
    const seen = new Set<AnyNodeId>()

    // Strategy 1: parentId scan.
    for (const node of Object.values(nodes)) {
      if (node.parentId === parentId && !seen.has(node.id as AnyNodeId)) {
        seen.add(node.id as AnyNodeId)
        out.push(node)
      }
    }

    // Strategies 2 & 3: parent's own `children` field.
    const parent = nodes[parentId]
    if (parent && 'children' in parent && Array.isArray(parent.children)) {
      for (const child of parent.children as unknown[]) {
        let childId: string | null = null
        if (typeof child === 'string') childId = child
        else if (
          child &&
          typeof child === 'object' &&
          'id' in (child as Record<string, unknown>) &&
          typeof (child as { id: unknown }).id === 'string'
        ) {
          childId = (child as { id: string }).id
        }
        if (!childId) continue
        const childNode = nodes[childId as AnyNodeId]
        if (!childNode) continue
        if (seen.has(childNode.id as AnyNodeId)) continue
        seen.add(childNode.id as AnyNodeId)
        out.push(childNode)
      }
    }

    return out
  }

  /**
   * Walk up `parentId` chain; returns `[self, parent, grandparent, ...]`.
   *
   * Falls back to reverse-scanning `children` arrays when `parentId` is
   * unset (see the default-scene quirk documented on `getChildren`).
   */
  getAncestry(id: AnyNodeId): AnyNode[] {
    const nodes = this.getNodes()
    const out: AnyNode[] = []
    let current: AnyNode | undefined = nodes[id]
    const seen = new Set<AnyNodeId>()
    while (current && !seen.has(current.id)) {
      seen.add(current.id)
      out.push(current)
      const pid = current.parentId as AnyNodeId | null | undefined
      if (pid && nodes[pid]) {
        current = nodes[pid]
        continue
      }
      // Fallback: scan for any node whose `children` includes this id.
      const fallback = this._findParentByChildrenScan(current.id as AnyNodeId)
      if (!fallback) break
      current = fallback
    }
    return out
  }

  /** Find all nodes matching the given filters (all filters ANDed). */
  findNodes(filter: {
    type?: AnyNodeType
    parentId?: AnyNodeId | null
    levelId?: AnyNodeId
  }): AnyNode[] {
    // A query, so a detached scene records the selection rather than a read of every node.
    const selected = this.runtime.reader().query({
      entity: 'node',
      where: {
        ...(filter.type !== undefined && { type: filter.type }),
        ...(filter.parentId !== undefined && { parentId: filter.parentId }),
      },
    })
    const out: AnyNode[] = []
    for (const node of selected) {
      if (filter.levelId !== undefined) {
        if (this.resolveLevelId(node.id as AnyNodeId) !== filter.levelId) continue
      }
      out.push(node)
    }
    return out
  }

  /** Resolve the level-ancestor of a node, or `null` if none in the chain. */
  resolveLevelId(id: AnyNodeId): AnyNodeId | null {
    const ancestry = this.getAncestry(id)
    for (const node of ancestry) {
      if (node.type === 'level') return node.id as AnyNodeId
    }
    return null
  }

  /**
   * Create a node. Caller must pass an already-parsed `AnyNode` (with a valid
   * `id`, generated by the schema default if they did `XxxNode.parse({...})`).
   * Returns the generated id.
   */
  createNode(input: AnyNode, parentId?: AnyNodeId): AnyNodeId {
    // The store takes its own copy: a detached scene freezes what it holds.
    const node = structuredClone(materialize(input))
    this.write(() => {
      const before = this.store.getState().nodes
      assertDerivedNodeWrites(this.getNodes(), {
        create: [{ node: parentId ? { ...node, parentId } : node }],
      })
      runAsSettledSceneStep(this.store, () => {
        this.store.getState().createNode(node, parentId)
        declareActionDependencies(this.runtime, before, { create: [{ node, parentId }] })
        this.runtime.reconcile(before)
      })
    })
    return node.id as AnyNodeId
  }

  /** Update node fields (shallow merge through the core store). */
  updateNode(id: AnyNodeId, input: Partial<AnyNode>): void {
    const data = structuredClone(materialize(input))
    if (!this.getNode(id)) {
      throw new Error(`node not found: ${id}`)
    }
    this.write(() => {
      const before = this.store.getState().nodes
      assertDerivedNodeWrites(this.getNodes(), { update: [{ id, data }] })
      runAsSettledSceneStep(this.store, () => {
        this.store.getState().updateNode(id, data)
        declareActionDependencies(this.runtime, before, { update: [{ id, data }] })
        this.runtime.reconcile(before)
      })
    })
  }

  /**
   * Delete a node. If the node has children and `cascade === false`, throws.
   * If `cascade` is true (or undefined and no children), delegates to the core
   * action which already recursively removes descendants.
   *
   * Returns the list of ids actually removed from the scene.
   */
  deleteNode(id: AnyNodeId, cascade = false): string[] {
    const nodes = this.getNodes()
    const node = nodes[id]
    if (!node) {
      throw new Error(`node not found: ${id}`)
    }

    const descendants = this._collectDescendants(id)
    if (!cascade && descendants.length > 1) {
      throw new Error(
        `node has ${descendants.length - 1} descendant(s); pass cascade: true to delete recursively`,
      )
    }

    const beforeNodes = this.store.getState().nodes
    const before = new Set(Object.keys(beforeNodes))
    this.write(() =>
      runAsSettledSceneStep(this.store, () => {
        this.store.getState().deleteNode(id)
        declareActionDependencies(this.runtime, beforeNodes, { delete: [id] })
        this.runtime.reconcile(beforeNodes)
      }),
    )
    const afterNodes = this.store.getState().nodes
    const removed: string[] = []
    for (const prevId of before) {
      if (!(prevId in afterNodes)) removed.push(prevId)
    }
    return removed
  }

  /**
   * Atomic multi-op patch. Validates EVERY patch first (dry run); only if all
   * pass does it apply through the store actions in one history step. Throws on
   * validation failure without mutating state.
   */
  applyPatch(patches: Patch[]): {
    appliedOps: number
    deletedIds: AnyNodeId[]
    createdIds: AnyNodeId[]
  } {
    return this.write(() => this.applyPatchInScope(structuredClone(materialize(patches))))
  }

  private applyPatchInScope(patches: Patch[]): {
    appliedOps: number
    deletedIds: AnyNodeId[]
    createdIds: AnyNodeId[]
  } {
    const nodes = this.getNodes()
    const beforeNodes = this.store.getState().nodes
    if (this.store.getState().readOnly) throw new Error('scene_read_only')

    // Track synthesized state as we dry-run so later ops can reference
    // earlier-created ids and reflect earlier-deleted ids. Existence is read
    // id by id: enumerating the scene would read every node of a detached one.
    const simCreated = new Set<string>()
    const simDeleted = new Set<string>()
    const simAvailable = (id: string) =>
      simCreated.has(id) || (!simDeleted.has(id) && nodes[id as AnyNodeId] !== undefined)
    // Parsed create nodes keyed by patch index — so the apply phase can use the
    // Zod-normalised copy (which has a generated id if the caller omitted one)
    // instead of the unparsed input.
    const parsedCreateNodes = new Map<number, AnyNode>()
    const materialUpserts = new Map<string, SceneMaterial>()

    for (let i = 0; i < patches.length; i++) {
      const p = patches[i]
      if (!p) throw new Error(`invalid patch: patches[${i}] is undefined`)
      if (p.op === 'upsert_material') {
        const parsed = SceneMaterial.safeParse(p.material)
        if (!parsed.success)
          throw new Error(
            `invalid patch: patches[${i}] material failed schema: ${parsed.error.message}`,
          )
        materialUpserts.set(parsed.data.id, parsed.data)
      } else if (p.op === 'create') {
        const res = parseNode(p.node)
        if (!res.success) {
          throw new Error(
            `invalid patch: patches[${i}] create node failed schema: ${res.error.message}`,
          )
        }
        if (p.parentId !== undefined && !simAvailable(p.parentId)) {
          throw new Error(`invalid patch: patches[${i}] create parentId "${p.parentId}" not found`)
        }
        parsedCreateNodes.set(i, p.parentId ? { ...res.data, parentId: p.parentId } : res.data)
        simCreated.add(res.data.id)
      } else if (p.op === 'update') {
        if (!simAvailable(p.id) || simDeleted.has(p.id)) {
          throw new Error(`invalid patch: patches[${i}] update id "${p.id}" not found`)
        }
        if (!p.data || typeof p.data !== 'object') {
          throw new Error(`invalid patch: patches[${i}] update data is not an object`)
        }
      } else if (p.op === 'delete') {
        if (!simAvailable(p.id) || simDeleted.has(p.id)) {
          throw new Error(`invalid patch: patches[${i}] delete id "${p.id}" not found`)
        }
        if (p.cascade === false) {
          // Only inspect the current store state — we don't simulate
          // descendant additions during dry-run, because that would require
          // building a full shadow tree. This matches the semantics of the
          // single-op deleteNode guard.
          const desc = this._collectDescendants(p.id)
          if (desc.length > 1) {
            throw new Error(
              `invalid patch: patches[${i}] delete "${p.id}" has descendants; pass cascade: true`,
            )
          }
        }
        simCreated.delete(p.id)
        simDeleted.add(p.id)
      } else {
        throw new Error(`invalid patch: patches[${i}] unknown op`)
      }
    }

    // Derived construction is refused BEFORE anything is applied, so a patch
    // that tries to author a floor plate or an auto ceiling leaves the scene
    // untouched like any other invalid patch.
    assertDerivedNodeWrites(nodes, {
      create: [...parsedCreateNodes.values()].map((node) => ({ node })),
      update: patches.flatMap((patch) =>
        patch.op === 'update' ? [{ id: patch.id, data: patch.data }] : [],
      ),
    })

    const createOps = new Map<AnyNodeId, { node: AnyNode; parentId?: AnyNodeId }>()
    const updateOps = new Map<AnyNodeId, Partial<AnyNode>>()
    const deleteIds = new Set<AnyNodeId>()
    for (const [index, patch] of patches.entries()) {
      if (patch.op === 'create') {
        const parsed = parsedCreateNodes.get(index)!
        const node = { ...parsed, parentId: patch.parentId ?? parsed.parentId } as AnyNode
        createOps.set(node.id, { node, parentId: patch.parentId })
        deleteIds.delete(node.id)
      } else if (patch.op === 'update') {
        const created = createOps.get(patch.id)
        if (created) {
          created.node = { ...created.node, ...patch.data } as AnyNode
          if (patch.data.parentId !== undefined) created.parentId = patch.data.parentId as AnyNodeId
        } else
          updateOps.set(patch.id, { ...updateOps.get(patch.id), ...patch.data } as Partial<AnyNode>)
      } else if (patch.op === 'delete') {
        deleteIds.add(patch.id)
        createOps.delete(patch.id)
        updateOps.delete(patch.id)
      }
    }
    // Plan the entire deletion selection before applying anything. Interleaved
    // update operations must not turn an all-boundaries deletion into balconies.
    // Only a deletion plans: the planner reads the whole scene for what the
    // deleted nodes hold.
    const planned = structureChangeBatch(
      deleteIds.size
        ? planWallDeletion(nodes, {
            nodeIds: [...deleteIds],
            nextNodes: patchedNodes(nodes, createOps, updateOps, deleteIds),
            mintId: generateId,
          }).changes
        : [],
    )
    // What was asked for, before the deletion planner adds its own writes.
    const requested = {
      create: [...createOps.values()],
      update: [...updateOps].map(([id, data]) => ({ id, data })),
      delete: [...deleteIds],
    }
    for (const { id, data } of planned.update)
      updateOps.set(id, { ...updateOps.get(id), ...data } as Partial<AnyNode>)
    runAsSettledSceneStep(this.store, () => {
      pauseSpaceDetection()
      try {
        for (const material of materialUpserts.values())
          this.store.getState().addSceneMaterial(material)
        this.store.getState().createNodes([...createOps.values(), ...planned.create])
        this.store.getState().updateNodes([...updateOps].map(([id, data]) => ({ id, data })))
        this.store.getState().deleteNodes(planned.delete)
      } finally {
        resumeSpaceDetection()
      }
      declareActionDependencies(this.runtime, beforeNodes, requested)
      this.runtime.reconcile(beforeNodes)
    })
    const postNodes = this.store.getState().nodes
    const createdIds = Object.keys(postNodes).filter(
      (id) => !beforeNodes[id as AnyNodeId],
    ) as AnyNodeId[]

    // Compute actual deleted ids by diffing pre/post snapshots.
    const deletedIds: AnyNodeId[] = []
    for (const prevId of Object.keys(beforeNodes)) {
      if (!(prevId in postNodes)) deletedIds.push(prevId as AnyNodeId)
    }

    return {
      appliedOps: patches.length,
      deletedIds,
      createdIds,
    }
  }

  /**
   * Preview what deleting `ids` does to `scene` with this bridge's semantics
   * (core's store planner), without committing or minting default gutters.
   * The apply_patch guard runs its dry run through this.
   */
  planDeletion(scene: NodeDeletionScene, ids: AnyNodeId[]): NodeDeletionPlan {
    return planNodeDeletion(scene, ids, { mintDefaults: false })
  }

  /**
   * Derive this scene's construction the way the browser's commit subscriber
   * does: one pass of the shared kernel writes the room zones, the auto
   * ceilings, the wall side classification and the floor plates.
   *
   * The headless bridge has no space-detection subscriber, so the semantic
   * tools that state room intent call this to materialise the construction
   * they report. Writes are history-paused, so undo returns to the state
   * before the triggering tool call rather than stranding derived nodes.
   */
  deriveStructure(levelIds?: AnyNodeId[]): { createdIds: AnyNodeId[]; deletedIds: AnyNodeId[] } {
    return this.write(() =>
      runAsSettledSceneStep(this.store, () => this.deriveStructureInScope(levelIds)),
    )
  }

  private deriveStructureInScope(levelIds?: AnyNodeId[]): {
    createdIds: AnyNodeId[]
    deletedIds: AnyNodeId[]
  } {
    pauseSceneHistory(this.store)
    try {
      // The kernel reads through the runtime's reader; its writes go to the store.
      const reading = {
        getState: () => ({ ...this.store.getState(), nodes: this.getNodes() }),
      }
      const patches = applyStructureReconciliation(reading, {
        levelIds,
        mintId: (kind) => generateId(kind),
      })
      return {
        createdIds: patches.flatMap((patch) =>
          patch.op === 'create' ? [patch.node.id as AnyNodeId] : [],
        ),
        deletedIds: patches.flatMap((patch) => (patch.op === 'delete' ? [patch.id] : [])),
      }
    } finally {
      resumeSceneHistory(this.store)
    }
  }

  /** Undo. Returns the number of steps actually undone. */
  undo(steps = 1): number {
    return this.write(() => {
      const before = this.store.temporal.getState().pastStates.length
      this.store.temporal.getState().undo(steps)
      return Math.max(0, before - this.store.temporal.getState().pastStates.length)
    })
  }

  /** Redo. Returns the number of steps actually redone. */
  redo(steps = 1): number {
    return this.write(() => {
      const before = this.store.temporal.getState().futureStates.length
      this.store.temporal.getState().redo(steps)
      return Math.max(0, before - this.store.temporal.getState().futureStates.length)
    })
  }

  /**
   * Zod-validate every node in the scene. Reports one error per failed node,
   * concatenating Zod issue paths.
   */
  validateScene(): ValidationResult {
    const errors: ValidationError[] = []
    const warnings: ValidationError[] = []
    const nodes = this.getNodes()
    for (const [id, node] of Object.entries(nodes)) {
      if (node.type === 'site' && node.visible === false) {
        warnings.push({ nodeId: id, path: 'visible', message: HIDDEN_SITE_NOTE })
      }
      const res = AnyNodeSchema.safeParse(node)
      if (res.success) continue
      for (const issue of res.error.issues) {
        errors.push({
          nodeId: id,
          path: issue.path.join('.'),
          message: issue.message,
        })
      }
    }
    return { valid: errors.length === 0, errors, warnings }
  }

  /**
   * Drain the dirtyNodes set. Returns the ids that were present. No-op for
   * renderer (there is no renderer in MCP mode); useful for observability.
   */
  flushDirty(): string[] {
    const state = this.store.getState()
    const ids = Array.from(state.dirtyNodes)
    for (const id of ids) {
      state.clearDirty(id as AnyNodeId)
    }
    return ids
  }

  /** Current temporal history pointers. */
  getHistory(): { pastCount: number; futureCount: number } {
    const t = this.store.temporal.getState()
    return {
      pastCount: t.pastStates.length,
      futureCount: t.futureStates.length,
    }
  }

  /** Clear the temporal undo/redo history. */
  clearHistory(): void {
    this.store.temporal.getState().clear()
  }

  /** Runs `run` in the scene's scope: an operation planned here mints the runtime's ids. */
  runInScene<T>(run: () => T): T {
    return this.write(run)
  }

  runAsSingleHistoryStep<T>(run: () => T): T {
    return this.write(() => runAsSettledSceneStep(this.store, run))
  }

  // ---- internal helpers ----

  /**
   * Return the node whose `children` array (string or object form) contains
   * the given id, or null if none. Used as a fallback when `parentId` is
   * missing on a node.
   */
  private _findParentByChildrenScan(id: AnyNodeId): AnyNode | null {
    const nodes = this.getNodes()
    for (const candidate of Object.values(nodes)) {
      if (!('children' in candidate && Array.isArray(candidate.children))) continue
      for (const child of candidate.children as unknown[]) {
        let childId: string | null = null
        if (typeof child === 'string') childId = child
        else if (
          child &&
          typeof child === 'object' &&
          'id' in (child as Record<string, unknown>) &&
          typeof (child as { id: unknown }).id === 'string'
        ) {
          childId = (child as { id: string }).id
        }
        if (childId === id) return candidate
      }
    }
    return null
  }

  /**
   * Collect ids of a node and all its descendants. Uses the same combined
   * strategy as `getChildren` (parentId scan + children-array walk) so that
   * the SiteNode quirk and the default-scene parentId-unset case both work.
   */
  private _collectDescendants(id: AnyNodeId): AnyNodeId[] {
    const nodes = this.getNodes()
    if (!nodes[id]) return []
    const out: AnyNodeId[] = []
    const stack: AnyNodeId[] = [id]
    const seen = new Set<AnyNodeId>()
    // Precompute parent → child[] index from parentId only. `children` arrays
    // are consulted on-the-fly via getChildren.
    while (stack.length > 0) {
      const curr = stack.pop()!
      if (seen.has(curr)) continue
      seen.add(curr)
      out.push(curr)
      const children = this.getChildren(curr)
      for (const c of children) stack.push(c.id as AnyNodeId)
    }
    return out
  }
}

/** The scene as a patch leaves it, for the deletion planner. */
function patchedNodes(
  nodes: Record<AnyNodeId, AnyNode>,
  creates: ReadonlyMap<AnyNodeId, { node: AnyNode }>,
  updates: ReadonlyMap<AnyNodeId, Partial<AnyNode>>,
  deletes: ReadonlySet<AnyNodeId>,
): Record<AnyNodeId, AnyNode> {
  const next = { ...nodes }
  for (const [id, data] of updates) next[id] = { ...next[id], ...data } as AnyNode
  for (const [id, { node }] of creates) next[id] = node
  for (const id of deletes) delete next[id]
  return next
}
