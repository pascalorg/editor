import { describe, expect, test } from 'bun:test'
import { getRoofEditVisibility } from './roof-edit-visibility'

describe('getRoofEditVisibility', () => {
  test('keeps the merged shell visible while a roof segment moves', () => {
    expect(getRoofEditVisibility({ isMoving: true, isReveal: false })).toEqual({
      merged: true,
      segments: false,
    })
  })

  test('reveals accessory portals without replacing the merged shell', () => {
    expect(getRoofEditVisibility({ isMoving: false, isReveal: true })).toEqual({
      merged: true,
      segments: true,
    })
  })
})
