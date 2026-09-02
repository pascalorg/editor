import { describe, expect, test } from 'bun:test'
import { claddingPaintPlan, FLAT_FINISH } from './cladding-paint'

/**
 * Solid-mode cladding paint (pure planner half). The impure applier is a
 * verbatim mirror of the host's commitSlotPaint and is exercised by visual
 * QA; everything decision-shaped lives here.
 */
describe('claddingPaintPlan', () => {
  test('textured families write their library ref into slots.exterior', () => {
    const plan = claddingPaintPlan('stucco', undefined, {})
    expect(plan?.slots.exterior).toBe('library:concrete-stucco')
    expect(plan?.mint).toBeUndefined()
    expect(claddingPaintPlan('brickVeneer', undefined, {})?.slots.exterior).toBe(
      'library:flooring-rusticbrick',
    )
    expect(claddingPaintPlan('eifs', undefined, {})?.slots.exterior).toBe(
      'library:concrete-plaster',
    )
  })

  test('flat families mint a scene material carrying the X-ray palette color', () => {
    const plan = claddingPaintPlan('vinyl', undefined, {})
    expect(plan?.mint).toBeDefined()
    expect(plan?.slots.exterior).toBe(`scene:${plan?.mint?.id}`)
    const props = (plan?.mint?.material as { properties: { color: string } }).properties
    expect(props.color).toBe(FLAT_FINISH.vinyl?.color as string)
  })

  test('a byte-identical existing scene material is reused, not re-minted', () => {
    const first = claddingPaintPlan('vinyl', undefined, {})
    const materials = {
      [first?.mint?.id as string]: first?.mint as NonNullable<typeof first>['mint'] & object,
    }
    const second = claddingPaintPlan('vinyl', undefined, materials)
    expect(second?.mint).toBeUndefined()
    expect(second?.slots.exterior).toBe(first?.slots.exterior)
  })

  test('interior slots survive; stale exterior band slots are cleared', () => {
    const slots = {
      interior: 'library:concrete-drywall',
      exterior: 'library:concrete-stucco',
      lowerExterior: 'scene:mat_band1',
      topExterior: 'scene:mat_band2',
      lowerInterior: 'scene:mat_keep',
    }
    const plan = claddingPaintPlan('brickVeneer', slots, {})
    expect(plan?.slots.interior).toBe('library:concrete-drywall')
    expect(plan?.slots.lowerInterior).toBe('scene:mat_keep')
    expect(plan?.slots.lowerExterior).toBeUndefined()
    expect(plan?.slots.topExterior).toBeUndefined()
    expect(plan?.slots.exterior).toBe('library:flooring-rusticbrick')
  })

  test('every WallCladding family produces a plan (no silent no-op picks)', () => {
    for (const fam of ['vinyl', 'fiberCement', 'stucco', 'brickVeneer', 'wood', 'eifs'] as const) {
      expect(claddingPaintPlan(fam, undefined, {}), fam).not.toBeNull()
    }
  })
})

describe('multi-wall pick mints ONE material (staged find-or-mint)', () => {
  test('planning twin walls in one pick reuses the first mint for the second', () => {
    // paintWallExterior plans every paintId against a STAGED materials map
    // so wall B reuses the material minted for wall A in the same commit —
    // mirror that staging here.
    const staged: Record<string, { id: string; name: string; material: unknown }> = {}
    const a = claddingPaintPlan('vinyl', undefined, staged)
    if (a?.mint) staged[a.mint.id] = a.mint
    const b = claddingPaintPlan('vinyl', undefined, staged)
    expect(a?.mint).toBeDefined()
    expect(b?.mint).toBeUndefined()
    expect(b?.slots.exterior).toBe(a?.slots.exterior)
  })
})
