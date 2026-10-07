import { refuse } from '../agent-tools/refusal'
import type { AssetInput } from '../schema'
import type { AgentOperation } from './types'

type SearchAssetsInput = { queries: { query: string; category?: string }[] }

function matches(item: AssetInput, { query, category }: SearchAssetsInput['queries'][number]) {
  if (category && item.category !== category) return false
  const haystack = [item.id, item.name, item.category, ...(item.tags ?? [])].join(' ').toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term))
}

/**
 * `search_assets`: the host's item library, one group of hits per query. A miss points to
 * add_object, the way to build what no library holds, without naming a design for it.
 */
export const searchAssets: AgentOperation<SearchAssetsInput> = (_nodes, { queries }, context) => {
  const catalog = context.catalog
  if (!catalog)
    refuse('no_catalog', 'This host has no item library to search; nothing can be placed from one.')
  const groups = queries.map((entry) => {
    const results = catalog
      .filter((item) => matches(item, entry))
      .map((item) => ({
        id: item.id,
        name: item.name,
        category: item.category,
        dimensions: item.dimensions ?? [1, 1, 1],
        attachTo: item.attachTo ?? null,
      }))
    return { query: entry.query, total: results.length, results }
  })
  const missed = groups.filter((group) => group.total === 0).map((group) => `"${group.query}"`)
  return {
    result: {
      groups,
      total: groups.reduce((sum, group) => sum + group.total, 0),
      ...(missed.length && {
        hint: `Nothing in the library matches ${missed.join(', ')}. Build what it lacks with add_object.`,
      }),
    },
  }
}
