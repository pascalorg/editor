import { describe, expect, test } from 'bun:test'
import { validateLayoutPlan } from './plan-validator'
import type { LayoutPlan } from './layout-plan'

function rect(x: number, z: number, w: number, d: number): Array<[number, number]> {
  return [
    [x, z],
    [x + w, z],
    [x + w, z + d],
    [x, z + d],
  ]
}

// A hand-built valid plan: 8×6 footprint, living below, bedroom + bathroom
// above, doors living↔bedroom and living↔bathroom, entry through the living.
function basePlan(): LayoutPlan {
  return {
    footprint: { width: 8, depth: 6 },
    entry: { roomId: 'living-1' },
    rooms: [
      { id: 'living-1', name: '客厅', type: 'living', polygon: rect(0, 0, 8, 3.5), requiresExteriorWindow: true },
      { id: 'bedroom-1', name: '卧室', type: 'bedroom', polygon: rect(0, 3.5, 5.5, 2.5), requiresExteriorWindow: true },
      { id: 'bath-1', name: '卫生间', type: 'bathroom', polygon: rect(5.5, 3.5, 2.5, 2.5), requiresExteriorWindow: false },
    ],
    connections: [
      { from: 'living-1', to: 'bedroom-1', type: 'door' },
      { from: 'living-1', to: 'bath-1', type: 'door' },
    ],
  }
}

test('base fixture passes with zero fatal', () => {
  const result = validateLayoutPlan(basePlan(), { totalAreaSqm: 48 })
  expect(result.fatal).toEqual([])
  expect(result.score).toBeGreaterThan(80)
})

