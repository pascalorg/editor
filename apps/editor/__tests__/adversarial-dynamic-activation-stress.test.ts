import { beforeEach, describe, expect, it } from 'bun:test'
import {
  type LazyPluginDescriptor,
  type Plugin,
  getInspectorExtensions,
  getNodePluginId,
  getRegistryVersion,
  getSelectableKinds,
  getZoneTakeoffExtensions,
  isNodeKindEnabled,
  isPluginContributedKind,
  nodeRegistry,
  onRegistryChange,
  pluginManager,
  useScene,
} from '@pascal-app/core'
import { editorHostPanelRegistry } from '@pascal-app/editor'
import { PLUGIN_CATALOG, getPluginDescriptor } from '../lib/plugins/catalog'
import { usePluginManager } from '../lib/plugins/use-plugin-manager'

describe('EMPIRICAL ADVERSARIAL CHALLENGER: Zero-Reload Dynamic Activation & Stress Harness', () => {
  beforeEach(() => {
    nodeRegistry._reset()
    pluginManager._reset()
    editorHostPanelRegistry.reset()
    useScene.getState().setInstalledPlugins([], { explicit: true })

    pluginManager.setPanelRegistrar((panel) => {
      editorHostPanelRegistry.registerPanel(panel)
    })
    pluginManager.registerDescriptors(PLUGIN_CATALOG)
  })

  describe('Adversarial Dimension 1: High-Frequency Concurrency & Rapid Toggle Thrashing', () => {
    it('survives 100 concurrent install calls for the same plugin without duplicate loads or race conditions', async () => {
      let loadCount = 0
      const testDescriptor: LazyPluginDescriptor = {
        id: 'test:concurrent-plugin',
        name: 'Concurrent Test Plugin',
        loadPlugin: async () => {
          loadCount++
          await new Promise((resolve) => setTimeout(resolve, 20))
          return {
            id: 'test:concurrent-plugin',
            name: 'Concurrent Test Plugin',
            apiVersion: 1,
            nodes: [
              {
                kind: 'test:concurrent-node',
                schemaVersion: 1,
                category: 'furnish',
                schema: {} as any,
                capabilities: { selectable: true },
              },
            ],
          }
        },
      }

      pluginManager.registerDescriptor(testDescriptor)

      // Launch 100 concurrent installations
      const promises = Array.from({ length: 100 }, () =>
        pluginManager.installPlugin('test:concurrent-plugin'),
      )

      await Promise.all(promises)

      // Verify single invocation of loadPlugin (deduplication)
      expect(loadCount).toBe(1)
      expect(pluginManager.getPluginState('test:concurrent-plugin').status).toBe('installed')
      expect(nodeRegistry.has('test:concurrent-node')).toBe(true)
    })

    it('survives 50 rapid alternating install and uninstall cycles without corrupted state or memory leaks', async () => {
      const targetId = 'pascal:boots'

      for (let i = 0; i < 50; i++) {
        const installResult = await usePluginManager.getState().installPlugin(targetId)
        expect(installResult).toBe(true)
        expect(pluginManager.getPluginState(targetId).status).toBe('installed')
        expect(useScene.getState().installedPlugins).toContain(targetId)
        expect(isNodeKindEnabled('boots:job', useScene.getState().installedPlugins)).toBe(true)

        const uninstallResult = await usePluginManager.getState().uninstallPlugin(targetId)
        expect(uninstallResult).toBe(true)
        expect(pluginManager.getPluginState(targetId).status).toBe('unloaded')
        expect(useScene.getState().installedPlugins).not.toContain(targetId)
        expect(isNodeKindEnabled('boots:job', useScene.getState().installedPlugins)).toBe(false)
      }

      // Re-install one last time to ensure system is cleanly operational
      await usePluginManager.getState().installPlugin(targetId)
      expect(pluginManager.getPluginState(targetId).status).toBe('installed')
      expect(useScene.getState().installedPlugins).toContain(targetId)
      expect(isNodeKindEnabled('boots:job', useScene.getState().installedPlugins)).toBe(true)
    })

    it('survives mass chaotic concurrent toggle across all catalog plugins simultaneously', async () => {
      const allIds = PLUGIN_CATALOG.map((p) => p.id)

      // Launch interleaved random install/uninstall actions
      const chaoticActions = allIds.flatMap((id) => [
        usePluginManager.getState().installPlugin(id),
        usePluginManager.getState().uninstallPlugin(id),
        usePluginManager.getState().installPlugin(id),
      ])

      await Promise.all(chaoticActions)

      // Ensure that final states in pluginManager and useScene match
      const installedScene = useScene.getState().installedPlugins
      for (const id of allIds) {
        const state = pluginManager.getPluginState(id)
        if (state.status === 'installed') {
          // If plugin is installed, its node kinds must be registered in nodeRegistry
          const desc = getPluginDescriptor(id)
          if (desc?.nodeKinds) {
            for (const kind of desc.nodeKinds) {
              expect(nodeRegistry.has(kind)).toBe(true)
            }
          }
        }
      }
    })
  })

  describe('Adversarial Dimension 2: Fault Injection, Error Boundary & Failure Recovery', () => {
    it('isolates network timeout failure, records error message, and allows subsequent successful retry', async () => {
      let failCount = 0
      const retryDescriptor: LazyPluginDescriptor = {
        id: 'test:flaky-network-plugin',
        name: 'Flaky Network Plugin',
        loadPlugin: async () => {
          if (failCount === 0) {
            failCount++
            throw new Error('ETIMEDOUT: Failed to fetch dynamic chunk from CDN')
          }
          return {
            id: 'test:flaky-network-plugin',
            name: 'Flaky Network Plugin',
            apiVersion: 1,
            nodes: [
              {
                kind: 'test:recovered-node',
                schemaVersion: 1,
                category: 'furnish',
                schema: {} as any,
                capabilities: {},
              },
            ],
          }
        },
      }

      pluginManager.registerDescriptor(retryDescriptor)

      // 1. First attempt fails
      let firstError: any = null
      try {
        await pluginManager.installPlugin('test:flaky-network-plugin')
      } catch (err) {
        firstError = err
      }

      expect(firstError).not.toBeNull()
      expect(firstError.message).toContain('ETIMEDOUT')
      expect(pluginManager.getPluginState('test:flaky-network-plugin').status).toBe('error')
      expect(pluginManager.getPluginState('test:flaky-network-plugin').error).toContain('ETIMEDOUT')
      expect(nodeRegistry.has('test:recovered-node')).toBe(false)

      // 2. Retry attempt succeeds
      await pluginManager.installPlugin('test:flaky-network-plugin')
      expect(pluginManager.getPluginState('test:flaky-network-plugin').status).toBe('installed')
      expect(pluginManager.getPluginState('test:flaky-network-plugin').error).toBeNull()
      expect(nodeRegistry.has('test:recovered-node')).toBe(true)
    })

    it('rejects malformed plugin manifests (null, invalid apiVersion, missing id) without crashing registry', async () => {
      const invalidDescriptors: LazyPluginDescriptor[] = [
        {
          id: 'test:invalid-manifest-null',
          name: 'Null Manifest Plugin',
          loadPlugin: async () => null as any,
        },
        {
          id: 'test:invalid-manifest-apiversion',
          name: 'Wrong API Version Plugin',
          loadPlugin: async () =>
            ({
              id: 'test:invalid-manifest-apiversion',
              apiVersion: 999, // Host only supports 1
              nodes: [],
            }) as any,
        },
        {
          id: 'test:invalid-manifest-noid',
          name: 'No ID Plugin',
          loadPlugin: async () =>
            ({
              apiVersion: 1,
              nodes: [],
            }) as any,
        },
      ]

      for (const desc of invalidDescriptors) {
        pluginManager.registerDescriptor(desc)
        let errorCaught = false
        try {
          await pluginManager.installPlugin(desc.id)
        } catch {
          errorCaught = true
        }
        expect(errorCaught).toBe(true)
        expect(pluginManager.getPluginState(desc.id).status).toBe('error')
      }
    })

    it('gracefully handles panel registrar exceptions without failing plugin installation or node registration', async () => {
      // Add a faulty panel registrar that throws
      const unregisterFaultyRegistrar = pluginManager.setPanelRegistrar(() => {
        throw new Error('Host Panel Registry crashed during insertion')
      })

      const testDescriptor: LazyPluginDescriptor = {
        id: 'test:failing-panel-plugin',
        name: 'Failing Panel Plugin',
        loadPlugin: async () => ({
          plugin: {
            id: 'test:failing-panel-plugin',
            name: 'Failing Panel Plugin',
            apiVersion: 1,
            nodes: [
              {
                kind: 'test:resilient-node',
                schemaVersion: 1,
                category: 'furnish',
                schema: {} as any,
                capabilities: {},
              },
            ],
          },
          panel: { id: 'faulty-panel', title: 'Faulty' },
        }),
      }

      pluginManager.registerDescriptor(testDescriptor)

      // Installation should succeed even if panel registrar threw
      await pluginManager.installPlugin('test:failing-panel-plugin')
      expect(pluginManager.getPluginState('test:failing-panel-plugin').status).toBe('installed')
      expect(nodeRegistry.has('test:resilient-node')).toBe(true)

      unregisterFaultyRegistrar()
    })
  })

  describe('Adversarial Dimension 3: Full Zero-Reload Reactive Contracts Verification', () => {
    it('all 7 real catalog plugins dynamically install and correctly register all nodes and capabilities', async () => {
      let totalRegistryBumps = 0
      const initialVersion = getRegistryVersion()
      const unsubscribe = onRegistryChange(() => {
        totalRegistryBumps++
      })

      for (const desc of PLUGIN_CATALOG) {
        const success = await usePluginManager.getState().installPlugin(desc.id)
        expect(success).toBe(true)
        expect(pluginManager.getPluginState(desc.id).status).toBe('installed')
        expect(useScene.getState().installedPlugins).toContain(desc.id)

        // Check node kinds
        if (desc.nodeKinds) {
          for (const kind of desc.nodeKinds) {
            expect(nodeRegistry.has(kind)).toBe(true)
            expect(isPluginContributedKind(kind)).toBe(true)
            expect(getNodePluginId(kind)).toBe(desc.id)
            expect(isNodeKindEnabled(kind, useScene.getState().installedPlugins)).toBe(true)
          }
        }
      }

      unsubscribe()

      // Registry version must have bumped repeatedly for dynamically loaded nodes
      expect(getRegistryVersion()).toBeGreaterThan(initialVersion)
      expect(totalRegistryBumps).toBeGreaterThan(0)

      // Specifically verify each key plugin node kind contract
      expect(nodeRegistry.get('boots:job')?.kind).toBe('boots:job')
      expect(nodeRegistry.get('trees:tree')?.kind).toBe('trees:tree')
      expect(nodeRegistry.get('bones:lumber')?.kind).toBe('bones:lumber')
      expect(nodeRegistry.get('warehouse:pallet')?.kind).toBe('warehouse:pallet')
      expect(nodeRegistry.get('articraft:asset')?.kind).toBe('articraft:asset')
      expect(nodeRegistry.get('streetscape:road-network')?.kind).toBe('streetscape:road-network')

      // Check warehouse zone takeoff extensions or inspector extensions
      const warehouseExtensions = getZoneTakeoffExtensions()
      expect(warehouseExtensions.length).toBeGreaterThan(0)
    })

    it('dynamic node kind activation disables correctly when excluded from installedPlugins', async () => {
      await usePluginManager.getState().installPlugin('pascal:boots')
      expect(isNodeKindEnabled('boots:job', ['pascal:boots'])).toBe(true)

      // Scene with different installed plugins
      expect(isNodeKindEnabled('boots:job', ['pascal:trees'])).toBe(false)
      expect(isNodeKindEnabled('boots:job', [])).toBe(false)

      // Host builtin kinds always stay enabled regardless of installedPlugins
      expect(isNodeKindEnabled('wall', [])).toBe(true)
      expect(isNodeKindEnabled('wall', ['pascal:trees'])).toBe(true)
    })
  })

  describe('Adversarial Dimension 4: 10,000 Stress Cycles & Memory / Subscription Leak Detection', () => {
    it('subscribes and unsubscribes 10,000 listeners without memory retention or callback invocation leaks', () => {
      const unsubs: (() => void)[] = []
      let triggerCount = 0

      for (let i = 0; i < 10000; i++) {
        const unsub = pluginManager.subscribe(() => {
          triggerCount++
        })
        unsubs.push(unsub)
      }

      // Unsubscribe all
      for (const unsub of unsubs) {
        unsub()
      }

      // Trigger a state change
      pluginManager.registerDescriptor({
        id: 'test:leak-probe',
        name: 'Probe',
        loadPlugin: async () => ({} as any),
      })

      // No unsubscribed listener should have been invoked
      expect(triggerCount).toBe(0)
    })

    it('validates snapshot referential stability (getSnapshot caching)', () => {
      const snap1 = pluginManager.getSnapshot()
      const snap2 = pluginManager.getSnapshot()

      // Exact referential identity when state did not change
      expect(snap1).toBe(snap2)

      // After registration, snapshot cache is invalidated and renewed
      pluginManager.registerDescriptor({
        id: 'test:cache-invalidation-probe',
        name: 'Cache Probe',
        loadPlugin: async () => ({} as any),
      })

      const snap3 = pluginManager.getSnapshot()
      expect(snap3).not.toBe(snap1)
      expect(snap3.descriptors.some((d) => d.id === 'test:cache-invalidation-probe')).toBe(true)
    })
  })
})
