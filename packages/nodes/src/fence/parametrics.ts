import type { ParametricDescriptor } from '@pascal-app/core'
import type { FenceNode } from './schema'

/**
 * Inspector descriptor for fence.
 *
 * Mirrors the legacy `fence-panel.tsx` controls but rendered by the
 * generic `<ParametricInspector>`. Endpoints (`start` / `end`) and
 * `curveOffset` are edited via floor-plan affordances and 3D handles,
 * not number inputs — kept out of parametrics.
 */
export const fenceParametrics: ParametricDescriptor<FenceNode> = {
  groups: [
    {
      label: 'Dimensions',
      fields: [
        { key: 'height', kind: 'number', unit: 'm', min: 0.4, max: 3.5, step: 0.05 },
        { key: 'thickness', kind: 'number', unit: 'm', min: 0.02, max: 0.3, step: 0.005 },
        { key: 'baseHeight', kind: 'number', unit: 'm', min: 0, max: 0.6, step: 0.01 },
        { key: 'groundClearance', kind: 'number', unit: 'm', min: 0, max: 0.5, step: 0.01 },
      ],
    },
    {
      label: 'Posts',
      fields: [
        { key: 'postSpacing', kind: 'number', unit: 'm', min: 0.5, max: 5, step: 0.1 },
        { key: 'postSize', kind: 'number', unit: 'm', min: 0.04, max: 0.4, step: 0.01 },
        { key: 'topRailHeight', kind: 'number', unit: 'm', min: 0, max: 0.2, step: 0.005 },
        { key: 'edgeInset', kind: 'number', unit: 'm', min: 0, max: 0.1, step: 0.005 },
      ],
    },
    {
      label: 'Style',
      fields: [
        {
          key: 'style',
          kind: 'enum',
          options: ['slat', 'rail', 'privacy'],
          display: 'segmented',
        },
        {
          key: 'baseStyle',
          kind: 'enum',
          options: ['grounded', 'floating'],
          display: 'segmented',
        },
        { key: 'showInfill', kind: 'boolean' },
      ],
    },
  ],
}
