import { describe, expect, test } from 'bun:test'
import {
  CABINET_WALL_HEIGHT_PRESETS,
  cabinetWallHeightPresetById,
  cabinetWallHeightPresetId,
} from '../wall-height-presets'

describe('wall cabinet height presets', () => {
  test('provides common wall sizes with metric equivalents', () => {
    expect(CABINET_WALL_HEIGHT_PRESETS.map((preset) => preset.id)).toEqual([
      '18',
      '24',
      '30',
      '36',
      '42',
    ])
    expect(cabinetWallHeightPresetById('30')).toMatchObject({
      label: '30″',
      metricLabel: '762 mm',
      value: 0.762,
    })
  })

  test('recognizes preset heights with small measurement noise', () => {
    expect(cabinetWallHeightPresetId(0.6096 + 0.00005)).toBe('24')
    expect(cabinetWallHeightPresetId(0.8)).toBe('custom')
  })
})
