import { describe, expect, test } from 'bun:test'
import type { AnyNode } from '@pascal-app/core'
import { nextZoneName } from './zone-name'

const zone = (id: string, name?: string) => ({ id, type: 'zone', name }) as unknown as AnyNode

describe('nextZoneName', () => {
  test('room zones do not consume zone numbers', () => {
    expect(nextZoneName({ a: zone('a', 'Room'), b: zone('b', 'Kitchen') })).toBe('Zone 1')
  })

  test('continues after the highest existing Zone N', () => {
    expect(nextZoneName({ a: zone('a', 'Zone 1'), b: zone('b', 'Zone 4'), c: zone('c') })).toBe(
      'Zone 5',
    )
  })
})
