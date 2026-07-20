'use client'

import { CONSTRUCTION_DRAWING_TYPES, type ConstructionDrawingType } from '@pascal-app/core'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const DRAWING_TYPE_OPTIONS = [
  { id: 'floor-plan', label: 'Floor plan' },
  { id: 'foundation-plan', label: 'Foundation plan' },
  { id: 'reflected-ceiling-plan', label: 'Reflected ceiling plan' },
  { id: 'roof-plan', label: 'Roof plan' },
  { id: 'site-plan', label: 'Site plan' },
] as const satisfies readonly { id: ConstructionDrawingType; label: string }[]

type DrawingViewState = {
  drawingType: ConstructionDrawingType
  setDrawingType: (drawingType: ConstructionDrawingType) => void
}

export function normalizeDrawingType(value: unknown): ConstructionDrawingType {
  if (typeof value !== 'string') return 'floor-plan'
  for (const drawingType of CONSTRUCTION_DRAWING_TYPES) {
    if (drawingType === value) return drawingType
  }
  return 'floor-plan'
}

const useDrawingView = create<DrawingViewState>()(
  persist(
    (set) => ({
      drawingType: 'floor-plan',
      setDrawingType: (drawingType) => set({ drawingType }),
    }),
    {
      name: 'pascal-floorplan-drawing-view',
      merge: (persistedState, currentState) => ({
        ...currentState,
        drawingType: normalizeDrawingType(
          (persistedState as { drawingType?: unknown } | undefined)?.drawingType,
        ),
      }),
      partialize: (state) => ({ drawingType: state.drawingType }) as DrawingViewState,
    },
  ),
)

export default useDrawingView
