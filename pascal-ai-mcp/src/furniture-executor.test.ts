import { describe, expect, test } from 'bun:test'
import { checkFurniturePlacement, type ItemSummary, type WallWithOpenings, type ZoneSummary } from './agent'
import {
  doorClearances,
  executeFurniturePlan,
  findWallPlacement,
  rankCandidates,
  type FurnitureRoom,
} from './furniture-executor'

// 4×3.5 bedroom, door centered on the south wall.
const bedroom: FurnitureRoom = {
  id: 'bedroom-1',
  name: '主卧',
  type: 'bedroom',
  polygon: [[0, 0], [4, 0], [4, 3.5], [0, 3.5]],
  zoneId: 'zone-bed',
}

const bedroomWalls = [
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

const CATALOG: Record<string, Array<{ id: string; name: string; dimensions: [number, number, number]; tags?: string[]; attachTo?: string }>> = {
  床: [
    { id: 'double-bed', name: 'Double Bed', dimensions: [1.8, 0.5, 2.1] },
    { id: 'single-bed-compact', name: 'Compact Single Bed', dimensions: [1.0, 0.5, 1.9], tags: ['compact'] },
    { id: 'bedside-table', name: 'Bedside Table', dimensions: [0.4, 0.5, 0.4] },
  ],
  衣柜: [{ id: 'wardrobe', name: 'Wardrobe Closet', dimensions: [1.2, 2.2, 0.6] }],
}

type RecordedCall = { name: string; args: Record<string, unknown> }

function makeMockMcp(options: {
  walls?: typeof bedroomWalls
  existingItems?: unknown[]
  catalog?: typeof CATALOG
} = {}) {
  const calls: RecordedCall[] = []
  const catalog = options.catalog ?? CATALOG
  let counter = 0
  const callMcp = async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args })
    const wrap = (payload: Record<string, unknown>) => ({ structuredContent: payload })
    switch (name) {
      case 'get_walls':
        return wrap({ walls: options.walls ?? bedroomWalls })
      case 'get_level_summary':
        return wrap({ items: options.existingItems ?? [] })
      case 'search_assets': {
        const results = catalog[args.query as string] ?? []
        return wrap({ results, total: results.length })
      }
      case 'place_item':
        counter++
        return wrap({ itemId: `item-${counter}` })
      default:
        throw new Error(`unexpected tool ${name}`)
    }
  }
  return { callMcp, calls }
}

// Turn a report's placements back into checkFurniturePlacement inputs so the
// executor is judged by the exact acceptance check the diagnostics run.
function asPlacedItems(report: Awaited<ReturnType<typeof executeFurniturePlan>>): ItemSummary[] {
  const dims = new Map<string, [number, number, number]>()
  for (const group of Object.values(CATALOG)) {
    for (const entry of group) dims.set(entry.id, entry.dimensions)
  }
  return report.placed.map(item => ({
    id: item.itemId,
    name: item.label,
    position: item.position,
    rotation: [0, item.rotationY, 0] as [number, number, number],
    asset: { dimensions: dims.get(item.catalogItemId)! },
  }))
}

