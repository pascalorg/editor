// Pure judgment functions for the eval harness — no I/O, no model/MCP
// calls, so these can be unit tested directly (see evaluate-run.test.ts)
// without spending tokens or spinning up the scene server. `run-eval.ts`
// imports these rather than reimplementing the logic inline.

import { ROOM_NAME_PATTERNS } from '../src/lang/room-vocab'
import type { SceneResult, WorkflowPhase } from '../src/types'

// Case configs address room types by their Chinese labels; the patterns that
// recognize actual zone names come from the shared trilingual vocabulary, so
// Japanese scenes (寝室/リビング/キッチン…) assert the same way.
export const ROOM_TYPE_PATTERNS: Record<string, RegExp> = {
  卧室: ROOM_NAME_PATTERNS.bedroom,
  客厅: ROOM_NAME_PATTERNS.living,
  卫生间: ROOM_NAME_PATTERNS.bathroom,
  厨房: ROOM_NAME_PATTERNS.kitchen,
  书房: ROOM_NAME_PATTERNS.study,
  餐厅: ROOM_NAME_PATTERNS.dining,
}

export type SuccessDetermination = { ok: boolean; error?: string }

/**
 * A case run only counts as successful if the workflow actually reached a
 * terminal "done" phase *and* produced a real scene. `phase !== 'failed'`
 * is not enough — it silently counts `clarifying`, `awaiting_confirmation`,
 * `cancelled`, and any other non-`failed` phase that never produced a scene
 * as a passing run, which is exactly backwards for a harness whose whole
 * point is to catch "didn't actually finish."
 */
export function determineSuccess(
  phase: WorkflowPhase,
  sceneResult: SceneResult | undefined,
): SuccessDetermination {
  const completed = phase === 'completed' || phase === 'completed_with_issues'
  if (!completed) {
    return {
      ok: false,
      error: `会话未到达完成状态（phase=${phase}），可能卡在澄清/确认环节或被取消，不能算成功`,
    }
  }
  if (!sceneResult?.sceneId) {
    return { ok: false, error: 'phase 已是完成状态，但没有 sceneResult.sceneId，场景并未真正生成' }
  }
  return { ok: true }
}

// --- Failure classification (for the raw report) ---

export type FailureStage =
  | 'requirement_extraction'
  | 'generation'
  | 'modification'
  | 'inspection'
  | 'confirmation'
  | 'unknown'

export type FailureCode =
  | 'model_timeout'
  | 'model_rate_limit'
  | 'model_http_error'
  | 'invalid_model_json'
  | 'clarification_incomplete'
  | 'mcp_error'
  | 'cancelled'
  | 'structure_not_converged'
  // Plan-first flow: the intent→partition→validation loop exhausted its
  // correction rounds before any scene was created.
  | 'plan_rejected'
  | 'unknown'

export type FailureClassification = {
  stage: FailureStage
  code: FailureCode
  message: string
}

/**
 * Best-effort classification of *why* a run didn't succeed, derived from the
 * agent's final reply (which embeds the underlying error text) and the phase.
 * Returns undefined for genuinely completed runs. This replaces the previous
 * blanket "大概率卡在澄清阶段" explanation, which was wrong whenever the real
 * cause was rate limiting, an HTTP error, a JSON parse failure, or an MCP
 * error during requirement extraction.
 */
