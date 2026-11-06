import { BatchedMesh, type BufferGeometry, type Material, type Object3D } from 'three'
import {
  type BatchCandidate,
  type BatchEntry,
  type GetLevelRoot,
  NODE_BATCH_SETTLE_MS,
  type NodeBatchStats,
  type NodeBatchStoreApi,
} from './types'

function skipRaycast() {}

function positionVersion(geometry: BufferGeometry): number {
  const attribute = geometry.attributes.position as
    | { version?: number; data?: { version?: number } }
    | undefined
  return attribute?.version ?? attribute?.data?.version ?? -1
}

type PackedGeometry = {
  id: number
  uuid: string
  version: number
  vertices: number
  indices: number
  reservedVertices: number
  reservedIndices: number
}
type InstanceRecord = { entry: BatchEntry; instanceId: number }
type BatchRecord = {
  levelId: string
  batched: BatchedMesh
  geometryIds: Map<string, PackedGeometry>
  instances: InstanceRecord[]
  capacity: { instances: number; vertices: number; indices: number }
  used: { vertices: number; indices: number }
  emptySince: number | null
}

function attributeSignature(geometry: BufferGeometry): string {
  return `${Object.entries(geometry.attributes)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([name, attribute]) =>
        `${name}:${attribute.itemSize}:${attribute.normalized}:${attribute.array.constructor.name}`,
    )
    .join(',')}|${geometry.index ? 'i' : 'n'}`
}
const batchKey = (entry: BatchEntry) =>
  `${entry.levelId}|${entry.material.uuid}|${attributeSignature(entry.geometry)}|${entry.castShadow}|${entry.receiveShadow}`
const geometryKey = (entry: BatchEntry) => entry.allocationKey ?? entry.geometry.uuid
const vertexCount = (geometry: BufferGeometry) => geometry.attributes.position?.count ?? 0
const indexCount = (geometry: BufferGeometry) => geometry.index?.count ?? vertexCount(geometry)
function reservation(entry: BatchEntry) {
  const reserve = (count: number) =>
    entry.allocationKey ? Math.max(count + 12, Math.ceil(count * 1.25)) : count
  return {
    vertices: reserve(vertexCount(entry.geometry)),
    indices: reserve(indexCount(entry.geometry)),
  }
}
function matches(packed: PackedGeometry, geometry: BufferGeometry) {
  return (
    packed.uuid === geometry.uuid &&
    packed.version === positionVersion(geometry) &&
    packed.vertices === vertexCount(geometry) &&
    packed.indices === indexCount(geometry)
  )
}

export class NodeBatchStore implements NodeBatchStoreApi {
  private readonly batches = new Map<string, BatchRecord>()
  private readonly keysByNode = new Map<string, Set<string>>()
  private readonly instancesByNode = new Map<
    string,
    Array<{ record: BatchRecord; instanceId: number }>
  >()
  private readonly pending = new Map<BatchRecord, Set<number>>()
  private instanceCount = 0
  private readonly counters = {
    releases: 0,
    joins: 0,
    geometryReplacements: 0,
    overflowRebuilds: 0,
    geometryBytesCopied: 0,
  }

  constructor(private readonly getLevelRoot: GetLevelRoot) {}

