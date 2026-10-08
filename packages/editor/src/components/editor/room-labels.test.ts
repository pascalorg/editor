import { describe, expect, test } from 'bun:test'
import {
  applyDeclutter,
  declutterLabels,
  formatRoomArea,
  type RoomLabelVisibilityState,
  roomLabelsVisible,
} from './room-labels'

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

  test('overlapping pills keep the nearer one; apart, all stay', () => {
    const rect = (left: number, top: number) => ({ left, top, right: left + 100, bottom: top + 24 })
    expect(
      declutterLabels([
        { id: 'far', distance: 12, rect: rect(40, 10) },
        { id: 'near', distance: 4, rect: rect(0, 0) },
        { id: 'apart', distance: 20, rect: rect(300, 0) },
        { id: 'behind-far', distance: 30, rect: rect(60, 20) },
      ]),
    ).toEqual(new Set(['far', 'behind-far']))
    expect(
      declutterLabels([
        { id: 'a', distance: 1, rect: rect(0, 0) },
        { id: 'b', distance: 2, rect: rect(0, 40) },
      ]).size,
    ).toBe(0)
  })

  test('a hidden pill lets clicks through, and is interactive again when it has room', () => {
    const elements = ['near', 'far'].map((id) => ({
      dataset: { roomLabel: id },
      style: { opacity: '', pointerEvents: '' },
    }))
    const rect = { left: 0, top: 0, right: 100, bottom: 24 }
    applyDeclutter(elements as unknown as HTMLElement[], [
      { id: 'near', distance: 1, rect },
      { id: 'far', distance: 2, rect },
    ])
    expect(elements[1]!.style).toEqual({ opacity: '0', pointerEvents: 'none' })
    applyDeclutter(elements as unknown as HTMLElement[], [
      { id: 'near', distance: 1, rect },
      { id: 'far', distance: 2, rect: { ...rect, top: 50, bottom: 74 } },
    ])
    expect(elements[1]!.style).toEqual({ opacity: '', pointerEvents: '' })
  })
})
