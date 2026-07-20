import { describe, expect, test } from 'bun:test'
import { ZoneNode } from './zone'

describe('ZoneNode architectural room data', () => {
  test('keeps legacy zones generic while supplying room-safe defaults', () => {
    const zone = ZoneNode.parse({
      id: 'zone_legacy',
      name: 'Landscape area',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
      ],
    })

    expect(zone).toMatchObject({
      spaceRole: 'generic',
      roomNumber: '',
      enclosureStatus: 'auto',
      floorFinish: '',
      wallFinish: '',
      ceilingFinish: '',
      ceilingHeight: 2.7,
      occupancy: '',
      clearDimensionPolicy: 'none',
    })
  })

  test('persists a complete architectural room profile', () => {
    const room = ZoneNode.parse({
      id: 'zone_office',
      name: 'Office',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
      ],
      spaceRole: 'room',
      roomNumber: '101',
      enclosureStatus: 'enclosed',
      floorFinish: 'Timber',
      wallFinish: 'Paint',
      ceilingFinish: 'ACT',
      ceilingHeight: 3,
      occupancy: 'Business',
      clearDimensionPolicy: 'inside-faces',
    })

    expect(room.spaceRole).toBe('room')
    expect(room.roomNumber).toBe('101')
    expect(room.clearDimensionPolicy).toBe('inside-faces')
  })
})
