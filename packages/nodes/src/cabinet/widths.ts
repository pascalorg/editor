export type CabinetStandardWidthId = '300' | '400' | '600' | '800'

export type CabinetStandardWidth = {
  id: CabinetStandardWidthId
  label: string
  value: number
}

export const CABINET_STANDARD_WIDTHS: CabinetStandardWidth[] = [
  { id: '300', label: '300 mm', value: 0.3 },
  { id: '400', label: '400 mm', value: 0.4 },
  { id: '600', label: '600 mm', value: 0.6 },
  { id: '800', label: '800 mm', value: 0.8 },
]

const WIDTH_MATCH_TOLERANCE = 1e-4

export function cabinetStandardWidthId(width: number): CabinetStandardWidthId | 'custom' {
  return (
    CABINET_STANDARD_WIDTHS.find(
      (candidate) => Math.abs(candidate.value - width) <= WIDTH_MATCH_TOLERANCE,
    )?.id ?? 'custom'
  )
}

export function cabinetStandardWidthById(id: CabinetStandardWidthId): CabinetStandardWidth {
  return CABINET_STANDARD_WIDTHS.find((candidate) => candidate.id === id)!
}
