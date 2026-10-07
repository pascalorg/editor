import { describe, expect, test } from 'bun:test'

// Projection math for typed-length wall drafting (#308) — mirrors the inline
// projection in `tool.tsx` (3D) and `floorplan-panel.tsx` (2D). Kept as a pure
// function test so both views stay honest about the same contract.
export function projectTypedLength(
  start: [number, number],
  pointer: [number, number],
  typedLength: number,
): [number, number] | null {
  const dx = pointer[0] - start[0]
  const dz = pointer[1] - start[1]
  const pointerLength = Math.hypot(dx, dz)
  if (pointerLength <= 1e-6) return null
  return [
    start[0] + (dx / pointerLength) * typedLength,
    start[1] + (dz / pointerLength) * typedLength,
  ]
}

describe('typed-length projection', () => {
  test('projects the endpoint onto the typed length along the draft direction', () => {
    const end = projectTypedLength([0, 0], [3, 4], 1)
    // Direction (3,4)/5 — a 1 m wall lands on the unit direction.
    expect(end).toEqual([0.6, 0.8])
  })

  test('keeps the pointer direction, replaces the distance', () => {
    const end = projectTypedLength([1, 1], [11, 1], 2.5)
    expect(end?.[0]).toBeCloseTo(3.5, 10)
    expect(end?.[1]).toBeCloseTo(1, 10)
  })

  test('handles diagonal directions at any pointer overshoot', () => {
    const end = projectTypedLength([0, 0], [-30, -40], 5)
    expect(end?.[0]).toBeCloseTo(-3, 10)
    expect(end?.[1]).toBeCloseTo(-4, 10)
  })

  test('returns null for a degenerate pointer on the start point', () => {
    expect(projectTypedLength([2, 2], [2, 2], 3)).toBeNull()
  })
})
