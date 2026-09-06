/**
 * Panel state: the options form, the seed, and the last run's summary.
 */
import { create } from 'zustand'
import type { Finishes } from './finishes'
import type { FoundationChoice } from './foundation'
import type { PorchSummary } from './porch'
import { randomSeed } from './rng'
import type { RollOptions } from './roll'

export type RunSummary = {
  ok: boolean
  name: string
  seed: number | null
  template: string | null
  stats: {
    rooms: number
    walls: number
    doors: number
    windows: number
    zones: number
    livingSqFt: number
    footprintSqFt: number
    items: number
  } | null
  errors: string[]
  warnings: string[]
  placed: boolean
  /** The entrance that was built (porch.ts), when the run succeeded. */
  porch?: PorchSummary | null
  rear?: PorchSummary | null
  foundation?: FoundationChoice | null
  finishes?: Finishes | null
}

type GenerateState = {
  seed: number
  options: RollOptions
  running: boolean
  last: RunSummary | null
  setSeed: (seed: number) => void
  reroll: () => void
  setOptions: (patch: RollOptions) => void
  setRunning: (running: boolean) => void
  setLast: (last: RunSummary | null) => void
}

export const useGenerate = create<GenerateState>((set) => ({
  seed: randomSeed(),
  options: {},
  running: false,
  last: null,
  setSeed: (seed) => set({ seed }),
  reroll: () => set({ seed: randomSeed() }),
  setOptions: (patch) => set((s) => ({ options: { ...s.options, ...patch } })),
  setRunning: (running) => set({ running }),
  setLast: (last) => set({ last }),
}))
