import {
  formatNumber,
  getAreaUnitLabel,
  type LinearUnit,
  squareMetersToAreaUnit,
} from '@pascal-app/core'

export function formatRoomArea(squareMeters: number, unit: LinearUnit, locale?: string): string {
  return `${formatNumber(squareMetersToAreaUnit(squareMeters, unit), {
    min: 1,
    max: 1,
    locale,
  })} ${getAreaUnitLabel(unit)}`
}
