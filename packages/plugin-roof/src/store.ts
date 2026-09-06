import { create } from 'zustand'
import type { AutoRoofResult, RoofForm } from './derive'

export type AutoRoofOptions = {
  /** 'auto' follows the style's roof form (gable / hip / shed per the vocabulary). */
  form: RoofForm | 'auto'
  pitchTwelfths: number
  overhangIn: number
  /** Style key, or '' for none (the form then applies to every mass). */
  style: string
}

export type AutoRoofRun = {
  at: string
  levelId: string | null
  segments: number
  masses: number
  coverage: number
  popped: boolean
  warnings: string[]
  roles: Record<string, string>
  errors: string[]
}

type AutoRoofState = {
  options: AutoRoofOptions
  running: boolean
  last: AutoRoofRun | null
  setOptions: (patch: Partial<AutoRoofOptions>) => void
  setRunning: (running: boolean) => void
  setLast: (last: AutoRoofRun | null) => void
}

export const useAutoRoof = create<AutoRoofState>((set) => ({
  options: { form: 'auto', pitchTwelfths: 6, overhangIn: 16, style: '' },
  running: false,
  last: null,
  setOptions: (patch) => set((s) => ({ options: { ...s.options, ...patch } })),
  setRunning: (running) => set({ running }),
  setLast: (last) => set({ last }),
}))

export const summarise = (levelId: string | null, r: AutoRoofResult): AutoRoofRun => ({
  at: new Date().toISOString(),
  levelId,
  segments: r.segments.length,
  masses: r.masses,
  coverage: r.coverage,
  popped: r.popped,
  warnings: r.warnings,
  roles: r.roles,
  errors: r.ok ? [] : ['no roof could be derived'],
})
