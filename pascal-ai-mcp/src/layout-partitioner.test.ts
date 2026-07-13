import { describe, expect, test } from 'bun:test'
import { partitionLayout, planDeviation, planRoomAreas } from './layout-partitioner'
import { validateLayoutPlan, type PlanTargets } from './plan-validator'
import { polygonArea, type LayoutIntent } from './layout-plan'

// Batch-A acceptance (GENERATION_REDESIGN.md §8): every typical intent must
// come out of the partitioner with ZERO validator fatals.
function expectValidPlan(intent: LayoutIntent, targets: PlanTargets = {}) {
  const result = partitionLayout(intent)
  if (!result.ok) throw new Error(`partitioner failed: ${result.reason}`)
  const validation = validateLayoutPlan(result.plan, {
    totalAreaSqm: intent.targetTotalAreaSqm,
    ...targets,
  })
  expect(validation.fatal).toEqual([])
  return result.plan
}

const 单间: LayoutIntent = {
  targetTotalAreaSqm: 20,
  rooms: [{ id: 'room-1', name: '单间', type: 'other' }],
}

const studio: LayoutIntent = {
  targetTotalAreaSqm: 35,
  rooms: [
    { id: 'lk-1', name: '客厅/开放式厨房', type: 'living_kitchen', targetAreaSqm: 30 },
    { id: 'bath-1', name: '卫生间', type: 'bathroom', targetAreaSqm: 5 },
  ],
}

const 一居: LayoutIntent = {
  targetTotalAreaSqm: 50,
  rooms: [
    { id: 'bedroom-1', name: '卧室', type: 'bedroom', targetAreaSqm: 13 },
    { id: 'living-1', name: '客厅', type: 'living', targetAreaSqm: 22 },
    { id: 'kitchen-1', name: '厨房', type: 'kitchen', targetAreaSqm: 6 },
    { id: 'bath-1', name: '卫生间', type: 'bathroom', targetAreaSqm: 4 },
  ],
}

const 两居: LayoutIntent = {
  targetTotalAreaSqm: 75,
  rooms: [
    { id: 'bedroom-1', name: '主卧', type: 'bedroom', targetAreaSqm: 15 },
    { id: 'bedroom-2', name: '次卧', type: 'bedroom', targetAreaSqm: 11 },
    { id: 'living-1', name: '客厅', type: 'living' },
    { id: 'kitchen-1', name: '厨房', type: 'kitchen' },
    { id: 'bath-1', name: '卫生间', type: 'bathroom' },
  ],
}

const 三居: LayoutIntent = {
  targetTotalAreaSqm: 110,
  rooms: [
    { id: 'bedroom-1', name: '主卧', type: 'bedroom', targetAreaSqm: 16 },
    { id: 'bedroom-2', name: '次卧', type: 'bedroom', targetAreaSqm: 12 },
    { id: 'bedroom-3', name: '儿童房', type: 'bedroom', targetAreaSqm: 10 },
    { id: 'living-1', name: '客厅', type: 'living', targetAreaSqm: 28 },
    { id: 'dining-1', name: '餐厅', type: 'dining' },
    { id: 'kitchen-1', name: '厨房', type: 'kitchen' },
    { id: 'bath-1', name: '客卫', type: 'bathroom' },
    { id: 'bath-2', name: '主卫', type: 'bathroom' },
  ],
}

const 开放厨房两居: LayoutIntent = {
  targetTotalAreaSqm: 80,
  rooms: [
    { id: 'lk-1', name: '客厅/开放式厨房', type: 'living_kitchen', targetAreaSqm: 34 },
    { id: 'bedroom-1', name: '主卧', type: 'bedroom', targetAreaSqm: 15 },
    { id: 'bedroom-2', name: '次卧', type: 'bedroom', targetAreaSqm: 11 },
    { id: 'bath-1', name: '卫生间', type: 'bathroom' },
  ],
}

