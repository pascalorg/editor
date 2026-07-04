import {
  type AnyNodeDefinition,
  discoverPlugins,
  loadPlugin,
  nodeRegistry,
  registerNode,
  setPluginDiscovery,
} from '@pascal-app/core'
import { builtinPlugin } from '@pascal-app/nodes'
import { factoryEquipmentPlugin } from '@pascal-app/plugin-factory-equipment'
import { treesPlugin } from '@pascal-app/plugin-trees'

// Idempotency guards: HMR can reload this module, but `registerNode`
// throws on duplicate kinds. Flags live in the module closure so they
// reset on a hard reload but survive within a session.
let builtinsLoaded = false
let externalsKickedOff = false

function isDev(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env
  return env?.NODE_ENV !== 'production'
}

function shouldLoadNaturePlugin(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env
  return (
    env?.PASCAL_ENABLE_NATURE_PLUGIN === '1' ||
    env?.NEXT_PUBLIC_PASCAL_ENABLE_NATURE_PLUGIN === '1'
  )
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
    registerNode(def as AnyNodeDefinition)
  }

  if (isDev()) {
    const kinds = Array.from(nodeRegistry.entries(), ([k]) => k)
    if (typeof console !== 'undefined') {
      console.info(
        `[pascal:registry] loaded ${builtinPlugin.id} v${builtinPlugin.apiVersion} (${kinds.length} kinds: ${kinds.join(', ') || '∅'})`,
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
    console.info(`[pascal:registry] + ${externals.length} discovered plugin(s)`)
  }
}

// Register first-party plugins through the same discovery hook a third-party
// pack would use. Must be set before `loadExternalPlugins()` reads it below.
setPluginDiscovery(async () =>
  shouldLoadNaturePlugin() ? [factoryEquipmentPlugin, treesPlugin] : [factoryEquipmentPlugin],
)

loadBuiltinsSync()
void loadExternalPlugins()
