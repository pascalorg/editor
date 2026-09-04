import { defineKind } from '../core/types'

export const radiationAbsorbedDose = defineKind({
  kind: 'radiation_absorbed_dose',
  baseUnit: 'Gy',
  units: [
    {
      id: 'μGy',
      symbol: 'μGy',
      name: 'microgray',
      plural: 'micrograys',
      caseExact: ['μGy', 'µGy', 'uGy'],
      factor: 1e-6,
      system: 'shared',
      best: 0,
    },
    {
      id: 'mGy',
      symbol: 'mGy',
      name: 'milligray',
      plural: 'milligrays',
      caseExact: ['mGy'],
      factor: 1e-3,
      system: 'shared',
      best: 1,
    },
    {
      id: 'Gy',
      symbol: 'Gy',
      name: 'gray',
      plural: 'grays',
      caseExact: ['Gy'],
      factor: 1,
      system: 'shared',
      best: 2,
    },
  ],
} as const)
