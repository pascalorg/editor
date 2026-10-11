// Side-effect import MUST come first: installs RAF polyfill before core loads.
import './node-shims'
import {
  adjacentLevelId,
  applyStructureReconciliation,
  assertDerivedNodeWrites,
  changedStairOpeningOwners,
  floorOpeningTargets,
  HIDDEN_SITE_NOTE,
  type NodeDeletionPlan,
  type NodeDeletionScene,
  pauseSceneHistory,
  pauseSpaceDetection,
  planNodeDeletion,
  planOwnedFloorOpenings,
  planWallDeletion,
  resumeSceneHistory,
  resumeSpaceDetection,
  runAsSingleSceneHistoryStep,
  stairDeckLevelId,
  structureChangeBatch,
} from '@pascal-app/core'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import type { AnyNode, Collection, CollectionId } from '@pascal-app/core/schema'
import {
  type AnyNodeId,
  AnyNode as AnyNodeSchema,
  type AnyNodeType,
  generateId,
  parseNode,
} from '@pascal-app/core/schema'
// Per PLAN §0.6: `useScene` is the DEFAULT export from `@pascal-app/core/store`.
import useScene from '@pascal-app/core/store'
import type { SceneMeta } from '../storage/types'

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
export type Patch = CreatePatch | UpdatePatch | DeletePatch
export type ActiveSceneMeta = Pick<
  SceneMeta,
  'id' | 'name' | 'projectId' | 'ownerId' | 'thumbnailUrl' | 'version' | 'graphHash'
>

/** The `extra` bag `setScene` accepts — collections, materials, plugin state. */
type SetSceneExtra = Parameters<ReturnType<typeof useScene.getState>['setScene']>[2]

/**
 * Headless bridge to the `@pascal-app/core` Zustand store.
 *
 * All mutation flows through the real core store so undo/redo works via Zundo.
 * No renderer is attached; `dirtyNodes` accumulates and can be drained via
 * `flushDirty()` for observability.
 */
