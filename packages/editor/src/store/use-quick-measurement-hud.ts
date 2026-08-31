import type { QuickMeasurementReport } from '@pascal-app/core'
import { create } from 'zustand'
import type { ViewMode } from './use-editor'

export type QuickMeasurementHudSource = '2d' | '3d'

export type QuickMeasurementHudEntry = {
  lensState: 'live' | 'pinned'
  report: QuickMeasurementReport
}

export type QuickMeasurementHudState = {
  activeSource: QuickMeasurementHudSource | null
  sources: Record<QuickMeasurementHudSource, QuickMeasurementHudEntry | null>
  activate(source: QuickMeasurementHudSource): void
  clear(source: QuickMeasurementHudSource): void
  publish(source: QuickMeasurementHudSource, entry: QuickMeasurementHudEntry | null): void
}

export const useQuickMeasurementHud = create<QuickMeasurementHudState>((set) => ({
  activeSource: null,
  sources: { '2d': null, '3d': null },
  activate: (source) =>
    set((state) => (state.activeSource === source ? state : { activeSource: source })),
  clear: (source) =>
    set((state) => {
      if (state.sources[source] === null && state.activeSource !== source) return state
      const sibling = source === '2d' ? '3d' : '2d'
      return {
        activeSource:
          state.activeSource === source
            ? state.sources[sibling]
              ? sibling
              : null
            : state.activeSource,
        sources: { ...state.sources, [source]: null },
      }
    }),
  publish: (source, entry) =>
    set((state) => {
      const current = state.sources[source]
      if (
        current?.report === entry?.report &&
        current?.lensState === entry?.lensState &&
        Boolean(current) === Boolean(entry)
      ) {
        return state
      }
      return {
        activeSource: state.activeSource ?? (entry ? source : null),
        sources: { ...state.sources, [source]: entry },
      }
    }),
}))

export function selectQuickMeasurementHudEntry(
  state: QuickMeasurementHudState,
  viewMode: ViewMode,
): QuickMeasurementHudEntry | null {
  const source = viewMode === 'split' ? state.activeSource : viewMode
  return source ? state.sources[source] : null
}

export function activateQuickMeasurementHudSource(source: QuickMeasurementHudSource) {
  useQuickMeasurementHud.getState().activate(source)
}

export function publishQuickMeasurementHudSource(
  source: QuickMeasurementHudSource,
  entry: QuickMeasurementHudEntry | null,
) {
  useQuickMeasurementHud.getState().publish(source, entry)
}

export function clearQuickMeasurementHudSource(source: QuickMeasurementHudSource) {
  useQuickMeasurementHud.getState().clear(source)
}
