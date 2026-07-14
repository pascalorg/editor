import { describe, expect, test } from 'bun:test'
import {
  canConfirmFromPhase,
  checkBedroomCount,
  checkForbiddenRoomTypes,
  checkRequiredRoomTypes,
  classifyFailure,
  classifyFurnitureIssues,
  dependencySceneKey,
  determineSuccess,
  findCorpusLevelProblems,
  resolveDependencySceneId,
  countZonesOfType,
  validateCaseStructure,
  zoneNameMatchesType,
  type EvalCase,
} from './evaluate-run'
import type { SceneResult } from '../src/types'

function sceneResult(overrides: Partial<SceneResult> = {}): SceneResult {
  return {
    sceneId: 'scene-1',
    editorUrl: '/scene/scene-1',
    version: 1,
    validation: { valid: true, errors: [] },
    verificationIssues: [],
    collisions: [],
    doorlessRooms: [],
    strayWindows: [],
    requirementMismatches: [],
    isolatedBedrooms: [],
    furnitureIssues: [],
    repairRounds: 0,
    remainingIssueCount: 0,
    ...overrides,
  }
}

describe('dry-run validation of assertion config', () => {
  const base: EvalCase = {
    id: 'c',
    category: 'x',
    difficulty: 'easy',
    turns: [{ role: 'user', message: '70平米两室一厅' }, { action: 'confirm' }],
  }
  const ids = new Set(['c', 'case-03-two-bed-standard'])

  test('valid assertion config produces no problems', () => {
    const problems = validateCaseStructure(
      {
        ...base,
        expectedRoomCounts: { 卧室: 2, 客厅: 1 },
        totalArea: { target: 70, tolerance: 0.1 },
        windowsRequiredFor: ['卧室'],
        requiredAdjacency: [{ a: '卧室', b: '卫生间', relation: 'ensuite' }],
        expectedBounds: { width: 5, depth: 18, tolerance: 0.1 },
      },
      ids,
    )
    expect(problems).toEqual([])
  })

  test('flags unknown room type, bad tolerance and bad relation', () => {
    const problems = validateCaseStructure(
      {
        ...base,
        expectedRoomCounts: { 地下室: 1 },
        totalArea: { target: 70, tolerance: 2 },
        requiredAdjacency: [{ a: '卧室', b: '卫生间', relation: 'nextto' as 'ensuite' }],
      },
      ids,
    )
    expect(problems.some(p => p.includes('expectedRoomCounts'))).toBe(true)
    expect(problems.some(p => p.includes('tolerance'))).toBe(true)
    expect(problems.some(p => p.includes('relation'))).toBe(true)
  })

  test('flags modificationChecks without basedOn', () => {
    const problems = validateCaseStructure(
      { ...base, modificationChecks: { addedRoomType: '书房' } },
      ids,
    )
    expect(problems.some(p => p.includes('modificationChecks'))).toBe(true)
  })

  test('flags an invalid added-room area range', () => {
    const problems = validateCaseStructure(
      {
        ...base,
        basedOn: 'case-03-two-bed-standard',
        modificationChecks: { addedRoomArea: { type: '书房', min: 8, max: 6 } },
      },
      ids,
    )
    expect(problems.some(p => p.includes('addedRoomArea'))).toBe(true)
  })

  test('flags an invalid target-room area range', () => {
    const problems = validateCaseStructure(
      {
        ...base,
        basedOn: 'case-03-two-bed-standard',
        modificationChecks: { targetRoomArea: { type: '卧室', min: 16, max: 12 } },
      },
      ids,
    )
    expect(problems.some(p => p.includes('targetRoomArea'))).toBe(true)
  })
})

