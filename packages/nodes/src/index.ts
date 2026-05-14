import type { AnyNodeDefinition, Plugin } from '@pascal-app/core'
import { shelfDefinition } from './shelf'
import { spawnDefinition } from './spawn'

/**
 * Feature flag for the Phase 2 spike. When `NEXT_PUBLIC_USE_REGISTRY_FOR_SPAWN`
 * is truthy, spawn registers through the registry path; otherwise the legacy
 * `SpawnRenderer` and `SpawnTool` in viewer/editor packages own the kind.
 *
 * Removed in the PR that signs off parity (legacy spawn files deleted in the
 * same commit). All other built-in node migrations follow the same pattern.
 */
function isSpawnRegistryEnabled(): boolean {
  // Next.js / Turbopack inlines `process.env.NEXT_PUBLIC_*` references at
  // build time, but ONLY when the access is a literal property — dynamic
  // bracket access (`env[name]`) is not substituted and resolves to
  // undefined in the browser. Keep this as a literal so the value is baked
  // into the client bundle.
  if (typeof process === 'undefined') return false
  const flag = process.env.NEXT_PUBLIC_USE_REGISTRY_FOR_SPAWN
  return flag === '1' || flag === 'true'
}

function getBuiltinNodes(): AnyNodeDefinition[] {
  const nodes: AnyNodeDefinition[] = [
    // Shelf is a new kind — no legacy code to flag against. It ships
    // unconditionally so users can place it from the tool palette.
    shelfDefinition as unknown as AnyNodeDefinition,
  ]
  if (isSpawnRegistryEnabled()) {
    nodes.push(spawnDefinition as unknown as AnyNodeDefinition)
  }
  return nodes
}

/**
 * Built-in plugin bundling every node kind shipped with the Pascal editor.
 *
 * Apps load this once at bootstrap (`loadPlugin(builtinPlugin)`) before
 * mounting the viewer. New built-in nodes are added by creating a folder
 * here under `src/<kind>/` and appending its `NodeDefinition` to `getBuiltinNodes`.
 *
 * External plugins follow the exact same shape — same `Plugin` type, same
 * `loadPlugin` call path. This is intentional: the API is stress-tested
 * by built-ins before any third-party plugin lands.
 */
export const builtinPlugin: Plugin = {
  id: 'pascal:core',
  apiVersion: 1,
  nodes: getBuiltinNodes(),
}

export { shelfDefinition } from './shelf'
export { spawnDefinition } from './spawn'
