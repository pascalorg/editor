#!/usr/bin/env bun
// Minimal-version eval harness (see ../EVAL_SPEC.md §1-3). Replays each
// fixed case against the real `PascalAiAgent` (in-process, not over HTTP —
// same pattern as ../src/server.ts), then dumps the existing `SceneResult`
// diagnostic fields as-is. No weighted scoring yet — that's the "full
// version" upgrade described in the spec, deferred until there's enough
// data to know the weights are worth designing.
//
// Success/room-type/dependency-pairing judgment logic lives in
// evaluate-run.ts as pure functions (unit tested in evaluate-run.test.ts)
// — this file is just the I/O harness around them.
//
// Requires the same environment as running `pascal-ai-mcp` normally: a
// working `.env`/`.env.local` with model credentials, and `bun` able to
// spawn the MCP scene server as a stdio child process (the default).
//
// Usage:
//   bun run eval/run-eval.ts                     # all cases, 1 run each
//   bun run eval/run-eval.ts --repeat=3           # all cases, 3 runs each
//   bun run eval/run-eval.ts --only=case-12-scope-boundary,case-03-two-bed-standard
//   bun run eval/run-eval.ts --dry-run            # validate case files only, no model/MCP calls, no tokens spent

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PascalAiAgent, toolPayload } from '../src/agent'
import { loadConfig } from '../src/config'
import { PascalMcpClient } from '../src/mcp'
import type { ChatInput, ChatResult, SceneResult, WorkflowPhase } from '../src/types'
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
  validateCaseStructure,
  type EvalCase,
  type FailureClassification,
  type FurnitureIssueBreakdown,
} from './evaluate-run'
import { scaffoldReviews } from './review'
import {
  assertModification,
  rollupAssertions,
  runSceneAssertions,
  type AssertionConfig,
  type AssertionResult,
  type AssertionRollup,
  type SceneInputs,
  type SceneSnapshot,
  type WallInfo,
  type ZoneInfo,
} from './assertions'

type CaseRunResult = {
  caseId: string
  repeatIndex: number
  // `ok` is the single pass/fail bit callers should gate on — it requires
  // BOTH the workflow reaching a real completed state AND every declared
  // assertion (bedroom count / required / forbidden room types) passing.
  // `workflowCompleted` / `assertionsPassed` are kept as separate fields
  // (not just folded into `ok`) so a report can distinguish "the agent
  // never finished" from "it finished but built the wrong thing" —
  // `completed_with_issues` on its own doesn't tell you which.
  ok: boolean
  workflowCompleted: boolean
  assertionsPassed: boolean
  error?: string
  // Structured failure classification (undefined for successful runs) so the
  // raw report shows the real underlying cause — rate limit / HTTP error /
  // JSON parse / MCP error / clarification — instead of one blanket message.
  failureStage?: FailureClassification['stage']
  failureCode?: FailureClassification['code']
  failureMessage?: string
  // Model API attempts this session made (from session.modelCallsTotal),
  // so a run that burned its retries is visible in the report.
  modelAttempts?: number
  // Furniture placement outcome breakdown (overlap / out-of-bounds / other).
  furniture?: FurnitureIssueBreakdown
  // Config-driven, data-based assertion results (room counts, area, windows,
  // reachability, adjacency, bounds, modification snapshot diff).
  assertions?: AssertionResult[]
  assertionRollup?: AssertionRollup
  elapsedMs: number
  finalPhase?: string
  sceneId?: string | null
  editorUrl?: string | null
  // For modification cases: the fixed/basedOn baseline scene and the disposable
  // per-repeat working copy that was actually modified (base is never touched).
  baseSceneId?: string | null
  workingSceneId?: string | null
  sceneResult?: SceneResult
  zoneNames?: string[]
  // Set when a case declares a zone-dependent assertion but the scene's
  // zones couldn't actually be read back (load_scene/get_zones threw) —
  // this must fail the run, not silently skip the assertion (Blocker 3).
  zoneInspectionError?: string
  checks: {
    bedroomCountOk?: boolean
    bedroomCountExpected?: number
    bedroomCountActual?: number | null
    requiredRoomTypesMissing?: string[]
    forbiddenRoomTypesFound?: string[]
    configErrors?: string[]
  }
}

const CASES_DIR = join(import.meta.dir, 'cases')
const REPORT_ROOT = join(import.meta.dir, 'report')

