import type { AnyNodeDefinition, Plugin } from '@pascal-app/core'
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
 * Phase 2 status: shelf is a brand-new kind. Spawn is migrated to the
 * registry path — the legacy SpawnRenderer / SpawnTool files are still
 * present in viewer/editor packages but short-circuited by the Phase 0
 * dispatch shims (`nodeRegistry.has('spawn')` is true → legacy path
 * yields). Legacy spawn files are deleted in a follow-up PR.
 *
 * Phase 3 status: wall is registry-driven *behind a feature flag*. With
 * `NEXT_PUBLIC_USE_REGISTRY_FOR_WALL=true`, `wallDefinition` is included
 * here and the Phase 0 shims switch wall to the registry path; the
 * `<LegacySystem kind="wall">` wrappers around `WallSystem` and
 * `WallCutout` short-circuit and the bundled `system.tsx` re-mounts them
 * via `RegisteredSystems`. Off (default): wall stays on the legacy path.
 * The flag drops the moment parity is signed off across the Phase 3
 * fixture scenes — until then it gates the migration safely.
 */
const wallEntries: AnyNodeDefinition[] = isWallRegistryEnabled()
  ? [wallDefinition as unknown as AnyNodeDefinition]
  : []

export const builtinPlugin: Plugin = {
  id: 'pascal:core',
  apiVersion: 1,
  nodes: [
    shelfDefinition as unknown as AnyNodeDefinition,
    spawnDefinition as unknown as AnyNodeDefinition,
    ...wallEntries,
  ],
}

export { shelfDefinition } from './shelf'
export { spawnDefinition } from './spawn'
export { wallDefinition } from './wall'
