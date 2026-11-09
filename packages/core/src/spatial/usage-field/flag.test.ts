import { afterEach, describe, expect, test } from 'bun:test'
import { sdfChecksFromEnv, sdfChecksOn, setSdfChecks } from './flag'

afterEach(() => setSdfChecks(false))

describe('the usage-checks flag', () => {
  test('is off until a host turns it on, and a host turns it off again', () => {
    expect(sdfChecksOn()).toBe(false)
    setSdfChecks(true)
    expect(sdfChecksOn()).toBe(true)
    setSdfChecks(false)
    expect(sdfChecksOn()).toBe(false)
  })

  test('PASCAL_SDF_CHECKS turns it on with 1 or true and nothing else does', () => {
    for (const on of ['1', 'true', 'TRUE', 'True']) expect(sdfChecksFromEnv(on)).toBe(true)
    for (const off of [undefined, '', '0', 'false', 'no', 'yes', ' 1', '2'])
      expect(sdfChecksFromEnv(off)).toBe(false)
  })
})
