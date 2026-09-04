import {
  type AnyNodeDefinition,
  discoverPlugins,
  loadPlugin,
  nodeRegistry,
  pluginManager,
  registerNode,
} from '@pascal-app/core'
import { registerEditorHostPanel } from '@pascal-app/editor'
import { builtinPlugin } from '@pascal-app/nodes'
import { PLUGIN_CATALOG } from './plugins/catalog'
import { usePluginManager } from './plugins/use-plugin-manager'

// Idempotency guards: HMR can reload this module, but `registerNode`
// throws on duplicate kinds. Flags live in the module closure so they
// reset on a hard reload but survive within a session.
let builtinsLoaded = false
let externalsKickedOff = false
let catalogInitialized = false

function isDev(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env
  return env?.NODE_ENV !== 'production'
}

/**
 * Synchronously register every built-in node kind. Runs as a side
 * effect at module import time so the registry is populated *before*
 * any downstream React tree renders — the previous async kick-off
 * (`void loadBuiltinNodes()`) only registered in a microtask, letting
 * the first SSR / hydration pass see an empty registry. The mismatch
 * surfaced as a hydration error at the `<html>` element and every
 * `NodeRenderer` resolving to `null` until later renders.
 *
 * `discoverPlugins()` (which may hit the network for external packs)
 * stays async and runs separately via `loadExternalPlugins()`.
 */
function loadBuiltinsSync(): void {
  if (builtinsLoaded) return
  builtinsLoaded = true
  for (const def of builtinPlugin.nodes ?? []) {
    // Skip kinds the registry already has. The module-closure flag
    // above resets on HMR, but the registry singleton (in @pascal-app/core)
    // persists — without this guard we'd throw on the first duplicate.
    if (nodeRegistry.has((def as AnyNodeDefinition).kind)) continue
    registerNode(def as AnyNodeDefinition)
  }

  if (isDev()) {
    const kinds = Array.from(nodeRegistry.entries(), ([k]) => k)
    if (typeof console !== 'undefined') {
      console.info(
        `[digitaltwin:registry] loaded ${builtinPlugin.id} v${builtinPlugin.apiVersion} (${kinds.length} kinds: ${kinds.join(', ') || '∅'})`,
      )
    }
    // Expose the registry on globalThis for ad-hoc dev inspection. In
    // prod the registry is reachable through @pascal-app/core's
    // exports only.
    if (typeof globalThis !== 'undefined') {
      ;(globalThis as { __pascalNodeRegistry?: typeof nodeRegistry }).__pascalNodeRegistry =
        nodeRegistry
    }
  }
}

/**
 * Initialize dynamic lazy plugin catalog and hook panel registration.
 */
export function initPlugins(): void {
  if (catalogInitialized) return
  catalogInitialized = true

  // Connect plugin manager panel notifications to editor host panel registry
  pluginManager.setPanelRegistrar((panel) => {
    registerEditorHostPanel(panel)
  })

  // Register lazy plugin descriptors into pluginManager
  pluginManager.registerDescriptors(PLUGIN_CATALOG)

  // Kick off loading default plugins
  if (typeof window !== 'undefined') {
    void usePluginManager.getState().loadDefaultPlugins()
  }
}

/**
 * Phase 6 plugin discovery hook — runs once, asynchronously, after the
 * synchronous builtins are already registered. Apps that ship external
 * node packs override the discovery via `setPluginDiscovery(...)`
 * before this module loads. See `wiki/architecture/plugin-authoring.md`.
 */
export async function loadExternalPlugins(): Promise<void> {
  if (externalsKickedOff) return
  externalsKickedOff = true
  const externals = await discoverPlugins()
  for (const plugin of externals) {
    await loadPlugin(plugin)
  }
  if (isDev() && externals.length > 0 && typeof console !== 'undefined') {
    console.info(`[digitaltwin:registry] + ${externals.length} discovered plugin(s)`)
  }
}

loadBuiltinsSync()
initPlugins()
void loadExternalPlugins()
