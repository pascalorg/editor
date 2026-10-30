// Ephemeral store for Figma-style alignment guides published during a
// move / placement drag. The producer (a tool or move overlay) writes
// guides on pointermove; the renderer (a 2D / 3D guide layer) subscribes
// and draws them. Both sides clear on commit, cancel, and unmount.

import type { AlignmentGuide } from '@pascal-app/core'
import { create } from 'zustand'

/**
 * A wall draft's dashed projection guide, in building-local plan coordinates:
 * the extension of the wall the draft comes from, a line through another wall's
 * end on one of the house's axes, or the same through the run's start.
 */
export type DraftGuideLine = {
  kind: 'extension' | 'alignment' | 'run-start'
  from: [number, number]
  to: [number, number]
}

/**
 * The projection guides of a wall pulled from a selected wall's end (and of
 * the run it continues): dashed lines, and markers where two of them cross.
 */
export type DraftGuides = {
  lines: DraftGuideLine[]
  intersections: Array<[number, number]>
}

type AlignmentGuidesState = {
  guides: AlignmentGuide[]
  /** A wall draft's projection guides, drawn by the same layers; null when none. */
  draft: DraftGuides | null
  set(guides: AlignmentGuide[]): void
  /** Publish a wall draft's projection guides, which take the place of alignment guides. */
  setDraft(draft: DraftGuides | null): void
  clear(): void
}

const useAlignmentGuides = create<AlignmentGuidesState>((set) => ({
  guides: [],
  draft: null,
  set: (guides) => set({ guides }),
  setDraft: (draft) => set({ guides: [], draft }),
  clear: () => set({ guides: [], draft: null }),
}))

export default useAlignmentGuides
