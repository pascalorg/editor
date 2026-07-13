import { END, START, StateGraph } from '@langchain/langgraph'
import { evaluateCompletionGates, type GateFailure, type GateReport, type GateWall } from './completion-gates'
import type { AppConfig } from './config'
import { detectLanguage, issueText, t, type Lang } from './lang/i18n'
import { classifySceneIntentFallback, isSceneQuestion, type SceneIntent } from './lang/intent-vocab'
import { resolveNormProfile } from './norms/profile'
import { deriveBriefFacts, deriveStrategy } from './strategy'
import {
  classifyRoomTypeByName,
  ROOM_NAME_PATTERNS,
  roomNamePattern,
  WINDOW_PATTERN,
} from './lang/room-vocab'
import { executeFurniturePlan, type FurnitureRoom } from './furniture-executor'
import { executeFurnitureModifyOps, type FurnitureModifyReport } from './furniture-modify'
import { partitionLayout } from './layout-partitioner'
import { applyModifyOps, parseModifyOps, resolveRoomRef, type FurnitureModifyOp } from './modify-ops'
import { computeLayoutQuality } from './layout-metrics'
import type { IssueL10n, LayoutPlan, RoomType } from './layout-plan'
import { PascalMcpClient } from './mcp'
import { OpenAiCompatibleClient, type RequestHooks } from './openai-compatible'
import { buildLayoutPlan, type PlanBuildResult } from './plan-builder'
import { validateLayoutPlan, type PlanTargets } from './plan-validator'
import { executeLayoutPlan, toolPayload, type SceneExecutionReport } from './scene-executor'

// Re-exported for eval/run-eval.ts, which historically imported it from here.
export { toolPayload }
import { SessionStore } from './session-store'
import type {
  Availability,
  ChatInput,
  ChatMessage,
  ChatResult,
  ConfirmationStatus,
  DesignBrief,
  FurniturePlacementIssue,
  InformationSource,
  PhaseToolTrace,
  RequirementFact,
  SceneResult,
  ToolCall,
  WorkflowSession,
} from './types'
import { WorkflowState, type WorkflowGraphState } from './workflow-state'

const EMPTY_BRIEF: DesignBrief = {
  existingCondition: [],
  designGoals: [],
  hardConstraints: [],
  assumptions: [],
  uncertainties: [],
  conflicts: [],
}

const SOURCE_VALUES = new Set<InformationSource>([
  'user',
  'system_recognition',
  'agent_inference',
  'default_assumption',
  'pending_confirmation',
])

const CONFIRMATION_VALUES = new Set<ConfirmationStatus>([
  'unconfirmed',
  'confirmed',
  'rejected',
])

// Structural scaffolding node types created automatically for every project.
// They exist even in a brand-new empty scene, so they must NOT count as
// "user content" when deciding whether a scene is safe to rebuild from
// scratch (see `countActiveContentNodes` / `shouldModifyExistingScene`).
const SCAFFOLDING_NODE_TYPES = new Set(['project', 'site', 'building', 'level', 'story', 'storey'])

// Appended to every non-delete modification request. The deterministic
// counterpart (checkModificationProtection) verifies the strict parts after
// the fact when the request asked for preservation; this prompt aims the
// model at the compliant construction pattern up front so the acceptance
// loop rarely has anything to catch.
const MODIFICATION_GUARD_PROMPT =
  '结构保护要求：这是对已有场景的增量修改，只做实现本次请求所必需的改动。'
  + '新增房间时优先让新隔墙与既有墙体拼接围合，不要移动、裁剪或删除既有墙体；'
  + '新开的门优先安排在新隔墙上；不要改动与本次请求无关的门窗和家具。'
  + '如果请求给出了新增房间的面积或数值范围，创建后必须用 get_zones 实测确认落在范围内再结束。'

// M1/M2 (docs/MODIFY_REDESIGN.md §3): translates a modify request into
// ModifyOps — the model's ONLY job on the plan-first modify path; every op
// is executed deterministically. Requests outside the op vocabulary (move a
// wall, reposition a door…) must come back as empty ops so they fall through
// to the legacy path.
const MODIFY_OPS_SYSTEM_PROMPT = `你是场景修改请求解析器。把用户请求翻译成结构化操作列表，只返回一个 JSON 对象，不要任何解释或 Markdown 代码块。
返回 {"ops":[...]}，每个 op 只能是以下七种：
  {"op":"add_room","room":{"name":"<房间名>","type":"<bedroom|living|living_kitchen|dining|kitchen|bathroom|study|storage|balcony|other>","targetAreaSqm":<可选，数字>},"near":"<可选，希望邻接的房间名>"}
  {"op":"remove_room","room":"<房间名>"}
  {"op":"resize_room","room":"<房间名>","targetAreaSqm":<数字>}
  {"op":"rename_room","room":"<房间名>","name":"<新名称>"}
  {"op":"add_furniture","room":"<房间名>","item":"<家具名>"}
  {"op":"remove_furniture","room":"<房间名>","item":"<家具名>"}
  {"op":"swap_furniture","room":"<房间名>","from":"<现有家具>","to":"<新家具>"}
规则：
- room/near 引用现有房间时必须使用房间清单里的名称原文；
- 用户的称呼与清单不同字面但指向明确时，翻译成清单名再输出：如清单是「卧室1/卧室2」这类编号名，主卧=卧室1、次卧=卧室2、依此类推（master/主人房→主卧，kids room/儿童房→次卧类推）；不要因称呼不同就返回空 ops；
- item/from/to 用简短通用词（如 沙发、书桌、床、衣柜），不要带修饰语；
- 一次请求可以输出多个 op，按用户叙述顺序排列；
- 只描述用户明确要求的改动，不要自作主张补充；
- 若请求超出以上七种操作能表达的范围（如移动某面墙、调整门窗位置、整体换风格），或你无法确定，返回 {"ops":[]}。`

// Thrown at a loop boundary inside a long-running generation/modification
// when the user has asked to cancel, so the in-flight work unwinds promptly
// instead of finishing a run the user no longer wants.
class GenerationCancelledError extends Error {
  constructor() {
    super('用户已取消本次生成')
    this.name = 'GenerationCancelledError'
  }
}

// Thrown when a single chat turn exceeds its model-call budget — an absolute
// safety ceiling against runaway cost/latency (normal jobs never hit it).
class BudgetExceededError extends Error {
  constructor(limit: number) {
    super(`Model call count exceeded the safety limit (${limit}) for this task; stopped automatically to avoid waste`)
    this.name = 'BudgetExceededError'
  }
}

type ExtractionResponse = {
  existingCondition?: unknown[]
  designGoals?: unknown[]
  hardConstraints?: unknown[]
  assumptions?: unknown[]
  uncertainties?: unknown[]
  conflicts?: unknown[]
  questions?: unknown[]
  overallConfidence?: unknown
  imageUsable?: unknown
  imageReason?: unknown
}

type Evaluation = {
  availability: Availability
  reasons: string[]
  questions: string[]
}

export { classifySceneIntentFallback, isSceneQuestion, type SceneIntent } from './lang/intent-vocab'

export class PascalAiAgent {
  private readonly model?: OpenAiCompatibleClient
  private readonly fallbackModel?: OpenAiCompatibleClient
  private readonly fastModel?: OpenAiCompatibleClient
  private readonly sessions: SessionStore
  private readonly graph: ReturnType<typeof createWorkflowGraph>
  private readonly sessionLocks = new Map<string, Promise<ChatResult>>()
  // Sessions with a cancel requested while a run is in flight. The running
  // generation polls this at loop boundaries (`throwIfCancelled`) and aborts.
  private readonly cancelRequests = new Set<string>()
  // Abort controller for the in-flight turn of each session, so a cancel can
  // interrupt the request that's actually running (model fetch or MCP call)
  // immediately, instead of only at the next loop boundary.
  private readonly runAbortControllers = new Map<string, AbortController>()
  // Per-turn model-call counter, keyed by sessionId for the duration of a
  // single `runChat`. Absent when no turn is running for that session.
  private readonly modelCallBudgets = new Map<string, number>()
  // The session's cumulative model-call total *before* the current turn, so
  // `chargeModelCall` can enforce the per-session ceiling in real time within
  // the turn rather than only at the next turn's boundary.
  private readonly sessionPriorTotals = new Map<string, number>()
  // Lazily-fetched, process-lifetime cache of the MCP `pascal://agent-guide`
  // resource. Read once; failures are swallowed so a missing/renamed
  // resource never breaks the main generation flow.
  private agentGuidePromise?: Promise<string | undefined>

  constructor(
    private readonly config: AppConfig,
    private readonly mcp: PascalMcpClient,
  ) {
    if (config.aiApiKey) {
      this.model = new OpenAiCompatibleClient({
        provider: config.aiProvider,
        apiKey: config.aiApiKey,
        baseUrl: config.aiBaseUrl,
        model: config.aiModel,
        referer: config.aiReferer,
        title: config.aiTitle,
        temperature: config.aiTemperature,
        azureDeployment: config.azureDeployment,
        azureApiVersion: config.azureApiVersion,
        requestTimeoutMs: config.aiRequestTimeoutMs,
      })
    }
    if (config.aiFallbackModel && (config.aiFallbackApiKey || config.aiApiKey)) {
      this.fallbackModel = new OpenAiCompatibleClient({
        provider: config.aiProvider,
        apiKey: config.aiFallbackApiKey ?? config.aiApiKey!,
        baseUrl: config.aiBaseUrl,
        model: config.aiFallbackModel,
        referer: config.aiReferer,
        title: `${config.aiTitle} fallback`,
        temperature: config.aiTemperature,
        azureDeployment: config.azureDeployment,
        azureApiVersion: config.azureApiVersion,
        requestTimeoutMs: config.aiRequestTimeoutMs,
      })
    }
    // Cheap/fast model for low-stakes classification (scene intent routing).
    // When AI_FAST_MODEL / OPENROUTER_FAST_MODEL is unset this equals the main
    // model, so tiering is opt-in and never regresses existing setups.
    if (config.aiApiKey && config.aiFastModel !== config.aiModel) {
      this.fastModel = new OpenAiCompatibleClient({
        provider: config.aiProvider,
        apiKey: config.aiApiKey,
        baseUrl: config.aiBaseUrl,
        model: config.aiFastModel,
        referer: config.aiReferer,
        title: `${config.aiTitle} fast`,
        temperature: config.aiTemperature,
        azureDeployment: config.aiProvider === 'azure-openai' ? config.aiFastModel : config.azureDeployment,
        azureApiVersion: config.azureApiVersion,
        requestTimeoutMs: config.aiRequestTimeoutMs,
      })
    }
    this.sessions = new SessionStore(config.sessionFile)
    this.graph = createWorkflowGraph({
      ingest: state => this.ingest(state),
      evaluate: state => this.evaluate(state),
      generate: state => this.generate(state),
      inspect: state => this.inspect(state),
      modify: state => this.modify(state),
    })
  }

  async chat(input: ChatInput): Promise<ChatResult> {
    // A cancel that arrives while a run is already in flight signals that run
    // to abort at its next loop boundary. Setting the flag here (before the
    // turn is even enqueued behind the lock) is what makes cancellation take
    // effect *during* generation instead of only after it finishes.
    if (input.action === 'cancel' && this.sessionLocks.has(input.sessionId)) {
      this.cancelRequests.add(input.sessionId)
      // Abort the request that's running right now (model fetch / MCP call)
      // so cancellation is immediate rather than waiting for it to return.
      this.runAbortControllers.get(input.sessionId)?.abort()
    }
    const previous = this.sessionLocks.get(input.sessionId) ?? Promise.resolve(undefined)
    const current = previous
      .catch(() => undefined)
      .then(() => this.runChat(input))
    this.sessionLocks.set(input.sessionId, current)
    try {
      return await current
    } finally {
      if (this.sessionLocks.get(input.sessionId) === current) {
        this.sessionLocks.delete(input.sessionId)
      }
    }
  }

  getSession(sessionId: string): WorkflowSession | undefined {
    return this.sessions.get(sessionId)
  }

  deleteSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId)
  }

  private async runChat(input: ChatInput): Promise<ChatResult> {
    const now = new Date().toISOString()
    const session = this.sessions.get(input.sessionId) ?? createSession(input, now)
    if (input.sceneId) session.sceneId = input.sceneId

    // Per-session cumulative cost ceiling. Cancel is always allowed through so
    // a user can still stop a session that has hit the limit.
    const priorTotal = session.modelCallsTotal ?? 0
    if (input.action !== 'cancel' && priorTotal >= this.config.maxModelCallsPerSession) {
      const reply = t(session.language, 'sessionCallLimit', {})
      session.updatedAt = new Date().toISOString()
      this.sessions.set(input.sessionId, session)
      return { sessionId: input.sessionId, reply, session }
    }

    this.modelCallBudgets.set(input.sessionId, 0)
    this.sessionPriorTotals.set(input.sessionId, priorTotal)
    this.runAbortControllers.set(input.sessionId, new AbortController())
    try {
      const result = await this.graph.invoke({ input, session, reply: '', next: 'evaluate' })
      // Fold this turn's API attempts into the session's running total.
      result.session.modelCallsTotal = priorTotal + (this.modelCallBudgets.get(input.sessionId) ?? 0)
      result.session.updatedAt = new Date().toISOString()
      this.sessions.set(input.sessionId, result.session)
      return { sessionId: input.sessionId, reply: result.reply, session: result.session }
    } finally {
      this.modelCallBudgets.delete(input.sessionId)
      this.sessionPriorTotals.delete(input.sessionId)
      this.runAbortControllers.delete(input.sessionId)
      this.cancelRequests.delete(input.sessionId)
    }
  }

  private throwIfCancelled(sessionId: string): void {
    if (this.cancelRequests.has(sessionId)) throw new GenerationCancelledError()
  }

  // Single MCP entry point: injects the current turn's cancel signal so a
  // cancel aborts whatever MCP call is in flight, not just model requests.
  // All agent MCP calls go through here so cancellation and timeout behaviour
  // is uniform.
  private callMcp(sessionId: string, name: string, args: Record<string, unknown>): Promise<unknown> {
    const signal = this.runAbortControllers.get(sessionId)?.signal
    return this.mcp.callTool(name, args, { signal })
  }

  // Counts one model API attempt against both the per-turn and the cumulative
  // per-session budgets, throwing once either ceiling is crossed. A no-op when
  // no budget is registered (e.g. calls made outside a `runChat`), so it can
  // never break such callers.
  private chargeModelCall(sessionId: string): void {
    const used = this.modelCallBudgets.get(sessionId)
    if (used === undefined) return
    const next = used + 1
    this.modelCallBudgets.set(sessionId, next)
    if (next > this.config.maxModelCallsPerTurn) {
      throw new BudgetExceededError(this.config.maxModelCallsPerTurn)
    }
    const priorTotal = this.sessionPriorTotals.get(sessionId) ?? 0
    if (priorTotal + next > this.config.maxModelCallsPerSession) {
      throw new BudgetExceededError(this.config.maxModelCallsPerSession)
    }
  }

  private async ingest(state: WorkflowGraphState): Promise<Partial<WorkflowGraphState>> {
    const { input } = state
    const session = structuredClone(state.session)

    // Reply language follows the user's latest message (kana→ja, han→zh,
    // else en). A confirm/cancel action carries no text — keep the previous
    // detection so a bare confirmation doesn't flip the language to English.
    if (input.message?.trim()) {
      session.language = detectLanguage(input.message, session.language)
    }

    // Pure state-machine core decides the turn and applies I/O-free
    // transitions; only the delegation markers below need MCP/model calls.
    const plan = planIngestAction(input, session)
    if (plan.kind === 'reply') return { session, reply: plan.reply, next: 'finish' }
    if (plan.kind === 'route') return { session, reply: plan.reply, next: plan.next }
    if (plan.kind === 'route-existing') return this.routeExistingSceneRequest(session, plan.message)
    const message = plan.message

    if (session.phase === 'intake' && session.sceneId && message) {
      try {
        await this.callMcp(session.sessionId, 'load_scene', { id: session.sceneId })
        const contentNodes = await this.countActiveContentNodes(session.sessionId)
        if (shouldModifyExistingScene(contentNodes)) {
          return this.routeExistingSceneRequest(session, message)
        }
      } catch (error) {
        const reply = t(session.language, 'sceneLoadFailed', { sceneId: session.sceneId, error: errorMessage(error) })
        session.messages.push({ role: 'assistant', content: reply })
        return { session, reply, next: 'finish' }
      }
    }

    session.inputType = input.imageDataUrl ? 'image' : session.inputType
    session.messages.push({ role: 'user', content: message || '[上传户型图]' })

    try {
      const extracted = await this.extractRequirements(session, message, input.imageDataUrl)
      session.brief = mergeBrief(session.brief, extracted)
      session.questions = stringArray(extracted.questions).slice(0, 3)
      if (session.phase === 'clarifying') session.clarificationRounds++
      return { session, reply: '', next: 'evaluate' }
    } catch (error) {
      session.phase = 'failed'
      const reply = t(session.language, 'briefParseFailed', { error: errorMessage(error) })
      // Record the failure reply so the eval harness and the /sessions
      // recovery endpoint can read the real reason instead of an empty tail.
      session.messages.push({ role: 'assistant', content: reply })
      return { session, reply, next: 'finish' }
    }
  }

  private async inspect(state: WorkflowGraphState): Promise<Partial<WorkflowGraphState>> {
    const session = structuredClone(state.session)
    const question = state.input.message?.trim() ?? ''
    const sceneId = session.sceneResult?.sceneId ?? session.sceneId
    if (!sceneId) {
      session.phase = 'failed'
      return { session, reply: t(session.language, 'inspectNoScene', {}), next: 'finish' }
    }
    try {
      await this.callMcp(session.sessionId, 'load_scene', { id: sceneId })
      const reply = await this.answerSceneQuestion(session, question)
      session.phase = session.sceneResult?.remainingIssueCount
        ? 'completed_with_issues'
        : 'completed'
      session.messages.push({ role: 'assistant', content: reply })
      return { session, reply, next: 'finish' }
    } catch (error) {
      session.phase = 'completed_with_issues'
      const reply = t(session.language, 'inspectFailed', { error: errorMessage(error) })
      session.messages.push({ role: 'assistant', content: reply })
      return { session, reply, next: 'finish' }
    }
  }

  private async routeExistingSceneRequest(
    session: WorkflowSession,
    message: string,
  ): Promise<Partial<WorkflowGraphState>> {
    session.messages.push({ role: 'user', content: message })
    const intent = await this.classifySceneIntent(session, message)
    if (intent === 'query') {
      session.phase = 'inspecting'
      return { session, reply: t(session.language, 'inspectStarting', {}), next: 'inspect' }
    }
    if (intent === 'ambiguous') {
      session.phase = session.sceneResult?.remainingIssueCount
        ? 'completed_with_issues'
        : 'completed'
      const reply = t(session.language, 'sceneIntentAmbiguous', {})
      session.messages.push({ role: 'assistant', content: reply })
      return { session, reply, next: 'finish' }
    }

    session.pendingModification = message
    session.pendingOperation = intent
    // A new request invalidates a drift acknowledgement issued for the
    // previous one (MODIFY_REDESIGN.md §6).
    delete session.modifyDriftConfirmed
    // 删除是破坏性的，可能级联移除关联节点，保留二次确认；新增/修改都通过
    // apply_patch 完成、可撤销，直接执行以免每次微调都要多一次确认往返。
    if (intent === 'delete') {
      session.phase = 'awaiting_modification_confirmation'
      const reply = t(session.language, 'deleteConfirm', { message })
      session.messages.push({ role: 'assistant', content: reply })
      return { session, reply, next: 'finish' }
    }
    session.phase = 'modifying'
    const reply = intent === 'create'
      ? t(session.language, 'sceneCreateStarting', { message })
      : t(session.language, 'sceneUpdateStarting', { message })
    session.messages.push({ role: 'assistant', content: reply })
    return { session, reply, next: 'modify' }
  }

  private async classifySceneIntent(session: WorkflowSession, message: string): Promise<SceneIntent> {
    try {
      // Exclude the last entry: it's `message` itself, already pushed to
      // session.messages by the caller before this runs.
      const history = recentConversationText(session.messages.slice(0, -1))
      const result = await this.withFastModel(session.sessionId, (model, hooks) =>
        model.json<{ intent?: unknown }>(
          [
            {
              role: 'system',
              content: 'Classify a request about an existing architectural scene. Use the recent conversation to resolve references like pronouns, "that one", or "same as before". Return JSON only: {"intent":"query|create|update|delete|ambiguous"}. Query must be read-only. Use ambiguous when the requested action or target is unclear even with context.',
            },
            {
              role: 'user',
              content: history
                ? `Recent conversation:\n${history}\n\nLatest message to classify: ${message}`
                : message,
            },
          ],
          'scene-intent',
          hooks,
        ),
      )
      if (isSceneIntent(result.intent)) return result.intent
    } catch {
      // Deterministic routing remains available when the model is temporarily unavailable.
    }
    return classifySceneIntentFallback(message)
  }

  private async evaluate(state: WorkflowGraphState): Promise<Partial<WorkflowGraphState>> {
    const session = structuredClone(state.session)
    const evaluation = evaluateBrief(session.brief, session.inputType, this.config, session.language)
    session.availability = evaluation.availability
    session.reasons = evaluation.reasons
    session.questions = dedupe([...session.questions, ...evaluation.questions]).slice(0, 3)

    if (evaluation.availability === 'unusable') {
      session.phase = 'failed'
      const reply = [
        '当前输入不可用，暂时不会生成户型。',
        ...evaluation.reasons.map(reason => `- ${reason}`),
        '请补充文字需求或上传边界完整、清晰的户型图。',
      ].join('\n')
      session.messages.push({ role: 'assistant', content: reply })
      return { session, reply, next: 'finish' }
    }

    if (evaluation.availability === 'partially_usable') {
      session.phase = 'clarifying'
      const reachedLimit = session.clarificationRounds >= this.config.maxClarificationRounds
      const questions = session.questions.length > 0
        ? session.questions
        : [t(session.language, 'clarifyDefault', {})]
      const numbered = questions.map((question, index) => `${index + 1}. ${question}`).join('\n')
      const reply = reachedLimit
        ? t(session.language, 'clarifyAtLimit', { questions: numbered })
        : t(session.language, 'clarifyAsk', { questions: numbered })
      session.messages.push({ role: 'assistant', content: reply })
      return { session, reply, next: 'finish' }
    }

    session.phase = 'awaiting_confirmation'
    // `session.summary` 仍用结构化摘要（含来源/置信度），它会作为 brief 传给
    // 生成模型，结构信息对生成质量有用；面向用户展示的是自然语言版本。
    session.summary = formatSummary(session.brief)
    const reply = t(session.language, 'confirmPrompt', {
      summary: formatUserFacingSummary(session.brief, session.language),
    })
    session.messages.push({ role: 'assistant', content: reply })
    return { session, reply, next: 'finish' }
  }

  private async generate(state: WorkflowGraphState): Promise<Partial<WorkflowGraphState>> {
    const session = structuredClone(state.session)
    // If this attempt goes down the fresh-build branch (no existing scene,
    // or `session.sceneId` gets overwritten by a newly created project
    // below) and then fails partway through construction, `session.sceneId`
    // would otherwise be left pointing at that broken half-built scene. A
    // retry would then see a real scene with plenty of nodes in it and
    // mistake it for a legitimate existing project — routing into
    // `applyConfirmedBriefToExistingScene` (incremental patch) instead of a
    // clean rebuild. Remember what it was before this attempt so the catch
    // block can roll it back.
    const priorSceneId = session.sceneId
    try {
      session.executionSteps = []
      session.toolTrace = []
      // Persist the `generating` phase up front. Session state is otherwise
      // only written at the very end of the turn, so a crash mid-generation
      // would leave the stored phase stuck at `awaiting_confirmation` with no
      // trace that a build was underway. This snapshot makes the in-progress
      // (and any later abandoned scene) state diagnosable after a restart.
      this.sessions.set(session.sessionId, session)
      const generationArgs = buildGenerationArgs(session)
      if (session.sceneId) {
        const loaded = toolPayload(await this.callMcp(session.sessionId, 'load_scene', { id: session.sceneId }))
        // Decide by real content nodes, not raw nodeCount: a scene that only
        // holds structural scaffolding (project/site/building/level) is
        // genuinely empty and safe to build fresh, but a scene with even one
        // user-drawn wall must be modified incrementally — never cleared and
        // rebuilt, which would silently destroy the user's existing work.
        const contentNodes = await this.countActiveContentNodes(session.sessionId)
        if (shouldModifyExistingScene(contentNodes)) {
          return await this.applyConfirmedBriefToExistingScene(session, loaded)
        }
        const expectedVersion = nullableNumber(loaded.version)
        if (expectedVersion !== null) generationArgs.expectedVersion = expectedVersion
      }
      // Steps ①–③ (GENERATION_REDESIGN.md §1): intent → deterministic
      // partition → validation, all before any Pascal scene exists. A brief
      // that can't produce a valid plan fails right here — zero abandoned
      // scenes, and the confirmed requirements survive for a retry.
      let planned = await this.buildPlanForSession(session)
      if (!planned.ok) {
        session.phase = 'failed'
        const { failures, failuresL10n } = planned
        const reply = t(session.language, 'planRejected', {
          rounds: planned.modelCalls,
          list: failures
            .map((failure, index) =>
              `- ${renderPlanFailure(failure, failuresL10n[index] ?? null, session.language ?? 'en')}`)
            .join('\n'),
        })
        session.messages.push({ role: 'assistant', content: reply })
        return { session, reply, next: 'finish' }
      }
      if (planned.intent) session.layoutIntent = planned.intent
      session.layoutPlan = planned.plan
      this.sessions.set(session.sessionId, session)

      // ④ scaffolding only (project/site/building/level) — the template rooms
      // it drops in are cleared and the plan's rooms are built by the
      // deterministic executor instead.
      const created = toolPayload(
        await this.callMcp(session.sessionId, 'create_house_from_brief', generationArgs),
      )
      session.sceneId = nullableString(created.projectId ?? created.sceneId ?? created.id) ?? undefined
      const levelId = nullableString(created.defaultLevelId)
      const persistAfterRound = async (valid: boolean) => {
        await this.persistScene(session.sessionId, session.sceneId, valid, nullableNumber(created.version))
      }
      await this.clearLevelForRebuild(session, levelId)
      let construction = await this.constructScenePlanFirst(session, levelId, planned.plan, { persistAfterRound })

      // §5 失败分流：structural gate failures go back to the plan layer once.
      // The acceptance facts are quoted into a fresh intent prompt; if the
      // replan passes validation the level is cleared and rebuilt. A failed
      // replan keeps the first build (reported honestly below) rather than
      // trading a flawed scene for no scene.
      if (construction.structuralFailures.length > 0) {
        const replanned = await this.buildPlanForSession(session, construction.structuralFailures)
        if (replanned.ok) {
          planned = replanned
          if (replanned.intent) session.layoutIntent = replanned.intent
          session.layoutPlan = replanned.plan
          this.sessions.set(session.sessionId, session)
          await this.clearLevelForRebuild(session, levelId)
          construction = await this.constructScenePlanFirst(session, levelId, planned.plan, { persistAfterRound })
        }
      }

      const { diagnostics, repairRounds, toolNamesUsed, furnitureIssues, executionIssues } = construction
      const sceneVersion = await this.persistScene(
        session.sessionId,
        session.sceneId,
        diagnostics.validation.valid,
        nullableNumber(created.version),
      )

      const sceneResult: SceneResult = {
        sceneId: nullableString(created.projectId ?? created.sceneId ?? created.id),
        editorUrl: publicEditorUrl(nullableString(created.projectId ?? created.sceneId ?? created.id)),
        version: sceneVersion,
        validation: diagnostics.validation,
        verificationIssues: diagnostics.verificationIssues,
        collisions: diagnostics.collisions,
        doorlessRooms: diagnostics.doorlessRooms,
        strayWindows: diagnostics.strayWindows,
        requirementMismatches: diagnostics.requirementMismatches,
        isolatedBedrooms: diagnostics.isolatedBedrooms,
        furnitureIssues,
        furniturePlacement: diagnostics.furniturePlacementIssues,
        repairRounds,
        remainingIssueCount: countAllIssues(diagnostics, furnitureIssues),
        executionIssues: [...executionIssues, ...construction.structureViolations],
        modelCallsUsed: (session.toolTrace ?? []).reduce((sum, trace) => sum + trace.modelCalls, 0),
        gateFailures: construction.gates.failures.map(failure => failure.message),
        layoutQuality: construction.layoutQuality,
        furniture: construction.furnitureCounts,
      }
      session.sceneResult = sceneResult
      // §5 hard gates: `completed` requires zero remaining issues AND every
      // gate passing — a scene missing a required room can no longer be
      // labeled done just because the repair loop ran out of findings.
      const remaining = sceneResult.remainingIssueCount
      session.phase = remaining === 0 && construction.gates.passed
        ? 'completed'
        : 'completed_with_issues'
      const reply = buildCompletionReply({
        lang: session.language ?? 'en',
        successText: t(session.language, 'generateSuccess', { url: sceneResult.editorUrl }),
        repairRounds,
        diagnostics,
        toolNamesUsed,
        furnitureIssues,
        gateFailures: construction.gates.failures,
      })
      session.messages.push({ role: 'assistant', content: reply })
      return { session, reply, next: 'finish' }
    } catch (error) {
      // Only roll back when this attempt actually reassigned sceneId (the
      // fresh-build branch). A failure while modifying a genuinely
      // pre-existing scene never touches session.sceneId, so priorSceneId
      // still matches and this is a no-op — the real project reference is
      // never disturbed.
      if (session.sceneId !== priorSceneId) {
        // The half-built scene is abandoned, not deleted — record it so
        // it's not just silently orphaned in storage with no trace.
        if (session.sceneId) {
          session.abandonedSceneIds = [...(session.abandonedSceneIds ?? []), session.sceneId]
          console.warn(`[pascal-ai-mcp] abandoned half-built scene ${session.sceneId} after generate() failure:`, error)
        }
        session.sceneId = priorSceneId
      }
      if (error instanceof GenerationCancelledError) {
        session.phase = 'cancelled'
        const reply = t(session.language, 'generateCancelled', {})
        session.messages.push({ role: 'assistant', content: reply })
        return { session, reply, next: 'finish' }
      }
      session.phase = 'failed'
      const reply = t(session.language, 'generateFailed', { error: errorMessage(error) })
      session.messages.push({ role: 'assistant', content: reply })
      return { session, reply, next: 'finish' }
    }
  }

  private async applyConfirmedBriefToExistingScene(
    session: WorkflowSession,
    loaded: Record<string, unknown>,
  ): Promise<Partial<WorkflowGraphState>> {
    const sceneId = session.sceneId!
    const { diagnostics, repairRounds, toolNamesUsed, furnitureIssues } = await this.refineAndDiagnose(
      session,
      '在当前已有户型的基础上实现已确认需求。现有墙体、房间和开口是源数据；只做满足需求所必需的增量修改，禁止用模板替换整个场景，禁止删除无关结构。',
      { phaseLabel: '在已有户型上应用已确认需求' },
    )
    const sceneVersion = await this.persistScene(
      session.sessionId,
      sceneId,
      diagnostics.validation.valid,
      nullableNumber(loaded.version),
    )
    const remainingIssueCount = countAllIssues(diagnostics, furnitureIssues)
    // §6 接线 2：门槛是场景性质，与怎么建出来无关 — the incremental path is
    // judged by the same hard gates as a fresh build.
    const gates = await this.evaluateGates(session)
    session.sceneResult = {
      sceneId,
      editorUrl: publicEditorUrl(sceneId),
      version: sceneVersion,
      validation: diagnostics.validation,
      verificationIssues: diagnostics.verificationIssues,
      collisions: diagnostics.collisions,
      doorlessRooms: diagnostics.doorlessRooms,
      strayWindows: diagnostics.strayWindows,
      requirementMismatches: diagnostics.requirementMismatches,
      isolatedBedrooms: diagnostics.isolatedBedrooms,
      furnitureIssues,
      furniturePlacement: diagnostics.furniturePlacementIssues,
      repairRounds,
      remainingIssueCount,
      modelCallsUsed: (session.toolTrace ?? []).reduce((sum, trace) => sum + trace.modelCalls, 0),
      gateFailures: gates.report.failures.map(failure => failure.message),
      layoutQuality: gates.layoutQuality,
    }
    session.phase = remainingIssueCount === 0 && gates.report.passed
      ? 'completed'
      : 'completed_with_issues'
    const reply = buildCompletionReply({
      lang: session.language ?? 'en',
      successText: t(session.language, 'applyToExistingSuccess', {}),
      repairRounds,
      diagnostics,
      toolNamesUsed,
      furnitureIssues,
      gateFailures: gates.report.failures,
    })
    session.messages.push({ role: 'assistant', content: reply })
    return { session, reply, next: 'finish' }
  }

  private async modify(state: WorkflowGraphState): Promise<Partial<WorkflowGraphState>> {
    const session = structuredClone(state.session)
    const feedback = session.pendingModification ?? state.input.message?.trim() ?? ''
    const operation = session.pendingOperation ?? 'update'
    const sceneId = session.sceneResult?.sceneId ?? session.sceneId
    if (!sceneId) {
      session.phase = 'failed'
      return {
        session,
        reply: t(session.language, 'modifyNoScene', {}),
        next: 'finish',
      }
    }

    try {
      session.toolTrace = []
      // Persist the `modifying` phase up front so a crash mid-edit is
      // diagnosable rather than leaving the stored phase at its pre-edit value.
      this.sessions.set(session.sessionId, session)
      const loaded = toolPayload(await this.callMcp(session.sessionId, 'load_scene', { id: sceneId }))
      // Plan-first modify (docs/MODIFY_REDESIGN.md §2): one model call
      // translates the request into ModifyOps; furniture ops run the
      // deterministic executor, structural ops edit the intent and
      // re-partition under the stability constraint. Requests outside the op
      // vocabulary (and legacy scenes without an intent snapshot, for
      // structural asks) fall through to the legacy free-edit path.
      // PASCAL_MODIFY_LEGACY=1 forces the old free-edit path (comparison
      // experiments only — same posture as AI_PLAN_LLM_GEOMETRY, deliberately
      // not in AppConfig; the switch retires with batch M3's online eval).
      if (operation === 'update' && process.env.PASCAL_MODIFY_LEGACY !== '1') {
        const fastPath = await this.tryPlanFirstModify(session, feedback, sceneId, nullableNumber(loaded.version))
        if (fastPath) return fastPath
      }
      // Pre-edit snapshot: drives the deterministic protection acceptance
      // below and marks every pre-existing wall read-only for the dedupe.
      // Delete operations are exempt — removing existing structure is their
      // entire point.
      const isDeleteOperation = operation === 'delete'
      const beforeNodes = isDeleteOperation
        ? {}
        : snapshotSceneNodes(toolPayload(await this.callMcp(session.sessionId, 'get_scene', {})))
      const protectedWallIds = new Set(
        Object.entries(beforeNodes).filter(([, node]) => node.type === 'wall').map(([id]) => id),
      )
      const levelId = Object.entries(beforeNodes).find(([, node]) => node.type === 'level')?.[0] ?? null
      // §6 接线 1：把生成时的 layoutPlan 快照作为事实来源注入（房间清单、
      // 面积、连通关系），替代模型自己 get_walls 摸底——增量修改破坏既有
      // 房间连通（case-13）正是缺这份事实导致的。
      const planSnapshot = session.layoutPlan && !isDeleteOperation
        ? `\n${formatPlanSnapshot(session.layoutPlan)}`
        : ''
      const purpose = isDeleteOperation
        ? `用户已确认对当前场景执行${operation}操作：${feedback}`
        : `用户已确认对当前场景执行${operation}操作：${feedback}\n${MODIFICATION_GUARD_PROMPT}${planSnapshot}`
      const phase = await this.runPhaseToConvergence(
        session,
        purpose,
        undefined,
        new Set<string>(),
        [],
        '按用户要求修改场景',
      )
      // create_room on an existing scene leaves coincident duplicate walls
      // along shared boundaries, exactly like fresh generation — but here the
      // original walls are read-only: only this turn's new walls may be
      // deleted or clipped to resolve an overlap.
      if (!isDeleteOperation) {
        await this.dedupeSharedWalls(session.sessionId, levelId, protectedWallIds)
      }
      const extraChecks = isDeleteOperation
        ? undefined
        : async () => {
            const afterNodes = snapshotSceneNodes(
              toolPayload(await this.callMcp(session.sessionId, 'get_scene', {})),
            )
            return checkModificationProtection(beforeNodes, afterNodes, feedback)
          }
      const { diagnostics, repairRounds, toolNamesUsed, furnitureIssues } = await this.refineAndDiagnose(
        session,
        purpose,
        {
          skipInitialAgent: true,
          conversation: phase.messages,
          toolNamesUsed: phase.toolNamesUsed,
          furnitureIssues: phase.furnitureIssues,
          ...(extraChecks ? { extraChecks } : {}),
        },
      )
      const sceneVersion = await this.persistScene(
        session.sessionId,
        sceneId,
        diagnostics.validation.valid,
        nullableNumber(loaded.version),
      )
      const remainingIssueCount = countAllIssues(diagnostics, furnitureIssues)
      // §6 接线 2：modify runs through the same completion gates as fresh
      // generation — the phase is a statement about the scene, not the path.
      const gates = await this.evaluateGates(session)
      session.sceneResult = {
        sceneId,
        editorUrl: publicEditorUrl(sceneId),
        version: sceneVersion,
        validation: diagnostics.validation,
        verificationIssues: diagnostics.verificationIssues,
        collisions: diagnostics.collisions,
        doorlessRooms: diagnostics.doorlessRooms,
        strayWindows: diagnostics.strayWindows,
        requirementMismatches: diagnostics.requirementMismatches,
        isolatedBedrooms: diagnostics.isolatedBedrooms,
        furnitureIssues,
        furniturePlacement: diagnostics.furniturePlacementIssues,
        repairRounds,
        remainingIssueCount,
        modelCallsUsed: (session.toolTrace ?? []).reduce((sum, trace) => sum + trace.modelCalls, 0),
        gateFailures: gates.report.failures.map(failure => failure.message),
        layoutQuality: gates.layoutQuality,
      }
      session.phase = remainingIssueCount === 0 && gates.report.passed
        ? 'completed'
        : 'completed_with_issues'
      delete session.pendingModification
      delete session.pendingOperation
      const reply = buildCompletionReply({
        lang: session.language ?? 'en',
        successText: t(session.language, 'modifySuccess', {}),
        repairRounds,
        diagnostics,
        toolNamesUsed,
        furnitureIssues,
        gateFailures: gates.report.failures,
      })
      session.messages.push({ role: 'assistant', content: reply })
      return { session, reply, next: 'finish' }
    } catch (error) {
      if (error instanceof GenerationCancelledError) {
        // Leave pendingModification/pendingOperation and phase intact so the
        // user can re-confirm the same change later; the scene was not saved.
        session.phase = 'awaiting_modification_confirmation'
        const reply = t(session.language, 'modifyCancelled', {})
        session.messages.push({ role: 'assistant', content: reply })
        return { session, reply, next: 'finish' }
      }
      // `pendingModification`/`pendingOperation` are never cleared on this
      // path, but that alone doesn't make them resumable: `ingest()` only
      // re-triggers `modify` from an explicit `{action:'confirm'}` while
      // `phase === 'awaiting_modification_confirmation'`. Route back to that
      // phase here so a plain confirm actually retries the *same* pending
      // request instead of the reply's "保留，可以稍后重试" being an empty
      // promise the user can only fulfill by redescribing the change from
      // scratch.
      const recovery = modifyFailureRecovery(Boolean(session.pendingModification), Boolean(session.sceneResult))
      session.phase = recovery.phase
      const reply = recovery.canRetry
        ? t(session.language, 'modifyFailedRetry', { error: errorMessage(error) })
        : t(session.language, 'modifyFailedNoRetry', { error: errorMessage(error) })
      session.messages.push({ role: 'assistant', content: reply })
      return { session, reply, next: 'finish' }
    }
  }

  // Plan-first modify (docs/MODIFY_REDESIGN.md §2, batches M1+M2). Returns
  // null when the request can't be expressed as ModifyOps (or a structural
  // ask hits a legacy scene without snapshots) — the caller then continues
  // down the legacy path. Throws (cancellation, model outage) propagate to
  // modify()'s catch, which owns the retry phase bookkeeping.
  private async tryPlanFirstModify(
    session: WorkflowSession,
    feedback: string,
    sceneId: string,
    loadedVersion: number | null,
  ): Promise<Partial<WorkflowGraphState> | null> {
    // Live room list from zones; types come from the authoritative map when
    // the scene was built plan-first, name classification otherwise — so the
    // furniture path also works for legacy scenes without an intent snapshot.
    const zonesPayload = toolPayload(await this.callMcp(session.sessionId, 'get_zones', {}))
    const zones = Array.isArray(zonesPayload.zones) ? zonesPayload.zones.filter(isZoneSummary) : []
    if (zones.length === 0) return null
    const rooms: FurnitureRoom[] = zones.map(zone => ({
      id: zone.id,
      name: zone.name,
      type: session.zoneRoomTypes?.[zone.id] ?? classifyRoomTypeByName(zone.name),
      polygon: zone.polygon,
      zoneId: zone.id,
    }))

    const trace = startPhaseTrace(session, '规划式修改（确定性执行器）')
    const traceMcp = async (name: string, args: Record<string, unknown>) => {
      const result = await this.callMcp(session.sessionId, name, args)
      trace.toolCounts[name] = (trace.toolCounts[name] ?? 0) + 1
      trace.toolCalls.push({ name, ok: true })
      return result
    }
    const beforeCall = () => this.throwIfCancelled(session.sessionId)

    // Parse failures get one correction retry with the error list fed back
    // (MODIFY_REDESIGN.md §2: 解析失败 → 修正 prompt 重试 ≤2 轮) — falling to
    // legacy on a transient formatting slip would silently downgrade a clean
    // furniture request to the free-edit path.
    const userContent = `当前房间清单：${rooms.map(room => room.name).join('、')}\n用户请求：${feedback}`
    let parsed: ReturnType<typeof parseModifyOps> | null = null
    for (let attempt = 0; attempt < 2; attempt++) {
      trace.modelCalls++
      const raw = await this.withModelFallback(session.sessionId, (model, hooks) =>
        model.complete([
          { role: 'system', content: MODIFY_OPS_SYSTEM_PROMPT },
          {
            role: 'user',
            content: attempt === 0 || !parsed
              ? userContent
              : `${userContent}\n上一次输出解析失败：${parsed.errors.join('；')}。请严格按 schema 修正后重新只输出 JSON。`,
          },
        ], `${session.sessionId}:modify:ops`, { ...hooks, temperature: this.config.aiTemperatureGeometry }),
      )
      parsed = parseModifyOps(raw)
      // Only parse DEFECTS warrant a retry; an empty-ops answer with no
      // errors is the translator deliberately saying "out of scope".
      if (parsed.errors.length === 0) break
    }
    // Empty ops is the translator's "out of vocabulary / not sure" signal;
    // persistent parse defects mean this isn't a clean request — both defer
    // to the legacy path.
    if (!parsed?.plan || parsed.errors.length > 0) return null

    const furnitureOnly = parsed.plan.ops.every(op =>
      op.op === 'add_furniture' || op.op === 'remove_furniture' || op.op === 'swap_furniture')
    if (furnitureOnly) {
      const levelId = await this.findLevelId(session)
      if (!levelId) return null
      const report = await executeFurnitureModifyOps({
        ops: parsed.plan.ops as FurnitureModifyOp[],
        rooms,
        levelId,
        callMcp: traceMcp,
        beforeCall,
      })
      trace.converged = true
      return this.finishPlanFirstModify(session, sceneId, loadedVersion, trace, {
        okDetails: report.results.filter(r => r.ok).map(r => r.detail),
        failedDetails: report.results.filter(r => !r.ok).map(r => r.detail),
      })
    }

    // --- structural / rename path (M2) — needs the plan-first snapshots ---
    if (!session.layoutIntent || !session.layoutPlan) return null
    // §6 manual-edit policy (方案 A): a structural rebuild would overwrite
    // hand edits, so a detected drift warns once and proceeds only after the
    // user confirms the SAME pending request. Furniture ops never get here.
    if (sceneDriftedFromPlan(zones, session.layoutPlan)) {
      if (!session.modifyDriftConfirmed) {
        session.modifyDriftConfirmed = true
        session.phase = 'awaiting_modification_confirmation'
        const reply = t(session.language, 'modifyDriftWarning', {})
        session.messages.push({ role: 'assistant', content: reply })
        return { session, reply, next: 'finish' }
      }
    }
    delete session.modifyDriftConfirmed
    const profile = resolveNormProfile(this.config.normProfile)
    // Rename pairs resolve against the PRE-edit intent (old name → zone).
    const renames = parsed.plan.ops.flatMap(op => {
      if (op.op !== 'rename_room') return []
      const resolved = resolveRoomRef(op.room, session.layoutIntent!.rooms)
      return 'room' in resolved ? [{ oldName: resolved.room.name, newName: op.name }] : []
    })
    const applied = applyModifyOps(session.layoutIntent, parsed.plan, profile)
    if (applied.errors.length > 0) return this.rejectPlanFirstModify(session, applied.errors)

    if (!applied.structural) {
      // rename (± furniture) only — no re-partition (§3): zone rename is a
      // metadata patch, everything else stays untouched.
      const zoneIdByName = new Map(zones.map(zone => [zone.name, zone.id]))
      const patches = renames.flatMap(entry => {
        const zoneId = zoneIdByName.get(entry.oldName)
        return zoneId ? [{ op: 'update', id: zoneId, data: { name: entry.newName } }] : []
      })
      if (patches.length > 0) await traceMcp('apply_patch', { patches })
      session.layoutIntent = applied.intent
      // Keep the plan snapshot's names in step, or the rename would read as
      // drift on the next structural modify.
      session.layoutPlan = {
        ...session.layoutPlan,
        rooms: session.layoutPlan.rooms.map(room => {
          const entry = renames.find(rename => rename.oldName === room.name)
          return entry ? { ...room, name: entry.newName } : room
        }),
      }
      let furnReport: FurnitureModifyReport | null = null
      if (applied.furnitureOps.length > 0) {
        const levelId = await this.findLevelId(session)
        if (!levelId) return null
        furnReport = await executeFurnitureModifyOps({
          ops: applied.furnitureOps,
          rooms,
          levelId,
          callMcp: traceMcp,
          beforeCall,
        })
      }
      trace.converged = true
      return this.finishPlanFirstModify(session, sceneId, loadedVersion, trace, {
        okDetails: [...applied.notes, ...(furnReport?.results.filter(r => r.ok).map(r => r.detail) ?? [])],
        failedDetails: furnReport?.results.filter(r => !r.ok).map(r => r.detail) ?? [],
      })
    }

    // Re-partition the edited intent under the stability constraint (§4),
    // validate, then rebuild the scene deterministically (§6: v1 = full
    // structural rebuild, zero model calls).
    const intent = applied.intent
    const requiredRooms = [...intent.rooms.reduce((acc, room) => {
      acc.set(room.type, (acc.get(room.type) ?? 0) + 1)
      return acc
    }, new Map<RoomType, number>())].map(([type, count]) => ({ type, count }))
    const targets: PlanTargets = { totalAreaSqm: intent.targetTotalAreaSqm, requiredRooms }
    const briefSummary = session.summary || formatSummary(session.brief)
    const strategy = deriveStrategy(deriveBriefFacts(briefSummary), targets, profile)
    const partition = partitionLayout(intent, profile, strategy, { previousPlan: session.layoutPlan })
    if (!partition.ok) {
      return this.rejectPlanFirstModify(session, [
        partition.reason,
        ...(partition.details ?? []).map(detail => detail.message),
      ])
    }
    let plan = partition.plan
    let planNotes = partition.notes
    // resize_room carries an explicit user number ("扩大到至少16平米"), but the
    // partitioner scales all room targets uniformly to absorb corridor
    // overhead — the resized room systematically lands a few percent short.
    // Compensate deterministically: re-partition once with the target
    // inflated by the observed shortfall ratio; if it still misses, keep the
    // honest note instead of silently under-delivering (§2 不静默放弃也不硬改).
    const planAreaOf = (candidate: LayoutPlan, id: string) => {
      const room = candidate.rooms.find(entry => entry.id === id)
      return room ? polygonArea(room.polygon) : null
    }
    const shortfalls = parsed.plan.ops.flatMap(op => {
      if (op.op !== 'resize_room') return []
      const resolved = resolveRoomRef(op.room, intent.rooms)
      if (!('room' in resolved)) return []
      const actual = planAreaOf(plan, resolved.room.id)
      return actual !== null && actual < op.targetAreaSqm - 0.05
        ? [{ id: resolved.room.id, name: resolved.room.name, sqm: op.targetAreaSqm, actual }]
        : []
    })
    if (shortfalls.length > 0) {
      const inflatedRooms = intent.rooms.map(room => {
        const entry = shortfalls.find(s => s.id === room.id)
        return entry
          ? { ...room, targetAreaSqm: Math.round(entry.sqm * (entry.sqm / entry.actual) * 10) / 10 }
          : room
      })
      const addedArea = shortfalls.reduce((sum, s) => sum + (s.sqm * (s.sqm / s.actual) - s.sqm), 0)
      const inflatedIntent = {
        ...intent,
        rooms: inflatedRooms,
        targetTotalAreaSqm: Math.round((intent.targetTotalAreaSqm + addedArea) * 10) / 10,
      }
      const retry = partitionLayout(inflatedIntent, profile, strategy, { previousPlan: session.layoutPlan })
      if (retry.ok && shortfalls.every(s => (planAreaOf(retry.plan, s.id) ?? 0) >= s.sqm - 0.05)) {
        plan = retry.plan
        planNotes = retry.notes
      } else {
        planNotes = [
          ...planNotes,
          ...shortfalls.map(s =>
            `「${s.name}」目标 ${s.sqm}㎡，分区实际 ${Math.round(s.actual * 100) / 100}㎡（受轮廓与走廊约束，已尽量接近）`),
        ]
      }
    }
    const validation = validateLayoutPlan(plan, targets, profile)
    if (validation.fatal.length > 0) return this.rejectPlanFirstModify(session, validation.fatal)

    // --- rebuild: clear old structure, execute the new plan ---
    const nodes = snapshotSceneNodes(toolPayload(await this.callMcp(session.sessionId, 'get_scene', {})))
    const levelId = Object.entries(nodes).find(([, node]) => node.type === 'level')?.[0] ?? null
    if (!levelId) return null
    const clearTypes = new Set(['zone', 'wall', 'slab', 'ceiling', 'item'])
    for (const [id, node] of Object.entries(nodes)) {
      if (!clearTypes.has(String(node.type))) continue
      try {
        await traceMcp('delete_node', { id, cascade: true })
      } catch {
        // Already removed by an earlier cascade — expected, not an error.
      }
    }
    const built = await executeLayoutPlan({
      plan: partition.plan,
      levelId,
      callMcp: traceMcp,
      dedupeSharedWalls: () => this.dedupeSharedWalls(session.sessionId, levelId),
      beforeCall,
    })
    const furnitureRooms: FurnitureRoom[] = partition.plan.rooms.map(planRoom => ({
      id: planRoom.id,
      name: planRoom.name,
      type: planRoom.type,
      polygon: planRoom.polygon,
      zoneId: built.rooms.find(entry => entry.planRoomId === planRoom.id)?.zoneId ?? null,
    }))
    // Snapshot refresh (§2 病灶④): the next modify must see THIS state.
    session.zoneRoomTypes = Object.fromEntries(
      furnitureRooms.filter(room => room.zoneId !== null).map(room => [room.zoneId as string, room.type]),
    )
    session.layoutIntent = intent
    session.layoutPlan = partition.plan
    session.strategy = strategy
    const furnished = await executeFurniturePlan({
      rooms: furnitureRooms,
      levelId,
      callMcp: traceMcp,
      beforeCall,
    })
    // Deferred furniture ops run against the rebuilt rooms.
    let furnReport: FurnitureModifyReport | null = null
    if (applied.furnitureOps.length > 0) {
      furnReport = await executeFurnitureModifyOps({
        ops: applied.furnitureOps,
        rooms: furnitureRooms,
        levelId,
        callMcp: traceMcp,
        beforeCall,
      })
    }
    trace.converged = true
    return this.finishPlanFirstModify(session, sceneId, loadedVersion, trace, {
      okDetails: [
        ...applied.notes,
        ...partition.notes,
        ...(furnReport?.results.filter(r => r.ok).map(r => r.detail) ?? []),
      ],
      failedDetails: [
        ...built.executionIssues,
        ...furnished.missing.map(entry => `「${entry.room}」缺少${entry.label}：${entry.reason}`),
        ...furnished.executionIssues,
        ...(furnReport?.results.filter(r => !r.ok).map(r => r.detail) ?? []),
      ],
    })
  }

  private async findLevelId(session: WorkflowSession): Promise<string | null> {
    const nodes = snapshotSceneNodes(toolPayload(await this.callMcp(session.sessionId, 'get_scene', {})))
    return Object.entries(nodes).find(([, node]) => node.type === 'level')?.[0] ?? null
  }

  // Deterministic rejection (docs/MODIFY_REDESIGN.md §2): the edit itself is
  // invalid (unresolvable room, fatal area bound, infeasible partition) —
  // tell the user why instead of falling back to the legacy free-edit path,
  // which would "solve" it by violating the same constraint.
  private rejectPlanFirstModify(
    session: WorkflowSession,
    errors: string[],
  ): Partial<WorkflowGraphState> {
    delete session.pendingModification
    delete session.pendingOperation
    session.phase = modifyFailureRecovery(false, Boolean(session.sceneResult)).phase
    const reply = t(session.language, 'modifyFailedNoRetry', { error: errors.join('；') })
    session.messages.push({ role: 'assistant', content: reply })
    return { session, reply, next: 'finish' }
  }

  private async finishPlanFirstModify(
    session: WorkflowSession,
    sceneId: string,
    loadedVersion: number | null,
    trace: { toolCounts: Record<string, number> },
    results: { okDetails: string[]; failedDetails: string[] },
  ): Promise<Partial<WorkflowGraphState>> {
    const diagnostics = await this.collectDiagnostics(session)
    const sceneVersion = await this.persistScene(
      session.sessionId,
      sceneId,
      diagnostics.validation.valid,
      loadedVersion,
    )
    const gates = await this.evaluateGates(session)
    // Failed ops surface through the furniture-issue channel; successful op
    // details ride the reply below (zh internal strings, same policy as the
    // executor reports).
    const furnitureIssues = results.failedDetails
    const remainingIssueCount = countAllIssues(diagnostics, furnitureIssues)
    session.sceneResult = {
      sceneId,
      editorUrl: publicEditorUrl(sceneId),
      version: sceneVersion,
      validation: diagnostics.validation,
      verificationIssues: diagnostics.verificationIssues,
      collisions: diagnostics.collisions,
      doorlessRooms: diagnostics.doorlessRooms,
      strayWindows: diagnostics.strayWindows,
      requirementMismatches: diagnostics.requirementMismatches,
      isolatedBedrooms: diagnostics.isolatedBedrooms,
      furnitureIssues,
      furniturePlacement: diagnostics.furniturePlacementIssues,
      repairRounds: 0,
      remainingIssueCount,
      modelCallsUsed: (session.toolTrace ?? []).reduce((sum, entry) => sum + entry.modelCalls, 0),
      gateFailures: gates.report.failures.map(failure => failure.message),
      layoutQuality: gates.layoutQuality,
    }
    session.phase = remainingIssueCount === 0 && gates.report.passed
      ? 'completed'
      : 'completed_with_issues'
    delete session.pendingModification
    delete session.pendingOperation
    const base = buildCompletionReply({
      lang: session.language ?? 'en',
      successText: t(session.language, 'modifySuccess', {}),
      repairRounds: 0,
      diagnostics,
      toolNamesUsed: new Set(Object.keys(trace.toolCounts)),
      furnitureIssues,
      gateFailures: gates.report.failures,
    })
    const okDetails = results.okDetails.map(detail => `- ${detail}`)
    const reply = okDetails.length > 0 ? [base, ...okDetails].join('\n') : base
    session.messages.push({ role: 'assistant', content: reply })
    return { session, reply, next: 'finish' }
  }

  private async answerSceneQuestion(session: WorkflowSession, question: string): Promise<string> {
    const readOnlyTools = new Set([
      'get_scene',
      'get_node',
      'describe_node',
      'measure',
      'get_level_summary',
      'get_walls',
      'get_zones',
      'find_nodes',
      'validate_scene',
      'verify_scene',
      'check_collisions',
    ])
    const tools = (await this.mcp.listOpenAiTools()).filter(tool =>
      readOnlyTools.has(tool.function.name),
    )
    // Exclude the last entry: it's `question` itself, already pushed to
    // session.messages by routeExistingSceneRequest before this runs.
    const history = recentConversationBlock(session.messages.slice(0, -1))
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          'Inspect the active Pascal scene and answer the user accurately. Use read-only tools when needed. Never mutate the scene. State what you verified, identify relevant node ids when useful, and distinguish measured facts from uncertainty. Use the recent conversation to resolve references like "that wall" or "the one I mentioned". Reply in the language of the user\'s message (default to English if unclear).',
      },
      { role: 'user', content: `${history}${question}` },
    ]
    for (let round = 0; round < this.config.maxToolRounds; round++) {
      this.throwIfCancelled(session.sessionId)
      const completion = await this.withModelFallback(session.sessionId, (model, hooks) =>
        model.chat(messages, tools, `${session.sessionId}:inspect`, hooks),
      )
      const assistant = completion.choices[0]?.message
      if (!assistant) throw new Error('Model API returned no assistant message')
      messages.push({
        role: 'assistant',
        content: assistant.content ?? null,
        tool_calls: assistant.tool_calls,
      })
      if (!assistant.tool_calls?.length) {
        return assistant.content?.trim() || '已完成场景核对，但模型没有返回说明。'
      }
      for (const toolCall of assistant.tool_calls) {
        messages.push(await this.executeToolCall(session.sessionId, toolCall))
      }
    }
    return '已核对当前场景，但查询步骤超过限制；场景没有被修改。'
  }

  private async extractRequirements(
    session: WorkflowSession,
    message: string,
    imageDataUrl?: string,
  ): Promise<ExtractionResponse> {
    const prompt = `你是 Pascal 户型设计输入分析器。请只返回 JSON，不要返回 Markdown。
任务：把最新输入合并到已有结构化需求中。严格区分“图纸/图片中的现状”和“用户希望实现的设计目标”。禁止把推断写成用户事实。

每个信息项格式：
{"key":"稳定的snake_case键","label":"用户语言的名称","value":"值或数组","source":"user|system_recognition|agent_inference|default_assumption|pending_confirmation","confidence":0到1,"confirmationStatus":"unconfirmed|confirmed|rejected","evidence":"简短依据"}

输出字段：existingCondition、designGoals、hardConstraints、assumptions、uncertainties、conflicts、questions、overallConfidence、imageUsable、imageReason。
conflicts 格式：{"key":"...","existingValue":"...","requestedValue":"...","question":"..."}。
常见信息用稳定 key：总面积 "total_area"、房间构成 "room_program"、边界/开间进深 "boundary_dimensions"。
用户给出总面积或房间构成时，它们是已确认的设计目标（designGoals，confidence≥0.9），不要因"面积口径未说明"之类的次要歧义把它们降级或列为 uncertainties——按建筑面积理解即可。
questions 每次最多 3 个，只问会改变空间结构的问题；questions 和所有 label 使用用户输入的语言（无法判断时用英语）。
已有需求：${JSON.stringify(session.brief)}
最新文字：${message || '无附带文字'}
输入类型：${imageDataUrl ? '单张户型图；图片是现状依据，文字是目标或指令。请尽量从图中识别墙体、门、窗、房间及其大致布局/尺寸，作为 existingCondition 现状事实（识别不确定的放入 uncertainties，不要写成用户确认的事实）' : '纯文字需求'}`

    // Retry once on malformed JSON — this call is exactly the kind of
    // strict-JSON-mode request that
    // occasionally fails format compliance (more so with an image attached),
    // and previously a single hiccup killed the whole turn.
    let lastError: unknown
    for (let attempt = 0; attempt < 2; attempt++) {
      const attemptPrompt = attempt > 0
        ? `${prompt}\n上一次输出不是合法 JSON，这一次必须严格只返回 JSON，不要加任何说明、前后缀或 Markdown 代码块标记。`
        : prompt
      const content: ChatMessage['content'] = imageDataUrl
        ? [
            { type: 'text', text: attemptPrompt },
            { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } },
          ]
        : attemptPrompt

      try {
        return await this.withModelFallback(session.sessionId, (model, hooks) =>
          model.json<ExtractionResponse>(
            [
              { role: 'system', content: 'Extract architectural requirements into valid JSON only.' },
              { role: 'user', content },
            ],
            `${session.sessionId}:extract:${attempt}`,
            hooks,
          ),
        )
      } catch (error) {
        lastError = error
      }
    }
    throw lastError
  }

  /**
   * Fetch and cache the MCP `pascal://agent-guide` resource text for the
   * lifetime of this process. Returns undefined (never throws) if the MCP
   * server has no such resource or the read fails for any reason.
   */
  private getAgentGuide(): Promise<string | undefined> {
    if (!this.agentGuidePromise) {
      this.agentGuidePromise = this.mcp.readResourceText('pascal://agent-guide').catch(() => undefined)
    }
    return this.agentGuidePromise
  }

  /**
   * Base system prompt for `runSceneAgent`, extended with (a) the "Scene
   * Creation Rules" section pulled live from the MCP `pascal://agent-guide`
   * resource when available, and (b) a couple of conventions adapted from
   * the MCP `from_brief`/`iterate_on_feedback` prompts' shared design
   * guidance (support-space completeness, apply_patch bundling) that our
   * own hand-written prompt didn't previously cover.
   */
  private async buildSceneAgentSystemPrompt(): Promise<string> {
    const base =
      'You are the Pascal scene generation and repair agent. Work only on the active Pascal scene. For user feedback, make the minimum change requested and never alter unrelated geometry. Prefer semantic room tools and atomic apply_patch. Preserve confirmed requirements, avoid destructive broad changes, inspect before mutation, and validate before finishing. When calling add_door or add_window, only set `position` (0..1 along the wall); the `t` field is a legacy alias for the same value — never set both, and never set `t` alone.\n\nImportant limitation of the automated checks: `check_collisions` only compares unrotated axis-aligned bounding boxes between pairs of items — it ignores each item\'s `rotation`, and it never checks an item against walls or against its room/zone polygon. `verify_scene` and `validate_scene` do not inspect item placement at all. Passing all three does NOT mean furniture is placed sensibly. So whenever you place or move an item (place_item, furnish_room, or an apply_patch that touches an item node), you must reason about placement yourself: call get_zones and find_nodes (or get_level_summary) for the target room first to see the room polygon and existing items, account for the item\'s own rotated footprint, keep it inside the room polygon, keep clearance from doors/walkways, and avoid visually overlapping other furniture even if check_collisions would not flag it.'

    const supplement =
      'Only add support spaces (kitchen, living/dining, bathroom(s), entry/hallway, storage/laundry) that the confirmed brief itself calls for — either by naming them directly, or by describing the scope as a full home/apartment/unit. A bedroom count alone is not such a signal: if the user only asked for N bedrooms, do not add a kitchen, living room, or bathroom on your own initiative. When several placements belong to one logical change, bundle them into a single apply_patch call so they share one undo step.'

    const guide = await this.getAgentGuide()
    const sceneCreationRules = guide ? extractMarkdownSection(guide, 'Scene Creation Rules') : undefined

    return [
      base,
      supplement,
      sceneCreationRules
        ? `Additional scene-creation conventions from the Pascal MCP agent guide (project/version/save mechanics in it do not apply here — ignore those):\n${sceneCreationRules}`
        : undefined,
    ]
      .filter((part): part is string => Boolean(part))
      .join('\n\n')
  }

  private async runSceneAgent(
    session: WorkflowSession,
    purpose: string,
    conversation?: ChatMessage[],
    toolNamesUsed: Set<string> = new Set(),
    furnitureIssues: string[] = [],
    trace?: PhaseToolTrace,
  ): Promise<{
    messages: ChatMessage[]
    converged: boolean
    toolNamesUsed: Set<string>
    furnitureIssues: string[]
  }> {
    const allowedTools = new Set([
      'load_scene',
      'get_scene',
      'get_node',
      'describe_node',
      'measure',
      'get_level_summary',
      'list_levels',
      'get_walls',
      'get_zones',
      'find_nodes',
      'search_assets',
      'create_level',
      'create_story_shell',
      'create_room',
      'add_door',
      'add_window',
      'furnish_room',
      'place_item',
      'set_zone',
      'apply_patch',
      'delete_node',
      'validate_scene',
      'verify_scene',
      'check_collisions',
    ])
    const tools = (await this.mcp.listOpenAiTools()).filter(tool =>
      allowedTools.has(tool.function.name),
    )
    // Reuse the caller's conversation when provided so this call remembers
    // what earlier phases/repair rounds already tried, instead of starting
    // from a blank slate every time.
    const isNewThread = !conversation
    const messages: ChatMessage[] = conversation ?? [
      {
        role: 'system',
        content: await this.buildSceneAgentSystemPrompt(),
      },
    ]
    // Only inject conversation history when this call starts a fresh thread
    // (repair rounds and later phases already carry it forward in `messages`
    // itself, so repeating it every round would just waste tokens).
    const historyBlock = isNewThread ? recentConversationBlock(session.messages) : ''
    messages.push({
      role: 'user',
      content: `${purpose}\n${historyBlock}Confirmed brief (authoritative for dimensions, room list, and hard constraints):\n${session.summary || formatSummary(session.brief)}`,
    })

    for (let round = 0; round < this.config.maxToolRounds; round++) {
      this.throwIfCancelled(session.sessionId)
      const completion = await this.withModelFallback(session.sessionId, (model, hooks) =>
        model.chat(messages, tools, `${session.sessionId}:scene`, hooks),
      )
      const assistant = completion.choices[0]?.message
      if (!assistant) throw new Error('Model API returned no assistant message')
      if (trace) trace.modelCalls++
      messages.push({
        role: 'assistant',
        content: assistant.content ?? null,
        tool_calls: assistant.tool_calls,
      })
      if (!assistant.tool_calls?.length) {
        return { messages, converged: true, toolNamesUsed, furnitureIssues }
      }
      for (const toolCall of assistant.tool_calls) {
        toolNamesUsed.add(toolCall.function.name)
        const toolMessage = await this.executeToolCall(session.sessionId, toolCall, furnitureIssues)
        if (trace) recordTraceToolCall(trace, toolCall, toolMessage)
        messages.push(toolMessage)
      }
    }
    return { messages, converged: false, toolNamesUsed, furnitureIssues }
  }

  // A phase that hits `maxToolRounds` without the model emitting a final
  // (tool-call-free) message is *not* done — it just ran out of turns
  // mid-task. Retrying with a fresh nudge, reusing the same conversation so
  // the model can see what it already built, gives it a bounded chance to
  // actually finish instead of silently being recorded as "completed".
  private static readonly PHASE_CONTINUATION_ATTEMPTS = 1

  private async runPhaseToConvergence(
    session: WorkflowSession,
    purpose: string,
    conversation: ChatMessage[] | undefined,
    toolNamesUsed: Set<string>,
    furnitureIssues: string[],
    phaseLabel: string,
  ): Promise<{ messages: ChatMessage[]; toolNamesUsed: Set<string>; furnitureIssues: string[] }> {
    const trace = startPhaseTrace(session, phaseLabel)
    let result = await this.runSceneAgent(session, purpose, conversation, toolNamesUsed, furnitureIssues, trace)
    let attempt = 0
    while (!result.converged && attempt < PascalAiAgent.PHASE_CONTINUATION_ATTEMPTS) {
      attempt++
      trace.continuationAttempts = attempt
      result = await this.runSceneAgent(
        session,
        `${purpose}\n上一轮已经达到工具调用轮次上限，任务还没有做完。请先用 get_zones 检查当前场景的真实状态，只继续完成尚未做完的部分，不要重复已经做好的操作。`,
        result.messages,
        result.toolNamesUsed,
        result.furnitureIssues,
        trace,
      )
    }
    trace.converged = result.converged
    if (!result.converged) {
      throw new Error(`${phaseLabel}在 ${PascalAiAgent.PHASE_CONTINUATION_ATTEMPTS + 1} 轮尝试后仍未收敛完成`)
    }
    return { messages: result.messages, toolNamesUsed: result.toolNamesUsed, furnitureIssues: result.furnitureIssues }
  }

  // `create_house_from_brief` only picks the closest of its 3 built-in
  // templates (its own tool description says as much for 3+ bedroom
  // requests), so it rarely matches an arbitrary room list. We use it purely
  // for project/site/building/level scaffolding and always clear its
  // template rooms so `constructSceneInPhases`'s structure phase can build
  // the actual layout room-by-room through MCP's own recommended tool
  // sequence (create_story_shell once, then create_room per room with
  // get_zones checked in between) instead of us precomputing geometry.
  // Count nodes in the currently-loaded scene that represent actual content
  // (walls, rooms, zones, openings, items, ...) as opposed to the structural
  // scaffolding every project has. Used to tell an empty project apart from
  // one the user has already put work into.
  private async countActiveContentNodes(sessionId: string): Promise<number> {
    const scene = toolPayload(await this.callMcp(sessionId, 'get_scene', {}))
    const nodes = isRecord(scene.nodes) ? scene.nodes : {}
    let count = 0
    for (const node of Object.values(nodes)) {
      if (isRecord(node) && typeof node.type === 'string' && !SCAFFOLDING_NODE_TYPES.has(node.type)) {
        count++
      }
    }
    return count
  }

  private async clearLevelForRebuild(session: WorkflowSession, levelId: string | null): Promise<void> {
    if (!levelId) throw new Error('Target level is missing')
    try {
      const scene = toolPayload(await this.callMcp(session.sessionId, 'get_scene', {}))
      const nodes = isRecord(scene.nodes) ? scene.nodes : {}
      const level = nodes[levelId]
      if (!isRecord(level) || !Array.isArray(level.children)) {
        throw new Error(`Target level ${levelId} is unavailable`)
      }
      for (const childId of level.children) {
        if (typeof childId === 'string') {
          await this.callMcp(session.sessionId, 'delete_node', { id: childId, cascade: true })
        }
      }
    } catch (error) {
      session.executionSteps?.push({ phase: 'structure', status: 'failed', label: '清空模板占位内容' })
      throw error
    }
  }

  // Safety cap on the resolve-one-overlap-and-rescan loop below. Wall counts
  // here are small (a handful of rooms, a handful of edges each), so this is
  // never expected to bind — it exists only to guarantee termination if some
  // pathological input kept producing new overlapping fragments forever.
  private static readonly MAX_DEDUPE_ITERATIONS = 500

  /**
   * Remove redundant/overlapping walls left behind by room-by-room
   * `create_room` calls (see the comment at the call site for why these
   * exist). Runs before the openings phase, so no wall here can host a door
   * or window yet — deleting/splitting freely is safe because zone/slab/
   * ceiling nodes carry their own polygon and never reference a wall by id.
   *
   * Two rooms built independently and sharing a full boundary produce two
   * walls with identical endpoints — the simple case. But a T junction
   * (one room's long edge bordering two or more smaller neighboring rooms)
   * produces a long wall whose interval only *partially* overlaps each of
   * several shorter walls, with no shared endpoints at all — exact endpoint
   * matching misses this entirely. We resolve overlaps by collinear-interval
   * comparison instead: for any two collinear walls whose intervals overlap
   * by more than a sliver, the shorter (more specific) one is kept as-is and
   * the longer one is clipped — split into whatever fragments of itself fall
   * outside the overlap, with the original deleted. Repeating this against
   * the growing/shrinking wall set until no overlaps remain correctly
   * collapses an N-way T junction, not just a single pair.
   *
   * Best-effort: on any failure we skip silently rather than fail the whole
   * generation over a cleanup pass — worst case is the pre-existing
   * double-wall behavior, not a broken scene.
   *
   * `protectedWallIds` (modify path): walls that existed before this turn are
   * READ-ONLY for the dedupe — when a new wall coincides with an original,
   * the new wall is the one deleted/clipped regardless of length, and a pair
   * of original walls is never touched at all. Fresh generation passes no
   * protected set and keeps the original shorter-wall-wins behavior.
   */
  private async dedupeSharedWalls(
    sessionId: string,
    levelId: string | null,
    protectedWallIds?: Set<string>,
  ): Promise<void> {
    if (!levelId) return
    try {
      const payload = toolPayload(await this.callMcp(sessionId, 'get_walls', { levelId }))
      const walls = Array.isArray(payload.walls) ? payload.walls.filter(isWallSummary) : []

      type WorkingWall = WallSummary & { isFragment: boolean }
      let working: WorkingWall[] = walls.map(w => ({ ...w, isFragment: false }))
      const deletedRealIds = new Set<string>()
      let fragmentCounter = 0

      let changed = true
      let iterations = 0
      while (changed && iterations < PascalAiAgent.MAX_DEDUPE_ITERATIONS) {
        changed = false
        iterations++
        resolvePass: for (let i = 0; i < working.length; i++) {
          for (let j = i + 1; j < working.length; j++) {
            const a = working[i]!
            const b = working[j]!
            const overlap = collinearOverlap(a, b)
            if (!overlap) continue
            const aProtected = !a.isFragment && protectedWallIds?.has(a.id) === true
            const bProtected = !b.isFragment && protectedWallIds?.has(b.id) === true
            // Two original walls overlapping is pre-existing state this
            // cleanup must not "fix" during a modification.
            if (aProtected && bProtected) continue
            const oa = segmentOrientation(a)!
            const ob = segmentOrientation(b)!
            const lenA = oa.hi - oa.lo
            const lenB = ob.hi - ob.lo
            const overlapLen = overlap.hi - overlap.lo
            const aFullyCovered = overlapLen >= lenA - MIN_MEANINGFUL_OVERLAP_M
            const bFullyCovered = overlapLen >= lenB - MIN_MEANINGFUL_OVERLAP_M

            if (aFullyCovered && bFullyCovered) {
              // Exact duplicate within tolerance — drop the unprotected one
              // (b by default, matching the original keep-a behavior).
              const dropIndex = aProtected ? j : bProtected ? i : j
              const dropped = working[dropIndex]!
              if (!dropped.isFragment) deletedRealIds.add(dropped.id)
              working.splice(dropIndex, 1)
              changed = true
              break resolvePass
            }

            // A protected wall is always the one kept; otherwise keep the
            // shorter (more specific) wall untouched and clip the longer one
            // down to whatever remains outside the overlap.
            const keepIsA = aProtected ? true : bProtected ? false : lenA <= lenB
            const clip = keepIsA ? b : a
            const clipIdx = keepIsA ? j : i
            const clipOrientation = keepIsA ? ob : oa

            const fragments: Array<[number, number]> = []
            if (overlap.lo - clipOrientation.lo > MIN_MEANINGFUL_OVERLAP_M) {
              fragments.push([clipOrientation.lo, overlap.lo])
            }
            if (clipOrientation.hi - overlap.hi > MIN_MEANINGFUL_OVERLAP_M) {
              fragments.push([overlap.hi, clipOrientation.hi])
            }

            if (!clip.isFragment) deletedRealIds.add(clip.id)
            working.splice(clipIdx, 1)
            for (const [lo, hi] of fragments) {
              fragmentCounter++
              const seg = orientationToSegment({ axis: clipOrientation.axis, constant: clipOrientation.constant, lo, hi })
              working.push({
                id: `dedupe_frag_${fragmentCounter}`,
                start: seg.start,
                end: seg.end,
                thickness: clip.thickness,
                height: clip.height,
                name: clip.name,
                isFragment: true,
              })
            }
            changed = true
            break resolvePass
          }
        }
      }

      const patches: Array<Record<string, unknown>> = []
      for (const id of deletedRealIds) {
        patches.push({ op: 'delete', id, cascade: true })
      }
      for (const wall of working) {
        if (!wall.isFragment) continue
        patches.push({
          op: 'create',
          node: {
            type: 'wall',
            start: wall.start,
            end: wall.end,
            ...(wall.thickness !== undefined ? { thickness: wall.thickness } : {}),
            ...(wall.height !== undefined ? { height: wall.height } : {}),
            ...(wall.name !== undefined ? { name: wall.name } : {}),
            metadata: { mcpTool: 'pascal-ai-mcp:dedupeSharedWalls' },
          },
          parentId: levelId,
        })
      }
      if (patches.length > 0) {
        await this.callMcp(sessionId, 'apply_patch', { patches })
      }
    } catch {
      // Best-effort cleanup — see doc comment above.
    }
  }

  // Steps ①–③ of the plan-first flow: one trace entry so eval reports can
  // see exactly how many completions planning took and whether it converged.
  private async buildPlanForSession(
    session: WorkflowSession,
    priorFailures?: string[],
  ): Promise<PlanBuildResult> {
    const trace = startPhaseTrace(
      session,
      priorFailures?.length ? '重规划阶段（注入验收失败事实）' : '规划阶段（Intent→分区→校验）',
    )
    // Experimental comparison path (§2 意见②): model-authored geometry
    // through the same validator. Deliberately an env flag, not AppConfig —
    // it exists to measure partitioner-vs-LLM layout quality, not to ship.
    const llmGeometry = process.env.AI_PLAN_LLM_GEOMETRY === '1'
    const temperature = llmGeometry
      ? this.config.aiTemperatureGeometry
      : this.config.aiTemperatureIntent
    const profile = resolveNormProfile(this.config.normProfile)
    const briefSummary = session.summary || formatSummary(session.brief)
    const targets = buildPlanTargets(session.brief)
    // Deterministic strategy decision (LAYOUT_STRATEGY_DESIGN.md §2) —
    // persisted on the session so modify turns and eval reports can see what
    // was decided and why.
    const strategy = deriveStrategy(deriveBriefFacts(briefSummary), targets, profile)
    session.strategy = strategy
    const result = await buildLayoutPlan(
      {
        briefSummary,
        targets,
      },
      async (messages, tag) => {
        this.throwIfCancelled(session.sessionId)
        trace.modelCalls++
        return this.withModelFallback(session.sessionId, (model, hooks) =>
          model.complete(messages, `${session.sessionId}:${tag}`, { ...hooks, temperature }),
        )
      },
      {
        llmGeometry,
        profile,
        strategy,
        ...(priorFailures?.length ? { priorFailures } : {}),
      },
    )
    trace.converged = result.ok
    return result
  }

  // §5 completion hard gates + layout quality, judged on the ACTUAL scene
  // state. Used by fresh generation, the rebuild decision, and modify (§6
  // 接线 2: 门槛是场景性质，与怎么建出来无关).
  private async evaluateGates(session: WorkflowSession): Promise<{
    report: GateReport
    layoutQuality: number
  }> {
    const [zonesRaw, wallsRaw, summaryRaw] = await Promise.all([
      this.callMcp(session.sessionId, 'get_zones', {}),
      this.callMcp(session.sessionId, 'get_walls', {}),
      this.callMcp(session.sessionId, 'get_level_summary', {}),
    ])
    const zonesPayload = toolPayload(zonesRaw)
    const wallsPayload = toolPayload(wallsRaw)
    const summaryPayload = toolPayload(summaryRaw)
    const zones = Array.isArray(zonesPayload.zones) ? zonesPayload.zones.filter(isZoneSummary) : []
    const walls: GateWall[] = Array.isArray(wallsPayload.walls)
      ? wallsPayload.walls.filter(isWallWithOpenings)
      : []
    const items = Array.isArray(summaryPayload.items) ? summaryPayload.items.filter(isItemSummary) : []
    const planTargets = buildPlanTargets(session.brief)
    const requiredWindowRoomTypes = windowRoomTypesFromBrief(session.brief)
    const report = evaluateCompletionGates(zones, walls, items, {
      ...(planTargets.totalAreaSqm !== undefined ? { totalAreaSqm: planTargets.totalAreaSqm } : {}),
      ...(planTargets.requiredRooms ? { requiredRooms: planTargets.requiredRooms } : {}),
      ...(requiredWindowRoomTypes.length > 0 ? { requiredWindowRoomTypes } : {}),
      ...(session.zoneRoomTypes ? { zoneTypes: session.zoneRoomTypes } : {}),
    })
    const layoutQuality = computeLayoutQuality(zones, walls, {
      ...(planTargets.totalAreaSqm !== undefined ? { targetTotalAreaSqm: planTargets.totalAreaSqm } : {}),
    }).score
    return { report, layoutQuality }
  }

  // Steps ⑤–⑦: deterministic structure + openings from the plan (zero model
  // calls), then the model-driven furnishing pass (batch C replaces it with
  // the deterministic furniture executor), then verification + bounded
  // repair.
  private async constructScenePlanFirst(
    session: WorkflowSession,
    levelId: string | null,
    plan: LayoutPlan,
    options: { persistAfterRound?: (valid: boolean) => Promise<void> } = {},
  ): Promise<{
    diagnostics: Awaited<ReturnType<PascalAiAgent['collectDiagnostics']>>
    repairRounds: number
    toolNamesUsed: Set<string>
    furnitureIssues: string[]
    executionIssues: string[]
    structureViolations: string[]
    gates: GateReport
    layoutQuality: number
    // Gate 1–5 failure messages: the structural class that goes back to the
    // plan layer (§5 失败分流) instead of the free repair loop.
    structuralFailures: string[]
    furnitureCounts: { placed: number; required: number }
  }> {
    session.executionSteps ??= []
    if (!levelId) throw new Error('Target level is missing')
    // The executor phase must show up in the tool trace with modelCalls: 0 —
    // that zero is a batch-B hard metric, asserted by the eval harness.
    const trace = startPhaseTrace(session, '结构与门窗施工（确定性执行器）')
    let report: SceneExecutionReport
    try {
      report = await executeLayoutPlan({
        plan,
        levelId,
        callMcp: async (name, args) => {
          const result = await this.callMcp(session.sessionId, name, args)
          trace.toolCounts[name] = (trace.toolCounts[name] ?? 0) + 1
          const detail = name === 'create_room' && typeof args.name === 'string' ? args.name : undefined
          trace.toolCalls.push({ name, ok: true, ...(detail ? { detail } : {}) })
          return result
        },
        dedupeSharedWalls: () => this.dedupeSharedWalls(session.sessionId, levelId),
        beforeCall: () => this.throwIfCancelled(session.sessionId),
      })
      trace.converged = true
      session.executionSteps.push({ phase: 'structure', status: 'completed', label: '按计划批量建造房间结构' })
      session.executionSteps.push({ phase: 'openings', status: 'completed', label: '按计划开门窗' })
    } catch (error) {
      session.executionSteps.push({ phase: 'structure', status: 'failed', label: '确定性结构与门窗施工' })
      throw error
    }

    // ⑥ Deterministic furnishing (batch C): checklist-driven, zero model
    // calls, same trace contract as the structure executor above.
    const toolNamesUsed = new Set<string>()
    let furnitureIssues: string[] = []
    let furnitureCounts = { placed: 0, required: 0 }
    const furnitureTrace = startPhaseTrace(session, '家具布置（确定性执行器）')
    try {
      const furnitureRooms = plan.rooms.map(planRoom => ({
        id: planRoom.id,
        name: planRoom.name,
        type: planRoom.type,
        polygon: planRoom.polygon,
        zoneId: report.rooms.find(built => built.planRoomId === planRoom.id)?.zoneId ?? null,
      }))
      // Authoritative zone types for the gates/diagnostics: with this on the
      // session, room names can be in any language — nothing downstream needs
      // to guess types from 中/日/英 keywords for plan-first builds.
      session.zoneRoomTypes = Object.fromEntries(
        furnitureRooms
          .filter(room => room.zoneId !== null)
          .map(room => [room.zoneId as string, room.type]),
      )
      const furnished = await executeFurniturePlan({
        rooms: furnitureRooms,
        levelId,
        callMcp: async (name, args) => {
          const result = await this.callMcp(session.sessionId, name, args)
          furnitureTrace.toolCounts[name] = (furnitureTrace.toolCounts[name] ?? 0) + 1
          const detail = name === 'search_assets' && typeof args.query === 'string'
            ? args.query
            : name === 'place_item' && typeof args.catalogItemId === 'string' ? args.catalogItemId : undefined
          furnitureTrace.toolCalls.push({ name, ok: true, ...(detail ? { detail } : {}) })
          return result
        },
        beforeCall: () => this.throwIfCancelled(session.sessionId),
      })
      furnitureTrace.converged = true
      if (furnished.placed.length > 0) toolNamesUsed.add('place_item')
      furnitureIssues = [
        ...furnished.missing.map(entry => `「${entry.room}」缺少${entry.label}：${entry.reason}`),
        ...furnished.executionIssues,
      ]
      furnitureCounts = {
        placed: furnished.placed.length,
        required: furnished.placed.length + furnished.missing.length,
      }
      session.executionSteps.push({ phase: 'furnishing', status: 'completed', label: '按清单确定性布置家具' })
    } catch (error) {
      session.executionSteps.push({ phase: 'furnishing', status: 'failed', label: '确定性家具布置' })
      throw error
    }

    // §5 失败分流：gates run BEFORE any repair round. A structural failure
    // (gates 1–5) belongs to the plan layer — repairing decorations on a
    // scene that is about to be cleared and rebuilt would only burn model
    // calls, so verification is skipped entirely in that case.
    const preGates = await this.evaluateGates(session)
    const structuralFailures = preGates.report.failures
      .filter(failure => failure.gate <= 5)
      .map(failure => failure.message)
    if (structuralFailures.length > 0) {
      const diagnostics = await this.collectDiagnostics(session)
      return {
        diagnostics,
        repairRounds: 0,
        toolNamesUsed,
        furnitureIssues,
        executionIssues: report.executionIssues,
        structureViolations: [],
        gates: preGates.report,
        layoutQuality: preGates.layoutQuality,
        structuralFailures,
        furnitureCounts,
      }
    }

    // ⑦ Verification + bounded decorative repair, with the structure lock
    // active. The repair rounds start a fresh model conversation —
    // construction was model-free, so there is no prior thread to continue.
    const result = await this.refineAndDiagnose(
      session,
      `验证阶段：核对门窗宿主、家具碰撞和通行性，只修复检查发现的问题；禁止增删、移动或缩放任何房间，禁止改动已开好的门窗。\n${formatPlanSnapshot(plan)}`,
      {
        skipInitialAgent: true,
        toolNamesUsed,
        furnitureIssues,
        lockStructure: true,
        ...(options.persistAfterRound ? { persistAfterRound: options.persistAfterRound } : {}),
      },
    )
    session.executionSteps.push({
      phase: 'verification',
      status: 'completed',
      label: '验证并自动修正',
    })
    // Re-judge the gates after repairs (repair rounds may have re-hosted a
    // window or refit furniture; the lock guarantees structure is unchanged).
    const postGates = await this.evaluateGates(session)
    return {
      ...result,
      executionIssues: report.executionIssues,
      gates: postGates.report,
      layoutQuality: postGates.layoutQuality,
      structuralFailures: postGates.report.failures
        .filter(failure => failure.gate <= 5)
        .map(failure => failure.message),
      furnitureCounts,
    }
  }

  private async refineAndDiagnose(
    session: WorkflowSession,
    purpose: string,
    options: {
      skipInitialAgent?: boolean
      conversation?: ChatMessage[]
      toolNamesUsed?: Set<string>
      furnitureIssues?: string[]
      phaseLabel?: string
      // Deterministic task-specific acceptance run alongside every
      // collectDiagnostics pass; returned issue strings are merged into
      // requirementMismatches, so they both trigger repair rounds and appear
      // verbatim in the repair prompt (used by the modification-protection
      // closed loop).
      extraChecks?: () => Promise<string[]>
      // §5 批次 D：repair rounds are decorative-only. When set, a snapshot is
      // taken before the loop; a round that moves/adds/removes structural
      // nodes is undone wholesale and the loop stops.
      lockStructure?: boolean
      // §8 批次 D 每轮 persistScene：called after every repair round with the
      // round's validation state, so each round leaves a saved version.
      persistAfterRound?: (valid: boolean) => Promise<void>
    } = {},
  ): Promise<{
    diagnostics: Awaited<ReturnType<PascalAiAgent['collectDiagnostics']>>
    repairRounds: number
    toolNamesUsed: Set<string>
    furnitureIssues: string[]
    structureViolations: string[]
  }> {
    let conversation = options.conversation
    let toolNamesUsed = options.toolNamesUsed ?? new Set<string>()
    let furnitureIssues = options.furnitureIssues ?? []
    if (!options.skipInitialAgent) {
      // Same convergence guarantee as the fresh-generation structure/openings
      // phases: a modify/incremental-edit call that exhausts maxToolRounds
      // mid-task is not done, and must not be silently treated as if it
      // were — otherwise an unfinished edit on an *existing* scene slips
      // through the same way an unfinished fresh build used to.
      const result = await this.runPhaseToConvergence(
        session,
        purpose,
        conversation,
        toolNamesUsed,
        furnitureIssues,
        options.phaseLabel ?? '场景修改',
      )
      conversation = result.messages
      toolNamesUsed = result.toolNamesUsed
      furnitureIssues = result.furnitureIssues
    }
    const withExtraChecks = async (
      diagnostics: Awaited<ReturnType<PascalAiAgent['collectDiagnostics']>>,
    ): Promise<typeof diagnostics> => {
      if (!options.extraChecks) return diagnostics
      const extra = await options.extraChecks()
      if (extra.length === 0) return diagnostics
      return { ...diagnostics, requirementMismatches: [...diagnostics.requirementMismatches, ...extra] }
    }
    let diagnostics = await this.collectDiagnostics(session)
    diagnostics = await this.repairKnownOpeningBounds(diagnostics, session)
    diagnostics = await withExtraChecks(diagnostics)
    let repairRounds = 0
    const structureViolations: string[] = []
    let lockSnapshot = options.lockStructure
      ? snapshotSceneNodes(toolPayload(await this.callMcp(session.sessionId, 'get_scene', {})))
      : null
    // Each repair round reuses the same conversation, so the model can see
    // what it already tried and why the previous round's fix didn't fully
    // resolve the diagnostics, instead of re-guessing from scratch.
    while (repairRounds < this.config.maxRepairRounds && countDiagnosticIssues(diagnostics) > 0) {
      this.throwIfCancelled(session.sessionId)
      repairRounds++
      const repairTrace = startPhaseTrace(session, `自动修正第${repairRounds}轮`)
      const result = await this.runSceneAgent(
        session,
        `${purpose}\n自动修正第 ${repairRounds} 轮。必须先检查相关节点，再用工具修复以下具体问题；不要只解释，也不要推翻已确认需求：${JSON.stringify(diagnostics)}`,
        conversation,
        toolNamesUsed,
        furnitureIssues,
        repairTrace,
      )
      repairTrace.converged = result.converged
      conversation = result.messages
      toolNamesUsed = result.toolNamesUsed
      furnitureIssues = result.furnitureIssues
      // §5 structure lock: a repair round that touched walls/zones is undone
      // wholesale (one history step per mutating call it made) and the loop
      // ends — structural problems belong to the plan layer, not free repair.
      if (lockSnapshot) {
        const afterSnapshot = snapshotSceneNodes(
          toolPayload(await this.callMcp(session.sessionId, 'get_scene', {})),
        )
        const drift = structuralDrift(lockSnapshot, afterSnapshot)
        if (drift.length > 0) {
          const mutating = repairTrace.toolCalls.filter(call => MUTATING_TOOLS.has(call.name)).length
          if (mutating > 0) {
            try {
              await this.callMcp(session.sessionId, 'undo', { steps: mutating })
            } catch (error) {
              structureViolations.push(`撤销修复轮改动失败：${errorMessage(error)}`)
            }
          }
          structureViolations.push(
            `自动修正第 ${repairRounds} 轮试图改动房间结构（${drift.slice(0, 3).join('；')}${drift.length > 3 ? '……' : ''}），该轮改动已整体撤销`,
          )
          diagnostics = await this.collectDiagnostics(session)
          diagnostics = await this.repairKnownOpeningBounds(diagnostics, session)
          diagnostics = await withExtraChecks(diagnostics)
          break
        }
        lockSnapshot = afterSnapshot
      }
      diagnostics = await this.collectDiagnostics(session)
      diagnostics = await this.repairKnownOpeningBounds(diagnostics, session)
      diagnostics = await withExtraChecks(diagnostics)
      if (options.persistAfterRound) {
        await options.persistAfterRound(diagnostics.validation.valid)
      }
    }
    return { diagnostics, repairRounds, toolNamesUsed, furnitureIssues, structureViolations }
  }

  private async repairKnownOpeningBounds(
    diagnostics: Awaited<ReturnType<PascalAiAgent['collectDiagnostics']>>,
    session: WorkflowSession,
  ): Promise<Awaited<ReturnType<PascalAiAgent['collectDiagnostics']>>> {
    const ids = dedupe(
      diagnostics.verificationIssues.flatMap(issue => {
        const match = issue.match(/^(?:door|window)\s+(\S+)\s+(?:extends outside|vertical bounds)/)
        return match?.[1] ? [match[1]] : []
      }),
    )
    if (ids.length === 0) return diagnostics

    const patches: Array<{ op: 'update'; id: string; data: Record<string, unknown> }> = []
    for (const id of ids) {
      const node = toolPayload(await this.callMcp(session.sessionId, 'get_node', { id })).node
      if (!isRecord(node)) continue
      const wallId = typeof node.parentId === 'string'
        ? node.parentId
        : typeof node.wallId === 'string' ? node.wallId : undefined
      if (!wallId) continue
      const wall = toolPayload(await this.callMcp(session.sessionId, 'get_node', { id: wallId })).node
      if (!isRecord(wall)) continue
      const data = buildOpeningRepairData(node, wall)
      if (data) patches.push({ op: 'update', id, data })
    }
    if (patches.length === 0) return diagnostics
    await this.callMcp(session.sessionId, 'apply_patch', { patches })
    return this.collectDiagnostics(session)
  }

  private async persistScene(
    sessionId: string,
    sceneId: string | undefined,
    valid: boolean,
    expectedVersion: number | null,
  ): Promise<number | null> {
    if (!valid || !sceneId) return expectedVersion
    const status = toolPayload(await this.callMcp(sessionId, 'get_project_status', { id: sceneId }))
    const currentVersion = nullableNumber(status.version) ?? expectedVersion
    const saved = toolPayload(await this.callMcp(sessionId, 'save_scene', {
      id: sceneId,
      projectId: sceneId,
      name: 'Pascal AI 户型方案',
      saveMode: 'draft',
      includeCurrentScene: true,
      ...(currentVersion !== null ? { expectedVersion: currentVersion } : {}),
    }))
    return nullableNumber(saved.version) ?? currentVersion
  }

  private async executeToolCall(
    sessionId: string,
    toolCall: ToolCall,
    furnitureIssues?: string[],
  ): Promise<ChatMessage> {
    try {
      let args = normalizeToolArgs(toolCall.function.name, parseToolArgs(toolCall.function.arguments))
      args = await this.correctFloorItemHeight(sessionId, toolCall.function.name, args)
      const result = await this.callMcp(sessionId, toolCall.function.name, args)
      if (furnitureIssues) {
        recordFurnitureIssues(toolCall.function.name, args, toolPayload(result), furnitureIssues)
      }
      return {
        role: 'tool',
        tool_call_id: toolCall.id,
        name: toolCall.function.name,
        content: JSON.stringify(result),
      }
    } catch (error) {
      // A cancel that aborted this tool call must propagate as a cancellation,
      // not be swallowed into a tool-result error the model would try to
      // "recover" from.
      this.throwIfCancelled(sessionId)
      return {
        role: 'tool',
        tool_call_id: toolCall.id,
        name: toolCall.function.name,
        content: JSON.stringify({ error: errorMessage(error) }),
      }
    }
  }

  // place_item never validates or snaps the Y coordinate for floor items
  // (target is a level/slab/zone) — whatever height the model guesses is
  // used verbatim. furnish_room's own deterministic placements always use
  // Y=0 and let each catalog asset's own `offset` field handle vertical
  // fine-tuning, so that's the correct convention; place_item just doesn't
  // enforce it. A model-guessed non-zero Y here makes the item appear to
  // float above or sink into the floor. This can't be fixed inside the MCP
  // tool without editing it, so we correct it at the boundary: look up the
  // target node's type, and zero the Y coordinate only when the target is
  // genuinely a floor (wall/ceiling targets legitimately need non-zero Y
  // for mounting height, so those are left untouched).
  private async correctFloorItemHeight(
    sessionId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (toolName !== 'place_item') return args
    const targetNodeId = args.targetNodeId
    const position = args.position
    if (typeof targetNodeId !== 'string' || !Array.isArray(position) || position.length !== 3) {
      return args
    }
    if (position[1] === 0) return args
    try {
      const target = toolPayload(await this.callMcp(sessionId, 'get_node', { id: targetNodeId })).node
      const targetType = isRecord(target) ? target.type : undefined
      if (targetType !== 'level' && targetType !== 'slab' && targetType !== 'zone') return args
    } catch {
      // Can't verify the target type — leave the position untouched rather
      // than guess.
      return args
    }
    return { ...args, position: [position[0], 0, position[2]] }
  }

  private async collectDiagnostics(session: WorkflowSession): Promise<{
    validation: { valid: boolean; errors: string[] }
    verificationIssues: string[]
    collisions: Array<{ aId: string; bId: string; kind: string }>
    doorlessRooms: string[]
    strayWindows: string[]
    requirementMismatches: string[]
    isolatedBedrooms: string[]
    furniturePlacementIssues: FurniturePlacementIssue[]
    strayWallIds: string[]
    mismatchL10n: Array<MismatchFinding['l10n']>
  }> {
    const [validationRaw, verificationRaw, collisionsRaw, zonesRaw, wallsRaw, levelSummaryRaw] = await Promise.all([
      this.callMcp(session.sessionId, 'validate_scene', {}),
      this.callMcp(session.sessionId, 'verify_scene', {}),
      this.callMcp(session.sessionId, 'check_collisions', {}),
      this.callMcp(session.sessionId, 'get_zones', {}),
      this.callMcp(session.sessionId, 'get_walls', {}),
      this.callMcp(session.sessionId, 'get_level_summary', {}),
    ])
    const validationPayload = toolPayload(validationRaw)
    const verificationPayload = toolPayload(verificationRaw)
    const collisionPayload = toolPayload(collisionsRaw)
    const zonesPayload = toolPayload(zonesRaw)
    const wallsPayload = toolPayload(wallsRaw)
    const validationErrors = Array.isArray(validationPayload.errors)
      ? validationPayload.errors.map(error =>
          typeof error === 'string' ? error : JSON.stringify(error),
        )
      : []
    const verificationIssues = Array.isArray(verificationPayload.issues)
      ? verificationPayload.issues.map(issue =>
          typeof issue === 'string' ? issue : JSON.stringify(issue),
        )
      : []
    const collisions = Array.isArray(collisionPayload.collisions)
      ? collisionPayload.collisions.filter(isCollision)
      : []
    const zones = Array.isArray(zonesPayload.zones) ? zonesPayload.zones.filter(isZoneSummary) : []
    const walls = Array.isArray(wallsPayload.walls) ? wallsPayload.walls.filter(isWallWithOpenings) : []
    const levelSummaryPayload = toolPayload(levelSummaryRaw)
    const items = Array.isArray(levelSummaryPayload.items)
      ? levelSummaryPayload.items.filter(isItemSummary)
      : []
    const mismatchFindings = [
      ...compareRoomsToRequirements(zones.map(z => z.name), session.brief),
      ...checkAreaRequirements(zones, session.brief),
    ]
    const strayWallIds = findStrayWindows(zones, walls)
    return {
      validation: {
        valid: validationPayload.valid === true,
        errors: validationErrors,
      },
      verificationIssues,
      collisions,
      doorlessRooms: findDoorlessRooms(zones, walls),
      strayWindows: strayWallIds.map(wallId => issueText('zh', 'strayWindow', { wallId })),
      requirementMismatches: mismatchFindings.map(finding => finding.message),
      isolatedBedrooms: findIsolatedBedrooms(zones, walls),
      furniturePlacementIssues: checkFurniturePlacement(zones, walls, items),
      // Structured sources for reply-language re-rendering (see
      // describeRemainingIssues). Extra strings appended later by
      // extraChecks have no l10n and pass through untranslated.
      strayWallIds,
      mismatchL10n: mismatchFindings.map(finding => finding.l10n),
    }
  }

  private modelHooks(sessionId: string): RequestHooks {
    return {
      signal: this.runAbortControllers.get(sessionId)?.signal,
      // Charged once per real HTTP attempt from inside the model client, so
      // internal retries and the fallback call below are all counted.
      onAttempt: () => this.chargeModelCall(sessionId),
    }
  }

  private async withModelFallback<T>(
    sessionId: string,
    operation: (model: OpenAiCompatibleClient, hooks: RequestHooks) => Promise<T>,
  ): Promise<T> {
    if (!this.model) {
      throw new Error('The configured AI provider API key is missing')
    }
    const hooks = this.modelHooks(sessionId)
    try {
      return await operation(this.model, hooks)
    } catch (primaryError) {
      // A cancel must not silently fall back to the secondary model — turn it
      // into a cancellation the outer generation loop understands.
      this.throwIfCancelled(sessionId)
      if (!this.fallbackModel) throw primaryError
      return operation(this.fallbackModel, hooks)
    }
  }

  /**
   * Route low-stakes classification calls to the cheap/fast model when one is
   * configured. Falls back to the main model on error or when no fast model
   * is configured, so callers never lose reliability by using this.
   */
  private async withFastModel<T>(
    sessionId: string,
    operation: (model: OpenAiCompatibleClient, hooks: RequestHooks) => Promise<T>,
  ): Promise<T> {
    if (!this.fastModel) return this.withModelFallback(sessionId, operation)
    try {
      return await operation(this.fastModel, this.modelHooks(sessionId))
    } catch {
      this.throwIfCancelled(sessionId)
      return this.withModelFallback(sessionId, operation)
    }
  }
}

