import { refuse } from '../agent-tools/refusal'
import { OTHER_SOURCES } from '../agent-tools/sources'
import {
  type AssetSearchQuery,
  type AssetSearchResult,
  assetSearchesOf,
  assetSearchKey,
  searchAssetList,
} from './asset-catalog'
import type { AgentOperation } from './types'

type SearchQuery = { query: string; category?: string }
type SearchAssetsInput = { queries: SearchQuery[]; limit?: number }

/** What narrows a query whose matches the limit cut: more words, or one of their categories. */
function narrowing(query: AssetSearchQuery, found: AssetSearchResult, shown: number) {
  const categories = (found.categories ?? [])
    .slice(0, 6)
    .map(({ name, count }) => `${name} ${count}`)
  const how =
    query.category || categories.length < 2
      ? 'add words to narrow it'
      : `add words or a category to narrow it (${categories.join(', ')})`
  return `"${query.text}" matches ${found.total} items and lists the best ${shown}: ${how}.`
}

/**
 * `search_assets`: the host's item library, one group of hits per query, best first and at most
 * `limit` per group; `total` counts them all. A list held whole is searched here; a library kept
 * elsewhere answered each query before the call (`catalogSearches`), ranked by its host. A miss
 * names the other sources there are for the need, as a fact; a cut group says how to narrow it.
 */
export const searchAssets: AgentOperation<SearchAssetsInput> = (_nodes, input, context) => {
  const { catalog, catalogSearches } = context
  if (!(catalog || catalogSearches))
    refuse('no_catalog', 'This host has no item library to search; nothing can be placed from one.')
  const narrow: string[] = []
  const groups = assetSearchesOf(input).map((query) => {
    const found = catalogSearches
      ? catalogSearches[assetSearchKey(query)]
      : searchAssetList(catalog ?? [], query)
    if (!found)
      throw new Error(`The host did not answer the search "${query.text}" before the call.`)
    const shown = found.items.slice(0, query.limit)
    const truncated = found.total > shown.length
    if (truncated) narrow.push(narrowing(query, found, shown.length))
    const results = shown.map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      dimensions: item.dimensions ?? [1, 1, 1],
      attachTo: item.attachTo ?? null,
    }))
    return { query: query.text, total: found.total, truncated, results }
  })
  const missed = groups.filter((group) => group.total === 0).map((group) => `"${group.query}"`)
  const hint = [
    ...(missed.length
      ? [`Nothing in the library matches ${missed.join(', ')}. ${OTHER_SOURCES}`]
      : []),
    ...narrow,
  ].join(' ')
  return {
    result: {
      groups,
      total: groups.reduce((sum, group) => sum + group.total, 0),
      ...(hint && { hint }),
    },
  }
}
