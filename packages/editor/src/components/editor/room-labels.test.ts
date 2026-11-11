import { describe, expect, test } from 'bun:test'
import { editorRoomLabelsVisible, type RoomLabelVisibilityState } from './room-labels'

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

describe('room label pills in the editor', () => {
  test('show on the resting level, with only the site, building or level picked', () => {
    expect(editorRoomLabelsVisible(resting)).toBe(true)
    expect(editorRoomLabelsVisible({ ...resting, selectedTypes: ['level'] })).toBe(true)
  })

  test('step back for a kept room, a tool, a gesture, site, a capture, or the viewer rule', () => {
    for (const change of [
      { room: { levelId: 'level_1', zoneId: 'zone_1' } },
      { mode: 'build' },
      { scopeIdle: false },
      { phase: 'site' },
      { isCaptureMode: true },
      { isThumbnailCapture: true },
      { zoneId: 'zone_1' },
      { selectedTypes: ['wall'] },
    ] satisfies Partial<RoomLabelVisibilityState>[]) {
      expect(editorRoomLabelsVisible({ ...resting, ...change })).toBe(false)
    }
  })
})
