import { SEARCH_ASSETS_LIMIT } from '../agent-tools/assets'
import type { AssetInput } from '../schema'
import { roleLessPaints } from './asset-views'
import { placedAssets } from './design-brief'
import { FURNISH_ROOM_ASSETS } from './furnish-room'
import type { AgentContext, SceneNodes } from './types'

/** One search of an item library: its words (none lists the library), a category, at most `limit` hits. */
export type AssetSearchQuery = { text?: string; category?: string; limit: number }

export type AssetSearchResult = {
  /** The best hits first, at most the query's limit. */
  items: AssetInput[]
  /** Every item the query matches. */
  total: number
  /** The categories of every match, most first, where the host counts them: a cut search names them to narrow by. */
  categories?: { name: string; count: number }[]
}

/**
 * An item library a host searches where it is kept (a database) instead of handing every item
 * over: ranked hits per query, and the items a call names, by id. A library of 100k items is
 * never held whole by a session or a browser tab.
 */
export type AssetCatalogSource = {
  search(query: AssetSearchQuery): Promise<AssetSearchResult>
  byId(ids: readonly string[]): Promise<AssetInput[]>
}

/** What a host's agent tools place from: every item (a built-in list), or a source it searches. */
export type AssetCatalog = readonly AssetInput[] | AssetCatalogSource

export const isAssetCatalogSource = (catalog: AssetCatalog): catalog is AssetCatalogSource =>
  !Array.isArray(catalog)

const wordsOf = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)

function matches(item: AssetInput, text: string, category: string | undefined) {
  if (category && item.category !== category) return false
  const haystack = [
    item.id,
    item.name,
    item.category,
    ...(item.tags ?? []),
    ...(item.functionTags ?? []),
  ]
    .join(' ')
    .toLowerCase()
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term))
}

/**
 * How well an item answers a query, lower first: 0 is its name or id exactly, else the weakest of
 * the query's words, 1 a word of the name ("bed" in "Platform Bed"), 2 starting one ("Bedside
 * Table"), 3 starting a word of the category, 4 of a tag, 5 inside the name, 6 anywhere else. The
 * sum orders items whose weakest word ties.
 */
function rank(item: AssetInput, query: string): [number, number] {
  const whole = query.trim().toLowerCase().replace(/\s+/g, ' ')
  if (
    whole === item.name.trim().toLowerCase().replace(/\s+/g, ' ') ||
    whole === item.id.toLowerCase()
  )
    return [0, 0]
  const name = item.name.toLowerCase()
  const nameWords = wordsOf(item.name)
  const categoryWords = wordsOf(item.category)
  const tagWords = [...(item.tags ?? []), ...(item.functionTags ?? [])].flatMap(wordsOf)
  const startsOne = (words: string[], word: string) => words.some((w) => w.startsWith(word))
  const ranks = wordsOf(query).map((word) =>
    nameWords.includes(word)
      ? 1
      : startsOne(nameWords, word)
        ? 2
        : startsOne(categoryWords, word)
          ? 3
          : startsOne(tagWords, word)
            ? 4
            : name.includes(word)
              ? 5
              : 6,
  )
  return [Math.max(0, ...ranks), ranks.reduce((sum, value) => sum + value, 0)]
}

/**
 * Items in the order search_assets lists them for `text` (`rank`); items that rank alike keep the
 * order they came in. A host that finds hits its own way (a database's fusion) orders them so too.
 */
export function rankAssets(items: readonly AssetInput[], text: string): AssetInput[] {
  return items
    .map((item) => ({ item, rank: rank(item, text) }))
    .sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1])
    .map(({ item }) => item)
}

/**
 * A search of a list held whole: the items whose name, id, category or tags hold every word of
 * the query, best first (`rankAssets`, then by name), with the categories of all of them.
 */
export function searchAssetList(
  items: readonly AssetInput[],
  { text = '', category, limit }: AssetSearchQuery,
): AssetSearchResult {
  const found = rankAssets(
    // Stable: items of one name keep the list's order.
    items
      .filter((item) => matches(item, text, category))
      .sort((a, b) => a.name.localeCompare(b.name, 'en')),
    text,
  )
  const counts = new Map<string, number>()
  for (const item of found) counts.set(item.category, (counts.get(item.category) ?? 0) + 1)
  return {
    items: found.slice(0, limit),
    total: found.length,
    categories: [...counts]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en'))
      .map(([name, count]) => ({ name, count })),
  }
}

