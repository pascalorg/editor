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
    name: 'a fixture the library lacks points to add_object, not to a design of its own',
    tool: 'search_assets',
    scene: noScene,
    input: { queries: [{ query: 'wall light' }] },
    context: library,
    expect: {
      result: {
        total: 0,
        groups: [{ query: 'wall light', total: 0, results: [] }],
        hint: 'Nothing in the library matches "wall light". Build what it lacks with add_object.',
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
        hint: 'Nothing in the library matches "gazebo", "sconce". Build what it lacks with add_object.',
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
