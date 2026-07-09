import { describe, expect, test } from 'bun:test'
import {
  buildOpeningRepairData,
  describeRemainingIssues,
  formatUserFacingSummary,
  buildPlanTargets,
  formatPlanSnapshot,
  checkAreaRequirements,
  checkFurniturePlacement,
  checkModificationProtection,
  computeZoneAreaStats,
  evaluateBrief,
  extractAreaRangeConstraint,
  findIsolatedBedrooms,
  requestsStructurePreservation,
  formatSummary,
  mergeBrief,
  modifyFailureRecovery,
  planIngestAction,
  publicEditorUrl,
  shouldModifyExistingScene,
  shouldRouteAsExistingSceneRequest,
  structuralDrift,
  windowRoomTypesFromBrief,
  isSceneQuestion,
  classifySceneIntentFallback,
  type ItemSummary,
  type WallWithOpenings,
  type ZoneSummary,
} from './agent'
import type { ChatInput, DesignBrief, RequirementFact, WorkflowSession } from './types'

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

function zone(id: string, name: string, polygon: Array<[number, number]>): ZoneSummary {
  return { id, name, polygon }
}

function doorWall(id: string, start: [number, number], end: [number, number]): WallWithOpenings {
  return { id, start, end, openings: [{ type: 'door' }] }
}

describe('circulation: findIsolatedBedrooms', () => {
  test('bedroom directly connecting to a hallway/living room passes', () => {
    const zones = [
      zone('bed', '卧室', [[0, 0], [4, 0], [4, 3], [0, 3]]),
      zone('hall', '走廊', [[4, 0], [8, 0], [8, 3], [4, 3]]),
    ]
    const walls = [doorWall('w1', [4, 0], [4, 3])]
    expect(findIsolatedBedrooms(zones, walls)).toEqual([])
  })

  test('single-room dwelling: the bedroom with the entry door on an exterior wall is not isolated', () => {
    // Plan-first single-room builds (case-01) produce exactly this shape:
    // one bedroom zone, one door, and that door opens straight outside.
    const zones = [zone('bed', '单人卧室', [[0, 0], [4, 0], [4, 3], [0, 3]])]
    const walls = [doorWall('w1', [0, 0], [4, 0])]
    expect(findIsolatedBedrooms(zones, walls)).toEqual([])
  })

  test('an interior door that reaches no public room still flags the bedroom', () => {
    const zones = [
      zone('bed', '卧室', [[0, 0], [4, 0], [4, 3], [0, 3]]),
      zone('kit', '厨房', [[4, 0], [8, 0], [8, 3], [4, 3]]),
    ]
    // Door on the interior shared wall only — not on the building boundary.
    const walls = [doorWall('w1', [4, 0.5], [4, 2.5])]
    expect(findIsolatedBedrooms(zones, walls)).toEqual(['卧室'])
  })

  test('bedroom whose only door leads to the kitchen is flagged', () => {
    const zones = [
      zone('bed', '卧室', [[0, 0], [4, 0], [4, 3], [0, 3]]),
      zone('kit', '厨房', [[4, 0], [8, 0], [8, 3], [4, 3]]),
    ]
    const walls = [doorWall('w1', [4, 0], [4, 3])]
    expect(findIsolatedBedrooms(zones, walls)).toEqual(['卧室'])
  })

  test('bedroom whose only door leads to another bedroom is flagged, even if that bedroom reaches circulation', () => {
    const zones = [
      zone('bedA', '卧室A', [[0, 0], [4, 0], [4, 3], [0, 3]]),
      zone('bedB', '卧室B', [[4, 0], [8, 0], [8, 3], [4, 3]]),
      zone('living', '客厅', [[8, 0], [12, 0], [12, 3], [8, 3]]),
    ]
    const walls = [doorWall('w1', [4, 0], [4, 3]), doorWall('w2', [8, 0], [8, 3])]
    // 卧室A can only reach 客厅 by transiting *through* 卧室B, which the rule
    // forbids — it must be flagged even though 卧室B itself is fine (it
    // reaches 客厅 directly, one hop, no bedroom in between).
    expect(findIsolatedBedrooms(zones, walls)).toEqual(['卧室A'])
  })

  test('a combined living/open-kitchen zone counts as circulation, not a blocked kitchen', () => {
    // Regression for case-02: the studio's public zone was named
    // "客厅/开放式厨房" and the 厨房 substring made the classifier treat it as
    // blocked-service, flagging the bedroom as isolated forever.
    const zones = [
      zone('bed', '卧室', [[0, 0], [4, 0], [4, 3], [0, 3]]),
      zone('livkit', '客厅/开放式厨房', [[4, 0], [8, 0], [8, 3], [4, 3]]),
    ]
    const walls = [doorWall('w1', [4, 0], [4, 3])]
    expect(findIsolatedBedrooms(zones, walls)).toEqual([])
  })

  test('a pure kitchen zone still blocks circulation', () => {
    const zones = [
      zone('bed', '卧室', [[0, 0], [4, 0], [4, 3], [0, 3]]),
      zone('kit', 'Kitchen', [[4, 0], [8, 0], [8, 3], [4, 3]]),
    ]
    const walls = [doorWall('w1', [4, 0], [4, 3])]
    expect(findIsolatedBedrooms(zones, walls)).toEqual(['卧室'])
  })

  test('bedroom reaching a walk-in closet counts as satisfied under the current rule (documented limitation)', () => {
    // classifyCirculationRoomKind only special-cases bedroom/kitchen/
    // bathroom; anything else (walk-in closets, dining, storage, ...) is
    // 'passable', so reaching one at all — even a closet with no further
    // connection onward — already satisfies the check. This locks in that
    // known tradeoff (same class as findStrayWindows' L-shape limitation)
    // rather than leaving it as an undocumented surprise.
    const zones = [
      zone('bed', '卧室', [[0, 0], [4, 0], [4, 3], [0, 3]]),
      zone('closet', '衣帽间', [[4, 0], [6, 0], [6, 3], [4, 3]]),
    ]
    const walls = [doorWall('w1', [4, 0], [4, 3])]
    expect(findIsolatedBedrooms(zones, walls)).toEqual([])
  })
})

