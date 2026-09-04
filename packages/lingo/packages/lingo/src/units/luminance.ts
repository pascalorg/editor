import { defineKind } from '../core/types'

export const luminance = defineKind({
  kind: 'luminance',
  baseUnit: 'cd/m2',
  units: [
    {
      id: 'cd/m2',
      symbol: 'cd/m²',
      name: 'candela per square meter',
      plural: 'candelas per square meter',
      aliases: ['cd/m^2', 'cd/m2', 'candela per square metre', 'candelas per square metre'],
      factor: 1,
      system: 'shared',
      best: 0,
    },
    {
      id: 'nit',
      symbol: 'nit',
      name: 'nit',
      factor: 1,
      system: 'shared',
    },
    {
      id: 'fL',
      symbol: 'fL',
      name: 'foot-lambert',
      plural: 'foot-lamberts',
      aliases: ['foot lambert', 'foot lamberts'],
      caseExact: ['fL'],
      factor: 3.426_259_099_635_39,
      system: 'imperial',
    },
  ],
} as const)
