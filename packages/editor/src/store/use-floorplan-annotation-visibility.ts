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
  DEFAULT_FLOORPLAN_WALL_DIMENSION_FACES,
  DEFAULT_FLOORPLAN_WALL_DIMENSION_REFERENCE,
  type FloorplanWallDimensionFaces,
  type FloorplanWallDimensionReference,
  normalizeFloorplanWallDimensionFaces,
  normalizeFloorplanWallDimensionReference,
} from '../lib/floorplan/floorplan-extension'

type FloorplanAnnotationVisibilityState = {
  visibility: FloorplanAnnotationVisibility
  wallDimensionReference: FloorplanWallDimensionReference
  /** What a selected wall's temporary dimensions measure to, in 2D and 3D. */
  wallDimensionFaces: FloorplanWallDimensionFaces
  setCategory: (category: FloorplanAnnotationCategory, visible: boolean) => void
  setWallDimensionReference: (reference: FloorplanWallDimensionReference) => void
  setWallDimensionFaces: (faces: FloorplanWallDimensionFaces) => void
  reset: () => void
}

const useFloorplanAnnotationVisibility = create<FloorplanAnnotationVisibilityState>()(
  persist(
    (set) => ({
      visibility: { ...DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY },
      wallDimensionReference: DEFAULT_FLOORPLAN_WALL_DIMENSION_REFERENCE,
      wallDimensionFaces: DEFAULT_FLOORPLAN_WALL_DIMENSION_FACES,
      setCategory: (category, visible) =>
        set((state) => ({ visibility: { ...state.visibility, [category]: visible } })),
      setWallDimensionReference: (wallDimensionReference) => set({ wallDimensionReference }),
      setWallDimensionFaces: (wallDimensionFaces) => set({ wallDimensionFaces }),
      reset: () =>
        set({
          visibility: { ...DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY },
          wallDimensionReference: DEFAULT_FLOORPLAN_WALL_DIMENSION_REFERENCE,
          wallDimensionFaces: DEFAULT_FLOORPLAN_WALL_DIMENSION_FACES,
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
        wallDimensionFaces: normalizeFloorplanWallDimensionFaces(
          (persistedState as { wallDimensionFaces?: unknown } | undefined)?.wallDimensionFaces,
        ),
      }),
      partialize: (state) =>
        ({
          visibility: state.visibility,
          wallDimensionReference: state.wallDimensionReference,
          wallDimensionFaces: state.wallDimensionFaces,
        }) as FloorplanAnnotationVisibilityState,
    },
  ),
)

export default useFloorplanAnnotationVisibility