function parseArgs(): { repeat: number; only?: Set<string>; dryRun: boolean } {
  let repeat = 1
  let only: Set<string> | undefined
  let dryRun = false
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--repeat=')) {
      repeat = Math.max(1, Number.parseInt(arg.slice('--repeat='.length), 10) || 1)
    }
    if (arg.startsWith('--only=')) {
      only = new Set(arg.slice('--only='.length).split(',').map(s => s.trim()).filter(Boolean))
    }
    if (arg === '--dry-run') dryRun = true
  }
  return { repeat, only, dryRun }
}

function loadCases(): EvalCase[] {
  const files = readdirSync(CASES_DIR).filter(f => f.endsWith('.json')).sort()
  const cases = files.map(f => JSON.parse(readFileSync(join(CASES_DIR, f), 'utf8')) as EvalCase)
  // Cheap dependency ordering: run every case with no `basedOn` first, then
  // the ones that chain off another case. Good enough for the current
  // corpus (two one-hop-deep "modify" cases); revisit if it ever grows a
  // deeper dependency chain.
  const independent = cases.filter(c => !c.basedOn)
  const dependent = cases.filter(c => c.basedOn)
  return [...independent, ...dependent]
}

function runDryRun(cases: EvalCase[], allCases: EvalCase[]): void {
  // basedOn existence must be checked against the FULL corpus, not the
  // (possibly `--only`-filtered) `cases` being run — otherwise
  // `--dry-run --only=case-13-modify-add-room` reports its very real
  // `basedOn: "case-03-two-bed-standard"` as "nonexistent" just because
  // case-03 wasn't in the filtered set.
  const allIds = new Set(allCases.map(c => c.id))
  let problemCount = 0
  for (const testCase of cases) {
    const problems = validateCaseStructure(testCase, allIds)
    if (problems.length === 0) {
      console.log(`[OK  ] ${testCase.id}`)
    } else {
      problemCount += problems.length
      console.log(`[WARN] ${testCase.id}`)
      for (const problem of problems) console.log(`         - ${problem}`)
    }
  }

  // Corpus-level relationships (duplicate ids, self-basedOn, dependency
  // cycles) only make sense checked against the full corpus regardless of
  // `--only` — running them on a filtered slice would miss a duplicate or
  // cycle that spans a case outside the filter.
  const corpusProblems = findCorpusLevelProblems(allCases)
  if (corpusProblems.length > 0) {
    problemCount += corpusProblems.length
    console.log('[WARN] 语料库级别问题（跨用例）')
    for (const problem of corpusProblems) console.log(`         - ${problem}`)
  }

  console.log(`\ndry-run 完成：${cases.length} 个用例，${problemCount} 个结构性问题。没有调用模型或 MCP，不消耗 token。`)
  process.exit(problemCount > 0 ? 1 : 0)
}

function parseZones(payload: Record<string, unknown>): ZoneInfo[] {
  const zones = Array.isArray(payload.zones) ? payload.zones : []
  const out: ZoneInfo[] = []
  for (const z of zones) {
    if (!z || typeof z !== 'object') continue
    const o = z as Record<string, unknown>
    const polygon = Array.isArray(o.polygon)
      ? o.polygon.filter(
          (p): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every(n => typeof n === 'number'),
        )
      : []
    if (typeof o.id !== 'string' || polygon.length < 3) continue
    out.push({
      id: o.id,
      name: typeof o.name === 'string' ? o.name : '',
      polygon,
      areaSqMeters: typeof o.areaSqMeters === 'number' ? o.areaSqMeters : 0,
      bounds:
        o.bounds && typeof o.bounds === 'object'
          ? {
              width: Number((o.bounds as Record<string, unknown>).width) || 0,
              depth: Number((o.bounds as Record<string, unknown>).depth) || 0,
            }
          : undefined,
    })
  }
  return out
}

function parseWalls(payload: Record<string, unknown>): WallInfo[] {
  const walls = Array.isArray(payload.walls) ? payload.walls : []
  const out: WallInfo[] = []
  for (const w of walls) {
    if (!w || typeof w !== 'object') continue
    const o = w as Record<string, unknown>
    const start = o.start as unknown
    const end = o.end as unknown
    const isPair = (v: unknown): v is [number, number] =>
      Array.isArray(v) && v.length === 2 && v.every(n => typeof n === 'number')
    if (typeof o.id !== 'string' || !isPair(start) || !isPair(end)) continue
    const openings = Array.isArray(o.openings)
      ? o.openings.flatMap(op =>
          op && typeof op === 'object' && typeof (op as { type?: unknown }).type === 'string'
            ? [{ type: (op as { type: string }).type }]
            : [],
        )
      : []
    out.push({ id: o.id, start, end, openings })
  }
  return out
}

