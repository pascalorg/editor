import { describe, expect, test } from 'bun:test'
import { extractDeviceOverrides, isMovedDeviceNode } from './overrides'
import { DEVICE_KINDS, DeviceNode } from './schema'

describe('DeviceNode schema', () => {
  test('parses a seeded receptacle node', () => {
    const node = DeviceNode.parse({
      deviceId: 'recep:w1:0:p',
      deviceKind: 'receptacle',
      wallId: 'w1',
      wallT: 0.25,
      heightAff: 0.381,
      seedWallId: 'w1',
      seedWallT: 0.25,
      seedHeightAff: 0.381,
    })
    expect(node.type).toBe('bones:device')
    expect(node.id.startsWith('bonesdevice')).toBe(true)
    expect(node.position).toEqual([0, 0, 0])
    expect(DEVICE_KINDS).toContain(node.deviceKind)
  })

  test('rejects unknown kinds and out-of-range wallT', () => {
    expect(() =>
      DeviceNode.parse({ deviceId: 'x', deviceKind: 'dimmer' }),
    ).toThrow()
    expect(() =>
      DeviceNode.parse({ deviceId: 'x', deviceKind: 'switch', wallT: 1.5 }),
    ).toThrow()
    expect(() =>
      DeviceNode.parse({ deviceId: 'x', deviceKind: 'switch', wallT: -0.1 }),
    ).toThrow()
  })
})

describe('isMovedDeviceNode — anchor vs seed', () => {
  const seeded = (extra: Record<string, unknown> = {}) => ({
    type: 'bones:device',
    deviceId: 'recep:w1:0:p',
    deviceKind: 'receptacle',
    wallId: 'w1',
    wallT: 0.25,
    heightAff: 0.381,
    seedWallId: 'w1',
    seedWallT: 0.25,
    seedHeightAff: 0.381,
    position: [0, 0, 0],
    ...extra,
  })

  test('anchor == seed → NOT moved (tracks the derivation)', () => {
    expect(isMovedDeviceNode(seeded())).toBe(false)
  })

  test('any anchor drift IS a move: wallT, heightAff, wallId, position', () => {
    expect(isMovedDeviceNode(seeded({ wallT: 0.3 }))).toBe(true)
    expect(isMovedDeviceNode(seeded({ heightAff: 0.6 }))).toBe(true)
    expect(isMovedDeviceNode(seeded({ wallId: 'w2' }))).toBe(true)
    expect(isMovedDeviceNode(seeded({ position: [1, 0, 2] }))).toBe(true)
  })

  test('a node with no seed at all is an explicit override', () => {
    expect(
      isMovedDeviceNode({
        type: 'bones:device',
        deviceId: 'recep:w1:0:p',
        wallId: 'w1',
        wallT: 0.4,
        position: [0, 0, 0],
      }),
    ).toBe(true)
  })

  test('NaN anchors never count as moves', () => {
    expect(isMovedDeviceNode(seeded({ wallT: Number.NaN, heightAff: Number.NaN }))).toBe(false)
    expect(isMovedDeviceNode(seeded({ position: [Number.NaN, 0, 0] }))).toBe(false)
  })
})

describe('extractDeviceOverrides', () => {
  const node = (
    id: string,
    deviceId: string,
    fields: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    id,
    type: 'bones:device',
    parentId: 'level_1',
    deviceId,
    deviceKind: 'receptacle',
    wallId: 'w1',
    wallT: 0.25,
    heightAff: 0.381,
    seedWallId: 'w1',
    seedWallT: 0.25,
    seedHeightAff: 0.381,
    position: [0, 0, 0],
    ...fields,
  })

  test('unmoved nodes extract NOTHING (byte-equality path)', () => {
    const { overrides, duplicates } = extractDeviceOverrides(
      { a: node('a', 'recep:w1:0:p') },
      'level_1',
    )
    expect(overrides.size).toBe(0)
    expect(duplicates).toEqual([])
  })

  test('a moved node extracts its full anchor', () => {
    const { overrides } = extractDeviceOverrides(
      { a: node('a', 'recep:w1:0:p', { wallT: 0.6, heightAff: 0.9 }) },
      'level_1',
    )
    expect(overrides.get('recep:w1:0:p')).toEqual({
      wallId: 'w1',
      wallT: 0.6,
      heightAff: 0.9,
      position: [0, 0, 0],
    })
  })

  test('duplicates: lowest node id wins, extras reported; hidden + foreign-level skipped', () => {
    const { overrides, duplicates } = extractDeviceOverrides(
      {
        z: node('z', 'recep:w1:0:p', { wallT: 0.9 }),
        a: node('a', 'recep:w1:0:p', { wallT: 0.6 }),
        hidden: node('hidden', 'recep:w1:1:p', { wallT: 0.7, visible: false }),
        other: node('other', 'recep:w1:2:p', { wallT: 0.7, parentId: 'level_2' }),
      },
      'level_1',
    )
    expect(overrides.get('recep:w1:0:p')?.wallT).toBe(0.6)
    expect(duplicates).toEqual(['recep:w1:0:p'])
    expect(overrides.has('recep:w1:1:p')).toBe(false)
    expect(overrides.has('recep:w1:2:p')).toBe(false)
  })

  test('NaN guards: non-finite fields are dropped, never trusted', () => {
    const { overrides } = extractDeviceOverrides(
      {
        a: node('a', 'recep:w1:0:p', {
          wallT: 0.6,
          heightAff: Number.POSITIVE_INFINITY,
          position: [Number.NaN, 0, 1],
        }),
      },
      'level_1',
    )
    const o = overrides.get('recep:w1:0:p')
    expect(o?.wallT).toBe(0.6)
    expect(o?.heightAff).toBeUndefined()
    expect(o?.position).toEqual([0, 0, 1])
  })
})
