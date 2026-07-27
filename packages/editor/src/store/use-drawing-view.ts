'use client'

import type { ConstructionDrawingType } from '@pascal-app/core'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const DRAWING_TYPE_OPTIONS = [
  { id: 'floor-plan', label: 'Floor plan' },
  { id: 'foundation-plan', label: 'Foundation plan' },
  { id: 'reflected-ceiling-plan', label: 'Reflected ceiling plan' },
  { id: 'roof-plan', label: 'Roof plan' },
  { id: 'site-plan', label: 'Site plan' },
] as const satisfies readonly { id: ConstructionDrawingType; label: string }[]

export type DrawingAnnotationLayoutOverride = {
  dx: number
  dy: number
  pinned: true
}

export type DrawingAnnotationLayoutOverrides = Record<string, DrawingAnnotationLayoutOverride>

type DrawingViewState = {
  drawingType: Extract<ConstructionDrawingType, 'floor-plan'>
  annotationLayoutOverrides: DrawingAnnotationLayoutOverrides
  setAnnotationLayoutOverride: (
    id: string,
    override: DrawingAnnotationLayoutOverride | null,
  ) => void
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
      annotationLayoutOverrides: {},
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
        annotationLayoutOverrides: normalizeAnnotationLayoutOverrides(
          (persistedState as { annotationLayoutOverrides?: unknown } | undefined)
            ?.annotationLayoutOverrides,
        ),
      }),
      partialize: (state) => ({
        annotationLayoutOverrides: state.annotationLayoutOverrides,
      }),
    },
  ),
)

export default useDrawingView
