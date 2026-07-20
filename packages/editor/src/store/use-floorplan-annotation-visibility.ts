'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY,
  type FloorplanAnnotationCategory,
  type FloorplanAnnotationVisibility,
  normalizeFloorplanAnnotationVisibility,
} from '../lib/floorplan/annotation-visibility'

type FloorplanAnnotationVisibilityState = {
  visibility: FloorplanAnnotationVisibility
  setCategory: (category: FloorplanAnnotationCategory, visible: boolean) => void
  reset: () => void
}

const useFloorplanAnnotationVisibility = create<FloorplanAnnotationVisibilityState>()(
  persist(
    (set) => ({
      visibility: { ...DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY },
      setCategory: (category, visible) =>
        set((state) => ({ visibility: { ...state.visibility, [category]: visible } })),
      reset: () => set({ visibility: { ...DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY } }),
    }),
    {
      name: 'pascal-floorplan-annotation-visibility',
      merge: (persistedState, currentState) => ({
        ...currentState,
        visibility: normalizeFloorplanAnnotationVisibility(
          (persistedState as { visibility?: unknown } | undefined)?.visibility,
        ),
      }),
      partialize: (state) =>
        ({ visibility: state.visibility }) as FloorplanAnnotationVisibilityState,
    },
  ),
)

export default useFloorplanAnnotationVisibility