describe('deterministic area acceptance', () => {
  const areaBrief = (target: number) =>
    brief({ existingCondition: [fact('floor_area_sqm', '面积', target)] })

  test('non-overlapping rooms: union equals sum, no overlap pairs', () => {
    const zones = [
      zone('a', '客厅', [[0, 0], [5, 0], [5, 4], [0, 4]]),
      zone('b', '卧室', [[5, 0], [10, 0], [10, 4], [5, 4]]),
    ]
    const stats = computeZoneAreaStats(zones)
    expect(stats.sumArea).toBeCloseTo(40)
    expect(stats.unionArea).toBeCloseTo(40)
    expect(stats.overlapArea).toBeCloseTo(0)
    expect(stats.overlappingPairs).toEqual([])
  })

  test('overlapping rooms are detected and union does not double-count', () => {
    const zones = [
      zone('a', '客厅', [[0, 0], [6, 0], [6, 4], [0, 4]]),
      zone('b', '卧室', [[4, 0], [10, 0], [10, 4], [4, 4]]),
    ]
    const stats = computeZoneAreaStats(zones)
    expect(stats.sumArea).toBeCloseTo(48)
    expect(stats.unionArea).toBeCloseTo(40)
    expect(stats.overlapArea).toBeCloseTo(8)
    expect(stats.overlappingPairs).toHaveLength(1)
    expect(stats.overlappingPairs[0]?.areaSqMeters).toBeCloseTo(8)
  })

  test('an L-shaped room is measured correctly', () => {
    const zones = [zone('a', '客厅', [[0, 0], [6, 0], [6, 2], [2, 2], [2, 6], [0, 6]])]
    const stats = computeZoneAreaStats(zones)
    expect(stats.sumArea).toBeCloseTo(20)
    expect(stats.unionArea).toBeCloseTo(20)
  })

  test('total area within ±10% of the brief target passes', () => {
    const zones = [zone('a', '客厅', [[0, 0], [10, 0], [10, 7], [0, 7]])]
    expect(checkAreaRequirements(zones, areaBrief(70))).toEqual([])
  })

  test('total area 50% over the target is flagged with repair guidance (case-03 regression)', () => {
    const zones = [zone('a', '客厅', [[0, 0], [15, 0], [15, 7], [0, 7]])]
    const issues = checkAreaRequirements(zones, areaBrief(70))
    expect(issues).toHaveLength(1)
    expect(issues[0]!.message).toContain('总面积不符')
    expect(issues[0]!.message).toContain('105')
    expect(issues[0]!.message).toContain('整体调整建筑外轮廓')
    expect(issues[0]!.l10n.id).toBe('totalAreaOff')
  })

  test('room-boundary intrusion is flagged even when total area is on target', () => {
    const zones = [
      zone('a', '客厅', [[0, 0], [6, 0], [6, 7], [0, 7]]),
      zone('b', '卧室', [[5, 0], [10, 0], [10, 7], [5, 7]]),
    ]
    const issues = checkAreaRequirements(zones, areaBrief(70))
    expect(issues.some(issue => issue.message.includes('重叠'))).toBe(true)
  })

  test('no area target in the brief means no area assertion', () => {
    const zones = [zone('a', '客厅', [[0, 0], [20, 0], [20, 7], [0, 7]])]
    expect(checkAreaRequirements(zones, brief())).toEqual([])
  })
})

