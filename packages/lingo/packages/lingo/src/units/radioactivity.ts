import { defineKind } from '../core/types'

export const radioactivity = defineKind({
  kind: 'radioactivity',
  baseUnit: 'Bq',
  units: [
    {
      id: 'Bq',
      symbol: 'Bq',
      name: 'becquerel',
      caseExact: ['Bq'],
      factor: 1,
      system: 'shared',
      best: 0,
    },
    {
      id: 'kBq',
      symbol: 'kBq',
      name: 'kilobecquerel',
      caseExact: ['kBq'],
      factor: 1000,
      system: 'shared',
      best: 1,
    },
    {
      id: 'MBq',
      symbol: 'MBq',
      name: 'megabecquerel',
      caseExact: ['MBq'],
      factor: 1e6,
      system: 'shared',
      best: 2,
    },
    {
      id: 'Ci',
      symbol: 'Ci',
      name: 'curie',
      caseExact: ['Ci'],
      factor: 3.7e10,
      system: 'shared',
    },
    {
      id: 'mCi',
      symbol: 'mCi',
      name: 'millicurie',
      caseExact: ['mCi'],
      factor: 3.7e7,
      system: 'shared',
    },
    {
      id: 'μCi',
      symbol: 'μCi',
      name: 'microcurie',
      caseExact: ['μCi', 'µCi', 'uCi'],
      factor: 3.7e4,
      system: 'shared',
    },
  ],
} as const)
