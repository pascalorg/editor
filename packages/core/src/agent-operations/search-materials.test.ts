import { describe, expect, test } from 'bun:test'
import {
  getCatalogMaterialById,
  MATERIAL_CATALOG,
  registerLibraryMaterials,
  unregisterLibraryMaterials,
} from '../material-library'
import { AGENT_OPERATIONS } from './index'

type Group = {
  query?: string
  kind?: string
  results: { ref: string; label: string; kind: string; surfaces: string[]; color?: string }[]
  missing?: string[]
  more?: number
  next?: number
}

function search(
  ...queries: {
    query?: string
    kind?: string
    surface?: 'roof' | 'wall' | 'floor' | 'ceiling'
    offset?: number
  }[]
) {
  const { result } = AGENT_OPERATIONS.search_materials({}, { queries } as never, {
    activeLevelId: null,
  })
  return (result as { groups: Group[] }).groups
}

const refs = (group: Group) => group.results.map((result) => result.ref)

describe('search_materials', () => {
  test('a missing finish states nearest and exact colour options', () => {
    const { result } = AGENT_OPERATIONS.search_materials(
      {},
      { queries: [{ query: 'oak floor' }] } as never,
      {
        activeLevelId: null,
      },
    )
    expect((result as { message: string }).message).toContain(
      'paint with color gives the nearest library colour and says how far it moved (ΔE)',
    )
    expect((result as { message: string }).message).toContain('keeps the exact colour')
  })

  test('the facts about a missing finish come only with a missing word', () => {
    const { result } = AGENT_OPERATIONS.search_materials(
      {},
      { queries: [{ query: 'white render' }] } as never,
      {
        activeLevelId: null,
      },
    )
    expect((result as { message: string }).message).not.toContain('generate_material')
    expect((result as { message: string }).message).not.toContain('ΔE')
  })

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

  test('without words, browses a kind by name: every one of it, none other', () => {
    const [metal] = search({ kind: 'metal' })
    const expected = MATERIAL_CATALOG.filter((material) => material.category === 'metal')
    expect(metal!.results.map((result) => result.ref).sort()).toEqual(
      expected.map((material) => `library:${material.id}`).sort(),
    )
    const labels = metal!.results.map((result) => result.label)
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)))
    expect(metal!.missing).toBeUndefined()
  })

  test("reads the materials the host registered beside Pascal's, never in their place", () => {
    const community = {
      id: 'mtl_terrazzo_green',
      label: 'Green terrazzo',
      category: 'stone' as const,
      source: 'community' as const,
      preset: MATERIAL_CATALOG[0]!.preset,
    }
    const shadow = { ...MATERIAL_CATALOG[0]!, label: "Not Pascal's" }
    registerLibraryMaterials([community, shadow])
    try {
      const [terrazzo, stone] = search({ query: 'terrazzo green' }, { kind: 'stone' })
      expect(refs(terrazzo!)[0]).toBe('library:mtl_terrazzo_green')
      expect(refs(stone!)).toContain('library:mtl_terrazzo_green')
      const [all] = search({})
      expect(all!.results.filter((result) => result.ref === `library:${shadow.id}`)).toEqual([
        expect.objectContaining({ label: MATERIAL_CATALOG[0]!.label }),
      ])
    } finally {
      unregisterLibraryMaterials([community.id, shadow.id])
    }
  })

  test('pages a long browse: more and next list the rest, each material once', () => {
    const extra = Array.from({ length: 160 }, (_, index) => ({
      id: `mtl_page_${String(index).padStart(3, '0')}`,
      label: `Paged finish ${String(index).padStart(3, '0')}`,
      category: 'other' as const,
      preset: MATERIAL_CATALOG[0]!.preset,
    }))
    registerLibraryMaterials(extra)
    try {
      const [first] = search({ kind: 'other' })
      expect(first!.results).toHaveLength(150)
      expect(first).toMatchObject({ more: 10, next: 150 })
      const [rest] = search({ kind: 'other', offset: first!.next })
      expect(rest!.more).toBeUndefined()
      expect([...refs(first!), ...refs(rest!)]).toEqual(
        extra.map((material) => `library:${material.id}`),
      )
    } finally {
      unregisterLibraryMaterials(extra.map((material) => material.id))
    }
  })
})
