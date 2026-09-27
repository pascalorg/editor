import {
  type AnyNode,
  type BatchableConfig,
  itemClipRegistry,
  useInteractive,
} from '@pascal-app/core'

/** One packed allocation per node mesh, for geometry each rebuild replaces. */
export const nodeMeshBatchKey = (node: AnyNode, meshIndex: number) => `${node.id}:${meshIndex}`

export const columnBatchable: BatchableConfig = { scope: 'level' }

/** Ceiling undersides and slab bodies are trimmed by walls and rebuilt in place. */
export const surfaceBatchable: BatchableConfig = {
  scope: 'level',
  batchKey: nodeMeshBatchKey,
  waitsForWalls: true,
}

export const itemBatchable: BatchableConfig = {
  scope: 'level',
  // A registered clip means the item animates its own subtree (a fan's
  // spin) — per-mesh transforms move under a static batch instance.
  excluded: (node) =>
    Boolean((node as { asset?: { interactive?: unknown } }).asset?.interactive) ||
    itemClipRegistry.has(node.id as string),
  // Items hold their dirty mark until the GLB settles. A GLB that ships clips
  // autoplays its first one even without an interactive effect
  // (ItemAnimation's no-effect fallback) — static batching would freeze it.
  settled: (userData) => userData.itemModelSettled === true && userData.itemHasAnimations !== true,
}

// Mid-swing openings rebuild per tick off their animation record; the
// completion dirty mark re-joins them at the settled pose.
export const doorBatchable: BatchableConfig = {
  scope: 'wall',
  excluded: (node) => node.id in useInteractive.getState().doorAnimations,
}

export const windowBatchable: BatchableConfig = {
  scope: 'wall',
  excluded: (node) => node.id in useInteractive.getState().windowAnimations,
}

/** Imported meshes and blocks build their own geometry per node, rebuilt in place. */
export const perNodeGeometryBatchable: BatchableConfig = {
  scope: 'level',
  batchKey: nodeMeshBatchKey,
}