export function classifyFailure(
  phase: WorkflowPhase | undefined,
  reply: string | undefined,
): FailureClassification | undefined {
  if (phase === 'completed' || phase === 'completed_with_issues') return undefined
  const text = (reply ?? '').trim()

  let stage: FailureStage = 'unknown'
  if (/需求解析失败/.test(text)) stage = 'requirement_extraction'
  else if (/户型生成失败|户型规划未通过校验|无法加载场景/.test(text)) stage = 'generation'
  else if (/场景修改失败/.test(text)) stage = 'modification'
  else if (/场景核对失败/.test(text)) stage = 'inspection'
  else if (phase === 'clarifying' || phase === 'awaiting_confirmation') stage = 'confirmation'

  let code: FailureCode = 'unknown'
  if (/取消|cancelled/i.test(text)) code = 'cancelled'
  else if (/户型规划未通过校验/.test(text)) code = 'plan_rejected'
  else if (/未收敛/.test(text)) code = 'structure_not_converged'
  else if (/429|rate.?limit|too many requests/i.test(text)) code = 'model_rate_limit'
  else if (/timeout|timed out|ETIMEDOUT|abort/i.test(text)) code = 'model_timeout'
  else if (/invalid.*json|unexpected (token|end of json)|not valid json|json.*parse/i.test(text)) {
    code = 'invalid_model_json'
  } else if (/MCP tool .* failed|mcp\b/i.test(text)) code = 'mcp_error'
  else if (/Model API (failed|request failed)|\bhttp\b|\b5\d\d\b/i.test(text)) code = 'model_http_error'
  else if (phase === 'clarifying' || phase === 'awaiting_confirmation') code = 'clarification_incomplete'

  return { stage, code, message: text }
}

export type FurnitureIssueBreakdown = {
  total: number
  // Furnishing-time failures: the item was never put into the scene at all
  // ("skipped: overlaps another item" means NOT PLACED, not that two placed
  // items overlap — earlier reports mislabeled these as real overlaps).
  unplacedCount: number
  // Current-state problems, from the agent's deterministic placement check
  // (sceneResult.furniturePlacement): items that ARE in the scene and are
  // actually overlapping / out of their room / blocking a door.
  overlapCount: number
  outOfBoundsCount: number
  doorClearanceCount: number
  otherCount: number
}

/**
 * Buckets furniture problems for the report. `issues` is the historical
 * event log (unplaced items, catalog placeholders); `placement` is the
 * structured current-state check. Prefers structured kinds over string
 * matching wherever structure exists.
 */
export function classifyFurnitureIssues(
  issues: string[],
  placement: Array<{ kind: string }> = [],
): FurnitureIssueBreakdown {
  let unplacedCount = 0
  let otherCount = 0
  for (const issue of issues) {
    // Every furnish_room skip (未能放置 / legacy English strings) means the
    // item was not placed, regardless of the predicted reason.
    if (/未能放置|overlaps another item|outside room bounds|asset not found/i.test(issue)) unplacedCount++
    else otherCount++
  }
  let overlapCount = 0
  let outOfBoundsCount = 0
  let doorClearanceCount = 0
  for (const entry of placement) {
    if (entry.kind === 'overlap') overlapCount++
    else if (entry.kind === 'out_of_bounds') outOfBoundsCount++
    else if (entry.kind === 'door_clearance') doorClearanceCount++
    else otherCount++
  }
  return {
    total: issues.length + placement.length,
    unplacedCount,
    overlapCount,
    outOfBoundsCount,
    doorClearanceCount,
    otherCount,
  }
}

export type BedroomCountCheck = { ok: boolean; expected: number; actual: number | null }

/**
 * Whether the bedroom-count requirement was met — counted directly from the
 * *actual* generated scene's zone names, not from whether the agent's own
 * `requirementMismatches` diagnostic thinks it satisfied itself.
 *
 * That distinction matters: `compareRoomsToRequirements` (in ../src/
 * agent.ts) only compares the built scene against the `bedroom_count` fact
 * the model *itself* extracted from the brief. If the model misreads "三间
 * 卧室" as "两间" during requirement extraction and then builds exactly two
 * bedrooms, the agent's own diagnostic sees no mismatch at all — it
 * satisfied the (wrong) requirement it recorded. This check instead counts
 * bedrooms in `zoneNames` and compares against the case's own
 * `expectedFacts.bedroom_count` (the ground truth the test author wrote),
 * which is independent of whatever the model happened to extract.
 *
 * Returns `actual: null` (and `ok: false`) when `zoneNames` is unavailable
 * — never silently skipped, since the caller (`run-eval.ts`) is expected to
 * treat "couldn't read the scene at all" as its own failure before this is
 * even consulted (see `needsZoneChecks` there).
 */