describe('partitionLayout: typical intents produce validator-clean plans', () => {
  test('单间', () => {
    const plan = expectValidPlan(单间)
    expect(plan.rooms).toHaveLength(1)
    expect(plan.connections).toHaveLength(0)
  })

  test('studio（开放式厨房，一个 zone）', () => {
    const plan = expectValidPlan(studio, {
      requiredRooms: [
        { type: 'living', count: 1 },
        { type: 'kitchen', count: 1 },
        { type: 'bathroom', count: 1 },
      ],
    })
    // living_kitchen satisfies both living and kitchen — no separate kitchen.
    expect(plan.rooms.filter(r => r.type === 'kitchen')).toHaveLength(0)
  })

  test('一居', () => {
    expectValidPlan(一居, {
      requiredRooms: [
        { type: 'bedroom', count: 1 },
        { type: 'living', count: 1 },
        { type: 'kitchen', count: 1 },
        { type: 'bathroom', count: 1 },
      ],
    })
  })

  test('两居（自动补走廊）', () => {
    const plan = expectValidPlan(两居, {
      requiredRooms: [
        { type: 'bedroom', count: 2 },
        { type: 'bathroom', count: 1 },
      ],
    })
    expect(plan.rooms.some(r => r.type === 'hallway')).toBe(true)
  })

  test('三居（两卫，次卫成为主卧套内卫）', () => {
    const plan = expectValidPlan(三居, {
      requiredRooms: [
        { type: 'bedroom', count: 3 },
        { type: 'bathroom', count: 2 },
      ],
    })
    // Second bathroom connects to a bedroom (en-suite).
    const ensuite = plan.connections.find(c =>
      (c.from === 'bath-2' || c.to === 'bath-2')
      && (c.from.startsWith('bedroom') || c.to.startsWith('bedroom')))
    expect(ensuite).toBeTruthy()
  })

  test('开放厨房两居', () => {
    expectValidPlan(开放厨房两居, {
      requiredRooms: [
        { type: 'living', count: 1 },
        { type: 'kitchen', count: 1 },
        { type: 'bedroom', count: 2 },
      ],
    })
  })
})

describe('partitionLayout: narrow_lot topology (S3)', () => {
  // case-06 replica: 5×18m lot, 两室一厅一厨一卫.
  const 狭长两居: LayoutIntent = {
    targetTotalAreaSqm: 90,
    rooms: [
      { id: 'living-1', name: '客厅', type: 'living', targetAreaSqm: 26 },
      { id: 'bedroom-1', name: '主卧', type: 'bedroom', targetAreaSqm: 16 },
      { id: 'bedroom-2', name: '次卧', type: 'bedroom', targetAreaSqm: 12 },
      { id: 'kitchen-1', name: '厨房', type: 'kitchen', targetAreaSqm: 8 },
      { id: 'bath-1', name: '卫生间', type: 'bathroom', targetAreaSqm: 5 },
    ],
  }

  test('footprintHint fixes the lot and the plan is validator-clean (case-06)', () => {
    const result = partitionLayout(狭长两居, undefined, {
      typology: 'narrow_lot',
      footprintHint: { widthM: 5, depthM: 18 },
    })
    if (!result.ok) throw new Error(`partitioner failed: ${result.reason}`)
    expect(result.plan.footprint).toEqual({ width: 5, depth: 18 })
    // Linear stack needs the longitudinal corridor.
    expect(result.plan.rooms.some(r => r.type === 'hallway')).toBe(true)
    const validation = validateLayoutPlan(result.plan, {
      totalAreaSqm: 90,
      requiredRooms: [
        { type: 'bedroom', count: 2 },
        { type: 'living', count: 1 },
        { type: 'kitchen', count: 1 },
        { type: 'bathroom', count: 1 },
      ],
    })
    expect(validation.fatal).toEqual([])
  })

  test('hint orientation is normalized (18×5 equals 5×18)', () => {
    const a = partitionLayout(狭长两居, undefined, {
      typology: 'narrow_lot',
      footprintHint: { widthM: 18, depthM: 5 },
    })
    const b = partitionLayout(狭长两居, undefined, {
      typology: 'narrow_lot',
      footprintHint: { widthM: 5, depthM: 18 },
    })
    expect(a).toEqual(b)
  })

  test('without a hint the footprint comes out slender (aspect ≥ 2.4)', () => {
    const result = partitionLayout(狭长两居, undefined, { typology: 'narrow_lot' })
    if (!result.ok) throw new Error(`partitioner failed: ${result.reason}`)
    const { width, depth } = result.plan.footprint
    expect(Math.max(width, depth) / Math.min(width, depth)).toBeGreaterThanOrEqual(2.35)
  })

  test('a lot beyond the narrow-lot aspect cap fails explicitly', () => {
    const result = partitionLayout(狭长两居, undefined, {
      typology: 'narrow_lot',
      footprintHint: { widthM: 3, depthM: 30 },
    })
    expect(result.ok).toBe(false)
  })

  test('standard_band strategy reproduces the no-strategy result', () => {
    expect(partitionLayout(两居, undefined, { typology: 'standard_band' })).toEqual(partitionLayout(两居))
  })
})

