export type CabinetRevealGapId = '2' | '3' | '4' | '6'

export const CABINET_REVEAL_GAPS = [
  { id: '2', label: '2 mm', value: 0.002 },
  { id: '3', label: '3 mm', value: 0.003 },
  { id: '4', label: '4 mm', value: 0.004 },
  { id: '6', label: '6 mm', value: 0.006 },
] as const satisfies ReadonlyArray<{
  id: CabinetRevealGapId
  label: string
  value: number
}>

export function cabinetRevealGapId(value: number): CabinetRevealGapId | 'custom' {
  const match = CABINET_REVEAL_GAPS.find((gap) => Math.abs(gap.value - value) < 1e-4)
  return match?.id ?? 'custom'
}

export function cabinetRevealGapById(id: CabinetRevealGapId) {
  return CABINET_REVEAL_GAPS.find((gap) => gap.id === id) ?? CABINET_REVEAL_GAPS[1]
}
