import type { ParametricDescriptor } from '@pascal-app/core'
import type { HvacEquipmentNode } from './schema'

export const hvacEquipmentParametrics: ParametricDescriptor<HvacEquipmentNode> = {
  groups: [
    {
      label: 'Equipment',
      fields: [
        {
          key: 'equipmentType',
          kind: 'enum',
          options: ['furnace', 'air-handler', 'condenser'],
          display: 'segmented',
        },
      ],
    },
    {
      label: 'Cabinet',
      fields: [
        { key: 'width', kind: 'number', unit: 'm', min: 0.3, max: 2, step: 0.05 },
        { key: 'depth', kind: 'number', unit: 'm', min: 0.3, max: 2, step: 0.05 },
        { key: 'height', kind: 'number', unit: 'm', min: 0.4, max: 2.5, step: 0.05 },
      ],
    },
    {
      label: 'Connections',
      fields: [
        {
          key: 'supplyDiameter',
          kind: 'number',
          unit: 'in',
          min: 6,
          max: 30,
          step: 1,
          visibleIf: (n) => n.equipmentType !== 'condenser',
        },
        {
          key: 'returnDiameter',
          kind: 'number',
          unit: 'in',
          min: 6,
          max: 30,
          step: 1,
          visibleIf: (n) => n.equipmentType !== 'condenser',
        },
      ],
    },
  ],
}