describe('classifyFailure', () => {
  test('completed runs are not classified as failures', () => {
    expect(classifyFailure('completed', '户型已生成并通过自动检查。')).toBeUndefined()
    expect(classifyFailure('completed_with_issues', 'x')).toBeUndefined()
  })

  test('structure-phase non-convergence gets its own code instead of unknown (case-04 regression)', () => {
    const result = classifyFailure(
      'failed',
      '户型生成失败：结构建造阶段在 2 轮尝试后仍未收敛完成。已确认的结构化需求仍然保留，可以稍后重试。',
    )
    expect(result).toMatchObject({ stage: 'generation', code: 'structure_not_converged' })
  })

  test('plan-first rejection (zero scenes created) gets its own code', () => {
    const result = classifyFailure(
      'failed',
      '户型规划未通过校验（已尝试 3 轮）：\n- 分区器无法排布该意图：面积不足\n已确认的需求仍然保留，可以补充或调整需求后重试。',
    )
    expect(result).toMatchObject({ stage: 'generation', code: 'plan_rejected' })
  })

  test('rate-limited requirement extraction is model_rate_limit, not clarification', () => {
    const result = classifyFailure('failed', '需求解析失败：Model API failed after 5 attempt(s): 429 Too Many Requests。你可以重试')
    expect(result).toMatchObject({ stage: 'requirement_extraction', code: 'model_rate_limit' })
  })

  test('http 500 during extraction is model_http_error', () => {
    const result = classifyFailure('failed', '需求解析失败：Model API failed after 5 attempt(s): 500 Internal Server Error')
    expect(result).toMatchObject({ stage: 'requirement_extraction', code: 'model_http_error' })
  })

  test('invalid JSON is invalid_model_json', () => {
    const result = classifyFailure('failed', '需求解析失败：Unexpected end of JSON input')
    expect(result?.code).toBe('invalid_model_json')
  })

  test('mcp failure during generation is mcp_error', () => {
    const result = classifyFailure('failed', '户型生成失败：MCP tool create_house_from_brief failed: boom')
    expect(result).toMatchObject({ stage: 'generation', code: 'mcp_error' })
  })

  test('still clarifying is clarification_incomplete', () => {
    const result = classifyFailure('clarifying', '还需要确认以下关键条件：1. 面积是多少？')
    expect(result).toMatchObject({ stage: 'confirmation', code: 'clarification_incomplete' })
  })
})

describe('classifyFurnitureIssues', () => {
  test('furnish-time skips are unplaced (not "overlaps"), current-state kinds bucket separately', () => {
    const result = classifyFurnitureIssues(
      [
        'coffee-table: overlaps another item', // legacy skip string = never placed
        '未能放置 fridge（预定位置与已有家具冲突）',
        'bathroom-sink: outside room bounds', // legacy skip string = never placed
        '目录中找不到 "x"，已用占位方块代替',
      ],
      [
        { kind: 'overlap' },
        { kind: 'door_clearance' },
        { kind: 'out_of_bounds' },
      ],
    )
    expect(result).toEqual({
      total: 7,
      unplacedCount: 3,
      overlapCount: 1,
      outOfBoundsCount: 1,
      doorClearanceCount: 1,
      otherCount: 1,
    })
  })

  test('empty inputs are all zeros', () => {
    expect(classifyFurnitureIssues([])).toEqual({
      total: 0,
      unplacedCount: 0,
      overlapCount: 0,
      outOfBoundsCount: 0,
      doorClearanceCount: 0,
      otherCount: 0,
    })
  })
})

describe('determineSuccess', () => {
  test('completed with a real sceneId is success', () => {
    expect(determineSuccess('completed', sceneResult())).toEqual({ ok: true })
  })

  test('completed_with_issues with a real sceneId still counts as success', () => {
    expect(determineSuccess('completed_with_issues', sceneResult())).toEqual({ ok: true })
  })

  test('clarifying is not success, even though phase !== "failed"', () => {
    const result = determineSuccess('clarifying', undefined)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('未到达完成状态')
  })

  test('awaiting_confirmation is not success', () => {
    expect(determineSuccess('awaiting_confirmation', undefined).ok).toBe(false)
  })

  test('cancelled is not success', () => {
    expect(determineSuccess('cancelled', undefined).ok).toBe(false)
  })

  test('completed phase without a sceneResult.sceneId is not success', () => {
    const result = determineSuccess('completed', sceneResult({ sceneId: null }))
    expect(result.ok).toBe(false)
    expect(result.error).toContain('sceneResult.sceneId')
  })

  test('completed phase with no sceneResult at all is not success', () => {
    expect(determineSuccess('completed', undefined).ok).toBe(false)
  })
})

