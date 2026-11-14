import { describe, expect, test } from 'bun:test'
import { SEARCH_ASSETS_LIMIT } from '../agent-tools/assets'
import { scriptSource } from '../lib/geometry-script-node'
import { type AssetInput, GeometryArtifactManifest, ItemNode } from '../schema'
import {
  type AssetCatalogSource,
  type AssetSearchQuery,
  type AssetSearchResult,
  catalogReads,
  rankAssets,
  readCatalog,
} from './asset-catalog'
import type { CatalogAsset } from './catalog-asset'
import { searchAssets } from './search-assets'
import type { SceneNodes } from './types'

const asset = (id: string, category = 'furniture'): AssetInput => ({
  id,
  name: id,
  category,
  thumbnail: `https://lib.test/${id}.webp`,
  src: `https://lib.test/${id}.glb`,
})

/** A library item built from a script: one param, its width. */
const scripted = (id: string, name = id): CatalogAsset => ({
  ...asset(id),
  name,
  script: scriptSource({
    sha256: 'a'.repeat(64),
    script: 'b'.repeat(64),
    language: 'three',
    mount: 'floor',
    params: { width: 2.2 },
    manifest: GeometryArtifactManifest.parse({
      bounds: { min: [-1.1, 0, -0.45], max: [1.1, 0.8, 0.45] },
      triangles: 12,
      params: [{ id: 'width', kind: 'number', default: 2, min: 1.6, max: 3, unit: 'm' }],
      slots: [{ id: 'fabric' }],
    }),
  }),
})

const nodes = {
  item_a: ItemNode.parse({ id: 'item_a', asset: asset('sofa') }),
  wall_a: { id: 'wall_a', type: 'wall' },
} as unknown as SceneNodes

/** A library kept elsewhere: what the host was asked, and answers it ranks its own way. */
function remote(answer: (query: AssetSearchQuery) => AssetSearchResult) {
  const asked = { searches: [] as AssetSearchQuery[], ids: [] as string[][] }
  const source: AssetCatalogSource = {
    search: async (query) => {
      asked.searches.push(query)
      return answer(query)
    },
    byId: async (ids) => {
      asked.ids.push([...ids])
      return ids.map((id) => asset(id))
    },
  }
  return { asked, source }
}

describe('what a call reads of the library', () => {
  test("search_assets runs one search per query, at the call's limit", () => {
    expect(
      catalogReads(nodes, 'search_assets', {
        queries: [{ query: 'sofa' }, { query: 'lamp', category: 'lighting' }],
      }),
    ).toEqual({
      ids: [],
      placing: [],
      searches: [
        { text: 'sofa', limit: SEARCH_ASSETS_LIMIT },
        { text: 'lamp', category: 'lighting', limit: SEARCH_ASSETS_LIMIT },
      ],
    })
    expect(
      catalogReads(nodes, 'search_assets', { queries: [{ query: 'sofa' }], limit: 5 }).searches,
    ).toEqual([{ text: 'sofa', limit: 5 }])
  })

  test('the placing and viewing tools name their items; furnish_room its room type’s set', () => {
    expect(
      catalogReads(nodes, 'place_items', {
        items: [{ assetId: 'palm' }, { assetId: 'lamp' }, { assetId: 'palm' }],
      }).ids,
    ).toEqual(['palm', 'lamp'])
    expect(catalogReads(nodes, 'place_in_room', { assetId: 'sofa' }).ids).toEqual(['sofa'])
    expect(catalogReads(nodes, 'view_assets', { ids: ['sofa', 'bed'] }).ids).toEqual([
      'sofa',
      'bed',
    ])
    expect(catalogReads(nodes, 'furnish_room', { roomType: 'laundry' }).ids).toEqual([
      'washing-machine',
      'drying-rack',
    ])
  })

  test('a paint with no role reads the catalog entry of the item it finishes; with one, nothing', () => {
    expect(catalogReads(nodes, 'paint', { targets: ['item_a', 'wall_a'] }).ids).toEqual(['sofa'])
    expect(catalogReads(nodes, 'paint', { targets: ['item_a'], role: 'body' }).ids).toEqual([])
  })

  test('a batch reads for each of its calls; a call that names no item reads nothing', () => {
    expect(
      catalogReads(nodes, 'run_batch', {
        calls: [
          { tool: 'place_in_room', input: { assetId: 'toilet' } },
          { tool: 'paint', input: { targets: ['item_a'] } },
          { tool: 'delete_node', input: { id: 'wall_a' } },
        ],
      }),
    ).toEqual({ ids: ['toilet', 'sofa'], placing: ['toilet'], searches: [] })
    expect(catalogReads(nodes, 'delete_node', { id: 'item_a' })).toEqual({
      ids: [],
      placing: [],
      searches: [],
    })
  })
})

