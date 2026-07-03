import type { ParametricDescriptor } from '@pascal-app/core'
import type { FactoryTankNode } from './schema'

export const tankParametrics: ParametricDescriptor<FactoryTankNode> = {
  groups: [
    {
      label: 'Equipment',
      fields: [
        {
          key: 'orientation',
          kind: 'enum',
          options: ['vertical', 'horizontal'],
          display: 'segmented',
        },
        { key: 'capacity', kind: 'number', unit: 'm3', min: 0, step: 1 },
        { key: 'liquidLevel', kind: 'number', min: 0, max: 1, step: 0.05 },
      ],
    },
    {
      label: 'Envelope',
      fields: [
        { key: 'length', kind: 'number', unit: 'm', min: 0.4, step: 0.1 },
        { key: 'width', kind: 'number', unit: 'm', min: 0.4, step: 0.1 },
        { key: 'height', kind: 'number', unit: 'm', min: 0.4, step: 0.1 },
      ],
    },
    {
      label: 'Ports',
      fields: [
        { key: 'inletDiameter', kind: 'number', unit: 'm', min: 0.025, step: 0.01 },
        { key: 'outletDiameter', kind: 'number', unit: 'm', min: 0.025, step: 0.01 },
      ],
    },
    {
      label: 'Appearance',
      fields: [
        { key: 'shellColor', kind: 'color' },
        { key: 'bandColor', kind: 'color' },
        { key: 'liquidColor', kind: 'color' },
      ],
    },
  ],
}