describe('executeFurniturePlan', () => {
  test('furnishes a bedroom with zero self-check violations (batch C hard metric)', async () => {
    const { callMcp, calls } = makeMockMcp()
    const report = await executeFurniturePlan({
      rooms: [bedroom],
      levelId: 'level-1',
      callMcp,
    })

    expect(report.missing).toEqual([])
    expect(report.executionIssues).toEqual([])
    expect(report.placed.map(p => p.label).sort()).toEqual(['床', '衣柜'])
    expect(calls.filter(c => c.name === 'place_item')).toHaveLength(2)

    const zones: ZoneSummary[] = [{ id: 'zone-bed', name: '主卧', polygon: bedroom.polygon }]
    const violations = checkFurniturePlacement(
      zones,
      bedroomWalls as unknown as WallWithOpenings[],
      asPlacedItems(report),
    )
    expect(violations).toEqual([])
  })

  test('irrelevant search hits are filtered by the checklist matcher (床 never becomes 床头柜)', async () => {
    const { callMcp } = makeMockMcp()
    const report = await executeFurniturePlan({ rooms: [bedroom], levelId: 'level-1', callMcp })
    const bed = report.placed.find(p => p.label === '床')
    expect(bed?.catalogItemId).not.toBe('bedside-table')
  })

  test('a room too small for any candidate reports missing instead of forcing a spot', async () => {
    const tiny: FurnitureRoom = {
      ...bedroom,
      id: 'tiny',
      name: '迷你间',
      polygon: [[0, 0], [1, 0], [1, 1], [0, 1]],
    }
    const { callMcp } = makeMockMcp({ walls: [] as never })
    const report = await executeFurniturePlan({ rooms: [tiny], levelId: 'level-1', callMcp })
    expect(report.placed).toEqual([])
    expect(report.missing.map(m => m.label).sort()).toEqual(['床', '衣柜'])
  })

  test('existing items satisfy their requirement and occupy space', async () => {
    const { callMcp } = makeMockMcp({
      existingItems: [
        {
          id: 'pre-bed',
          name: 'Double Bed',
          position: [1, 0, 1.5],
          rotation: [0, 0, 0],
          asset: { dimensions: [1.8, 0.5, 2.1] },
        },
      ],
    })
    const report = await executeFurniturePlan({ rooms: [bedroom], levelId: 'level-1', callMcp })
    // Bed requirement already satisfied — only the wardrobe gets placed.
    expect(report.placed.map(p => p.label)).toEqual(['衣柜'])
    // And the new wardrobe must not overlap the existing bed.
    const wardrobe = report.placed[0]!
    const items: ItemSummary[] = [
      ...asPlacedItems(report),
      { id: 'pre-bed', name: 'Double Bed', position: [1, 0, 1.5], rotation: [0, 0, 0], asset: { dimensions: [1.8, 0.5, 2.1] } },
    ]
    const zones: ZoneSummary[] = [{ id: 'zone-bed', name: '主卧', polygon: bedroom.polygon }]
    const violations = checkFurniturePlacement(zones, bedroomWalls as unknown as WallWithOpenings[], items)
    expect(violations.filter(v => v.itemId === wardrobe.itemId)).toEqual([])
  })

  // Replica of eval case-03's kitchen (3.75×2.4, door on the north wall):
  // checklist order places the 1.55m sink first, which fragments the only
  // wall long enough for the 2.5m stove. Hardest-first packing must place
  // all three.
  test('kitchen packs the 2.5m stove before sink and fridge (case-03 regression)', async () => {
    const kitchen: FurnitureRoom = {
      id: 'kitchen-1',
      name: '厨房',
      type: 'kitchen',
      polygon: [[3.36, 0], [7.11, 0], [7.11, 2.4], [3.36, 2.4]],
      zoneId: 'zone-kitchen',
    }
    const kitchenWalls = [
      { id: 'k-south', start: [3.36, 0] as [number, number], end: [7.11, 0] as [number, number], openings: [] },
      { id: 'k-east', start: [7.11, 0] as [number, number], end: [7.11, 2.4] as [number, number], openings: [] },
      {
        id: 'k-north',
        start: [3.36, 2.4] as [number, number],
        end: [7.11, 2.4] as [number, number],
        openings: [{ type: 'door', position: [1.875, 1.05, 0] as [number, number, number], width: 0.9 }],
      },
      { id: 'k-west', start: [3.36, 2.4] as [number, number], end: [3.36, 0] as [number, number], openings: [] },
    ]
    const { callMcp } = makeMockMcp({
      walls: kitchenWalls as never,
      catalog: {
        'kitchen sink': [{ id: 'kitchen-sink-counter', name: 'Kitchen Sink Counter', dimensions: [1.55, 1.0955, 0.6] }],
        stove: [{ id: 'kitchen-countertop-stove-03', name: 'Kitchen Countertop Stove 03', dimensions: [2.5, 1, 0.9] }],
        fridge: [{ id: 'fridge-compact', name: 'Compact Fridge', dimensions: [0.5048, 0.8334, 0.5223] }],
      },
    })
    const report = await executeFurniturePlan({ rooms: [kitchen], levelId: 'level-1', callMcp })
    expect(report.missing).toEqual([])
    expect(report.placed.map(p => p.label).sort()).toEqual(['水槽柜', '灶台', '冰箱'].sort())
    // Stove placed first — its wall claim precedes the sink's.
    expect(report.placed[0]!.label).toBe('灶台')
  })

  // Replica of eval case-05's 小厨房 (1.89×2.27): every stove spec is wider
  // than the longest wall — the report must name the catalog gap, not the
  // generic "crowded room" reason.
  test('a stove wider than every wall reports the catalog gap (case-05 diagnosis)', async () => {
    const tinyKitchen: FurnitureRoom = {
      id: 'kitchen-tiny',
      name: '小厨房',
      type: 'kitchen',
      polygon: [[4.59, 0], [6.48, 0], [6.48, 2.27], [4.59, 2.27]],
      zoneId: 'zone-kitchen',
    }
    const { callMcp } = makeMockMcp({
      walls: [] as never,
      catalog: {
        'kitchen sink': [{ id: 'kitchen-sink-counter', name: 'Kitchen Sink Counter', dimensions: [1.55, 1.0955, 0.6] }],
        stove: [{ id: 'kitchen-countertop-stove-03', name: 'Kitchen Countertop Stove 03', dimensions: [2.5, 1, 0.9] }],
        fridge: [{ id: 'fridge-compact', name: 'Compact Fridge', dimensions: [0.5048, 0.8334, 0.5223] }],
      },
    })
    const report = await executeFurniturePlan({ rooms: [tinyKitchen], levelId: 'level-1', callMcp })
    const stove = report.missing.find(m => m.label === '灶台')
    expect(stove?.reason).toContain('超过房间最长墙')
    // Sink and fridge still land despite the stove failing.
    expect(report.placed.map(p => p.label).sort()).toEqual(['水槽柜', '冰箱'].sort())
  })

  test('catalog miss reports missing with a reason', async () => {
    const { callMcp } = makeMockMcp({ catalog: {} })
    const report = await executeFurniturePlan({ rooms: [bedroom], levelId: 'level-1', callMcp })
    expect(report.placed).toEqual([])
    expect(report.missing.every(m => m.reason.includes('检索不到'))).toBe(true)
  })
})