describe('ranking hits found elsewhere', () => {
  test('the name exactly first, then words of the name; equals keep the host’s order', () => {
    const named = (id: string, name: string) => ({ ...asset(id), name })
    const hits = [
      named('dirty', 'Dirty toilet'),
      named('paper', 'Toilet Paper'),
      named('bidet', 'Bidet'),
      named('plain', 'Toilet'),
    ]
    expect(rankAssets(hits, 'toilet').map((item) => item.id)).toEqual([
      'plain',
      'dirty',
      'paper',
      'bidet',
    ])
  })

  test('items built from a script lead the plain models the query names, not the others', () => {
    const named = (id: string, name: string) => ({ ...asset(id), name })
    const hits = [
      named('plain', 'Sofa'),
      scripted('loveseat', 'Loveseat'),
      named('corner', 'Corner Sofa'),
      scripted('modular', 'Modular Sofa'),
    ]
    expect(rankAssets(hits, 'sofa').map((item) => item.id)).toEqual([
      'modular',
      'plain',
      'corner',
      'loveseat',
    ])

    const baths = [
      named('bathtub', 'Bathtub'),
      { ...scripted('alcove', 'Alcove bath'), category: 'bathtubs' },
    ]
    expect(rankAssets(baths, 'bathtub').map((item) => item.id)).toEqual(['alcove', 'bathtub'])
  })
})

describe('reading the library before a call', () => {
  test('a list is handed over whole', async () => {
    const list = [asset('sofa')]
    expect((await readCatalog(nodes, 'delete_node', { id: 'item_a' }, list)).catalog).toBe(list)
  })

  test('a source gives the items the call names, and reads nothing for a call that names none', async () => {
    const { asked, source } = remote(() => ({ items: [], total: 0 }))
    expect(await readCatalog(nodes, 'delete_node', { id: 'item_a' }, source)).toEqual({
      catalog: [],
    })
    expect(asked).toEqual({ searches: [], ids: [] })
    const read = await readCatalog(nodes, 'place_in_room', { assetId: 'palm' }, source)
    expect(read.catalog?.map((item) => item.id)).toEqual(['palm'])
    expect(read.catalogSearches).toBeUndefined()
    expect(asked.ids).toEqual([['palm']])
  })

  test('the scripted items a call places are brought into the project first; viewed ones are not', async () => {
    const brought: string[][] = []
    const source: AssetCatalogSource = {
      search: async () => ({ items: [], total: 0 }),
      byId: async (ids) => ids.map((id) => (id.startsWith('scripted') ? scripted(id) : asset(id))),
      bring: async (items) => {
        brought.push(items.map((item) => item.id))
      },
    }
    await readCatalog(
      nodes,
      'place_items',
      { items: [{ assetId: 'scripted-sofa' }, { assetId: 'lamp' }] },
      source,
    )
    await readCatalog(nodes, 'view_assets', { ids: ['scripted-chair'] }, source)
    expect(brought).toEqual([['scripted-sofa']])
  })
})

describe('search_assets on a library kept elsewhere', () => {
  const input = { queries: [{ query: 'chair' }], limit: 2 }

  async function search(answer: Parameters<typeof remote>[0]) {
    const { source } = remote(answer)
    const read = await readCatalog(nodes, 'search_assets', input, source)
    return searchAssets(nodes, input, { activeLevelId: null, ...read }).result as {
      groups: { results: { id: string }[]; total: number; truncated: boolean }[]
      hint?: string
    }
  }

  test('lists the params of an item built from a script', async () => {
    const result = await search(() => ({ items: [scripted('sofa'), asset('chair')], total: 2 }))
    const [sofa, chair] = result.groups[0]!.results as { params?: unknown }[]
    expect(sofa!.params).toEqual([
      { id: 'width', kind: 'number', default: 2, min: 1.6, max: 3, unit: 'm', value: 2.2 },
    ])
    expect(chair!.params).toBeUndefined()
  })

  test("lists the host's hits in the host's order, with its total", async () => {
    const result = await search(() => ({
      items: [asset('wingback-armchair'), asset('chair')],
      total: 2,
    }))
    expect(result.groups[0]!.results.map((item) => item.id)).toEqual(['wingback-armchair', 'chair'])
    expect(result.groups[0]).toMatchObject({ total: 2, truncated: false })
    expect(result.hint).toBeUndefined()
  })

  test('a cut search narrows by the categories the host counted, else by words', async () => {
    const counted = await search(() => ({
      items: [asset('chair'), asset('stool', 'stools')],
      total: 900,
      categories: [
        { name: 'chairs', count: 700 },
        { name: 'stools', count: 200 },
      ],
    }))
    expect(counted.groups[0]).toMatchObject({ total: 900, truncated: true })
    expect(counted.hint).toBe(
      '"chair" matches 900 items and lists the best 2: add words or a category to narrow it (chairs 700, stools 200).',
    )
    const uncounted = await search(() => ({ items: [asset('chair'), asset('stool')], total: 900 }))
    expect(uncounted.hint).toBe(
      '"chair" matches 900 items and lists the best 2: add words to narrow it.',
    )
  })
})
