import { describe, expect, test } from 'bun:test'
import { GutterNode } from '@pascal-app/core'
import { buildGutterGeometry } from './geometry'
import { resolveGutterOutletById } from './outlet-lookup'

// A managed lean-to gutter following a curved eave carries a concentric arc in
// gutter-mesh-local coordinates. The bend rotates each vertex about the stored
// center O = (centerX, centerZ), so its distance from O is preserved — the
// trough hugs the eave circle instead of ballooning off the chord.
describe('curved gutter arc', () => {
  const radius = 5
  const centerX = 0
  // Center sits one radius inward along -Z so the trough floor (Z ≈ 0) lands on
  // the eave circle of radius `radius`.
  const centerZ = -radius

  function curvedGutter(overrides: Record<string, unknown> = {}) {
    return GutterNode.parse({
      id: 'gutter_curved',
      type: 'gutter',
      length: 3,
      size: 0.13,
      profile: 'k-style',
      arc: { centerX, centerZ, radius },
      ...overrides,
    })
  }

  test('bends the trough into a thin concentric band on the eave circle', () => {
    const geometry = buildGutterGeometry(curvedGutter())
    const position = geometry.getAttribute('position')
    expect(position.count).toBeGreaterThan(0)

    let minR = Number.POSITIVE_INFINITY
    let maxR = Number.NEGATIVE_INFINITY
    for (let i = 0; i < position.count; i++) {
      const d = Math.hypot(position.getX(i) - centerX, position.getZ(i) - centerZ)
      minR = Math.min(minR, d)
      maxR = Math.max(maxR, d)
    }
    // The profile only spans ~`size` across its cross-section, so the whole run
    // stays within a thin annulus around the eave radius — never near center 0.
    expect(minR).toBeGreaterThan(radius - 0.3)
    expect(maxR).toBeLessThan(radius + 0.3)

    geometry.dispose()
  })

  test('places an outlet on the eave circle', () => {
    const gutter = curvedGutter({
      outlets: [{ id: 'outlet_a', offset: 0.5, diameter: 0.07 }],
    })
    const placement = resolveGutterOutletById(gutter, 'outlet_a')
    expect(placement).not.toBeNull()
    const d = Math.hypot(placement!.x - centerX, placement!.z - centerZ)
    // The drop tube mounts on the bent trough floor — on the eave circle, offset
    // only by the profile's floor midpoint (well under one profile `size`).
    expect(d).toBeGreaterThan(radius - 0.01)
    expect(d).toBeLessThan(radius + gutter.size)
  })

  test('leaves a straight gutter (no arc) unbent', () => {
    const gutter = GutterNode.parse({ id: 'gutter_straight', type: 'gutter', length: 3 })
    const geometry = buildGutterGeometry(gutter)
    const position = geometry.getAttribute('position')
    // Without an arc the length axis stays straight: X spans the full run.
    let maxX = Number.NEGATIVE_INFINITY
    for (let i = 0; i < position.count; i++) maxX = Math.max(maxX, Math.abs(position.getX(i)))
    expect(maxX).toBeGreaterThan(1)
    geometry.dispose()
  })
})
