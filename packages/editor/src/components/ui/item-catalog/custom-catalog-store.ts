import type { AssetInput } from '@pascal-app/core'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type CustomCatalogState = {
  customItems: AssetInput[]
  addItem: (item: AssetInput) => void
  removeItem: (id: string) => void
  clearItems: () => void
}

export const useCustomCatalog = create<CustomCatalogState>()(
  persist(
    (set, get) => ({
      customItems: [],
      addItem: (item) => {
        const exists = get().customItems.some((entry) => entry.id === item.id)
        if (exists) {
          set({
            customItems: get().customItems.map((entry) => (entry.id === item.id ? item : entry)),
          })
          return
        }
        set({ customItems: [...get().customItems, item] })
      },
      removeItem: (id) => {
        set({ customItems: get().customItems.filter((entry) => entry.id !== id) })
      },
      clearItems: () => set({ customItems: [] }),
    }),
    { name: 'pascal-custom-catalog-v1' },
  ),
)

export function getCustomCatalogItems(): AssetInput[] {
  return useCustomCatalog.getState().customItems
}
