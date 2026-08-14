import type { AnyNode, AnyNodeId } from '../schema/types'
import {
  activeSceneCommitNodeIds,
  pauseSceneHistory,
  resumeSceneHistory,
} from '../store/history-control'
import {
  type CloneNodesIntoOptions,
  collectSubtree,
  cloneNodesInto as runCloneNodesInto,
} from './subtree'
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
    applyNodeChanges?: (changes: {
      create?: { node: AnyNode; parentId?: AnyNodeId }[]
      update?: { id: AnyNodeId; data: Partial<AnyNode> }[]
      delete?: AnyNodeId[]
    }) => void
    updateNode: (id: AnyNodeId, data: Partial<AnyNode>) => void
    deleteNode: (id: AnyNodeId) => void
    markDirty: (id: AnyNodeId) => void
  }
  subscribe?: (
    listener: (
      state: { nodes: Record<AnyNodeId, AnyNode> },
      previous: { nodes: Record<AnyNodeId, AnyNode> },
    ) => void,
  ) => () => void
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

    createMany(ops) {
      for (const op of ops) captureIfNeeded(op.node.id)
      const batch = store.getState().createNodes
      if (batch) batch(ops)
      else for (const op of ops) this.upsert(op.node, op.parentId)
    },

    applyChanges(changes) {
      for (const op of changes.create ?? []) captureIfNeeded(op.node.id)
      for (const op of changes.update ?? []) captureIfNeeded(op.id)
      for (const id of changes.delete ?? []) captureIfNeeded(id)
      const batch = store.getState().applyNodeChanges
      if (batch) {
        batch(changes)
        return
      }
      for (const op of changes.create ?? []) this.upsert(op.node, op.parentId)
      for (const op of changes.update ?? []) this.update(op.id, op.data)
      for (const id of changes.delete ?? []) this.delete(id)
    },

    subscribeNodes(listener) {
      return (
        store.subscribe?.((state, previous) => {
          if (state.nodes === previous.nodes) return
          const scopedIds = activeSceneCommitNodeIds()
          const changedIds = new Set<AnyNodeId>(scopedIds)
          if (!scopedIds) {
            for (const id of Object.keys(state.nodes) as AnyNodeId[]) {
              if (state.nodes[id] !== previous.nodes[id]) changedIds.add(id)
            }
            for (const id of Object.keys(previous.nodes) as AnyNodeId[]) {
              if (!(id in state.nodes)) changedIds.add(id)
            }
          }
          listener(state.nodes, previous.nodes, changedIds)
        }) ?? (() => {})
      )
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

    getSubtree(rootId) {
      return collectSubtree(store.getState().nodes, rootId)
    },

    cloneNodesInto(nodes, opts: CloneNodesIntoOptions) {
      const { rootId, nodes: cloned } = runCloneNodesInto(nodes, opts)
      const root = cloned[0]
      if (!root) return null
      const state = store.getState()
      const ops: { node: AnyNode; parentId?: AnyNodeId }[] = []
      for (let i = 0; i < cloned.length; i += 1) {
        const node = cloned[i]!
        if (i === 0) {
          ops.push(opts.parentId ? { node, parentId: opts.parentId } : { node })
        } else {
          ops.push({ node })
        }
      }
      const batch = state.createNodes
      if (batch) {
        batch(ops)
      } else {
        for (const op of ops) state.createNode(op.node, op.parentId)
      }
      return rootId
    },
  }
}