function createWorkflowGraph(nodes: {
  ingest: (state: WorkflowGraphState) => Promise<Partial<WorkflowGraphState>>
  evaluate: (state: WorkflowGraphState) => Promise<Partial<WorkflowGraphState>>
  generate: (state: WorkflowGraphState) => Promise<Partial<WorkflowGraphState>>
  inspect: (state: WorkflowGraphState) => Promise<Partial<WorkflowGraphState>>
  modify: (state: WorkflowGraphState) => Promise<Partial<WorkflowGraphState>>
}) {
  return new StateGraph(WorkflowState)
    .addNode('ingest', nodes.ingest)
    .addNode('evaluate', nodes.evaluate)
    .addNode('generate', nodes.generate)
    .addNode('inspect', nodes.inspect)
    .addNode('modify', nodes.modify)
    .addEdge(START, 'ingest')
    .addConditionalEdges('ingest', state => state.next, {
      evaluate: 'evaluate',
      generate: 'generate',
      inspect: 'inspect',
      modify: 'modify',
      finish: END,
    })
    .addEdge('evaluate', END)
    .addEdge('generate', END)
    .addEdge('inspect', END)
    .addEdge('modify', END)
    // No checkpointer: every turn is invoked with the full state loaded from
    // SessionStore (the single source of truth) and this graph runs exactly
    // one super-step per turn, so a checkpointer would add nothing but an
    // unbounded, never-pruned in-memory store of past turns (a leak).
    .compile()
}

