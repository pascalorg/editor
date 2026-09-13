import { describe, expect, test } from 'bun:test'
import type { Member } from '../core/types'
import DATA from '../../data/wall-assemblies.json'
import { colorOf } from './renderer'

/**
 * Locks the per-family cladding colors against the REAL data-file material
 * strings (user report: vinyl vs stucco looked identical). If a material
 * string is reworded past the label matcher, families collapse back to the
 * fallback gray and this catches it.
 */
describe('cladding families render with distinct colors', () => {
  const member = (label: string): Member => ({
    system: 'wall-framing',
    role: 'cladding',
    label,
    dims: [1, 1, 0.01],
    length: 1,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    material: 'lumber',
    sourceId: 'wall_L',
  })

  const families = Object.entries(DATA.exterior.claddings) as [
    string,
    { layers: { role: string; material: string }[] },
  ][]

  const colorFor = (fam: string, layers: { role: string; material: string }[]): string => {
    // brickVeneer colors by its veneer wythe; EIFS by its lamina — the
    // visible outermost layer of each assembly.
    const outer = layers.find((l) => ['cladding', 'veneer', 'lamina'].includes(l.role))
    expect(outer, `${fam} has no visible outer layer`).toBeDefined()
    return colorOf(member(`${outer?.material} (cite)`))
  }

  test('every family maps off the fallback gray', () => {
    for (const [fam, def] of families) {
      expect(colorFor(fam, def.layers), fam).not.toBe('#aebfc7')
    }
  })

  test('vinyl and stucco differ (the user-reported pair)', () => {
    const byFam = new Map(families.map(([f, d]) => [f, colorFor(f, d.layers)]))
    expect(byFam.get('vinyl')).not.toBe(byFam.get('stucco'))
    // and all families are pairwise distinct
    expect(new Set(byFam.values()).size).toBe(byFam.size)
  })
})