describe('placement geometry', () => {
  test('findWallPlacement avoids the door clearance', () => {
    const keepClear = doorClearances(bedroomWalls)
    expect(keepClear).toHaveLength(1)
    const spot = findWallPlacement({
      polygon: bedroom.polygon,
      itemDims: [1.0, 0.5, 1.9],
      occupied: [],
      keepClear,
    })
    expect(spot).not.toBeNull()
    // The bed's footprint must not poke into the clearance rectangle
    // (x∈[1.45,2.55], z∈[-0.75,0.75]).
    const [x, , z] = spot!.position
    const insideClearance = x + 0.5 > 1.45 && x - 0.5 < 2.55 && z - 0.95 < 0.75
    expect(insideClearance).toBe(false)
  })

  test('rankCandidates sorts by footprint ascending with compact tiebreak', () => {
    const ranked = rankCandidates([
      { id: 'big', name: 'Big', dimensions: [2, 1, 2], tags: [] },
      { id: 'small-std', name: 'Small', dimensions: [1, 1, 1], tags: [] },
      { id: 'small-compact', name: 'Small C', dimensions: [1, 1, 1], tags: ['compact'] },
    ])
    expect(ranked.map(c => c.id)).toEqual(['small-compact', 'small-std', 'big'])
  })
})
