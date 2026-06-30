import { type AnyNodeId, type ParametricDescriptor, useScene } from '@pascal-app/core'
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
        { key: 'preset', kind: 'enum', options: ['oak', 'pine', 'birch', 'palm'] },
        { key: 'height', kind: 'number', unit: 'm', min: 1, max: 15, step: 0.5 },
        { key: 'seed', kind: 'number', min: 0, max: 9999, step: 1 },
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
      // The action receives the live node; writing a new seed re-runs the
      // geometry builder (seed is part of the definition's geometryKey).
      onClick: (n) =>
        useScene.getState().updateNode(
          n.id as AnyNodeId,
          {
            seed: Math.floor(Math.random() * 10000),
          } as Partial<TreeNode> as never,
        ),
    },
  ],
}
