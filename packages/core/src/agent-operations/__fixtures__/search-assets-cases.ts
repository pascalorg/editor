import type { AssetInput } from '../../schema'
import type { AgentToolCase, SceneGraph } from './cases'

/**
 * `search_assets`: the host's item library, several queries in one call. The chat searched its
 * library in batches; the MCP searched one query, on id and tags too, with a category filter, and
 * mixed in design presets placed with place_design, a tool the chat lacks. One search now: batched,
 * id and tags matched, category per query, library items only, and a miss points to add_object.
 */

const item = (
  id: string,
  name: string,
  category: string,
  tags: string[],
  dimensions?: [number, number, number],
  attachTo?: AssetInput['attachTo'],
): AssetInput => ({
  id,
  name,
  category,
  tags,
  thumbnail: `/items/${id}/thumbnail.webp`,
  src: `/items/${id}/model.glb`,
  ...(dimensions ? { dimensions } : {}),
  ...(attachTo ? { attachTo } : {}),
})

export const LIBRARY: AssetInput[] = [
  item('sofa', 'Sofa', 'furniture', ['seating', 'living'], [2.5, 0.8, 1.5]),
  item('dining-chair', 'Dining Chair', 'furniture', ['seating', 'dining'], [0.5, 1, 0.5]),
  item('garden-chair', 'Garden Chair', 'outdoor', ['seating', 'garden'], [0.6, 0.9, 0.6]),
  item('palm', 'Palm', 'outdoor', ['tree', 'plant', 'garden'], [1.5, 3, 1.5]),
  item('picture', 'Picture', 'decor', ['art'], undefined, 'wall-side'),
]

const noScene = (): SceneGraph => ({ nodes: {}, rootNodeIds: [] })
const library = { activeLevelId: null, catalog: LIBRARY }

// One "chair" at each rank, listed out of order.
const CHAIRS: AssetInput[] = [
  item('cushion', 'Seat Cushion', 'decor', ['deckchair']),
  item('armchair', 'Armchair', 'furniture', ['seating']),
  item('throne', 'Throne', 'furniture', ['chair', 'royal']),
  item('bar-stool', 'Bar Stool', 'chairs', ['bar']),
  item('garden-chair', 'Garden Chair', 'outdoor', ['seating']),
  item('dining-chair', 'Dining Chair', 'furniture', ['seating']),
  item('chair', 'Chair', 'furniture', []),
  item('chairside', 'Chairside Table', 'furniture', []),
  { ...item('nightstand', 'Nightstand', 'furniture', []), functionTags: ['side-table'] },
]

// 30 chairs over two categories: more than a search lists unless it is narrowed.
const MANY_CHAIRS: AssetInput[] = Array.from({ length: 30 }, (_, index) =>
  item(
    `chair-${index}`,
    `Chair ${String(index).padStart(2, '0')}`,
    index % 3 ? 'furniture' : 'outdoor',
    [],
  ),
)

