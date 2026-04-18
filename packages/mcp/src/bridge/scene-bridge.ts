// Side-effect import MUST come first: installs RAF polyfill before core loads.
import './node-shims'

import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import type { AnyNode } from '@pascal-app/core/schema'
import { type AnyNodeId, AnyNode as AnyNodeSchema, type AnyNodeType } from '@pascal-app/core/schema'
// Per PLAN §0.6: `useScene` is the DEFAULT export from `@pascal-app/core/store`.
import useScene from '@pascal-app/core/store'

export type ValidationError = { nodeId: string; path: string; message: string }
export type ValidationResult = { valid: boolean; errors: ValidationError[] }

export type CreatePatch = { op: 'create'; node: AnyNode; parentId?: AnyNodeId }
export type UpdatePatch = { op: 'update'; id: AnyNodeId; data: Partial<AnyNode> }
export type DeletePatch = { op: 'delete'; id: AnyNodeId; cascade?: boolean }
export type Patch = CreatePatch | UpdatePatch | DeletePatch

/**
 * Headless bridge to the `@pascal-app/core` Zustand store.
 *
 * All mutation flows through the real core store so undo/redo works via Zundo.
 * No renderer is attached; `dirtyNodes` accumulates and can be drained via
 * `flushDirty()` for observability.
 */
export class SceneBridge {
  /** Load initial state; if empty, creates default Site → Building → Level. */
  loadDefault(): void {
    useScene.getState().loadScene()
  }

  /** Replace entire scene (undoable via Zundo). */
  setScene(nodes: Record<AnyNodeId, AnyNode>, rootNodeIds: AnyNodeId[]): void {
    useScene.getState().setScene(nodes, rootNodeIds)
  }

  /** Full snapshot for export, including collections. */
  exportJSON(): SceneGraph & { collections: Record<string, unknown> } {
    const state = useScene.getState()
    // Deep-clone so callers can't mutate store state directly.
    return JSON.parse(
      JSON.stringify({
        nodes: state.nodes,
        rootNodeIds: state.rootNodeIds,
        collections: state.collections ?? {},
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

    this.setScene(nodes as Record<AnyNodeId, AnyNode>, rootNodeIds as AnyNodeId[])
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
    useScene.getState().createNode(node, parentId)
    return node.id as AnyNodeId
  }

  /** Update node fields (shallow merge through the core store). */
  updateNode(id: AnyNodeId, data: Partial<AnyNode>): void {
    if (!useScene.getState().nodes[id]) {
      throw new Error(`node not found: ${id}`)
    }
    useScene.getState().updateNode(id, data)
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
    useScene.getState().deleteNode(id)
    const afterNodes = useScene.getState().nodes
    const removed: string[] = []
    for (const prevId of before) {
      if (!(prevId in afterNodes)) removed.push(prevId)
    }
    return removed
  }

  /**
   * Atomic multi-op patch. Validates EVERY patch first (dry run); only if all
   * pass does it apply in a single batch via `createNodes` / `updateNodes` /
   * `deleteNodes`. Throws on any validation failure without mutating state.
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
        const res = AnyNodeSchema.safeParse(p.node)
        if (!res.success) {
          throw new Error(
            `invalid patch: patches[${i}] create node failed schema: ${res.error.message}`,
          )
        }
        if (p.parentId !== undefined && !simAvailable.has(p.parentId)) {
          throw new Error(`invalid patch: patches[${i}] create parentId "${p.parentId}" not found`)
        }
        parsedCreateNodes.set(i, res.data)
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

    // Dry-run succeeded — apply in order, batching adjacent ops of the same
    // op type so Zundo groups them tightly.
    const createOps: { node: AnyNode; parentId?: AnyNodeId }[] = []
    const updateOps: { id: AnyNodeId; data: Partial<AnyNode> }[] = []
    const deleteIds: AnyNodeId[] = []
    const createdIds: AnyNodeId[] = []

    // Simple approach: queue by type, flush in original order by walking
    // patches and interleaving flushes when the op type changes, so ids
    // created/updated/deleted stay temporally consistent.
    const flush = (kind: 'create' | 'update' | 'delete' | 'none') => {
      if (kind !== 'create' && createOps.length > 0) {
        useScene.getState().createNodes(createOps)
        createOps.length = 0
      }
      if (kind !== 'update' && updateOps.length > 0) {
        useScene.getState().updateNodes(updateOps)
        updateOps.length = 0
      }
      if (kind !== 'delete' && deleteIds.length > 0) {
        useScene.getState().deleteNodes(deleteIds)
        deleteIds.length = 0
      }
    }

    for (let i = 0; i < patches.length; i++) {
      const p = patches[i]!
      if (p.op === 'create') {
        flush('create')
        const parsedNode = parsedCreateNodes.get(i)!
        createOps.push({ node: parsedNode, parentId: p.parentId })
        createdIds.push(parsedNode.id as AnyNodeId)
      } else if (p.op === 'update') {
        flush('update')
        updateOps.push({ id: p.id, data: p.data })
      } else {
        flush('delete')
        deleteIds.push(p.id)
      }
    }
    flush('none')

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
    const nodes = useScene.getState().nodes
    for (const [id, node] of Object.entries(nodes)) {
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
    return { valid: errors.length === 0, errors }
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

  // ---- internal helpers ----

  /**
   * Return the node whose `children` array (string or object form) contains
   * the given id, or null if none. Used as a fallback when `parentId` is
   * missing on a node.
   */
  private _findParentByChildrenScan(id: AnyNodeId): AnyNode | null {
    const nodes = useScene.getState().nodes
    for (const candidate of Object.values(nodes)) {
      if (!('children' in candidate) || !Array.isArray(candidate.children)) continue
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
