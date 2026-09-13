/**
 * Panel state shared by the Lot panel and the Generate panel's lot box: the
 * address query, a picked suggestion or preset, the run flag and the last
 * result — one store so both panels show the same thing.
 */
import type { LotDropInResult } from '@pascal-app/editor'
import { create } from 'zustand'

export interface Suggestion {
  label?: string
  line1?: string
  line2?: string
  city?: string
  state?: string
  postcode?: string
  lat?: number
  lng?: number
}

type LotState = {
  query: string
  picked: Suggestion | null
  /** Index into PRESET_LOTS, or -1 for a typed address. */
  preset: number
  busy: boolean
  status: string | null
  last: LotDropInResult | null
  setQuery: (query: string) => void
  setPicked: (picked: Suggestion | null) => void
  setPreset: (preset: number) => void
  setBusy: (busy: boolean) => void
  setStatus: (status: string | null) => void
  setLast: (last: LotDropInResult | null) => void
}

export const useLot = create<LotState>((set) => ({
  query: '',
  picked: null,
  preset: -1,
  busy: false,
  status: null,
  last: null,
  setQuery: (query) => set({ query }),
  setPicked: (picked) => set({ picked }),
  setPreset: (preset) => set({ preset }),
  setBusy: (busy) => set({ busy }),
  setStatus: (status) => set({ status }),
  setLast: (last) => set({ last }),
}))