function parseSceneSnapshot(payload: Record<string, unknown>): SceneSnapshot {
  const nodes = payload.nodes
  if (!nodes || typeof nodes !== 'object') return {}
  return nodes as SceneSnapshot
}

/**
 * Make a disposable working copy of a baseline scene so the modification runs
 * on the copy and NEVER mutates the original baseline. MCP does support this:
 * `get_scene` returns the full graph and `save_scene({ includeCurrentScene:
 * false, graph })` persists it as a brand-new scene (omitting `id` yields a new
 * scene id). Returns the new working sceneId and the copy's initial snapshot
 * (identical to the base graph) for before/after diffing.
 */
async function prepareWorkingScene(
  mcp: PascalMcpClient,
  baseSceneId: string,
  label: string,
): Promise<{ workingSceneId: string; beforeSnapshot: SceneSnapshot }> {
  await mcp.callTool('load_scene', { id: baseSceneId })
  const graphPayload = toolPayload(await mcp.callTool('get_scene', {}))
  const graph: Record<string, unknown> = {
    nodes: graphPayload.nodes,
    rootNodeIds: graphPayload.rootNodeIds,
    ...(graphPayload.collections ? { collections: graphPayload.collections } : {}),
  }
  const saved = toolPayload(
    await mcp.callTool('save_scene', {
      name: `eval-copy-${label}`,
      includeCurrentScene: false,
      graph,
      saveMode: 'draft',
    }),
  )
  const workingSceneId =
    (typeof saved.id === 'string' && saved.id) ||
    (typeof saved.projectId === 'string' && saved.projectId) ||
    ''
  if (!workingSceneId) throw new Error('save_scene 未返回新的 sceneId，复制基准场景失败')
  return { workingSceneId, beforeSnapshot: parseSceneSnapshot(graphPayload) }
}

function extractAssertionConfig(testCase: EvalCase): AssertionConfig {
  return {
    ...(testCase.expectedRoomCounts ? { expectedRoomCounts: testCase.expectedRoomCounts } : {}),
    ...(testCase.totalArea ? { totalArea: testCase.totalArea } : {}),
    ...(testCase.windowsRequiredFor ? { windowsRequiredFor: testCase.windowsRequiredFor } : {}),
    ...(testCase.requireAllRoomsReachable ? { requireAllRoomsReachable: true } : {}),
    ...(testCase.requiredAdjacency ? { requiredAdjacency: testCase.requiredAdjacency } : {}),
    ...(testCase.expectedBounds ? { expectedBounds: testCase.expectedBounds } : {}),
  }
}

function hasConfigAssertions(testCase: EvalCase): boolean {
  const c = extractAssertionConfig(testCase)
  return Object.keys(c).length > 0 || Boolean(testCase.modificationChecks)
}