function isCompletedPhase(phase: WorkflowSession['phase']): boolean {
  return phase === 'completed' || phase === 'completed_with_issues'
}

/**
 * Pure decision for `modify()`'s catch block: whether a failed modification
 * attempt should be left in a retryable state. Extracted so it's unit
 * testable without constructing a live `PascalAiAgent`.
 */
/**
 * Manual-edit drift detection (MODIFY_REDESIGN.md §6): does the live scene's
 * room set still match the plan snapshot it was built from? Compares room
 * count and the sorted area profile — deliberately NOT names (renames are a
 * supported non-structural edit) and NOT wall geometry (v1 has no persisted
 * node snapshot to diff against). A hand-moved wall changes zone areas, a
 * hand-added/removed room changes the count; both trip the check.
 */
export function sceneDriftedFromPlan(
  zones: Array<{ polygon: Array<[number, number]> }>,
  plan: LayoutPlan,
): boolean {
  if (zones.length !== plan.rooms.length) return true
  const zoneAreas = zones.map(zone => polygonArea(zone.polygon)).sort((a, b) => a - b)
  const planAreas = plan.rooms.map(room => polygonArea(room.polygon)).sort((a, b) => a - b)
  for (let i = 0; i < zoneAreas.length; i++) {
    const zone = zoneAreas[i]!
    const planned = planAreas[i]!
    if (Math.abs(zone - planned) > Math.max(0.8, planned * 0.1)) return true
  }
  return false
}

