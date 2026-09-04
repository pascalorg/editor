import { defineKind } from '../core/types'

export const resistance = defineKind({
  kind: 'resistance',
  baseUnit: 'Ω',
  units: [
    {
      id: 'mΩ',
      symbol: 'mΩ',
      name: 'milliohm',
      aliases: ['milliohms'],
      caseExact: ['mΩ'],
      factor: 1e-3,
      system: 'shared',
      best: 0,
    },
    {
      id: 'Ω',
      symbol: 'Ω',
      name: 'ohm',
      aliases: ['ohms'],
      factor: 1,
      system: 'shared',
      best: 1,
    },
    {
      id: 'kΩ',
      symbol: 'kΩ',
      name: 'kilohm',
      aliases: ['kilohms', 'kiloohm', 'kiloohms', 'kohm', 'kohms'],
      factor: 1000,
      system: 'shared',
      best: 2,
    },
    {
      id: 'MΩ',
      symbol: 'MΩ',
      name: 'megohm',
      aliases: ['megohms', 'megaohm', 'megaohms'],
      caseExact: ['MΩ'],
      factor: 1e6,
      system: 'shared',
      best: 3,
    },
  ],
} as const)