export class SceneBridge {
  private activeScene: ActiveSceneMeta | null = null

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
    useScene.getState().loadScene()
  }

  /** Replace entire scene (undoable via Zundo). */
  setScene(
    nodes: Record<AnyNodeId, AnyNode>,
    rootNodeIds: AnyNodeId[],
    extra?: SetSceneExtra,
  ): void {
    useScene.getState().setScene(nodes, rootNodeIds, extra)
  }

  /** Full snapshot for export, including collections and the material palette. */
  exportJSON(): SceneGraph & { collections: Record<string, unknown> } {
    const state = useScene.getState()
    // Deep-clone so callers can't mutate store state directly.
    return JSON.parse(
      JSON.stringify({
        nodes: state.nodes,
        rootNodeIds: state.rootNodeIds,
        collections: state.collections ?? {},
        materials: state.materials ?? {},
        ...(state.hasExplicitPluginInstallState || state.installedPlugins.length > 0
          ? { installedPlugins: state.installedPlugins }
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
    const node = useScene.getState().nodes[id]
    return node ?? null
  }

  /** All nodes (live reference into the store — do NOT mutate). */
  getNodes(): Record<AnyNodeId, AnyNode> {
    return useScene.getState().nodes
  }

  getCollections(): Record<CollectionId, Collection> {
    return useScene.getState().collections
  }

  setCollections(collections: Record<CollectionId, Collection>): void {
    if (useScene.getState().readOnly) return
    useScene.setState({ collections })
  }

  /** Root node IDs. */
  getRootNodeIds(): AnyNodeId[] {
    return useScene.getState().rootNodeIds
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
    const nodes = useScene.getState().nodes
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
    const nodes = useScene.getState().nodes
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
    const nodes = useScene.getState().nodes
    const out: AnyNode[] = []
    for (const node of Object.values(nodes)) {
      if (filter.type !== undefined && node.type !== filter.type) continue
      if (filter.parentId !== undefined) {
        const np = (node.parentId ?? null) as AnyNodeId | null
        if (np !== filter.parentId) continue
      }
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
  createNode(node: AnyNode, parentId?: AnyNodeId): AnyNodeId {
    const before = useScene.getState().nodes
    assertDerivedNodeWrites(before, { create: [{ node: parentId ? { ...node, parentId } : node }] })
    runAsSingleSceneHistoryStep(useScene, () => {
      useScene.getState().createNode(node, parentId)
      this.reconcileDependentStructure(before)
    })
    return node.id as AnyNodeId
  }

  /** Update node fields (shallow merge through the core store). */
  updateNode(id: AnyNodeId, data: Partial<AnyNode>): void {
    if (!useScene.getState().nodes[id]) {
      throw new Error(`node not found: ${id}`)
    }
    const before = useScene.getState().nodes
    assertDerivedNodeWrites(before, { update: [{ id, data }] })
    runAsSingleSceneHistoryStep(useScene, () => {
      useScene.getState().updateNode(id, data)
      this.reconcileDependentStructure(before)
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
    const state = useScene.getState()
    const node = state.nodes[id]
    if (!node) {
      throw new Error(`node not found: ${id}`)
    }

    const descendants = this._collectDescendants(id)
    if (!cascade && descendants.length > 1) {
      throw new Error(
        `node has ${descendants.length - 1} descendant(s); pass cascade: true to delete recursively`,
      )
    }

    const before = new Set(Object.keys(state.nodes))
    const wallLevels = [
      ...new Set(
        descendants.flatMap((nodeId) => {
          const deleted = state.nodes[nodeId]
          return deleted?.type === 'wall' && deleted.parentId ? [deleted.parentId as AnyNodeId] : []
        }),
      ),
    ]
    runAsSingleSceneHistoryStep(useScene, () => {
      useScene.getState().deleteNode(id)
      if (wallLevels.length) this.deriveStructure(wallLevels)
      this.reconcileDependentStructure(state.nodes)
    })
    const afterNodes = useScene.getState().nodes
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
    const state = useScene.getState()
    const nodes = state.nodes

    // Track synthesized state as we dry-run so later ops can reference
    // earlier-created ids and reflect earlier-deleted ids.
    const simAvailable = new Set<string>(Object.keys(nodes))
    const simDeleted = new Set<string>()
    // Parsed create nodes keyed by patch index — so the apply phase can use the
    // Zod-normalised copy (which has a generated id if the caller omitted one)
    // instead of the unparsed input.
    const parsedCreateNodes = new Map<number, AnyNode>()

    for (let i = 0; i < patches.length; i++) {
      const p = patches[i]
      if (!p) throw new Error(`invalid patch: patches[${i}] is undefined`)
      if (p.op === 'create') {
        const res = parseNode(p.node)
        if (!res.success) {
          throw new Error(
            `invalid patch: patches[${i}] create node failed schema: ${res.error.message}`,
          )
        }
        if (p.parentId !== undefined && !simAvailable.has(p.parentId)) {
          throw new Error(`invalid patch: patches[${i}] create parentId "${p.parentId}" not found`)
        }
        parsedCreateNodes.set(i, p.parentId ? { ...res.data, parentId: p.parentId } : res.data)
        simAvailable.add(res.data.id)
      } else if (p.op === 'update') {
        if (!simAvailable.has(p.id) || simDeleted.has(p.id)) {
          throw new Error(`invalid patch: patches[${i}] update id "${p.id}" not found`)
        }
        if (!p.data || typeof p.data !== 'object') {
          throw new Error(`invalid patch: patches[${i}] update data is not an object`)
        }
      } else if (p.op === 'delete') {
        if (!simAvailable.has(p.id) || simDeleted.has(p.id)) {
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
        simAvailable.delete(p.id)
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
    const nextNodes = { ...nodes }
    for (const [index, patch] of patches.entries()) {
      if (patch.op === 'create') {
        const parsed = parsedCreateNodes.get(index)!
        const node = { ...parsed, parentId: patch.parentId ?? parsed.parentId } as AnyNode
        createOps.set(node.id, { node, parentId: patch.parentId })
        deleteIds.delete(node.id)
        nextNodes[node.id] = node
      } else if (patch.op === 'update') {
        nextNodes[patch.id] = { ...nextNodes[patch.id], ...patch.data } as AnyNode
        const created = createOps.get(patch.id)
        if (created) {
          created.node = nextNodes[patch.id]!
          if (patch.data.parentId !== undefined) created.parentId = patch.data.parentId as AnyNodeId
        } else
          updateOps.set(patch.id, { ...updateOps.get(patch.id), ...patch.data } as Partial<AnyNode>)
      } else {
        deleteIds.add(patch.id)
        createOps.delete(patch.id)
        updateOps.delete(patch.id)
        delete nextNodes[patch.id]
      }
    }
    // Plan the entire deletion selection before applying anything. Interleaved
    // update operations must not turn an all-boundaries deletion into balconies.
    const planned = structureChangeBatch(
      planWallDeletion(nodes, {
        nodeIds: [...deleteIds],
        nextNodes,
        mintId: generateId,
      }).changes,
    )
    for (const { id, data } of planned.update)
      updateOps.set(id, { ...updateOps.get(id), ...data } as Partial<AnyNode>)
    const wallLevels = [
      ...new Set(
        planned.delete.flatMap((id) => {
          const node = nodes[id]
          return node?.type === 'wall' && node.parentId ? [node.parentId as AnyNodeId] : []
        }),
      ),
    ]
    runAsSingleSceneHistoryStep(useScene, () => {
      pauseSpaceDetection()
      try {
        useScene.getState().createNodes([...createOps.values(), ...planned.create])
        useScene.getState().updateNodes([...updateOps].map(([id, data]) => ({ id, data })))
        useScene.getState().deleteNodes(planned.delete)
      } finally {
        resumeSpaceDetection()
      }
      if (wallLevels.length) this.deriveStructure(wallLevels)
      this.reconcileDependentStructure(nodes)
    })
    const createdIds = Object.keys(useScene.getState().nodes).filter(
      (id) => !nodes[id as AnyNodeId],
    ) as AnyNodeId[]

    // Compute actual deleted ids by diffing pre/post snapshots.
    const postNodes = useScene.getState().nodes
    const deletedIds: AnyNodeId[] = []
    for (const prevId of Object.keys(nodes)) {
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
    pauseSceneHistory(useScene)
    try {
      const patches = applyStructureReconciliation(useScene, {
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
      resumeSceneHistory(useScene)
    }
  }

  /** Undo. Returns the number of steps actually undone. */
  undo(steps = 1): number {
    const before = useScene.temporal.getState().pastStates.length
    useScene.temporal.getState().undo(steps)
    const after = useScene.temporal.getState().pastStates.length
    return Math.max(0, before - after)
  }

  /** Redo. Returns the number of steps actually redone. */
  redo(steps = 1): number {
    const before = useScene.temporal.getState().futureStates.length
    useScene.temporal.getState().redo(steps)
    const after = useScene.temporal.getState().futureStates.length
    return Math.max(0, before - after)
  }

  /**
   * Zod-validate every node in the scene. Reports one error per failed node,
   * concatenating Zod issue paths.
   */
  validateScene(): ValidationResult {
    const errors: ValidationError[] = []
    const warnings: ValidationError[] = []
    const nodes = useScene.getState().nodes
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
    const state = useScene.getState()
    const ids = Array.from(state.dirtyNodes)
    for (const id of ids) {
      state.clearDirty(id as AnyNodeId)
    }
    return ids
  }

  /** Current temporal history pointers. */
  getHistory(): { pastCount: number; futureCount: number } {
    const t = useScene.temporal.getState()
    return {
      pastCount: t.pastStates.length,
      futureCount: t.futureStates.length,
    }
  }

  /** Clear the temporal undo/redo history. */
  clearHistory(): void {
    useScene.temporal.getState().clear()
  }

  runAsSingleHistoryStep<T>(run: () => T): T {
    return runAsSingleSceneHistoryStep(useScene, run)
  }

  private reconcileDependentStructure(before: Record<string, AnyNode>): void {
    const currentNodes: Record<string, AnyNode> = this.getNodes()
    const authoredInputChanged = [
      ...new Set([...Object.keys(before), ...Object.keys(currentNodes)]),
    ].some((id) => {
      if (before[id] === currentNodes[id]) return false
      const type = (currentNodes[id] ?? before[id])?.type
      return (
        type === 'stair' ||
        type === 'stair-segment' ||
        type === 'elevator' ||
        type === 'level' ||
        type === 'building' ||
        type === 'slab' ||
        type === 'ceiling'
      )
    })
    if (authoredInputChanged) {
      const ownerIds = changedStairOpeningOwners(before, currentNodes)
      for (const node of [...Object.values(before), ...Object.values(currentNodes)]) {
        if (
          node.type === 'elevator' &&
          (before[node.id] !== currentNodes[node.id] ||
            Object.values(currentNodes).some(
              (level) => level.type === 'level' && before[level.id] !== level,
            ))
        )
          ownerIds.add(node.id)
      }
      const owned = planOwnedFloorOpenings(currentNodes, { ownerIds })
      if (owned.length) {
        pauseSpaceDetection()
        try {
          useScene.getState().applyNodeChanges(structureChangeBatch(owned))
        } finally {
          resumeSpaceDetection()
        }
      }
    }
    const current: Record<string, AnyNode> = this.getNodes()
    const levels = new Set<AnyNodeId>()
    for (const id of new Set([...Object.keys(before), ...Object.keys(current)])) {
      if (before[id] === current[id]) continue
      for (const nodes of [before, current]) {
        const level = stairDeckLevelId(nodes, nodes[id])
        if (level) levels.add(level as AnyNodeId)
        const node = nodes[id]
        if (node?.type === 'level') {
          levels.add(node.id as AnyNodeId)
          const lower = adjacentLevelId(nodes, node.id, -1)
          if (lower) levels.add(lower as AnyNodeId)
        }
        if (node?.type === 'stair')
          for (const opening of Object.values(nodes))
            if (opening.type === 'floor-opening' && opening.ownerId === node.id)
              for (const target of floorOpeningTargets(nodes, opening))
                levels.add(target.levelId as AnyNodeId)
        if (node?.type === 'floor-opening')
          for (const target of floorOpeningTargets(nodes, node))
            levels.add(target.levelId as AnyNodeId)
        if (node?.type === 'door' || node?.type === 'window') {
          const wall = nodes[node.parentId!]
          if (wall?.type === 'wall' && wall.parentId) levels.add(wall.parentId as AnyNodeId)
        } else if (
          (node?.type === 'zone' || node?.type === 'slab' || node?.type === 'wall') &&
          node.parentId
        ) {
          levels.add(node.parentId as AnyNodeId)
        }
      }
    }
    if (levels.size) this.deriveStructure([...levels])
  }

  // ---- internal helpers ----

  /**
   * Return the node whose `children` array (string or object form) contains
   * the given id, or null if none. Used as a fallback when `parentId` is
   * missing on a node.
   */
  private _findParentByChildrenScan(id: AnyNodeId): AnyNode | null {
    const nodes = useScene.getState().nodes
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
    const nodes = useScene.getState().nodes
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
