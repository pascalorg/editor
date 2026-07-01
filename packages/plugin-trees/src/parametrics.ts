import { type AnyNodeId, type ParametricDescriptor, useScene } from '@pascal-app/core'
import { defaultHeightOf, TREE_SEED_POOL } from './presets'
import type { TreeNode } from './schema'

/**
 * The tree's right-hand inspector. This descriptor is the entire inspector —
 * the host's `ParametricInspector` renders every control (selects, sliders,
 * segmented switches, the native colour pickers, the vec3, and the Randomize
 * action) with zero tree-specific code in the editor. Demonstrates the "right
 * inspector comes free from `def.parametrics`" leg of the plugin surface.
 *
 * Colours (`leafColor`/`branchColor`) are edit-only — they're not on the
 * placement brush, so a planted tree starts neutral (texture colours) and is
 * tinted here per-tree.
 */
export const treeParametrics: ParametricDescriptor<TreeNode> = {
  groups: [
    {
      label: 'Tree',
      fields: [
        {
          key: 'preset',
          kind: 'enum',
          options: ['oak', 'pine', 'aspen', 'ash', 'bush', 'trellis'],
        },
        {
          key: 'size',
          kind: 'enum',
          options: ['small', 'medium', 'large'],
          display: 'segmented',
          visibleIf: (n) => n.preset !== 'trellis',
        },
        {
          key: 'treeType',
          kind: 'enum',
          options: ['deciduous', 'evergreen'],
          display: 'segmented',
        },
        { key: 'height', kind: 'number', unit: 'm', min: 1, max: 15, step: 0.5 },
        { key: 'branchColor', kind: 'color' },
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
        { key: 'leafColor', kind: 'color', visibleIf: (n) => !n.leafless },
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
    {
      label: 'Reset height',
      // Snap height back to the preset+size default (handy after changing size).
      onClick: (n) =>
        useScene
          .getState()
          .updateNode(
            n.id as AnyNodeId,
            { height: defaultHeightOf(n.preset, n.size) } as Partial<TreeNode> as never,
          ),
    },
  ],
}