export function checkBedroomCount(zoneNames: string[] | undefined, expectedBedroomCount: number): BedroomCountCheck {
  if (!zoneNames) return { ok: false, expected: expectedBedroomCount, actual: null }
  const actual = zoneNames.filter(name => ROOM_TYPE_PATTERNS.卧室.test(name)).length
  return { ok: actual === expectedBedroomCount, expected: expectedBedroomCount, actual }
}

export type RoomTypeCheckResult = {
  /** Required types that were absent, or forbidden types that were present. */
  flagged: string[]
  /** Types in the case config that don't match any known pattern — a case-authoring bug, not a generation problem. */
  configErrors: string[]
}

function checkRoomTypes(
  types: string[],
  zoneNames: string[],
  mode: 'required' | 'forbidden',
): RoomTypeCheckResult {
  const flagged: string[] = []
  const configErrors: string[] = []
  for (const type of types) {
    const pattern = ROOM_TYPE_PATTERNS[type]
    if (!pattern) {
      configErrors.push(`未知房间类型模式 "${type}"（不在 ROOM_TYPE_PATTERNS 里）——检查用例配置是否写错，不能静默跳过`)
      continue
    }
    const present = zoneNames.some(name => pattern.test(name))
    if (mode === 'required' && !present) flagged.push(type)
    if (mode === 'forbidden' && present) flagged.push(type)
  }
  return { flagged, configErrors }
}

export function checkRequiredRoomTypes(requiredRoomTypes: string[], zoneNames: string[]): RoomTypeCheckResult {
  return checkRoomTypes(requiredRoomTypes, zoneNames, 'required')
}

/** Detects rooms that were built but explicitly should not have been (the Blocker1-style regression guard). */
export function checkForbiddenRoomTypes(forbiddenRoomTypes: string[], zoneNames: string[]): RoomTypeCheckResult {
  return checkRoomTypes(forbiddenRoomTypes, zoneNames, 'forbidden')
}

// Which phases a `{action:'confirm'}` turn may actually fire from. Sending
// confirm while still `clarifying` (an underspecified case brief) is a
// case-authoring bug, not a generation failure — `ingest()` will just
// reject/no-op it, and blindly treating that as "the case ran" produces a
// misleading result. The runner checks this *before* sending the turn.
const CONFIRMABLE_PHASES = new Set<WorkflowPhase>(['awaiting_confirmation', 'awaiting_modification_confirmation'])

export function canConfirmFromPhase(phase: WorkflowPhase | undefined): boolean {
  return Boolean(phase && CONFIRMABLE_PHASES.has(phase))
}

// Repeat-run / dependency-case scene pairing: run N of a dependent case
// must use run N of its base case's scene, never a different repeat's
// scene — otherwise repeats aren't independent (every dependent repeat
// would pile onto whichever base repeat happened to succeed first,
// defeating the point of running multiple repeats at all).
export function dependencySceneKey(caseId: string, repeatIndex: number): string {
  return `${caseId}#${repeatIndex}`
}

export function resolveDependencySceneId(
  sceneIdByCaseRepeat: Map<string, string>,
  basedOn: string,
  repeatIndex: number,
): string | undefined {
  return sceneIdByCaseRepeat.get(dependencySceneKey(basedOn, repeatIndex))
}

// --- Case structural validation (dry-run, no model/MCP calls) ---

export type CaseTurn = { role: 'user'; message: string } | { action: 'confirm' | 'cancel' }

export type AdjacencyRelation = 'ensuite' | 'connected' | 'adjacent'

