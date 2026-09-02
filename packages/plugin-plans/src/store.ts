/**
 * plugin-plans store — the open set, the run behind it, and the settings.
 *
 * Everything shown is what the Plans API returned. The plugin has no private
 * path to the sheet engines; it is an HTTP client like PlanCrafters.
 */
import { create } from 'zustand'
import type { SheetManifest } from './api'

export type StageStatus = 'pending' | 'running' | 'ok' | 'skipped' | 'failed'
export type StageLog = { id: string; label: string; status: StageStatus; ms?: number; detail?: string; lines?: string[] }

export type Sheet = {
  id: string
  title: string
  number: string
  svg: string
  viewBox?: string
  manifest?: SheetManifest
}

export type RunState = 'idle' | 'running' | 'done' | 'failed'

export interface Settings {
  elevations: boolean
  sections: boolean
  energySheet: boolean
  /** Title-block date; empty = as the API prints it. */
  date: string
  /** Title-block DRAWN BY; empty = the designer's name from the project record. */
  drawnBy: string
  /** Send the 3D view for the cover and R1.0. */
  coverFromView: boolean
}

export const DEFAULT_SETTINGS: Settings = { elevations: true, sections: true, energySheet: true, date: '', drawnBy: '', coverFromView: true }

export type PlansState = {
  open: boolean
  run: RunState
  startedAt?: number
  finishedAt?: number
  stages: StageLog[]
  sheets: Sheet[]
  skipped: { id: string; reason: string }[]
  warnings: string[]
  draft?: { watermarked: boolean; missing: string[]; because?: string } | null
  error?: string
  current: number
  snapshot?: string
  apiBase: string
  settings: Settings
  /** Sheet numbers being re-rendered right now (after a site edit). */
  rendering: string[]
  /** What the last full run sent, so one sheet can be re-rendered the same way. */
  lastRequest?: { project?: Record<string, unknown>; options: Record<string, unknown> }
  showWarnings: boolean
  editingProject: boolean

  setOpen: (open: boolean) => void
  setApiBase: (base: string) => void
  setSettings: (patch: Partial<Settings>) => void
  begin: (stages: { id: string; label: string }[]) => void
  stage: (id: string, patch: Partial<StageLog>) => void
  finish: (result: { sheets: Sheet[]; skipped: PlansState['skipped']; warnings: string[]; draft?: PlansState['draft'] }) => void
  fail: (error: string) => void
  setCurrent: (i: number) => void
  selectSheet: (number: string) => void
  setSnapshot: (dataUrl?: string) => void
  setRendering: (numbers: string[]) => void
  replaceSheets: (sheets: Sheet[]) => void
  setLastRequest: (r: PlansState['lastRequest']) => void
  setShowWarnings: (v: boolean) => void
  setEditingProject: (v: boolean) => void
}

const DEFAULT_API = 'http://localhost:4100'

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem('pascal-plans-settings')
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) } : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

export const usePlans = create<PlansState>((set, get) => ({
  open: false,
  run: 'idle',
  stages: [],
  sheets: [],
  skipped: [],
  warnings: [],
  current: 0,
  rendering: [],
  showWarnings: false,
  editingProject: false,
  apiBase: (() => {
    try {
      return localStorage.getItem('pascal-plans-api') || DEFAULT_API
    } catch {
      return DEFAULT_API
    }
  })(),
  settings: loadSettings(),

  setOpen: (open) => set({ open }),
  setApiBase: (apiBase) => {
    try {
      localStorage.setItem('pascal-plans-api', apiBase)
    } catch {}
    set({ apiBase })
  },
  setSettings: (patch) => {
    const settings = { ...get().settings, ...patch }
    try {
      localStorage.setItem('pascal-plans-settings', JSON.stringify(settings))
    } catch {}
    set({ settings })
  },
  begin: (stages) =>
    set({ run: 'running', startedAt: Date.now(), finishedAt: undefined, error: undefined, stages: stages.map((s) => ({ ...s, status: 'pending' as StageStatus })) }),
  stage: (id, patch) => set({ stages: get().stages.map((s) => (s.id === id ? { ...s, ...patch } : s)) }),
  finish: ({ sheets, skipped, warnings, draft }) => {
    const prev = get().sheets[get().current]?.number
    const keep = prev ? sheets.findIndex((s) => s.number === prev) : -1
    set({ run: 'done', finishedAt: Date.now(), sheets, skipped, warnings, draft: draft ?? null, current: keep >= 0 ? keep : 0 })
  },
  fail: (error) => set({ run: 'failed', finishedAt: Date.now(), error }),
  setCurrent: (current) => set({ current: Math.max(0, Math.min(get().sheets.length - 1, current)) }),
  selectSheet: (number) => {
    const i = get().sheets.findIndex((s) => s.number === number)
    if (i >= 0) set({ current: i })
  },
  setSnapshot: (snapshot) => set({ snapshot }),
  setRendering: (rendering) => set({ rendering }),
  replaceSheets: (fresh) => {
    const byNum = new Map(fresh.map((s) => [s.number, s]))
    set({ sheets: get().sheets.map((s) => byNum.get(s.number) ?? s) })
  },
  setLastRequest: (lastRequest) => set({ lastRequest }),
  setShowWarnings: (showWarnings) => set({ showWarnings }),
  setEditingProject: (editingProject) => set({ editingProject }),
}))
