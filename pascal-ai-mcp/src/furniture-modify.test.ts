import { describe, expect, test } from 'bun:test'
import type { FurnitureRoom } from './furniture-executor'
import { executeFurnitureModifyOps } from './furniture-modify'

// 4×3.5 bedroom, door centered on the south wall (same fixture family as
// furniture-executor.test.ts).
const bedroom: FurnitureRoom = {
  id: 'bedroom-1',
  name: '主卧',
  type: 'bedroom',
  polygon: [[0, 0], [4, 0], [4, 3.5], [0, 3.5]],
  zoneId: 'zone-bed',
}

const walls = [
  {
    id: 'w-south',
    start: [0, 0] as [number, number],
    end: [4, 0] as [number, number],
    openings: [{ type: 'door', position: [2, 1.05, 0] as [number, number, number], width: 0.9 }],
  },
  { id: 'w-east', start: [4, 0] as [number, number], end: [4, 3.5] as [number, number], openings: [] },
  { id: 'w-north', start: [4, 3.5] as [number, number], end: [0, 3.5] as [number, number], openings: [] },
  { id: 'w-west', start: [0, 3.5] as [number, number], end: [0, 0] as [number, number], openings: [] },
]

const CATALOG: Record<string, Array<{ id: string; name: string; dimensions: [number, number, number]; tags?: string[] }>> = {
  书桌: [{ id: 'desk', name: 'Writing Desk', dimensions: [1.2, 0.75, 0.6] }],
  床: [
    { id: 'double-bed', name: 'Double Bed', dimensions: [1.8, 0.5, 2.1] },
    { id: 'single-bed-compact', name: 'Compact Single Bed', dimensions: [1.0, 0.5, 1.9], tags: ['compact'] },
  ],
  衣柜: [{ id: 'wardrobe', name: 'Wardrobe Closet', dimensions: [1.2, 2.2, 0.6] }],
  巨型沙发: [{ id: 'mega-sofa', name: 'Mega Sofa', dimensions: [5.5, 0.9, 1.2] }],
}

// Existing scene: a double bed against the north wall, a wardrobe on the west.
const existingBed = {
  id: 'item-bed',
  name: 'Double Bed',
  position: [2, 0, 2.4] as [number, number, number],
  rotation: [0, Math.PI, 0] as [number, number, number],
  asset: { id: 'double-bed', name: 'Double Bed', dimensions: [1.8, 0.5, 2.1] as [number, number, number] },
}
const existingWardrobe = {
  id: 'item-wardrobe',
  name: 'Wardrobe Closet',
  position: [0.33, 0, 1.0] as [number, number, number],
  rotation: [0, Math.PI / 2, 0] as [number, number, number],
  asset: { id: 'wardrobe', name: 'Wardrobe Closet', dimensions: [1.2, 2.2, 0.6] as [number, number, number] },
}

function makeMockMcp(options: { items?: unknown[]; catalog?: typeof CATALOG } = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  const catalog = options.catalog ?? CATALOG
  let counter = 0
  const deleted: string[] = []
  const callMcp = async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args })
    const wrap = (payload: Record<string, unknown>) => ({ structuredContent: payload })
    switch (name) {
      case 'get_walls':
        return wrap({ walls })
      case 'get_level_summary':
        return wrap({ items: options.items ?? [existingBed, existingWardrobe] })
      case 'search_assets': {
        const results = catalog[args.query as string] ?? []
        return wrap({ results, total: results.length })
      }
      case 'place_item':
        counter++
        return wrap({ itemId: `new-item-${counter}` })
      case 'delete_node':
        deleted.push(args.id as string)
        return wrap({ ok: true })
      default:
        throw new Error(`unexpected tool ${name}`)
    }
  }
  return { callMcp, calls, deleted }
}

