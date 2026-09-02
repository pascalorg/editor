/**
 * plugin-plans store — one run at a time, everything the overlay shows.
 *
 * A run is a sequence of STAGES against the Plans API (scene → project →
 * site/parcel → checks → documents). Each stage logs what the API actually
 * said — the workbench's rule carries over: the plugin has no private path
 * to the sheet engines, it is an HTTP client like PlanCrafters, so whatever
 * it prints is what the API returned, verbatim.
 */
import { create } from 'zustand'

export type StageStatus = 'pending' | 'running' | 'ok' | 'skipped' | 'failed'

export type StageLog = {
  id: string
  label: string
  status: StageStatus
  /** Wall time, ms. */
  ms?: number
  /** One-line result the API gave (counts, ids, warnings). */
  detail?: string
  /** Lines worth reading — defects, skips, notes — verbatim from the API. */
  lines?: string[]
}

export type Sheet = {
  id: string
  title: string
  /** Sheet number as printed on the title block (A0.0, A1.0 …). */
  number?: string
  svg: string
  viewBox?: string
  /** Defects / warnings the engine attached to this sheet. */
  notes?: string[]
}

export type RunState = 'idle' | 'running' | 'done' | 'failed'

export type PlansState = {
  open: boolean
  run: RunState
  startedAt?: number
  finishedAt?: number
  stages: StageLog[]
  sheets: Sheet[]
  /** Sheets the engine deliberately did not ship (e.g. T24 outside CA) — with its reason. */
  skipped: { id: string; reason: string }[]
  /** Set-level warnings from the API. */
  warnings: string[]
  error?: string
  /** Index of the sheet the viewer shows. */
  current: number
  /** The 3D snapshot captured for the cover, as a data URL (for the preview strip). */
  snapshot?: string
  /** Base URL of the Plans API. */
  apiBase: string

  setOpen: (open: boolean) => void
  setApiBase: (base: string) => void
  reset: () => void
  begin: (stages: { id: string; label: string }[]) => void
  stage: (id: string, patch: Partial<StageLog>) => void
  finish: (result: { sheets: Sheet[]; skipped: PlansState['skipped']; warnings: string[] }) => void
  fail: (error: string) => void
  setCurrent: (i: number) => void
  setSnapshot: (dataUrl?: string) => void
}

const DEFAULT_API = 'http://localhost:4100'

export const usePlans = create<PlansState>((set, get) => ({
  open: false,
  run: 'idle',
  stages: [],
  sheets: [],
  skipped: [],
  warnings: [],
  current: 0,
  apiBase: (() => {
    try {
      return localStorage.getItem('pascal-plans-api') || DEFAULT_API
    } catch {
      return DEFAULT_API
    }
  })(),

  setOpen: (open) => set({ open }),
  setApiBase: (apiBase) => {
    try {
      localStorage.setItem('pascal-plans-api', apiBase)
    } catch {}
    set({ apiBase })
  },
  reset: () => set({ run: 'idle', stages: [], sheets: [], skipped: [], warnings: [], error: undefined, current: 0, startedAt: undefined, finishedAt: undefined }),
  begin: (stages) =>
    set({
      run: 'running',
      startedAt: Date.now(),
      finishedAt: undefined,
      error: undefined,
      sheets: [],
      skipped: [],
      warnings: [],
      current: 0,
      stages: stages.map((s) => ({ ...s, status: 'pending' as StageStatus })),
    }),
  stage: (id, patch) =>
    set({ stages: get().stages.map((s) => (s.id === id ? { ...s, ...patch } : s)) }),
  finish: ({ sheets, skipped, warnings }) => set({ run: 'done', finishedAt: Date.now(), sheets, skipped, warnings, current: 0 }),
  fail: (error) => set({ run: 'failed', finishedAt: Date.now(), error }),
  setCurrent: (current) => set({ current: Math.max(0, Math.min(get().sheets.length - 1, current)) }),
  setSnapshot: (snapshot) => set({ snapshot }),
}))