/** A list served as a source: searched as `searchAssetList` does, items by id. */
export function assetCatalogSource(items: readonly AssetInput[]): AssetCatalogSource {
  const byId = new Map(items.map((item) => [item.id, item]))
  return {
    search: async (query) => searchAssetList(items, query),
    byId: async (ids) => ids.flatMap((id) => byId.get(id) ?? []),
  }
}

/** The key of a search in `catalogSearches`: its words, category and limit. */
export const assetSearchKey = ({ text = '', category, limit }: AssetSearchQuery): string =>
  JSON.stringify([text, category ?? null, limit])

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}

/** The searches a `search_assets` input runs, one per query, as its operation reads them. */
export function assetSearchesOf(input: unknown): AssetSearchQuery[] {
  const { queries, limit } = asRecord(input)
  return (Array.isArray(queries) ? queries : []).flatMap((entry) => {
    const { query, category } = asRecord(entry)
    if (typeof query !== 'string') return []
    return [
      {
        text: query,
        ...(typeof category === 'string' && { category }),
        limit: typeof limit === 'number' ? limit : SEARCH_ASSETS_LIMIT,
      },
    ]
  })
}

/**
 * What a call reads of the library, alone or in a batch: the searches of `search_assets`, and the
 * ids the others look up — the items placed or viewed, furnish_room's set for its room type, the
 * catalog items a paint with no role finishes (their models list the surfaces).
 */
export function catalogReads(
  nodes: SceneNodes,
  tool: string,
  input: unknown,
): { ids: string[]; searches: AssetSearchQuery[] } {
  const ids = new Set<string>()
  const searches: AssetSearchQuery[] = []
  const visit = (name: unknown, args: Record<string, unknown>) => {
    switch (name) {
      case 'run_batch':
        for (const call of Array.isArray(args.calls) ? args.calls : []) {
          const batched = asRecord(call)
          if (batched.tool !== 'run_batch') visit(batched.tool, asRecord(batched.input))
        }
        return
      case 'search_assets':
        searches.push(...assetSearchesOf(args))
        return
      case 'view_assets':
        for (const id of Array.isArray(args.ids) ? args.ids : [])
          if (typeof id === 'string') ids.add(id)
        return
      case 'furnish_room': {
        const roomType = String(args.roomType) as keyof typeof FURNISH_ROOM_ASSETS
        for (const id of Object.hasOwn(FURNISH_ROOM_ASSETS, roomType)
          ? FURNISH_ROOM_ASSETS[roomType]
          : [])
          ids.add(id)
        return
      }
    }
    if (typeof name !== 'string') return
    for (const id of placedAssets(name, args)) ids.add(id)
    for (const { targets } of roleLessPaints(name, args))
      for (const target of targets) {
        const node = typeof target === 'string' ? nodes[target] : undefined
        if (node?.type === 'item' && node.asset?.id) ids.add(node.asset.id)
      }
  }
  visit(tool, asRecord(input))
  return { ids: [...ids], searches }
}

/**
 * What a call reads of the host's library, read before it as the operations are sync. A list is
 * handed over whole. A source answers the call's searches (`catalogSearches`) and gives the items
 * the call names (`catalog`), so a call that names none reads nothing.
 */
export async function readCatalog(
  nodes: SceneNodes,
  tool: string,
  input: unknown,
  catalog: AssetCatalog,
): Promise<Pick<AgentContext, 'catalog' | 'catalogSearches'>> {
  if (!isAssetCatalogSource(catalog)) return { catalog }
  const { ids, searches } = catalogReads(nodes, tool, input)
  const [items, answers] = await Promise.all([
    ids.length ? catalog.byId(ids) : [],
    Promise.all(searches.map((query) => catalog.search(query))),
  ])
  return {
    catalog: items,
    ...(searches.length && {
      catalogSearches: Object.fromEntries(
        searches.map((query, index) => [assetSearchKey(query), answers[index]!]),
      ),
    }),
  }
}
