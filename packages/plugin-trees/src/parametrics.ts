import { type AnyNodeId, type ParametricDescriptor, useScene } from '@pascal-app/core'
import { TREE_SEED_POOL } from './presets'
import type { TreeNode } from './schema'

/**
 * The tree's right-hand inspector. This descriptor is the entire inspector —
 * the host's `ParametricInspector` renders the preset select, height slider,
 * seed field, and the randomize action with zero tree-specific code in the
 * editor. Demonstrates the "right inspector comes free from `def.parametrics`"
 * leg of the plugin surface.
 */
export const treeParametrics: ParametricDescriptor<TreeNode> = {
  groups: [
    {
      label: 'Tree',
      fields: [
        { key: 'preset', kind: 'enum', options: ['oak', 'pine', 'aspen', 'ash', 'bush'] },
        { key: 'height', kind: 'number', unit: 'm', min: 1, max: 15, step: 0.5 },
        { key: 'seed', kind: 'number', min: 0, max: 9999, step: 1 },
      ],
    },
    {
      label: 'Foliage',
      fields: [
        { key: 'leafless', kind: 'boolean' },
        {
          key: 'foliageDensity',
          kind: 'number',
          min: 0,
          max: 1.5,
          step: 0.1,
          visibleIf: (n) => !n.leafless,
        },
        { key: 'trunkThickness', kind: 'number', min: 0.3, max: 2.5, step: 0.1 },
      ],
    },
    {
      label: 'Position',
      fields: [{ key: 'position', kind: 'vec3' }],
    },
  ],
  actions: [
    {
      label: 'Randomize',
      // The action receives the live node; writing a new seed re-generates the
      // tree. Pick from the bounded pool so the result stays an instancing
      // variant shared with other trees, not a one-off mesh.
      onClick: (n) =>
        useScene.getState().updateNode(
          n.id as AnyNodeId,
          {
            seed: TREE_SEED_POOL[Math.floor(Math.random() * TREE_SEED_POOL.length)] ?? 1,
          } as Partial<TreeNode> as never,
        ),
    },
  ],
}