export type EvalCase = {
  id: string
  category: string
  difficulty: string
  description?: string
  basedOn?: string
  // A fixed, human-prepared baseline scene to modify. Takes priority over
  // `basedOn` when non-empty; leave empty to fall back to the basedOn scene.
  // The harness never modifies this scene directly — it copies it per repeat.
  baseSceneId?: string
  /**
   * Run the referenced generation case's turns FIRST in the SAME session,
   * then this case's own turns — the modify then sees the session's
   * layoutIntent/layoutPlan snapshots, which is the plan-first structural
   * pipeline's production shape (生成→接着改). Mutually exclusive with
   * baseSceneId: a fixed scene loaded into a fresh session has no snapshots,
   * so structural modifies against it can only exercise the legacy path.
   */
  setupFrom?: string
  turns: CaseTurn[]
  expectedFacts?: {
    bedroom_count?: number
    requiredRoomTypes?: string[]
  }
  forbiddenRoomTypes?: string[]
  // --- Config-driven, data-based assertions (evaluated against the real
  // scene read back from MCP; see assertions.ts). All optional/additive. ---
  /** Exact room count per room type, e.g. {"卧室":2,"客厅":1}. */
  expectedRoomCounts?: Record<string, number>
  /** Total floor area target with fractional tolerance, e.g. {target:70,tolerance:0.1}. */
  totalArea?: { target: number; tolerance: number }
  /** Room types that must each have a valid exterior window, e.g. ["卧室"]. */
  windowsRequiredFor?: string[]
  /** Require every room reachable from an entry/public space (open rooms count). */
  requireAllRoomsReachable?: boolean
  /** 批次 D: fail the case when the turn used more model calls than this (§9 budgets). */
  maxModelCalls?: number
  /**
   * Gate-failure substrings that are the INTENDED outcome of this case's
   * request (e.g. 删床用例豁免「缺少必备家具：床」) — matching failures don't
   * fail the gatesPassed assertion; everything else still does.
   */
  allowedGateFailures?: string[]
  /** Required adjacency relationships between room types (e.g. ensuite). */
  requiredAdjacency?: Array<{ a: string; b: string; relation: AdjacencyRelation }>
  /** Overall footprint width×depth with tolerance, e.g. {width:5,depth:18,tolerance:0.12}. */
  expectedBounds?: { width: number; depth: number; tolerance: number }
  /** Modification (basedOn/baseSceneId) checks comparing before/after snapshots. */
  modificationChecks?: {
    addedRoomType?: string
    adjacentTo?: string
    preserveRoomCounts?: boolean
    preserveFurniture?: boolean
    /** Fail if more than this many original walls were deleted. */
    maxDeletedOriginalWalls?: number
    /** Fail if more than this many original walls were modified. */
    maxModifiedOriginalWalls?: number
    /** Fail if any original door/window was deleted. */
    preserveOriginalOpenings?: boolean
    /** Require the newly added room to fall within this area range in m². */
    addedRoomArea?: { type: string; min: number; max: number }
    /** Require the overall zone footprint bounds to remain unchanged. */
    preserveExteriorBounds?: boolean
    /** Width-only exterior check for plan-first structural modifies (§4 locks W, depth floats). */
    preserveExteriorWidth?: boolean
    /** Require a matching existing room to meet an area range after modification. */
    targetRoomArea?: { type: string; min: number; max?: number; nameIncludes?: string[] }
    /** Furniture-modify (M1): item-node diff assertions, see assertions.ts. */
    itemChanges?: {
      addedMatching?: string[]
      deletedMatching?: string[]
      structureUntouched?: boolean
    }
  }
  notes?: string
}

// A generation-type case (no `basedOn`) whose message never mentions an
// area or explicit width/depth is very likely to get stuck in `clarifying`
// (see `evaluateBrief`'s `hasGeometry` check in ../src/agent.ts) — this is
// exactly the class of bug this validator exists to catch before spending
// real model calls on it.
const AREA_SIGNAL_PATTERN =
  /(\d+\s*(平米|㎡|平方米|m2|m²))|(\d+\s*[x×*]\s*\d+\s*米)|(宽\s*\d+[^，,。]*长\s*\d+)/i

