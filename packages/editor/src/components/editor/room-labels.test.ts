import { describe, expect, test } from 'bun:test'
import { formatRoomArea, type RoomLabelVisibilityState, roomLabelsVisible } from './room-labels'

const resting: RoomLabelVisibilityState = {
  phase: 'building',
  mode: 'select',
  scopeIdle: true,
  room: null,
  selectedTypes: [],
  zoneId: null,
  focusedUnitId: null,
  isCaptureMode: false,
  isThumbnailCapture: false,
}

describe('room label pills', () => {
  test('show on the resting level, with only the site, building or level picked', () => {
    expect(roomLabelsVisible(resting)).toBe(true)
    for (const type of ['site', 'building', 'level']) {
      expect(roomLabelsVisible({ ...resting, selectedTypes: [type] })).toBe(true)
    }
  })

  test('step back for any other selection, a room, a zone, a unit, a tool, a gesture or site', () => {
    for (const change of [
      { selectedTypes: ['wall'] },
      { selectedTypes: ['level', 'item'] },
      { selectedTypes: [undefined] },
      { room: { levelId: 'level_1', zoneId: 'zone_1' } },
      { zoneId: 'zone_1' },
      { focusedUnitId: 'unit_1' },
      { mode: 'build' },
      { scopeIdle: false },
      { phase: 'site' },
      { isCaptureMode: true },
      { isThumbnailCapture: true },
    ] satisfies Partial<RoomLabelVisibilityState>[]) {
      expect(roomLabelsVisible({ ...resting, ...change })).toBe(false)
    }
  })

  test('read the area in the active unit system', () => {
    expect(formatRoomArea(33, 'metric')).toBe('33.0 m²')
    expect(formatRoomArea(10, 'imperial')).toBe('107.6 ft²')
  })
})
