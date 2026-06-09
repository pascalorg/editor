import { describe, expect, test } from 'bun:test'
import { stripTransient } from './placement-math'

describe('stripTransient', () => {
  test('removes placement-only metadata flags before commit', () => {
    expect(stripTransient({ isNew: true, isTransient: true, label: 'copy' })).toEqual({
      label: 'copy',
    })
  })
})
