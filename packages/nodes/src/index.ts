import type { AnyNodeDefinition, Plugin } from '@pascal-app/core'
import { fenceDefinition, isFenceRegistryEnabled } from './fence'
import { shelfDefinition } from './shelf'
import { spawnDefinition } from './spawn'
import { isWallRegistryEnabled, wallDefinition } from './wall'

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
 * Status by kind:
 *  - **shelf**: brand-new kind, registry-driven, no legacy. Registered
 *    unconditionally.
 *  - **spawn**: migrated to the registry path during Phase 2. Legacy
 *    SpawnRenderer / SpawnTool files still present in viewer/editor but
 *    short-circuited by the Phase 0 shims. Registered unconditionally.
 *  - **wall**: registry-driven behind `NEXT_PUBLIC_USE_REGISTRY_FOR_WALL`.
 *    Phase 3 stress test; flag drops when fixture parity signs off.
 *  - **fence**: registry-driven behind `NEXT_PUBLIC_USE_REGISTRY_FOR_FENCE`.
 *    First Phase 5 batch-migration kind. Same shape as wall (thin
 *    renderer + system re-export); pure geometry / floor-plan / tool
 *    affordance ports as later milestones.
 */
const wallEntries: AnyNodeDefinition[] = isWallRegistryEnabled()
  ? [wallDefinition as unknown as AnyNodeDefinition]
  : []

const fenceEntries: AnyNodeDefinition[] = isFenceRegistryEnabled()
  ? [fenceDefinition as unknown as AnyNodeDefinition]
  : []

export const builtinPlugin: Plugin = {
  id: 'pascal:core',
  apiVersion: 1,
  nodes: [
    shelfDefinition as unknown as AnyNodeDefinition,
    spawnDefinition as unknown as AnyNodeDefinition,
    ...wallEntries,
    ...fenceEntries,
  ],
}

export { fenceDefinition } from './fence'
export { shelfDefinition } from './shelf'
export { spawnDefinition } from './spawn'
export { wallDefinition } from './wall'
