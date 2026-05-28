import type { AnyNode, AnyNodeId } from '../schema/types'
import { pauseSceneHistory, resumeSceneHistory } from '../store/history-control'
import { buildSubtreeSnapshot, materializeSubtree as runMaterializeSubtree } from './subtree'
import type { SceneApi } from './types'

/**
 * Minimal store shape this module depends on.
 *
 * Decoupled from `useScene` directly so the production singleton and tests can
 * share one factory. The full store implements a superset.
 */
export type SceneStoreLike = {
  getState: () => {
    nodes: Record<AnyNodeId, AnyNode>
    rootNodeIds: AnyNodeId[]
    dirtyNodes: Set<AnyNodeId>
    createNode: (node: AnyNode, parentId?: AnyNodeId) => void
    createNodes?: (ops: { node: AnyNode; parentId?: AnyNodeId }[]) => void
    updateNode: (id: AnyNodeId, data: Partial<AnyNode>) => void
    deleteNode: (id: AnyNodeId) => void
    markDirty: (id: AnyNodeId) => void
  }
  temporal: {
    getState: () => { pause: () => void; resume: () => void }
  }
}

/**
 * Creates a {@link SceneApi} backed by a store.
 *
 * Snapshot semantics:
 * - `pauseHistory()` starts a copy-on-write window. The first time `update`,
 *   `upsert`, or `delete` touches a node id, the pre-change value is captured.
 * - `restore(id)` and `restoreAll()` apply the captured value back. Either is
 *   safe to call only while a pause window is active.
 * - `resumeHistory()` drops the snapshot.
 *
 * Snapshots are lazy and bounded by the number of nodes touched during the
 * pause window — never an upfront clone of the entire scene.
 */
export function createSceneApi(store: SceneStoreLike): SceneApi {
  let snapshot: Map<AnyNodeId, AnyNode | null> | null = null

  function captureIfNeeded(id: AnyNodeId): void {
    if (!snapshot || snapshot.has(id)) return
    const existing = store.getState().nodes[id]
    snapshot.set(id, existing ?? null)
  }

  return {
    get<N extends AnyNode = AnyNode>(id: AnyNodeId): N | undefined {
      return store.getState().nodes[id] as N | undefined
    },

    nodes() {
      return store.getState().nodes
    },

    update(id, patch) {
      captureIfNeeded(id)
      store.getState().updateNode(id, patch)
    },

    upsert(node, parentId) {
      captureIfNeeded(node.id)
      store.getState().createNode(node, parentId)
      return node.id
    },

    delete(id) {
      captureIfNeeded(id)
      store.getState().deleteNode(id)
    },

    restore(id) {
      if (!snapshot) return
      const original = snapshot.get(id)
      if (original === undefined) return
      const current = store.getState().nodes[id]
      if (original === null) {
        if (current) store.getState().deleteNode(id)
      } else if (!current) {
        store.getState().createNode(original)
      } else {
        store.getState().updateNode(id, original)
      }
    },

    restoreAll() {
      if (!snapshot) return
      for (const id of snapshot.keys()) {
        this.restore(id)
      }
    },

    markDirty(id) {
      store.getState().markDirty(id)
    },

    pauseHistory() {
      pauseSceneHistory(store)
      if (!snapshot) snapshot = new Map()
    },

    resumeHistory() {
      resumeSceneHistory(store)
      snapshot = null
    },

    getSubtreeSnapshot(rootId) {
      return buildSubtreeSnapshot(store.getState().nodes, rootId)
    },

    materializeSubtree(subtree, position, parentId) {
      const { rootId, nodes } = runMaterializeSubtree(subtree, position)
      const state = store.getState()
      // Prefer batched `createNodes` when the store exposes it — keeps
      // children-array writes and dirty-marking in one tick, identical
      // to how `applyNodeChanges` lands a multi-node paste. The
      // minimal `SceneStoreLike` does not require it, so the test
      // store can fall back to per-node `createNode` calls.
      const root = nodes[0]
      if (!root) return null
      const ops: { node: AnyNode; parentId?: AnyNodeId }[] = []
      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i]!
        if (i === 0) {
          ops.push(parentId ? { node, parentId } : { node })
        } else {
          ops.push({ node })
        }
      }
      const createNodes = state.createNodes
      if (createNodes) {
        createNodes(ops)
      } else {
        for (const op of ops) {
          state.createNode(op.node, op.parentId)
        }
      }
      return rootId
    },
  }
}