describe('current-state furniture placement check', () => {
  const room = zone('liv', '客厅', [[0, 0], [6, 0], [6, 4], [0, 4]])
  const item = (id: string, x: number, z: number, w = 1, d = 1, ry = 0): ItemSummary => ({
    id,
    name: id,
    position: [x, 0, z],
    rotation: [0, ry, 0],
    asset: { dimensions: [w, 1, d] },
  })

  test('well-separated items inside the room pass', () => {
    const items = [item('sofa', 1.5, 2, 2, 0.9), item('table', 4.5, 2, 1, 1)]
    expect(checkFurniturePlacement([room], [], items)).toEqual([])
  })

  test('two overlapping items are flagged as an actual overlap', () => {
    const items = [item('sofa', 2, 2, 2, 0.9), item('table', 2.5, 2, 1, 1)]
    const issues = checkFurniturePlacement([room], [], items)
    expect(issues.some(i => i.kind === 'overlap')).toBe(true)
  })

  test('rotation is honored: a rotated long item can poke out of the room', () => {
    // 2.4m-long item near the bottom wall: fits when aligned along x, pokes
    // through the wall once rotated 90° — check_collisions would miss this.
    const aligned = [item('bed', 3, 0.7, 2.4, 1.2)]
    expect(checkFurniturePlacement([room], [], aligned)).toEqual([])
    const rotated = [item('bed', 3, 0.7, 2.4, 1.2, Math.PI / 2)]
    const issues = checkFurniturePlacement([room], [], rotated)
    expect(issues.some(i => i.kind === 'out_of_bounds')).toBe(true)
  })

  test('an item centered outside every room is flagged', () => {
    const issues = checkFurniturePlacement([room], [], [item('plant', 10, 10)])
    expect(issues.some(i => i.kind === 'out_of_bounds' && i.message.includes('不在任何房间'))).toBe(true)
  })

  test('an item parked in front of a door violates door clearance', () => {
    const doorWall: WallWithOpenings = {
      id: 'w-door',
      start: [0, 0],
      end: [6, 0],
      openings: [{ type: 'door', position: [3, 1.05, 0], width: 0.9 } as unknown as { type: string }],
    }
    const blocking = [item('cabinet', 3, 0.5, 1, 0.6)]
    const issues = checkFurniturePlacement([room], [doorWall], blocking)
    expect(issues.some(i => i.kind === 'door_clearance')).toBe(true)
    const clear = [item('cabinet', 5.2, 0.5, 1, 0.6)]
    expect(checkFurniturePlacement([room], [doorWall], clear).some(i => i.kind === 'door_clearance')).toBe(false)
  })

  test('wall-mounted items are exempt from floor checks', () => {
    const wallArt: ItemSummary = {
      id: 'art',
      position: [10, 1.5, 10],
      asset: { dimensions: [1, 1, 0.05], attachTo: 'wall' },
    }
    expect(checkFurniturePlacement([room], [], [wallArt])).toEqual([])
  })
})