export function modifyFailureRecovery(
  hasPendingModification: boolean,
  hasSceneResult: boolean,
): { canRetry: boolean; phase: WorkflowSession['phase'] } {
  return {
    canRetry: hasPendingModification,
    phase: hasPendingModification
      ? 'awaiting_modification_confirmation'
      : (hasSceneResult ? 'completed_with_issues' : 'failed'),
  }
}

/**
 * Whether a plain (non-confirm/cancel) message arriving while `phase` is
 * `awaiting_modification_confirmation` (left there by a failed modify
 * attempt, see `modifyFailureRecovery`) should be treated as a brand new
 * modification instruction against the existing scene, rather than falling
 * through to generic requirement extraction.
 */
export function shouldRouteAsExistingSceneRequest(phase: WorkflowSession['phase'], message: string): boolean {
  return phase === 'awaiting_modification_confirmation' && message.trim().length > 0
}

/**
 * The outcome of the pure `ingest` routing step. `reply`/`route` are terminal
 * for this turn (the session has already been mutated accordingly).
 * `route-existing` and `intake` are delegation markers whose remaining work
 * needs MCP/model I/O and is carried out by the async `ingest` wrapper.
 */
export type IngestPlan =
  | { kind: 'reply'; reply: string }
  | { kind: 'route'; reply: string; next: 'generate' | 'modify' }
  | { kind: 'route-existing'; message: string }
  | { kind: 'intake'; message: string }

/**
 * Pure routing/state-machine core of `ingest`. Given the incoming input and a
 * (cloned, mutable) session, it decides the turn's outcome and applies every
 * phase/brief transition that needs no I/O — cancel, confirm (including the
 * "accept defaults from clarifying" escape hatch and modification-confirm),
 * empty input, existing-scene routing, length/format guards. I/O-bound
 * branches are returned as markers. Exported so all transitions are unit
 * testable without constructing a live agent or touching MCP/the model.
 */
export function planIngestAction(input: ChatInput, session: WorkflowSession): IngestPlan {
  if (input.action === 'cancel') {
    session.phase = 'cancelled'
    session.questions = []
    return { kind: 'reply', reply: t(session.language, 'taskCancelled', {}) }
  }

  if (input.action === 'confirm') {
    if (session.phase === 'awaiting_modification_confirmation' && session.pendingModification) {
      session.phase = 'modifying'
      return { kind: 'route', reply: t(session.language, 'modifyConfirmed', {}), next: 'modify' }
    }
    // `clarifying` is allowed too: the explicit "接受默认假设，直接生成" escape
    // hatch that keeps a low-confidence brief from being trapped in the
    // clarification loop with no way forward.
    if (session.phase !== 'awaiting_confirmation' && session.phase !== 'clarifying') {
      return { kind: 'reply', reply: t(session.language, 'notReadyToConfirm', {}) }
    }
    const acceptedDefaults = session.phase === 'clarifying'
    session.confirmedAt = new Date().toISOString()
    session.phase = 'generating'
    session.brief = confirmBrief(session.brief)
    return {
      kind: 'route',
      reply: acceptedDefaults
        ? t(session.language, 'confirmedWithDefaults', {})
        : t(session.language, 'requirementsConfirmed', {}),
      next: 'generate',
    }
  }

  const message = input.message?.trim() ?? ''
  if (!message && !input.imageDataUrl) {
    return { kind: 'reply', reply: t(session.language, 'emptyInput', {}) }
  }
  // A failed modification left phase here so a plain confirm can retry it; a
  // fresh plain message instead means "new change" — clear the stale pending
  // fields and reclassify it against the still-present scene.
  if (shouldRouteAsExistingSceneRequest(session.phase, message)) {
    delete session.pendingModification
    delete session.pendingOperation
    return { kind: 'route-existing', message }
  }
  if (isCompletedPhase(session.phase)) {
    if (!message) {
      return { kind: 'reply', reply: t(session.language, 'describeChangesInText', {}) }
    }
    return { kind: 'route-existing', message }
  }
  if (message.length > 5000) {
    return { kind: 'reply', reply: t(session.language, 'messageTooLong', {}) }
  }
  if (input.imageDataUrl && !isSupportedImage(input.imageDataUrl)) {
    session.phase = 'failed'
    session.availability = 'unusable'
    return { kind: 'reply', reply: t(session.language, 'unsupportedImage', {}) }
  }
  return { kind: 'intake', message }
}

export function countDiagnosticIssues(diagnostics: {
  validation: { errors: string[] }
  verificationIssues: string[]
  collisions: unknown[]
  doorlessRooms: string[]
  strayWindows: string[]
  requirementMismatches: string[]
  isolatedBedrooms: string[]
  furniturePlacementIssues?: unknown[]
}): number {
  return diagnostics.validation.errors.length +
    diagnostics.verificationIssues.length + diagnostics.collisions.length +
    diagnostics.doorlessRooms.length + diagnostics.strayWindows.length +
    diagnostics.requirementMismatches.length + diagnostics.isolatedBedrooms.length +
    (diagnostics.furniturePlacementIssues?.length ?? 0)
}

/**
 * Turn remaining diagnostics into a short, human-readable list so the reply
 * says what's actually wrong instead of just a bare count.
 */
/**
 * Guidance appended to a "completed with remaining issues" reply so the user
 * has a concrete next step. "继续修复" is picked up by
 * `classifySceneIntentFallback` as an `update` intent, which re-enters the
 * modify path and runs another diagnose/repair pass on the same scene.
 */
export function describeRemainingIssues(
  diagnostics: {
    validation: { errors: string[] }
    verificationIssues: string[]
    collisions: Array<{ aId: string; bId: string; kind: string }>
    doorlessRooms: string[]
    strayWindows: string[]
    requirementMismatches: string[]
    isolatedBedrooms: string[]
    furniturePlacementIssues?: FurniturePlacementIssue[]
    strayWallIds?: string[]
    mismatchL10n?: Array<{ id: 'zoneOverlap' | 'totalAreaOff' | 'bedroomShortfall' | 'missingSupportSpace'; params: Record<string, string | number> }>
  },
  lang: Lang = 'zh',
  limit = 5,
): string {
  // Structured sources render in the reply language; validation/verification
  // strings come from MCP in English and pass through, as do extraChecks
  // strings appended after collectDiagnostics (no l10n available).
  const mismatchCount = diagnostics.mismatchL10n?.length ?? 0
  const mismatches = diagnostics.mismatchL10n
    ? [
        ...diagnostics.mismatchL10n.map(entry => issueText(lang, entry.id, entry.params as never)),
        ...diagnostics.requirementMismatches.slice(mismatchCount),
      ]
    : diagnostics.requirementMismatches
  const strayWindows = diagnostics.strayWallIds
    ? diagnostics.strayWallIds.map(wallId => issueText(lang, 'strayWindow', { wallId }))
    : diagnostics.strayWindows
  const items = [
    ...diagnostics.validation.errors,
    ...diagnostics.verificationIssues,
    ...diagnostics.collisions.map(c => issueText(lang, 'collision', { a: c.aId, b: c.bId, kind: c.kind })),
    ...diagnostics.doorlessRooms.map(room => issueText(lang, 'doorlessRoom', { room })),
    ...strayWindows,
    ...mismatches,
    ...diagnostics.isolatedBedrooms.map(room => issueText(lang, 'isolatedBedroom', { room })),
    ...(diagnostics.furniturePlacementIssues ?? []).map(issue => renderPlacementIssue(issue, lang)),
  ]
  if (items.length === 0) return ''
  const shown = items.slice(0, limit).map(item => `- ${item}`).join('\n')
  const more = items.length > limit ? t(lang, 'moreItems', { count: items.length - limit }) : ''
  return `\n${shown}${more}`
}

