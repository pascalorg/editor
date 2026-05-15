import type { AnyNodeDefinition, Plugin } from '@pascal-app/core'
import { ceilingDefinition } from './ceiling'
import { doorDefinition } from './door'
import { fenceDefinition } from './fence'
import { itemDefinition } from './item'
import { shelfDefinition } from './shelf'
import { slabDefinition } from './slab'
import { spawnDefinition } from './spawn'
import { wallDefinition } from './wall'
import { windowDefinition } from './window'

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
 * All kinds are registered unconditionally. Parity is verified by
 * comparing against deployed production rather than an in-app env-var
 * flag toggle. Legacy paths still exist in `viewer/` and `editor/` for
 * kinds undergoing migration; they short-circuit via the Phase 0
 * `<LegacySystem>` wrapper + `NodeRenderer`'s registry-first dispatch.
 * Phase 6 deletes the legacy paths.
 */
export const builtinPlugin: Plugin = {
  id: 'pascal:core',
  apiVersion: 1,
  nodes: [
    shelfDefinition as unknown as AnyNodeDefinition,
    spawnDefinition as unknown as AnyNodeDefinition,
    wallDefinition as unknown as AnyNodeDefinition,
    fenceDefinition as unknown as AnyNodeDefinition,
    slabDefinition as unknown as AnyNodeDefinition,
    ceilingDefinition as unknown as AnyNodeDefinition,
    doorDefinition as unknown as AnyNodeDefinition,
    windowDefinition as unknown as AnyNodeDefinition,
    itemDefinition as unknown as AnyNodeDefinition,
  ],
}

export { ceilingDefinition } from './ceiling'
export { doorDefinition } from './door'
export { fenceDefinition } from './fence'
export { itemDefinition } from './item'
export { shelfDefinition } from './shelf'
export { slabDefinition } from './slab'
export { spawnDefinition } from './spawn'
export { wallDefinition } from './wall'
export { windowDefinition } from './window'