export function validateCaseStructure(testCase: EvalCase, allCaseIds: Set<string>): string[] {
  const problems: string[] = []
  if (!testCase.id) problems.push('缺少 id')
  if (!testCase.turns || testCase.turns.length === 0) {
    problems.push('turns 为空')
    return problems
  }
  if (testCase.basedOn && !allCaseIds.has(testCase.basedOn)) {
    problems.push(`basedOn 引用了不存在的用例 id："${testCase.basedOn}"`)
  }
  if (testCase.setupFrom) {
    if (!allCaseIds.has(testCase.setupFrom)) {
      problems.push(`setupFrom 引用了不存在的用例 id："${testCase.setupFrom}"`)
    }
    if ((testCase.baseSceneId ?? '').trim()) {
      problems.push('setupFrom 与 baseSceneId 互斥：固定场景加载进新 session 没有 plan 快照，setupFrom 的意义就是在同一 session 里先生成出快照')
    }
  }
  if (!('message' in testCase.turns[0]!)) {
    problems.push('第一轮必须是用户消息，不能直接是 action')
  }
  const hasConfirm = testCase.turns.some(t => 'action' in t && t.action === 'confirm')
  if (!hasConfirm) problems.push('turns 里没有 confirm 动作，用例永远不会真正触发生成/修改')

  const hasFixedBase = Boolean((testCase.baseSceneId ?? '').trim())
  if (!testCase.basedOn && !hasFixedBase && !testCase.setupFrom) {
    const messageText = testCase.turns
      .filter((t): t is { role: 'user'; message: string } => 'message' in t)
      .map(t => t.message)
      .join(' ')
    if (!AREA_SIGNAL_PATTERN.test(messageText)) {
      problems.push('消息里没有检测到面积/尺寸信号，容易卡在 clarifying 阶段（如果这就是用例的测试目的，可以忽略这条）')
    }
  }

  if (testCase.forbiddenRoomTypes) {
    for (const type of testCase.forbiddenRoomTypes) {
      if (!ROOM_TYPE_PATTERNS[type]) problems.push(`forbiddenRoomTypes 里有未知房间类型 "${type}"`)
    }
  }
  if (testCase.expectedFacts?.requiredRoomTypes) {
    for (const type of testCase.expectedFacts.requiredRoomTypes) {
      if (!ROOM_TYPE_PATTERNS[type]) problems.push(`expectedFacts.requiredRoomTypes 里有未知房间类型 "${type}"`)
    }
  }

  problems.push(...validateAssertionConfig(testCase))

  return problems
}