describe('checkBedroomCount', () => {
  test('actual bedroom-name count matching expected is ok', () => {
    expect(checkBedroomCount(['卧室1', '卧室2', '客厅', '厨房'], 2)).toEqual({ ok: true, expected: 2, actual: 2 })
  })

  test('actual count below expected is flagged, independent of any agent self-diagnostic', () => {
    // Deliberately does NOT go through sceneResult.requirementMismatches —
    // this counts real zone names directly, so it still catches the case
    // where the model mis-extracted the requirement and thinks it succeeded.
    expect(checkBedroomCount(['卧室1', '客厅'], 2)).toEqual({ ok: false, expected: 2, actual: 1 })
  })

  test('actual count above expected is also flagged, not just below', () => {
    expect(checkBedroomCount(['卧室1', '卧室2', '卧室3'], 2)).toEqual({ ok: false, expected: 2, actual: 3 })
  })

  test('missing zoneNames must not default to true — reported as actual: null', () => {
    expect(checkBedroomCount(undefined, 2)).toEqual({ ok: false, expected: 2, actual: null })
  })
})

describe('required/forbidden room type checks', () => {
  test('required room type present is not flagged', () => {
    // ROOM_TYPE_PATTERNS.卧室 matches the literal substring "卧室" (same
    // pattern already used by compareRoomsToRequirements in agent.ts) — a
    // zone named "主卧" alone (no "室") would NOT match, which is a known,
    // pre-existing characteristic of that pattern, not something this test
    // is meant to probe. Use realistic "卧室N" names to match convention.
    const result = checkRequiredRoomTypes(['卧室', '客厅'], ['卧室1', '客厅'])
    expect(result.flagged).toEqual([])
    expect(result.configErrors).toEqual([])
  })

  test('required room type missing is flagged', () => {
    const result = checkRequiredRoomTypes(['卧室', '厨房'], ['卧室1'])
    expect(result.flagged).toEqual(['厨房'])
  })

  test('forbidden room type present is flagged (the Blocker1 regression guard)', () => {
    const result = checkForbiddenRoomTypes(['厨房', '客厅'], ['卧室1', '卧室2', '厨房'])
    expect(result.flagged).toEqual(['厨房'])
  })

  test('forbidden room type absent is not flagged', () => {
    const result = checkForbiddenRoomTypes(['厨房', '客厅', '卫生间'], ['卧室1', '卧室2'])
    expect(result.flagged).toEqual([])
  })

  test('an unknown room type pattern is a config error, not a silent skip', () => {
    const required = checkRequiredRoomTypes(['阳台'], ['客厅'])
    expect(required.flagged).toEqual([])
    expect(required.configErrors).toEqual([
      '未知房间类型模式 "阳台"（不在 ROOM_TYPE_PATTERNS 里）——检查用例配置是否写错，不能静默跳过',
    ])

    const forbidden = checkForbiddenRoomTypes(['阳台'], ['客厅'])
    expect(forbidden.configErrors.length).toBe(1)
  })
})

describe('canConfirmFromPhase', () => {
  test('awaiting_confirmation allows confirm', () => {
    expect(canConfirmFromPhase('awaiting_confirmation')).toBe(true)
  })

  test('awaiting_modification_confirmation allows confirm', () => {
    expect(canConfirmFromPhase('awaiting_modification_confirmation')).toBe(true)
  })

  test('clarifying does not allow confirm', () => {
    expect(canConfirmFromPhase('clarifying')).toBe(false)
  })

  test('undefined phase does not allow confirm', () => {
    expect(canConfirmFromPhase(undefined)).toBe(false)
  })
})