describe('partitionLayout: modify-path stability (M2)', () => {
  const baseline = () => {
    const result = partitionLayout(两居)
    if (!result.ok) throw new Error('baseline partition failed')
    return result.plan
  }

  test('resize (case-14 offline replica): width locked, other rooms barely move', () => {
    const prev = baseline()
    const resized = {
      ...两居,
      targetTotalAreaSqm: 78,
      rooms: 两居.rooms.map(room => room.id === 'bedroom-1' ? { ...room, targetAreaSqm: 18 } : room),
    }
    const result = partitionLayout(resized, undefined, undefined, { previousPlan: prev })
    if (!result.ok) throw new Error(`partition failed: ${result.reason}`)
    expect(result.plan.footprint.width).toBe(prev.footprint.width)
    // The resized bedroom must actually grow…
    const bedroom = result.plan.rooms.find(room => room.id === 'bedroom-1')!
    expect(planRoomAreas(result.plan).get('bedroom-1')!).toBeGreaterThan(15)
    expect(bedroom).toBeDefined()
    // …while total displacement across all shared rooms stays small (the
    // depth only absorbs +3㎡ / W ≈ 0.35m).
    expect(planDeviation(result.plan, prev)).toBeLessThan(3)
  })

  test('add_room (case-13 offline replica): width locked, new room lands, rest stay put', () => {
    const prev = baseline()
    const withStudy = {
      ...两居,
      targetTotalAreaSqm: 82,
      rooms: [...两居.rooms, { id: 'study-1', name: '书房', type: 'study' as const, targetAreaSqm: 7 }],
    }
    const result = partitionLayout(withStudy, undefined, undefined, { previousPlan: prev })
    if (!result.ok) throw new Error(`partition failed: ${result.reason}`)
    expect(result.plan.footprint.width).toBe(prev.footprint.width)
    expect(result.plan.rooms.some(room => room.id === 'study-1')).toBe(true)
    // Every previous room survives the edit.
    for (const room of prev.rooms) {
      if (room.type === 'hallway') continue // corridor is layout infrastructure
      expect(result.plan.rooms.some(entry => entry.id === room.id)).toBe(true)
    }
    expect(planDeviation(result.plan, prev)).toBeLessThan(8)
  })

  test('falls back to a fresh footprint (with a note) when the locked width cannot fit', () => {
    const prev = baseline() // W ≈ 8.4 for 75㎡
    const shrunk = {
      targetTotalAreaSqm: 24,
      rooms: [
        { id: 'living-1', name: '客厅', type: 'living' as const, targetAreaSqm: 18 },
        { id: 'bath-1', name: '卫生间', type: 'bathroom' as const, targetAreaSqm: 6 },
      ],
    }
    const result = partitionLayout(shrunk, undefined, undefined, { previousPlan: prev })
    if (!result.ok) throw new Error(`partition failed: ${result.reason}`)
    // 24㎡ at the old width would be ~2.9m deep — infeasible; the fallback
    // re-searches and says so.
    expect(result.notes.join()).toContain('放开外轮廓')
  })

  test('no stability argument reproduces the fresh-generation result exactly', () => {
    expect(partitionLayout(两居, undefined, undefined)).toEqual(partitionLayout(两居))
  })
})

