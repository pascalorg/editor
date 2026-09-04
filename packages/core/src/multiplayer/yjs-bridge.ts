import * as Y from 'yjs'
import type { UseBoundStore, StoreApi } from 'zustand'
import useScene, {
  applySceneOperationPatch,
  type SceneState,
  type SceneOperationPatch,
  type SceneNodeStructuralPatch,
} from '../store/use-scene'
import {
  subscribeSceneCommits,
  type SceneCommit,
} from '../store/history-control'
import type { AnyNode, AnyNodeId } from '../schema/types'
import type { SceneMaterial, SceneMaterialId } from '../schema/scene-material'
import { writeNodeToYMap, readNodeFromYMap, reconcileYArray } from './crdt-schema'

export interface YjsBridgeOptions {
  doc: Y.Doc
  sceneStore?: UseBoundStore<StoreApi<SceneState>>
  onRemotePatchRejected?: (reason: string, patch: SceneOperationPatch) => void
}

/**
 * Binds a Zustand scene store to a Y.Doc instance with bidirectional synchronization,
 * origin tagging ('local' vs 'host'), and loop-immune echo suppression.
 */
export function bindZustandToYjs({
  doc,
  sceneStore = useScene,
  onRemotePatchRejected,
}: YjsBridgeOptions): () => void {
  const yNodes = doc.getMap<Y.Map<unknown>>('nodes')
  const yRootNodeIds = doc.getArray<string>('rootNodeIds')
  const yMaterials = doc.getMap<Y.Map<unknown>>('materials')
  const yCollections = doc.getMap<Y.Map<unknown>>('collections')
  const yInstalledPlugins = doc.getArray<string>('installedPlugins')

  let isApplyingRemoteTransaction = false
  const pendingLiveConflictPatches = new Map<AnyNodeId, SceneOperationPatch>()

  // 1. OUTBOUND: Zustand -> Yjs (Local User Commits)
  const unsubscribeSceneCommits = subscribeSceneCommits((commit: SceneCommit) => {
    // Suppress echo if the commit originated from remote host or while applying remote updates
    if (commit.origin === 'host' || isApplyingRemoteTransaction) return

    doc.transact(() => {
      const { before, current, changedNodeIds } = commit
      const currentIds = new Set(Object.keys(current.nodes))
      const beforeIds = new Set(Object.keys(before.nodes))

      // A. Deleted Nodes
      for (const id of beforeIds) {
        if (!currentIds.has(id)) {
          yNodes.delete(id)
        }
      }

      // B. Created & Updated Nodes
      const targetIds = changedNodeIds ? Array.from(changedNodeIds) : Object.keys(current.nodes)
      for (const id of targetIds) {
        const currentNode = current.nodes[id as AnyNodeId]
        if (!currentNode) continue
        let yNode = yNodes.get(id)
        if (!yNode) {
          yNode = new Y.Map<unknown>()
          yNodes.set(id, yNode)
        }
        writeNodeToYMap(yNode, currentNode)
      }

      // C. Root Node IDs (Granular Reconcile)
      reconcileYArray(yRootNodeIds, current.rootNodeIds)

      // D. Materials
      for (const [matId, mat] of Object.entries(current.materials || {})) {
        let yMat = yMaterials.get(matId)
        if (!yMat) {
          yMat = new Y.Map<unknown>()
          yMaterials.set(matId, yMat)
        }
        for (const [k, v] of Object.entries(mat)) {
          if (JSON.stringify(yMat.get(k)) !== JSON.stringify(v)) {
            yMat.set(k, v)
          }
        }
      }
      for (const matId of Object.keys(before.materials || {})) {
        if (!current.materials?.[matId as SceneMaterialId]) {
          yMaterials.delete(matId)
        }
      }

      // E. Collections
      for (const [colId, col] of Object.entries(current.collections || {})) {
        let yCol = yCollections.get(colId)
        if (!yCol) {
          yCol = new Y.Map<unknown>()
          yCollections.set(colId, yCol)
        }
        for (const [k, v] of Object.entries(col)) {
          if (JSON.stringify(yCol.get(k)) !== JSON.stringify(v)) {
            yCol.set(k, v)
          }
        }
      }
      for (const colId of Object.keys(before.collections || {})) {
        if (!current.collections?.[colId as any]) {
          yCollections.delete(colId)
        }
      }

      // F. Installed Plugins
      if (current.installedPlugins) {
        reconcileYArray(yInstalledPlugins, current.installedPlugins)
      }
    }, 'local')
  })

  // 2. INBOUND: Yjs -> Zustand (Granular O(1) Remote Deltas)
  const handleRemoteUpdate = (
    eventsOrEvent: Y.YEvent<any>[] | Y.YEvent<any>,
    transaction: Y.Transaction,
  ) => {
    // Suppress local echo transactions
    if (transaction.origin === 'local') return

    const events = Array.isArray(eventsOrEvent) ? eventsOrEvent : [eventsOrEvent]

    isApplyingRemoteTransaction = true
    try {
      const state = sceneStore.getState()
      const touchedNodeIds = new Set<AnyNodeId>()

      // Inspect YEvents to extract touched node IDs in O(K) time
      for (const event of events) {
        if (event.path && event.path.length > 0) {
          touchedNodeIds.add(event.path[0] as AnyNodeId)
        } else if (event.target === yNodes) {
          event.changes.keys.forEach((_change, key) => {
            touchedNodeIds.add(key as AnyNodeId)
          })
        }
      }

      const nodeCreates: SceneNodeStructuralPatch[] = []
      const nodeUpdates: { id: AnyNodeId; data: Partial<AnyNode>; removeFields: string[] }[] = []
      const nodeDeletes: SceneNodeStructuralPatch[] = []
      const materialChanges: { id: SceneMaterialId; material: SceneMaterial | null }[] = []

      // Check for material changes
      for (const event of events) {
        if (event.target === yMaterials) {
          event.changes.keys.forEach((change, key) => {
            if (change.action === 'delete') {
              materialChanges.push({ id: key as SceneMaterialId, material: null })
            } else {
              const yMat = yMaterials.get(key)
              if (yMat instanceof Y.Map) {
                materialChanges.push({ id: key as SceneMaterialId, material: yMat.toJSON() as SceneMaterial })
              }
            }
          })
        }
      }

      for (const nodeId of touchedNodeIds) {
        const yNode = yNodes.get(nodeId)
        const localNode = state.nodes[nodeId]

        if (!yNode && localNode) {
          // Node Deleted remotely
          const parentId = (localNode.parentId as AnyNodeId | null | undefined) ?? null
          const parent = parentId ? state.nodes[parentId] : null
          const siblings: AnyNodeId[] = parent && 'children' in parent && Array.isArray(parent.children)
            ? (parent.children as AnyNodeId[])
            : state.rootNodeIds

          const position = siblings.indexOf(nodeId)
          if (position !== -1) {
            nodeDeletes.push({
              node: localNode,
              position,
            })
          }
        } else if (yNode && !localNode) {
          // Node Created remotely
          const rawRemoteNode = readNodeFromYMap(yNode)
          const parentId = (rawRemoteNode.parentId as AnyNodeId | null | undefined) ?? null

          // Compute exact structural position
          let position = 0
          if (!parentId) {
            const rootIdx = yRootNodeIds.toArray().indexOf(nodeId)
            position = rootIdx !== -1 ? rootIdx : state.rootNodeIds.length
          } else {
            const parentNode = state.nodes[parentId] ?? (yNodes.get(parentId) ? readNodeFromYMap(yNodes.get(parentId)!) : null)
            if (parentNode && 'children' in parentNode && Array.isArray(parentNode.children)) {
              const childIdx = (parentNode.children as string[]).indexOf(nodeId)
              position = childIdx !== -1 ? childIdx : parentNode.children.length
            }
          }

          nodeCreates.push({
            node: rawRemoteNode,
            position: Math.max(0, position),
          })
        } else if (yNode && localNode) {
          // Node Updated remotely
          const remoteNode = readNodeFromYMap(yNode)
          if (JSON.stringify(localNode) !== JSON.stringify(remoteNode)) {
            // Identify removed fields
            const removeFields: string[] = []
            for (const key of Object.keys(localNode)) {
              if (!(key in remoteNode)) {
                removeFields.push(key)
              }
            }

            nodeUpdates.push({
              id: nodeId,
              data: remoteNode,
              removeFields,
            })
          }
        }
      }

      if (
        nodeCreates.length === 0 &&
        nodeUpdates.length === 0 &&
        nodeDeletes.length === 0 &&
        materialChanges.length === 0
      ) {
        return
      }

      const patch: SceneOperationPatch = {
        nodeCreates,
        nodeUpdates,
        nodeDeletes,
        materialChanges,
      }

      // Apply via host patcher
      const applied = applySceneOperationPatch(patch)
      if (!applied) {
        for (const id of touchedNodeIds) {
          pendingLiveConflictPatches.set(id, patch)
        }
        onRemotePatchRejected?.('Patch rejected or deferred due to live conflict', patch)
      }
    } finally {
      isApplyingRemoteTransaction = false
    }
  }

  yNodes.observeDeep(handleRemoteUpdate)
  yRootNodeIds.observeDeep(handleRemoteUpdate)
  yMaterials.observeDeep(handleRemoteUpdate)
  yCollections.observeDeep(handleRemoteUpdate)
  yInstalledPlugins.observeDeep(handleRemoteUpdate)

  return () => {
    unsubscribeSceneCommits()
    yNodes.unobserveDeep(handleRemoteUpdate)
    yRootNodeIds.unobserveDeep(handleRemoteUpdate)
    yMaterials.unobserveDeep(handleRemoteUpdate)
    yCollections.unobserveDeep(handleRemoteUpdate)
    yInstalledPlugins.unobserveDeep(handleRemoteUpdate)
  }
}
