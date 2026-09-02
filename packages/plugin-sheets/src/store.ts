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
  setSheet: (id: string | null) => void
  select: (id: string | null) => void
  setEditingProject: (value: boolean) => void
  setPanel: (panel: SheetsState['panel']) => void
  setView: (zoom: number, pan: { x: number; y: number }) => void
  setBusy: (busy: SheetsBusy) => void
  setMessage: (message: string | null) => void
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
  setSheet: (sheetId) => set({ sheetId, selectedViewportId: null }),
  select: (selectedViewportId) => set({ selectedViewportId }),
  setEditingProject: (editingProject) => set({ editingProject }),
  setPanel: (panel) => set({ panel }),
  setView: (zoom, pan) => set({ zoom, pan }),
  setBusy: (busy) => set({ busy }),
  setMessage: (message) => set({ message }),
}))
