import { describe, expect, test } from 'bun:test'
import { resolveRoofDraftPlacement } from './roof-draft-orientation'

describe('resolveRoofDraftPlacement', () => {
  test('keeps the default draft axes', () => {
    expect(resolveRoofDraftPlacement(8, 5, false)).toEqual({
      width: 8,
      depth: 5,
      rotation: 0,
    })
  })

  test('swaps dimensions and turns the segment by 90 degrees', () => {
    const placement = resolveRoofDraftPlacement(8, 5, true)
    expect(placement).toEqual({
      width: 5,
      depth: 8,
      rotation: Math.PI / 2,
    })

    const halfWidth = placement.width / 2
    const halfDepth = placement.depth / 2
    const cos = Math.cos(placement.rotation)
    const sin = Math.sin(placement.rotation)
    const localCorners: Array<[number, number]> = [
      [-halfWidth, -halfDepth],
      [halfWidth, -halfDepth],
      [halfWidth, halfDepth],
      [-halfWidth, halfDepth],
    ]
    const corners: Array<[number, number]> = localCorners.map(([x, z]) => [
      x * cos + z * sin,
      -x * sin + z * cos,
    ])
    const xs = corners.map(([x]) => x)
    const zs = corners.map(([, z]) => z)
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(8)
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(5)
  })

  test('keeps the drafted world axes inside a rotated parent roof', () => {
    expect(resolveRoofDraftPlacement(8, 5, true, Math.PI / 4)).toEqual({
      width: 5,
      depth: 8,
      rotation: Math.PI / 4,
    })
  })
})
