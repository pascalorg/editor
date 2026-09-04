import { defineKind } from '../core/types'

export const radiationEquivalentDose = defineKind({
  kind: 'radiation_equivalent_dose',
  baseUnit: 'Sv',
  units: [
    {
      id: 'μSv',
      symbol: 'μSv',
      name: 'microsievert',
      plural: 'microsieverts',
      caseExact: ['μSv', 'µSv', 'uSv'],
      factor: 1e-6,
      system: 'shared',
      best: 0,
    },
    {
      id: 'mSv',
      symbol: 'mSv',
      name: 'millisievert',
      plural: 'millisieverts',
      caseExact: ['mSv'],
      factor: 1e-3,
      system: 'shared',
      best: 1,
    },
    {
      id: 'Sv',
      symbol: 'Sv',
      name: 'sievert',
      caseExact: ['Sv'],
      factor: 1,
      system: 'shared',
      best: 2,
    },
    {
      id: 'rem',
      symbol: 'rem',
      name: 'rem',
      factor: 0.01,
      system: 'shared',
    },
  ],
} as const)
