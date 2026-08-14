import { describe, expect, test } from 'bun:test'
import { applyConstructionPatch } from './construction-patch'

/**
 * The construction write contract — what an agent may state about how an element is cast.
 *
 * Nothing here is arithmetic. What is asserted is the three ways this write goes wrong
 * quietly: a slab-only field written to a wall and reported "ok", a `null` stored as a
 * value rather than clearing the field, and a `formworkType` set with no attach behind it
 * — which leaves a project believing it specified a steel-panel wall while holding no
 * shutter, no bill and nothing on screen.
 */

describe('the construction write contract', () => {
  test('a call that states nothing is refused, and names what it could have stated', () => {
    const result = applyConstructionPatch('wall', undefined, {}, 'wall_1')

    expect(result.error).toContain('nothing to set')
    expect(result.error).toContain('formworkType')
    expect(result.writes).toBeUndefined()
  })

  test('a stated field is written and read back in the words the reply uses', () => {
    const result = applyConstructionPatch(
      'wall',
      undefined,
      { formworkType: 'steel-panel' },
      'wall_1',
    )

    expect(result.writes).toEqual({ formworkType: 'steel-panel' })
    expect(result.changed).toEqual(['formworkType steel-panel'])
  })

  test('null takes a field off rather than storing it', () => {
    // The third state. An absent key means "leave this alone", so `null` has to spell
    // "unstate it" — otherwise a model can state a spacing and never go back to the
    // solved one.
    const result = applyConstructionPatch('wall', 'steel-panel', { tieSpacing: null }, 'wall_1')

    expect(result.writes).toEqual({ tieSpacing: undefined })
    expect(Object.keys(result.writes ?? {})).toEqual(['tieSpacing'])
    expect(result.changed).toEqual(['tieSpacing unstated'])
  })

  test('an unmentioned field is absent from the writes, so one decision does not clear another', () => {
    const result = applyConstructionPatch('wall', 'steel-panel', { castOrder: 2 }, 'wall_1')

    expect(result.writes).toEqual({ castOrder: 2 })
  })

  test('the specified tie grid is written through and read back in words a reply uses', () => {
    const result = applyConstructionPatch(
      'wall',
      'steel-panel',
      { specifiedTieGridMm: { columnsMm: 600, rowsMm: 900 } },
      'wall_1',
    )

    expect(result.error).toBeUndefined()
    expect(result.writes).toEqual({ specifiedTieGridMm: { columnsMm: 600, rowsMm: 900 } })
    // Read back as a module, not as "[object Object]".
    expect(result.changed).toEqual(['specifiedTieGridMm 600 × 900 mm'])
  })

  test('null takes the specified tie grid off', () => {
    const result = applyConstructionPatch(
      'wall',
      'steel-panel',
      { specifiedTieGridMm: null },
      'wall_1',
    )

    expect(result.writes).toEqual({ specifiedTieGridMm: undefined })
    expect(result.changed).toEqual(['specifiedTieGridMm unstated'])
  })

  test.each([
    'wall',
    'column',
  ] as const)('a slab-only field on a %s is refused rather than dropped', (kind) => {
    // Dropped it would be a decision the user believes was recorded. The field is
    // declared on SlabNode alone, so writing it here lands somewhere nothing reads.
    const result = applyConstructionPatch(kind, 'steel-panel', { edgeFaceCount: 2 }, 'x_1')

    expect(result.error).toContain('slabs only')
    expect(result.error).toContain(kind)
    expect(result.writes).toBeUndefined()
  })

  test('both slab-only fields are named together rather than one call at a time', () => {
    const result = applyConstructionPatch(
      'wall',
      'steel-panel',
      { edgeFaceCount: 2, soffitHeightAboveSupport: 3 },
      'wall_1',
    )

    // edgeFaceCount is caught as slab-only first — the two refusals are separate
    // because soffitHeightAboveSupport is a beam field too.
    expect(result.error).toContain('edgeFaceCount')
    expect(result.error).toContain('slabs only')
  })

  test('the soffit height is refused on a wall and accepted on a beam', () => {
    // A prop length on an element with nothing propped is a decision recorded
    // nowhere; a beam's props stand on the floor below, so it is the beam's
    // own field exactly as it is a slab's.
    const wall = applyConstructionPatch(
      'wall',
      'steel-panel',
      { soffitHeightAboveSupport: 3 },
      'wall_1',
    )
    expect(wall.error).toContain('slabs and beams only')
    expect(wall.error).toContain('wall_1 is a wall')

    const beam = applyConstructionPatch(
      'beam',
      'plywood',
      { soffitHeightAboveSupport: 3 },
      'beam_1',
    )
    expect(beam.error).toBeUndefined()
    expect(beam.writes).toEqual({ soffitHeightAboveSupport: 3 })
  })

  test('the same fields on a slab are written', () => {
    const result = applyConstructionPatch(
      'slab',
      'plywood',
      { edgeFaceCount: 2, soffitHeightAboveSupport: 3.2 },
      'slab_1',
    )

    expect(result.error).toBeUndefined()
    expect(result.writes).toEqual({ edgeFaceCount: 2, soffitHeightAboveSupport: 3.2 })
  })

  test('naming a system on an unformed element flags that nothing is built yet', () => {
    // The failure this flag exists for: a correct formworkType, reported ok, never
    // followed by an attach. The project then believes it specified a steel-panel wall
    // and holds no shutter, no bill and nothing on screen.
    const result = applyConstructionPatch(
      'wall',
      undefined,
      { formworkType: 'steel-panel' },
      'wall_1',
    )

    expect(result.formingTurnedOn).toBe(true)
  })

  test.each([
    ['a system that was already named', 'steel-panel' as string | undefined, 'plywood'],
    ['forming turned off', 'steel-panel' as string | undefined, 'none'],
    ['a field that is not the system', undefined as string | undefined, undefined],
  ])('%s does not flag a build as outstanding', (_case, current, next) => {
    const result = applyConstructionPatch(
      'wall',
      current,
      next === undefined ? { castOrder: 1 } : { formworkType: next as 'plywood' | 'none' },
      'wall_1',
    )

    expect(result.formingTurnedOn).toBe(false)
  })

  test("switching from 'none' to a system flags the build, because none forms nothing", () => {
    const result = applyConstructionPatch('wall', 'none', { formworkType: 'plywood' }, 'wall_1')

    expect(result.formingTurnedOn).toBe(true)
  })
})
