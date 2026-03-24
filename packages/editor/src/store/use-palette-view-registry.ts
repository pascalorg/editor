import type { ComponentType } from 'react'
import { create } from 'zustand'

export type PaletteViewProps = {
  onClose: () => void
  onBack: () => void
}

export type PaletteView = {
  /** Unique key — matches a page name or a mode name. */
  key: string
  /**
   * `'page'` — renders inside the cmdk Command shell (list area only).
   * Filtering and keyboard navigation still work.
   *
   * `'mode'` — replaces the entire cmdk shell inside the Dialog.
   * Used for full-screen states like ai-executing or ai-review.
   */
  type: 'page' | 'mode'
  /** Human-readable label shown as the breadcrumb for page views. */
  label?: string
  Component: ComponentType<PaletteViewProps>
}

interface PaletteViewRegistryStore {
  views: Map<string, PaletteView>
  register: (view: PaletteView) => () => void
}

export const usePaletteViewRegistry = create<PaletteViewRegistryStore>((set) => ({
  views: new Map(),
  register: (view) => {
    set((s) => {
      const next = new Map(s.views)
      next.set(view.key, view)
      return { views: next }
    })
    return () =>
      set((s) => {
        const next = new Map(s.views)
        next.delete(view.key)
        return { views: next }
      })
  },
}))
