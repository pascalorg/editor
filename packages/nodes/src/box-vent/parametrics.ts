import type { ParametricDescriptor } from '@pascal-app/core'
import type { BoxVentNode } from './schema'

/**
 * Inspector descriptor for the box vent. Position / rotation are
 * surfaced by the framework via `capabilities.movable` + the bespoke
 * move tool — not in this descriptor.
 */
export const boxVentParametrics: ParametricDescriptor<BoxVentNode> = {
  groups: [
    {
      label: 'Style',
      fields: [
        {
          key: 'style',
          kind: 'enum',
          options: ['standard', 'low-profile', 'dome'],
          display: 'segmented',
        },
      ],
    },
    {
      label: 'Dimensions',
      fields: [
        { key: 'width', kind: 'number', unit: 'm', min: 0.15, max: 0.8, step: 0.01 },
        { key: 'depth', kind: 'number', unit: 'm', min: 0.15, max: 0.8, step: 0.01 },
        { key: 'height', kind: 'number', unit: 'm', min: 0.05, max: 0.4, step: 0.01 },
        { key: 'hoodOverhang', kind: 'number', unit: 'm', min: 0, max: 0.12, step: 0.005 },
      ],
    },
  ],
}
