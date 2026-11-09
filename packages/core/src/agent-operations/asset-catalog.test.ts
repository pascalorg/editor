import { describe, expect, test } from 'bun:test'
import { SEARCH_ASSETS_LIMIT } from '../agent-tools/assets'
import { type AssetInput, ItemNode } from '../schema'
import {
  type AssetCatalogSource,
  type AssetSearchQuery,
  type AssetSearchResult,
  catalogReads,
  rankAssets,
  readCatalog,
} from './asset-catalog'
import { searchAssets } from './search-assets'
import type { SceneNodes } from './types'

const asset = (id: string, category = 'furniture'): AssetInput => ({
  id,
  name: id,
  category,
  thumbnail: `https://lib.test/${id}.webp`,
  src: `https://lib.test/${id}.glb`,
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
    ).toEqual({ ids: ['toilet', 'sofa'], searches: [] })
    expect(catalogReads(nodes, 'delete_node', { id: 'item_a' })).toEqual({ ids: [], searches: [] })
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
