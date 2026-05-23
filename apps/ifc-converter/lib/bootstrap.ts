import { type AnyNodeDefinition, nodeRegistry, registerNode } from '@pascal-app/core'
import { builtinPlugin } from '@pascal-app/nodes'

// Mirrors apps/editor/lib/bootstrap.ts — registers every built-in node
// kind synchronously so the registry is populated before the first
// `<Viewer>` mounts. Without this every NodeRenderer resolves to null
// and the preview is empty. HMR-safe via the closure-scoped flag.
let builtinsLoaded = false

export function loadBuiltins(): void {
  if (builtinsLoaded) return
  builtinsLoaded = true
  for (const def of builtinPlugin.nodes ?? []) {
    registerNode(def as AnyNodeDefinition)
  }
  if (typeof console !== 'undefined') {
    const kinds = Array.from(nodeRegistry.entries(), ([k]) => k)
    console.info(
      `[pascal:registry] loaded ${builtinPlugin.id} v${builtinPlugin.apiVersion} (${kinds.length} kinds)`,
    )
  }
}

loadBuiltins()
