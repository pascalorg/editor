import { defineKind } from '../core/types'

export const angle = defineKind({
  kind: 'angle',
  baseUnit: 'rad',
  units: [
    {
      id: 'rad',
      symbol: 'rad',
      name: 'radian',
      factor: 1,
      system: 'shared',
    },
    {
      id: 'deg',
      symbol: '°',
      name: 'degree',
      aliases: ['deg'],
      factor: Math.PI / 180,
      system: 'shared',
      intl: 'degree',
      best: 0,
    },
    {
      id: 'arcmin',
      symbol: 'arcmin',
      name: 'arcminute',
      aliases: ["'", '′'],
      factor: Math.PI / 10_800,
      system: 'shared',
    },
    {
      id: 'arcsec',
      symbol: 'arcsec',
      name: 'arcsecond',
      aliases: ['"', "''"],
      factor: Math.PI / 648_000,
      system: 'shared',
    },
    {
      id: 'gon',
      symbol: 'gon',
      name: 'gon',
      factor: Math.PI / 200,
      system: 'shared',
    },
    {
      id: 'turn',
      symbol: 'turn',
      name: 'turn',
      factor: 2 * Math.PI,
      system: 'shared',
    },
  ],
} as const)
