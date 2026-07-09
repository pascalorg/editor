import { describe, expect, test } from 'bun:test'
import { partitionLayout } from './layout-partitioner'
import type { LayoutIntent } from './layout-plan'
import { buildLayoutPlan, parseLayoutPlanJson } from './plan-builder'
import type { ChatMessage } from './types'

const oneBedroomIntent: LayoutIntent = {
  targetTotalAreaSqm: 55,
  rooms: [
    { id: 'living-1', name: '客厅', type: 'living', targetAreaSqm: 22 },
    { id: 'bedroom-1', name: '主卧', type: 'bedroom', targetAreaSqm: 14 },
    { id: 'kitchen-1', name: '厨房', type: 'kitchen', targetAreaSqm: 6 },
    { id: 'bathroom-1', name: '卫生间', type: 'bathroom', targetAreaSqm: 4 },
  ],
}

// A `complete` stub that pops scripted replies and records every prompt it
// was shown, so tests can assert on the correction-round content.
function scriptedModel(replies: string[]) {
  const seen: ChatMessage[][] = []
  const complete = async (messages: ChatMessage[]) => {
    seen.push(structuredClone(messages))
    const reply = replies.shift()
    if (reply === undefined) throw new Error('scripted model ran out of replies')
    return reply
  }
  return { complete, seen }
}

describe('buildLayoutPlan (intent path)', () => {
  test('valid intent on the first round yields a validated plan in one model call', async () => {
    const { complete } = scriptedModel([JSON.stringify(oneBedroomIntent)])
    const result = await buildLayoutPlan(
      { briefSummary: '一居室，55㎡，含厨房卫生间', targets: { totalAreaSqm: 55 } },
      complete,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.modelCalls).toBe(1)
    expect(result.intent?.rooms).toHaveLength(4)
    expect(result.plan.rooms.length).toBeGreaterThanOrEqual(4)
    expect(result.validation.fatal).toEqual([])
  })

  test('a malformed first reply triggers a correction round quoting the defect', async () => {
    const { complete, seen } = scriptedModel([
      '这里是我的规划思路……（没有 JSON）',
      JSON.stringify(oneBedroomIntent),
    ])
    const result = await buildLayoutPlan(
      { briefSummary: '一居室 55㎡', targets: { totalAreaSqm: 55 } },
      complete,
    )
    expect(result.ok).toBe(true)
    expect(result.modelCalls ?? 0).toBe(2)
    // Round 2 saw a correction prompt naming the parse failure.
    const round2 = seen[1]!
    const lastUser = [...round2].reverse().find(message => message.role === 'user')
    expect(String(lastUser?.content)).toContain('找不到 JSON 对象')
  })

  test('missing required rooms is a validator fatal fed back into the correction prompt', async () => {
    const withoutBathroom = {
      ...oneBedroomIntent,
      rooms: oneBedroomIntent.rooms.filter(room => room.type !== 'bathroom'),
    }
    const { complete, seen } = scriptedModel([
      JSON.stringify(withoutBathroom),
      JSON.stringify(oneBedroomIntent),
    ])
    const result = await buildLayoutPlan(
      {
        briefSummary: '一居室 55㎡ 带独立卫生间',
        targets: { totalAreaSqm: 55, requiredRooms: [{ type: 'bathroom', count: 1 }] },
      },
      complete,
    )
    expect(result.ok).toBe(true)
    expect(result.modelCalls).toBe(2)
    const round2 = seen[1]!
    const lastUser = [...round2].reverse().find(message => message.role === 'user')
    expect(String(lastUser?.content)).toMatch(/bathroom|卫生间/)
  })

  test('an unpartitionable intent fails after maxRounds with the partitioner reason, zero scenes involved', async () => {
    const impossible: LayoutIntent = {
      targetTotalAreaSqm: 30,
      rooms: [1, 2, 3, 4].map(n => ({
        id: `bedroom-${n}`,
        name: `卧室${n}`,
        type: 'bedroom' as const,
        targetAreaSqm: 12,
      })),
    }
    const reply = JSON.stringify(impossible)
    const { complete, seen } = scriptedModel([reply, reply, reply])
    const result = await buildLayoutPlan(
      { briefSummary: '30㎡ 四卧', targets: { totalAreaSqm: 30 } },
      complete,
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.modelCalls).toBe(3)
    expect(seen).toHaveLength(3)
    expect(result.failures.join('\n')).toContain('分区器')
  })

  test('honors a custom round limit', async () => {
    const { complete } = scriptedModel(['nonsense', 'still nonsense'])
    const result = await buildLayoutPlan(
      { briefSummary: 'x', targets: {} },
      complete,
      { maxRounds: 2 },
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.modelCalls).toBe(2)
  })
})

describe('buildLayoutPlan (experimental LLM geometry path)', () => {
  test('accepts model-authored geometry that passes the shared validator', async () => {
    // A plan the partitioner itself produced is guaranteed validator-clean —
    // serialize it as if the model had written the polygons.
    const partitioned = partitionLayout(oneBedroomIntent)
    expect(partitioned.ok).toBe(true)
    if (!partitioned.ok) throw new Error('unreachable')
    const { complete } = scriptedModel([JSON.stringify(partitioned.plan)])
    const result = await buildLayoutPlan(
      { briefSummary: '一居室 55㎡', targets: { totalAreaSqm: 55 } },
      complete,
      { llmGeometry: true },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.intent).toBeNull()
    expect(result.plan.rooms.length).toBeGreaterThanOrEqual(4)
  })

  test('rejects overlapping model geometry through the same validator', async () => {
    const overlapping = {
      footprint: { width: 8, depth: 5 },
      entry: { roomId: 'a' },
      rooms: [
        { id: 'a', name: 'A', type: 'living', polygon: [[0, 0], [6, 0], [6, 5], [0, 5]], requiresExteriorWindow: true },
        { id: 'b', name: 'B', type: 'bedroom', polygon: [[4, 0], [8, 0], [8, 5], [4, 5]], requiresExteriorWindow: true },
      ],
      connections: [{ from: 'a', to: 'b', type: 'door' }],
    }
    const reply = JSON.stringify(overlapping)
    const { complete } = scriptedModel([reply, reply, reply])
    const result = await buildLayoutPlan(
      { briefSummary: 'x', targets: {} },
      complete,
      { llmGeometry: true },
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.failures.join('\n')).toContain('重叠')
  })
})

describe('parseLayoutPlanJson', () => {
  test('strips fences and prose around the JSON object', () => {
    const wrapped = '好的，方案如下：\n```json\n' + JSON.stringify({
      footprint: { width: 8, depth: 5 },
      entry: { roomId: 'a' },
      rooms: [
        { id: 'a', name: 'A', type: 'living', polygon: [[0, 0], [8, 0], [8, 5], [0, 5]], requiresExteriorWindow: true },
      ],
      connections: [],
    }) + '\n```\n请确认。'
    const { plan, errors } = parseLayoutPlanJson(wrapped)
    expect(errors).toEqual([])
    expect(plan?.rooms).toHaveLength(1)
  })

  test('reports missing footprint / entry / rooms as errors', () => {
    const { plan, errors } = parseLayoutPlanJson('{"rooms": []}')
    expect(plan).toBeNull()
    expect(errors.length).toBeGreaterThanOrEqual(2)
  })
})