async function runCase(
  agent: PascalAiAgent,
  mcp: PascalMcpClient,
  testCase: EvalCase,
  repeatIndex: number,
  sceneIdByCaseRepeat: Map<string, string>,
): Promise<CaseRunResult> {
  const sessionId = `eval-${testCase.id}-r${repeatIndex}-${Date.now()}`
  const started = Date.now()
  // A fixed, human-prepared baseline takes priority; only fall back to the
  // basedOn dependency scene when no fixed baseSceneId is configured. With a
  // fixed base, `--only=case-13` runs standalone without needing case-03.
  const fixedBase = (testCase.baseSceneId ?? '').trim()
  const baseSceneId =
    fixedBase ||
    (testCase.basedOn
      ? resolveDependencySceneId(sceneIdByCaseRepeat, testCase.basedOn, repeatIndex)
      : undefined)
  if (!fixedBase && testCase.basedOn && !baseSceneId) {
    return {
      caseId: testCase.id,
      repeatIndex,
      ok: false,
      workflowCompleted: false,
      assertionsPassed: false,
      error: `依赖用例 ${testCase.basedOn} 第 ${repeatIndex} 次运行没有成功的 sceneId，且未配置固定 baseSceneId，已跳过`,
      elapsedMs: 0,
      checks: {},
    }
  }

  try {
    // When there's a baseline (fixed or basedOn), work on a fresh disposable
    // COPY of it — never modify the baseline itself. Each repeat gets its own
    // copy, so repeats and dependent cases (13/14) never contaminate each other
    // or the baseline. The copy's initial graph is the before-snapshot.
    let beforeSnapshot: SceneSnapshot | undefined
    let workingSceneId: string | undefined
    if (baseSceneId) {
      try {
        const prepared = await prepareWorkingScene(mcp, baseSceneId, `${testCase.id}-r${repeatIndex}`)
        workingSceneId = prepared.workingSceneId
        beforeSnapshot = prepared.beforeSnapshot
      } catch (error) {
        return {
          caseId: testCase.id,
          repeatIndex,
          ok: false,
          workflowCompleted: false,
          assertionsPassed: false,
          error: `准备评测副本失败（不会修改原基准场景）：${error instanceof Error ? error.message : String(error)}`,
          baseSceneId,
          elapsedMs: Date.now() - started,
          checks: {},
        }
      }
    }
    let lastResult: ChatResult | undefined
    for (let i = 0; i < testCase.turns.length; i++) {
      const turn = testCase.turns[i]!
      const currentPhase = lastResult?.session.phase as WorkflowPhase | undefined
      if ('action' in turn && turn.action === 'confirm' && !canConfirmFromPhase(currentPhase)) {
        const elapsedMs = Date.now() - started
        const failure = classifyFailure(currentPhase, lastResult?.reply)
        // Distinguish "the previous turn actually errored out" from "the brief
        // was underspecified so it's still clarifying" — the old code called
        // both "大概率卡在澄清阶段", which was wrong for the former.
        const error = currentPhase === 'failed'
          ? `第 ${i + 1} 轮准备 confirm，但上一轮已进入 failed：${lastResult?.reply ?? '(无回复)'}`
          : `第 ${i + 1} 轮尝试 confirm，但当前 phase 是 "${currentPhase}"（不在可确认状态）——很可能澄清未完成，检查用例的消息是否给了足够的面积/房间信息`
        return {
          caseId: testCase.id,
          repeatIndex,
          ok: false,
          workflowCompleted: false,
          assertionsPassed: false,
          error,
          failureStage: failure?.stage,
          failureCode: failure?.code,
          failureMessage: failure?.message ?? lastResult?.reply,
          modelAttempts: lastResult?.session.modelCallsTotal,
          elapsedMs,
          finalPhase: currentPhase,
          checks: {},
        }
      }
      const input: ChatInput = { sessionId }
      if (i === 0 && workingSceneId) input.sceneId = workingSceneId
      if ('message' in turn) input.message = turn.message
      if ('action' in turn) input.action = turn.action
      lastResult = await agent.chat(input)
    }
    const elapsedMs = Date.now() - started
    const session = lastResult!.session
    const sceneResult = session.sceneResult
    const sceneId = sceneResult?.sceneId ?? session.sceneId ?? null
    const workflow = determineSuccess(session.phase, sceneResult)

    // Whether this case declares any assertion that needs the *actual*
    // generated scene's zones to evaluate. If it does but the lookup below
    // fails, that must fail the run outright — not silently skip the
    // assertion and let `ok` fall back to just `workflow.ok` (Blocker 3).
    const needsZoneChecks = Boolean(
      testCase.expectedFacts?.bedroom_count !== undefined ||
        testCase.expectedFacts?.requiredRoomTypes ||
        testCase.forbiddenRoomTypes,
    ) || hasConfigAssertions(testCase)

    let zoneNames: string[] | undefined
    let zoneInspectionError: string | undefined
    let zones: ZoneInfo[] = []
    let walls: WallInfo[] = []
    if (sceneId) {
      try {
        await mcp.callTool('load_scene', { id: sceneId })
        zones = parseZones(toolPayload(await mcp.callTool('get_zones', {})))
        walls = parseWalls(toolPayload(await mcp.callTool('get_walls', {})))
        zoneNames = zones.map(z => z.name).filter(Boolean)
      } catch (error) {
        zoneInspectionError = `读取场景 zones/walls 失败：${error instanceof Error ? error.message : String(error)}`
      }
    } else if (needsZoneChecks) {
      zoneInspectionError = '没有 sceneId，无法读取场景 zones'
    }

    const checks: CaseRunResult['checks'] = {}
    const configErrors: string[] = []
    let assertionsPassed = true

    if (needsZoneChecks && zoneInspectionError) {
      // Zone-dependent assertions were declared but we couldn't actually
      // inspect the scene — this must count as an assertion failure, not
      // an unscored skip (Blocker 3).
      assertionsPassed = false
    } else {
      if (testCase.expectedFacts?.bedroom_count !== undefined) {
        const bedroomCheck = checkBedroomCount(zoneNames, testCase.expectedFacts.bedroom_count)
        checks.bedroomCountOk = bedroomCheck.ok
        checks.bedroomCountExpected = bedroomCheck.expected
        checks.bedroomCountActual = bedroomCheck.actual
        if (!bedroomCheck.ok) assertionsPassed = false
      }
      if (testCase.expectedFacts?.requiredRoomTypes && zoneNames) {
        const result = checkRequiredRoomTypes(testCase.expectedFacts.requiredRoomTypes, zoneNames)
        checks.requiredRoomTypesMissing = result.flagged
        configErrors.push(...result.configErrors)
        if (result.flagged.length > 0) assertionsPassed = false
      }
      if (testCase.forbiddenRoomTypes && zoneNames) {
        const result = checkForbiddenRoomTypes(testCase.forbiddenRoomTypes, zoneNames)
        checks.forbiddenRoomTypesFound = result.flagged
        configErrors.push(...result.configErrors)
        if (result.flagged.length > 0) assertionsPassed = false
      }
    }
    if (configErrors.length > 0) {
      checks.configErrors = configErrors
      assertionsPassed = false
    }

    // Config-driven, data-based assertions against the real scene.
    let assertions: AssertionResult[] | undefined
    let assertionRollup: AssertionRollup | undefined
    if (sceneId && !zoneInspectionError && hasConfigAssertions(testCase)) {
      const scene: SceneInputs = { zones, walls }
      const results = runSceneAssertions(extractAssertionConfig(testCase), scene)
      if (testCase.modificationChecks) {
        if (beforeSnapshot) {
          try {
            const afterSnapshot = parseSceneSnapshot(toolPayload(await mcp.callTool('get_scene', {})))
            results.push(...assertModification(beforeSnapshot, afterSnapshot, scene, testCase.modificationChecks))
          } catch (error) {
            results.push({
              name: 'modification',
              status: 'unsupported',
              reason: `读取修改后场景失败：${error instanceof Error ? error.message : String(error)}`,
            })
          }
        } else {
          results.push({
            name: 'modification',
            status: 'unsupported',
            reason: '未能获取修改前基准快照，无法做前后比较（见 run-eval 中的隔离阻塞点说明）',
          })
        }
      }
      assertions = results
      assertionRollup = rollupAssertions(results)
      // unsupported is NOT a pass — any fail or unsupported blocks assertions.
      if (!assertionRollup.allPassed) assertionsPassed = false
    } else if (needsZoneChecks && zoneInspectionError && hasConfigAssertions(testCase)) {
      assertionsPassed = false
    }

    const errorParts: string[] = []
    if (workflow.error) errorParts.push(workflow.error)
    if (zoneInspectionError && needsZoneChecks) errorParts.push(zoneInspectionError)
    if (configErrors.length > 0) errorParts.push(`用例配置错误：${configErrors.join('; ')}`)
    if (checks.bedroomCountOk === false) {
      errorParts.push(`卧室数量不符：期望 ${checks.bedroomCountExpected}，实际 ${checks.bedroomCountActual}`)
    }
    if (checks.requiredRoomTypesMissing?.length) {
      errorParts.push(`缺少预期房间类型：${checks.requiredRoomTypesMissing.join(', ')}`)
    }
    if (checks.forbiddenRoomTypesFound?.length) {
      errorParts.push(`建出了不该建的房间类型：${checks.forbiddenRoomTypesFound.join(', ')}`)
    }
    if (assertions) {
      for (const a of assertions) {
        if (a.status === 'fail') errorParts.push(`[断言失败] ${a.name}：${a.reason ?? ''}`)
        else if (a.status === 'unsupported') errorParts.push(`[断言无法判定] ${a.name}：${a.reason ?? ''}`)
      }
    }

    const failure = classifyFailure(session.phase, lastResult!.reply)
    return {
      caseId: testCase.id,
      repeatIndex,
      ok: workflow.ok && assertionsPassed,
      workflowCompleted: workflow.ok,
      assertionsPassed,
      error: errorParts.length > 0 ? errorParts.join('；') : undefined,
      failureStage: failure?.stage,
      failureCode: failure?.code,
      failureMessage: failure?.message,
      modelAttempts: session.modelCallsTotal,
      furniture: classifyFurnitureIssues(sceneResult?.furnitureIssues ?? []),
      assertions,
      assertionRollup,
      elapsedMs,
      finalPhase: session.phase,
      sceneId,
      editorUrl: sceneResult?.editorUrl ?? null,
      baseSceneId: baseSceneId ?? null,
      workingSceneId: workingSceneId ?? null,
      sceneResult,
      zoneNames,
      zoneInspectionError,
      checks,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      caseId: testCase.id,
      repeatIndex,
      ok: false,
      workflowCompleted: false,
      assertionsPassed: false,
      error: message,
      failureStage: 'unknown',
      failureCode: 'unknown',
      failureMessage: message,
      elapsedMs: Date.now() - started,
      checks: {},
    }
  }
}