// FurniturePlacementIssue carries its structure (kind + names), so the reply
// can re-render it in any language; `message` stays the zh canonical text.
function renderPlacementIssue(issue: FurniturePlacementIssue, lang: Lang): string {
  if (lang === 'zh') return issue.message
  const item = issue.itemName || issue.itemId
  switch (issue.kind) {
    case 'overlap':
      return issueText(lang, 'placementOverlap', { item, other: issue.otherItemId ?? '?' })
    case 'out_of_bounds':
      return issueText(lang, 'placementOutOfBounds', { item, room: issue.room ?? null })
    case 'door_clearance':
      return issueText(lang, 'placementDoorClearance', { item })
    default:
      return issue.message
  }
}

/**
 * session.messages records every turn but was previously never read back
 * into any model prompt, so cross-turn references ("that one", "same as
 * before", "still wrong") were invisible to the model even though they were
 * sitting right there in the transcript. This turns the last few turns into
 * plain text so callers can inject it into their prompts.
 */
function recentConversationText(messages: ChatMessage[], limit = 8): string {
  const recent = messages.slice(-limit)
  if (recent.length === 0) return ''
  return recent
    .map(m => {
      const text = typeof m.content === 'string' ? m.content : '[图片或结构化内容]'
      const trimmed = text.length > 200 ? `${text.slice(0, 200)}…` : text
      return `${m.role === 'user' ? '用户' : '助手'}：${trimmed}`
    })
    .join('\n')
}

function recentConversationBlock(messages: ChatMessage[]): string {
  const text = recentConversationText(messages)
  if (!text) return ''
  return `Recent conversation with the user (use this to resolve references like "that one" or "same as before"):\n${text}\n\n`
}

/**
 * Extract the body of a markdown `## <heading>` section (text up to the next
 * `## ` heading or end of document). Returns undefined if the heading is not
 * present, so callers can fall back gracefully when upstream guide content
 * is renamed or restructured.
 */
function extractMarkdownSection(markdown: string, heading: string): string | undefined {
  const lines = markdown.split('\n')
  const startIndex = lines.findIndex(line => line.trim() === `## ${heading}`)
  if (startIndex === -1) return undefined
  const rest = lines.slice(startIndex + 1)
  const endIndex = rest.findIndex(line => line.startsWith('## '))
  const body = (endIndex === -1 ? rest : rest.slice(0, endIndex)).join('\n').trim()
  return body.length > 0 ? body : undefined
}

// Tools that create/move item (furniture) nodes. check_collisions only
// compares unrotated bounding boxes between items and never checks items
// against walls or room bounds, and verify_scene/validate_scene don't look
// at item placement at all — so "passed automatic checks" does not cover
// furniture placement quality. apply_patch is included because it can touch
// an item node just as easily as any other node type.
const FURNITURE_TOOLS = new Set(['place_item', 'furnish_room', 'apply_patch'])

// Tools that write scene history — each successful call is one undo step.
// Used by the repair-round structure lock to roll a violating round back.
const MUTATING_TOOLS = new Set([
  'create_room', 'create_level', 'create_story_shell', 'add_door', 'add_window',
  'place_item', 'furnish_room', 'apply_patch', 'delete_node', 'set_zone',
])

// Combined remaining-issue count = structural diagnostics + furniture that
// wasn't placed as intended. Furniture failures used to be invisible to
// remainingIssueCount/phase (they only appeared in reply text), so a scene
// with overlapping/out-of-bounds furniture was mislabeled fully `completed`.
export function countAllIssues(
  diagnostics: Parameters<typeof countDiagnosticIssues>[0],
  furnitureIssues: string[],
): number {
  return countDiagnosticIssues(diagnostics) + furnitureIssues.length
}

function describeFurnitureIssues(furnitureIssues: string[], lang: Lang, limit = 5): string {
  const shown = furnitureIssues.slice(0, limit).map(issue => `- ${issue}`).join('\n')
  return t(lang, 'furnitureIssuesSummary', {
    count: furnitureIssues.length,
    list: shown,
    moreCount: Math.max(0, furnitureIssues.length - limit),
  })
}

// Builds the completion reply, counting structural diagnostics and furniture
// failures separately so the message is accurate for furniture-only issues
// (which the repair loop never attempts) instead of claiming a bogus repair
// round count.
function buildCompletionReply(args: {
  lang: Lang
  successText: string
  repairRounds: number
  diagnostics: Parameters<typeof describeRemainingIssues>[0]
  toolNamesUsed: Set<string>
  furnitureIssues: string[]
  // §5 hard-gate failures. Shown even when diagnostics are clean — a scene
  // can pass every repairable check and still fail a gate (e.g. brief 要求的
  // 房型缺失), and the reply must say so instead of claiming success.
  // Structured (with l10n) so the list renders in the reply language.
  gateFailures?: GateFailure[]
}): string {
  const lang = args.lang
  const structural = countDiagnosticIssues(args.diagnostics)
  const furniture = args.furnitureIssues.length
  const gates = args.gateFailures?.length ?? 0
  const touchedFurniture = [...args.toolNamesUsed].some(name => FURNITURE_TOOLS.has(name))
  const generalNote = touchedFurniture ? t(lang, 'furnitureGeneralNote', {}) : ''
  if (structural === 0 && furniture === 0 && gates === 0) {
    return `${args.successText}${generalNote}`
  }
  const parts: string[] = []
  if (structural > 0) {
    parts.push(t(lang, 'repairCapReached', {
      rounds: args.repairRounds,
      count: structural,
      list: describeRemainingIssues(args.diagnostics, lang),
    }))
  }
  if (gates > 0) {
    const list = args.gateFailures!
      .map(failure => `- ${renderGateFailure(failure, lang)}`)
      .join('\n')
    parts.push(t(lang, 'gatesNotPassed', { count: gates, list }))
  }
  if (furniture > 0) {
    parts.push(describeFurnitureIssues(args.furnitureIssues, lang))
  }
  return `${parts.join('\n\n')}${t(lang, 'remainingIssuesHint', {})}${generalNote}`
}

// Plan-stage failures (partitioner/validator, via PlanBuildFailure) carry an
// aligned l10n ref; re-render per language, zh/无模板 falls back to the
// canonical zh text.
function renderPlanFailure(message: string, l10n: IssueL10n | null, lang: Lang): string {
  if (lang === 'zh' || !l10n) return message
  try {
    const render = issueText as (l: Lang, id: string, params: unknown) => string
    return render(lang, l10n.id, l10n.params)
  } catch {
    return message
  }
}

// Gate failures carry {id, params}; re-render in the reply language, falling
// back to the canonical zh message when a failure predates the l10n field.
function renderGateFailure(failure: GateFailure, lang: Lang): string {
  if (lang === 'zh' || !failure.l10n) return failure.message
  try {
    // The l10n id/params come from completion-gates as a loosely-typed pair;
    // issueText's overloads can't see through that, so cast at this boundary.
    const render = issueText as (l: Lang, id: string, params: unknown) => string
    return render(lang, failure.l10n.id, failure.l10n.params)
  } catch {
    return failure.message
  }
}

/**
 * `place_item` silently swaps in a placeholder box when its `catalogItemId`
 * isn't in the catalog (status: 'catalog_unavailable'), and `furnish_room`
 * silently drops placements that don't fit (status stays 'ok' but each drop
 * is listed in `skipped`). Both were previously invisible to the user —
 * the model could see them in the tool result but nothing surfaced them in
 * the final reply. This captures human-readable notes for both cases.
 */
// Creates a fresh per-phase trace and registers it on the session. Kept on
// the session (not a local) so a phase that *throws* — e.g. structure
// non-convergence — still leaves its trace in the persisted session for the
// eval report to explain what the phase spent its rounds on.
function startPhaseTrace(session: WorkflowSession, phaseLabel: string): PhaseToolTrace {
  const trace: PhaseToolTrace = {
    phase: phaseLabel,
    modelCalls: 0,
    toolCalls: [],
    toolCounts: {},
    converged: false,
    continuationAttempts: 0,
  }
  session.toolTrace = [...(session.toolTrace ?? []), trace]
  return trace
}

// Tools whose primary argument is worth keeping in the trace: for create_room
// the room name answers "which room did the structure phase get to before
// running out of rounds"; for place_item/search_assets the asset/query shows
// what the furnishing rounds were spent on.
const TRACE_DETAIL_ARGS: Record<string, string> = {
  create_room: 'name',
  place_item: 'catalogItemId',
  search_assets: 'query',
}

function recordTraceToolCall(trace: PhaseToolTrace, toolCall: ToolCall, toolMessage: ChatMessage): void {
  const name = toolCall.function.name
  trace.toolCounts[name] = (trace.toolCounts[name] ?? 0) + 1
  // executeToolCall wraps a failed call as {"error": ...} — cheap prefix
  // check instead of parsing potentially large payloads.
  const ok = typeof toolMessage.content !== 'string' || !toolMessage.content.startsWith('{"error"')
  let detail: string | undefined
  const detailArg = TRACE_DETAIL_ARGS[name]
  if (detailArg) {
    try {
      const value = (JSON.parse(toolCall.function.arguments || '{}') as Record<string, unknown>)[detailArg]
      if (typeof value === 'string' && value) detail = value
    } catch {
      // Unparseable args — trace entry still records the call itself.
    }
  }
  trace.toolCalls.push({ name, ok, ...(detail ? { detail } : {}) })
}

function recordFurnitureIssues(
  toolName: string,
  args: Record<string, unknown>,
  payload: Record<string, unknown>,
  out: string[],
): void {
  if (toolName === 'place_item' && payload.status === 'catalog_unavailable') {
    const catalogItemId = typeof args.catalogItemId === 'string' ? args.catalogItemId : '未知素材'
    out.push(`目录中找不到 "${catalogItemId}"，已用占位方块代替`)
    return
  }
  if (toolName !== 'furnish_room' || !Array.isArray(payload.skipped)) return
  // Every `skipped` entry means the item was NOT placed into the scene —
  // "overlaps another item" is a prediction that made furnish_room decline
  // the placement, not an actual overlap between placed items. Prefix the
  // note accordingly so replies/reports don't mislabel these as overlaps
  // (actual placed-item problems come from checkFurniturePlacement instead).
  for (const entry of payload.skipped) {
    if (typeof entry === 'string' && entry.trim()) out.push(`未能放置 ${entry.trim()}`)
  }
}

export function buildOpeningRepairData(
  node: Record<string, unknown>,
  wall: Record<string, unknown>,
): Record<string, unknown> | null {
  if ((node.type !== 'door' && node.type !== 'window') || wall.type !== 'wall') return null
  if (!isNumberPair(wall.start) || !isNumberPair(wall.end) || !isNumberTriple(node.position)) {
    return null
  }
  const currentPosition = node.position
  const wallLength = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
  const wallHeight = positiveNumber(wall.height, 2.5)
  const defaultWidth = node.type === 'door' ? 0.9 : 1.5
  const defaultHeight = node.type === 'door' ? 2.1 : 1.5
  const width = Math.min(positiveNumber(node.width, defaultWidth), Math.max(0.1, wallLength - 0.02))
  const height = Math.min(positiveNumber(node.height, defaultHeight), Math.max(0.1, wallHeight - 0.02))
  const x = clamp(currentPosition[0], width / 2, Math.max(width / 2, wallLength - width / 2))
  const y = clamp(currentPosition[1], height / 2, Math.max(height / 2, wallHeight - height / 2))
  const position: [number, number, number] = [x, y, currentPosition[2]]
  if (
    width === node.width && height === node.height &&
    position.every((value, index) => value === currentPosition[index])
  ) return null
  return { position, width, height }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isNumberPair(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every(item => typeof item === 'number')
}

function isNumberTriple(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every(item => typeof item === 'number')
}

type WallSummary = {
  id: string
  start: [number, number]
  end: [number, number]
  thickness?: number
  height?: number
  name?: string
}

function isWallSummary(value: unknown): value is WallSummary {
  return isRecord(value) && typeof value.id === 'string' &&
    isNumberPair(value.start) && isNumberPair(value.end)
}

// Two walls built independently by separate `create_room` calls along a
// shared boundary land on (near enough) the same line segment. 5cm covers
// normal floating-point drift without risking merging two walls that are
// genuinely just close together (e.g. a narrow corridor).
const WALL_COINCIDENCE_EPSILON_M = 0.05

function pointsClose(p: [number, number], q: [number, number]): boolean {
  return Math.hypot(p[0] - q[0], p[1] - q[1]) <= WALL_COINCIDENCE_EPSILON_M
}

// Two rooms tracing a shared edge may walk it in opposite directions
// (clockwise vs counter-clockwise polygon winding), so both same-direction
// and reversed-direction endpoint matches count as coincident. Takes any
// {start,end} shape so it also works for a raw zone-polygon edge, not just
// two WallSummary objects. This only catches *exact* endpoint-pair matches —
// see `collinearOverlap` below for the T-junction case where a long wall
// partially overlaps one or more shorter walls without sharing endpoints.
function wallsCoincide(
  a: { start: [number, number]; end: [number, number] },
  b: { start: [number, number]; end: [number, number] },
): boolean {
  return (pointsClose(a.start, b.start) && pointsClose(a.end, b.end)) ||
    (pointsClose(a.start, b.end) && pointsClose(a.end, b.start))
}

// A segment's orientation as a position along a fixed axis, for rooms built
// axis-aligned (per our own structure-phase prompt guidance). Returns null
// for a diagonal segment — those fall back to exact endpoint matching via
// `wallsCoincide`, since interval overlap isn't meaningful off-axis.
type SegmentOrientation = { axis: 'x' | 'z'; constant: number; lo: number; hi: number }

function segmentOrientation(seg: { start: [number, number]; end: [number, number] }): SegmentOrientation | null {
  const [sx, sz] = seg.start
  const [ex, ez] = seg.end
  if (Math.abs(sx - ex) <= WALL_COINCIDENCE_EPSILON_M) {
    // Vertical in plan (runs along z), x is constant.
    return { axis: 'z', constant: (sx + ex) / 2, lo: Math.min(sz, ez), hi: Math.max(sz, ez) }
  }
  if (Math.abs(sz - ez) <= WALL_COINCIDENCE_EPSILON_M) {
    // Horizontal in plan (runs along x), z is constant.
    return { axis: 'x', constant: (sz + ez) / 2, lo: Math.min(sx, ex), hi: Math.max(sx, ex) }
  }
  return null
}

// Below this, two collinear segments are considered "touching" (e.g. at a
// shared corner) rather than meaningfully overlapping — must stay smaller
// than any real wall-splitting fragment we'd want to keep.
const MIN_MEANINGFUL_OVERLAP_M = 0.03

/**
 * Two axis-aligned segments overlap collinearly if they run along the same
 * axis at the same constant coordinate (within wall-coincidence tolerance)
 * and their 1D intervals along that axis overlap by more than a sliver.
 * Handles exact duplicates, one segment fully containing the other, and
 * partial (T-junction / staggered) overlap uniformly — the caller decides
 * what to do with the overlap interval.
 */
function collinearOverlap(
  a: { start: [number, number]; end: [number, number] },
  b: { start: [number, number]; end: [number, number] },
): { axis: 'x' | 'z'; constant: number; lo: number; hi: number } | null {
  const oa = segmentOrientation(a)
  const ob = segmentOrientation(b)
  if (!oa || !ob) return null
  if (oa.axis !== ob.axis) return null
  if (Math.abs(oa.constant - ob.constant) > WALL_COINCIDENCE_EPSILON_M) return null
  const lo = Math.max(oa.lo, ob.lo)
  const hi = Math.min(oa.hi, ob.hi)
  if (hi - lo <= MIN_MEANINGFUL_OVERLAP_M) return null
  return { axis: oa.axis, constant: (oa.constant + ob.constant) / 2, lo, hi }
}

// True if `a` and `b` overlap enough (exact endpoint match OR meaningful
// collinear interval overlap) that a door/window hosted on either one
// should count as hosted on the other's edge too.
function segmentsCoverSameLine(
  a: { start: [number, number]; end: [number, number] },
  b: { start: [number, number]; end: [number, number] },
): boolean {
  return wallsCoincide(a, b) || collinearOverlap(a, b) !== null
}

function orientationToSegment(o: { axis: 'x' | 'z'; constant: number; lo: number; hi: number }): {
  start: [number, number]
  end: [number, number]
} {
  return o.axis === 'x'
    ? { start: [o.lo, o.constant], end: [o.hi, o.constant] }
    : { start: [o.constant, o.lo], end: [o.constant, o.hi] }
}

export type WallOpening = { type: string }
export type WallWithOpenings = WallSummary & { openings: WallOpening[] }

function isWallWithOpenings(value: unknown): value is WallWithOpenings {
  if (!isWallSummary(value)) return false
  const openings = (value as { openings?: unknown }).openings
  return Array.isArray(openings) && openings.every(
    o => isRecord(o) && typeof o.type === 'string',
  )
}

export type ZoneSummary = { id: string; name: string; polygon: Array<[number, number]> }

function isZoneSummary(value: unknown): value is ZoneSummary {
  return isRecord(value) && typeof value.id === 'string' &&
    typeof value.name === 'string' && isPolygon(value.polygon)
}

function isPolygon(value: unknown): value is Array<[number, number]> {
  return Array.isArray(value) && value.length >= 3 && value.every(isNumberPair)
}

// ---------------------------------------------------------------------------
// Deterministic current-state furniture placement check. check_collisions
// ignores item rotation and never tests items against room polygons or door
// swings, so a scene could pass every automated check with a rotated sofa in
// the wall and a fridge in the doorway. This check recomputes each floor
// item's rotated footprint (same math and 8cm gap convention as MCP's
// furnish_room) and reports pairwise overlaps, out-of-room placements, and
// door-clearance violations. Results feed countDiagnosticIssues, so they
// trigger and steer repair rounds like any structural problem.
// ---------------------------------------------------------------------------

export type ItemSummary = {
  id: string
  name?: string
  position: [number, number, number]
  rotation?: [number, number, number]
  asset?: { dimensions?: [number, number, number]; attachTo?: string | null }
}

function isItemSummary(value: unknown): value is ItemSummary {
  return isRecord(value) && typeof value.id === 'string' && isNumberTriple(value.position)
}

type Footprint2D = { minX: number; maxX: number; minZ: number; maxZ: number }

const FURNITURE_GAP_M = 0.08
const DOOR_CLEARANCE_DEPTH_M = 0.75
const FOOTPRINT_BOUNDS_SLACK_M = 0.05

function itemFootprint2D(item: ItemSummary): Footprint2D {
  const [w = 1, , d = 1] = item.asset?.dimensions ?? [1, 1, 1]
  const rotationY = item.rotation?.[1] ?? 0
  const cos = Math.abs(Math.cos(rotationY))
  const sin = Math.abs(Math.sin(rotationY))
  const halfW = (w * cos + d * sin) / 2
  const halfD = (w * sin + d * cos) / 2
  const [x, , z] = item.position
  return { minX: x - halfW, maxX: x + halfW, minZ: z - halfD, maxZ: z + halfD }
}

function footprintsIntersect(a: Footprint2D, b: Footprint2D, gap: number): boolean {
  return a.maxX - gap > b.minX && a.minX + gap < b.maxX && a.maxZ - gap > b.minZ && a.minZ + gap < b.maxZ
}

export function checkFurniturePlacement(
  zones: ZoneSummary[],
  walls: WallWithOpenings[],
  items: ItemSummary[],
): FurniturePlacementIssue[] {
  const issues: FurniturePlacementIssue[] = []
  // Wall/ceiling-mounted items have no floor footprint to check.
  const floorItems = items.filter(item => {
    const attachTo = item.asset?.attachTo
    return attachTo !== 'wall' && attachTo !== 'ceiling'
  })
  const footprints = floorItems.map(itemFootprint2D)
  const label = (item: ItemSummary) => item.name || item.id

  for (let i = 0; i < floorItems.length; i++) {
    for (let j = i + 1; j < floorItems.length; j++) {
      if (footprintsIntersect(footprints[i]!, footprints[j]!, FURNITURE_GAP_M)) {
        issues.push({
          kind: 'overlap',
          itemId: floorItems[i]!.id,
          itemName: floorItems[i]!.name,
          otherItemId: floorItems[j]!.id,
          message: `家具「${label(floorItems[i]!)}」与「${label(floorItems[j]!)}」实际重叠，请移动其中一件到空位`,
        })
      }
    }
  }

  for (let i = 0; i < floorItems.length; i++) {
    const item = floorItems[i]!
    const [x, , z] = item.position
    const home = zones.find(zone => pointInPolygon(x, z, zone.polygon))
    if (!home) {
      issues.push({
        kind: 'out_of_bounds',
        itemId: item.id,
        itemName: item.name,
        message: `家具「${label(item)}」的中心不在任何房间内，请移到目标房间的多边形内部`,
      })
      continue
    }
    const fp = footprints[i]!
    const corners: Array<[number, number]> = [
      [fp.minX + FOOTPRINT_BOUNDS_SLACK_M, fp.minZ + FOOTPRINT_BOUNDS_SLACK_M],
      [fp.maxX - FOOTPRINT_BOUNDS_SLACK_M, fp.minZ + FOOTPRINT_BOUNDS_SLACK_M],
      [fp.maxX - FOOTPRINT_BOUNDS_SLACK_M, fp.maxZ - FOOTPRINT_BOUNDS_SLACK_M],
      [fp.minX + FOOTPRINT_BOUNDS_SLACK_M, fp.maxZ - FOOTPRINT_BOUNDS_SLACK_M],
    ]
    if (corners.some(([cx, cz]) => !pointInPolygon(cx, cz, home.polygon))) {
      issues.push({
        kind: 'out_of_bounds',
        itemId: item.id,
        itemName: item.name,
        room: home.name || home.id,
        message: `家具「${label(item)}」超出了房间「${home.name || home.id}」的边界（考虑旋转后的实际占地），请移入房间内部`,
      })
    }
  }

  // Door clearance: a rectangle centered on each door, extending
  // DOOR_CLEARANCE_DEPTH_M to both sides of its (axis-aligned) wall, must
  // stay free of furniture so the door can open and people can pass.
  for (const wall of walls) {
    const orientation = segmentOrientation(wall)
    if (!orientation) continue // diagonal wall — skip, best-effort
    for (const opening of wall.openings) {
      if (opening.type !== 'door') continue
      const record = opening as Record<string, unknown>
      const localX = isNumberTriple(record.position) ? record.position[0] : undefined
      if (typeof localX !== 'number') continue
      const width = typeof record.width === 'number' ? record.width : 0.9
      // add_door stores localX measured from wall.start; for an axis-aligned
      // wall that equals the low coordinate when start < end, otherwise it
      // measures back from the high end — normalize via the actual start.
      const startCoord = orientation.axis === 'x' ? wall.start[0] : wall.start[1]
      const endCoord = orientation.axis === 'x' ? wall.end[0] : wall.end[1]
      const doorCenterAlong = startCoord <= endCoord ? startCoord + localX : startCoord - localX
      const alongLo = doorCenterAlong - width / 2 - FOOTPRINT_BOUNDS_SLACK_M
      const alongHi = doorCenterAlong + width / 2 + FOOTPRINT_BOUNDS_SLACK_M
      const clearance: Footprint2D = orientation.axis === 'x'
        ? { minX: alongLo, maxX: alongHi, minZ: orientation.constant - DOOR_CLEARANCE_DEPTH_M, maxZ: orientation.constant + DOOR_CLEARANCE_DEPTH_M }
        : { minX: orientation.constant - DOOR_CLEARANCE_DEPTH_M, maxX: orientation.constant + DOOR_CLEARANCE_DEPTH_M, minZ: alongLo, maxZ: alongHi }
      for (let i = 0; i < floorItems.length; i++) {
        if (footprintsIntersect(footprints[i]!, clearance, 0)) {
          const item = floorItems[i]!
          issues.push({
            kind: 'door_clearance',
            itemId: item.id,
            itemName: item.name,
            message: `家具「${label(item)}」占用了墙 ${wall.id} 上房门的开启/通行空间，请移开让出门口约 ${DOOR_CLEARANCE_DEPTH_M}m 的净空`,
          })
        }
      }
    }
  }
  return issues
}

// ---------------------------------------------------------------------------
// Modification-protection closed loop (modify path). A "before" snapshot of
// the node map is taken at the start of the turn; after the modification and
// after every repair round, `checkModificationProtection` diffs the current
// graph against it and reports violations as repairable issue strings. This
// is the deterministic counterpart of the eval harness's modification
// assertions — same geometry-field semantics (walls compare start/end/
// thickness/height; a wall gaining a door child is NOT a modified wall; the
// door/window nodes themselves are checked separately).
// ---------------------------------------------------------------------------

export type SceneNodeSnapshot = Record<string, Record<string, unknown>>

export function snapshotSceneNodes(payload: Record<string, unknown>): SceneNodeSnapshot {
  const nodes = payload.nodes
  if (!isRecord(nodes)) return {}
  const out: SceneNodeSnapshot = {}
  for (const [id, node] of Object.entries(nodes)) {
    if (isRecord(node)) out[id] = node
  }
  return out
}

// 1mm: genuine edits move geometry by far more; re-serialization noise never does.
const GEOM_FIELD_EPS = 0.001

function geomNumbersDiffer(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) > GEOM_FIELD_EPS
  return a !== b
}

