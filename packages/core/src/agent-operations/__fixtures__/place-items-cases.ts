import type { AssetInput } from '../../schema'
import type { AgentToolCase } from './cases'
import { storeysScene } from './structure-cases'

/**
 * `place_items`: the chat's batch of floor items and the MCP's place_item, one tool. The chat's
 * rules win where they differed: an id the library lacks is refused, not placed as a 0.5 m
 * placeholder, and an indoor item outside every room is refused (a model once put a bed on the
 * lawn). It places on a level's floor only; place_item's wall, ceiling and item hosts are left out.
 *
 * The ground floor holds a 6 × 5 m hall; the upper floor has no room.
 */

const item = (id: string, name: string, category: string, tags: string[] = []): AssetInput => ({
  id,
  name,
  category,
  tags,
  thumbnail: `/items/${id}/thumbnail.webp`,
  src: `/items/${id}/model.glb`,
  dimensions: [1, 1, 1],
})

const CATALOG = [
  item('sofa', 'Sofa', 'furniture', ['seating']),
  item('floor-lamp', 'Floor Lamp', 'lighting'),
  item('palm', 'Palm', 'outdoor', ['tree', 'garden']),
]
const library = { activeLevelId: null, catalog: CATALOG }

export const PLACE_ITEMS_CASES: AgentToolCase[] = [
  {
    name: 'items stand on the floor of the level named, turned in degrees',
    tool: 'place_items',
    scene: storeysScene,
    input: {
      levelId: 'level_ground',
      items: [
        { assetId: 'sofa', x: 2, z: 2, rotation: '90°' },
        { assetId: 'floor-lamp', x: 1, z: 1 },
      ],
    },
    context: library,
    expect: {
      result: { ok: true, levelId: 'level_ground' },
      contains: {
        items: [
          { ok: true, assetId: 'sofa', name: 'Sofa', x: 2, z: 2 },
          { ok: true, assetId: 'floor-lamp', name: 'Floor Lamp', x: 1, z: 1 },
        ],
      },
    },
  },
  {
    name: 'an id the library lacks is refused on its own; the others are placed',
    tool: 'place_items',
    scene: storeysScene,
    input: {
      level: 'level_ground',
      items: [
        { assetId: 'sofa', x: 2, z: 2 },
        { assetId: 'unicorn', x: 3, z: 3 },
      ],
    },
    context: library,
    expect: {
      result: { ok: false },
      contains: {
        items: [
          { ok: true, assetId: 'sofa' },
          { ok: false, assetId: 'unicorn', code: 'asset_not_found' },
        ],
      },
      mentions: ['search_assets', '1 of 2'],
    },
  },
  {
    name: 'an indoor item outside every room of a level with rooms is refused',
    tool: 'place_items',
    scene: storeysScene,
    input: { levelId: 'level_ground', items: [{ assetId: 'sofa', x: 10, z: 10 }] },
    context: library,
    expect: {
      result: { ok: false },
      contains: { items: [{ ok: false, assetId: 'sofa', code: 'outside_rooms' }] },
    },
  },
  {
    name: 'a garden item may stand outside the rooms',
    tool: 'place_items',
    scene: storeysScene,
    input: { levelId: 'level_ground', items: [{ assetId: 'palm', x: 10, z: 10 }] },
    context: library,
    expect: { result: { ok: true }, contains: { items: [{ ok: true, assetId: 'palm' }] } },
  },
  {
    name: 'a level without rooms takes items anywhere',
    tool: 'place_items',
    scene: storeysScene,
    input: { levelId: 'level_upper', items: [{ assetId: 'sofa', x: 10, z: 10 }] },
    context: library,
    expect: { result: { ok: true, levelId: 'level_upper' } },
  },
  {
    name: 'without a level, the floor the person is viewing',
    tool: 'place_items',
    scene: storeysScene,
    input: { items: [{ assetId: 'sofa', x: 10, z: 10 }] },
    context: { ...library, activeLevelId: 'level_upper' },
    surfaces: ['core', 'chat'],
    expect: { result: { levelId: 'level_upper' } },
  },
  {
    name: 'an unknown level is refused with the id',
    tool: 'place_items',
    scene: storeysScene,
    input: { levelId: 'level_missing', items: [{ assetId: 'sofa', x: 1, z: 1 }] },
    context: library,
    expect: { refusal: 'level_not_found', mentions: ['level_missing'] },
  },
  {
    name: 'a host without a library is refused rather than guessing',
    tool: 'place_items',
    scene: storeysScene,
    input: { levelId: 'level_ground', items: [{ assetId: 'sofa', x: 1, z: 1 }] },
    surfaces: ['core', 'chat'],
    expect: { refusal: 'no_catalog' },
  },
]