export const SEARCH_ASSETS_CASES: AgentToolCase[] = [
  {
    name: 'one group per query, in order, on the name, category or tags',
    tool: 'search_assets',
    scene: noScene,
    input: { queries: [{ query: 'sofa' }, { query: 'plant' }] },
    context: library,
    expect: {
      result: {
        total: 2,
        groups: [
          {
            query: 'sofa',
            total: 1,
            truncated: false,
            results: [
              {
                id: 'sofa',
                name: 'Sofa',
                category: 'furniture',
                dimensions: [2.5, 0.8, 1.5],
                attachTo: null,
              },
            ],
          },
          { query: 'plant', total: 1, results: [{ id: 'palm', category: 'outdoor' }] },
        ],
      },
    },
  },
  {
    name: 'a search that finds something says nothing of other sources',
    tool: 'search_assets',
    scene: noScene,
    input: { queries: [{ query: 'sofa' }] },
    context: library,
    expect: {
      result: { total: 1 },
      absent: ['hint'],
      check: (result) => (JSON.stringify(result).includes('add_object') ? ['names add_object'] : []),
    },
  },
  {
    name: 'every word of a query must match',
    tool: 'search_assets',
    scene: noScene,
    input: { queries: [{ query: 'dining chair' }, { query: 'Garden  SEATING' }] },
    context: library,
    expect: {
      result: {
        groups: [
          { total: 1, results: [{ id: 'dining-chair' }] },
          { total: 1, results: [{ id: 'garden-chair' }] },
        ],
      },
    },
  },
  {
    name: 'an id finds its item',
    tool: 'search_assets',
    scene: noScene,
    input: { queries: [{ query: 'dining-chair' }] },
    context: library,
    expect: { result: { groups: [{ total: 1, results: [{ id: 'dining-chair' }] }] } },
  },
  {
    name: 'a category narrows a query',
    tool: 'search_assets',
    scene: noScene,
    input: { queries: [{ query: 'chair', category: 'outdoor' }] },
    context: library,
    expect: { result: { total: 1, groups: [{ total: 1, results: [{ id: 'garden-chair' }] }] } },
  },
  {
    name: 'a wall item says where it mounts, and an item without dimensions reads 1 m a side',
    tool: 'search_assets',
    scene: noScene,
    input: { queries: [{ query: 'art' }] },
    context: library,
    expect: {
      result: {
        groups: [
          { results: [{ id: 'picture', attachTo: 'wall-side', dimensions: [1, 1, 1] }] },
        ],
      },
    },
  },
  {
    name: 'a fixture the library lacks names the other sources there are, as a fact',
    tool: 'search_assets',
    scene: noScene,
    input: { queries: [{ query: 'wall light' }] },
    context: library,
    expect: {
      result: {
        total: 0,
        groups: [{ query: 'wall light', total: 0, results: [] }],
        hint: 'Nothing in the library matches "wall light". add_object builds an object of any shape and size, place_design places a procedural design.',
      },
    },
  },
  {
    name: 'the hint names only the queries that found nothing',
    tool: 'search_assets',
    scene: noScene,
    input: { queries: [{ query: 'sofa' }, { query: 'gazebo' }, { query: 'sconce' }] },
    context: library,
    expect: {
      result: {
        total: 1,
        groups: [{ total: 1 }, { query: 'gazebo', total: 0 }, { query: 'sconce', total: 0 }],
        hint: 'Nothing in the library matches "gazebo", "sconce". add_object builds an object of any shape and size, place_design places a procedural design.',
      },
    },
  },
  {
    name: 'the name exactly first, then a word of the name, a word starting it, the category, a tag, inside the name, anywhere',
    tool: 'search_assets',
    scene: noScene,
    input: { queries: [{ query: 'chair' }, { query: 'side table' }] },
    context: { activeLevelId: null, catalog: CHAIRS },
    expect: {
      result: {
        groups: [
          {
            total: 8,
            truncated: false,
            results: [
              { id: 'chair' },
              { id: 'dining-chair' },
              { id: 'garden-chair' },
              { id: 'chairside' },
              { id: 'bar-stool' },
              { id: 'throne' },
              { id: 'armchair' },
              { id: 'cushion' },
            ],
          },
          { total: 2, results: [{ id: 'nightstand' }, { id: 'chairside' }] },
        ],
      },
    },
  },
  {
    name: 'a broad query lists the best 24, counts every match and says how to narrow it',
    tool: 'search_assets',
    scene: noScene,
    input: { queries: [{ query: 'chair' }, { query: 'chair', category: 'outdoor' }] },
    context: { activeLevelId: null, catalog: MANY_CHAIRS },
    expect: {
      result: {
        total: 40,
        groups: [
          { total: 30, truncated: true },
          { total: 10, truncated: false },
        ],
        hint: '"chair" matches 30 items and lists the best 24: add words or a category to narrow it (furniture 20, outdoor 10).',
      },
      check: (result) => {
        const [broad] = result.groups as { results: { id: string }[] }[]
        return broad!.results.length === 24 && broad!.results[0]!.id === 'chair-0'
          ? []
          : [`lists ${broad!.results.length}, first ${broad!.results[0]?.id}`]
      },
    },
  },
  {
    name: 'a limit lists fewer, and a cut query with a category is narrowed by words',
    tool: 'search_assets',
    scene: noScene,
    input: { queries: [{ query: 'chair', category: 'furniture' }], limit: 5 },
    context: { activeLevelId: null, catalog: MANY_CHAIRS },
    expect: {
      result: {
        groups: [
          {
            total: 20,
            truncated: true,
            results: [
              { id: 'chair-1' },
              { id: 'chair-2' },
              { id: 'chair-4' },
              { id: 'chair-5' },
              { id: 'chair-7' },
            ],
          },
        ],
        hint: '"chair" matches 20 items and lists the best 5: add words to narrow it.',
      },
    },
  },
  {
    // The MCP always has one (its built-in list when the host passes none).
    name: 'a host without a catalog is refused rather than answered with nothing',
    tool: 'search_assets',
    scene: noScene,
    input: { queries: [{ query: 'sofa' }] },
    surfaces: ['core', 'chat'],
    expect: { refusal: 'no_catalog' },
  },
]
