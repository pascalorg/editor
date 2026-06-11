// Ephemeral store for Figma-style alignment guides published during a
// move / placement drag. The producer (a tool or move overlay) writes
// guides on pointermove; the renderer (a 2D / 3D guide layer) subscribes
// and draws them. Both sides clear on commit, cancel, and unmount.

import type { AlignmentGuide } from '@pascal-app/core'
import { create } from 'zustand'

type AlignmentGuidesState = {
  guides: AlignmentGuide[]
  set(guides: AlignmentGuide[]): void
  clear(): void
}

const useAlignmentGuides = create<AlignmentGuidesState>((set) => ({
  guides: [],
  set: (guides) => set({ guides }),
  clear: () => set({ guides: [] }),
}))

export default useAlignmentGuides
