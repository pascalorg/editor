import type { ParametricDescriptor } from '@pascal-app/core'
import type { TurbineVentNode } from './schema'

/**
 * Inspector descriptor for the turbine vent. Move / Duplicate need the
 * kind-owned ghost-preview flow (see `./move-tool.tsx`), so the panel
 * hosts those actions itself instead of relying on the generic inspector.
 */
export const turbineVentParametrics: ParametricDescriptor<TurbineVentNode> = {
  customPanel: () => import('./panel'),
  groups: [
    {
      label: 'Style',
      labelKey: 'common.style',
      fields: [
        {
          key: 'style',
          kind: 'enum',
          options: ['globe', 'cylinder'],
          optionLabelKeys: {
            "globe": "nodes.turbineVent.globe",
            "cylinder": "nodes.turbineVent.cylinder"
          },
          display: 'segmented',
        },
      ],
    },
    {
      label: 'Dimensions',
      labelKey: 'common.dimensions',
      fields: [
        { key: 'diameter', kind: 'number', unit: 'm', min: 0.15, max: 1000, step: 0.01 },
        { key: 'height', kind: 'number', unit: 'm', min: 0.2, max: 1000, step: 0.01 },
        { key: 'neckHeight', kind: 'number', unit: 'm', min: 0.02, max: 0.3, step: 0.01 },
        { key: 'vaneCount', kind: 'number', unit: '', min: 6, max: 36, step: 1 },
      ],
    },
    {
      label: 'Motion',
      labelKey: 'nodes.turbineVent.motion',
      fields: [{ key: 'spinSpeed', kind: 'number', unit: 'rad/s', min: 0, max: 4, step: 0.1 }],
    },
  ],
}
