import { describe, expect, test } from 'bun:test'
import { isSitePlanAvailable } from './drawing-type-switch'

describe('isSitePlanAvailable', () => {
  test('a site with neither a parcel nor setbacks has no site plan', () => {
    expect(isSitePlanAvailable(null, false)).toBe(false)
    expect(isSitePlanAvailable({}, false)).toBe(false)
  })

  test('a resolved lot or a contributing plugin offers it', () => {
    expect(isSitePlanAvailable({ parcel: { apn: '06075' } }, false)).toBe(true)
    expect(isSitePlanAvailable({ setbacks: { front: 6, side: 1.5, rear: 3 } }, false)).toBe(true)
    expect(isSitePlanAvailable({}, true)).toBe(true)
  })
})
