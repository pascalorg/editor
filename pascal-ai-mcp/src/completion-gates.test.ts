import { describe, expect, test } from 'bun:test'
import {
  classifyZoneType,
  evaluateCompletionGates,
  type GateItem,
  type GateWall,
  type GateZone,
} from './completion-gates'
import { findMissingFurniture } from './furniture-checklist'

function rect(x: number, z: number, w: number, d: number): Array<[number, number]> {
  return [
    [x, z],
    [x + w, z],
    [x + w, z + d],
    [x, z + d],
  ]
}

function wall(
  id: string,
  start: [number, number],
  end: [number, number],
  openings: Array<{ type: string }> = [],
): GateWall {
  return { id, start, end, openings }
}

function item(id: string, name: string, x: number, z: number): GateItem {
  return { id, name, position: [x, 0, z] }
}

// A complete passing scene: living (with entry door + window wall), bedroom
// (door to living, bed + wardrobe), kitchen and bathroom fully equipped.
//
//   z=6 ┌────────────┬──────┬──────┐
//       │ bedroom    │ kitchen│ bath │
//   z=3 ├────────────┴──────┴──────┤
//       │ living                   │
//   z=0 └──────────────────────────┘  x: 0..9
function passingScene(): { zones: GateZone[]; walls: GateWall[]; items: GateItem[] } {
  const zones: GateZone[] = [
    { id: 'z-living', name: '客厅', polygon: rect(0, 0, 9, 3) },
    { id: 'z-bed', name: '主卧', polygon: rect(0, 3, 4, 3) },
    { id: 'z-kitchen', name: '厨房', polygon: rect(4, 3, 2.5, 3) },
    { id: 'z-bath', name: '卫生间', polygon: rect(6.5, 3, 2.5, 3) },
  ]
  const walls: GateWall[] = [
    // Exterior
    wall('w-s', [0, 0], [9, 0], [{ type: 'door' }, { type: 'window' }]), // entry door + living window
    wall('w-e', [9, 0], [9, 6]),
    wall('w-n-bed', [0, 6], [4, 6], [{ type: 'window' }]),
    wall('w-n-kitchen', [4, 6], [6.5, 6], [{ type: 'window' }]),
    wall('w-n-bath', [6.5, 6], [9, 6]),
    wall('w-w', [0, 0], [0, 6]),
    // Interior band wall with doors into each upper room
    wall('w-mid-bed', [0, 3], [4, 3], [{ type: 'door' }]),
    wall('w-mid-kitchen', [4, 3], [6.5, 3], [{ type: 'door' }]),
    wall('w-mid-bath', [6.5, 3], [9, 3], [{ type: 'door' }]),
    // Interior partitions upstairs
    wall('w-part-1', [4, 3], [4, 6]),
    wall('w-part-2', [6.5, 3], [6.5, 6]),
  ]
  const items: GateItem[] = [
    item('i-bed', '双人床', 2, 5),
    item('i-wardrobe', '衣柜', 3.5, 4),
    item('i-sink', '水槽柜', 4.5, 5.5),
    item('i-stove', '灶台', 5.5, 5.5),
    item('i-fridge', '冰箱', 6, 4),
    item('i-toilet', '马桶', 7, 5.5),
    item('i-vanity', '浴室柜', 8, 5.5),
    item('i-shower', '淋浴房', 8.5, 4),
    item('i-sofa', '沙发', 4, 1),
  ]
  return { zones, walls, items }
}

const targets = {
  totalAreaSqm: 54,
  requiredRooms: [
    { type: 'bedroom' as const, count: 1 },
    { type: 'kitchen' as const, count: 1 },
    { type: 'bathroom' as const, count: 1 },
  ],
  requiredWindowRoomTypes: ['bedroom' as const],
}

test('passing scene clears all 7 gates', () => {
  const { zones, walls, items } = passingScene()
  const report = evaluateCompletionGates(zones, walls, items, targets)
  expect(report.failures).toEqual([])
  expect(report.passed).toBe(true)
})

