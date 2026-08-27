import * as Y from 'yjs'
import type { AnyNode, AnyNodeId } from '../schema/types'
import type { Collection, CollectionId } from '../schema/collections'
import type { SceneMaterial, SceneMaterialId } from '../schema/scene-material'
import type { SceneSnapshot } from '../store/history-control'

export interface SceneCRDTSchema {
  nodes: Y.Map<Y.Map<unknown>>
  rootNodeIds: Y.Array<string>
  collections: Y.Map<Y.Map<unknown>>
  materials: Y.Map<Y.Map<unknown>>
  installedPlugins: Y.Array<string>
  sceneMetadata: Y.Map<unknown>
}

/**
 * Initializes and returns the typed CRDT root structures from a Y.Doc instance.
 */
export function initializeSceneDoc(doc: Y.Doc): SceneCRDTSchema {
  return {
    nodes: doc.getMap<Y.Map<unknown>>('nodes'),
    rootNodeIds: doc.getArray<string>('rootNodeIds'),
    collections: doc.getMap<Y.Map<unknown>>('collections'),
    materials: doc.getMap<Y.Map<unknown>>('materials'),
    installedPlugins: doc.getArray<string>('installedPlugins'),
    sceneMetadata: doc.getMap<unknown>('sceneMetadata'),
  }
}

/**
 * Converts a plain JavaScript AnyNode into a nested Y.Map structure,
 * preserving sub-property granularity for composite dictionaries (slots, metadata, customProperties).
 */
export function writeNodeToYMap(yNode: Y.Map<unknown>, node: AnyNode): void {
  for (const [key, val] of Object.entries(node)) {
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      let nestedMap = yNode.get(key)
      if (!(nestedMap instanceof Y.Map)) {
        nestedMap = new Y.Map<unknown>()
        yNode.set(key, nestedMap)
      }
      const yNested = nestedMap as Y.Map<unknown>
      const record = val as Record<string, unknown>
      for (const [subKey, subVal] of Object.entries(record)) {
        if (JSON.stringify(yNested.get(subKey)) !== JSON.stringify(subVal)) {
          yNested.set(subKey, subVal)
        }
      }
      for (const existingKey of Array.from(yNested.keys())) {
        if (!(existingKey in record)) {
          yNested.delete(existingKey)
        }
      }
      continue
    }

    const existing = yNode.get(key)
    if (JSON.stringify(existing) !== JSON.stringify(val)) {
      yNode.set(key, val)
    }
  }

  // Delete removed top-level keys
  for (const existingKey of Array.from(yNode.keys())) {
    if (!(existingKey in node)) {
      yNode.delete(existingKey)
    }
  }
}

/**
 * Reads a Y.Map representation of a node back into a plain AnyNode object.
 */
export function readNodeFromYMap(yNode: Y.Map<unknown>): AnyNode {
  const result: Record<string, unknown> = {}
  for (const [key, val] of yNode.entries()) {
    if (val instanceof Y.Map) {
      result[key] = val.toJSON()
    } else {
      result[key] = val
    }
  }
  return result as AnyNode
}

/**
 * Reconciles Y.Array elements with target array without full wipes,
 * preventing duplicate item interleaving across concurrent insertions.
 */
export function reconcileYArray(yArray: Y.Array<string>, target: readonly string[]): void {
  const current = yArray.toArray()
  if (JSON.stringify(current) === JSON.stringify(target)) return

  // Minimal diff reconciliation
  const targetSet = new Set(target)
  for (let i = yArray.length - 1; i >= 0; i--) {
    const val = yArray.get(i)
    if (val !== undefined && !targetSet.has(val)) {
      yArray.delete(i, 1)
    }
  }

  let curIdx = 0
  for (let tgtIdx = 0; tgtIdx < target.length; tgtIdx++) {
    const item = target[tgtIdx]
    if (item === undefined) continue
    const existing = curIdx < yArray.length ? yArray.get(curIdx) : null
    if (existing === item) {
      curIdx++
    } else {
      const foundIdx = yArray.toArray().indexOf(item, curIdx)
      if (foundIdx !== -1) {
        yArray.delete(foundIdx, 1)
      }
      yArray.insert(curIdx, [item])
      curIdx++
    }
  }
}

