import { defineKind } from '../core/types'

export const substance = defineKind({
  kind: 'substance',
  baseUnit: 'mol',
  units: [
    {
      id: 'μmol',
      symbol: 'μmol',
      name: 'micromole',
      aliases: ['micromoles', 'umol'],
      factor: 1e-6,
      system: 'shared',
      best: 0,
    },
    {
      id: 'mmol',
      symbol: 'mmol',
      name: 'millimole',
      aliases: ['millimoles'],
      factor: 1e-3,
      system: 'shared',
      best: 1,
    },
    {
      id: 'mol',
      symbol: 'mol',
      name: 'mole',
      aliases: ['moles'],
      factor: 1,
      system: 'shared',
      best: 2,
    },
    {
      id: 'kmol',
      symbol: 'kmol',
      name: 'kilomole',
      aliases: ['kilomoles'],
      factor: 1000,
      system: 'shared',
      best: 3,
    },
  ],
} as const)
