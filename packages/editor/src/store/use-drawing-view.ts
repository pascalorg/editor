'use client'

import {
  CONSTRUCTION_DRAWING_TYPES,
  type ConstructionDrawingType,
  type DrawingSheetScale,
} from '@pascal-app/core'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const DRAWING_TYPE_OPTIONS = [
  { id: 'floor-plan', label: 'Floor plan' },
  { id: 'foundation-plan', label: 'Foundation plan' },
  { id: 'reflected-ceiling-plan', label: 'Reflected ceiling plan' },
  { id: 'roof-plan', label: 'Roof plan' },
  { id: 'site-plan', label: 'Site plan' },
] as const satisfies readonly { id: ConstructionDrawingType; label: string }[]

export const DRAWING_SCALE_OPTIONS = [
  { id: '1:20', label: '1:20' },
  { id: '1:25', label: '1:25' },
  { id: '1:50', label: '1:50' },
  { id: '1:75', label: '1:75' },
  { id: '1:100', label: '1:100' },
  { id: '1/8"=1\'-0"', label: '1/8" = 1\'-0"' },
  { id: '1/4"=1\'-0"', label: '1/4" = 1\'-0"' },
  { id: '1/2"=1\'-0"', label: '1/2" = 1\'-0"' },
  { id: '1"=1\'-0"', label: '1" = 1\'-0"' },
] as const satisfies readonly { id: DrawingSheetScale; label: string }[]

type DrawingViewState = {
  drawingType: ConstructionDrawingType
  drawingScale: DrawingSheetScale
  setDrawingType: (drawingType: ConstructionDrawingType) => void
  setDrawingScale: (drawingScale: DrawingSheetScale) => void
}

export function normalizeDrawingType(value: unknown): ConstructionDrawingType {
  if (typeof value !== 'string') return 'floor-plan'
  for (const drawingType of CONSTRUCTION_DRAWING_TYPES) {
    if (drawingType === value) return drawingType
  }
  return 'floor-plan'
}

export function normalizeDrawingScale(value: unknown): DrawingSheetScale {
  if (typeof value !== 'string') return '1/4"=1\'-0"'
  for (const option of DRAWING_SCALE_OPTIONS) {
    if (option.id === value) return option.id
  }
  return '1/4"=1\'-0"'
}

const useDrawingView = create<DrawingViewState>()(
  persist(
    (set) => ({
      drawingType: 'floor-plan',
      drawingScale: '1/4"=1\'-0"',
      setDrawingType: (drawingType) => set({ drawingType }),
      setDrawingScale: (drawingScale) => set({ drawingScale }),
    }),
    {
      name: 'pascal-floorplan-drawing-view',
      merge: (persistedState, currentState) => ({
        ...currentState,
        drawingType: normalizeDrawingType(
          (persistedState as { drawingType?: unknown } | undefined)?.drawingType,
        ),
        drawingScale: normalizeDrawingScale(
          (persistedState as { drawingScale?: unknown } | undefined)?.drawingScale,
        ),
      }),
      partialize: (state) => ({
        drawingType: state.drawingType,
        drawingScale: state.drawingScale,
      }),
    },
  ),
)

export default useDrawingView
