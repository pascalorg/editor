import { loadPlugin, nodeRegistry } from '@pascal-app/core'
import { builtinPlugin } from '@pascal-app/nodes'

// Idempotency guard: HMR can reload this module, but `registerNode` throws on
// duplicate kinds. The flag lives in the module closure so it's reset on a
// hard reload but survives within a session.
let loaded = false

function isDev(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env
  return env?.NODE_ENV !== 'production'
}

export function loadBuiltinNodes(): void {
  if (loaded) return
  loaded = true
  void loadPlugin(builtinPlugin)

  if (isDev()) {
    const kinds = Array.from(nodeRegistry.entries(), ([k]) => k)
    if (typeof console !== 'undefined') {
      // Visible in the browser dev console — the verification anchor for
      // "which path is running this kind?" Empty array = every kind is on
      // the legacy path. Kind in the array = registry path is live for it.
      console.info(
        `[pascal:registry] loaded ${builtinPlugin.id} v${builtinPlugin.apiVersion} (${kinds.length} kinds: ${kinds.join(', ') || '∅'})`,
      )
    }
    // Expose the registry on window for ad-hoc dev inspection. In prod the
    // registry is reachable through @pascal-app/core's exports only.
    if (typeof globalThis !== 'undefined') {
      ;(globalThis as { __pascalNodeRegistry?: typeof nodeRegistry }).__pascalNodeRegistry =
        nodeRegistry
    }
  }
}

// Run as a side effect on first import so any consumer of this module gets a
// populated registry without remembering to call the function explicitly.
loadBuiltinNodes()
