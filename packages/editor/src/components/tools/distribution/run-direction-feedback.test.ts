import { describe, expect, test } from 'bun:test'
import { resolveRunDirectionCandidates, run3DDirectionCandidates } from './run-direction-feedback'

describe('distribution run direction feedback', () => {
  test('shows eight world-axis and diagonal candidates from a free start', () => {
    const candidates = resolveRunDirectionCandidates([0, 0, 0], [2, 0, 1], null, 'free')

    expect(candidates).toHaveLength(8)
    expect(candidates.some((candidate) => candidate.active)).toBe(false)
  })

  test('highlights the winning angle-locked candidate', () => {
    const candidates = resolveRunDirectionCandidates([0, 0, 0], [2, 0, 1], null, 'angle')
    const active = candidates.find((candidate) => candidate.active)

    expect(active?.direction[0]).toBeCloseTo(Math.SQRT1_2)
    expect(active?.direction[2]).toBeCloseTo(Math.SQRT1_2)
  })

  test('uses the connected run direction and its valid forward turns', () => {
    const candidates = resolveRunDirectionCandidates(
      [0, 0, 0],
      [2, 0, 0],
      [Math.SQRT1_2, 0, Math.SQRT1_2],
      'angle',
    )

    expect(candidates).toHaveLength(9)
    expect(candidates[0]?.direction[0]).toBeCloseTo(Math.SQRT1_2)
    expect(candidates[0]?.direction[2]).toBeCloseTo(Math.SQRT1_2)
  })

  test('offers vertical, lateral, and rising directions from a horizontal run', () => {
    const directions = run3DDirectionCandidates([1, 0, 0])

    expect(directions).toContainEqual([0, 1, 0])
    expect(directions).toContainEqual([0, -1, 0])
    expect(directions).toContainEqual([0, 0, 1])
    expect(directions).toContainEqual([0, 0, -1])
    const rising = directions.find(
      (direction) => direction[0] > 0 && direction[1] > 0 && direction[2] === 0,
    )
    const falling = directions.find(
      (direction) => direction[0] > 0 && direction[1] < 0 && direction[2] === 0,
    )
    expect(rising?.[0]).toBeCloseTo(Math.SQRT1_2)
    expect(rising?.[1]).toBeCloseTo(Math.SQRT1_2)
    expect(falling?.[0]).toBeCloseTo(Math.SQRT1_2)
    expect(falling?.[1]).toBeCloseTo(-Math.SQRT1_2)
  })

  test('switches to an up/down candidate pair for vertical routing', () => {
    const candidates = resolveRunDirectionCandidates([1, 2, 3], [1, 0.5, 3], null, 'vertical')

    expect(candidates).toEqual([
      { direction: [0, 1, 0], active: false },
      { direction: [0, -1, 0], active: true },
    ])
  })
})
