import { describe, expect, test } from 'bun:test'
import { SlabNode } from '../../schema'
import { resolveSlabPlacementElevation } from './slab-placement'

describe('resolveSlabPlacementElevation', () => {
  test('places the default slab underside on the captured base', () => {
    const slab = SlabNode.parse({ polygon: [] })
    const elevation = resolveSlabPlacementElevation(slab, 1.2)

    expect(elevation).toBeCloseTo(1.25)
    expect(elevation - slab.thickness).toBeCloseTo(1.2)
  })

  test('preserves authored clearance and thickness', () => {
    const slab = SlabNode.parse({ elevation: 0.3, thickness: 0.1, polygon: [] })
    const elevation = resolveSlabPlacementElevation(slab, 1.2)

    expect(elevation).toBeCloseTo(1.5)
    expect(elevation - slab.thickness).toBeCloseTo(1.4)
    expect(slab.thickness).toBe(0.1)
  })

  test('keeps recessed slabs level-relative', () => {
    const slab = SlabNode.parse({ elevation: -0.8, polygon: [], recessed: true })

    expect(resolveSlabPlacementElevation(slab, 1.2)).toBe(-0.8)
  })

  test('keeps authored elevation when no base was resolved', () => {
    const slab = SlabNode.parse({ elevation: 0.12, polygon: [] })

    expect(resolveSlabPlacementElevation(slab, null)).toBe(0.12)
  })
})
