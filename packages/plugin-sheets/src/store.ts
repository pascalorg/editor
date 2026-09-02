/**
 * UI state only. Everything that belongs to the document lives in the scene
 * (`model.ts`); this store holds what a session cares about — which sheet is
 * open, what is selected, where the paper is panned to, and whether a long
 * job is running.
 */
import { create } from 'zustand'

export type SheetsBusy = { label: string } | null

type SheetsState = {
  sheetId: string | null
  selectedViewportId: string | null
  editingProject: boolean
  panel: 'sheets' | 'layers' | 'settings'
  /** Paper zoom, in screen pixels per sheet inch. */
  zoom: number
  pan: { x: number; y: number }
  busy: SheetsBusy
  message: string | null
  /**
   * Why a view3d viewport has no image, keyed by viewport id. Session state,
   * not document state: a failure is about this browser tab, not the scene.
   */
  captureNotes: Record<string, string>
  /** Viewport ids auto-capture has already tried this session. */
  captureTried: Record<string, true>
  setSheet: (id: string | null) => void
  select: (id: string | null) => void
  setEditingProject: (value: boolean) => void
  setPanel: (panel: SheetsState['panel']) => void
  setView: (zoom: number, pan: { x: number; y: number }) => void
  setBusy: (busy: SheetsBusy) => void
  setMessage: (message: string | null) => void
  markCaptureTried: (id: string) => void
  setCaptureNote: (id: string, note: string | null) => void
}

export const useSheets = create<SheetsState>((set) => ({
  sheetId: null,
  selectedViewportId: null,
  editingProject: false,
  panel: 'sheets',
  zoom: 24,
  pan: { x: 0, y: 0 },
  busy: null,
  message: null,
  captureNotes: {},
  captureTried: {},
  setSheet: (sheetId) => set({ sheetId, selectedViewportId: null }),
  select: (selectedViewportId) => set({ selectedViewportId }),
  setEditingProject: (editingProject) => set({ editingProject }),
  setPanel: (panel) => set({ panel }),
  setView: (zoom, pan) => set({ zoom, pan }),
  setBusy: (busy) => set({ busy }),
  setMessage: (message) => set({ message }),
  markCaptureTried: (id) =>
    set((state) => ({ captureTried: { ...state.captureTried, [id]: true } })),
  setCaptureNote: (id, note) =>
    set((state) => {
      const next = { ...state.captureNotes }
      if (note === null) delete next[id]
      else next[id] = note
      return { captureNotes: next }
    }),
}))
