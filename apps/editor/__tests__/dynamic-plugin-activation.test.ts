import { beforeEach, describe, expect, it } from 'bun:test'
import {
  type LazyPluginDescriptor,
  getRegistryVersion,
  nodeRegistry,
  pluginManager,
  useScene,
} from '@pascal-app/core'
import { editorHostPanelRegistry } from '@pascal-app/editor'
import { PLUGIN_CATALOG, getPluginDescriptor } from '../lib/plugins/catalog'
import { usePluginManager } from '../lib/plugins/use-plugin-manager'

describe('M4: Zero-Reload Dynamic Plugin Activation & Runtime Reactivity Suite', () => {
  beforeEach(() => {
    // Testler arası tam izolasyon ve temizleme
    nodeRegistry._reset()
    pluginManager._reset()
    editorHostPanelRegistry.reset()
    useScene.getState().setInstalledPlugins([], { explicit: true })

    // Panel dinleyicisini bağla
    pluginManager.setPanelRegistrar((panel) => {
      editorHostPanelRegistry.registerPanel(panel)
    })
    pluginManager.registerDescriptors(PLUGIN_CATALOG)
  })

  describe('1. Başlangıç Durumu (Zero-Plugin Initial State)', () => {
    it('başlangıçta hiçbir harici eklenti düğümü kayıtlı olmamalı ve durumlar unloaded olmalıdır', () => {
      // 0 eklenti düğümü
      expect(nodeRegistry.has('boots:job')).toBe(false)
      expect(nodeRegistry.has('trees:tree')).toBe(false)
      expect(nodeRegistry.has('bones:lumber')).toBe(false)
      expect(nodeRegistry.has('warehouse:pallet')).toBe(false)
      expect(nodeRegistry.has('articraft:asset')).toBe(false)
      expect(nodeRegistry.has('streetscape:road-network')).toBe(false)

      // 0 eklenti host paneli
      const panels = editorHostPanelRegistry.getSnapshot()
      expect(panels.some((p) => p.pluginId === 'pascal:boots')).toBe(false)
      expect(panels.some((p) => p.pluginId === 'pascal:trees')).toBe(false)

      // Tüm eklenti durumları varsayılan olarak unloaded olmalı
      for (const descriptor of PLUGIN_CATALOG) {
        const state = pluginManager.getPluginState(descriptor.id)
        expect(state.status).toBe('unloaded')
        expect(state.error).toBeNull()
      }

      // useScene yüklü eklentiler başlangıçta boş olmalı
      expect(useScene.getState().installedPlugins).toHaveLength(0)
    })
  })

  describe('2. PascalOrg Boots Dinamik Yükleme ve Reaktif Aktivasyon', () => {
    it('installPlugin("pascal:boots") çağrıldığında chunk yüklenir, nodeRegistry ve hostPanel kaydedilir', async () => {
      const initialVersion = getRegistryVersion()
      const stateTransitions: string[] = []

      const unsubscribe = pluginManager.subscribe(() => {
        stateTransitions.push(pluginManager.getPluginState('pascal:boots').status)
      })

      expect(nodeRegistry.has('boots:job')).toBe(false)

      // Dinamik yüklemeyi başlat
      const success = await usePluginManager.getState().installPlugin('pascal:boots')
      unsubscribe()

      expect(success).toBe(true)

      // Durum makinesi geçişleri: loading -> installed
      expect(stateTransitions).toContain('loading')
      expect(pluginManager.getPluginState('pascal:boots').status).toBe('installed')
      expect(pluginManager.getPluginState('pascal:boots').loadedAt).toBeGreaterThan(0)

      // nodeRegistry içinde boots:job düğümü aktif olmalı
      expect(nodeRegistry.has('boots:job')).toBe(true)
      const bootsDef = nodeRegistry.get('boots:job')
      expect(bootsDef).toBeDefined()
      expect(bootsDef?.kind).toBe('boots:job')

      // editorHostPanelRegistry içinde Boots paneli yer almalı
      const panels = editorHostPanelRegistry.getSnapshot()
      const bootsPanel = panels.find((p) => p.pluginId === 'pascal:boots')
      expect(bootsPanel).toBeDefined()
      expect(bootsPanel?.pluginId).toBe('pascal:boots')

      // useScene yüklü eklenti listesinde görünmeli
      expect(useScene.getState().installedPlugins).toContain('pascal:boots')

      // getRegistryVersion() artmış olmalı (Reaktivite)
      expect(getRegistryVersion()).toBeGreaterThan(initialVersion)
    })
  })

  describe('3. Nature & Trees Dinamik Yükleme ve Çoklu Düğüm Aktivasyonu', () => {
    it('installPlugin("pascal:trees") çağrıldığında tüm ağaç/peyzaj düğümleri ve paneli anında yüklenir', async () => {
      const initialVersion = getRegistryVersion()

      expect(nodeRegistry.has('trees:tree')).toBe(false)
      expect(nodeRegistry.has('trees:flower')).toBe(false)
      expect(nodeRegistry.has('trees:grass')).toBe(false)

      const success = await usePluginManager.getState().installPlugin('pascal:trees')
      expect(success).toBe(true)

      expect(pluginManager.getPluginState('pascal:trees').status).toBe('installed')

      // Ağaç, çiçek ve çim düğümlerinin üçü de kaydedilmiş olmalı
      expect(nodeRegistry.has('trees:tree')).toBe(true)
      expect(nodeRegistry.has('trees:flower')).toBe(true)
      expect(nodeRegistry.has('trees:grass')).toBe(true)

      // Host panel kaydedilmiş olmalı
      const panels = editorHostPanelRegistry.getSnapshot()
      const treesPanel = panels.find((p) => p.pluginId === 'pascal:trees')
      expect(treesPanel).toBeDefined()
      expect(treesPanel?.pluginId).toBe('pascal:trees')

      // Sahne durumu ve reaktivite
      expect(useScene.getState().installedPlugins).toContain('pascal:trees')
      expect(getRegistryVersion()).toBeGreaterThan(initialVersion)
    })
  })

  describe('4. Eşzamanlı (Concurrent) ve Ardışık Tüm Eklenti Aktivasyonları', () => {
    it('kalan tüm eklentiler eşzamanlı olarak hatasız yüklenebilmelidir', async () => {
      const remainingPlugins = [
        'pascal:bones',
        'ovurrsl:warehouse',
        'pascal:articraft',
        'pascal:streetscape',
        'mint:assets',
      ]

      // Eşzamanlı (Promise.all) kurulum
      const results = await Promise.all(
        remainingPlugins.map((id) => usePluginManager.getState().installPlugin(id)),
      )

      expect(results.every((r) => r === true)).toBe(true)

      // Her eklentinin durumunu ve düğümlerini kontrol et
      expect(pluginManager.getPluginState('pascal:bones').status).toBe('installed')
      expect(nodeRegistry.has('bones:lumber')).toBe(true)

      expect(pluginManager.getPluginState('ovurrsl:warehouse').status).toBe('installed')
      expect(nodeRegistry.has('warehouse:pallet')).toBe(true)
      expect(nodeRegistry.has('warehouse:pallet-rack')).toBe(true)

      expect(pluginManager.getPluginState('pascal:articraft').status).toBe('installed')
      expect(nodeRegistry.has('articraft:asset')).toBe(true)

      expect(pluginManager.getPluginState('pascal:streetscape').status).toBe('installed')
      expect(nodeRegistry.has('streetscape:road-network')).toBe(true)

      expect(pluginManager.getPluginState('mint:assets').status).toBe('installed')

      // Sahne durumunda hepsi kayıtlı
      for (const id of remainingPlugins) {
        expect(useScene.getState().installedPlugins).toContain(id)
      }
    })
  })

  describe('5. Hata İzolasyonu ve Çökme Dayanıklılığı (Adversarial Error Boundary)', () => {
    it('hatalı veya eksik bir eklenti yüklendiğinde durum "error" olmalı ve diğer eklentiler etkilenmemelidir', async () => {
      // Hatalı dinamik eklenti tanımlayıcısı
      const faultyDescriptor: LazyPluginDescriptor = {
        id: 'test:faulty-plugin',
        name: 'Faulty Plugin',
        description: 'Simulated broken plugin',
        loadPlugin: async () => {
          throw new Error('Network connection timeout while fetching dynamic chunk')
        },
      }

      pluginManager.registerDescriptor(faultyDescriptor)
      expect(pluginManager.getPluginState('test:faulty-plugin').status).toBe('unloaded')

      // pluginManager.installPlugin doğrudan çağrılır ve hata fırlatır
      let caughtError: any = null
      try {
        await pluginManager.installPlugin('test:faulty-plugin')
      } catch (err) {
        caughtError = err
      }

      expect(caughtError).not.toBeNull()

      // Durum error olmalı ve hata mesajı kaydedilmeli
      const faultyState = pluginManager.getPluginState('test:faulty-plugin')
      expect(faultyState.status).toBe('error')
      expect(faultyState.error).toContain('Network connection timeout')

      // Sağlam eklentiler normal şekilde yüklenmeye devam edebilmelidir
      const bootsSuccess = await usePluginManager.getState().installPlugin('pascal:boots')
      expect(bootsSuccess).toBe(true)
      expect(pluginManager.getPluginState('pascal:boots').status).toBe('installed')
      expect(nodeRegistry.has('boots:job')).toBe(true)
    })
  })

  describe('6. Idempotency ve Kaldırma (Lifecycle & Idempotency)', () => {
    it('aynı eklentiyi mükerrer yüklemek hata üretmemeli ve durumu korumalıdır', async () => {
      await usePluginManager.getState().installPlugin('pascal:boots')
      expect(pluginManager.getPluginState('pascal:boots').status).toBe('installed')

      // İkinci kez yükle
      const secondCall = await usePluginManager.getState().installPlugin('pascal:boots')
      expect(secondCall).toBe(true)
      expect(pluginManager.getPluginState('pascal:boots').status).toBe('installed')
    })

    it('uninstallPlugin çağrıldığında durum unloaded olur ve sahneden kaldırılır', async () => {
      await usePluginManager.getState().installPlugin('pascal:boots')
      expect(useScene.getState().installedPlugins).toContain('pascal:boots')

      const uninstalled = await usePluginManager.getState().uninstallPlugin('pascal:boots')
      expect(uninstalled).toBe(true)
      expect(useScene.getState().installedPlugins).not.toContain('pascal:boots')
      expect(pluginManager.getPluginState('pascal:boots').status).toBe('unloaded')
    })
  })
})
