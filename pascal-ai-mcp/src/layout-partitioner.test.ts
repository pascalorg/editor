import { describe, expect, test } from 'bun:test'
import { absorbRoomInPlan, partitionLayout, planDeviation, planRoomAreas } from './layout-partitioner'
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

describe('absorbRoomInPlan: local removal by absorption (MODIFY_REDESIGN §6 修订)', () => {
  const planOf = (intent: LayoutIntent, strategy?: Parameters<typeof partitionLayout>[2]) => {
    const result = partitionLayout(intent, undefined, strategy)
    if (!result.ok) throw new Error(`partition failed: ${result.reason}`)
    return result.plan
  }

  test('band hub carve (bathroom) fills back into the living room; nothing else moves', () => {
    const plan = planOf(两居)
    const result = absorbRoomInPlan(plan, 'bath-1')
    if (!result) throw new Error('expected absorption')
    expect(result.plan.rooms.some(room => room.id === 'bath-1')).toBe(false)
    // Absorber gained exactly the bathroom's area.
    const before = planRoomAreas(plan)
    const after = planRoomAreas(result.plan)
    expect(after.get(result.absorbedInto.id)!).toBeCloseTo(
      before.get(result.absorbedInto.id)! + before.get('bath-1')!, 1)
    // Every other room's polygon is byte-identical.
    for (const room of plan.rooms) {
      if (room.id === 'bath-1' || room.id === result.absorbedInto.id) continue
      expect(result.plan.rooms.find(r => r.id === room.id)?.polygon).toEqual(room.polygon)
    }
    // Footprint untouched, connections to the bathroom pruned.
    expect(result.plan.footprint).toEqual(plan.footprint)
    expect(result.plan.connections.some(c => c.from === 'bath-1' || c.to === 'bath-1')).toBe(false)
  })

  test('band column (bedroom) absorbs into its adjacent room', () => {
    const plan = planOf(两居)
    const result = absorbRoomInPlan(plan, 'bedroom-2')
    if (!result) throw new Error('expected absorption')
    const before = planRoomAreas(plan)
    const after = planRoomAreas(result.plan)
    expect(after.get(result.absorbedInto.id)!).toBeCloseTo(
      before.get(result.absorbedInto.id)! + before.get('bedroom-2')!, 1)
    for (const room of plan.rooms) {
      if (room.id === 'bedroom-2' || room.id === result.absorbedInto.id) continue
      expect(result.plan.rooms.find(r => r.id === room.id)?.polygon).toEqual(room.polygon)
    }
  })

  test('tanoji wing cell (bathroom) absorbs without reshuffling the grid (scene 6420b772c9fe 场景复刻)', () => {
    const tanoji2ldk: LayoutIntent = {
      targetTotalAreaSqm: 70,
      rooms: [
        { id: 'living-kitchen', name: 'LDK', type: 'living_kitchen', targetAreaSqm: 24 },
        { id: 'bedroom-1', name: '主卧', type: 'bedroom', targetAreaSqm: 14 },
        { id: 'bedroom-2', name: '次卧', type: 'bedroom', targetAreaSqm: 10 },
        { id: 'bath-1', name: '卫生间', type: 'bathroom', targetAreaSqm: 5 },
        { id: 'entry-1', name: '玄关', type: 'entry', targetAreaSqm: 3 },
      ],
    }
    const plan = planOf(tanoji2ldk, { typology: 'tanoji' })
    expect(plan.rooms.some(room => room.id === 'bath-1')).toBe(true)
    const result = absorbRoomInPlan(plan, 'bath-1')
    if (!result) throw new Error('expected absorption')
    for (const room of plan.rooms) {
      if (room.id === 'bath-1' || room.id === result.absorbedInto.id) continue
      expect(result.plan.rooms.find(r => r.id === room.id)?.polygon).toEqual(room.polygon)
    }
    expect(result.plan.footprint).toEqual(plan.footprint)
  })

  test('tanoji sliver candidate is skipped, not vetoed (2026-07-14 eval 复盘 case-20/21/23 根因)', () => {
    // 田の字下卫生间是窄格子：共享边最长的邻居（主卧）并集成 3.3:1 细长 L。
    // 形状预检必须在候选循环内 continue 到下一个邻居，而不是一票否决吸收。
    const intent: LayoutIntent = {
      targetTotalAreaSqm: 70,
      rooms: [
        { id: 'bedroom-1', name: '主卧', type: 'bedroom', targetAreaSqm: 13 },
        { id: 'bedroom-2', name: '次卧', type: 'bedroom', targetAreaSqm: 11 },
        { id: 'living-1', name: '客厅', type: 'living', targetAreaSqm: 17 },
        { id: 'kitchen-1', name: '厨房', type: 'kitchen', targetAreaSqm: 10 },
        { id: 'bath-1', name: '卫生间', type: 'bathroom', targetAreaSqm: 7 },
      ],
    }
    const plan = planOf(intent, { typology: 'tanoji' })
    const maxAspect = 3.0
    // Baseline (no precheck): the longest-edge neighbor wins and the union
    // fails validation — the scenario this fix exists for.
    const naive = absorbRoomInPlan(plan, 'bath-1')
    if (!naive) throw new Error('expected naive absorption')
    expect(validateLayoutPlan(naive.plan, { totalAreaSqm: 70 }).fatal).not.toEqual([])
    const result = absorbRoomInPlan(plan, 'bath-1', maxAspect)
    if (!result) throw new Error('expected absorption with shape precheck')
    // The precheck routed absorption away from the sliver-producing neighbor…
    expect(result.absorbedInto.id).not.toBe(naive.absorbedInto.id)
    // …and the whole plan clears the validator (no「过于狭长」fatal).
    expect(validateLayoutPlan(result.plan, { totalAreaSqm: 70 }).fatal).toEqual([])
    // Everyone except the absorber keeps their exact polygon.
    for (const room of plan.rooms) {
      if (room.id === 'bath-1' || room.id === result.absorbedInto.id) continue
      expect(result.plan.rooms.find(r => r.id === room.id)?.polygon).toEqual(room.polygon)
    }
    expect(result.plan.footprint).toEqual(plan.footprint)
  })

  test('entry-host removal (玄关) absorbs and re-homes the front door; nothing else moves', () => {
    const withEntry: LayoutIntent = {
      targetTotalAreaSqm: 70,
      rooms: [
        { id: 'living-kitchen', name: 'LDK', type: 'living_kitchen', targetAreaSqm: 24 },
        { id: 'bedroom-1', name: '主卧', type: 'bedroom', targetAreaSqm: 14 },
        { id: 'bedroom-2', name: '次卧', type: 'bedroom', targetAreaSqm: 10 },
        { id: 'bath-1', name: '卫生间', type: 'bathroom', targetAreaSqm: 5 },
        { id: 'entry-1', name: '玄关', type: 'entry', targetAreaSqm: 3 },
      ],
    }
    const plan = planOf(withEntry)
    expect(plan.entry.roomId).toBe('entry-1')
    const result = absorbRoomInPlan(plan, 'entry-1')
    if (!result) throw new Error('expected absorption')
    // The front door re-homes onto the absorber, which must be a type that
    // may face the entry (never a bedroom/bathroom).
    expect(result.plan.entry.roomId).toBe(result.absorbedInto.id)
    expect(['living', 'living_kitchen', 'dining', 'hallway']).toContain(result.absorbedInto.type)
    // The absorber keeps an exterior edge to host the entry door.
    const onBoundary = result.absorbedInto.polygon.some(([x, z]) =>
      x === 0 || z === 0 || x === result.plan.footprint.width || z === result.plan.footprint.depth)
    expect(onBoundary).toBe(true)
    // 玄关's doors remap to the absorber instead of vanishing.
    expect(result.plan.connections.some(c => c.from === 'entry-1' || c.to === 'entry-1')).toBe(false)
    // Everyone else stays byte-identical.
    for (const room of plan.rooms) {
      if (room.id === 'entry-1' || room.id === result.absorbedInto.id) continue
      expect(result.plan.rooms.find(r => r.id === room.id)?.polygon).toEqual(room.polygon)
    }
    expect(result.plan.footprint).toEqual(plan.footprint)
  })

  test('entry absorbs into the corridor: circulation is aspect-exempt and remapped doors are not orphans (case-21 线上几何复刻)', () => {
    // Scene 7b8a53e8547a rev21: the entry strip's only whitelisted neighbor
    // is the corridor above it — their union is a 1.15×6.52 strip (5.67:1).
    // The validator exempts circulation from the aspect check, so the
    // precheck must too; and the kitchen's only door (to the entry) gets
    // REMAPPED onto the absorber, so it must not read as an orphan.
    const P = (points: number[][]) => points as Array<[number, number]>
    const plan = {
      footprint: { width: 6.39, depth: 9.39 },
      entry: { roomId: 'entry-1' },
      rooms: [
        { id: 'living-1', name: '客厅', type: 'living' as const, polygon: P([[0, 6.52], [6.39, 6.52], [6.39, 9.39], [0, 9.39]]), requiresExteriorWindow: false },
        { id: 'kitchen-1', name: '厨房', type: 'kitchen' as const, polygon: P([[0, 0], [2.82, 0], [2.82, 2.53], [0, 2.53]]), requiresExteriorWindow: false },
        { id: 'bedroom-1', name: '榻榻米卧室1', type: 'bedroom' as const, polygon: P([[0, 2.53], [2.82, 2.53], [2.82, 6.52], [0, 6.52]]), requiresExteriorWindow: true },
        { id: 'bedroom-2', name: '榻榻米卧室2', type: 'bedroom' as const, polygon: P([[3.97, 1.9], [6.39, 1.9], [6.39, 6.52], [3.97, 6.52]]), requiresExteriorWindow: true },
        { id: 'bath-1', name: '卫生间', type: 'bathroom' as const, polygon: P([[3.97, 0], [6.39, 0], [6.39, 1.9], [3.97, 1.9]]), requiresExteriorWindow: false },
        { id: 'entry-1', name: '玄关换鞋区', type: 'entry' as const, polygon: P([[2.82, 0], [3.97, 0], [3.97, 2.66], [2.82, 2.66]]), requiresExteriorWindow: false },
        { id: 'corridor-1', name: '走廊', type: 'hallway' as const, polygon: P([[2.82, 2.66], [3.97, 2.66], [3.97, 6.52], [2.82, 6.52]]), requiresExteriorWindow: false },
      ],
      connections: [
        { from: 'entry-1', to: 'corridor-1', type: 'door' as const },
        { from: 'corridor-1', to: 'living-1', type: 'door' as const },
        { from: 'corridor-1', to: 'bedroom-1', type: 'door' as const },
        { from: 'corridor-1', to: 'bedroom-2', type: 'door' as const },
        { from: 'entry-1', to: 'kitchen-1', type: 'door' as const },
        { from: 'entry-1', to: 'bath-1', type: 'door' as const },
      ],
    }
    const result = absorbRoomInPlan(plan as never, 'entry-1', 3.0)
    if (!result) throw new Error('expected absorption into the corridor')
    expect(result.absorbedInto.id).toBe('corridor-1')
    expect(result.plan.entry.roomId).toBe('corridor-1')
    // Kitchen/bath doors remapped onto the absorber, not dropped.
    expect(result.plan.connections.some(c =>
      (c.from === 'kitchen-1' && c.to === 'corridor-1') || (c.from === 'corridor-1' && c.to === 'kitchen-1'))).toBe(true)
    expect(result.plan.connections.some(c =>
      (c.from === 'bath-1' && c.to === 'corridor-1') || (c.from === 'corridor-1' && c.to === 'bath-1'))).toBe(true)
    expect(validateLayoutPlan(result.plan as never, { totalAreaSqm: 60 }).fatal).toEqual([])
  })

  test('entry-host removal never absorbs into a bedroom or bathroom', () => {
    // Fabricated plan: the entry's ONLY union-compatible neighbor is a
    // bedroom — absorption must bail to re-partition instead of opening the
    // front door into it.
    const plan = {
      footprint: { width: 6, depth: 4 },
      entry: { roomId: 'entry-1' },
      rooms: [
        { id: 'entry-1', name: '玄关', type: 'entry' as const, polygon: [[0, 0], [2, 0], [2, 4], [0, 4]] as Array<[number, number]>, requiresExteriorWindow: false },
        { id: 'bedroom-1', name: '卧室', type: 'bedroom' as const, polygon: [[2, 0], [6, 0], [6, 4], [2, 4]] as Array<[number, number]>, requiresExteriorWindow: true },
      ],
      connections: [{ from: 'entry-1', to: 'bedroom-1', type: 'door' as const }],
    }
    expect(absorbRoomInPlan(plan, 'entry-1')).toBeNull()
  })

  test('corridor and orphan-producing removals bail to re-partition', () => {
    const plan = planOf(两居)
    const corridor = plan.rooms.find(room => room.type === 'hallway')
    if (corridor) expect(absorbRoomInPlan(plan, corridor.id)).toBeNull()
    // 两居 has no 玄关 room: when the entry host is the corridor itself it
    // stays un-absorbable via the hallway rule.
    const entryHost = plan.rooms.find(room => room.id === plan.entry.roomId)
    if (entryHost?.type === 'hallway') {
      expect(absorbRoomInPlan(plan, plan.entry.roomId)).toBeNull()
    }
    // Orphan: a fabricated plan where the study's only door goes through the
    // bedroom — removing the bedroom must bail.
    const orphanPlan = {
      footprint: { width: 9, depth: 4 },
      entry: { roomId: 'living-1' },
      rooms: [
        { id: 'living-1', name: '客厅', type: 'living' as const, polygon: [[0, 0], [3, 0], [3, 4], [0, 4]] as Array<[number, number]>, requiresExteriorWindow: true },
        { id: 'bedroom-1', name: '卧室', type: 'bedroom' as const, polygon: [[3, 0], [6, 0], [6, 4], [3, 4]] as Array<[number, number]>, requiresExteriorWindow: true },
        { id: 'study-1', name: '书房', type: 'study' as const, polygon: [[6, 0], [9, 0], [9, 4], [6, 4]] as Array<[number, number]>, requiresExteriorWindow: true },
      ],
      connections: [
        { from: 'living-1', to: 'bedroom-1', type: 'door' as const },
        { from: 'study-1', to: 'bedroom-1', type: 'door' as const },
      ],
    }
    expect(absorbRoomInPlan(orphanPlan, 'bedroom-1')).toBeNull()
  })
})