describe('executeFurnitureModifyOps', () => {
  test('remove_furniture deletes the matched item by catalog id', async () => {
    const { callMcp, deleted } = makeMockMcp()
    const report = await executeFurnitureModifyOps({
      ops: [{ op: 'remove_furniture', room: '主卧', item: '衣柜' }],
      rooms: [bedroom],
      levelId: 'level-1',
      callMcp,
    })
    expect(report.results[0]!.ok).toBe(true)
    expect(deleted).toEqual(['item-wardrobe'])
  })

  test('add_furniture places via the wall scan and reports the pick', async () => {
    const { callMcp, calls } = makeMockMcp()
    const report = await executeFurnitureModifyOps({
      ops: [{ op: 'add_furniture', room: '主卧', item: '书桌' }],
      rooms: [bedroom],
      levelId: 'level-1',
      callMcp,
    })
    expect(report.results[0]!.ok).toBe(true)
    const place = calls.find(call => call.name === 'place_item')
    expect(place?.args.catalogItemId).toBe('desk')
    expect(place?.args.targetNodeId).toBe('zone-bed')
  })

  test('swap_furniture removes the old item and places the new one', async () => {
    const { callMcp, deleted, calls } = makeMockMcp()
    const report = await executeFurnitureModifyOps({
      ops: [{ op: 'swap_furniture', room: '主卧', from: '床', to: '书桌' }],
      rooms: [bedroom],
      levelId: 'level-1',
      callMcp,
    })
    expect(report.results[0]!.ok).toBe(true)
    expect(deleted).toEqual(['item-bed'])
    expect(calls.some(call => call.name === 'place_item' && call.args.catalogItemId === 'desk')).toBe(true)
  })

  test('swap keeps the old item when the replacement cannot fit anywhere', async () => {
    const { callMcp, deleted } = makeMockMcp()
    const report = await executeFurnitureModifyOps({
      ops: [{ op: 'swap_furniture', room: '主卧', from: '床', to: '巨型沙发' }],
      rooms: [bedroom],
      levelId: 'level-1',
      callMcp,
    })
    expect(report.results[0]!.ok).toBe(false)
    expect(report.results[0]!.detail).toContain('保持不变')
    expect(deleted).toEqual([]) // 先算后删：放不下就不删
  })

  test('missing item / unknown room fail with reasons, not throws', async () => {
    const { callMcp, deleted } = makeMockMcp()
    const report = await executeFurnitureModifyOps({
      ops: [
        { op: 'remove_furniture', room: '主卧', item: '书桌' }, // 房里没有书桌
        { op: 'add_furniture', room: '地下室', item: '书桌' }, // 没这个房间
      ],
      rooms: [bedroom],
      levelId: 'level-1',
      callMcp,
    })
    expect(report.results.map(r => r.ok)).toEqual([false, false])
    expect(report.results[0]!.detail).toContain('没有找到')
    expect(report.results[1]!.detail).toContain('找不到房间')
    expect(deleted).toEqual([])
  })

  test('multiple matches delete the last placed one and say so', async () => {
    const secondBed = { ...existingBed, id: 'item-bed-2', position: [0.33, 0, 2.4] as [number, number, number] }
    // Two beds in the room — place them apart so both resolve to the bedroom.
    const { callMcp, deleted } = makeMockMcp({ items: [existingBed, secondBed] })
    const report = await executeFurnitureModifyOps({
      ops: [{ op: 'remove_furniture', room: '主卧', item: '床' }],
      rooms: [bedroom],
      levelId: 'level-1',
      callMcp,
    })
    expect(report.results[0]!.ok).toBe(true)
    expect(deleted).toEqual(['item-bed-2'])
    expect(report.results[0]!.detail).toContain('最后放置')
  })

  test('freed space is reusable within the same run (remove then add)', async () => {
    const { callMcp } = makeMockMcp()
    const report = await executeFurnitureModifyOps({
      ops: [
        { op: 'remove_furniture', room: '主卧', item: '床' },
        { op: 'add_furniture', room: '主卧', item: '床' }, // double bed fits again only if the old footprint is gone
      ],
      rooms: [bedroom],
      levelId: 'level-1',
      callMcp,
    })
    expect(report.results.map(r => r.ok)).toEqual([true, true])
  })

  // The real MCP catalog is English-only (id/name/tags), while the op
  // translator is told to emit terms in the user's language — the checklist
  // vocabulary must bridge the two. This mock mirrors that reality: Chinese
  // queries return nothing.
  const ENGLISH_CATALOG: typeof CATALOG = {
    bed: [
      { id: 'double-bed', name: 'Double Bed', dimensions: [1.8, 0.5, 2.1] },
      { id: 'single-bed-compact', name: 'Compact Single Bed', dimensions: [1.0, 0.5, 1.9], tags: ['compact'] },
    ],
    desk: [{ id: 'desk', name: 'Writing Desk', dimensions: [1.2, 0.75, 0.6] }],
  }

  test('CJK term resolves through checklist vocabulary against an English-only catalog (eval case-18 regression)', async () => {
    const { callMcp, deleted, calls } = makeMockMcp({ catalog: ENGLISH_CATALOG })
    const report = await executeFurnitureModifyOps({
      ops: [{ op: 'swap_furniture', room: '主卧', from: '床', to: '单人床' }],
      rooms: [bedroom],
      levelId: 'level-1',
      callMcp,
    })
    expect(report.results[0]!.ok).toBe(true)
    expect(deleted).toEqual(['item-bed'])
    // 「床」/「单人床」 themselves hit the catalog empty; the vocabulary
    // fallback re-queries with the English search term.
    expect(calls.filter(call => call.name === 'search_assets').map(call => call.args.query)).toContain('bed')
  })

  test('a broad "bed" search must not touch bedroom-tagged non-beds (case-18 衣柜误删 regression)', async () => {
    // The real catalog matches search terms against tags too: querying "bed"
    // returns the closet (tagged "bedroom") and the bedside table. Without
    // the vocabulary-matcher filter, swap deleted the closet (last placed
    // asset-id match) and placed the bedside table as the "单人床" (smallest
    // footprint wins).
    const TAG_MATCHED_CATALOG: typeof CATALOG = {
      bed: [
        { id: 'double-bed', name: 'Double Bed', dimensions: [1.8, 0.5, 2.1] },
        { id: 'single-bed-compact', name: 'Compact Single Bed', dimensions: [1.0, 0.5, 1.9], tags: ['compact'] },
        { id: 'bedside-table', name: 'Bedside Table', dimensions: [0.4, 0.5, 0.4] },
        { id: 'closet-large', name: 'Large Closet', dimensions: [1.2, 2.2, 0.6], tags: ['bedroom'] },
      ],
    }
    const closet = {
      id: 'item-closet',
      name: 'Large Closet',
      position: [3.4, 0, 1.5] as [number, number, number],
      rotation: [0, -Math.PI / 2, 0] as [number, number, number],
      asset: { id: 'closet-large', name: 'Large Closet', dimensions: [1.2, 2.2, 0.6] as [number, number, number] },
    }
    const { callMcp, deleted, calls } = makeMockMcp({
      catalog: TAG_MATCHED_CATALOG,
      items: [existingBed, closet],
    })
    const report = await executeFurnitureModifyOps({
      ops: [{ op: 'swap_furniture', room: '主卧', from: '床', to: '单人床' }],
      rooms: [bedroom],
      levelId: 'level-1',
      callMcp,
    })
    expect(report.results[0]!.ok).toBe(true)
    // The BED is what gets swapped — the closet stays.
    expect(deleted).toEqual(['item-bed'])
    // And the replacement is a real bed, not the smaller bedside table.
    const placed = calls.find(call => call.name === 'place_item')
    expect(placed?.args.catalogItemId).toBe('single-bed-compact')
  })

  test('CJK remove matches the placed English-named item via the trilingual matcher', async () => {
    // Catalog knows the term but returns ids that do NOT match the placed
    // item (e.g. user-placed variant) — the matcher regex still finds it.
    const { callMcp, deleted } = makeMockMcp({
      catalog: { ...ENGLISH_CATALOG, bed: [{ id: 'other-bed', name: 'Other Bed', dimensions: [1.8, 0.5, 2.1] }] },
    })
    const report = await executeFurnitureModifyOps({
      ops: [{ op: 'remove_furniture', room: '主卧', item: '床' }],
      rooms: [bedroom],
      levelId: 'level-1',
      callMcp,
    })
    expect(report.results[0]!.ok).toBe(true)
    expect(deleted).toEqual(['item-bed'])
  })
})