describe('modification protection', () => {
  const case13Request =
    '保持建筑外轮廓和其他房间不变，在客厅内部靠右侧划分一个约 6–8㎡的独立书房，为书房增加一扇通往客厅的门。除必要的新隔墙和房门外，不修改其他墙体、门窗。'

  test('preservation language detection', () => {
    expect(requestsStructurePreservation(case13Request)).toBe(true)
    expect(requestsStructurePreservation('把主卧扩大一些，卫生间相应缩小')).toBe(false)
  })

  test('area range extraction handles common dash/unit variants and ambiguity', () => {
    expect(extractAreaRangeConstraint(case13Request)).toEqual({ min: 6, max: 8 })
    expect(extractAreaRangeConstraint('加一个6-8平米的书房')).toEqual({ min: 6, max: 8 })
    expect(extractAreaRangeConstraint('客厅改成 20~25㎡，书房 6–8㎡')).toBeNull() // 两个范围，放弃判定
    expect(extractAreaRangeConstraint('加一个书房')).toBeNull()
  })

  test('flags a deleted original wall and a geometry-modified original wall under preservation', () => {
    const before = {
      w1: { type: 'wall', start: [0, 0], end: [4, 0], thickness: 0.2, height: 2.5 },
      w2: { type: 'wall', start: [4, 0], end: [4, 3], thickness: 0.2, height: 2.5 },
    }
    const after = {
      w1: { type: 'wall', start: [0, 0], end: [3, 0], thickness: 0.2, height: 2.5 }, // clipped
      // w2 deleted
    }
    const issues = checkModificationProtection(before, after, case13Request)
    expect(issues.some(issue => issue.includes('w1') && issue.includes('几何'))).toBe(true)
    expect(issues.some(issue => issue.includes('w2') && issue.includes('删除'))).toBe(true)
  })

  test('a wall that only gained a door child is not a violation', () => {
    const before = {
      w1: { type: 'wall', start: [0, 0], end: [4, 0], thickness: 0.2, height: 2.5, children: [] as string[] },
    }
    const after = {
      w1: { type: 'wall', start: [0, 0], end: [4, 0], thickness: 0.2, height: 2.5, children: ['d1'] },
      d1: { type: 'door', position: [2, 1.05, 0], width: 0.9, height: 2.1, parentId: 'w1' },
    }
    expect(checkModificationProtection(before, after, case13Request)).toEqual([])
  })

  test('a moved original window is a violation under preservation', () => {
    const before = { win1: { type: 'window', position: [1, 1.5, 0], width: 1.5, height: 1.5, parentId: 'w1' } }
    const after = { win1: { type: 'window', position: [2, 1.5, 0], width: 1.5, height: 1.5, parentId: 'w1' } }
    const issues = checkModificationProtection(before, after, case13Request)
    expect(issues.some(issue => issue.includes('win1'))).toBe(true)
  })

  test('an oversized added room is flagged against the requested range (case-13 regression)', () => {
    const before = {}
    const after = {
      study: { type: 'zone', name: '书房', polygon: [[0, 0], [4.4, 0], [4.4, 3], [0, 3]] }, // 13.2㎡
    }
    const issues = checkModificationProtection(before, after, case13Request)
    expect(issues.some(issue => issue.includes('书房') && issue.includes('13.2'))).toBe(true)
  })

  test('an in-range added room passes and resize requests skip structure protection', () => {
    const inRange = {
      study: { type: 'zone', name: '书房', polygon: [[0, 0], [3.5, 0], [3.5, 2], [0, 2]] }, // 7㎡
    }
    expect(checkModificationProtection({}, inRange, case13Request)).toEqual([])
    // No preservation language → moving original walls is allowed.
    const before = { w1: { type: 'wall', start: [0, 0], end: [4, 0] } }
    const after = { w1: { type: 'wall', start: [0, 0], end: [5, 0] } }
    expect(checkModificationProtection(before, after, '把主卧扩大一些')).toEqual([])
  })
})

function session(overrides: Partial<WorkflowSession> = {}): WorkflowSession {
  return {
    sessionId: 's1',
    inputType: 'text',
    phase: 'intake',
    availability: 'partially_usable',
    brief: brief(),
    questions: [],
    reasons: [],
    summary: '',
    messages: [],
    clarificationRounds: 0,
    createdAt: 'now',
    updatedAt: 'now',
    ...overrides,
  }
}