function logResult(result: CaseRunResult): void {
  const status = result.ok ? 'OK  ' : 'FAIL'
  const detail = result.sceneResult
    ? [
        `phase=${result.finalPhase}`,
        `doorless=${result.sceneResult.doorlessRooms.length}`,
        `strayWindows=${result.sceneResult.strayWindows.length}`,
        `requirementMismatches=${result.sceneResult.requirementMismatches.length}`,
        `isolatedBedrooms=${result.sceneResult.isolatedBedrooms.length}`,
        `collisions=${result.sceneResult.collisions.length}`,
      ].join(' ')
    : (result.error ?? '')
  const checkFlags = [
    result.checks.bedroomCountOk === false
      ? `BEDROOM_COUNT_MISMATCH(expected=${result.checks.bedroomCountExpected},actual=${result.checks.bedroomCountActual})`
      : '',
    result.checks.requiredRoomTypesMissing?.length ? `MISSING_ROOM_TYPES(${result.checks.requiredRoomTypesMissing.join(',')})` : '',
    result.checks.forbiddenRoomTypesFound?.length ? `FORBIDDEN_ROOM_TYPES_FOUND(${result.checks.forbiddenRoomTypesFound.join(',')})` : '',
    result.checks.configErrors?.length ? 'CASE_CONFIG_ERROR' : '',
    result.zoneInspectionError ? 'ZONE_INSPECTION_FAILED' : '',
  ].filter(Boolean).join(' ')
  console.log(`[${status}] ${result.caseId} run${result.repeatIndex} (${result.elapsedMs}ms) ${detail} ${checkFlags}`)
  if (!result.ok && result.error) console.log(`         原因：${result.error}`)
  if (!result.ok && result.failureCode) {
    console.log(`         失败分类：stage=${result.failureStage} code=${result.failureCode} 模型请求数=${result.modelAttempts ?? '未知'}`)
  }
}

