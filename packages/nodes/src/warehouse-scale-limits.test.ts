import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { ceilingParametrics } from './ceiling/parametrics'
import { columnParametrics } from './column/parametrics'
import { doorParametrics } from './door/parametrics'
import { downspoutParametrics } from './downspout/parametrics'
import { slabParametrics } from './slab/parametrics'

/**
 * GUARD: nothing a warehouse is made of may carry a house-sized ceiling.
 *
 * Every metre field in the registry feeds `SliderControl`, which clamps typed
 * input as well as drag (`slider-control.tsx`, `clamp`). A `max` here is
 * therefore not a slider range — it is a hard limit on what the panel will let
 * the scene hold, applied silently, with no error and no warning.
 *
 * That is fine for a chimney cap or a gutter hanger, where the house-scale
 * number IS the real number. It is not fine for the members a warehouse is
 * built from, whose real dimensions are two to three times a house's:
 *
 *     clear height   10–12 m   (high-bay past 15)
 *     columns        same as clear height — they carry the roof
 *     truck door     4.5–5 m tall
 *     dock platform  1.2 m above grade
 *     downspout      the full eaves height, so 10–12 m
 *
 * None of these schemas impose an upper bound, so every number the panel
 * refused was a number the scene could already store, save and redraw.
 *
 * This list is deliberately narrow. It is not "remove every max" — the sweep
 * that produced it found ~100 metre fields and most of their ceilings are
 * correct. It names the ones measured against real warehouse geometry.
 */

const DESCRIPTORS = {
  column: columnParametrics,
  ceiling: ceilingParametrics,
  door: doorParametrics,
  slab: slabParametrics,
  downspout: downspoutParametrics,
}

/**
 * Named as `kind.field` strings rather than as tuples carrying the descriptor
 * object: `test.each` formats a tuple member into the title, and an object
 * member leaves a raw `%s` there — a failure that cannot say which field it is
 * about costs more than the indirection saves.
 */
const UNCAPPED = [
  ['column', 'height'],
  ['ceiling', 'height'],
  ['door', 'height'],
  ['slab', 'elevation'],
  ['downspout', 'length'],
] as const

describe('depo ölçeğindeki alanlar tavan taşımıyor', () => {
  test.each(UNCAPPED)('%s.%s parametrik tanımı', (kind, key) => {
    const field = DESCRIPTORS[kind].groups
      .flatMap((group) => group.fields)
      .find((f) => f.key === key)

    expect(field).toBeDefined()
    expect(field && 'max' in field ? field.max : undefined).toBeUndefined()
  })

  /**
   * The panels are a separate surface from the descriptors above and were
   * capped separately — a kind with a `customPanel` never renders the
   * auto-inspector, so fixing only the descriptor would change nothing the
   * user can see.
   */
  test.each([
    ['column/panel.tsx', 'Height'],
    ['door/panel.tsx', 'Height'],
  ])('%s / %s alanı max taşımıyor', (relative, label) => {
    const source = readFileSync(path.join(import.meta.dir, relative), 'utf8')
    const start = source.indexOf(`label="${label}"`)
    expect(start).toBeGreaterThan(-1)

    const end = source.indexOf('/>', start)
    expect(source.slice(start, end)).not.toContain('max=')
  })

  /**
   * The ceiling is the one case where a bound is KEPT, because it is real: a
   * ceiling cannot rise past the level above it. What went was the constant
   * that overrode it — `Math.min(6, maxHeight)` ignored the clamp whenever the
   * storey was taller than a house, which for a warehouse is always.
   */
  test('tavan gerçek kısıtı koruyor, sabiti değil', () => {
    const source = readFileSync(path.join(import.meta.dir, 'ceiling/panel.tsx'), 'utf8')

    expect(source).toContain('max={maxHeight}')
    expect(source).not.toContain('Math.min(6, maxHeight)')
  })
})