function input(overrides: Partial<ChatInput> = {}): ChatInput {
  return { sessionId: 's1', ...overrides }
}

describe('ingest state machine: planIngestAction', () => {
  test('cancel ends the turn and marks the session cancelled', () => {
    const s = session({ phase: 'clarifying', questions: ['q'] })
    const plan = planIngestAction(input({ action: 'cancel' }), s)
    expect(plan).toEqual({ kind: 'reply', reply: '已取消当前户型设计任务。现有场景没有被修改。' })
    expect(s.phase).toBe('cancelled')
    expect(s.questions).toEqual([])
  })

  test('confirm from awaiting_confirmation routes to generation', () => {
    const s = session({ phase: 'awaiting_confirmation' })
    const plan = planIngestAction(input({ action: 'confirm' }), s)
    expect(plan.kind).toBe('route')
    expect(plan).toMatchObject({ next: 'generate' })
    expect(s.phase).toBe('generating')
  })

  test('confirm from clarifying is the accept-defaults escape hatch', () => {
    const s = session({ phase: 'clarifying' })
    const plan = planIngestAction(input({ action: 'confirm' }), s)
    expect(plan.kind).toBe('route')
    expect(plan).toMatchObject({ next: 'generate' })
    if (plan.kind === 'route') expect(plan.reply).toContain('默认假设')
    expect(s.phase).toBe('generating')
  })

  test('confirm with a pending modification routes to modify', () => {
    const s = session({ phase: 'awaiting_modification_confirmation', pendingModification: '换个方向开门' })
    const plan = planIngestAction(input({ action: 'confirm' }), s)
    expect(plan).toMatchObject({ kind: 'route', next: 'modify' })
    expect(s.phase).toBe('modifying')
  })

  test('confirm when nothing is confirmable is rejected', () => {
    const s = session({ phase: 'intake' })
    const plan = planIngestAction(input({ action: 'confirm' }), s)
    expect(plan.kind).toBe('reply')
    expect(s.phase).toBe('intake')
  })

  test('empty input asks for something to work with', () => {
    const plan = planIngestAction(input({ message: '   ' }), session())
    expect(plan).toEqual({ kind: 'reply', reply: '请输入户型需求，或上传一张户型图。' })
  })

  test('a message on a completed scene is routed as an existing-scene request', () => {
    const s = session({ phase: 'completed' })
    const plan = planIngestAction(input({ message: '在南墙加一扇窗' }), s)
    expect(plan).toEqual({ kind: 'route-existing', message: '在南墙加一扇窗' })
  })

  test('an over-long message is rejected before any work', () => {
    const plan = planIngestAction(input({ message: 'x'.repeat(5001) }), session())
    expect(plan.kind).toBe('reply')
    if (plan.kind === 'reply') expect(plan.reply).toContain('5000')
  })

  test('an unsupported image fails fast', () => {
    const s = session()
    const plan = planIngestAction(input({ imageDataUrl: 'data:image/gif;base64,AAAA' }), s)
    expect(plan.kind).toBe('reply')
    expect(s.phase).toBe('failed')
    expect(s.availability).toBe('unusable')
  })

  test('an ordinary new requirement is delegated to the intake path', () => {
    const plan = planIngestAction(input({ message: '85平米三室两厅' }), session())
    expect(plan).toEqual({ kind: 'intake', message: '85平米三室两厅' })
  })
})

describe('modify-failure recovery', () => {
  test('a pending modification stays retryable via confirm', () => {
    const recovery = modifyFailureRecovery(true, true)
    expect(recovery).toEqual({ canRetry: true, phase: 'awaiting_modification_confirmation' })
  })

  test('no pending modification but a prior scene result falls back to completed_with_issues', () => {
    const recovery = modifyFailureRecovery(false, true)
    expect(recovery).toEqual({ canRetry: false, phase: 'completed_with_issues' })
  })

  test('no pending modification and no scene result is a hard failure', () => {
    const recovery = modifyFailureRecovery(false, false)
    expect(recovery).toEqual({ canRetry: false, phase: 'failed' })
  })

  test('a new plain message while awaiting modification confirmation replaces the stale pending request', () => {
    expect(shouldRouteAsExistingSceneRequest('awaiting_modification_confirmation', '换个方向开门')).toBe(true)
    expect(shouldRouteAsExistingSceneRequest('awaiting_modification_confirmation', '   ')).toBe(false)
    expect(shouldRouteAsExistingSceneRequest('completed', '换个方向开门')).toBe(false)
  })
})

