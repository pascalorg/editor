'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY,
  type FloorplanAnnotationCategory,
  type FloorplanAnnotationVisibility,
  normalizeFloorplanAnnotationVisibility,
} from '../lib/floorplan/annotation-visibility'
import {
  DEFAULT_FLOORPLAN_WALL_DIMENSION_REFERENCE,
  type FloorplanWallDimensionReference,
  normalizeFloorplanWallDimensionReference,
} from '../lib/floorplan/floorplan-extension'

type FloorplanAnnotationVisibilityState = {
  visibility: FloorplanAnnotationVisibility
  wallDimensionReference: FloorplanWallDimensionReference
  setCategory: (category: FloorplanAnnotationCategory, visible: boolean) => void
  setWallDimensionReference: (reference: FloorplanWallDimensionReference) => void
  reset: () => void
}

const useFloorplanAnnotationVisibility = create<FloorplanAnnotationVisibilityState>()(
  persist(
    (set) => ({
      visibility: { ...DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY },
      wallDimensionReference: DEFAULT_FLOORPLAN_WALL_DIMENSION_REFERENCE,
      setCategory: (category, visible) =>
        set((state) => ({ visibility: { ...state.visibility, [category]: visible } })),
      setWallDimensionReference: (wallDimensionReference) => set({ wallDimensionReference }),
      reset: () =>
        set({
          visibility: { ...DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY },
          wallDimensionReference: DEFAULT_FLOORPLAN_WALL_DIMENSION_REFERENCE,
        }),
    }),
    {
      name: 'pascal-floorplan-annotation-visibility',
      merge: (persistedState, currentState) => ({
        ...currentState,
        visibility: normalizeFloorplanAnnotationVisibility(
          (persistedState as { visibility?: unknown } | undefined)?.visibility,
        ),
        wallDimensionReference: normalizeFloorplanWallDimensionReference(
          (persistedState as { wallDimensionReference?: unknown } | undefined)
            ?.wallDimensionReference,
        ),
      }),
      partialize: (state) =>
        ({
          visibility: state.visibility,
          wallDimensionReference: state.wallDimensionReference,
        }) as FloorplanAnnotationVisibilityState,
    },
  ),
)

export default useFloorplanAnnotationVisibility
