import { describe, expect, test } from 'bun:test'
import { partitionLayout } from './layout-partitioner'
import { validateLayoutPlan, type PlanTargets } from './plan-validator'
import type { LayoutIntent } from './layout-plan'

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