function buildSummary(results: CaseRunResult[]) {
  const total = results.length
  const successCount = results.filter(r => r.ok).length
  const errorCount = results.filter(r => !r.ok).length
  const workflowCompletedCount = results.filter(r => r.workflowCompleted).length
  const assertionsPassedCount = results.filter(r => r.assertionsPassed).length
  const sum = (pick: (r: CaseRunResult) => number) => results.reduce((acc, r) => acc + pick(r), 0)
  const withScene = results.filter(r => r.sceneResult)
  const nonEmptyRate = (pick: (s: SceneResult) => unknown[]) =>
    withScene.length === 0 ? 0 : withScene.filter(r => pick(r.sceneResult!).length > 0).length / withScene.length

  // Distribution of failure codes across non-successful runs, so a report can
  // show "3× model_rate_limit" instead of just "0/3 passed".
  const failureCodeCounts: Record<string, number> = {}
  for (const r of results) {
    if (r.ok || !r.failureCode) continue
    failureCodeCounts[r.failureCode] = (failureCodeCounts[r.failureCode] ?? 0) + 1
  }
  const furniturePlacementFailures = sum(r => r.furniture?.total ?? 0)
  const furnitureOverlapCount = sum(r => r.furniture?.overlapCount ?? 0)
  const furnitureOutOfBoundsCount = sum(r => r.furniture?.outOfBoundsCount ?? 0)

  return {
    failureCodeCounts,
    furniturePlacementFailures,
    furnitureOverlapCount,
    furnitureOutOfBoundsCount,
    furnitureIssueRate: nonEmptyRate(s => s.furnitureIssues),
    total,
    successCount,
    errorCount,
    successRate: total === 0 ? 0 : successCount / total,
    // Split out from `successRate` per the report-clarity suggestion:
    // `completed_with_issues` means the workflow finished but the report
    // shouldn't conflate "it finished" with "the quality assertions on top
    // of that also passed" — these two rates can and will diverge.
    workflowCompletedRate: total === 0 ? 0 : workflowCompletedCount / total,
    assertionsPassedRate: total === 0 ? 0 : assertionsPassedCount / total,
    avgElapsedMs: total === 0 ? 0 : Math.round(sum(r => r.elapsedMs) / total),
    requirementMismatchRate: nonEmptyRate(s => s.requirementMismatches),
    doorlessRoomRate: nonEmptyRate(s => s.doorlessRooms),
    strayWindowRate: nonEmptyRate(s => s.strayWindows),
    isolatedBedroomRate: nonEmptyRate(s => s.isolatedBedrooms),
    collisionRate: nonEmptyRate(s => s.collisions),
    bedroomCountMismatches: results.filter(r => r.checks.bedroomCountOk === false).map(r => `${r.caseId}#${r.repeatIndex}`),
    missingRoomTypeCases: results.filter(r => r.checks.requiredRoomTypesMissing?.length).map(r => `${r.caseId}#${r.repeatIndex}`),
    forbiddenRoomTypeHits: results.filter(r => r.checks.forbiddenRoomTypesFound?.length).map(r => `${r.caseId}#${r.repeatIndex}`),
    caseConfigErrors: results.filter(r => r.checks.configErrors?.length).map(r => `${r.caseId}#${r.repeatIndex}`),
    zoneInspectionFailures: results.filter(r => r.zoneInspectionError).map(r => `${r.caseId}#${r.repeatIndex}`),
  }
}

