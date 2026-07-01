import { describe, expect, test } from 'bun:test'
import {
  buildOpeningRepairData,
  evaluateBrief,
  formatSummary,
  mergeBrief,
  publicEditorUrl,
  shouldModifyExistingScene,
  isSceneQuestion,
  classifySceneIntentFallback,
  buildDeterministicSingleRoomPlan,
  normalizeConstructionPlan,
} from './agent'
import type { DesignBrief, RequirementFact } from './types'

const thresholds = { usableConfidence: 0.8, partialConfidence: 0.5 }

function fact(
  key: string,
  label: string,
  value: RequirementFact['value'],
  confidence = 0.95,
): RequirementFact {
  return {
    key,
    label,
    value,
    source: 'user',
    confidence,
    confirmationStatus: 'confirmed',
  }
}

function brief(overrides: Partial<DesignBrief> = {}): DesignBrief {
  return {
    existingCondition: [],
    designGoals: [],
    hardConstraints: [],
    assumptions: [],
    uncertainties: [],
    conflicts: [],
    ...overrides,
  }
}

describe('requirement availability', () => {
  test('is usable when geometry and functional goals are confident', () => {
    const result = evaluateBrief(
      brief({
        existingCondition: [fact('floor_area_sqm', '面积', 85)],
        designGoals: [fact('required_rooms', '必要房间', ['客厅', '主卧', '次卧'])],
      }),
      'text',
      thresholds,
    )

    expect(result.availability).toBe('usable')
    expect(result.questions).toEqual([])
  })

  test('asks only structural questions when critical facts are missing', () => {
    const result = evaluateBrief(brief(), 'text', thresholds)

    expect(result.availability).toBe('partially_usable')
    expect(result.questions).toContain('户型的建筑面积或外部边界尺寸是多少？')
    expect(result.questions).toContain('必须包含哪些房间或功能空间？')
  })

  test('rejects an image with no reliable geometry', () => {
    const result = evaluateBrief(
      brief({
        existingCondition: [
          {
            ...fact('image_quality', '图片质量', '模糊', 0.3),
            source: 'system_recognition',
            confirmationStatus: 'unconfirmed',
          },
        ],
      }),
      'image',
      thresholds,
    )

    expect(result.availability).toBe('unusable')
  })
})

describe('requirement provenance', () => {
  test('merges a corrected fact by stable key and preserves other facts', () => {
    const current = brief({
      existingCondition: [fact('floor_area_sqm', '面积', 80), fact('levels', '层数', 1)],
    })
    const merged = mergeBrief(current, {
      existingCondition: [
        {
          key: 'floor_area_sqm',
          label: '面积',
          value: 85,
          source: 'user',
          confidence: 1,
          confirmationStatus: 'confirmed',
        },
      ],
    })

    expect(merged.existingCondition).toHaveLength(2)
    expect(merged.existingCondition.find(item => item.key === 'floor_area_sqm')?.value).toBe(85)
  })

  test('summary exposes sources and confidence', () => {
    const summary = formatSummary(brief({ existingCondition: [fact('floor_area_sqm', '面积', 85)] }))
    expect(summary).toContain('用户提供')
    expect(summary).toContain('0.95')
  })
})

describe('deterministic opening repair', () => {
  test('clamps horizontal and vertical opening bounds to its wall', () => {
    const repair = buildOpeningRepairData(
      { type: 'window', position: [9, -0.6, 0], width: 1.5, height: 1.2 },
      { type: 'wall', start: [0, 0], end: [4, 0], height: 2.5 },
    )

    expect(repair).toEqual({ position: [3.25, 0.6, 0], width: 1.5, height: 1.2 })
  })

  test('shrinks an opening that is larger than its host wall', () => {
    const repair = buildOpeningRepairData(
      { type: 'door', position: [0, 0, 0], width: 3, height: 4 },
      { type: 'wall', start: [0, 0], end: [2, 0], height: 2.5 },
    )

    expect(repair).toEqual({ position: [0.99, 1.24, 0], width: 1.98, height: 2.48 })
  })
})

test('generated scene links use the standalone editor route', () => {
  expect(publicEditorUrl('scene 1')).toBe('/scene/scene%201')
  expect(publicEditorUrl(null)).toBeNull()
})

test('non-empty projects use incremental MCP modification', () => {
  expect(shouldModifyExistingScene(5)).toBe(true)
  expect(shouldModifyExistingScene(0)).toBe(false)
})

test('scene follow-up questions stay read-only', () => {
  expect(isSceneQuestion('现在好像有个墙是8米的？')).toBe(true)
  expect(isSceneQuestion('把这面墙改成5米')).toBe(false)
})

test('existing scene requests are routed by CRUD intent', () => {
  expect(classifySceneIntentFallback('查看客厅这面墙多长')).toBe('query')
  expect(classifySceneIntentFallback('在南墙添加一扇窗')).toBe('create')
  expect(classifySceneIntentFallback('把这面墙改成4米')).toBe('update')
  expect(classifySceneIntentFallback('删除客厅东侧的窗户')).toBe('delete')
  expect(classifySceneIntentFallback('客厅东边的窗户')).toBe('ambiguous')
})

test('builds an authoritative construction plan for an exact single room', () => {
  const plan = buildDeterministicSingleRoomPlan(brief({
    existingCondition: [
      fact('room_width_m', '宽度', 4),
      fact('room_length_m', '长度', 5),
    ],
    designGoals: [fact('required_rooms', '必要房间', ['卧室'])],
  }))
  expect(plan?.footprint).toEqual({
    widthM: 4,
    depthM: 5,
    polygon: [[-2, -2.5], [2, -2.5], [2, 2.5], [-2, 2.5]],
  })
  expect(plan?.rooms[0]?.type).toBe('bedroom')
})

test('rejects overlapping rooms in a generated construction plan', () => {
  expect(() => normalizeConstructionPlan({
    footprint: { widthM: 6, depthM: 4, polygon: [[-3, -2], [3, -2], [3, 2], [-3, 2]] },
    rooms: [
      { name: 'A', type: 'bedroom', polygon: [[-3, -2], [1, -2], [1, 2], [-3, 2]], furniture: [] },
      { name: 'B', type: 'living', polygon: [[0, -2], [3, -2], [3, 2], [0, 2]], furniture: [] },
    ],
    openings: [],
  })).toThrow('overlapping rooms')
})
