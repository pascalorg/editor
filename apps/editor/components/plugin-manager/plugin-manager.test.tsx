import { beforeEach, describe, expect, it } from 'bun:test'
import { pluginManager, useScene } from '@pascal-app/core'
import { PLUGIN_CATALOG } from '@/lib/plugins/catalog'
import { usePluginManager } from '@/lib/plugins/use-plugin-manager'

describe('Plugin Manager UI & Store Integration Tests', () => {
  beforeEach(() => {
    pluginManager._reset()
    pluginManager.registerDescriptors(PLUGIN_CATALOG)
    useScene.getState().setInstalledPlugins([], { explicit: true })
    usePluginManager.setState({
      searchQuery: '',
      selectedCategory: 'all',
      isModalOpen: false,
      activeDetailPluginId: null,
    })
  })

  describe('usePluginManager Store', () => {
    it('initializes with default state', () => {
      const state = usePluginManager.getState()
      expect(state.searchQuery).toBe('')
      expect(state.selectedCategory).toBe('all')
      expect(state.isModalOpen).toBe(false)
      expect(state.activeDetailPluginId).toBeNull()
    })

    it('controls modal open and close state', () => {
      usePluginManager.getState().setModalOpen(true)
      expect(usePluginManager.getState().isModalOpen).toBe(true)

      usePluginManager.getState().setModalOpen(false)
      expect(usePluginManager.getState().isModalOpen).toBe(false)
    })

    it('controls detail dialog plugin id', () => {
      usePluginManager.getState().openDetail('pascal:boots')
      expect(usePluginManager.getState().activeDetailPluginId).toBe('pascal:boots')

      usePluginManager.getState().closeDetail()
      expect(usePluginManager.getState().activeDetailPluginId).toBeNull()
    })

    it('updates search query and category filters', () => {
      usePluginManager.getState().setSearchQuery('trees')
      expect(usePluginManager.getState().searchQuery).toBe('trees')

      usePluginManager.getState().setSelectedCategory('environment')
      expect(usePluginManager.getState().selectedCategory).toBe('environment')
    })

    it('dynamically installs and syncs with scene store without reload', async () => {
      const scene = useScene.getState()
      expect(scene.installedPlugins).not.toContain('pascal:bones')

      const success = await usePluginManager.getState().installPlugin('pascal:bones')
      expect(success).toBe(true)
      expect(pluginManager.getPluginState('pascal:bones').status).toBe('installed')
      expect(useScene.getState().installedPlugins).toContain('pascal:bones')
    })

    it('uninstalls plugin and updates scene store', async () => {
      await usePluginManager.getState().installPlugin('pascal:boots')
      expect(useScene.getState().installedPlugins).toContain('pascal:boots')

      const uninstalled = await usePluginManager.getState().uninstallPlugin('pascal:boots')
      expect(uninstalled).toBe(true)
      expect(useScene.getState().installedPlugins).not.toContain('pascal:boots')
      expect(pluginManager.getPluginState('pascal:boots').status).toBe('unloaded')
    })

    it('syncs with scene on load', async () => {
      await usePluginManager.getState().syncWithScene(['pascal:trees', 'pascal:articraft'])
      expect(pluginManager.getPluginState('pascal:trees').status).toBe('installed')
      expect(pluginManager.getPluginState('pascal:articraft').status).toBe('installed')
    })
  })
})