describe('repeat/dependency scene pairing', () => {
  test('a dependent case run N resolves to the base case\'s run N scene, not any other run', () => {
    const map = new Map<string, string>()
    map.set(dependencySceneKey('case-03', 1), 'scene-run1')
    map.set(dependencySceneKey('case-03', 2), 'scene-run2')
    map.set(dependencySceneKey('case-03', 3), 'scene-run3')

    expect(resolveDependencySceneId(map, 'case-03', 2)).toBe('scene-run2')
  })

  test('a missing repeat index resolves to undefined — no fallback to another run', () => {
    const map = new Map<string, string>()
    map.set(dependencySceneKey('case-03', 1), 'scene-run1')
    // run 2 of case-03 failed and was never recorded.

    expect(resolveDependencySceneId(map, 'case-03', 2)).toBeUndefined()
  })
})

describe('validateCaseStructure (dry-run)', () => {
  const baseCase: EvalCase = {
    id: 'case-x',
    category: 'test',
    difficulty: 'easy',
    turns: [
      { role: 'user', message: '两室一厅，总面积约70平米' },
      { action: 'confirm' },
    ],
  }

  test('a well-formed case with an area signal has no problems', () => {
    expect(validateCaseStructure(baseCase, new Set(['case-x']))).toEqual([])
  })

  test('missing area/dimension signal is flagged for a non-basedOn case', () => {
    const problems = validateCaseStructure(
      { ...baseCase, turns: [{ role: 'user', message: '两室一厅' }, { action: 'confirm' }] },
      new Set(['case-x']),
    )
    expect(problems.some(p => p.includes('面积/尺寸信号'))).toBe(true)
  })

  test('basedOn referencing an unknown case id is flagged', () => {
    const problems = validateCaseStructure({ ...baseCase, basedOn: 'case-nonexistent' }, new Set(['case-x']))
    expect(problems.some(p => p.includes('basedOn'))).toBe(true)
  })

  test('missing confirm turn is flagged', () => {
    const problems = validateCaseStructure(
      { ...baseCase, turns: [{ role: 'user', message: '两室一厅，总面积约70平米' }] },
      new Set(['case-x']),
    )
    expect(problems.some(p => p.includes('confirm'))).toBe(true)
  })

  test('an unknown room type in expectedFacts/forbiddenRoomTypes is flagged', () => {
    const problems = validateCaseStructure(
      { ...baseCase, forbiddenRoomTypes: ['阳台'] },
      new Set(['case-x']),
    )
    expect(problems.some(p => p.includes('阳台'))).toBe(true)
  })
})

describe('findCorpusLevelProblems', () => {
  const base: EvalCase = {
    id: 'case-a',
    category: 'test',
    difficulty: 'easy',
    turns: [{ role: 'user', message: '两室一厅，总面积约70平米' }, { action: 'confirm' }],
  }

  test('a well-formed corpus has no problems', () => {
    const cases: EvalCase[] = [
      { ...base, id: 'case-a' },
      { ...base, id: 'case-b', basedOn: 'case-a' },
    ]
    expect(findCorpusLevelProblems(cases)).toEqual([])
  })

  test('duplicate case ids are flagged', () => {
    const cases: EvalCase[] = [{ ...base, id: 'case-a' }, { ...base, id: 'case-a' }]
    const problems = findCorpusLevelProblems(cases)
    expect(problems.some(p => p.includes('重复的用例 id') && p.includes('case-a'))).toBe(true)
  })

  test('a case whose basedOn points at itself is flagged', () => {
    const cases: EvalCase[] = [{ ...base, id: 'case-a', basedOn: 'case-a' }]
    const problems = findCorpusLevelProblems(cases)
    expect(problems.some(p => p.includes('指向了自己'))).toBe(true)
  })

  test('a basedOn dependency cycle is flagged', () => {
    const cases: EvalCase[] = [
      { ...base, id: 'case-a', basedOn: 'case-b' },
      { ...base, id: 'case-b', basedOn: 'case-a' },
    ]
    const problems = findCorpusLevelProblems(cases)
    expect(problems.some(p => p.includes('依赖链里存在环'))).toBe(true)
  })

  test('a long acyclic basedOn chain is not flagged', () => {
    const cases: EvalCase[] = [
      { ...base, id: 'case-a' },
      { ...base, id: 'case-b', basedOn: 'case-a' },
      { ...base, id: 'case-c', basedOn: 'case-b' },
    ]
    expect(findCorpusLevelProblems(cases)).toEqual([])
  })
})

