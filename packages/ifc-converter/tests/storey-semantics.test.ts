import { describe, expect, it } from 'bun:test'
import { selectStoreyForElevation } from '../src/storey-semantics'

const storeys = [
  { expressId: 30, elevation: 6 },
  { expressId: 10, elevation: -1.25 },
  { expressId: 20, elevation: 3.1 },
]

describe('selectStoreyForElevation', () => {
  it('uses the lowest storey for an element below every storey', () => {
    expect(selectStoreyForElevation(storeys, -2)).toBe(10)
  })

  it('uses the nearest storey at or below the element', () => {
    expect(selectStoreyForElevation(storeys, 4)).toBe(20)
    expect(selectStoreyForElevation(storeys, 8)).toBe(30)
  })

  it('returns null when no storey is available', () => {
    expect(selectStoreyForElevation([], 0)).toBeNull()
  })
})
