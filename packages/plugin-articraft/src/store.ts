import { create } from 'zustand'
import type {
  ArticraftCatalogItem,
  ArticraftGeneration,
  ArticraftGenerationDraft,
  ArticraftGenerationQueueItem,
} from './types'

type ArticraftStore = {
  generationQueue: ArticraftGenerationQueueItem[]
  addGeneration: (generation: ArticraftGeneration, draft: ArticraftGenerationDraft) => void
  removeGeneration: (id: string) => void
  selectedItem: ArticraftCatalogItem | null
  setSelectedItem: (item: ArticraftCatalogItem) => void
  updateGeneration: (generation: ArticraftGeneration) => void
}

export const useArticraftStore = create<ArticraftStore>((set) => ({
  generationQueue: [],
  addGeneration: (generation, draft) =>
    set((state) => ({
      generationQueue: [
        { createdAt: Date.now(), draft, generation },
        ...state.generationQueue.filter((entry) => entry.generation.id !== generation.id),
      ],
    })),
  removeGeneration: (id) =>
    set((state) => ({
      generationQueue: state.generationQueue.filter((entry) => entry.generation.id !== id),
    })),
  selectedItem: null,
  setSelectedItem: (selectedItem) => set({ selectedItem }),
  updateGeneration: (generation) =>
    set((state) => ({
      generationQueue: state.generationQueue.map((entry) =>
        entry.generation.id === generation.id ? { ...entry, generation } : entry,
      ),
    })),
}))
