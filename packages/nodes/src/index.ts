import type { AnyNodeDefinition, Plugin } from '@pascal-app/core'
import { shelfDefinition } from './shelf'
import { spawnDefinition } from './spawn'

/**
 * Built-in plugin bundling every node kind shipped with the Pascal editor.
 *
 * Apps load this once at bootstrap (`loadPlugin(builtinPlugin)`) before
 * mounting the viewer. New built-in nodes are added by creating a folder
 * here under `src/<kind>/` and appending its `NodeDefinition` below.
 *
 * External plugins follow the exact same shape — same `Plugin` type, same
 * `loadPlugin` call path. This is intentional: the API is stress-tested
 * by built-ins before any third-party plugin lands.
 *
 * Phase 2 status: shelf is a brand-new kind. Spawn is migrated to the
 * registry path — the legacy SpawnRenderer / SpawnTool files are still
 * present in viewer/editor packages but short-circuited by the Phase 0
 * dispatch shims (`nodeRegistry.has('spawn')` is true → legacy path
 * yields). Legacy spawn files are deleted in a follow-up PR.
 */
export const builtinPlugin: Plugin = {
  id: 'pascal:core',
  apiVersion: 1,
  nodes: [
    shelfDefinition as unknown as AnyNodeDefinition,
    spawnDefinition as unknown as AnyNodeDefinition,
  ],
}

export { shelfDefinition } from './shelf'
export { spawnDefinition } from './spawn'