describe('plan-first: buildPlanTargets', () => {
  test('bedroom count comes from the numeric fact', () => {
    const targets = buildPlanTargets(brief({
      designGoals: [fact('bedroom_count', '卧室数量', 3)],
      hardConstraints: [fact('floor_area_sqm', '建筑面积', 90)],
    }))
    expect(targets.totalAreaSqm).toBe(90)
    expect(targets.requiredRooms).toContainEqual({ type: 'bedroom', count: 3 })
  })

  test('presence types are counted from the requested-rooms list', () => {
    const targets = buildPlanTargets(brief({
      designGoals: [fact('rooms', '功能空间', ['客厅', '厨房', '卫生间'])],
    }))
    expect(targets.requiredRooms).toContainEqual({ type: 'kitchen', count: 1 })
    expect(targets.requiredRooms).toContainEqual({ type: 'bathroom', count: 1 })
    expect(targets.requiredRooms).toContainEqual({ type: 'living', count: 1 })
  })

  test('an entry embedding its own quantity suppresses that exact-count requirement', () => {
    const targets = buildPlanTargets(brief({
      designGoals: [fact('rooms', '功能空间', ['两个卫生间', '厨房'])],
    }))
    const types = (targets.requiredRooms ?? []).map(entry => entry.type)
    expect(types).not.toContain('bathroom')
    expect(types).toContain('kitchen')
  })

  test('empty brief produces empty targets', () => {
    expect(buildPlanTargets(brief())).toEqual({})
  })
})

describe('plan-first: formatPlanSnapshot', () => {
  test('lists rooms with type/area, marks the entry, and names connections', () => {
    const snapshot = formatPlanSnapshot({
      footprint: { width: 8, depth: 5 },
      entry: { roomId: 'living-1' },
      rooms: [
        { id: 'living-1', name: '客厅', type: 'living', polygon: [[0, 0], [5, 0], [5, 5], [0, 5]], requiresExteriorWindow: true },
        { id: 'bedroom-1', name: '主卧', type: 'bedroom', polygon: [[5, 0], [8, 0], [8, 5], [5, 5]], requiresExteriorWindow: true },
      ],
      connections: [{ from: 'living-1', to: 'bedroom-1', type: 'door' }],
    })
    expect(snapshot).toContain('客厅（living，约 25㎡，入户）')
    expect(snapshot).toContain('主卧（bedroom，约 15㎡）')
    expect(snapshot).toContain('客厅↔主卧')
    expect(snapshot).toContain('不可改动')
  })
})

describe('批次 D: structuralDrift', () => {
  const wall = (start: [number, number], end: [number, number]) =>
    ({ type: 'wall', start, end, thickness: 0.2 }) as Record<string, unknown>

  test('unchanged structure reports no drift', () => {
    const snapshot = { w1: wall([0, 0], [4, 0]), z1: { type: 'zone', polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] } }
    expect(structuralDrift(snapshot, structuredClone(snapshot))).toEqual([])
  })

  test('moved wall / deleted zone / added wall are all drift', () => {
    const before = { w1: wall([0, 0], [4, 0]), z1: { type: 'zone', polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] } }
    expect(structuralDrift(before, { ...before, w1: wall([0, 0], [5, 0]) })).toHaveLength(1)
    const { z1: _z1, ...withoutZone } = before
    expect(structuralDrift(before, withoutZone)).toHaveLength(1)
    expect(structuralDrift(before, { ...before, w2: wall([0, 3], [4, 3]) })).toHaveLength(1)
  })

  test('item and opening changes are NOT structural drift', () => {
    const before = {
      w1: wall([0, 0], [4, 0]),
      item1: { type: 'item', position: [1, 0, 1] },
    }
    const after = {
      w1: wall([0, 0], [4, 0]),
      item1: { type: 'item', position: [2, 0, 2] },
      door1: { type: 'door', position: [1, 1.05, 0] },
    }
    expect(structuralDrift(before, after)).toEqual([])
  })

  test('sub-millimeter float noise is not drift', () => {
    const before = { w1: wall([0, 0], [4, 0]) }
    const after = { w1: wall([0.0004, 0], [4, 0]) }
    expect(structuralDrift(before, after)).toEqual([])
  })
})