describe('each gate fails on its broken scene', () => {
  test('gate 1: missing required room', () => {
    const { zones, walls, items } = passingScene()
    const report = evaluateCompletionGates(zones, walls, items, {
      requiredRooms: [{ type: 'bedroom', count: 2 }],
    })
    expect(report.failures.some(f => f.gate === 1)).toBe(true)
  })

  test('gate 2: union area off target', () => {
    const { zones, walls, items } = passingScene()
    const report = evaluateCompletionGates(zones, walls, items, { totalAreaSqm: 80 })
    expect(report.failures.some(f => f.gate === 2)).toBe(true)
  })

  test('gate 3: no entry door at all', () => {
    const { zones, walls, items } = passingScene()
    const noEntry = walls.map(w =>
      w.id === 'w-s' ? { ...w, openings: [{ type: 'window' }] } : w)
    const report = evaluateCompletionGates(zones, noEntry, items, {})
    expect(report.failures.some(f => f.gate === 3 && f.id === 'no-entry-door')).toBe(true)
  })

  test('gate 3: room isolated behind a doorless wall', () => {
    const { zones, walls, items } = passingScene()
    const sealed = walls.map(w =>
      w.id === 'w-mid-bath' ? { ...w, openings: [] } : w)
    const report = evaluateCompletionGates(zones, sealed, items, {})
    expect(report.failures.some(f => f.gate === 3 && f.message.includes('卫生间'))).toBe(true)
  })

  test('gate 3: open boundary (no wall) counts as a connection — 意见④', () => {
    // living_kitchen split into two zones with NO wall between them: the
    // doorless kitchen zone must NOT be reported as isolated.
    const zones: GateZone[] = [
      { id: 'z-lk', name: '客厅', polygon: rect(0, 0, 6, 4) },
      { id: 'z-open-kitchen', name: '开放式厨房', polygon: rect(6, 0, 3, 4) },
    ]
    const walls: GateWall[] = [
      wall('w-s', [0, 0], [9, 0], [{ type: 'door' }]),
      wall('w-e', [9, 0], [9, 4]),
      wall('w-n', [0, 4], [9, 4]),
      wall('w-w', [0, 0], [0, 4]),
      // no wall on x=6 — open plan
    ]
    const report = evaluateCompletionGates(zones, walls, [], {})
    expect(report.failures.filter(f => f.gate === 3)).toEqual([])
  })

  test('gate 4: requested window missing', () => {
    const { zones, walls, items } = passingScene()
    const noWindow = walls.map(w =>
      w.id === 'w-n-bed' ? { ...w, openings: [] } : w)
    const report = evaluateCompletionGates(zones, noWindow, items, {
      requiredWindowRoomTypes: ['bedroom'],
    })
    expect(report.failures.some(f => f.gate === 4)).toBe(true)
  })

  test('gate 5: bedroom only reachable through the kitchen', () => {
    const zones: GateZone[] = [
      { id: 'z-living', name: '客厅', polygon: rect(0, 0, 6, 3) },
      { id: 'z-kitchen', name: '厨房', polygon: rect(0, 3, 6, 3) },
      { id: 'z-bed', name: '卧室', polygon: rect(0, 6, 6, 3) },
    ]
    const walls: GateWall[] = [
      wall('w-s', [0, 0], [6, 0], [{ type: 'door' }]),
      wall('w-mid-1', [0, 3], [6, 3], [{ type: 'door' }]),
      wall('w-mid-2', [0, 6], [6, 6], [{ type: 'door' }]),
      wall('w-e', [6, 0], [6, 9]),
      wall('w-n', [0, 9], [6, 9]),
      wall('w-w', [0, 0], [0, 9]),
    ]
    const report = evaluateCompletionGates(zones, walls, [], {})
    expect(report.failures.some(f => f.gate === 5)).toBe(true)
  })

  test('gate 6: kitchen missing the fridge, bathroom missing shower AND tub', () => {
    const { zones, walls, items } = passingScene()
    const reduced = items.filter(i => i.id !== 'i-fridge' && i.id !== 'i-shower')
    const report = evaluateCompletionGates(zones, walls, reduced, {})
    expect(report.failures.some(f => f.gate === 6 && f.message.includes('冰箱'))).toBe(true)
    expect(report.failures.some(f => f.gate === 6 && f.message.includes('淋浴或浴缸'))).toBe(true)
  })

  test('gate 6: bathtub satisfies the shower-or-bathtub alternative', () => {
    const { zones, walls, items } = passingScene()
    const swapped = items.map(i =>
      i.id === 'i-shower' ? item('i-tub', '浴缸', 8.5, 4) : i)
    const report = evaluateCompletionGates(zones, walls, swapped, {})
    expect(report.failures.filter(f => f.gate === 6)).toEqual([])
  })

  test('gate 7: bedroom without a bed', () => {
    const { zones, walls, items } = passingScene()
    const reduced = items.filter(i => i.id !== 'i-bed')
    const report = evaluateCompletionGates(zones, walls, reduced, {})
    expect(report.failures.some(f => f.gate === 7 && f.message.includes('床'))).toBe(true)
  })
})

describe('classifyZoneType', () => {
  test('combined living-kitchen names resolve before their parts', () => {
    expect(classifyZoneType('客厅/开放式厨房')).toBe('living_kitchen')
    expect(classifyZoneType('开放式厨房')).toBe('living_kitchen')
    expect(classifyZoneType('厨房')).toBe('kitchen')
    expect(classifyZoneType('客厅')).toBe('living')
  })

  test('circulation, bedrooms, service rooms', () => {
    expect(classifyZoneType('走廊')).toBe('hallway')
    expect(classifyZoneType('玄关')).toBe('entry')
    expect(classifyZoneType('主卧')).toBe('bedroom')
    expect(classifyZoneType('客卫')).toBe('bathroom')
    expect(classifyZoneType('餐厅')).toBe('dining')
    expect(classifyZoneType('书房')).toBe('study')
    expect(classifyZoneType('阳台')).toBe('balcony')
    expect(classifyZoneType('健身房')).toBe('other')
  })
})

describe('furniture checklist matching', () => {
  test('床头柜 does not satisfy the bed requirement', () => {
    const missing = findMissingFurniture('bedroom', ['床头柜', '衣柜'])
    expect(missing.map(m => m.key)).toEqual(['bed'])
  })

  test('双人床 + wardrobe satisfies the bedroom checklist', () => {
    expect(findMissingFurniture('bedroom', ['双人床', '衣柜'])).toEqual([])
  })

  test('living_kitchen requires the union of living and kitchen lists', () => {
    const missing = findMissingFurniture('living_kitchen', ['沙发', '茶几', '水槽柜', '灶台'])
    expect(missing.map(m => m.key)).toEqual(['fridge'])
  })

  test('english asset names match too', () => {
    expect(findMissingFurniture('bathroom', ['toilet', 'bathroom-vanity', 'shower-cabin'])).toEqual([])
    expect(findMissingFurniture('kitchen', ['kitchen-sink-counter', 'stove', 'fridge'])).toEqual([])
  })
})
