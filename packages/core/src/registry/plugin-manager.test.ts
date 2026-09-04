import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { z } from 'zod'
import { getRegistryVersion, nodeRegistry, onRegistryChange } from './registry'
import {
  PluginManager,
  type LazyPluginDescriptor,
} from './plugin-manager'
import type { AnyNodeDefinition, Plugin } from './types'

describe('PluginManager', () => {
  let manager: PluginManager

  const createDummyDef = (kind: string): AnyNodeDefinition => ({
    kind,
    category: 'furnish',
    schemaVersion: 1,
    schema: z.object({
      id: z.string(),
      type: z.literal(kind),
    }),
    capabilities: {},
  })

  beforeEach(() => {
    nodeRegistry._reset()
    manager = new PluginManager()
  })

  describe('descriptor registration', () => {
    it('registers descriptors and starts in unloaded state', () => {
      const descriptor: LazyPluginDescriptor = {
        id: 'test:plugin',
        name: 'Test Plugin',
        loadPlugin: async () => ({
          id: 'test:plugin',
          apiVersion: 1,
          nodes: [createDummyDef('test:node')],
        }),
      }

      manager.registerDescriptor(descriptor)
      expect(manager.hasDescriptor('test:plugin')).toBe(true)
      expect(manager.getDescriptor('test:plugin')).toBe(descriptor)
      expect(manager.getDescriptors()).toHaveLength(1)

      const state = manager.getPluginState('test:plugin')
      expect(state.status).toBe('unloaded')
      expect(state.error).toBeNull()
    })

    it('registers multiple descriptors via registerDescriptors', () => {
      manager.registerDescriptors([
        {
          id: 'p1',
          name: 'P1',
          loadPlugin: async () => ({ id: 'p1', apiVersion: 1 }),
        },
        {
          id: 'p2',
          name: 'P2',
          loadPlugin: async () => ({ id: 'p2', apiVersion: 1 }),
        },
      ])

      expect(manager.getDescriptors()).toHaveLength(2)
      expect(manager.hasDescriptor('p1')).toBe(true)
      expect(manager.hasDescriptor('p2')).toBe(true)
    })

    it('rejects invalid descriptors with empty id or missing loadPlugin', () => {
      expect(() =>
        manager.registerDescriptor({
          id: '',
          name: 'Invalid',
          loadPlugin: async () => ({ id: 'inv', apiVersion: 1 }),
        }),
      ).toThrow()

      expect(() =>
        manager.registerDescriptor({
          id: 'valid:id',
          name: 'Invalid',
          loadPlugin: undefined as any,
        }),
      ).toThrow()
    })
  })

  describe('installation and lifecycle', () => {
    it('installs plugin and registers nodes into nodeRegistry', async () => {
      const initialVersion = getRegistryVersion()
      const dummyPlugin: Plugin = {
        id: 'test:bones',
        apiVersion: 1,
        nodes: [createDummyDef('bones:lumber'), createDummyDef('bones:framing')],
      }

      let loadCalled = false
      const descriptor: LazyPluginDescriptor = {
        id: 'test:bones',
        name: 'Bones',
        loadPlugin: async () => {
          loadCalled = true
          return dummyPlugin
        },
      }

      manager.registerDescriptor(descriptor)
      expect(nodeRegistry.has('bones:lumber')).toBe(false)

      await manager.installPlugin('test:bones')

      expect(loadCalled).toBe(true)
      expect(manager.getPluginState('test:bones').status).toBe('installed')
      expect(manager.getPluginState('test:bones').loadedAt).toBeDefined()
      expect(nodeRegistry.has('bones:lumber')).toBe(true)
      expect(nodeRegistry.has('bones:framing')).toBe(true)
      expect(getRegistryVersion()).toBeGreaterThan(initialVersion)
    })

    it('deduplicates concurrent install calls into a single load execution', async () => {
      let callCount = 0
      const descriptor: LazyPluginDescriptor = {
        id: 'test:concurrent',
        name: 'Concurrent Test',
        loadPlugin: async () => {
          callCount++
          await new Promise((resolve) => setTimeout(resolve, 20))
          return {
            id: 'test:concurrent',
            apiVersion: 1,
            nodes: [createDummyDef('concurrent:node')],
          }
        },
      }

      manager.registerDescriptor(descriptor)

      // Fire 3 installs concurrently
      const [r1, r2, r3] = await Promise.all([
        manager.installPlugin('test:concurrent'),
        manager.installPlugin('test:concurrent'),
        manager.installPlugin('test:concurrent'),
      ])

      expect(callCount).toBe(1)
      expect(manager.getPluginState('test:concurrent').status).toBe('installed')
      expect(nodeRegistry.has('concurrent:node')).toBe(true)
    })

    it('returns immediately if already installed', async () => {
      let callCount = 0
      const descriptor: LazyPluginDescriptor = {
        id: 'test:idempotent',
        name: 'Idempotent',
        loadPlugin: async () => {
          callCount++
          return { id: 'test:idempotent', apiVersion: 1 }
        },
      }

      manager.registerDescriptor(descriptor)
      await manager.installPlugin('test:idempotent')
      expect(callCount).toBe(1)

      await manager.installPlugin('test:idempotent')
      expect(callCount).toBe(1)
    })

    it('throws error for unknown plugin descriptor id', async () => {
      await expect(manager.installPlugin('unknown:id')).rejects.toThrow(
        'Plugin descriptor "unknown:id" not found',
      )
    })

    it('invokes panel registrar when plugin returns host panel', async () => {
      const panelRegistrar = vi.fn()
      manager.setPanelRegistrar(panelRegistrar)

      const fakePanel = { id: 'test:panel', label: 'Test Panel' }
      const descriptor: LazyPluginDescriptor = {
        id: 'test:panel:plugin',
        name: 'Panel Plugin',
        loadPlugin: async () => ({
          plugin: { id: 'test:panel:plugin', apiVersion: 1 },
          panel: fakePanel,
        }),
      }

      manager.registerDescriptor(descriptor)
      await manager.installPlugin('test:panel:plugin')

      expect(panelRegistrar).toHaveBeenCalledTimes(1)
      expect(panelRegistrar).toHaveBeenCalledWith(fakePanel)
    })
  })

  describe('error handling and recovery', () => {
    it('sets state to error on failure and allows retry', async () => {
      let shouldFail = true
      const descriptor: LazyPluginDescriptor = {
        id: 'test:flaky',
        name: 'Flaky',
        loadPlugin: async () => {
          if (shouldFail) {
            throw new Error('Network chunk loading failed')
          }
          return { id: 'test:flaky', apiVersion: 1 }
        },
      }

      manager.registerDescriptor(descriptor)

      // First attempt fails
      await expect(manager.installPlugin('test:flaky')).rejects.toThrow(
        'Network chunk loading failed',
      )

      expect(manager.getPluginState('test:flaky').status).toBe('error')
      expect(manager.getPluginState('test:flaky').error).toBe('Network chunk loading failed')

      // Retry succeeds
      shouldFail = false
      await manager.installPlugin('test:flaky')

      expect(manager.getPluginState('test:flaky').status).toBe('installed')
      expect(manager.getPluginState('test:flaky').error).toBeNull()
    })

    it('fails when plugin manifest apiVersion is unsupported', async () => {
      const descriptor: LazyPluginDescriptor = {
        id: 'test:bad-api',
        name: 'Bad API',
        loadPlugin: async () => ({
          id: 'test:bad-api',
          apiVersion: 99 as any,
        }),
      }

      manager.registerDescriptor(descriptor)
      await expect(manager.installPlugin('test:bad-api')).rejects.toThrow(
        'requires apiVersion 99; host supports 1',
      )
      expect(manager.getPluginState('test:bad-api').status).toBe('error')
    })
  })

  describe('state subscriptions and snapshotting', () => {
    it('notifies subscribers on registration and installation', async () => {
      const listener = vi.fn()
      const unsub = manager.subscribe(listener)

      manager.registerDescriptor({
        id: 'p1',
        name: 'P1',
        loadPlugin: async () => ({ id: 'p1', apiVersion: 1 }),
      })

      expect(listener).toHaveBeenCalledTimes(1)

      await manager.installPlugin('p1')

      // Called for 'loading' and 'installed'
      expect(listener).toHaveBeenCalledTimes(3)

      unsub()
      manager.registerDescriptor({
        id: 'p2',
        name: 'P2',
        loadPlugin: async () => ({ id: 'p2', apiVersion: 1 }),
      })

      // No more calls after unsub
      expect(listener).toHaveBeenCalledTimes(3)
    })

    it('provides cached snapshot with descriptors and states', () => {
      manager.registerDescriptor({
        id: 'p1',
        name: 'P1',
        loadPlugin: async () => ({ id: 'p1', apiVersion: 1 }),
      })

      const snap1 = manager.getSnapshot()
      const snap2 = manager.getSnapshot()
      expect(snap1).toBe(snap2) // Referentially stable when unchanged

      expect(snap1.descriptors).toHaveLength(1)
      expect(snap1.states['p1'].status).toBe('unloaded')
    })

    it('allows uninstalling (unloading state)', async () => {
      manager.registerDescriptor({
        id: 'p1',
        name: 'P1',
        loadPlugin: async () => ({ id: 'p1', apiVersion: 1 }),
      })

      await manager.installPlugin('p1')
      expect(manager.getPluginState('p1').status).toBe('installed')

      manager.uninstallPlugin('p1')
      expect(manager.getPluginState('p1').status).toBe('unloaded')
    })

    it('clears all state on _reset', () => {
      manager.registerDescriptor({
        id: 'p1',
        name: 'P1',
        loadPlugin: async () => ({ id: 'p1', apiVersion: 1 }),
      })

      expect(manager.getDescriptors()).toHaveLength(1)
      manager._reset()
      expect(manager.getDescriptors()).toHaveLength(0)
      expect(manager.getAllStates()).toEqual({})
    })
  })
})