// Structural validation of the config-driven assertion fields (dry-run only —
// catches an unknown room type, an out-of-range tolerance, a bad relation, or a
// modificationChecks block on a non-modify case before any tokens are spent).
function validateAssertionConfig(testCase: EvalCase): string[] {
  const problems: string[] = []
  const knownType = (type: string) => Boolean(ROOM_TYPE_PATTERNS[type])
  const checkTolerance = (label: string, t: unknown) => {
    if (typeof t !== 'number' || !(t > 0 && t < 1)) problems.push(`${label} 的 tolerance 必须是 (0,1) 之间的小数`)
  }

  if (testCase.expectedRoomCounts) {
    for (const [type, count] of Object.entries(testCase.expectedRoomCounts)) {
      if (!knownType(type)) problems.push(`expectedRoomCounts 里有未知房间类型 "${type}"`)
      if (!Number.isInteger(count) || count < 0) problems.push(`expectedRoomCounts["${type}"] 必须是非负整数`)
    }
  }
  if (testCase.totalArea) {
    if (!(testCase.totalArea.target > 0)) problems.push('totalArea.target 必须为正数')
    checkTolerance('totalArea', testCase.totalArea.tolerance)
  }
  if (testCase.windowsRequiredFor) {
    for (const type of testCase.windowsRequiredFor) {
      if (!knownType(type)) problems.push(`windowsRequiredFor 里有未知房间类型 "${type}"`)
    }
  }
  if (testCase.requiredAdjacency) {
    for (const spec of testCase.requiredAdjacency) {
      if (!knownType(spec.a) || !knownType(spec.b)) problems.push(`requiredAdjacency 里有未知房间类型（${spec.a} 或 ${spec.b}）`)
      if (!['ensuite', 'connected', 'adjacent'].includes(spec.relation)) {
        problems.push(`requiredAdjacency.relation "${spec.relation}" 不合法，应为 ensuite/connected/adjacent`)
      }
    }
  }
  if (testCase.expectedBounds) {
    if (!(testCase.expectedBounds.width > 0) || !(testCase.expectedBounds.depth > 0)) {
      problems.push('expectedBounds 的 width/depth 必须为正数')
    }
    checkTolerance('expectedBounds', testCase.expectedBounds.tolerance)
  }
  if (testCase.modificationChecks) {
    const hasFixedBase = Boolean((testCase.baseSceneId ?? '').trim())
    if (!testCase.basedOn && !hasFixedBase && !testCase.setupFrom) {
      problems.push('modificationChecks 是修改类断言，用例必须提供 baseSceneId、basedOn 或 setupFrom 之一')
    }
    const mc = testCase.modificationChecks
    if (mc.addedRoomType && !knownType(mc.addedRoomType)) problems.push(`modificationChecks.addedRoomType "${mc.addedRoomType}" 是未知房间类型`)
    if (mc.adjacentTo && !knownType(mc.adjacentTo)) problems.push(`modificationChecks.adjacentTo "${mc.adjacentTo}" 是未知房间类型`)
    if (mc.maxDeletedOriginalWalls !== undefined && (!Number.isInteger(mc.maxDeletedOriginalWalls) || mc.maxDeletedOriginalWalls < 0)) {
      problems.push('modificationChecks.maxDeletedOriginalWalls 必须是非负整数')
    }
    if (mc.maxModifiedOriginalWalls !== undefined && (!Number.isInteger(mc.maxModifiedOriginalWalls) || mc.maxModifiedOriginalWalls < 0)) {
      problems.push('modificationChecks.maxModifiedOriginalWalls 必须是非负整数')
    }
    if (mc.addedRoomArea) {
      if (!knownType(mc.addedRoomArea.type)) {
        problems.push(`modificationChecks.addedRoomArea.type "${mc.addedRoomArea.type}" 是未知房间类型`)
      }
      if (!(mc.addedRoomArea.min > 0) || !(mc.addedRoomArea.max >= mc.addedRoomArea.min)) {
        problems.push('modificationChecks.addedRoomArea 必须满足 0 < min <= max')
      }
    }
    if (mc.targetRoomArea) {
      if (!knownType(mc.targetRoomArea.type)) {
        problems.push(`modificationChecks.targetRoomArea.type "${mc.targetRoomArea.type}" 是未知房间类型`)
      }
      if (!(mc.targetRoomArea.min > 0) ||
        (mc.targetRoomArea.max !== undefined && mc.targetRoomArea.max < mc.targetRoomArea.min)) {
        problems.push('modificationChecks.targetRoomArea 必须满足 0 < min <= max')
      }
      if (mc.targetRoomArea.nameIncludes?.some(value => typeof value !== 'string' || value.trim() === '')) {
        problems.push('modificationChecks.targetRoomArea.nameIncludes 只能包含非空字符串')
      }
    }
  }
  return problems
}

// Corpus-level checks — things a single-case validator can't see, since
// they only exist as relationships *between* cases (duplicate ids collide
// silently in `allCaseIds`/scene maps; a cycle in `basedOn` would make the
// dependent-scene runner wait forever on a scene that never gets recorded).
export function findCorpusLevelProblems(allCases: EvalCase[]): string[] {
  const problems: string[] = []

  const idCounts = new Map<string, number>()
  for (const c of allCases) {
    if (!c.id) continue
    idCounts.set(c.id, (idCounts.get(c.id) ?? 0) + 1)
  }
  for (const [id, count] of idCounts) {
    if (count > 1) problems.push(`重复的用例 id "${id}"（出现 ${count} 次）——运行结果/场景映射会互相覆盖`)
  }

  const byId = new Map(allCases.filter(c => c.id).map(c => [c.id, c] as const))
  for (const c of allCases) {
    if (!c.basedOn) continue
    if (c.basedOn === c.id) {
      problems.push(`用例 "${c.id}" 的 basedOn 指向了自己`)
      continue
    }
    const chain = new Set<string>([c.id])
    let current: EvalCase | undefined = byId.get(c.basedOn)
    let cycle = false
    while (current) {
      if (chain.has(current.id)) {
        cycle = true
        break
      }
      chain.add(current.id)
      if (!current.basedOn) break
      current = byId.get(current.basedOn)
    }
    if (cycle) problems.push(`用例 "${c.id}" 的 basedOn 依赖链里存在环：${[...chain].join(' → ')}`)
  }

  return problems
}