function renderSummaryMarkdown(summary: ReturnType<typeof buildSummary>, results: CaseRunResult[]): string {
  const lines = [
    '# pascal-ai-mcp 评测集运行报告（最小版，无加权打分）',
    '',
    `- 总运行次数：${summary.total}`,
    `- 成功率：${(summary.successRate * 100).toFixed(1)}% (${summary.successCount}/${summary.total})——要求工作流完成状态成立，且用例声明的所有断言（卧室数量/必须/禁止房间类型）全部通过`,
    `  - 其中工作流完成率：${(summary.workflowCompletedRate * 100).toFixed(1)}%（phase 到达 completed/completed_with_issues 且有 sceneResult.sceneId，不代表质量断言也通过）`,
    `  - 断言通过率：${(summary.assertionsPassedRate * 100).toFixed(1)}%（卧室数量/必须房间/禁止房间类型全部满足，且未出现 zone 读取失败）`,
    `- 平均耗时：${summary.avgElapsedMs}ms`,
    `- 需求遗漏率（requirementMismatches 非空）：${(summary.requirementMismatchRate * 100).toFixed(1)}%`,
    `- 封闭房间率（doorlessRooms 非空）：${(summary.doorlessRoomRate * 100).toFixed(1)}%`,
    `- 室内窗疑似误判率（strayWindows 非空）：${(summary.strayWindowRate * 100).toFixed(1)}%`,
    `- 动线孤立卧室率（isolatedBedrooms 非空）：${(summary.isolatedBedroomRate * 100).toFixed(1)}%`,
    `- 碰撞率（collisions 非空）：${(summary.collisionRate * 100).toFixed(1)}%`,
    `- 家具问题率（furnitureIssues 非空）：${(summary.furnitureIssueRate * 100).toFixed(1)}%`,
    `- 家具未正确放置总数：${summary.furniturePlacementFailures}（其中重叠 ${summary.furnitureOverlapCount}，越界 ${summary.furnitureOutOfBoundsCount}）`,
    '',
  ]
  const failureEntries = Object.entries(summary.failureCodeCounts)
  if (failureEntries.length > 0) {
    lines.push('**失败原因分布（按 failureCode）**：' + failureEntries.map(([code, count]) => `${code}×${count}`).join('，'), '')
  }
  if (summary.caseConfigErrors.length > 0) {
    lines.push(`**用例配置错误（不是生成问题，是 case JSON 写错了）**：${summary.caseConfigErrors.join(', ')}`, '')
  }
  if (summary.bedroomCountMismatches.length > 0) {
    lines.push(`**卧室数量不符预期的用例**：${summary.bedroomCountMismatches.join(', ')}`, '')
  }
  if (summary.missingRoomTypeCases.length > 0) {
    lines.push(`**缺少预期房间类型的用例**：${summary.missingRoomTypeCases.join(', ')}`, '')
  }
  if (summary.forbiddenRoomTypeHits.length > 0) {
    lines.push(`**建出了不该建的房间类型（回归风险）**：${summary.forbiddenRoomTypeHits.join(', ')}`, '')
  }
  if (summary.zoneInspectionFailures.length > 0) {
    lines.push(`**场景 zone 读取失败（断言无法核实，直接计为失败）**：${summary.zoneInspectionFailures.join(', ')}`, '')
  }
  lines.push('## 逐用例结果', '')
  for (const result of results) {
    lines.push(`### ${result.caseId} · run ${result.repeatIndex}`)
    lines.push(
      `- 状态：${result.ok ? '成功' : '失败'}（工作流完成=${result.workflowCompleted ? '是' : '否'}，断言通过=${result.assertionsPassed ? '是' : '否'}）${result.error ? `（${result.error}）` : ''}`,
    )
    lines.push(`- 耗时：${result.elapsedMs}ms`)
    if (result.baseSceneId) lines.push(`- 基准场景：${result.baseSceneId}（工作副本：${result.workingSceneId ?? '—'}；原基准未被修改）`)
    if (result.editorUrl) lines.push(`- 场景：${result.editorUrl}`)
    if (result.sceneResult) {
      lines.push(
        `- 诊断：doorlessRooms=${result.sceneResult.doorlessRooms.length}, strayWindows=${result.sceneResult.strayWindows.length}, requirementMismatches=${result.sceneResult.requirementMismatches.length}, isolatedBedrooms=${result.sceneResult.isolatedBedrooms.length}, collisions=${result.sceneResult.collisions.length}`,
      )
    }
    if (result.furniture && result.furniture.total > 0) {
      lines.push(
        `- 家具问题：共 ${result.furniture.total}（重叠 ${result.furniture.overlapCount}，越界 ${result.furniture.outOfBoundsCount}，其他 ${result.furniture.otherCount}）`,
      )
    }
    if (result.assertionRollup) {
      const r = result.assertionRollup
      lines.push(`- 断言：pass ${r.passed} / fail ${r.failed} / unsupported ${r.unsupported}（全过=${r.allPassed ? '是' : '否'}）`)
    }
    if (result.assertions) {
      for (const a of result.assertions) {
        const mark = a.status === 'pass' ? '✓' : a.status === 'fail' ? '✗' : '?'
        const detail = [
          a.expected !== undefined ? `expected=${JSON.stringify(a.expected)}` : '',
          a.actual !== undefined ? `actual=${JSON.stringify(a.actual)}` : '',
          a.reason ? `原因=${a.reason}` : '',
        ].filter(Boolean).join('，')
        lines.push(`  - ${mark} ${a.name}${detail ? `：${detail}` : ''}`)
      }
    }
    if (!result.ok && result.failureCode) {
      lines.push(`- 失败：stage=${result.failureStage}，code=${result.failureCode}，模型请求数=${result.modelAttempts ?? '未知'}`)
      if (result.failureMessage) lines.push(`- 失败详情：${result.failureMessage}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

async function main(): Promise<void> {
  const { repeat, only, dryRun } = parseArgs()
  const allCases = loadCases()
  const cases = only ? allCases.filter(c => only.has(c.id)) : allCases
  if (cases.length === 0) {
    console.error('没有匹配到任何用例，检查 --only 参数或 eval/cases/ 目录。')
    process.exit(1)
  }

  if (dryRun) {
    runDryRun(cases, allCases)
    return
  }

  const config = loadConfig()
  const mcp = new PascalMcpClient(config)
  await mcp.connect()
  const agent = new PascalAiAgent(config, mcp)

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const reportDir = join(REPORT_ROOT, timestamp)
  const rawDir = join(reportDir, 'raw')
  mkdirSync(rawDir, { recursive: true })

  const sceneIdByCaseRepeat = new Map<string, string>()
  const results: CaseRunResult[] = []

  for (const testCase of cases) {
    for (let repeatIndex = 1; repeatIndex <= repeat; repeatIndex++) {
      const result = await runCase(agent, mcp, testCase, repeatIndex, sceneIdByCaseRepeat)
      results.push(result)
      if (result.ok && result.sceneId) {
        sceneIdByCaseRepeat.set(dependencySceneKey(testCase.id, repeatIndex), result.sceneId)
      }
      writeFileSync(join(rawDir, `${testCase.id}-run${repeatIndex}.json`), JSON.stringify(result, null, 2))
      logResult(result)
    }
  }

  const summary = buildSummary(results)
  writeFileSync(join(reportDir, 'summary.json'), JSON.stringify(summary, null, 2))
  writeFileSync(join(reportDir, 'summary.md'), renderSummaryMarkdown(summary, results))
  // Scaffold blank human-review templates (one per raw run) and drop the
  // review 手顺 into the report dir, so every run comes ready to review.
  const { created } = scaffoldReviews(reportDir)
  console.log(`\n报告已写入 ${reportDir}`)
  console.log(`已生成 ${created.length} 个评审模板到 reviews/，手顺见 REVIEW_GUIDE.md；填好后运行 bun run eval:review 汇总。`)

  await mcp.close()
  process.exit(summary.errorCount > 0 ? 1 : 0)
}

main().catch(error => {
  console.error('评测集运行失败：', error)
  process.exit(1)
})