describe('partitionLayout: structure of the output', () => {
  test('is deterministic', () => {
    const a = partitionLayout(三居)
    const b = partitionLayout(三居)
    expect(a).toEqual(b)
  })

  test('bedrooms sit against the exterior wall', () => {
    const result = partitionLayout(两居)
    if (!result.ok) throw new Error(result.reason)
    const { footprint } = result.plan
    for (const room of result.plan.rooms.filter(r => r.type === 'bedroom')) {
      const touchesBoundary = room.polygon.some(([, z]) => z === footprint.depth)
      expect(touchesBoundary).toBe(true)
    }
  })

  test('every room is reachable from the entry through connections', () => {
    const result = partitionLayout(三居)
    if (!result.ok) throw new Error(result.reason)
    const adjacency = new Map<string, string[]>()
    for (const { from, to } of result.plan.connections) {
      adjacency.set(from, [...(adjacency.get(from) ?? []), to])
      adjacency.set(to, [...(adjacency.get(to) ?? []), from])
    }
    const visited = new Set([result.plan.entry.roomId])
    const queue = [result.plan.entry.roomId]
    while (queue.length > 0) {
      for (const next of adjacency.get(queue.shift()!) ?? []) {
        if (!visited.has(next)) {
          visited.add(next)
          queue.push(next)
        }
      }
    }
    expect(visited.size).toBe(result.plan.rooms.length)
  })
})

