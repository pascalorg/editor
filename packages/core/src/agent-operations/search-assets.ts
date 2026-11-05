import { SEARCH_ASSETS_LIMIT } from '../agent-tools/assets'
import { refuse } from '../agent-tools/refusal'
import { OTHER_SOURCES } from '../agent-tools/sources'
import type { AssetInput } from '../schema'
import type { AgentOperation } from './types'

type SearchQuery = { query: string; category?: string }
type SearchAssetsInput = { queries: SearchQuery[]; limit?: number }

const wordsOf = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)

function matches(item: AssetInput, { query, category }: SearchQuery) {
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
  return query
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

/** What narrows a query whose matches the limit cut: more words, or one of their categories. */
function narrowing({ query, category }: SearchQuery, found: AssetInput[], shown: number) {
  const counts = new Map<string, number>()
  for (const item of found) counts.set(item.category, (counts.get(item.category) ?? 0) + 1)
  const categories = [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en'))
    .slice(0, 6)
    .map(([name, count]) => `${name} ${count}`)
  const how =
    category || categories.length < 2
      ? 'add words to narrow it'
      : `add words or a category to narrow it (${categories.join(', ')})`
  return `"${query}" matches ${found.length} items and lists the best ${shown}: ${how}.`
}

/**
 * `search_assets`: the host's item library, one group of hits per query, best first and at most
 * `limit` per group; `total` counts them all. A miss names the other sources there are for the
 * need, as a fact; a cut group says how to narrow it.
 */
export const searchAssets: AgentOperation<SearchAssetsInput> = (
  _nodes,
  { queries, limit = SEARCH_ASSETS_LIMIT },
  context,
) => {
  const catalog = context.catalog
  if (!catalog)
    refuse('no_catalog', 'This host has no item library to search; nothing can be placed from one.')
  const narrow: string[] = []
  const groups = queries.map((entry) => {
    const found = catalog
      .filter((item) => matches(item, entry))
      .map((item) => ({ item, rank: rank(item, entry.query) }))
      // Stable: items of one name keep the catalog's order.
      .sort(
        (a, b) =>
          a.rank[0] - b.rank[0] ||
          a.rank[1] - b.rank[1] ||
          a.item.name.localeCompare(b.item.name, 'en'),
      )
      .map(({ item }) => item)
    const truncated = found.length > limit
    if (truncated) narrow.push(narrowing(entry, found, limit))
    const results = found.slice(0, limit).map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      dimensions: item.dimensions ?? [1, 1, 1],
      attachTo: item.attachTo ?? null,
    }))
    return { query: entry.query, total: found.length, truncated, results }
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
