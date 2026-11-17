import {
  type AnyNodeDefinition,
  discoverPlugins,
  extendPluginDiscovery,
  loadPlugin,
  nodeRegistry,
  registerNode,
} from '@pascal-app/core'
import { sdfChecksFromEnv, setSdfChecks } from '@pascal-app/core/usage-field'
import { registerEditorHostPanel } from '@pascal-app/editor'
import { builtinPlugin } from '@pascal-app/nodes'
import { configureViewer, registerViewerPresentation } from '@pascal-app/viewer'

configureViewer({
  sfxBaseUrl: '/audios/sfx',
  iconsBaseUrl: '/icons',
  assetsBaseUrl: process.env.NEXT_PUBLIC_ASSETS_CDN_URL,
  storageUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
})

// Usage checks (passages, turning circles, flow widths) are off unless the build says so; Next
// inlines the NEXT_PUBLIC_ mirror of the server's PASCAL_SDF_CHECKS.
setSdfChecks(sdfChecksFromEnv(process.env.NEXT_PUBLIC_PASCAL_SDF_CHECKS))

// Idempotency guards: HMR can reload this module, but `registerNode`
// throws on duplicate kinds. Flags live in the module closure so they
// reset on a hard reload but survive within a session.
let builtinsLoaded = false
let externalsKickedOff = false
let discoveryRegistered = false

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
 * `discoverPlugins()` stays async and loads all external packs lazily via
 * `loadExternalPlugins()` so heavy plugin packages (~190 MB in dev) do not
 * block initial bundle parse, hydration, or first paint.
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

function registerExternalPluginLoaders(): void {
  if (discoveryRegistered) return
  discoveryRegistered = true

  extendPluginDiscovery(async () => {
    const { treesHostPanel, treesPlugin } = await import('@pascal-app/plugin-trees')
    registerEditorHostPanel(treesHostPanel)
    return [treesPlugin]
  })
  extendPluginDiscovery(async () => {
    const { environmentHostPanel, environmentPlugin, environmentPresentation } = await import(
      '@pascal-app/plugin-environment'
    )
    registerEditorHostPanel(environmentHostPanel)
    registerViewerPresentation(environmentPresentation)
    return [environmentPlugin]
  })
  extendPluginDiscovery(async () => {
    const { bonesHostPanel, bonesPlugin } = await import('@pascal-app/plugin-bones')
    // Opt-in: Bones ships uninstalled — users enable it per scene from the
    // Plugins panel (engineering X-ray is a specialist view, not a default).
    registerEditorHostPanel({ ...bonesHostPanel, defaultInstalled: false })
    return [bonesPlugin]
  })
  extendPluginDiscovery(async () => {
    const { mintHostPanel, mintPlugin } = await import('@mint/pascal-plugin')
    registerEditorHostPanel(mintHostPanel)
    return [mintPlugin]
  })
  extendPluginDiscovery(async () => {
    const { poolHostPanel, poolPlugin } = await import('@pascal-app/plugin-pool')
    registerEditorHostPanel(poolHostPanel)
    return [poolPlugin]
  })
  extendPluginDiscovery(async () => {
    const { landscapeHostPanel, landscapePlugin } = await import('@pascal-app/plugin-landscape')
    registerEditorHostPanel(landscapeHostPanel)
    return [landscapePlugin]
  })
  extendPluginDiscovery(async () => {
    const { bathSpaceHostPanel, bathSpacePlugin } = await import('@pascal-app/plugin-bath-space')
    registerEditorHostPanel(bathSpaceHostPanel)
    return [bathSpacePlugin]
  })
  extendPluginDiscovery(async () => {
    const { streetscapeHostPanel, streetscapePlugin } = await import(
      '@pascal-app/plugin-streetscape'
    )
    registerEditorHostPanel({
      ...streetscapeHostPanel,
      creator: { name: 'Sudhir Yadav', url: 'https://github.com/sudhir9297' },
    })
    return [streetscapePlugin]
  })
  extendPluginDiscovery(async () => {
    const { webXRHostPanel, webXRPlugin } = await import('@webxr/plugin')
    registerEditorHostPanel(webXRHostPanel)
    return [webXRPlugin]
  })
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

function scheduleExternalPluginsLoad(): void {
  // External plugins only provide interactive 3D renderers and client panels;
  // deferring discovery on the client keeps initial SSR, hydration, and canvas
  // mount unblocked by heavy external plugin bundles.
  if (typeof window === 'undefined') return
  const run = () => {
    void loadExternalPlugins()
  }
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(run, { timeout: 300 })
  } else {
    window.setTimeout(run, 150)
  }
}

registerExternalPluginLoaders()
loadBuiltinsSync()
scheduleExternalPluginsLoad()
