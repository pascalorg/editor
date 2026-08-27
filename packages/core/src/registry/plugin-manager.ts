import type { IconRef, Plugin } from './types'
import { loadPlugin } from './registry'

export type PluginStatus = 'unloaded' | 'loading' | 'installed' | 'error'

export interface PluginState {
  id: string
  status: PluginStatus
  error?: string | null
  loadedAt?: number
}

export type LazyPluginLoadedResult =
  | {
      plugin: Plugin
      panel?: any
    }
  | Plugin

export interface LazyPluginAuthor {
  name: string
  url?: string
  avatar?: string
  isVerified?: boolean
}

export interface LazyPluginDescriptor {
  id: string
  name: string
  description?: string
  detailedDescription?: string
  version?: string
  author?: string | LazyPluginAuthor
  category?: string
  icon?: IconRef | string | any
  tags?: string[]
  features?: string[]
  nodeKinds?: string[]
  pluginUrl?: string
  defaultInstalled?: boolean
  loadPlugin: () => Promise<LazyPluginLoadedResult>
}

export type PanelRegistrar = (panel: any) => void

export interface PluginManagerSnapshot {
  descriptors: LazyPluginDescriptor[]
  states: Record<string, PluginState>
}

function isDevMode(): boolean {
  try {
    const meta = import.meta as { env?: { DEV?: boolean } }
    if (typeof meta?.env?.DEV === 'boolean') return meta.env.DEV
  } catch {
    // import.meta unavailable in some CJS contexts — fall through.
  }
  if (typeof process !== 'undefined' && process.env?.NODE_ENV) {
    return process.env.NODE_ENV !== 'production'
  }
  return false
}

export class PluginManager {
  private readonly descriptors = new Map<string, LazyPluginDescriptor>()
  private readonly states = new Map<string, PluginState>()
  private readonly loadingPromises = new Map<string, Promise<void>>()
  private readonly panelRegistrars = new Set<PanelRegistrar>()
  private readonly listeners = new Set<() => void>()
  private cachedSnapshot: PluginManagerSnapshot | null = null

  /**
   * Register a single lazy plugin descriptor.
   */
  registerDescriptor(descriptor: LazyPluginDescriptor): void {
    if (typeof descriptor.id !== 'string' || descriptor.id.length === 0) {
      throw new Error('[plugin-manager] descriptor id must be a non-empty string')
    }
    if (typeof descriptor.loadPlugin !== 'function') {
      throw new Error(
        `[plugin-manager] descriptor "${descriptor.id}" must provide a loadPlugin function`,
      )
    }

    if (this.descriptors.has(descriptor.id)) {
      if (isDevMode()) {
        console.warn(`[plugin-manager] re-registering descriptor "${descriptor.id}" (HMR)`)
      }
    }

    this.descriptors.set(descriptor.id, descriptor)
    if (!this.states.has(descriptor.id)) {
      this.states.set(descriptor.id, {
        id: descriptor.id,
        status: 'unloaded',
        error: null,
      })
    }
    this.cachedSnapshot = null
    this.emit()
  }

  /**
   * Register multiple lazy plugin descriptors at once.
   */
  registerDescriptors(descriptors: LazyPluginDescriptor[]): void {
    for (const d of descriptors) {
      this.registerDescriptor(d)
    }
  }

  /**
   * Retrieve descriptor by id.
   */
  getDescriptor(id: string): LazyPluginDescriptor | undefined {
    return this.descriptors.get(id)
  }

  /**
   * Get all registered descriptors.
   */
  getDescriptors(): LazyPluginDescriptor[] {
    return Array.from(this.descriptors.values())
  }

  /**
   * Check whether a descriptor is registered.
   */
  hasDescriptor(id: string): boolean {
    return this.descriptors.has(id)
  }

  /**
   * Get current state of a plugin.
   */
  getPluginState(id: string): PluginState {
    const existing = this.states.get(id)
    if (existing) return existing
    return {
      id,
      status: 'unloaded',
      error: null,
    }
  }

  /**
   * Get all plugin states as a record.
   */
  getAllStates(): Record<string, PluginState> {
    const result: Record<string, PluginState> = {}
    for (const [id, state] of this.states.entries()) {
      result[id] = state
    }
    return result
  }

  /**
   * Attach a registrar callback that will be called whenever an installed plugin
   * provides a host panel.
   */
  setPanelRegistrar(registrar: PanelRegistrar): () => void {
    this.panelRegistrars.add(registrar)
    return () => {
      this.panelRegistrars.delete(registrar)
    }
  }

  /**
   * Subscribe to state/descriptor changes (React useSyncExternalStore compatible).
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Snapshot accessor for useSyncExternalStore.
   */
  getSnapshot = (): PluginManagerSnapshot => {
    if (!this.cachedSnapshot) {
      this.cachedSnapshot = {
        descriptors: this.getDescriptors(),
        states: this.getAllStates(),
      }
    }
    return this.cachedSnapshot
  }

  /**
   * Dynamically installs and activates a plugin by its descriptor ID.
   * Deduplicates concurrent calls.
   */
  installPlugin(id: string): Promise<void> {
    const descriptor = this.descriptors.get(id)
    if (!descriptor) {
      const err = new Error(`[plugin-manager] Plugin descriptor "${id}" not found`)
      return Promise.reject(err)
    }

    const current = this.getPluginState(id)
    if (current.status === 'installed') {
      return Promise.resolve()
    }

    const existingPromise = this.loadingPromises.get(id)
    if (existingPromise) {
      return existingPromise
    }

    const installPromise = (async () => {
      this.setState(id, { id, status: 'loading', error: null })
      try {
        const loaded = await descriptor.loadPlugin()
        const plugin =
          loaded && typeof loaded === 'object' && 'plugin' in loaded ? loaded.plugin : (loaded as Plugin)
        const panel =
          loaded && typeof loaded === 'object' && 'panel' in loaded ? loaded.panel : undefined

        if (!plugin || typeof plugin !== 'object' || typeof plugin.id !== 'string') {
          throw new Error(
            `[plugin-manager] Plugin "${id}" loadPlugin did not return a valid Plugin manifest`,
          )
        }

        await loadPlugin(plugin)

        if (panel) {
          for (const registrar of this.panelRegistrars) {
            try {
              registrar(panel)
            } catch (panelErr) {
              console.warn(`[plugin-manager] Failed to register panel for plugin "${id}":`, panelErr)
            }
          }
        }

        this.setState(id, {
          id,
          status: 'installed',
          error: null,
          loadedAt: Date.now(),
        })
      } catch (err: any) {
        const message = err instanceof Error ? err.message : String(err)
        this.setState(id, {
          id,
          status: 'error',
          error: message,
        })
        throw err
      } finally {
        this.loadingPromises.delete(id)
      }
    })()

    this.loadingPromises.set(id, installPromise)
    return installPromise
  }

  /**
   * Mark plugin as uninstalled / unloaded in state.
   */
  uninstallPlugin(id: string): void {
    if (this.states.has(id)) {
      this.setState(id, {
        id,
        status: 'unloaded',
        error: null,
      })
    }
  }

  /**
   * Test-only reset helper. Clears all descriptors and states.
   */
  _reset(): void {
    this.descriptors.clear()
    this.states.clear()
    this.loadingPromises.clear()
    this.panelRegistrars.clear()
    this.cachedSnapshot = null
    this.emit()
  }

  private setState(id: string, state: PluginState): void {
    this.states.set(id, state)
    this.cachedSnapshot = null
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }
}

export const pluginManager = new PluginManager()