describe('the 11 checks each catch their illegal plan', () => {
  test('#1a duplicate room id', () => {
    const plan = basePlan()
    plan.rooms[1]!.id = 'living-1'
    const result = validateLayoutPlan(plan)
    expect(result.fatal.some(f => f.includes('重复'))).toBe(true)
  })

  test('#1b non-axis-aligned polygon', () => {
    const plan = basePlan()
    plan.rooms[1]!.polygon = [[0, 3.5], [5.5, 3.8], [5.5, 6], [0, 6]]
    const result = validateLayoutPlan(plan)
    expect(result.fatal.some(f => f.includes('轴对齐'))).toBe(true)
  })

  test('#1c self-intersecting polygon', () => {
    const plan = basePlan()
    plan.rooms[1]!.polygon = [[0, 3.5], [5.5, 6], [5.5, 3.5], [0, 6]]
    const result = validateLayoutPlan(plan)
    expect(result.fatal.some(f => f.includes('自相交') || f.includes('轴对齐'))).toBe(true)
  })

  test('#1d dangling entry / connection references', () => {
    const plan = basePlan()
    plan.entry.roomId = 'ghost'
    plan.connections.push({ from: 'living-1', to: 'nowhere', type: 'door' })
    const result = validateLayoutPlan(plan)
    expect(result.fatal.some(f => f.includes('entry.roomId'))).toBe(true)
    expect(result.fatal.some(f => f.includes('不存在的房间'))).toBe(true)
  })

  test('#2 room outside the footprint', () => {
    const plan = basePlan()
    plan.rooms[2]!.polygon = rect(5.5, 3.5, 3.5, 2.5) // x reaches 9 > 8
    const result = validateLayoutPlan(plan)
    expect(result.fatal.some(f => f.includes('超出 footprint'))).toBe(true)
  })

  test('#3 overlapping rooms', () => {
    const plan = basePlan()
    plan.rooms[2]!.polygon = rect(5.0, 3.5, 3, 2.5) // overlaps bedroom by 0.5m
    const result = validateLayoutPlan(plan)
    expect(result.fatal.some(f => f.includes('重叠'))).toBe(true)
  })

  test('#4 coverage gap', () => {
    const plan = basePlan()
    plan.rooms[1]!.polygon = rect(0, 3.5, 4.5, 2.5) // 1m-wide hole before bath
    const result = validateLayoutPlan(plan)
    expect(result.fatal.some(f => f.includes('铺满'))).toBe(true)
  })

  test('#5 footprint area off target', () => {
    const result = validateLayoutPlan(basePlan(), { totalAreaSqm: 60 })
    expect(result.fatal.some(f => f.includes('偏离目标'))).toBe(true)
  })

  test('#6 room type counts mismatch brief', () => {
    const result = validateLayoutPlan(basePlan(), {
      requiredRooms: [{ type: 'bedroom', count: 2 }],
    })
    expect(result.fatal.some(f => f.includes('bedroom') && f.includes('数量'))).toBe(true)
  })

  test('#6 living_kitchen satisfies both living and kitchen', () => {
    const plan = basePlan()
    plan.rooms[0] = {
      ...plan.rooms[0]!,
      type: 'living_kitchen',
      name: '客厅/开放式厨房',
    }
    const result = validateLayoutPlan(plan, {
      requiredRooms: [
        { type: 'living', count: 1 },
        { type: 'kitchen', count: 1 },
      ],
    })
    expect(result.fatal).toEqual([])
  })

  test('#7a grotesque room area is fatal, mild deviation is a warning', () => {
    const plan = basePlan()
    // Bedroom shrunk to 3㎡ (< 6×0.6), bathroom eats the rest of the strip.
    plan.rooms[1]!.polygon = rect(0, 3.5, 1.2, 2.5)
    plan.rooms[2]!.polygon = rect(1.2, 3.5, 6.8, 2.5)
    const result = validateLayoutPlan(plan)
    expect(result.fatal.some(f => f.includes('卧室') && f.includes('面积'))).toBe(true)
  })

  test('#7b sliver room aspect ratio is fatal', () => {
    const plan: LayoutPlan = {
      footprint: { width: 8, depth: 6 },
      entry: { roomId: 'living-1' },
      rooms: [
        { id: 'living-1', name: '客厅', type: 'living', polygon: rect(0, 0, 8, 4.8), requiresExteriorWindow: true },
        { id: 'bedroom-1', name: '卧室', type: 'bedroom', polygon: rect(0, 4.8, 8, 1.2), requiresExteriorWindow: true },
      ],
      connections: [{ from: 'living-1', to: 'bedroom-1', type: 'door' }],
    }
    const result = validateLayoutPlan(plan)
    expect(result.fatal.some(f => f.includes('狭长'))).toBe(true)
  })

  test('#7c corridor share above hard cap is fatal', () => {
    const plan: LayoutPlan = {
      footprint: { width: 8, depth: 6 },
      entry: { roomId: 'hall-1' },
      rooms: [
        { id: 'hall-1', name: '走廊', type: 'hallway', polygon: rect(0, 0, 8, 2), requiresExteriorWindow: false },
        { id: 'living-1', name: '客厅', type: 'living', polygon: rect(0, 2, 8, 4), requiresExteriorWindow: true },
      ],
      connections: [{ from: 'hall-1', to: 'living-1', type: 'door' }],
    }
    const result = validateLayoutPlan(plan)
    expect(result.fatal.some(f => f.includes('通行空间占比'))).toBe(true)
  })

  test('#8 window room without an exterior edge', () => {
    const plan = basePlan()
    plan.rooms.push({
      id: 'study-1',
      name: '书房',
      type: 'study',
      polygon: rect(2, 4, 2, 1.5), // floats inside, no boundary contact
      requiresExteriorWindow: true,
    })
    const result = validateLayoutPlan(plan)
    expect(result.fatal.some(f => f.includes('书房') && f.includes('外墙边'))).toBe(true)
  })

  test('#9 connection without a usable shared edge', () => {
    // Four quadrants; A↔D touch only at the center point.
    const plan: LayoutPlan = {
      footprint: { width: 8, depth: 6 },
      entry: { roomId: 'a' },
      rooms: [
        { id: 'a', name: '客厅', type: 'living', polygon: rect(0, 0, 4, 3), requiresExteriorWindow: true },
        { id: 'b', name: '餐厅', type: 'dining', polygon: rect(4, 0, 4, 3), requiresExteriorWindow: false },
        { id: 'c', name: '卧室', type: 'bedroom', polygon: rect(0, 3, 4, 3), requiresExteriorWindow: true },
        { id: 'd', name: '书房', type: 'study', polygon: rect(4, 3, 4, 3), requiresExteriorWindow: false },
      ],
      connections: [
        { from: 'a', to: 'b', type: 'door' },
        { from: 'a', to: 'c', type: 'door' },
        { from: 'a', to: 'd', type: 'door' }, // diagonal — no shared edge
      ],
    }
    const result = validateLayoutPlan(plan)
    expect(result.fatal.some(f => f.includes('共享墙段'))).toBe(true)
  })

  test('#10a unreachable room', () => {
    const plan = basePlan()
    plan.connections = [{ from: 'living-1', to: 'bedroom-1', type: 'door' }]
    const result = validateLayoutPlan(plan)
    expect(result.fatal.some(f => f.includes('不可达'))).toBe(true)
  })

  test('#10b bedroom only reachable through the kitchen', () => {
    const plan: LayoutPlan = {
      footprint: { width: 8, depth: 9 },
      entry: { roomId: 'living-1' },
      rooms: [
        { id: 'living-1', name: '客厅', type: 'living', polygon: rect(0, 0, 8, 3), requiresExteriorWindow: true },
        { id: 'kitchen-1', name: '厨房', type: 'kitchen', polygon: rect(0, 3, 8, 3), requiresExteriorWindow: false },
        { id: 'bedroom-1', name: '卧室', type: 'bedroom', polygon: rect(0, 6, 8, 3), requiresExteriorWindow: true },
      ],
      connections: [
        { from: 'living-1', to: 'kitchen-1', type: 'door' },
        { from: 'kitchen-1', to: 'bedroom-1', type: 'door' },
      ],
    }
    const result = validateLayoutPlan(plan)
    expect(result.fatal.some(f => f.includes('卧室') && f.includes('不穿过'))).toBe(true)
  })

  test('#11 entry room without an exterior wall', () => {
    const plan = basePlan()
    plan.rooms.push({
      id: 'inner-1',
      name: '玄关',
      type: 'entry',
      polygon: rect(2, 4, 2, 1.5),
      requiresExteriorWindow: false,
    })
    plan.entry.roomId = 'inner-1'
    plan.connections.push({ from: 'inner-1', to: 'bedroom-1', type: 'door' })
    const result = validateLayoutPlan(plan)
    expect(result.fatal.some(f => f.includes('入户房间') && f.includes('外墙边'))).toBe(true)
  })
})
