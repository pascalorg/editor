import { expect, test } from 'bun:test'
import { formatRoomArea } from './room-area'

test('a room area reads in the active unit system', () => {
  expect(formatRoomArea(33, 'metric')).toBe('33.0 m²')
  expect(formatRoomArea(10, 'imperial')).toBe('107.6 ft²')
})
