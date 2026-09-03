import { BatchedMesh, type BufferGeometry, type Material, type Matrix4, type Object3D } from 'three'
import type {
  GetLevelRoot,
  ItemBatchEntry,
  ItemBatchStats,
  ItemBatchStoreApi,
  ItemCandidate,
} from './item-batch-types'

/**
 * BatchedMesh container for item batching — see item-batch-types.ts for the
 * architecture invariants. One BatchedMesh per `(levelId, material.uuid)`,
 * parented under the level root; membership changes are instance
 * adds/deletes, and only a capacity overflow rebuilds a batch.
 */

/** Batch meshes are draw-only; sources keep every raycast (wall-batch rule). */
function skipRaycast() {
  // intentionally empty
}

type InstanceRecord = {
  itemId: string
  geometry: BufferGeometry
  matrix: Matrix4
  instanceId: number
}

type BatchRecord = {
  levelId: string
  material: Material
  batched: BatchedMesh
  /** geometry.uuid → BatchedMesh geometry id */
  geometryIds: Map<string, number>
  instances: InstanceRecord[]
  capacity: { instances: number; vertices: number; indices: number }
  used: { vertices: number; indices: number }
}

/**
 * BatchedMesh requires every geometry it holds to share one attribute layout
 * (GLB assets differ — some carry `uv1`, some don't) and one index-ness, so
 * both are part of the batch identity alongside level and material.
 */
function attributeSignature(geometry: BufferGeometry): string {
  return `${Object.keys(geometry.attributes).sort().join(',')}|${geometry.index ? 'i' : 'n'}`
}

const batchKey = (levelId: string, materialUuid: string, signature: string) =>
  `${levelId}|${materialUuid}|${signature}`

function vertexCount(geometry: BufferGeometry): number {
  return geometry.attributes.position?.count ?? 0
}

function indexCount(geometry: BufferGeometry): number {
  // Non-indexed geometry still consumes index capacity in BatchedMesh (it
  // indexes the vertices 1:1 internally).
  return geometry.index?.count ?? vertexCount(geometry)
}

export class ItemBatchStore implements ItemBatchStoreApi {
  private readonly getLevelRoot: GetLevelRoot
  private readonly batches = new Map<string, BatchRecord>()
  private readonly keysByItem = new Map<string, Set<string>>()

  constructor(getLevelRoot: GetLevelRoot) {
    this.getLevelRoot = getLevelRoot
  }

  join(candidates: ItemCandidate[], minEntriesForNewBatch: number): ItemBatchEntry[] {
    const joined: ItemBatchEntry[] = []

    // Group the whole wave by batch identity so a new batch's viability and
    // capacity are judged across every candidate at once.
    const byBatch = new Map<string, ItemBatchEntry[]>()
    for (const candidate of candidates) {
      for (const entry of candidate.entries) {
        if (vertexCount(entry.geometry) === 0) continue
        const key = batchKey(
          entry.levelId,
          entry.material.uuid,
          attributeSignature(entry.geometry),
        )
        const bucket = byBatch.get(key)
        if (bucket) bucket.push(entry)
        else byBatch.set(key, [entry])
      }
    }

    for (const [key, entries] of byBatch) {
      let record = this.batches.get(key)
      if (!record && entries.length < minEntriesForNewBatch) continue
      const root = this.getLevelRoot(entries[0]!.levelId)
      if (!root) continue

      const newGeometries = new Map<string, BufferGeometry>()
      for (const entry of entries) {
        if (!record?.geometryIds.has(entry.geometry.uuid)) {
          newGeometries.set(entry.geometry.uuid, entry.geometry)
        }
      }
      let addedVertices = 0
      let addedIndices = 0
      for (const geometry of newGeometries.values()) {
        addedVertices += vertexCount(geometry)
        addedIndices += indexCount(geometry)
      }

      if (!record) {
        record = this.createBatch(
          entries[0]!.levelId,
          entries[0]!.material,
          root,
          entries.length,
          addedVertices,
          addedIndices,
        )
        this.batches.set(key, record)
      } else if (
        record.instances.length + entries.length > record.capacity.instances ||
        record.used.vertices + addedVertices > record.capacity.vertices ||
        record.used.indices + addedIndices > record.capacity.indices
      ) {
        record = this.rebuildBatch(key, record, root, entries.length, addedVertices, addedIndices)
      }

      for (const entry of entries) {
        let geometryId = record.geometryIds.get(entry.geometry.uuid)
        if (geometryId === undefined) {
          // Signature grouping should make this infallible; a throw here mid-
          // frame would still leave half-joined bookkeeping, so a geometry
          // three rejects is skipped instead — that mesh just keeps drawing
          // itself.
          try {
            geometryId = record.batched.addGeometry(entry.geometry)
          } catch {
            continue
          }
          record.geometryIds.set(entry.geometry.uuid, geometryId)
          record.used.vertices += vertexCount(entry.geometry)
          record.used.indices += indexCount(entry.geometry)
        }
        const instanceId = record.batched.addInstance(geometryId)
        record.batched.setMatrixAt(instanceId, entry.matrixInLevel)
        joined.push(entry)
        record.instances.push({
          itemId: entry.itemId,
          geometry: entry.geometry,
          matrix: entry.matrixInLevel,
          instanceId,
        })
        let keys = this.keysByItem.get(entry.itemId)
        if (!keys) {
          keys = new Set()
          this.keysByItem.set(entry.itemId, keys)
        }
        keys.add(key)
      }
    }
    return joined
  }

