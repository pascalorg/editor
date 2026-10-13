import { describe, expect, test } from 'bun:test'
import { getCatalogMaterialById } from '../material-library'
import { AGENT_OPERATIONS } from './index'

type Group = {
  query: string
  results: { ref: string; label: string; kind: string; surfaces: string[]; color?: string }[]
  missing?: string[]
}

function search(...queries: { query: string; surface?: 'roof' | 'wall' | 'floor' | 'ceiling' }[]) {
  const { result } = AGENT_OPERATIONS.search_materials({}, { queries } as never, {
    activeLevelId: null,
  })
  return (result as { groups: Group[] }).groups
}

const refs = (group: Group) => group.results.map((result) => result.ref)

describe('search_materials', () => {
  test('reads building words as the library writes them', () => {
    const [render, weatherboard, timber] = search(
      { query: 'white render' },
      { query: 'weatherboard' },
      { query: 'timber floor' },
    )
    expect(refs(render!)).toContain('library:concrete-stucco')
    expect(render!.missing).toBeUndefined()
    expect(refs(weatherboard!).some((ref) => ref.startsWith('library:siding-lap'))).toBe(true)
    expect(refs(timber!)).toContain('library:wood-finewood27')
  })

  test('keeps to the surface asked, every result a library ref', () => {
    const [roofing] = search({ query: 'tiles', surface: 'roof' })
    expect(refs(roofing!)).toContain('library:roof-claytiles')
    for (const { ref, surfaces } of roofing!.results) {
      expect(surfaces).toContain('roof')
      expect(getCatalogMaterialById(ref.slice('library:'.length))).toBeDefined()
    }
  })

  test('says which words no material answers, rather than guess', () => {
    const [group] = search({ query: 'corrugated polycarbonate' })
    expect(group!.missing).toEqual(['corrugated', 'polycarbonate'])
    expect(group!.results).toEqual([])
  })

  test('matches whole words: a short or common word answers nothing by being inside another', () => {
    const [walls, brick] = search({ query: 'white render for the walls' }, { query: 'a red brick' })
    // "for" is in forest, "red" in prepared, "a" in nearly every material.
    expect(refs(walls!)[0]).toBe('library:concrete-stucco')
    expect(refs(walls!)).not.toContain('library:siding-lap-forest')
    expect(refs(brick!)).not.toContain('library:concrete-drywall')
    expect(refs(brick!).every((ref) => /brick|red|tomato/.test(ref))).toBe(true)
  })

  test('a flat colour suits every surface asked', () => {
    const [ceiling] = search({ query: 'white', surface: 'ceiling' })
    expect(refs(ceiling!)).toContain('library:preset-white')
  })

  test('ranks a material answering every word above one answering some', () => {
    // The white sidings answer "white" only.
    const [group] = search({ query: 'white stucco' })
    expect(refs(group!)[0]).toBe('library:concrete-stucco')
    expect(refs(group!)).toContain('library:siding-lap-white')
  })
})
