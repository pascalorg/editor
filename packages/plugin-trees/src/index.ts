import type { AnyNodeDefinition, Plugin } from '@pascal-app/core'
// Side-effect: subscribes the panel store to `selection:find-node` so the
// host's "find in catalog" lands on the right Nature section (see find-sync.ts).
import './find-sync'
import { NATURE_ICON } from './art'
import { treeDefinition } from './definition'
import { flowerDefinition } from './flower-definition'
import { grassDefinition } from './grass-definition'

/**
 * The trees plugin manifest — the entire public surface of this package. A host
 * loads it through the same `loadPlugin` path the built-ins use: three node kinds
 * (`trees:tree`, `trees:flower`, `trees:grass`) and one left-rail panel
 * (`Trees`). Cast mirrors the built-in bundle: `AnyNodeDefinition` is the
 * hand-maintained union today; the registry derives it post-migration.
 */
export const treesPlugin: Plugin = {
  id: 'pascal:trees',
  apiVersion: 1,
  nodes: [
    treeDefinition as unknown as AnyNodeDefinition,
    flowerDefinition as unknown as AnyNodeDefinition,
    grassDefinition as unknown as AnyNodeDefinition,
  ],
  panels: [
    {
      id: 'trees',
      label: 'Nature',
      icon: { kind: 'url', src: NATURE_ICON },
      component: () => import('./presets-panel'),
    },
  ],
}

// NOTE: no re-export from './geometry' — it imports ez-tree, which touches
// `document` at module scope and would crash SSR (this barrel is eagerly
// imported by host bootstraps). Lazy client modules import it directly.
export { treeDefinition } from './definition'
export { flowerDefinition } from './flower-definition'
export { FlowerNode, FlowerPreset } from './flower-schema'
export { grassDefinition } from './grass-definition'
export { GrassNode, GrassPreset } from './grass-schema'
export { TreeNode, TreePreset } from './schema'