describe('zoneNameMatchesType（2026-07-14 全量复盘修正）', () => {
  test('衣帽间不再计为卧室（case-11 根因）', () => {
    expect(zoneNameMatchesType('卧室', '主卧步入式衣帽间')).toBe(false)
    expect(zoneNameMatchesType('卧室', '次卧一步入式衣帽间')).toBe(false)
    expect(zoneNameMatchesType('卧室', '主卧')).toBe(true)
    expect(zoneNameMatchesType('卧室', '客卧')).toBe(true)
  })

  test('主卧卫生间是卫生间不是卧室', () => {
    expect(zoneNameMatchesType('卧室', '主卧卫生间')).toBe(false)
    expect(zoneNameMatchesType('卫生间', '主卧卫生间')).toBe(true)
  })

  test('合并客餐厨同时满足客厅/厨房（case-08/11 根因）', () => {
    for (const name of ['客餐厨', '客餐厨一体空间', '客厅+开放式厨房', '客厅与开放式厨房']) {
      expect(zoneNameMatchesType('客厅', name)).toBe(true)
      expect(zoneNameMatchesType('厨房', name)).toBe(true)
      expect(zoneNameMatchesType('卧室', name)).toBe(false)
    }
    // 餐厅只在名字确实含 D（餐/LDK）时由合并空间承担——否则独立餐厅会被
    // 数成第二间（case-11）。
    expect(zoneNameMatchesType('餐厅', '客餐厨')).toBe(true)
    expect(zoneNameMatchesType('餐厅', 'LDK')).toBe(true)
    expect(zoneNameMatchesType('餐厅', '客厅与开放式厨房')).toBe(false)
  })

  test('客厅兼餐厅：客厅直接命中，餐厅走名字兜底（2026-07-14 复盘）', () => {
    expect(zoneNameMatchesType('客厅', '客厅兼餐厅')).toBe(true)
    expect(zoneNameMatchesType('餐厅', '客厅兼餐厅')).toBe(true)
    expect(zoneNameMatchesType('厨房', '客厅兼餐厅')).toBe(false)
    // 纯客厅名不带餐字样，不冒充餐厅。
    expect(zoneNameMatchesType('餐厅', '客厅')).toBe(false)
  })

  test('checkBedroomCount 用同一套匹配', () => {
    const check = checkBedroomCount(['主卧', '次卧', '主卧步入式衣帽间', '客餐厨'], 2)
    expect(check.ok).toBe(true)
    expect(check.actual).toBe(2)
  })
})

describe('countZonesOfType：merged 只作缺位兜底，不与独立房间叠加', () => {
  test('LDK 之外又建独立餐厅时餐厅数=1', () => {
    expect(countZonesOfType('餐厅', ['餐厅', '客餐厨一体空间', '主卧'])).toBe(1)
    expect(countZonesOfType('厨房', ['厨房', '客餐厨一体空间'])).toBe(1)
  })
  test('只有 merged 时由它充当', () => {
    expect(countZonesOfType('客厅', ['客餐厨一体空间', '主卧'])).toBe(1)
    expect(countZonesOfType('餐厅', ['客餐厨一体空间'])).toBe(1)
    expect(countZonesOfType('餐厅', ['客厅与开放式厨房'])).toBe(0)
  })
  test('客厅兼餐厅：客厅计 1，餐厅缺位时兜底、有独立餐厅时不叠加', () => {
    expect(countZonesOfType('客厅', ['客厅兼餐厅', '主卧'])).toBe(1)
    expect(countZonesOfType('餐厅', ['客厅兼餐厅', '主卧'])).toBe(1)
    expect(countZonesOfType('餐厅', ['客厅兼餐厅', '餐厅'])).toBe(1)
  })
})
