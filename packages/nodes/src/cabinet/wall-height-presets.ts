import type { CabinetNode } from '@pascal-app/core'

export type CabinetWallHeightPresetId = '18' | '24' | '30' | '36' | '42'

export type CabinetWallHeightPreset = {
  id: CabinetWallHeightPresetId
  label: string
  metricLabel: string
  value: number
}

export const CABINET_WALL_HEIGHT_PRESETS: CabinetWallHeightPreset[] = [
  { id: '18', label: '18″', metricLabel: '457 mm', value: 0.4572 },
  { id: '24', label: '24″', metricLabel: '610 mm', value: 0.6096 },
  { id: '30', label: '30″', metricLabel: '762 mm', value: 0.762 },
  { id: '36', label: '36″', metricLabel: '914 mm', value: 0.9144 },
  { id: '42', label: '42″', metricLabel: '1,067 mm', value: 1.0668 },
]

const WALL_HEIGHT_MATCH_TOLERANCE = 1e-4

export function cabinetWallHeightPresetId(
  node: Pick<CabinetNode, 'carcassHeight'> | number,
): CabinetWallHeightPresetId | 'custom' {
  const height = typeof node === 'number' ? node : node.carcassHeight
  return (
    CABINET_WALL_HEIGHT_PRESETS.find(
      (preset) => Math.abs(preset.value - height) <= WALL_HEIGHT_MATCH_TOLERANCE,
    )?.id ?? 'custom'
  )
}

export function cabinetWallHeightPresetById(
  id: CabinetWallHeightPresetId,
): CabinetWallHeightPreset {
  return CABINET_WALL_HEIGHT_PRESETS.find((preset) => preset.id === id)!
}
