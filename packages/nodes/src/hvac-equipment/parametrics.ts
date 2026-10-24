import type { ParametricDescriptor } from '@pascal-app/core'
import type { HvacEquipmentNode } from './schema'

export const hvacEquipmentParametrics: ParametricDescriptor<HvacEquipmentNode> = {
  groups: [
    {
      label: 'Refrigerant connections',
      fields: [
        { key: 'serviceFace', kind: 'enum', options: ['left', 'right'], display: 'segmented' },
        { key: 'suctionDiameter', kind: 'number', unit: 'in', min: 0.25, max: 2, step: 0.125 },
        { key: 'liquidDiameter', kind: 'number', unit: 'in', min: 0.125, max: 1, step: 0.125 },
      ],
    },
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
      label: 'Supply',
      fields: [
        {
          key: 'supplyFace',
          kind: 'enum',
          options: ['top', 'left', 'right'],
          display: 'segmented',
          visibleIf: (n) => n.equipmentType !== 'condenser',
        },
        {
          key: 'supplyShape',
          kind: 'enum',
          options: ['round', 'rect', 'oval'],
          display: 'segmented',
          visibleIf: (n) => n.equipmentType !== 'condenser',
        },
        {
          key: 'supplyDiameter',
          kind: 'number',
          unit: 'in',
          min: 6,
          max: 30,
          step: 1,
          visibleIf: (n) => n.equipmentType !== 'condenser' && n.supplyShape === 'round',
        },
        {
          key: 'supplyWidth',
          kind: 'number',
          unit: 'in',
          min: 6,
          max: 30,
          step: 1,
          visibleIf: (n) => n.equipmentType !== 'condenser' && n.supplyShape !== 'round',
        },
        {
          key: 'supplyHeight',
          kind: 'number',
          unit: 'in',
          min: 6,
          max: 30,
          step: 1,
          visibleIf: (n) => n.equipmentType !== 'condenser' && n.supplyShape !== 'round',
        },
      ],
    },
    {
      label: 'Return',
      fields: [
        {
          key: 'returnFace',
          kind: 'enum',
          options: ['left', 'right'],
          display: 'segmented',
          visibleIf: (n) => n.equipmentType !== 'condenser',
        },
        {
          key: 'returnShape',
          kind: 'enum',
          options: ['round', 'rect', 'oval'],
          display: 'segmented',
          visibleIf: (n) => n.equipmentType !== 'condenser',
        },
        {
          key: 'returnDiameter',
          kind: 'number',
          unit: 'in',
          min: 6,
          max: 30,
          step: 1,
          visibleIf: (n) => n.equipmentType !== 'condenser' && n.returnShape === 'round',
        },
        {
          key: 'returnWidth',
          kind: 'number',
          unit: 'in',
          min: 6,
          max: 30,
          step: 1,
          visibleIf: (n) => n.equipmentType !== 'condenser' && n.returnShape !== 'round',
        },
        {
          key: 'returnHeight',
          kind: 'number',
          unit: 'in',
          min: 6,
          max: 30,
          step: 1,
          visibleIf: (n) => n.equipmentType !== 'condenser' && n.returnShape !== 'round',
        },
      ],
    },
  ],
}
