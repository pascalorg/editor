import type { Object3D } from 'three'

const pendingIds = new Set<string>()
/** Preferred root for footprint math (Clone root). Falls back to sceneRegistry item root. */
const sourceRoots = new Map<string, Object3D>()

/** Called when an item's loaded GLTF (or metadata driving footprint) may need re-syncing. */
export function requestItemMeshMetadataSync(itemId: string) {
  pendingIds.add(itemId)
}

export function setItemMeshMetadataSourceRoot(itemId: string, root: Object3D | null) {
  if (root) {
    sourceRoots.set(itemId, root)
  } else {
    sourceRoots.delete(itemId)
  }
}

export function getItemMeshMetadataSourceRoot(itemId: string): Object3D | undefined {
  return sourceRoots.get(itemId)
}

export function drainItemMeshMetadataSyncRequests(): string[] {
  if (pendingIds.size === 0) return []
  const ids = [...pendingIds]
  pendingIds.clear()
  return ids
}