function geomPairDiffers(a: unknown, b: unknown): boolean {
  if (isNumberPair(a) && isNumberPair(b)) {
    return geomNumbersDiffer(a[0], b[0]) || geomNumbersDiffer(a[1], b[1])
  }
  return JSON.stringify(a) !== JSON.stringify(b)
}

export function wallGeometryFieldsChanged(before: Record<string, unknown>, after: Record<string, unknown>): boolean {
  return (
    geomPairDiffers(before.start, after.start) ||
    geomPairDiffers(before.end, after.end) ||
    geomNumbersDiffer(before.thickness, after.thickness) ||
    geomNumbersDiffer(before.height, after.height)
  )
}

export function openingFieldsChanged(before: Record<string, unknown>, after: Record<string, unknown>): boolean {
  const positionDiffers = isNumberTriple(before.position) && isNumberTriple(after.position)
    ? before.position.some((value, index) => geomNumbersDiffer(value, (after.position as number[])[index]))
    : JSON.stringify(before.position) !== JSON.stringify(after.position)
  return (
    positionDiffers ||
    geomNumbersDiffer(before.width, after.width) ||
    geomNumbersDiffer(before.height, after.height) ||
    before.parentId !== after.parentId ||
    before.wallId !== after.wallId
  )
}

/**
 * Whether the modification request itself asks for the existing structure to
 * be preserved ("保持…不变", "不修改其他墙体", "最小改动", …). Strict wall/
 * opening protection is only enforced when the user asked for it — a resize
 * request ("把卧室扩大") legitimately moves original walls, and enforcing
 * protection there would trap the repair loop on unfixable issues.
 */
export function requestsStructurePreservation(request: string): boolean {
  return /保持[^。；\n]{0,20}不变|不(?:要)?(?:修改|改动|变动|移动)其他|除[^。；\n]{0,30}外[^。；\n]{0,10}不(?:修改|改动|变动)|最小改动|其余[^。；\n]{0,10}保持/.test(request)
}

/**
 * Extract an explicit area range like "6–8㎡ / 6~8平米 / 6-8 平方米" from the
 * request text. Returns null when absent or ambiguous (multiple distinct
 * ranges), so the caller only ever enforces a constraint the user clearly
 * stated once.
 */
export function extractAreaRangeConstraint(text: string): { min: number; max: number } | null {
  const matches = [...text.matchAll(/(\d+(?:\.\d+)?)\s*[–—~～\-至到]\s*(\d+(?:\.\d+)?)\s*(?:㎡|平方米|平米|平)/g)]
  const ranges = new Set(matches.map(m => `${m[1]}|${m[2]}`))
  if (ranges.size !== 1) return null
  const [minRaw, maxRaw] = [...ranges][0]!.split('|')
  const min = Number.parseFloat(minRaw!)
  const max = Number.parseFloat(maxRaw!)
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min) return null
  return { min, max }
}

/**
 * Deterministic acceptance for a modification turn. Always checks any
 * explicit added-room area range in the request; additionally enforces
 * original-wall/opening protection when the request asked for preservation.
 * Issue strings are written as repair instructions, since they are forwarded
 * verbatim to the repair-round prompt.
 */
export function checkModificationProtection(
  before: SceneNodeSnapshot,
  after: SceneNodeSnapshot,
  request: string,
): string[] {
  const issues: string[] = []
  if (requestsStructurePreservation(request)) {
    for (const [id, node] of Object.entries(before)) {
      const type = node.type
      if (type !== 'wall' && type !== 'door' && type !== 'window') continue
      const label = type === 'wall' ? '墙' : type === 'door' ? '门' : '窗'
      const current = after[id]
      if (!current) {
        issues.push(`原${label} ${id} 被删除了——用户要求保持原有结构不变，除新增节点外不得删除既有${label}体，请恢复`)
        continue
      }
      const changed = type === 'wall'
        ? wallGeometryFieldsChanged(node, current)
        : openingFieldsChanged(node, current)
      if (changed) {
        issues.push(`原${label} ${id} 的几何（位置/尺寸/宿主）被修改——用户要求保持原有结构不变，请把它恢复为修改前的状态，改用新增隔墙实现需求`)
      }
    }
  }
  const range = extractAreaRangeConstraint(request)
  if (range) {
    for (const [id, node] of Object.entries(after)) {
      if (id in before || node.type !== 'zone' || !isPolygon(node.polygon)) continue
      const area = Math.round(polygonArea(node.polygon) * 100) / 100
      if (area < range.min || area > range.max) {
        const name = typeof node.name === 'string' && node.name ? node.name : id
        issues.push(
          `新增房间「${name}」实测面积 ${area}㎡，不在要求的 ${range.min}–${range.max}㎡ 内。请调整该房间的边界使面积落入范围，并把被它挤占的相邻房间恢复原状`,
        )
      }
    }
  }
  return issues
}

// ---------------------------------------------------------------------------
// Deterministic floor-area acceptance. The eval harness always checked total
// area, but nothing on the generation side did — a build 50% over the brief's
// target sailed through every repair round as "no issues" (case-03). These
// helpers close that loop: `checkAreaRequirements` output feeds
// `requirementMismatches`, which both triggers and steers the repair loop.
// ---------------------------------------------------------------------------

function polygonArea(polygon: Array<[number, number]>): number {
  let sum = 0
  for (let i = 0; i < polygon.length; i++) {
    const [x1, z1] = polygon[i]!
    const [x2, z2] = polygon[(i + 1) % polygon.length]!
    sum += x1 * z2 - x2 * z1
  }
  return Math.abs(sum) / 2
}

function pointInPolygon(x: number, z: number, polygon: Array<[number, number]>): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i]!
    const [xj, zj] = polygon[j]!
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
      inside = !inside
    }
  }
  return inside
}

/**
 * Per-zone areas can't simply be summed for a total-area check: if two room
 * polygons overlap (rooms built independently can intrude on each other),
 * the sum double-counts the overlap and reads high. This computes the true
 * union area — plus how much area is covered more than once, and by which
 * zone pairs — with a compressed-grid decomposition: collect every distinct
 * vertex coordinate on each axis, and classify each resulting grid cell by
 * testing its midpoint against every zone polygon. Exact for the
 * axis-aligned rectilinear rooms our structure prompt produces; a close
 * approximation for anything diagonal.
 */
export function computeZoneAreaStats(zones: ZoneSummary[]): {
  sumArea: number
  unionArea: number
  overlapArea: number
  overlappingPairs: Array<{ aName: string; bName: string; areaSqMeters: number }>
} {
  const sumArea = zones.reduce((total, zone) => total + polygonArea(zone.polygon), 0)
  const xsSet = new Set<number>()
  const zsSet = new Set<number>()
  for (const zone of zones) {
    for (const [x, z] of zone.polygon) {
      xsSet.add(x)
      zsSet.add(z)
    }
  }
  const xs = [...xsSet].sort((a, b) => a - b)
  const zs = [...zsSet].sort((a, b) => a - b)
  let unionArea = 0
  let overlapArea = 0
  const pairAreas = new Map<string, { aName: string; bName: string; areaSqMeters: number }>()
  for (let i = 0; i < xs.length - 1; i++) {
    const cellWidth = xs[i + 1]! - xs[i]!
    if (cellWidth <= 0) continue
    const cx = (xs[i]! + xs[i + 1]!) / 2
    for (let j = 0; j < zs.length - 1; j++) {
      const cellDepth = zs[j + 1]! - zs[j]!
      if (cellDepth <= 0) continue
      const cz = (zs[j]! + zs[j + 1]!) / 2
      const covering = zones.filter(zone => pointInPolygon(cx, cz, zone.polygon))
      if (covering.length === 0) continue
      const cellArea = cellWidth * cellDepth
      unionArea += cellArea
      if (covering.length < 2) continue
      overlapArea += cellArea
      for (let a = 0; a < covering.length; a++) {
        for (let b = a + 1; b < covering.length; b++) {
          const key = [covering[a]!.id, covering[b]!.id].sort().join('|')
          const entry = pairAreas.get(key) ?? {
            aName: covering[a]!.name || covering[a]!.id,
            bName: covering[b]!.name || covering[b]!.id,
            areaSqMeters: 0,
          }
          entry.areaSqMeters += cellArea
          pairAreas.set(key, entry)
        }
      }
    }
  }
  return { sumArea, unionArea, overlapArea, overlappingPairs: [...pairAreas.values()] }
}

// Generation-side acceptance is deliberately tighter (±10%) than the eval
// harness (±12%), so a scene that passes here also passes evaluation.
const AREA_TOLERANCE_RATIO = 0.1
// Ignore sliver overlaps from floating-point drift along shared boundaries.
const MIN_MEANINGFUL_ZONE_OVERLAP_SQM = 0.05

const FLOOR_AREA_FACT_KEYS = ['floor_area_sqm', 'area_sqm', 'room_area_sqm', 'area']

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * Deterministic total-area and zone-overlap acceptance against the confirmed
 * brief. Returns human-readable issue strings for `requirementMismatches`.
 * The area-mismatch message carries its own repair guidance because the
 * repair prompt forwards these strings verbatim — fixing a global area miss
 * requires re-partitioning, not nudging one room.
 */
export type MismatchFinding = {
  message: string
  l10n: { id: 'zoneOverlap' | 'totalAreaOff' | 'bedroomShortfall' | 'missingSupportSpace'; params: Record<string, string | number> }
}

export function checkAreaRequirements(zones: ZoneSummary[], brief: DesignBrief): MismatchFinding[] {
  if (zones.length === 0) return []
  const issues: MismatchFinding[] = []
  const stats = computeZoneAreaStats(zones)
  for (const pair of stats.overlappingPairs) {
    if (pair.areaSqMeters <= MIN_MEANINGFUL_ZONE_OVERLAP_SQM) continue
    const params = { a: pair.aName, b: pair.bName, area: round1(pair.areaSqMeters) }
    issues.push({ message: issueText('zh', 'zoneOverlap', params), l10n: { id: 'zoneOverlap', params } })
  }
  const target = numberFact(brief, FLOOR_AREA_FACT_KEYS)
  if (target !== undefined && target > 0) {
    // Union (not sum) so overlapping rooms can't inflate the reading.
    const actual = stats.unionArea
    if (Math.abs(actual - target) > target * AREA_TOLERANCE_RATIO) {
      const deviation = Math.round((Math.abs(actual - target) / target) * 100)
      const params = { target, actual: round1(actual), deviation, tolerance: Math.round(AREA_TOLERANCE_RATIO * 100) }
      issues.push({ message: issueText('zh', 'totalAreaOff', params), l10n: { id: 'totalAreaOff', params } })
    }
  }
  return issues
}

/**
 * A room with no door of its own is a sealed-off space nobody can walk
 * into. `verify_scene` only checks whether a *level* has any doors at all,
 * not whether each individual room does, so a room that got missed during
 * the openings phase (especially likely now that rooms are built and
 * connected one at a time) slips through unnoticed. We match each zone's
 * polygon edges to every wall that covers any part of that edge — a T
 * junction can leave one long zone edge represented by several shorter wall
 * segments after dedup, so this checks all overlapping walls rather than a
 * single exact match — and check whether any of them hosts a door.
 */
function findDoorlessRooms(zones: ZoneSummary[], walls: WallWithOpenings[]): string[] {
  const doorless: string[] = []
  for (const zone of zones) {
    let hasDoor = false
    for (let i = 0; i < zone.polygon.length && !hasDoor; i++) {
      const edgeStart = zone.polygon[i]!
      const edgeEnd = zone.polygon[(i + 1) % zone.polygon.length]!
      const edge = { start: edgeStart, end: edgeEnd }
      hasDoor = walls.some(
        w => segmentsCoverSameLine(w, edge) && w.openings.some(o => o.type === 'door'),
      )
    }
    if (!hasDoor) doorless.push(zone.name || zone.id)
  }
  return doorless
}

// Fuzzy, name-based room classification for the circulation check below —
// same limitation as `compareRoomsToRequirements`: `create_room` has no
// `type` field, only a model-chosen name.
type CirculationRoomKind = 'bedroom' | 'blocked-service' | 'passable'

// Delegates to the shared trilingual vocabulary. living_kitchen resolves to
// passable (an open kitchen merged into the living space IS the public path —
// the case-02 lesson); pure kitchens/bathrooms block transit.
function classifyCirculationRoomKind(name: string): CirculationRoomKind {
  switch (classifyRoomTypeByName(name)) {
    case 'bedroom':
      return 'bedroom'
    case 'kitchen':
    case 'bathroom':
      return 'blocked-service'
    default:
      return 'passable'
  }
}

// Which zone(s) a wall's segment lies along the boundary of. A door on a
// wall that hosts two zones' edges connects those two rooms; a door on a
// wall that only hosts one zone's edge leads outside (or to an
// as-yet-untracked space) and doesn't contribute an interior connection.
function wallHostZoneIds(
  wall: { start: [number, number]; end: [number, number] },
  zones: ZoneSummary[],
): string[] {
  const hostIds: string[] = []
  for (const zone of zones) {
    for (let i = 0; i < zone.polygon.length; i++) {
      const edgeStart = zone.polygon[i]!
      const edgeEnd = zone.polygon[(i + 1) % zone.polygon.length]!
      if (segmentsCoverSameLine(wall, { start: edgeStart, end: edgeEnd })) {
        hostIds.push(zone.id)
        break
      }
    }
  }
  return hostIds
}

/**
 * Deterministic check for the circulation rule the structure-phase prompt
 * asks the model to plan for ("每个卧室都必须能只经过公共动线到达，不能要求
 * 先穿过卫生间、厨房或另一个卧室才能到达") but never verifies — the model can
 * (and, per earlier observed generations, sometimes does) route a bedroom's
 * only door through another bedroom or straight into the kitchen/bathroom.
 *
 * Builds a room-adjacency graph from doors: a door on a wall connects every
 * zone whose boundary that wall's segment lies along (usually the two rooms
 * either side of an interior wall). Then, for each bedroom, does a BFS that
 * is only allowed to terminate *at* a kitchen/bathroom/other-bedroom (a dead
 * end — not a valid path onward) but never allowed to continue *through*
 * one, looking for any reachable room that isn't itself a bedroom, kitchen,
 * or bathroom. A bedroom with no such reachable room is flagged.
 *
 * Known limitation: this treats every non-bedroom/kitchen/bathroom room
 * (living room, hallway, entry, dining, study, storage, ...) as valid
 * circulation, which is a looser reading than "must be a genuine public
 * circulation hub" — deliberately so, since the prompt's actual requirement
 * is only ever framed as the negative rule above, not a positive list of
 * qualifying room types. An intentionally adjoining suite (e.g. a bedroom
 * opening only into a dressing room that opens into the hallway) would also
 * false-positive here, same class of tradeoff as `findStrayWindows`.
 */
export function findIsolatedBedrooms(zones: ZoneSummary[], walls: WallWithOpenings[]): string[] {
  const kindById = new Map<string, CirculationRoomKind>()
  for (const zone of zones) kindById.set(zone.id, classifyCirculationRoomKind(zone.name || ''))

  const bounds = overallZoneBounds(zones)
  const adjacency = new Map<string, Set<string>>()
  // Zones with a door in an exterior wall (a door wall hosted by exactly one
  // zone, sitting on the building boundary): that's an entry door straight to
  // the outside, which connects the room to the public world without any
  // interior public room. Without this, a single-room dwelling — whose only
  // door IS the entry door — is flagged isolated and burns repair rounds on
  // an unfixable finding (plan-first builds hit this every time on case-01).
  const exteriorDoorZoneIds = new Set<string>()
  for (const zone of zones) adjacency.set(zone.id, new Set())
  for (const wall of walls) {
    if (!wall.openings.some(o => o.type === 'door')) continue
    const hostIds = wallHostZoneIds(wall, zones)
    if (hostIds.length === 1 && bounds) {
      const midX = (wall.start[0] + wall.end[0]) / 2
      const midZ = (wall.start[1] + wall.end[1]) / 2
      const onBoundary =
        Math.abs(midX - bounds.minX) <= EXTERIOR_BOUNDARY_EPSILON_M ||
        Math.abs(midX - bounds.maxX) <= EXTERIOR_BOUNDARY_EPSILON_M ||
        Math.abs(midZ - bounds.minZ) <= EXTERIOR_BOUNDARY_EPSILON_M ||
        Math.abs(midZ - bounds.maxZ) <= EXTERIOR_BOUNDARY_EPSILON_M
      if (onBoundary) exteriorDoorZoneIds.add(hostIds[0]!)
    }
    for (let i = 0; i < hostIds.length; i++) {
      for (let j = i + 1; j < hostIds.length; j++) {
        adjacency.get(hostIds[i]!)?.add(hostIds[j]!)
        adjacency.get(hostIds[j]!)?.add(hostIds[i]!)
      }
    }
  }

  const isolated: string[] = []
  for (const zone of zones) {
    if (kindById.get(zone.id) !== 'bedroom') continue
    if (exteriorDoorZoneIds.has(zone.id)) continue
    const visited = new Set<string>([zone.id])
    const queue: string[] = [zone.id]
    let reachedPassable = false
    while (queue.length > 0 && !reachedPassable) {
      const current = queue.shift()!
      for (const neighborId of adjacency.get(current) ?? []) {
        if (visited.has(neighborId)) continue
        visited.add(neighborId)
        if (kindById.get(neighborId) === 'passable') {
          reachedPassable = true
          break
        }
        // A bedroom or kitchen/bathroom neighbor is a dead end for this
        // check — reachable, but not allowed to be transited *through*, so
        // it's marked visited (no revisiting) but never enqueued.
      }
    }
    if (!reachedPassable) isolated.push(zone.name || zone.id)
  }
  return isolated
}

// Approximates "is this wall on the building's exterior?" by the overall
// bounding box of every room (there's no stored footprint polygon to check
// against once a wall isn't touching the outer edge of that box, it's
// almost certainly an interior partition). Rectangular-ish footprints only
// — an L-shaped building could false-positive on the notch, so this is a
// best-effort signal fed into repair rounds, not a hard failure.
const EXTERIOR_BOUNDARY_EPSILON_M = 0.15

function overallZoneBounds(
  zones: ZoneSummary[],
): { minX: number; maxX: number; minZ: number; maxZ: number } | null {
  if (zones.length === 0) return null
  const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }
  for (const zone of zones) {
    for (const [x, z] of zone.polygon) {
      if (x < bounds.minX) bounds.minX = x
      if (x > bounds.maxX) bounds.maxX = x
      if (z < bounds.minZ) bounds.minZ = z
      if (z > bounds.maxZ) bounds.maxZ = z
    }
  }
  return bounds
}

