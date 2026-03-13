'use client'

import { createContext, useContext } from 'react'
import type { PresetData, PresetType } from '../components/ui/panels/presets/presets-popover'

export type { PresetData, PresetType }

export type PresetsTab = 'community' | 'mine'

export interface PresetsAdapter {
  /** Tabs to show. Default: both. Standalone passes ['mine']. */
  tabs?: PresetsTab[]
  isAuthenticated?: boolean
  fetchPresets: (type: PresetType, tab: PresetsTab) => Promise<PresetData[]>
  savePreset: (
    type: PresetType,
    name: string,
    data: Record<string, unknown>,
  ) => Promise<string | null>
  overwritePreset: (type: PresetType, id: string, data: Record<string, unknown>) => Promise<void>
  renamePreset: (id: string, name: string) => Promise<void>
  deletePreset: (id: string) => Promise<void>
  togglePresetCommunity?: (id: string, current: boolean) => Promise<void>
  uploadPresetThumbnail?: (presetId: string, blob: Blob) => Promise<string | null>
}

const PRESETS_KEY = (type: string) => `pascal-presets-${type}`

export const localStoragePresetsAdapter: PresetsAdapter = {
  tabs: ['mine'],
  isAuthenticated: true,

  fetchPresets: async (type, tab) => {
    if (tab === 'community') return []
    try {
      const raw = localStorage.getItem(PRESETS_KEY(type))
      return raw ? (JSON.parse(raw) as PresetData[]) : []
    } catch {
      return []
    }
  },

  savePreset: async (type, name, data) => {
    try {
      const id = Math.random().toString(36).slice(2, 10)
      const raw = localStorage.getItem(PRESETS_KEY(type))
      const presets: PresetData[] = raw ? JSON.parse(raw) : []
      presets.push({
        id,
        type,
        name,
        data,
        thumbnail_url: null,
        user_id: null,
        is_community: false,
        created_at: new Date().toISOString(),
      })
      localStorage.setItem(PRESETS_KEY(type), JSON.stringify(presets))
      return id
    } catch {
      return null
    }
  },

  overwritePreset: async (type, id, data) => {
    try {
      const raw = localStorage.getItem(PRESETS_KEY(type))
      if (!raw) return
      const presets: PresetData[] = JSON.parse(raw)
      localStorage.setItem(
        PRESETS_KEY(type),
        JSON.stringify(presets.map((p) => (p.id === id ? { ...p, data } : p))),
      )
    } catch {}
  },

  renamePreset: async (id, name) => {
    for (const type of ['door', 'window']) {
      try {
        const raw = localStorage.getItem(PRESETS_KEY(type))
        if (!raw) continue
        const presets: PresetData[] = JSON.parse(raw)
        localStorage.setItem(
          PRESETS_KEY(type),
          JSON.stringify(presets.map((p) => (p.id === id ? { ...p, name } : p))),
        )
      } catch {}
    }
  },

  deletePreset: async (id) => {
    for (const type of ['door', 'window']) {
      try {
        const raw = localStorage.getItem(PRESETS_KEY(type))
        if (!raw) continue
        const presets: PresetData[] = JSON.parse(raw)
        localStorage.setItem(PRESETS_KEY(type), JSON.stringify(presets.filter((p) => p.id !== id)))
      } catch {}
    }
  },
}

const PresetsContext = createContext<PresetsAdapter>(localStoragePresetsAdapter)

export function PresetsProvider({
  adapter,
  children,
}: {
  adapter?: PresetsAdapter
  children: React.ReactNode
}) {
  return (
    <PresetsContext.Provider value={adapter ?? localStoragePresetsAdapter}>
      {children}
    </PresetsContext.Provider>
  )
}

export function usePresetsAdapter(): PresetsAdapter {
  return useContext(PresetsContext)
}
