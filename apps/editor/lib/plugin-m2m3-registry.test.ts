import { beforeEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { getRegistryVersion, nodeRegistry, pluginManager, useScene } from '@pascal-app/core'
import { editorHostPanelRegistry } from '@pascal-app/editor'
import { PLUGIN_CATALOG, getPluginDescriptor } from './plugins/catalog'
import { usePluginManager } from './plugins/use-plugin-manager'

describe('M2 & M3: Dynamic Lazy Plugin Registry & Bootstrap Decoupling', () => {
  beforeEach(() => {
    nodeRegistry._reset()
    pluginManager._reset()
    editorHostPanelRegistry.reset()
    useScene.getState().setInstalledPlugins([], { explicit: true })
  })

  describe('1. bootstrap.ts Statik Import Ayrıştırması (Decoupling Verification)', () => {
    it('bootstrap.ts içinde hiçbir statik eklenti importu bulunmamalıdır', () => {
      const bootstrapPath = path.join(import.meta.dir, 'bootstrap.ts')
      const content = readFileSync(bootstrapPath, 'utf8')

      const forbiddenPackages = [
        '@pascal-app/plugin-boots',
        '@pascal-app/plugin-trees',
        '@pascal-app/plugin-bones',
        '@pascal-app/plugin-articraft',
        '@pascal-app/plugin-streetscape',
        '@ovurrsl/plugin-warehouse',
        '@mint/pascal-plugin',
      ]

      for (const pkg of forbiddenPackages) {
        const hasStaticImport = new RegExp(
          `import\\s+(?:(?:\\{[^}]*\\}|\\*\\s+as\\s+\\w+|\\w+)\\s+from\\s+)?['"]${pkg}['"]`,
        ).test(content)
        expect(hasStaticImport).toBe(false)
      }
    })
  })

  describe('2. Dinamik Lazy Eklenti Kataloğu Sözleşmesi (7 Eklenti)', () => {
    it('katalogda 7 eklentinin tümü tanımlı ve eksiksiz olmalıdır', () => {
      expect(PLUGIN_CATALOG).toHaveLength(7)

      const expectedIds = [
        'pascal:boots',
        'pascal:trees',
        'pascal:bones',
        'pascal:articraft',
        'pascal:streetscape',
        'ovurrsl:warehouse',
        'mint:assets',
      ]

      for (const id of expectedIds) {
        const descriptor = getPluginDescriptor(id)
        expect(descriptor).toBeDefined()
        expect(descriptor?.name).toBeDefined()
        expect(descriptor?.description).toBeDefined()
        expect(descriptor?.category).toBeDefined()
        expect(typeof descriptor?.loadPlugin).toBe('function')
      }
    })

    it('tüm 7 eklentinin dinamik loadPlugin thunk fonksiyonları geçerli manifest döndürür', async () => {
      for (const descriptor of PLUGIN_CATALOG) {
        const loaded = await descriptor.loadPlugin()
        expect(loaded).toBeDefined()

        const plugin = 'plugin' in loaded ? loaded.plugin : loaded
        expect(plugin.id).toBeDefined()
        expect(plugin.apiVersion).toBe(1)

        if ('panel' in loaded && loaded.panel) {
          expect(loaded.panel.id).toBeDefined()
          expect(loaded.panel.label).toBeDefined()
        }
      }
    }, { timeout: 30000 })
  })

  describe('3. Canlı Çalışma Zamanı Aktivasyonu & Reaktivite (Zero-Reload Hot Activation)', () => {
    it('pluginManager ve usePluginManager ile eklenti sayfa yenilenmeden dinamik yüklenir', async () => {
      pluginManager.setPanelRegistrar((panel) => {
        editorHostPanelRegistry.registerPanel(panel)
      })
      pluginManager.registerDescriptors(PLUGIN_CATALOG)

      const initialVersion = getRegistryVersion()
      expect(nodeRegistry.has('trees:tree')).toBe(false)
      expect(editorHostPanelRegistry.getSnapshot().some((p) => p.pluginId === 'pascal:trees')).toBe(
        false,
      )

      // Boots eklentisini dinamik yükle
      const bootsSuccess = await usePluginManager.getState().installPlugin('pascal:boots')
      expect(bootsSuccess).toBe(true)
      expect(pluginManager.getPluginState('pascal:boots').status).toBe('installed')
      expect(nodeRegistry.has('boots:job')).toBe(true)
      expect(useScene.getState().installedPlugins).toContain('pascal:boots')
      expect(getRegistryVersion()).toBeGreaterThan(initialVersion)

      // Trees eklentisini dinamik yükle
      const treesSuccess = await usePluginManager.getState().installPlugin('pascal:trees')
      expect(treesSuccess).toBe(true)
      expect(pluginManager.getPluginState('pascal:trees').status).toBe('installed')
      expect(nodeRegistry.has('trees:tree')).toBe(true)
      expect(nodeRegistry.has('trees:flower')).toBe(true)
      expect(nodeRegistry.has('trees:grass')).toBe(true)
      expect(useScene.getState().installedPlugins).toContain('pascal:trees')

      // Panel de kaydedilmiş olmalı
      expect(editorHostPanelRegistry.getSnapshot().some((p) => p.pluginId === 'pascal:trees')).toBe(
        true,
      )
    })

    it('eklenti kaldırıldığında sahne durumu güncellenir ve durumu unloaded olur', async () => {
      pluginManager.registerDescriptors(PLUGIN_CATALOG)
      await usePluginManager.getState().installPlugin('pascal:bones')

      expect(useScene.getState().installedPlugins).toContain('pascal:bones')
      expect(pluginManager.getPluginState('pascal:bones').status).toBe('installed')

      const uninstallSuccess = await usePluginManager.getState().uninstallPlugin('pascal:bones')
      expect(uninstallSuccess).toBe(true)
      expect(useScene.getState().installedPlugins).not.toContain('pascal:bones')
      expect(pluginManager.getPluginState('pascal:bones').status).toBe('unloaded')
    })
  })
})