  join(candidates: BatchCandidate[], minEntriesForNewBatch: number): BatchEntry[] {
    this.flushReleases()
    const joined: BatchEntry[] = []
    const byBatch = new Map<string, BatchEntry[]>()
    for (const candidate of candidates) {
      for (const entry of candidate.entries) {
        if (vertexCount(entry.geometry) === 0) continue
        const key = batchKey(entry)
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
      const needed = this.requiredSpace(entries, record)
      if (!record) {
        record = this.createBatch(
          entries[0]!.levelId,
          entries[0]!.material,
          entries[0]!,
          root,
          entries.length,
          needed.vertices,
          needed.indices,
        )
        this.batches.set(key, record)
      } else if (
        needed.overflow ||
        record.instances.length + entries.length > record.capacity.instances ||
        record.used.vertices + needed.vertices > record.capacity.vertices ||
        record.used.indices + needed.indices > record.capacity.indices
      ) {
        // Only resident geometry and this join wave survive compaction. Released
        // allocations must never contribute to the replacement container's size.
        const live = [...record.instances.map(({ entry }) => entry), ...entries]
        const size = this.requiredSpace(live)
        const survivors = record.instances
        const oldRecord = record
        this.disposeBatch(key, record)
        record = this.createBatch(
          entries[0]!.levelId,
          entries[0]!.material,
          entries[0]!,
          root,
          live.length,
          size.vertices,
          size.indices,
        )
        this.batches.set(key, record)
        for (const { entry } of survivors) {
          const other =
            this.instancesByNode.get(entry.nodeId)?.filter(({ record }) => record !== oldRecord) ??
            []
          this.instancesByNode.set(entry.nodeId, other)
        }
        for (const { entry } of survivors) this.addEntry(key, record, entry)
        this.counters.overflowRebuilds++
      }
      for (const entry of entries) {
        this.addEntry(key, record, entry)
        this.instanceCount++
        this.counters.joins++
        joined.push(entry)
      }
      record.emptySince = null
    }
    return joined
  }

  private requiredSpace(entries: BatchEntry[], record?: BatchRecord) {
    let vertices = 0
    let indices = 0
    let overflow = false
    const seen = new Set<string>()
    for (const entry of entries) {
      const key = geometryKey(entry)
      if (seen.has(key)) continue
      seen.add(key)
      const packed = record?.geometryIds.get(key)
      if (packed) {
        if (
          vertexCount(entry.geometry) > packed.reservedVertices ||
          indexCount(entry.geometry) > packed.reservedIndices
        )
          overflow = true
      } else {
        const size = reservation(entry)
        vertices += size.vertices
        indices += size.indices
      }
    }
    return { vertices, indices, overflow }
  }

  private addEntry(key: string, record: BatchRecord, entry: BatchEntry) {
    const allocation = geometryKey(entry)
    let packed = record.geometryIds.get(allocation)
    if (!packed || !matches(packed, entry.geometry)) {
      const size = packed
        ? { vertices: packed.reservedVertices, indices: packed.reservedIndices }
        : reservation(entry)
      let id: number
      if (packed) {
        id = packed.id
        record.batched.setGeometryAt(id, entry.geometry)
        this.counters.geometryReplacements++
      } else {
        id = record.batched.addGeometry(entry.geometry, size.vertices, size.indices)
        record.used.vertices += size.vertices
        record.used.indices += size.indices
      }
      for (const attribute of Object.values(entry.geometry.attributes)) {
        this.counters.geometryBytesCopied +=
          size.vertices * attribute.itemSize * attribute.array.BYTES_PER_ELEMENT
      }
      if (entry.geometry.index)
        this.counters.geometryBytesCopied +=
          size.indices * record.batched.geometry.index!.array.BYTES_PER_ELEMENT
      packed = {
        id,
        uuid: entry.geometry.uuid,
        version: positionVersion(entry.geometry),
        vertices: vertexCount(entry.geometry),
        indices: indexCount(entry.geometry),
        reservedVertices: size.vertices,
        reservedIndices: size.indices,
      }
      record.geometryIds.set(allocation, packed)
    }
    const instanceId = record.batched.addInstance(packed.id)
    record.batched.setMatrixAt(instanceId, entry.matrixInLevel)
    record.instances.push({ entry, instanceId })
    let keys = this.keysByNode.get(entry.nodeId)
    if (!keys) {
      keys = new Set()
      this.keysByNode.set(entry.nodeId, keys)
    }
    keys.add(key)
    let instances = this.instancesByNode.get(entry.nodeId)
    if (!instances) {
      instances = []
      this.instancesByNode.set(entry.nodeId, instances)
    }
    instances.push({ record, instanceId })
  }

  release(nodeId: string): boolean {
    const instances = this.instancesByNode.get(nodeId)
    if (!instances) return false
    for (const { record, instanceId } of instances) {
      // Interactions reveal sources synchronously; hide their packed draws now,
      // then compact bookkeeping once for all releases in the frame.
      record.batched.setVisibleAt(instanceId, false)
      let doomed = this.pending.get(record)
      if (!doomed) {
        doomed = new Set()
        this.pending.set(record, doomed)
      }
      doomed.add(instanceId)
      this.instanceCount--
    }
    this.instancesByNode.delete(nodeId)
    this.keysByNode.delete(nodeId)
    this.counters.releases++
    return true
  }

  flushReleases(now = performance.now()): void {
    for (const [record, doomed] of this.pending) {
      for (const id of doomed) record.batched.deleteInstance(id)
      record.instances = record.instances.filter(({ instanceId }) => !doomed.has(instanceId))
      if (record.instances.length === 0) record.emptySince = now
    }
    this.pending.clear()
  }

  pruneEmpty(
    now = performance.now(),
    retainedLevels: ReadonlySet<string> = new Set(),
    earliestDisposalAt = 0,
  ): boolean {
    let pending = false
    for (const [key, record] of this.batches) {
      if (
        record.emptySince !== null &&
        now - record.emptySince >= NODE_BATCH_SETTLE_MS &&
        now >= earliestDisposalAt &&
        !retainedLevels.has(record.levelId)
      )
        this.disposeBatch(key, record)
      else if (record.emptySince !== null) pending = true
    }
    return pending
  }

  pruneDetached(): Set<string> {
    const orphaned = new Set<string>()
    const detached: Array<[string, BatchRecord]> = []
    for (const [key, record] of this.batches) {
      const root = this.getLevelRoot(record.levelId)
      if (root && record.batched.parent === root) continue
      for (const { entry } of record.instances) orphaned.add(entry.nodeId)
      detached.push([key, record])
    }
    for (const id of orphaned) this.release(id)
    for (const [key, record] of detached) this.disposeBatch(key, record)
    return orphaned
  }

  has(nodeId: string): boolean {
    return this.keysByNode.has(nodeId)
  }
  nodeIds(): ReadonlySet<string> {
    return new Set(this.keysByNode.keys())
  }
  disposeLevel(levelId: string): void {
    for (const [key, record] of this.batches) {
      if (record.levelId !== levelId) continue
      for (const { entry } of record.instances) this.release(entry.nodeId)
      this.flushReleases()
      this.disposeBatch(key, record)
    }
  }
  disposeAll(): void {
    for (const [key, record] of this.batches) this.disposeBatch(key, record)
    this.keysByNode.clear()
    this.instancesByNode.clear()
    this.pending.clear()
    this.instanceCount = 0
  }
  stats(): NodeBatchStats {
    return {
      batches: this.batches.size,
      instances: this.instanceCount,
      nodes: this.keysByNode.size,
      ...this.counters,
    }
  }

  private createBatch(
    levelId: string,
    material: Material,
    shadows: Pick<BatchEntry, 'castShadow' | 'receiveShadow'>,
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
    batched.castShadow = shadows.castShadow
    batched.receiveShadow = shadows.receiveShadow
    batched.perObjectFrustumCulled = true
    // Whole-container culling would use a bounding sphere computed at first
    // cull — instances joining farther out later could vanish with the whole
    // batch. Per-instance culling above already handles visibility.
    batched.frustumCulled = false
    batched.matrixAutoUpdate = false
    batched.matrix.identity()
    batched.raycast = skipRaycast
    root.add(batched)
    return {
      levelId,
      batched,
      geometryIds: new Map(),
      instances: [],
      emptySince: null,
      capacity: {
        instances: Math.max(8, instanceCount * 2),
        vertices: Math.max(1024, vertices * 2),
        indices: Math.max(1024, indices * 2),
      },
      used: { vertices: 0, indices: 0 },
    }
  }

  private disposeBatch(key: string, record: BatchRecord): void {
    this.pending.delete(record)
    record.batched.removeFromParent()
    record.batched.dispose()
    this.batches.delete(key)
  }
}
