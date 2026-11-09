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
  type FloorplanWallDimensionFaces,
  normalizeFloorplanWallDimensionFaces,
} from '../lib/floorplan/floorplan-extension'

type PersistedFloorplanAnnotationState = {
  visibility: FloorplanAnnotationVisibility
  showDimensions: boolean
  wallDimensionFaces: FloorplanWallDimensionFaces
}

type FloorplanAnnotationVisibilityState = PersistedFloorplanAnnotationState & {
  setCategory: (category: FloorplanAnnotationCategory, visible: boolean) => void
  setShowDimensions: (shown: boolean) => void
  setWallDimensionFaces: (faces: FloorplanWallDimensionFaces) => void
  reset: () => void
}

const defaultState = (): PersistedFloorplanAnnotationState => ({
  visibility: { ...DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY },
  showDimensions: true,
  wallDimensionFaces: DEFAULT_FLOORPLAN_WALL_DIMENSION_FACES,
})

/**
 * The persisted part of the store, read back from storage. Anything stale or
 * unknown (an older shape, a retired `wallDimensionReference`) falls back to
 * the default.
 */
function normalizeFloorplanAnnotationState(persisted: unknown): PersistedFloorplanAnnotationState {
  const record = (persisted && typeof persisted === 'object' ? persisted : {}) as Record<
    string,
    unknown
  >
  return {
    visibility: normalizeFloorplanAnnotationVisibility(record.visibility),
    showDimensions: record.showDimensions !== false,
    wallDimensionFaces: normalizeFloorplanWallDimensionFaces(record.wallDimensionFaces),
  }
}

/**
 * Display preferences for dimensions and annotations, kept per browser:
 * Display → Dimensions (`showDimensions`) and Measure walls
 * (`wallDimensionFaces`) apply to the plan and the 3D view; `visibility` is
 * the Expert plan's annotation categories.
 */
const useFloorplanAnnotationVisibility = create<FloorplanAnnotationVisibilityState>()(
  persist(
    (set) => ({
      ...defaultState(),
      setCategory: (category, visible) =>
        set((state) => ({ visibility: { ...state.visibility, [category]: visible } })),
      setShowDimensions: (showDimensions) => set({ showDimensions }),
      setWallDimensionFaces: (wallDimensionFaces) => set({ wallDimensionFaces }),
      reset: () => set(defaultState()),
    }),
    {
      name: 'pascal-floorplan-annotation-visibility',
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...normalizeFloorplanAnnotationState(persistedState),
      }),
      partialize: (state) =>
        ({
          visibility: state.visibility,
          showDimensions: state.showDimensions,
          wallDimensionFaces: state.wallDimensionFaces,
        }) as FloorplanAnnotationVisibilityState,
    },
  ),
)

export default useFloorplanAnnotationVisibility
