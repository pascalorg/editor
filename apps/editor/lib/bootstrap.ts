import { loadPlugin } from '@pascal-app/core'
import { builtinPlugin } from '@pascal-app/nodes'

// Idempotency guard: HMR can reload this module, but `registerNode` throws on
// duplicate kinds. The flag lives in the module closure so it's reset on a
// hard reload but survives within a session.
let loaded = false

export function loadBuiltinNodes(): void {
  if (loaded) return
  loaded = true
  void loadPlugin(builtinPlugin)
}

// Run as a side effect on first import so any consumer of this module gets a
// populated registry without remembering to call the function explicitly.
loadBuiltinNodes()
