import type { BufferGeometry, Material, Matrix4, Mesh, Object3D } from 'three'

/**
 * Contract for item draw-call batching (charter backlog #3a).
 *
 * Mirrors the wall-batch architecture (`../wall/wall-batch-system.tsx`) with
 * one structural upgrade: the container is a `THREE.BatchedMesh` per
 * `(levelId, material)` instead of merged geometry, so membership changes are
 * incremental instance adds/deletes rather than buffer resews.
 *
 * Invariants every module must respect:
 * - Source meshes STAY MOUNTED. They are draw-hidden via
 *   `hideFromScene(mesh, 'batched')` while batched; picking, measuring,
 *   outlines and the GLB exporter keep working through them. Batch meshes are
 *   draw-only: `raycast` is a noop, name is `'item-batch'`.
 * - Batch meshes are parented under the LEVEL ROOT, so level visibility and
 *   isolation cull batches exactly like every other level child (the
 *   vertical-culling win from the charter stays intact).
 * - A tinted item (selected, preview-selected or hovered) is released and
 *   draws its own meshes — selection paint and hover outline never read the
 *   batch. A handful of extra draws is what lighting them costs.
 * - Membership follows the scene dirty signal + the item-count tell; a batch
 *   never chases per-frame transforms. Items with live overrides are always
 *   tinted (drag implies selection), so mid-drag items are out by definition.
 */

/** One batchable mesh of one item. */
export type ItemBatchEntry = {
  itemId: string
  levelId: string
  /** Source mesh in the item's mounted GLB clone; draw-hidden while batched. */
  mesh: Mesh
  geometry: BufferGeometry
  /**
   * The mesh's resolved material (post `resolveItemMaterial`) — a shared
   * instance across copies of the same asset; its `uuid` is the batch key.
   * Array-material meshes are not batchable (excluded upstream).
   */
  material: Material
  /** Source mesh world matrix expressed in level-root space, captured at join. */
  matrixInLevel: Matrix4
}

/** Everything batchable about one item. `entries` empty ⇒ item not batchable. */
export type ItemCandidate = {
  itemId: string
  levelId: string
  entries: ItemBatchEntry[]
}

export type ItemBatchStats = {
  batches: number
  instances: number
  items: number
}

/**
 * Owns every BatchedMesh. Implementation in `item-batch.ts`; consumed only by
 * `item-batch-system.tsx`.
 */
export type ItemBatchStoreApi = {
  /**
   * Adds a wave of candidates, growing/creating batches as needed, and
   * returns the entries actually joined — the caller draw-hides exactly
   * those meshes and no others. An EXISTING batch always accepts a matching
   * entry (a released item must be able to rejoin alone); a NEW batch is
   * only created when the wave brings at least `minEntriesForNewBatch`
   * matching entries — below that, a batch trades plain draws for
   * bookkeeping and wins nothing.
   */
  join(candidates: ItemCandidate[], minEntriesForNewBatch: number): ItemBatchEntry[]
  /** Removes the item's instances and reveals nothing (caller reveals). */
  release(itemId: string): boolean
  /** Drops batches orphaned by a level-subtree remount; returns their items. */
  pruneDetached(): Set<string>
  has(itemId: string): boolean
  itemIds(): ReadonlySet<string>
  /** Tears down every batch on a level (level deleted / isolation). */
  disposeLevel(levelId: string): void
  disposeAll(): void
  stats(): ItemBatchStats
}

export type GetLevelRoot = (levelId: string) => Object3D | undefined

/** A (level, material) bucket below this many entries is not worth a batch. */
export const MIN_BATCH_ENTRIES = 3
/** Quiet window after the last item change before joins run (walls: 180). */
export const ITEM_BATCH_SETTLE_MS = 180