  /**
   * Drops batches whose mesh is no longer a child of the live level root — a
   * React remount of the level subtree (thumbnail capture's level shuffling,
   * tool-state changes) replaces the registry groups and silently orphans the
   * imperatively-parented batch meshes, while fresh source clones mount with
   * no layer hold. Returns the affected item ids so the caller can release
   * and re-stale them against the new scene graph.
   */
  pruneDetached(): Set<string> {
    const orphaned = new Set<string>()
    for (const [key, record] of [...this.batches]) {
      const root = this.getLevelRoot(record.levelId)
      if (root && record.batched.parent === root) continue
      for (const instance of record.instances) orphaned.add(instance.itemId)
      record.batched.removeFromParent()
      record.batched.dispose()
      this.batches.delete(key)
    }
    return orphaned
  }

  release(itemId: string): boolean {
    const keys = this.keysByItem.get(itemId)
    if (!keys) return false

    for (const key of keys) {
      const record = this.batches.get(key)
      if (!record) continue
      const remaining: InstanceRecord[] = []
      for (const instance of record.instances) {
        if (instance.itemId === itemId) record.batched.deleteInstance(instance.instanceId)
        else remaining.push(instance)
      }
      record.instances = remaining
      if (remaining.length === 0) this.disposeBatch(key, record)
    }
    this.keysByItem.delete(itemId)
    return true
  }

  has(itemId: string): boolean {
    return this.keysByItem.has(itemId)
  }

  itemIds(): ReadonlySet<string> {
    return new Set(this.keysByItem.keys())
  }

  disposeLevel(levelId: string): void {
    for (const [key, record] of [...this.batches]) {
      if (record.levelId !== levelId) continue
      for (const instance of record.instances) {
        const keys = this.keysByItem.get(instance.itemId)
        keys?.delete(key)
        if (keys && keys.size === 0) this.keysByItem.delete(instance.itemId)
      }
      this.disposeBatch(key, record)
    }
  }

  disposeAll(): void {
    for (const [key, record] of [...this.batches]) this.disposeBatch(key, record)
    this.keysByItem.clear()
  }

  stats(): ItemBatchStats {
    let instances = 0
    for (const record of this.batches.values()) instances += record.instances.length
    return { batches: this.batches.size, instances, items: this.keysByItem.size }
  }

  private createBatch(
    levelId: string,
    material: Material,
    root: Object3D,
    instanceCount: number,
    vertices: number,
    indices: number,
  ): BatchRecord {
    // 2× headroom so steady-state joins (an item placed, an item released and
    // re-joined) never pay a rebuild; overflow re-sizes to 2× the new need.
    const batched = new BatchedMesh(
      Math.max(8, instanceCount * 2),
      Math.max(1024, vertices * 2),
      Math.max(1024, indices * 2),
      material,
    )
    batched.name = 'item-batch'
    // GLTFExporter would serialize the packed multi-draw buffers as one
    // garbage mesh; exports must never carry a batch. The batch system also
    // releases everything on 'thumbnail:before-capture' so the real item
    // meshes are back on the scene layer for the export clone — this marker
    // is the backstop for any capture path that skips the emit.
    batched.userData.pascalExport = 'strip'
    batched.castShadow = true
    batched.receiveShadow = true
    batched.perObjectFrustumCulled = true
    batched.matrixAutoUpdate = false
    batched.matrix.identity()
    batched.raycast = skipRaycast
    root.add(batched)
    return {
      levelId,
      material,
      batched,
      geometryIds: new Map(),
      instances: [],
      capacity: {
        instances: Math.max(8, instanceCount * 2),
        vertices: Math.max(1024, vertices * 2),
        indices: Math.max(1024, indices * 2),
      },
      used: { vertices: 0, indices: 0 },
    }
  }

  private rebuildBatch(
    key: string,
    old: BatchRecord,
    root: Object3D,
    extraInstances: number,
    extraVertices: number,
    extraIndices: number,
  ): BatchRecord {
    const survivors = old.instances
    old.batched.removeFromParent()
    old.batched.dispose()

    const next = this.createBatch(
      old.levelId,
      old.material,
      root,
      survivors.length + extraInstances,
      old.used.vertices + extraVertices,
      old.used.indices + extraIndices,
    )
    for (const instance of survivors) {
      let geometryId = next.geometryIds.get(instance.geometry.uuid)
      if (geometryId === undefined) {
        geometryId = next.batched.addGeometry(instance.geometry)
        next.geometryIds.set(instance.geometry.uuid, geometryId)
        next.used.vertices += vertexCount(instance.geometry)
        next.used.indices += indexCount(instance.geometry)
      }
      instance.instanceId = next.batched.addInstance(geometryId)
      next.batched.setMatrixAt(instance.instanceId, instance.matrix)
    }
    next.instances = survivors
    this.batches.set(key, next)
    return next
  }

  private disposeBatch(key: string, record: BatchRecord): void {
    record.batched.removeFromParent()
    // Frees the batch's internal merged buffers only — source geometries and
    // the shared material belong to the live item meshes.
    record.batched.dispose()
    this.batches.delete(key)
  }
}
