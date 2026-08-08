import {
  type AnyNodeDefinition,
  discoverPlugins,
  extendPluginDiscovery,
  loadPlugin,
  nodeRegistry,
  registerNode,
} from '@pascal-app/core'
import { registerEditorHostPanel } from '@pascal-app/editor'
import { builtinPlugin } from '@pascal-app/nodes'
import {
  formworkTakeoffHostPanel,
  formworkValidationHostPanel,
} from '@pascal-app/nodes/formwork-assembly'
import { formworkSettingsHostPanel } from '@pascal-app/nodes/formwork-project-settings'
import { treesHostPanel, treesPlugin } from '@pascal-app/plugin-trees'

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

// Register the first-party example node plugin alongside any host-provided
// discovery source instead of replacing it. Its Nature rail panel is host UI,
// so it is registered separately from the core plugin manifest.
extendPluginDiscovery(async () => [treesPlugin])
registerEditorHostPanel(treesHostPanel)

// The formwork settings node is hidden and unselectable, so its editor cannot be an
// inspector — the pour has to be reachable before the first shutter exists, since it
// is what that shutter will be designed to. No `pluginId`: it ships with the product.
registerEditorHostPanel(formworkSettingsHostPanel)

// The takeoff's subject is a scope — the whole project or one level — and neither is
// a node that can be selected, so it cannot be an inspector either. It sits beside
// the settings: one is the pour every shutter is designed to, the other what that
// design adds up to across the job.
registerEditorHostPanel(formworkTakeoffHostPanel)

// And beside the takeoff, whether what it orders can be erected. Same scope, same
// reason it is not an inspector — and separate from the takeoff because a bill that
// totals correctly and a shutter that stands up are two different assertions.
registerEditorHostPanel(formworkValidationHostPanel)

loadBuiltinsSync()
void loadExternalPlugins()