/**
 * Populates a Y.Doc with a SceneSnapshot inside a transactional scope.
 */
export function snapshotToYDoc(snapshot: SceneSnapshot, doc: Y.Doc): void {
  doc.transact(() => {
    const yNodes = doc.getMap<Y.Map<unknown>>('nodes')
    const yRootNodeIds = doc.getArray<string>('rootNodeIds')
    const yMaterials = doc.getMap<Y.Map<unknown>>('materials')
    const yCollections = doc.getMap<Y.Map<unknown>>('collections')
    const yInstalledPlugins = doc.getArray<string>('installedPlugins')

    // 1. Sync Nodes
    const currentSnapshotIds = new Set(Object.keys(snapshot.nodes))
    for (const existingId of Array.from(yNodes.keys())) {
      if (!currentSnapshotIds.has(existingId)) {
        yNodes.delete(existingId)
      }
    }
    for (const [id, node] of Object.entries(snapshot.nodes)) {
      let yNode = yNodes.get(id)
      if (!yNode) {
        yNode = new Y.Map<unknown>()
        yNodes.set(id, yNode)
      }
      writeNodeToYMap(yNode, node)
    }

    // 2. Sync Root Node IDs
    reconcileYArray(yRootNodeIds, snapshot.rootNodeIds)

    // 3. Sync Materials
    const currentMatIds = new Set(Object.keys(snapshot.materials || {}))
    for (const existingMatId of Array.from(yMaterials.keys())) {
      if (!currentMatIds.has(existingMatId)) {
        yMaterials.delete(existingMatId)
      }
    }
    if (snapshot.materials) {
      for (const [matId, mat] of Object.entries(snapshot.materials)) {
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
    }

    // 4. Sync Collections
    const currentColIds = new Set(Object.keys(snapshot.collections || {}))
    for (const existingColId of Array.from(yCollections.keys())) {
      if (!currentColIds.has(existingColId)) {
        yCollections.delete(existingColId)
      }
    }
    if (snapshot.collections) {
      for (const [colId, col] of Object.entries(snapshot.collections)) {
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
    }

    // 5. Sync Installed Plugins
    if (snapshot.installedPlugins) {
      reconcileYArray(yInstalledPlugins, snapshot.installedPlugins)
    }
  }, 'local')
}

/**
 * Extracts a complete SceneSnapshot from a Y.Doc instance.
 */
export function yDocToSnapshot(doc: Y.Doc): SceneSnapshot {
  const yNodes = doc.getMap<Y.Map<unknown>>('nodes')
  const yRootNodeIds = doc.getArray<string>('rootNodeIds')
  const yMaterials = doc.getMap<Y.Map<unknown>>('materials')
  const yCollections = doc.getMap<Y.Map<unknown>>('collections')
  const yInstalledPlugins = doc.getArray<string>('installedPlugins')

  const nodes: Record<AnyNodeId, AnyNode> = {}
  const sortedNodeKeys = Array.from(yNodes.keys()).sort()
  for (const id of sortedNodeKeys) {
    const yNode = yNodes.get(id)
    if (yNode instanceof Y.Map) {
      nodes[id as AnyNodeId] = readNodeFromYMap(yNode)
    }
  }

  const materials: Record<SceneMaterialId, SceneMaterial> = {}
  for (const matId of Array.from(yMaterials.keys()).sort()) {
    const yMat = yMaterials.get(matId)
    if (yMat instanceof Y.Map) {
      materials[matId as SceneMaterialId] = yMat.toJSON() as SceneMaterial
    }
  }

  const collections: Record<CollectionId, Collection> = {}
  for (const colId of Array.from(yCollections.keys()).sort()) {
    const yCol = yCollections.get(colId)
    if (yCol instanceof Y.Map) {
      collections[colId as CollectionId] = yCol.toJSON() as Collection
    }
  }

  return {
    nodes,
    rootNodeIds: yRootNodeIds.toArray() as AnyNodeId[],
    materials,
    collections,
    installedPlugins: yInstalledPlugins.toArray(),
  }
}