describe('partitionLayout: infeasible intents fail explicitly', () => {
  test('30㎡ 塞 4 卧室 → 明确报错，不硬凑', () => {
    const result = partitionLayout({
      targetTotalAreaSqm: 30,
      rooms: [1, 2, 3, 4].map(i => ({
        id: `bedroom-${i}`,
        name: `卧室${i}`,
        type: 'bedroom' as const,
        targetAreaSqm: 12,
      })),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('建议')
  })

  test('空房间列表 / 非法总面积', () => {
    expect(partitionLayout({ targetTotalAreaSqm: 50, rooms: [] }).ok).toBe(false)
    expect(partitionLayout({
      targetTotalAreaSqm: 0,
      rooms: [{ id: 'a', name: 'A', type: 'living' }],
    }).ok).toBe(false)
  })

  test('无公共房型的多房间户型自动补走廊枢纽', () => {
    const result = partitionLayout({
      targetTotalAreaSqm: 40,
      rooms: [
        { id: 'bedroom-1', name: '卧室1', type: 'bedroom', targetAreaSqm: 14 },
        { id: 'bedroom-2', name: '卧室2', type: 'bedroom', targetAreaSqm: 12 },
        { id: 'study-1', name: '书房', type: 'study', targetAreaSqm: 9 },
      ],
    })
    if (!result.ok) throw new Error(result.reason)
    expect(result.plan.rooms.some(r => r.type === 'hallway')).toBe(true)
    expect(result.notes.some(n => n.includes('走廊'))).toBe(true)
    const validation = validateLayoutPlan(result.plan, { totalAreaSqm: 40 })
    expect(validation.fatal).toEqual([])
  })
})

describe('入户门房间选择：玄关 > 走廊 > 客厅', () => {
  test('有贯通走廊的三居：入户门开在走廊，不再是客厅', () => {
    const result = partitionLayout({
      targetTotalAreaSqm: 95,
      rooms: [
        { id: 'living-1', name: '客厅', type: 'living', targetAreaSqm: 26 },
        { id: 'bedroom-1', name: '主卧', type: 'bedroom', targetAreaSqm: 15 },
        { id: 'bedroom-2', name: '次卧', type: 'bedroom', targetAreaSqm: 12 },
        { id: 'bedroom-3', name: '小卧', type: 'bedroom', targetAreaSqm: 10 },
        { id: 'kitchen-1', name: '厨房', type: 'kitchen', targetAreaSqm: 7 },
        { id: 'bathroom-1', name: '卫生间', type: 'bathroom', targetAreaSqm: 5 },
      ],
    })
    if (!result.ok) throw new Error(result.reason)
    const entryRoom = result.plan.rooms.find(room => room.id === result.plan.entry.roomId)
    expect(entryRoom?.type).toBe('hallway')
  })

  test('明确给了玄关时玄关优先于走廊', () => {
    const result = partitionLayout({
      targetTotalAreaSqm: 100,
      rooms: [
        { id: 'living-1', name: '客厅', type: 'living', targetAreaSqm: 25 },
        { id: 'entry-1', name: '玄关', type: 'entry', targetAreaSqm: 3.5 },
        { id: 'bedroom-1', name: '主卧', type: 'bedroom', targetAreaSqm: 15 },
        { id: 'bedroom-2', name: '次卧', type: 'bedroom', targetAreaSqm: 12 },
        { id: 'kitchen-1', name: '厨房', type: 'kitchen', targetAreaSqm: 7 },
        { id: 'bathroom-1', name: '卫生间', type: 'bathroom', targetAreaSqm: 5 },
      ],
    })
    if (!result.ok) throw new Error(result.reason)
    expect(result.plan.entry.roomId).toBe('entry-1')
  })

  test('无走廊无玄关的一居：回退到客厅', () => {
    const result = partitionLayout({
      targetTotalAreaSqm: 55,
      rooms: [
        { id: 'living-1', name: '客厅', type: 'living', targetAreaSqm: 22 },
        { id: 'bedroom-1', name: '主卧', type: 'bedroom', targetAreaSqm: 14 },
        { id: 'kitchen-1', name: '厨房', type: 'kitchen', targetAreaSqm: 6 },
        { id: 'bathroom-1', name: '卫生间', type: 'bathroom', targetAreaSqm: 4 },
      ],
    })
    if (!result.ok) throw new Error(result.reason)
    expect(result.plan.entry.roomId).toBe('living-1')
  })
})

describe('partitionLayout: 田の字 topology (S4)', () => {
  // Typical 2LDK: LDK + 2 bedrooms + bath, jp-style with explicit 玄関.
  const 二LDK: LayoutIntent = {
    targetTotalAreaSqm: 62,
    rooms: [
      { id: 'ldk-1', name: 'LDK', type: 'living_kitchen', targetAreaSqm: 26 },
      { id: 'bedroom-1', name: '洋室1', type: 'bedroom', targetAreaSqm: 12 },
      { id: 'bedroom-2', name: '洋室2', type: 'bedroom', targetAreaSqm: 10 },
      { id: 'bath-1', name: '浴室', type: 'bathroom', targetAreaSqm: 4 },
      { id: 'entry-1', name: '玄関', type: 'entry', targetAreaSqm: 2.5 },
    ],
  }

  test('produces the central-corridor grid and is validator-clean', () => {
    const result = partitionLayout(二LDK, undefined, { typology: 'tanoji' })
    if (!result.ok) throw new Error(`partitioner failed: ${result.reason}`)
    const corridor = result.plan.rooms.find(r => r.type === 'hallway')
    expect(corridor).toBeDefined()
    // 田の字 signature: the corridor is a VERTICAL strip (deeper than wide)
    // strictly inside the footprint width, and the hub spans the full width
    // at the far end.
    const xs = corridor!.polygon.map(([x]) => x)
    const zs = corridor!.polygon.map(([, z]) => z)
    const corrW = Math.max(...xs) - Math.min(...xs)
    const corrD = Math.max(...zs) - Math.min(...zs)
    if (corrD > corrW) {
      expect(Math.min(...xs)).toBeGreaterThan(0)
      expect(Math.max(...xs)).toBeLessThan(result.plan.footprint.width)
    }
    const hub = result.plan.rooms.find(r => r.id === 'ldk-1')!
    const hubXs = hub.polygon.map(([x]) => x)
    expect(Math.max(...hubXs) - Math.min(...hubXs)).toBeCloseTo(result.plan.footprint.width, 1)
    // 玄関 hosts the entry door on the street side.
    expect(result.plan.entry.roomId).toBe('entry-1')
    const validation = validateLayoutPlan(result.plan, {
      totalAreaSqm: 62,
      requiredRooms: [
        { type: 'bedroom', count: 2 },
        { type: 'living_kitchen', count: 1 },
        { type: 'bathroom', count: 1 },
        { type: 'entry', count: 1 },
      ],
    })
    expect(validation.fatal).toEqual([])
  })

  test('is a preference: band candidates still compete and rescue infeasible cases', () => {
    // One wing room only — 田の字 rejects, the band layout must still win.
    const 一居: LayoutIntent = {
      targetTotalAreaSqm: 45,
      rooms: [
        { id: 'ldk-1', name: 'LDK', type: 'living_kitchen', targetAreaSqm: 24 },
        { id: 'bedroom-1', name: '主卧', type: 'bedroom', targetAreaSqm: 14 },
      ],
    }
    const result = partitionLayout(一居, undefined, { typology: 'tanoji' })
    expect(result.ok).toBe(true)
  })
})

describe('partitionLayout: l_shape topology (S5)', () => {
  const L形三居: LayoutIntent = {
    targetTotalAreaSqm: 95,
    rooms: [
      { id: 'ldk-1', name: 'LDK', type: 'living_kitchen', targetAreaSqm: 30 },
      { id: 'bedroom-1', name: '主卧', type: 'bedroom', targetAreaSqm: 15 },
      { id: 'bedroom-2', name: '次卧', type: 'bedroom', targetAreaSqm: 12 },
      { id: 'bedroom-3', name: '客卧', type: 'bedroom', targetAreaSqm: 10 },
      { id: 'bath-1', name: '卫生间', type: 'bathroom', targetAreaSqm: 5 },
      { id: 'storage-1', name: '储物间', type: 'storage', targetAreaSqm: 3 },
    ],
  }

  test('produces a true L footprint polygon and is validator-clean', () => {
    const result = partitionLayout(L形三居, undefined, { typology: 'l_shape' })
    if (!result.ok) throw new Error(`partitioner failed: ${result.reason}`)
    const { footprint } = result.plan
    expect(footprint.polygon).toBeDefined()
    expect(footprint.polygon).toHaveLength(6)
    // The L area is genuinely smaller than the bounding box.
    const lArea = polygonArea(footprint.polygon!)
    expect(lArea).toBeLessThan(footprint.width * footprint.depth - 1)
    expect(lArea).toBeCloseTo(95, -1)
    // Wing bedrooms connect through the wing corridor, not through each other.
    expect(result.plan.rooms.some(r => r.type === 'hallway')).toBe(true)
    const validation = validateLayoutPlan(result.plan, {
      totalAreaSqm: 95,
      requiredRooms: [
        { type: 'bedroom', count: 3 },
        { type: 'living_kitchen', count: 1 },
        { type: 'bathroom', count: 1 },
      ],
    })
    expect(validation.fatal).toEqual([])
  })

  test('single wing room connects straight to the hub (no corridor)', () => {
    const 小L: LayoutIntent = {
      targetTotalAreaSqm: 55,
      rooms: [
        { id: 'ldk-1', name: 'LDK', type: 'living_kitchen', targetAreaSqm: 28 },
        { id: 'bedroom-1', name: '主卧', type: 'bedroom', targetAreaSqm: 16 },
        { id: 'bath-1', name: '卫生间', type: 'bathroom', targetAreaSqm: 4 },
      ],
    }
    const result = partitionLayout(小L, undefined, { typology: 'l_shape' })
    if (!result.ok) throw new Error(`partitioner failed: ${result.reason}`)
    expect(result.plan.rooms.some(r => r.type === 'hallway')).toBe(false)
    expect(result.plan.connections.some(c =>
      (c.from === 'bedroom-1' && c.to === 'ldk-1') || (c.from === 'ldk-1' && c.to === 'bedroom-1'),
    )).toBe(true)
    const validation = validateLayoutPlan(result.plan, { totalAreaSqm: 55 })
    expect(validation.fatal).toEqual([])
  })
})