// Returns the OFFENDING WALL IDS; callers render the message per language
// (zh for diagnostics/prompts, the user's language for the reply summary).
function findStrayWindows(zones: ZoneSummary[], walls: WallWithOpenings[]): string[] {
  const bounds = overallZoneBounds(zones)
  if (!bounds) return []
  const wallIds: string[] = []
  for (const wall of walls) {
    if (!wall.openings.some(o => o.type === 'window')) continue
    const midX = (wall.start[0] + wall.end[0]) / 2
    const midZ = (wall.start[1] + wall.end[1]) / 2
    const onBoundary =
      Math.abs(midX - bounds.minX) <= EXTERIOR_BOUNDARY_EPSILON_M ||
      Math.abs(midX - bounds.maxX) <= EXTERIOR_BOUNDARY_EPSILON_M ||
      Math.abs(midZ - bounds.minZ) <= EXTERIOR_BOUNDARY_EPSILON_M ||
      Math.abs(midZ - bounds.maxZ) <= EXTERIOR_BOUNDARY_EPSILON_M
    if (!onBoundary) wallIds.push(wall.id)
  }
  return wallIds
}

/**
 * `create_room` has no `type` field, only a model-chosen `name`, so this is
 * necessarily a fuzzy keyword match rather than an exact comparison. Scoped
 * to the two things we can check with reasonable confidence: bedroom count
 * (a concrete number in the brief) and presence of support spaces the brief
 * *itself* explicitly asked for.
 *
 * Deliberately does NOT infer "this must be a full home" from bedroom count
 * alone — a brief that only requested N bedrooms should not have a kitchen,
 * bathroom, or living room forced onto it during repair rounds just because
 * it mentioned a number of bedrooms. Only requestedRooms (the brief's own
 * explicit room list) drives which support spaces are checked for.
 */
function compareRoomsToRequirements(zoneNames: string[], brief: DesignBrief): MismatchFinding[] {
  const issues: MismatchFinding[] = []
  const bedroomCount = numberFact(brief, ['bedroom_count', 'bedrooms'])
  if (bedroomCount !== undefined && bedroomCount > 0) {
    const actual = zoneNames.filter(name => ROOM_NAME_PATTERNS.bedroom.test(name)).length
    if (actual < bedroomCount) {
      const params = { expected: bedroomCount, actual }
      issues.push({ message: issueText('zh', 'bedroomShortfall', params), l10n: { id: 'bedroomShortfall', params } })
    }
  }
  const requestedRooms = arrayFact(brief, ['rooms', 'required_rooms', 'function_spaces'])
  const supportSpaces: Array<[string, RegExp]> = [
    ['厨房', ROOM_NAME_PATTERNS.kitchen],
    ['卫生间', ROOM_NAME_PATTERNS.bathroom],
    ['客厅', ROOM_NAME_PATTERNS.living],
  ]
  for (const [label, pattern] of supportSpaces) {
    const wasRequested = requestedRooms.some(room => pattern.test(room))
    if (wasRequested && !zoneNames.some(name => pattern.test(name))) {
      const params = { label }
      issues.push({ message: issueText('zh', 'missingSupportSpace', params), l10n: { id: 'missingSupportSpace', params } })
    }
  }
  return issues
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function createSession(input: ChatInput, now: string): WorkflowSession {
  return {
    sessionId: input.sessionId,
    ...(input.sceneId ? { sceneId: input.sceneId } : {}),
    inputType: input.imageDataUrl ? 'image' : 'text',
    phase: 'intake',
    availability: 'partially_usable',
    brief: structuredClone(EMPTY_BRIEF),
    questions: [],
    reasons: [],
    summary: '',
    messages: [],
    clarificationRounds: 0,
    createdAt: now,
    updatedAt: now,
  }
}

export function mergeBrief(current: DesignBrief, extraction: ExtractionResponse): DesignBrief {
  return {
    existingCondition: mergeFacts(current.existingCondition, extraction.existingCondition),
    designGoals: mergeFacts(current.designGoals, extraction.designGoals),
    hardConstraints: mergeFacts(current.hardConstraints, extraction.hardConstraints),
    assumptions: mergeFacts(current.assumptions, extraction.assumptions),
    uncertainties: mergeFacts(current.uncertainties, extraction.uncertainties),
    conflicts: normalizeConflicts(extraction.conflicts, current.conflicts),
  }
}

function mergeFacts(current: RequirementFact[], raw: unknown): RequirementFact[] {
  const map = new Map(current.map(fact => [fact.key, fact]))
  if (!Array.isArray(raw)) return [...map.values()]
  for (const candidate of raw) {
    const fact = normalizeFact(candidate)
    if (fact) map.set(fact.key, fact)
  }
  return [...map.values()]
}

function normalizeFact(raw: unknown): RequirementFact | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  if (typeof value.key !== 'string' || typeof value.label !== 'string') return null
  if (!isFactValue(value.value)) return null
  const source = SOURCE_VALUES.has(value.source as InformationSource)
    ? (value.source as InformationSource)
    : 'agent_inference'
  const confirmationStatus = CONFIRMATION_VALUES.has(value.confirmationStatus as ConfirmationStatus)
    ? (value.confirmationStatus as ConfirmationStatus)
    : source === 'user' ? 'confirmed' : 'unconfirmed'
  return {
    key: value.key,
    label: value.label,
    value: value.value,
    source,
    confidence: clampConfidence(value.confidence),
    confirmationStatus,
    ...(typeof value.evidence === 'string' ? { evidence: value.evidence } : {}),
  }
}

function normalizeConflicts(
  raw: unknown,
  current: DesignBrief['conflicts'],
): DesignBrief['conflicts'] {
  const map = new Map(current.map(conflict => [conflict.key, conflict]))
  if (!Array.isArray(raw)) return [...map.values()]
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const value = item as Record<string, unknown>
    if (
      typeof value.key === 'string' &&
      typeof value.existingValue === 'string' &&
      typeof value.requestedValue === 'string' &&
      typeof value.question === 'string'
    ) {
      map.set(value.key, {
        key: value.key,
        existingValue: value.existingValue,
        requestedValue: value.requestedValue,
        question: value.question,
      })
    }
  }
  return [...map.values()]
}

export function evaluateBrief(
  brief: DesignBrief,
  inputType: 'text' | 'image',
  config: Pick<AppConfig, 'usableConfidence' | 'partialConfidence'>,
  lang: Lang = 'zh',
): Evaluation {
  const allFacts = [
    ...brief.existingCondition,
    ...brief.designGoals,
    ...brief.hardConstraints,
    ...brief.assumptions,
  ]
  const keys = new Set(allFacts.map(fact => fact.key.toLowerCase()))
  // Key fragments alone are brittle — the extraction model's key wording
  // drifts (especially at temperature 1). A numeric area/dimension signal in
  // any fact's label/value is just as much geometry as an 'area' key.
  const GEOMETRY_VALUE_PATTERN =
    /(\d+(\.\d+)?\s*(平米|㎡|平方米|m2|m²|sqm|帖|坪))|(\d+(\.\d+)?\s*[x×*]\s*\d+(\.\d+)?\s*(米|m\b))|面积|边界|間口|奥行/i
  const hasGeometry = hasAnyKey(keys, ['area', 'size', 'dimension', 'boundary', 'width', 'depth', 'floor', 'space', '面积'])
    || allFacts.some(fact => GEOMETRY_VALUE_PATTERN.test(`${fact.label} ${formatValue(fact.value)}`))
  // 覆盖常见房型写法："两室一厅"、"2卧1卫1厨"、"3LDK"、"two-bed"——
  // 抽取模型对 key/label 的措辞不稳定（尤其 temperature=1 下），漏判会把
  // 信息完整的请求误送进澄清循环。value 也纳入匹配（房型常在值里）。
  const functionPattern = /(room|bed|living|kitchen|bath|dining|study|ldk|space|function|layout|program|房|室|厅|卧|卫|厨|居|功能|户型)/i
  const hasFunction = brief.designGoals.some(fact =>
    functionPattern.test(`${fact.key} ${fact.label} ${formatValue(fact.value)}`),
  )
  const confidenceFacts = allFacts.filter(fact => fact.source !== 'default_assumption')
  const averageConfidence = confidenceFacts.length > 0
    ? confidenceFacts.reduce((sum, fact) => sum + fact.confidence, 0) / confidenceFacts.length
    : 0
  const reasons: string[] = []
  const questions: string[] = []

  if (!hasGeometry) {
    reasons.push('缺少面积或边界尺寸')
    questions.push(t(lang, 'askFloorArea', {}))
  }
  if (!hasFunction) {
    reasons.push('缺少必要功能空间')
    questions.push(t(lang, 'askRequiredRooms', {}))
  }
  if (brief.conflicts.length > 0) {
    reasons.push('现状与设计目标存在尚未解决的冲突')
    questions.push(...brief.conflicts.map(conflict => conflict.question))
  }
  questions.push(...brief.uncertainties.map(fact =>
    t(lang, 'askConfirmFact', { label: fact.label, value: formatValue(fact.value) })))

  if (inputType === 'image' && averageConfidence < config.partialConfidence && !hasGeometry) {
    return {
      availability: 'unusable',
      reasons: ['图片无法可靠识别主边界、比例或有效户型内容', ...reasons],
      questions: dedupe(questions),
    }
  }
  if (reasons.length > 0 || averageConfidence < config.usableConfidence) {
    return { availability: 'partially_usable', reasons, questions: dedupe(questions) }
  }
  return { availability: 'usable', reasons: [], questions: [] }
}

/**
 * User-facing brief summary in plain language — no confidence numbers or
 * source labels (those read like debug output to a non-expert homeowner).
 * Assumptions and uncertainties are surfaced explicitly as "will be treated
 * as defaults unless you correct them", so confirming is informed consent
 * rather than a silent acceptance of everything the system inferred.
 */
export function formatUserFacingSummary(brief: DesignBrief, lang: Lang = 'zh'): string {
  // Fact labels/values come from extraction in the user's own language; only
  // the frame text is templated.
  const list = (facts: RequirementFact[]) =>
    facts.map(fact => `${fact.label}：${formatValue(fact.value)}`).join('；')
  const lines: string[] = [t(lang, 'summaryIntro', {})]
  if (brief.existingCondition.length > 0) lines.push(t(lang, 'summaryExisting', { list: list(brief.existingCondition) }))
  if (brief.designGoals.length > 0) lines.push(t(lang, 'summaryGoals', { list: list(brief.designGoals) }))
  if (brief.hardConstraints.length > 0) lines.push(t(lang, 'summaryConstraints', { list: list(brief.hardConstraints) }))
  const unconfirmed = [...brief.assumptions, ...brief.uncertainties]
  if (unconfirmed.length > 0) {
    lines.push(t(lang, 'summaryAssumptions', {}))
    for (const fact of unconfirmed) lines.push(`  - ${fact.label}：${formatValue(fact.value)}`)
  }
  for (const conflict of brief.conflicts) {
    lines.push(t(lang, 'summaryConflict', { question: conflict.question }))
  }
  if (lines.length === 1) {
    lines.push(t(lang, 'summaryEmpty', {}))
  }
  return lines.join('\n')
}

export function formatSummary(brief: DesignBrief): string {
  const section = (title: string, facts: RequirementFact[]) => {
    if (facts.length === 0) return `${title}\n- 无`
    return `${title}\n${facts.map(fact =>
      `- ${fact.label}：${formatValue(fact.value)}（${sourceLabel(fact.source)}，置信度 ${fact.confidence.toFixed(2)}）`,
    ).join('\n')}`
  }
  return [
    '结构化需求摘要',
    section('现状基础', brief.existingCondition),
    section('设计目标', brief.designGoals),
    section('硬性约束', brief.hardConstraints),
    section('系统假设', brief.assumptions),
    section('不确定项', brief.uncertainties),
  ].join('\n\n')
}

// Plan-validator targets from the confirmed brief. Bedroom count comes from
// the numeric fact and is reliable. Kitchen/bathroom/living presence comes
// from the fuzzy requested-rooms list, and the validator compares counts
// EXACTLY — so a type is only included when every matching entry plausibly
// names a single room; an entry that embeds its own quantity ("两个卫生间")
// would make entry-counting wrong in both directions, so that type is left
// to the post-build checks instead.
export function buildPlanTargets(brief: DesignBrief): PlanTargets {
  const totalAreaSqm = numberFact(brief, FLOOR_AREA_FACT_KEYS)
  const requiredRooms: Array<{ type: RoomType; count: number }> = []
  const bedrooms = numberFact(brief, ['bedroom_count', 'bedrooms'])
  if (bedrooms !== undefined && bedrooms > 0) {
    requiredRooms.push({ type: 'bedroom', count: bedrooms })
  }
  const requested = arrayFact(brief, ['rooms', 'required_rooms', 'function_spaces'])
  const presencePatterns: Array<[RoomType, RegExp]> = [
    ['kitchen', ROOM_NAME_PATTERNS.kitchen],
    ['bathroom', ROOM_NAME_PATTERNS.bathroom],
    ['living', ROOM_NAME_PATTERNS.living],
  ]
  const embedsQuantity = /[0-9０-９两三四五六七八九]/
  for (const [type, pattern] of presencePatterns) {
    const matches = requested.filter(room => pattern.test(room))
    if (matches.length > 0 && !matches.some(room => embedsQuantity.test(room))) {
      requiredRooms.push({ type, count: matches.length })
    }
  }
  return {
    ...(totalAreaSqm !== undefined && totalAreaSqm > 0 ? { totalAreaSqm } : {}),
    ...(requiredRooms.length > 0 ? { requiredRooms } : {}),
  }
}

// Room types the brief EXPLICITLY requests exterior windows for (gate 4 only
// covers explicit requests; default lighting preferences live in the plan).
// Scans every fact whose key/label/value mentions windows and maps the room
// words found alongside.
export function windowRoomTypesFromBrief(brief: DesignBrief): RoomType[] {
  const roomTypes: RoomType[] = ['bedroom', 'living', 'study', 'kitchen', 'dining', 'bathroom']
  const types = new Set<RoomType>()
  for (const fact of [
    ...brief.designGoals, ...brief.hardConstraints, ...brief.existingCondition, ...brief.assumptions,
  ]) {
    const text = `${fact.key} ${fact.label} ${formatValue(fact.value)}`
    if (!WINDOW_PATTERN.test(text)) continue
    for (const type of roomTypes) {
      if (roomNamePattern(type)?.test(text)) types.add(type)
    }
  }
  return [...types]
}

// Structural node types the repair rounds must never touch (§5: 修复 prompt
// 禁改房间结构，本函数是其确定性兜底). Doors/windows/items are legitimately
// repairable and deliberately absent.
const STRUCTURE_NODE_TYPES = new Set(['wall', 'zone', 'slab', 'ceiling'])

// Geometry drift of structural nodes between two scene snapshots: additions,
// deletions, and moved/resized walls or room polygons. Same 1mm epsilon as
// checkModificationProtection.
export function structuralDrift(before: SceneNodeSnapshot, after: SceneNodeSnapshot): string[] {
  const drift: string[] = []
  const structural = (snapshot: SceneNodeSnapshot) =>
    Object.entries(snapshot).filter(([, node]) => STRUCTURE_NODE_TYPES.has(String(node.type)))
  const beforeMap = new Map(structural(before))
  const afterMap = new Map(structural(after))
  for (const [id, node] of beforeMap) {
    if (!afterMap.has(id)) drift.push(`结构节点被删除：${String(node.type)} ${id}`)
  }
  for (const [id, node] of afterMap) {
    if (!beforeMap.has(id)) drift.push(`新增了结构节点：${String(node.type)} ${id}`)
  }
  const geomEqual = (a: unknown, b: unknown): boolean => {
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= GEOM_FIELD_EPS
    if (Array.isArray(a) && Array.isArray(b)) {
      return a.length === b.length && a.every((value, i) => geomEqual(value, b[i]))
    }
    return a === b
  }
  for (const [id, beforeNode] of beforeMap) {
    const afterNode = afterMap.get(id)
    if (!afterNode) continue
    for (const field of ['start', 'end', 'polygon', 'thickness', 'height'] as const) {
      if (field in beforeNode || field in afterNode) {
        if (!geomEqual(beforeNode[field], afterNode[field])) {
          drift.push(`结构节点 ${String(beforeNode.type)} ${id} 的 ${field} 被修改`)
          break
        }
      }
    }
  }
  return drift
}

// Compact plan facts for the furnishing / repair prompts: the room list is
// settled and the model must treat it as read-only ground truth.
export function formatPlanSnapshot(plan: LayoutPlan): string {
  const nameById = new Map(plan.rooms.map(room => [room.id, room.name]))
  const rooms = plan.rooms.map(room => {
    const entry = room.id === plan.entry.roomId ? '，入户' : ''
    return `- ${room.name}（${room.type}，约 ${round1(polygonArea(room.polygon))}㎡${entry}）`
  }).join('\n')
  const doors = plan.connections
    .map(conn => `${nameById.get(conn.from) ?? conn.from}↔${nameById.get(conn.to) ?? conn.to}`)
    .join('、')
  return `既定房间计划（只读事实，不可改动）：\n${rooms}\n房间连通（均已开门）：${doors || '无'}`
}

function buildGenerationArgs(session: WorkflowSession): Record<string, unknown> {
  const bedrooms = numberFact(session.brief, ['bedroom_count', 'bedrooms'])
  const rooms = arrayFact(session.brief, ['rooms', 'required_rooms', 'function_spaces'])
  const widthM = numberFact(session.brief, ['width_m', 'room_width_m', 'width'])
  const depthM = numberFact(session.brief, [
    'depth_m',
    'length_m',
    'room_depth_m',
    'room_length_m',
    'depth',
    'length',
  ])
  const floorAreaM2 = numberFact(session.brief, [
    'floor_area_sqm',
    'area_sqm',
    'room_area_sqm',
    'area',
  ])
  const style = stringFact(session.brief, ['style', 'design_style'])
  const constraints = session.brief.hardConstraints
    .map(fact => `${fact.label}: ${formatValue(fact.value)}`)
    .join('; ')
  return {
    brief: session.summary || formatSummary(session.brief),
    ...(session.sceneId ? { projectId: session.sceneId } : {}),
    projectName: 'Pascal AI 户型方案',
    ...(bedrooms !== undefined ? { bedroomCount: bedrooms } : {}),
    ...(rooms.length > 0 ? { rooms } : {}),
    ...(widthM !== undefined ? { widthM } : {}),
    ...(depthM !== undefined ? { depthM } : {}),
    ...(floorAreaM2 !== undefined ? { floorAreaM2 } : {}),
    ...(style ? { style } : {}),
    ...(constraints ? { constraints } : {}),
  }
}

function confirmBrief(brief: DesignBrief): DesignBrief {
  const confirm = (facts: RequirementFact[]) => facts.map(fact => ({
    ...fact,
    confirmationStatus: 'confirmed' as const,
  }))
  return {
    ...brief,
    existingCondition: confirm(brief.existingCondition),
    designGoals: confirm(brief.designGoals),
    hardConstraints: confirm(brief.hardConstraints),
    assumptions: confirm(brief.assumptions),
    uncertainties: [],
    conflicts: [],
  }
}

// place_item's `rotation` parameter is interpreted as radians by the scene
// renderer (Three.js convention), but nothing in the tool's schema or
// description tells the model that — so it reliably supplies degree-shaped
// values instead (0, 90, 180, 270), which then get applied as radians and
// spin the item into an almost-arbitrary orientation. We can't add a unit
// hint to the MCP tool itself (out of scope here), so we correct it at the
// boundary instead: a genuine single-axis radian value for a sane rotation
// is always within one full turn (±2π); anything larger than that is
// unambiguously a degree value that slipped through, so we reinterpret it
// as degrees and convert before forwarding the call to MCP.
const RADIAN_SANITY_BOUND = Math.PI * 2 + 0.01

function normalizeToolArgs(
  toolName: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (toolName !== 'place_item') return args
  const rotation = args.rotation
  if (typeof rotation !== 'number' || !Number.isFinite(rotation)) return args
  if (Math.abs(rotation) <= RADIAN_SANITY_BOUND) return args
  return { ...args, rotation: (rotation * Math.PI) / 180 }
}

function parseToolArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {}
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  return parsed as Record<string, unknown>
}

function isSupportedImage(dataUrl: string): boolean {
  const match = dataUrl.match(/^data:image\/(png|jpe?g);base64,([a-z0-9+/=]+)$/i)
  if (!match) return false
  return (match[2]?.length ?? Number.POSITIVE_INFINITY) <= 28 * 1024 * 1024
}

function isFactValue(value: unknown): value is RequirementFact['value'] {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    (Array.isArray(value) && value.every(item => typeof item === 'string'))
  )
}

function clampConfidence(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, Math.round(value * 100) / 100))
    : 0.5
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))]
}

function hasAnyKey(keys: Set<string>, fragments: string[]): boolean {
  return [...keys].some(key => fragments.some(fragment => key.includes(fragment)))
}

function formatValue(value: RequirementFact['value']): string {
  return Array.isArray(value) ? value.join('、') : String(value)
}

function sourceLabel(source: InformationSource): string {
  return {
    user: '用户提供',
    system_recognition: '系统识别',
    agent_inference: 'Agent 推断',
    default_assumption: '默认假设',
    pending_confirmation: '待确认',
  }[source]
}

function facts(brief: DesignBrief): RequirementFact[] {
  return [...brief.existingCondition, ...brief.designGoals, ...brief.hardConstraints, ...brief.assumptions]
}

function findFact(brief: DesignBrief, keys: string[]): RequirementFact | undefined {
  return facts(brief).find(fact => keys.includes(fact.key.toLowerCase()))
}

function numberFact(brief: DesignBrief, keys: string[]): number | undefined {
  const value = findFact(brief, keys)?.value
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function arrayFact(brief: DesignBrief, keys: string[]): string[] {
  const value = findFact(brief, keys)?.value
  if (Array.isArray(value)) return value
  return typeof value === 'string' ? value.split(/[,，、]/).map(item => item.trim()).filter(Boolean) : []
}

function stringFact(brief: DesignBrief, keys: string[]): string | undefined {
  const value = findFact(brief, keys)?.value
  return typeof value === 'string' ? value : undefined
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function publicEditorUrl(sceneId: string | null): string | null {
  return sceneId ? `/scene/${encodeURIComponent(sceneId)}` : null
}

// `count` is the number of *content* nodes (scaffolding excluded, see
// `countActiveContentNodes`). Any real content at all means the scene is the
// user's existing work and must be modified incrementally rather than cleared
// and rebuilt.
export function shouldModifyExistingScene(count: number): boolean {
  return count > 0
}

function isSceneIntent(value: unknown): value is SceneIntent {
  return value === 'query' || value === 'create' || value === 'update' ||
    value === 'delete' || value === 'ambiguous'
}

function isCollision(value: unknown): value is { aId: string; bId: string; kind: string } {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.aId === 'string' && typeof record.bId === 'string' && typeof record.kind === 'string'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
