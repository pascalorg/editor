import type { BufferGeometry, Material, Matrix4, Mesh, Object3D } from 'three'

/**
 * Contract for node draw-call batching (charter backlog #3a/#3b).
 *
 * Mirrors the wall-batch architecture (`../../wall/wall-batch-system.tsx`)
 * with one structural upgrade: the container is a `THREE.BatchedMesh` per
 * `(levelId, material, attribute-signature)` instead of merged geometry, so
 * membership changes are incremental instance adds/deletes rather than
 * buffer resews.
 *
 * Batched kinds: items and columns (level-parented), doors and windows
 * (wall-hosted, resolved to the host wall's level). Walls keep their own
 * merged-geometry batch — their geometry itself changes on edit, which is
 * the case BatchedMesh instances cannot express.
 *
 * Invariants every module must respect:
 * - Source meshes STAY MOUNTED. They are draw-hidden via
 *   `hideFromScene(mesh, 'batched')` while batched; picking, measuring,
 *   outlines and the GLB exporter keep working through them. Batch meshes
 *   are draw-only: `raycast` is a noop, name is `'item-batch'`.
 * - Batch meshes are parented under the LEVEL ROOT, so level visibility and
 *   isolation cull batches exactly like every other level child.
 * - A tinted node (selected, preview-selected or hovered — and for hosted
 *   openings, one whose host wall is tinted or mid-gesture) is released and
 *   draws its own meshes.
 * - Membership follows the scene dirty signal + the node-count tell; a batch
 *   never chases per-frame transforms. A dirty host wall releases its
 *   openings (their level-space transforms move with the wall).
 * - Doors/windows with an active animation record are excluded while it
 *   runs; the completion dirty mark re-joins them at the settled pose.
 */

/** One batchable mesh of one node. */
export type BatchEntry = {
  nodeId: string
  levelId: string
  /** Source mesh in the node's mounted subtree; draw-hidden while batched. */
  mesh: Mesh
  geometry: BufferGeometry
  /**
   * The mesh's resolved material — a shared/cached instance; its `uuid` is
   * part of the batch key. Array-material meshes are not batchable.
   */
  material: Material
  /** Source mesh world matrix expressed in level-root space, captured at join. */
  matrixInLevel: Matrix4
}

/** Everything batchable about one node. `entries` empty ⇒ not batchable. */
export type BatchCandidate = {
  nodeId: string
  levelId: string
  entries: BatchEntry[]
}

export type NodeBatchStats = {
  batches: number
  instances: number
  nodes: number
}

/**
 * Owns every BatchedMesh. Implementation in `store.ts`; consumed only by
 * `system.tsx`.
 */
export type NodeBatchStoreApi = {
  /**
   * Adds a wave of candidates, growing/creating batches as needed, and
   * returns the entries actually joined — the caller draw-hides exactly
   * those meshes and no others. An EXISTING batch always accepts a matching
   * entry (a released node must be able to rejoin alone); a NEW batch is
   * only created when the wave brings at least `minEntriesForNewBatch`
   * matching entries — below that, a batch trades plain draws for
   * bookkeeping and wins nothing.
   */
  join(candidates: BatchCandidate[], minEntriesForNewBatch: number): BatchEntry[]
  /** Removes the node's instances and reveals nothing (caller reveals). */
  release(nodeId: string): boolean
  /** Drops batches orphaned by a level-subtree remount; returns their nodes. */
  pruneDetached(): Set<string>
  has(nodeId: string): boolean
  nodeIds(): ReadonlySet<string>
  /** Tears down every batch on a level (level deleted / isolation). */
  disposeLevel(levelId: string): void
  disposeAll(): void
  stats(): NodeBatchStats
}

export type GetLevelRoot = (levelId: string) => Object3D | undefined

/** A (level, material) bucket below this many entries is not worth a batch. */
export const MIN_BATCH_ENTRIES = 3
/** Quiet window after the last node change before joins run (walls: 180). */
export const NODE_BATCH_SETTLE_MS = 180
