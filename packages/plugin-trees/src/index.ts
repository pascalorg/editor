import type { AnyNodeDefinition, Plugin } from '@pascal-app/core'
import { treeDefinition } from './definition'
import { flowerDefinition } from './flower-definition'

/**
 * The trees plugin manifest — the entire public surface of this package. A host
 * loads it through the same `loadPlugin` path the built-ins use: two node kinds
 * (`trees:tree`, `trees:flower`) and one left-rail panel (`Trees`). Cast mirrors
 * the built-in bundle: `AnyNodeDefinition` is the hand-maintained union today;
 * the registry derives it post-migration.
 */
export const treesPlugin: Plugin = {
  id: 'pascal:trees',
  apiVersion: 1,
  nodes: [
    treeDefinition as unknown as AnyNodeDefinition,
    flowerDefinition as unknown as AnyNodeDefinition,
  ],
  panels: [
    {
      id: 'trees',
      label: 'Trees',
      icon: { kind: 'iconify', name: 'lucide:trees' },
      component: () => import('./presets-panel'),
    },
  ],
}

export { treeDefinition } from './definition'
export { flowerDefinition } from './flower-definition'
export { FlowerNode, FlowerPreset } from './flower-schema'
export { generateTree } from './geometry'
export { TreeNode, TreePreset } from './schema'