describe('批次 D: windowRoomTypesFromBrief', () => {
  test('explicit window request maps mentioned rooms to types', () => {
    const types = windowRoomTypesFromBrief(brief({
      designGoals: [fact('window_requirements', '采光要求', '三间卧室都要有窗，客厅采光好')],
    }))
    expect(types.sort()).toEqual(['bedroom', 'living'])
  })

  test('no window facts → empty', () => {
    expect(windowRoomTypesFromBrief(brief({
      designGoals: [fact('bedroom_count', '卧室数量', 3)],
    }))).toEqual([])
  })

  test('room mention without window context does not count', () => {
    expect(windowRoomTypesFromBrief(brief({
      designGoals: [fact('rooms', '功能空间', ['卧室', '厨房'])],
    }))).toEqual([])
  })
})

describe('三语兼容：日语输入', () => {
  test('日语房间名的隔绝卧室检查', () => {
    const zones = [
      zone('bed', '寝室', [[0, 0], [4, 0], [4, 3], [0, 3]]),
      zone('hall', '廊下', [[4, 0], [8, 0], [8, 3], [4, 3]]),
    ]
    expect(findIsolatedBedrooms(zones, [doorWall('w1', [4, 0], [4, 3])])).toEqual([])
    // 寝室の唯一のドアがキッチンにしか通じない → flagged
    const zones2 = [
      zone('bed', '洋室A', [[0, 0], [4, 0], [4, 3], [0, 3]]),
      zone('kit', 'キッチン', [[4, 0], [8, 0], [8, 3], [4, 3]]),
    ]
    expect(findIsolatedBedrooms(zones2, [doorWall('w1', [4, 0.5], [4, 2.5])])).toEqual(['洋室A'])
  })

  test('日语 brief 事实的外窗要求提取', () => {
    const types = windowRoomTypesFromBrief(brief({
      designGoals: [fact('window_requirements', '採光要件', '寝室とリビングに窓が必要')],
    }))
    expect(types.sort()).toEqual(['bedroom', 'living'])
  })

  test('日语房间清单的 PlanTargets 提取', () => {
    const targets = buildPlanTargets(brief({
      designGoals: [fact('rooms', '間取り', ['リビング', 'キッチン', 'トイレ'])],
    }))
    expect(targets.requiredRooms).toContainEqual({ type: 'living', count: 1 })
    expect(targets.requiredRooms).toContainEqual({ type: 'kitchen', count: 1 })
    expect(targets.requiredRooms).toContainEqual({ type: 'bathroom', count: 1 })
  })
})

describe('回复语言跟随：边界渲染', () => {
  test('formatUserFacingSummary renders the frame in the reply language', () => {
    const b = brief({ designGoals: [fact('rooms', '間取り', ['リビング'])] })
    expect(formatUserFacingSummary(b, 'ja')).toContain('現在把握している要件')
    expect(formatUserFacingSummary(b, 'en')).toContain('my current understanding')
    expect(formatUserFacingSummary(b, 'zh')).toContain('我目前理解的需求')
  })

  test('describeRemainingIssues re-renders structured findings per language', () => {
    const diagnostics = {
      validation: { errors: [] },
      verificationIssues: [],
      collisions: [],
      doorlessRooms: ['寝室'],
      strayWindows: ['墙 w1 上的窗户不在建筑外边界附近，疑似开在了室内隔墙上'],
      requirementMismatches: ['卧室数量不足：需求 2 间，实际建了 1 间'],
      isolatedBedrooms: [],
      strayWallIds: ['w1'],
      mismatchL10n: [{ id: 'bedroomShortfall' as const, params: { expected: 2, actual: 1 } }],
    }
    const ja = describeRemainingIssues(diagnostics, 'ja')
    expect(ja).toContain('ドアがなく')
    expect(ja).toContain('寝室の数が不足')
    expect(ja).toContain('壁 w1 の窓')
    const zh = describeRemainingIssues(diagnostics, 'zh')
    expect(zh).toContain('没有任何门')
    expect(zh).toContain('卧室数量不足')
  })
})
