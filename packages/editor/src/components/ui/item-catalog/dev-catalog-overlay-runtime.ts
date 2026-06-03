import type { AssetInput } from '@pascal-app/core'

/** In-memory dev catalog overlay (filled from API JSON on the client). */
let runtimeItems: AssetInput[] = []

export function getDevCatalogOverlayItems(): AssetInput[] {
  return runtimeItems
}

export function setDevCatalogOverlayRuntimeItems(items: AssetInput[]): void {
  runtimeItems = items
}

export function upsertDevCatalogOverlayRuntimeItem(item: AssetInput): void {
  const index = runtimeItems.findIndex((entry) => entry.id === item.id)
  if (index >= 0) {
    runtimeItems = runtimeItems.map((entry) => (entry.id === item.id ? item : entry))
  } else {
    runtimeItems = [...runtimeItems, item]
  }
}

export function removeDevCatalogOverlayRuntimeItem(id: string): void {
  runtimeItems = runtimeItems.filter((entry) => entry.id !== id)
}
