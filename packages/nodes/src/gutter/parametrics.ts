import type { ParametricDescriptor } from '@pascal-app/core'
import type { GutterNode } from './schema'

export const gutterParametrics: ParametricDescriptor<GutterNode> = {
  groups: [
    {
      label: 'Profile',
      labelKey: 'nodes.gutter.profile',
      fields: [
        {
          key: 'profile',
          kind: 'enum',
          options: ['k-style', 'half-round', 'box'],
          display: 'segmented',
        },
      ],
    },
    {
      label: 'Dimensions',
      labelKey: 'common.dimensions',
      fields: [
        { key: 'length', kind: 'number', unit: 'm', min: 0.2, max: 1000, step: 0.05 },
        { key: 'size', kind: 'number', unit: 'm', min: 0.05, max: 0.3, step: 0.005 },
        {
          key: 'thickness',
          kind: 'number',
          unit: 'm',
          min: 0.001,
          max: 0.02,
          step: 0.001,
        },
      ],
    },
    {
      label: 'End caps',
      labelKey: 'nodes.gutter.endCaps',
      fields: [
        { key: 'endCapLeft', kind: 'boolean' },
        { key: 'endCapRight', kind: 'boolean' },
      ],
    },
    {
      label: 'Hangers',
      labelKey: 'nodes.gutter.hangers',
      fields: [
        {
          key: 'hangerStyle',
          kind: 'enum',
          options: ['strap', 'none'],
          display: 'segmented',
        },
        {
          key: 'hangerSpacing',
          kind: 'number',
          unit: 'm',
          min: 0.2,
          max: 2.0,
          step: 0.05,
          visibleIf: (n) => (n.hangerStyle ?? 'strap') !== 'none',
        },
      ],
    },
  ],
  onDeleteCascade: (node, nodes) =>
    Object.values(nodes)
      .filter((candidate) => candidate.type === 'downspout' && candidate.gutterId === node.id)
      .map((candidate) => candidate.id),
  // Lazy-loaded section that lists every downspout attached to this
  // gutter and offers an Add button at the bottom. Outlets are created
  // and removed through this panel (and the downspout placement tool) —
  // one outlet per downspout — so there's no separate outlet field group.
  trailingSection: () => import('./downspouts-panel'),
}
