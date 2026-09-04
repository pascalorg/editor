'use client'

import { create } from 'zustand'
import { pluginManager, useScene } from '@pascal-app/core'
import { PLUGIN_CATALOG, getPluginDescriptor } from './catalog'

export type PluginCategory =
  | 'all'
  | 'environment'
  | 'engineering'
  | 'assets'
  | 'logistics'
  | 'simulation'
  | 'infrastructure'

export interface PluginManagerState {
  searchQuery: string
  selectedCategory: PluginCategory
  isModalOpen: boolean
  activeDetailPluginId: string | null

  // Actions
  setModalOpen: (open: boolean) => void
  openDetail: (pluginId: string) => void
  closeDetail: () => void
  setSearchQuery: (query: string) => void
  setSelectedCategory: (category: PluginCategory) => void

  // Lifecycle operations
  installPlugin: (pluginId: string) => Promise<boolean>
  uninstallPlugin: (pluginId: string) => Promise<boolean>
  syncWithScene: (installedIds: string[]) => Promise<void>
  loadDefaultPlugins: () => Promise<void>
}

export const usePluginManager = create<PluginManagerState>((set, get) => ({
  searchQuery: '',
  selectedCategory: 'all',
  isModalOpen: false,
  activeDetailPluginId: null,

  setModalOpen: (open) => set({ isModalOpen: open }),
  openDetail: (pluginId) => set({ activeDetailPluginId: pluginId }),
  closeDetail: () => set({ activeDetailPluginId: null }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSelectedCategory: (category) => set({ selectedCategory: category }),

  installPlugin: async (pluginId: string): Promise<boolean> => {
    const descriptor = getPluginDescriptor(pluginId)
    if (!descriptor) {
      console.error(`[plugin-manager] Descriptor not found: ${pluginId}`)
      return false
    }

    try {
      await pluginManager.installPlugin(pluginId)

      // Sync with scene store
      const scene = useScene.getState()
      if (!scene.installedPlugins.includes(pluginId)) {
        scene.setInstalledPlugins([...scene.installedPlugins, pluginId], { explicit: true })
      }

      return true
    } catch (err) {
      console.error(`[plugin-manager] Failed to install ${pluginId}:`, err)
      return false
    }
  },

  uninstallPlugin: async (pluginId: string): Promise<boolean> => {
    try {
      pluginManager.uninstallPlugin(pluginId)

      const scene = useScene.getState()
      const next = scene.installedPlugins.filter((id) => id !== pluginId)
      scene.setInstalledPlugins(next, { explicit: true })

      return true
    } catch (err) {
      console.error(`[plugin-manager] Failed to uninstall ${pluginId}:`, err)
      return false
    }
  },

  syncWithScene: async (installedIds: string[]) => {
    const promises: Promise<boolean>[] = []
    for (const pluginId of installedIds) {
      const state = pluginManager.getPluginState(pluginId)
      if (state.status === 'unloaded' && pluginManager.hasDescriptor(pluginId)) {
        promises.push(get().installPlugin(pluginId))
      }
    }
    await Promise.all(promises)
  },

  loadDefaultPlugins: async () => {
    const scene = useScene.getState()
    const promises: Promise<boolean>[] = []
    if (scene.hasExplicitPluginInstallState) {
      for (const pluginId of scene.installedPlugins) {
        if (pluginManager.hasDescriptor(pluginId)) {
          promises.push(get().installPlugin(pluginId))
        }
      }
      await Promise.all(promises)
      return
    }

    const defaults = PLUGIN_CATALOG.filter((p) => p.defaultInstalled).map((p) => p.id)
    if (defaults.length > 0) {
      scene.setInstalledPlugins(defaults, { explicit: false })
      for (const pluginId of defaults) {
        promises.push(get().installPlugin(pluginId))
      }
      await Promise.all(promises)
    }
  },
}))
