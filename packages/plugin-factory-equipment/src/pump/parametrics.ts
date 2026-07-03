import type { ParametricDescriptor } from '@pascal-app/core'
import type { FactoryPumpNode } from './schema'

export const pumpParametrics: ParametricDescriptor<FactoryPumpNode> = {
  groups: [
    {
      label: 'Equipment',
      fields: [
        {
          key: 'pumpType',
          kind: 'enum',
          options: ['centrifugal', 'positive_displacement', 'metering'],
          display: 'segmented',
        },
        { key: 'flowRate', kind: 'number', unit: 'm3/h', min: 0, step: 5 },
        { key: 'motorPower', kind: 'number', unit: 'kW', min: 0, step: 1 },
        { key: 'skidMounted', kind: 'boolean' },
      ],
    },
    {
      label: 'Envelope',
      fields: [
        { key: 'length', kind: 'number', unit: 'm', min: 0.4, step: 0.1 },
        { key: 'width', kind: 'number', unit: 'm', min: 0.3, step: 0.1 },
        { key: 'height', kind: 'number', unit: 'm', min: 0.3, step: 0.1 },
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
        { key: 'casingColor', kind: 'color' },
        { key: 'motorColor', kind: 'color' },
        { key: 'skidColor', kind: 'color' },
      ],
    },
  ],
}
