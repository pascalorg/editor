import { describe, expect, test } from 'bun:test'
import { isAgentRefusal } from '../agent-tools/refusal'
import { getCatalogMaterialById } from '../material-library'
import { finishSurface, nearestLibraryMaterials, requireMaterialRef } from './material-refs'

/**
 * A roof's missing corrugated material got Brown brick, Buff brick and Prepared
 * Drywall as its nearest, ranked by name, blind to the roof. What goes wrong, written first: a
 * wall's or a floor's material offered for a roof; a nearest list that hides that the library has
 * nothing of the kind.
 */
describe('the nearest library materials', () => {
  // Roofing as the library tags it, not one material by name: which roofing a library holds is
  // its data.
  test('a roof is offered roofing first, never a wall or a floor material', () => {
    const roof = nearestLibraryMaterials('metal-corrugated', 'roof')
    const surfaces = (ref: string) =>
      getCatalogMaterialById(ref.replace(/^library:/, '').split(' ')[0]!)?.surfaces ?? []
    expect(surfaces(roof[0]!)).toContain('roof')
    for (const ref of roof) expect(ref).not.toMatch(/brick|drywall/i)
  })

  test('when nothing of the kind is like the name, the refusal says so and points to a colour', () => {
    let message = ''
    try {
      requireMaterialRef('library:corrugated', undefined, 'roof')
    } catch (error) {
      if (!isAgentRefusal(error)) throw error
      message = error.message
    }
    expect(message).toContain('no roofing like it')
    expect(message).toContain('library:roof-')
    expect(message).toContain('a flat colour, library:preset-')
    // Nothing shares a word with it: no alphabetical "nearest" (bricks, drywall) pads the answer.
    expect(message).not.toMatch(/brick|drywall/i)
  })

  test("a roof's wall role is a wall; a kind with no tagged surface has none", () => {
    expect(finishSurface('roof', 'top')).toBe('roof')
    expect(finishSurface('roof', 'wall')).toBe('wall')
    expect(finishSurface('roof-segment', 'wallMaterialPreset')).toBe('wall')
    expect(finishSurface('wall', 'slots.a')).toBe('wall')
    expect(finishSurface('zone')).toBeUndefined()
  })

  test('a known id passes, bare or as a ref', () => {
    expect(requireMaterialRef('concrete-raw')).toBe('library:concrete-raw')
    expect(requireMaterialRef('library:concrete-raw', undefined, 'roof')).toBe(
      'library:concrete-raw',
    )
  })
})
