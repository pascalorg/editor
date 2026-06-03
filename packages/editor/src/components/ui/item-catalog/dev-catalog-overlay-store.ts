'use client'

import type { AssetInput } from '@pascal-app/core'
import { create } from 'zustand'
import {
  removeDevCatalogOverlayRuntimeItem,
  setDevCatalogOverlayRuntimeItems,
  upsertDevCatalogOverlayRuntimeItem,
} from './dev-catalog-overlay-runtime'

type DevCatalogOverlayState = {
  revision: number
  loaded: boolean
  upsertItem: (item: AssetInput) => void
  removeItem: (id: string) => void
  reloadFromServer: () => Promise<void>
}

export const useDevCatalogOverlay = create<DevCatalogOverlayState>()((set, get) => ({
  revision: 0,
  loaded: false,
  upsertItem: (item) => {
    upsertDevCatalogOverlayRuntimeItem(item)
    set((state) => ({ revision: state.revision + 1, loaded: true }))
  },
  removeItem: (id) => {
    removeDevCatalogOverlayRuntimeItem(id)
    set((state) => ({ revision: state.revision + 1, loaded: true }))
  },
  reloadFromServer: async () => {
    try {
      const response = await fetch('/api/catalog-items/dev-overlay', { cache: 'no-store' })
      if (!response.ok) return
      const body = (await response.json()) as { items?: AssetInput[] }
      setDevCatalogOverlayRuntimeItems(body.items ?? [])
      set((state) => ({ revision: state.revision + 1, loaded: true }))
    } catch {
      // Dev-only endpoint; ignore when unavailable.
    }
  },
}))
