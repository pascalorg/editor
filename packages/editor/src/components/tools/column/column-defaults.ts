import {
  COLUMN_PRESETS,
  ColumnNode,
  type ColumnNode as ColumnNodeType,
  type ColumnPresetId,
} from '@pascal-app/core'

export const DEFAULT_COLUMN_PRESET_ID = 'basicPillar' satisfies ColumnPresetId

export function createColumnFromPreset(
  presetId: ColumnPresetId,
  position: [number, number, number],
): ColumnNodeType {
  const { label, ...preset } = COLUMN_PRESETS[presetId]
  return ColumnNode.parse({
    name: label,
    position,
    rotation: 0,
    ...preset,
  })
}
