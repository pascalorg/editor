import {
  type ParametricDescriptor,
  TREE_FORMS,
  TREE_LIMITS,
  type TreeNode,
  useScene,
} from '@pascal-app/core'
import { TreeSpreadControl } from './spread-control'

// The auto-inspector translates definition labels and options at display time.
export const treeParametrics: ParametricDescriptor<TreeNode> = {
  groups: [
    {
      label: 'Tree',
      fields: [
        { key: 'form', kind: 'enum', options: TREE_FORMS },
        {
          key: 'heightM',
          label: 'Height',
          kind: 'number',
          min: TREE_LIMITS.minHeight,
          max: TREE_LIMITS.maxHeight,
          step: 0.1,
          unit: 'm',
        },
        { key: 'spreadM', kind: 'custom', component: TreeSpreadControl },
        { key: 'foliage', kind: 'color' },
        { key: 'density', kind: 'number', min: 0, max: 1, step: 0.05 },
      ],
    },
  ],
  actions: [
    {
      label: 'Randomise',
      onClick: (node) => {
        const draw = Math.floor(Math.random() * 2147483648)
        const seed = draw === node.seed ? (draw + 1) % 2147483648 : draw
        useScene.getState().updateNode(node.id, { seed })
      },
    },
  ],
}
