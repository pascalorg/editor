import { describe, expect, test } from 'bun:test'
import { formatConstructionLength } from './construction-length'

describe('formatConstructionLength profiles', () => {
  test('keeps metre notation for interactive metric dimensions', () => {
    expect(formatConstructionLength(3.456, 'metric')).toBe('3.46m')
    expect(formatConstructionLength(-0.004, 'metric')).toBe('0m')
  })

  test('uses whole millimetres without a suffix for metric documents', () => {
    expect(formatConstructionLength(3.4564, 'metric', 'document')).toBe('3456')
    expect(formatConstructionLength(-0.004, 'metric', 'document')).toBe('-4')
  })

  test('keeps architectural imperial notation in document output', () => {
    expect(formatConstructionLength(1.524, 'imperial', 'document')).toBe(`5'-0"`)
  })
})
