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

export type DrawingAnnotationLayoutOverride = {
  dx: number
  dy: number
  pinned: true
}

export type DrawingAnnotationLayoutOverrides = Record<string, DrawingAnnotationLayoutOverride>

type DrawingViewState = {
  drawingType: ConstructionDrawingType
  drawingScale: DrawingSheetScale
  annotationLayoutOverrides: DrawingAnnotationLayoutOverrides
  setDrawingType: (drawingType: ConstructionDrawingType) => void
  setDrawingScale: (drawingScale: DrawingSheetScale) => void
  setAnnotationLayoutOverride: (
    id: string,
    override: DrawingAnnotationLayoutOverride | null,
  ) => void
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

export function normalizeAnnotationLayoutOverrides(
  value: unknown,
): DrawingAnnotationLayoutOverrides {
  if (!value || typeof value !== 'object') return {}
  const out: DrawingAnnotationLayoutOverrides = {}
  for (const [id, raw] of Object.entries(value)) {
    if (!id || !raw || typeof raw !== 'object') continue
    const dx = (raw as { dx?: unknown }).dx
    const dy = (raw as { dy?: unknown }).dy
    const pinned = (raw as { pinned?: unknown }).pinned
    if (
      typeof dx === 'number' &&
      Number.isFinite(dx) &&
      typeof dy === 'number' &&
      Number.isFinite(dy) &&
      pinned === true
    ) {
      out[id] = { dx, dy, pinned: true }
    }
  }
  return out
}

const useDrawingView = create<DrawingViewState>()(
  persist(
    (set) => ({
      drawingType: 'floor-plan',
      drawingScale: '1/4"=1\'-0"',
      annotationLayoutOverrides: {},
      setDrawingType: (drawingType) => set({ drawingType }),
      setDrawingScale: (drawingScale) => set({ drawingScale }),
      setAnnotationLayoutOverride: (id, override) =>
        set((state) => {
          const next = { ...state.annotationLayoutOverrides }
          if (override) next[id] = override
          else delete next[id]
          return { annotationLayoutOverrides: next }
        }),
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
        annotationLayoutOverrides: normalizeAnnotationLayoutOverrides(
          (persistedState as { annotationLayoutOverrides?: unknown } | undefined)
            ?.annotationLayoutOverrides,
        ),
      }),
      partialize: (state) => ({
        drawingType: state.drawingType,
        drawingScale: state.drawingScale,
        annotationLayoutOverrides: state.annotationLayoutOverrides,
      }),
    },
  ),
)

export default useDrawingView
