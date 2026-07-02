import { END, MemorySaver, START, StateGraph } from '@langchain/langgraph'
import type { AppConfig } from './config'
import { PascalMcpClient } from './mcp'
import { OpenAiCompatibleClient } from './openai-compatible'
import { SessionStore } from './session-store'
import type {
  Availability,
  ChatInput,
  ChatMessage,
  ChatResult,
  ConfirmationStatus,
  DesignBrief,
  InformationSource,
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

export type SceneIntent = 'query' | 'create' | 'update' | 'delete' | 'ambiguous'

export class PascalAiAgent {
  private readonly model?: OpenAiCompatibleClient
  private readonly fallbackModel?: OpenAiCompatibleClient
  private readonly fastModel?: OpenAiCompatibleClient
  private readonly sessions: SessionStore
  private readonly graph: ReturnType<typeof createWorkflowGraph>
  private readonly sessionLocks = new Map<string, Promise<ChatResult>>()
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

    const result = await this.graph.invoke(
      { input, session, reply: '', next: 'evaluate' },
      { configurable: { thread_id: input.sessionId } },
    )
    result.session.updatedAt = new Date().toISOString()
    this.sessions.set(input.sessionId, result.session)
    return { sessionId: input.sessionId, reply: result.reply, session: result.session }
  }

  private async ingest(state: WorkflowGraphState): Promise<Partial<WorkflowGraphState>> {
    const { input } = state
    const session = structuredClone(state.session)

    if (input.action === 'cancel') {
      session.phase = 'cancelled'
      session.questions = []
      return {
        session,
        reply: '已取消当前户型设计任务。现有场景没有被修改。',
        next: 'finish',
      }
    }

    if (input.action === 'confirm') {
      if (session.phase === 'awaiting_modification_confirmation' && session.pendingModification) {
        session.phase = 'modifying'
        return { session, reply: '修改已确认，正在更新当前户型。', next: 'modify' }
      }
      if (session.phase !== 'awaiting_confirmation') {
        return {
          session,
          reply: '当前需求还没有达到可确认状态，请先补充关键条件。',
          next: 'finish',
        }
      }
      session.confirmedAt = new Date().toISOString()
      session.phase = 'generating'
      session.brief = confirmBrief(session.brief)
      return { session, reply: '需求已确认，正在生成户型。', next: 'generate' }
    }

    const message = input.message?.trim() ?? ''
    if (!message && !input.imageDataUrl) {
      return {
        session,
        reply: '请输入户型需求，或上传一张户型图。',
        next: 'finish',
      }
    }
    // A prior modification attempt failed and left `phase` here so a plain
    // {action:'confirm'} can retry the *same* pending request (see
    // `modify()`'s catch block). But the failure reply also tells the user
    // they can just describe a new change instead — without this branch,
    // that new message would fall through to the generic requirement-
    // extraction path below (treating it as if it were building up a brand
    // new brief from scratch) rather than being routed as a fresh
    // modification instruction against the scene that's actually still
    // there. Clear the stale pending fields first; `routeExistingSceneRequest`
    // classifies this message's intent and sets fresh ones.
    if (shouldRouteAsExistingSceneRequest(session.phase, message)) {
      delete session.pendingModification
      delete session.pendingOperation
      return this.routeExistingSceneRequest(session, message)
    }
    if (isCompletedPhase(session.phase)) {
      if (!message) {
        return {
          session,
          reply: '户型已经生成。请用文字描述需要修改的内容。',
          next: 'finish',
        }
      }
      return this.routeExistingSceneRequest(session, message)
    }
    if (message.length > 5000) {
      return {
        session,
        reply: '文字需求不能超过 5000 个字符，请精简后重新提交。',
        next: 'finish',
      }
    }
    if (input.imageDataUrl && !isSupportedImage(input.imageDataUrl)) {
      session.phase = 'failed'
      session.availability = 'unusable'
      return {
        session,
        reply: '当前仅支持单张 JPG、JPEG 或 PNG 户型图，且图片必须小于 20 MB。',
        next: 'finish',
      }
    }

    if (session.phase === 'intake' && session.sceneId && message) {
      try {
        const loaded = toolPayload(await this.mcp.callTool('load_scene', { id: session.sceneId }))
        const nodeCount = nullableNumber(loaded.nodeCount) ?? 0
        if (shouldModifyExistingScene(nodeCount)) {
          return this.routeExistingSceneRequest(session, message)
        }
      } catch (error) {
        return {
          session,
          reply: `无法加载场景 ${session.sceneId}：${errorMessage(error)}。请刷新页面重新打开项目，或稍后重试。`,
          next: 'finish',
        }
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
      return {
        session,
        reply: `需求解析失败：${errorMessage(error)}。你可以重试，已输入的文字仍保留在当前会话中。`,
        next: 'finish',
      }
    }
  }

  private async inspect(state: WorkflowGraphState): Promise<Partial<WorkflowGraphState>> {
    const session = structuredClone(state.session)
    const question = state.input.message?.trim() ?? ''
    const sceneId = session.sceneResult?.sceneId ?? session.sceneId
    if (!sceneId) {
      session.phase = 'failed'
      return { session, reply: '找不到需要核对的场景。', next: 'finish' }
    }
    try {
      await this.mcp.callTool('load_scene', { id: sceneId })
      const reply = await this.answerSceneQuestion(session, question)
      session.phase = session.sceneResult?.remainingIssueCount
        ? 'completed_with_issues'
        : 'completed'
      session.messages.push({ role: 'assistant', content: reply })
      return { session, reply, next: 'finish' }
    } catch (error) {
      session.phase = 'completed_with_issues'
      const reply = `场景核对失败：${errorMessage(error)}。当前场景没有被修改。`
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
      return { session, reply: '正在核对当前户型。', next: 'inspect' }
    }
    if (intent === 'ambiguous') {
      session.phase = session.sceneResult?.remainingIssueCount
        ? 'completed_with_issues'
        : 'completed'
      const reply = '我还不能确定你是想查询当前户型，还是要新增、修改或删除内容。请明确说明操作和对象，例如“查看这面墙多长”或“删除客厅东侧的窗户”。'
      session.messages.push({ role: 'assistant', content: reply })
      return { session, reply, next: 'finish' }
    }

    session.pendingModification = message
    session.pendingOperation = intent
    session.phase = 'awaiting_modification_confirmation'
    const labels = { create: '新增', update: '修改', delete: '删除' } as const
    const warning = intent === 'delete'
      ? '\n\n这是删除操作，确认后目标节点及其关联内容可能被移除。'
      : ''
    const reply = `准备${labels[intent]}当前户型：${message}${warning}\n\n请确认后再执行，确认前不会更改场景。`
    session.messages.push({ role: 'assistant', content: reply })
    return { session, reply, next: 'finish' }
  }

  private async classifySceneIntent(session: WorkflowSession, message: string): Promise<SceneIntent> {
    try {
      // Exclude the last entry: it's `message` itself, already pushed to
      // session.messages by the caller before this runs.
      const history = recentConversationText(session.messages.slice(0, -1))
      const result = await this.withFastModel(model =>
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
    const evaluation = evaluateBrief(session.brief, session.inputType, this.config)
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
        : ['请补充户型面积或边界尺寸，以及必须包含的功能空间。']
      const reply = reachedLimit
        ? [
            '目前仍有关键条件未确认。你可以明确接受系统采用合理默认假设，或取消任务。',
            ...questions.map((question, index) => `${index + 1}. ${question}`),
          ].join('\n')
        : [
            '我已经保留了可用信息，还需要确认以下关键条件：',
            ...questions.map((question, index) => `${index + 1}. ${question}`),
          ].join('\n')
      session.messages.push({ role: 'assistant', content: reply })
      return { session, reply, next: 'finish' }
    }

    session.phase = 'awaiting_confirmation'
    session.summary = formatSummary(session.brief)
    const reply = `${session.summary}\n\n请确认以上需求。确认后才会生成并修改 Pascal 场景。`
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
      const generationArgs = buildGenerationArgs(session)
      if (session.sceneId) {
        const loaded = toolPayload(await this.mcp.callTool('load_scene', { id: session.sceneId }))
        const nodeCount = nullableNumber(loaded.nodeCount) ?? 0
        if (shouldModifyExistingScene(nodeCount)) {
          return await this.applyConfirmedBriefToExistingScene(session, loaded)
        }
        const expectedVersion = nullableNumber(loaded.version)
        if (expectedVersion !== null) generationArgs.expectedVersion = expectedVersion
      }
      const created = toolPayload(
        await this.mcp.callTool('create_house_from_brief', generationArgs),
      )
      session.sceneId = nullableString(created.projectId ?? created.sceneId ?? created.id) ?? undefined
      const levelId = nullableString(created.defaultLevelId)
      await this.clearLevelForRebuild(session, levelId)
      const { diagnostics, repairRounds, toolNamesUsed, furnitureIssues } =
        await this.constructSceneInPhases(session, levelId)
      const sceneVersion = await this.persistScene(
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
        repairRounds,
        remainingIssueCount: countDiagnosticIssues(diagnostics),
      }
      session.sceneResult = sceneResult
      const remaining = sceneResult.remainingIssueCount
      session.phase = remaining === 0 ? 'completed' : 'completed_with_issues'
      const reply = (remaining === 0
        ? `户型已生成并通过自动检查。${sceneResult.editorUrl ? `\n打开场景：${sceneResult.editorUrl}` : ''}`
        : `户型已生成，自动修正已达上限（${repairRounds} 轮），仍有 ${remaining} 个问题需要人工确认：${describeRemainingIssues(diagnostics)}`
      ) + furnitureCaveat(toolNamesUsed, furnitureIssues)
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
      session.phase = 'failed'
      const reply = `户型生成失败：${errorMessage(error)}。已确认的结构化需求仍然保留，可以稍后重试。`
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
      sceneId,
      diagnostics.validation.valid,
      nullableNumber(loaded.version),
    )
    const remainingIssueCount = countDiagnosticIssues(diagnostics)
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
      repairRounds,
      remainingIssueCount,
    }
    session.phase = remainingIssueCount === 0 ? 'completed' : 'completed_with_issues'
    const reply = (remainingIssueCount === 0
      ? '已在现有户型基础上完成修改，并通过自动检查。'
      : `已在现有户型基础上完成修改，自动修正已达上限（${repairRounds} 轮），仍有 ${remainingIssueCount} 个问题需要人工确认：${describeRemainingIssues(diagnostics)}`
    ) + furnitureCaveat(toolNamesUsed, furnitureIssues)
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
        reply: '找不到需要修改的场景，请重新生成户型。',
        next: 'finish',
      }
    }

    try {
      const loaded = toolPayload(await this.mcp.callTool('load_scene', { id: sceneId }))
      const { diagnostics, repairRounds, toolNamesUsed, furnitureIssues } = await this.refineAndDiagnose(
        session,
        `用户已确认对当前场景执行${operation}操作：${feedback}`,
        { phaseLabel: '按用户要求修改场景' },
      )
      const sceneVersion = await this.persistScene(
        sceneId,
        diagnostics.validation.valid,
        nullableNumber(loaded.version),
      )
      const remainingIssueCount = countDiagnosticIssues(diagnostics)
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
        repairRounds,
        remainingIssueCount,
      }
      session.phase = remainingIssueCount === 0 ? 'completed' : 'completed_with_issues'
      delete session.pendingModification
      delete session.pendingOperation
      const reply = (remainingIssueCount === 0
        ? '已按你的要求修改当前户型，并通过自动检查。'
        : `已完成修改，自动修正已达上限（${repairRounds} 轮），仍有 ${remainingIssueCount} 个问题需要人工确认：${describeRemainingIssues(diagnostics)}`
      ) + furnitureCaveat(toolNamesUsed, furnitureIssues)
      session.messages.push({ role: 'assistant', content: reply })
      return { session, reply, next: 'finish' }
    } catch (error) {
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
        ? `场景修改失败：${errorMessage(error)}。原场景和修改要求都已保留，发送确认即可重试同一操作，或直接描述新的修改需求。`
        : `场景修改失败：${errorMessage(error)}。原场景已保留，可以重新描述需要的修改。`
      session.messages.push({ role: 'assistant', content: reply })
      return { session, reply, next: 'finish' }
    }
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
          'Inspect the active Pascal scene and answer the user accurately. Use read-only tools when needed. Never mutate the scene. State what you verified, identify relevant node ids when useful, and distinguish measured facts from uncertainty. Use the recent conversation to resolve references like "that wall" or "the one I mentioned".',
      },
      { role: 'user', content: `${history}${question}` },
    ]
    for (let round = 0; round < this.config.maxToolRounds; round++) {
      const completion = await this.withModelFallback(model =>
        model.chat(messages, tools, `${session.sessionId}:inspect`),
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
        messages.push(await this.executeToolCall(toolCall))
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
questions 每次最多 3 个，只问会改变空间结构的问题。
已有需求：${JSON.stringify(session.brief)}
最新文字：${message || '无附带文字'}
输入类型：${imageDataUrl ? '单张户型图；图片是现状依据，文字是目标或指令' : '纯文字需求'}`

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
        return await this.withModelFallback(model =>
          model.json<ExtractionResponse>(
            [
              { role: 'system', content: 'Extract architectural requirements into valid JSON only.' },
              { role: 'user', content },
            ],
            `${session.sessionId}:extract:${attempt}`,
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
      const completion = await this.withModelFallback(model =>
        model.chat(messages, tools, `${session.sessionId}:scene`),
      )
      const assistant = completion.choices[0]?.message
      if (!assistant) throw new Error('Model API returned no assistant message')
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
        messages.push(await this.executeToolCall(toolCall, furnitureIssues))
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
    let result = await this.runSceneAgent(session, purpose, conversation, toolNamesUsed, furnitureIssues)
    let attempt = 0
    while (!result.converged && attempt < PascalAiAgent.PHASE_CONTINUATION_ATTEMPTS) {
      attempt++
      result = await this.runSceneAgent(
        session,
        `${purpose}\n上一轮已经达到工具调用轮次上限，任务还没有做完。请先用 get_zones/get_walls/get_level_summary 检查当前场景的真实状态，只继续完成尚未做完的部分，不要重复已经做好的操作。`,
        result.messages,
        result.toolNamesUsed,
        result.furnitureIssues,
      )
    }
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
  private async clearLevelForRebuild(session: WorkflowSession, levelId: string | null): Promise<void> {
    if (!levelId) throw new Error('Target level is missing')
    try {
      const scene = toolPayload(await this.mcp.callTool('get_scene', {}))
      const nodes = isRecord(scene.nodes) ? scene.nodes : {}
      const level = nodes[levelId]
      if (!isRecord(level) || !Array.isArray(level.children)) {
        throw new Error(`Target level ${levelId} is unavailable`)
      }
      for (const childId of level.children) {
        if (typeof childId === 'string') {
          await this.mcp.callTool('delete_node', { id: childId, cascade: true })
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
   */
  private async dedupeSharedWalls(levelId: string | null): Promise<void> {
    if (!levelId) return
    try {
      const payload = toolPayload(await this.mcp.callTool('get_walls', { levelId }))
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
            const oa = segmentOrientation(a)!
            const ob = segmentOrientation(b)!
            const lenA = oa.hi - oa.lo
            const lenB = ob.hi - ob.lo
            const overlapLen = overlap.hi - overlap.lo
            const aFullyCovered = overlapLen >= lenA - MIN_MEANINGFUL_OVERLAP_M
            const bFullyCovered = overlapLen >= lenB - MIN_MEANINGFUL_OVERLAP_M

            if (aFullyCovered && bFullyCovered) {
              // Exact duplicate within tolerance — keep a, drop b entirely.
              if (!b.isFragment) deletedRealIds.add(b.id)
              working.splice(j, 1)
              changed = true
              break resolvePass
            }

            // Keep the shorter (more specific) wall untouched; clip the
            // longer one down to whatever remains outside the overlap.
            const keepIsA = lenA <= lenB
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
        await this.mcp.callTool('apply_patch', { patches })
      }
    } catch {
      // Best-effort cleanup — see doc comment above.
    }
  }

  private async constructSceneInPhases(
    session: WorkflowSession,
    levelId: string | null,
  ): Promise<{
    diagnostics: Awaited<ReturnType<PascalAiAgent['collectDiagnostics']>>
    repairRounds: number
    toolNamesUsed: Set<string>
    furnitureIssues: string[]
  }> {
    session.executionSteps ??= []
    let conversation: ChatMessage[] | undefined
    let toolNamesUsed = new Set<string>()
    let furnitureIssues: string[] = []
    try {
      const structure = await this.runPhaseToConvergence(
        session,
        '结构阶段：根据已确认需求确定整体地基尺寸和房间清单。在建任何房间之前，先在脑内规划一遍房间之间的连接关系：客厅、玄关、走廊这类空间承担公共动线枢纽的角色，每个卧室都必须能只经过公共动线到达，不能要求先穿过卫生间、厨房或另一个卧室才能到达；卫生间和厨房不能被当成通往其他房间的必经之路。按这个连接关系决定每个房间的位置——需要走公共动线到达的房间应该直接紧挨着客厅/玄关/走廊，而不是紧挨着卫生间或厨房。\n\n不要调用 create_story_shell——直接逐个创建房间覆盖整个地基，包括贴着地基外边界的房间也是直接 create_room，它自己的外侧边就是外墙，不需要预先建一个外壳。每次新建房间前先用 get_zones 查看当前楼层已经建好哪些区域、还剩多少未占用空间，再调用 create_room 划定下一个房间的边界，一间一间来，不要提前一次性算好全部房间坐标。每个房间的宽度要与其功能匹配（卧室、厨房、卫生间、客厅等实际使用空间不宜窄于约 1.8 米；走廊、玄关等纯通行空间可以更窄），长宽比不宜超过约 3:1，不要出现宽度勉强达标但过长的畸形长条房间。不要为了填满地基而制造过窄或没有实际用途的房间——地基里如果剩下无法容纳合理房间的小块空间，就并入相邻房间，不要单独建一个房间去装它。全部房间建完后用 get_level_summary 核对一遍再结束这一阶段。',
        undefined,
        new Set<string>(),
        [],
        '结构建造阶段',
      )
      conversation = structure.messages
      toolNamesUsed = structure.toolNamesUsed
      furnitureIssues = structure.furnitureIssues
      // `create_room` builds one wall per polygon edge every time, with no
      // awareness of neighboring rooms, so two rooms sharing a boundary end
      // up with two coincident wall nodes there. MCP itself has no
      // wall-merge tool for this (its own hand-authored templates avoid the
      // problem by hand-building one shared wall per boundary instead of
      // calling create_room per room), so we deduplicate deterministically
      // here rather than asking the model to eyeball coordinate matches.
      await this.dedupeSharedWalls(levelId)
      session.executionSteps.push({ phase: 'structure', status: 'completed', label: '逐间建造房间结构' })
    } catch (error) {
      session.executionSteps.push({ phase: 'structure', status: 'failed', label: '结构建造阶段' })
      throw error
    }
    try {
      const opening = await this.runPhaseToConvergence(
        session,
        '完成阶段：先用 get_walls/get_zones 核对已建好的房间，根据已确认需求用 add_door/add_window 完成连通和采光。加窗前先确认这面墙是否贴着整栋建筑的外边界——窗户只能开在朝外的墙上，不能开在两个房间之间的室内隔墙上。加门时留意开启方向（swingDirection/hingesSide）会不会跟房间里已有的家具、或旁边另一扇门的开启范围互相冲突，选一个不会挡住通行或家具的方向。然后按每个房间的功能使用 search_assets 与 place_item，或 furnish_room 布置家具。保留通行空间，不得改变已建好的房间边界和硬性尺寸。',
        conversation,
        toolNamesUsed,
        furnitureIssues,
        '门窗与家具阶段',
      )
      conversation = opening.messages
      toolNamesUsed = opening.toolNamesUsed
      furnitureIssues = opening.furnitureIssues
      session.executionSteps.push({ phase: 'openings', status: 'completed', label: '添加门窗与连通' })
      session.executionSteps.push({ phase: 'furnishing', status: 'completed', label: '搜索并布置家具' })
    } catch (error) {
      session.executionSteps.push({ phase: 'openings', status: 'failed', label: '门窗与家具阶段' })
      throw error
    }
    // Verification and any repair rounds continue the same conversation, so
    // the model remembers what it already placed instead of re-discovering
    // the scene from scratch on every repair attempt.
    const result = await this.refineAndDiagnose(
      session,
      '验证阶段：核对房间数量、硬性尺寸、门窗宿主、家具碰撞和通行性，只修复检查发现的问题。',
      { skipInitialAgent: true, conversation, toolNamesUsed, furnitureIssues },
    )
    session.executionSteps.push({
      phase: 'verification',
      status: 'completed',
      label: '验证并自动修正',
    })
    return result
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
    } = {},
  ): Promise<{
    diagnostics: Awaited<ReturnType<PascalAiAgent['collectDiagnostics']>>
    repairRounds: number
    toolNamesUsed: Set<string>
    furnitureIssues: string[]
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
    let diagnostics = await this.collectDiagnostics(session)
    diagnostics = await this.repairKnownOpeningBounds(diagnostics, session)
    let repairRounds = 0
    // Each repair round reuses the same conversation, so the model can see
    // what it already tried and why the previous round's fix didn't fully
    // resolve the diagnostics, instead of re-guessing from scratch.
    while (repairRounds < this.config.maxRepairRounds && countDiagnosticIssues(diagnostics) > 0) {
      repairRounds++
      const result = await this.runSceneAgent(
        session,
        `${purpose}\n自动修正第 ${repairRounds} 轮。必须先检查相关节点，再用工具修复以下具体问题；不要只解释，也不要推翻已确认需求：${JSON.stringify(diagnostics)}`,
        conversation,
        toolNamesUsed,
        furnitureIssues,
      )
      conversation = result.messages
      toolNamesUsed = result.toolNamesUsed
      furnitureIssues = result.furnitureIssues
      diagnostics = await this.collectDiagnostics(session)
      diagnostics = await this.repairKnownOpeningBounds(diagnostics, session)
    }
    return { diagnostics, repairRounds, toolNamesUsed, furnitureIssues }
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
      const node = toolPayload(await this.mcp.callTool('get_node', { id })).node
      if (!isRecord(node)) continue
      const wallId = typeof node.parentId === 'string'
        ? node.parentId
        : typeof node.wallId === 'string' ? node.wallId : undefined
      if (!wallId) continue
      const wall = toolPayload(await this.mcp.callTool('get_node', { id: wallId })).node
      if (!isRecord(wall)) continue
      const data = buildOpeningRepairData(node, wall)
      if (data) patches.push({ op: 'update', id, data })
    }
    if (patches.length === 0) return diagnostics
    await this.mcp.callTool('apply_patch', { patches })
    return this.collectDiagnostics(session)
  }

  private async persistScene(
    sceneId: string | undefined,
    valid: boolean,
    expectedVersion: number | null,
  ): Promise<number | null> {
    if (!valid || !sceneId) return expectedVersion
    const status = toolPayload(await this.mcp.callTool('get_project_status', { id: sceneId }))
    const currentVersion = nullableNumber(status.version) ?? expectedVersion
    const saved = toolPayload(await this.mcp.callTool('save_scene', {
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
    toolCall: ToolCall,
    furnitureIssues?: string[],
  ): Promise<ChatMessage> {
    try {
      let args = normalizeToolArgs(toolCall.function.name, parseToolArgs(toolCall.function.arguments))
      args = await this.correctFloorItemHeight(toolCall.function.name, args)
      const result = await this.mcp.callTool(toolCall.function.name, args)
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
      const target = toolPayload(await this.mcp.callTool('get_node', { id: targetNodeId })).node
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
  }> {
    const [validationRaw, verificationRaw, collisionsRaw, zonesRaw, wallsRaw] = await Promise.all([
      this.mcp.callTool('validate_scene', {}),
      this.mcp.callTool('verify_scene', {}),
      this.mcp.callTool('check_collisions', {}),
      this.mcp.callTool('get_zones', {}),
      this.mcp.callTool('get_walls', {}),
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
    return {
      validation: {
        valid: validationPayload.valid === true,
        errors: validationErrors,
      },
      verificationIssues,
      collisions,
      doorlessRooms: findDoorlessRooms(zones, walls),
      strayWindows: findStrayWindows(zones, walls),
      requirementMismatches: compareRoomsToRequirements(zones.map(z => z.name), session.brief),
      isolatedBedrooms: findIsolatedBedrooms(zones, walls),
    }
  }

  private async withModelFallback<T>(operation: (model: OpenAiCompatibleClient) => Promise<T>): Promise<T> {
    if (!this.model) {
      throw new Error('The configured AI provider API key is missing')
    }
    try {
      return await operation(this.model)
    } catch (primaryError) {
      if (!this.fallbackModel) throw primaryError
      return operation(this.fallbackModel)
    }
  }

  /**
   * Route low-stakes classification calls to the cheap/fast model when one is
   * configured. Falls back to the main model on error or when no fast model
   * is configured, so callers never lose reliability by using this.
   */
  private async withFastModel<T>(operation: (model: OpenAiCompatibleClient) => Promise<T>): Promise<T> {
    if (!this.fastModel) return this.withModelFallback(operation)
    try {
      return await operation(this.fastModel)
    } catch {
      return this.withModelFallback(operation)
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
    .compile({ checkpointer: new MemorySaver() })
}

function isCompletedPhase(phase: WorkflowSession['phase']): boolean {
  return phase === 'completed' || phase === 'completed_with_issues'
}

/**
 * Pure decision for `modify()`'s catch block: whether a failed modification
 * attempt should be left in a retryable state. Extracted so it's unit
 * testable without constructing a live `PascalAiAgent`.
 */
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

export function countDiagnosticIssues(diagnostics: {
  validation: { errors: string[] }
  verificationIssues: string[]
  collisions: unknown[]
  doorlessRooms: string[]
  strayWindows: string[]
  requirementMismatches: string[]
  isolatedBedrooms: string[]
}): number {
  return diagnostics.validation.errors.length +
    diagnostics.verificationIssues.length + diagnostics.collisions.length +
    diagnostics.doorlessRooms.length + diagnostics.strayWindows.length +
    diagnostics.requirementMismatches.length + diagnostics.isolatedBedrooms.length
}

/**
 * Turn remaining diagnostics into a short, human-readable list so the reply
 * says what's actually wrong instead of just a bare count.
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
  },
  limit = 5,
): string {
  const items = [
    ...diagnostics.validation.errors,
    ...diagnostics.verificationIssues,
    ...diagnostics.collisions.map(c => `${c.aId} 与 ${c.bId} 存在 ${c.kind} 碰撞`),
    ...diagnostics.doorlessRooms.map(name => `房间「${name}」没有任何门，是封闭空间`),
    ...diagnostics.strayWindows,
    ...diagnostics.requirementMismatches,
    ...diagnostics.isolatedBedrooms.map(name => `卧室「${name}」只能经过卫生间/厨房/其他卧室到达，动线不合规`),
  ]
  if (items.length === 0) return ''
  const shown = items.slice(0, limit).map(item => `- ${item}`).join('\n')
  const more = items.length > limit ? `\n……以及另外 ${items.length - limit} 项` : ''
  return `\n${shown}${more}`
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

function furnitureCaveat(toolNamesUsed: Set<string>, furnitureIssues: string[] = []): string {
  const touchedFurniture = [...toolNamesUsed].some(name => FURNITURE_TOOLS.has(name))
  if (!touchedFurniture) return ''
  const limit = 5
  const specific = furnitureIssues.length > 0
    ? `\n以下家具没有成功放置：\n${furnitureIssues.slice(0, limit).map(issue => `- ${issue}`).join('\n')}${furnitureIssues.length > limit ? `\n……以及另外 ${furnitureIssues.length - limit} 项` : ''}`
    : ''
  return `\n\n提示：家具的具体摆放位置未做自动检测（现有检查只覆盖结构、门窗和家具间的粗略重叠，不检查家具是否越界或贴墙贴门），建议在编辑器里确认一下位置。${specific}`
}

/**
 * `place_item` silently swaps in a placeholder box when its `catalogItemId`
 * isn't in the catalog (status: 'catalog_unavailable'), and `furnish_room`
 * silently drops placements that don't fit (status stays 'ok' but each drop
 * is listed in `skipped`). Both were previously invisible to the user —
 * the model could see them in the tool result but nothing surfaced them in
 * the final reply. This captures human-readable notes for both cases.
 */
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
  if (toolName === 'furnish_room' && Array.isArray(payload.skipped)) {
    for (const entry of payload.skipped) {
      if (typeof entry === 'string' && entry.trim()) out.push(entry.trim())
    }
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

function classifyCirculationRoomKind(name: string): CirculationRoomKind {
  if (/卧室|bedroom/i.test(name)) return 'bedroom'
  if (/厨房|kitchen|卫生间|浴室|洗手间|bathroom/i.test(name)) return 'blocked-service'
  return 'passable'
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

  const adjacency = new Map<string, Set<string>>()
  for (const zone of zones) adjacency.set(zone.id, new Set())
  for (const wall of walls) {
    if (!wall.openings.some(o => o.type === 'door')) continue
    const hostIds = wallHostZoneIds(wall, zones)
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

function findStrayWindows(zones: ZoneSummary[], walls: WallWithOpenings[]): string[] {
  const bounds = overallZoneBounds(zones)
  if (!bounds) return []
  const issues: string[] = []
  for (const wall of walls) {
    if (!wall.openings.some(o => o.type === 'window')) continue
    const midX = (wall.start[0] + wall.end[0]) / 2
    const midZ = (wall.start[1] + wall.end[1]) / 2
    const onBoundary =
      Math.abs(midX - bounds.minX) <= EXTERIOR_BOUNDARY_EPSILON_M ||
      Math.abs(midX - bounds.maxX) <= EXTERIOR_BOUNDARY_EPSILON_M ||
      Math.abs(midZ - bounds.minZ) <= EXTERIOR_BOUNDARY_EPSILON_M ||
      Math.abs(midZ - bounds.maxZ) <= EXTERIOR_BOUNDARY_EPSILON_M
    if (!onBoundary) {
      issues.push(`墙 ${wall.id} 上的窗户不在建筑外边界附近，疑似开在了室内隔墙上`)
    }
  }
  return issues
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
function compareRoomsToRequirements(zoneNames: string[], brief: DesignBrief): string[] {
  const issues: string[] = []
  const bedroomCount = numberFact(brief, ['bedroom_count', 'bedrooms'])
  if (bedroomCount !== undefined && bedroomCount > 0) {
    const actual = zoneNames.filter(name => /卧室|bedroom/i.test(name)).length
    if (actual < bedroomCount) {
      issues.push(`卧室数量不足：需求 ${bedroomCount} 间，实际建了 ${actual} 间`)
    }
  }
  const requestedRooms = arrayFact(brief, ['rooms', 'required_rooms', 'function_spaces'])
  const supportSpaces: Array<[string, RegExp]> = [
    ['厨房', /厨房|kitchen/i],
    ['卫生间', /卫生间|浴室|洗手间|bathroom/i],
    ['客厅', /客厅|起居室|living/i],
  ]
  for (const [label, pattern] of supportSpaces) {
    const wasRequested = requestedRooms.some(room => pattern.test(room))
    if (wasRequested && !zoneNames.some(name => pattern.test(name))) {
      issues.push(`缺少${label}：需求中明确要求了该空间但没有建`)
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
): Evaluation {
  const allFacts = [
    ...brief.existingCondition,
    ...brief.designGoals,
    ...brief.hardConstraints,
    ...brief.assumptions,
  ]
  const keys = new Set(allFacts.map(fact => fact.key.toLowerCase()))
  const hasGeometry = hasAnyKey(keys, ['area', 'size', 'dimension', 'boundary', 'width', 'depth'])
  const hasFunction = brief.designGoals.some(fact =>
    /(room|bedroom|space|function|layout|房|室|功能|户型)/i.test(`${fact.key} ${fact.label}`),
  )
  const confidenceFacts = allFacts.filter(fact => fact.source !== 'default_assumption')
  const averageConfidence = confidenceFacts.length > 0
    ? confidenceFacts.reduce((sum, fact) => sum + fact.confidence, 0) / confidenceFacts.length
    : 0
  const reasons: string[] = []
  const questions: string[] = []

  if (!hasGeometry) {
    reasons.push('缺少面积或边界尺寸')
    questions.push('户型的建筑面积或外部边界尺寸是多少？')
  }
  if (!hasFunction) {
    reasons.push('缺少必要功能空间')
    questions.push('必须包含哪些房间或功能空间？')
  }
  if (brief.conflicts.length > 0) {
    reasons.push('现状与设计目标存在尚未解决的冲突')
    questions.push(...brief.conflicts.map(conflict => conflict.question))
  }
  questions.push(...brief.uncertainties.map(fact => `请确认${fact.label}：${formatValue(fact.value)}`))

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

export function toolPayload(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== 'object') return {}
  const value = result as Record<string, unknown>
  if (value.structuredContent && typeof value.structuredContent === 'object') {
    return value.structuredContent as Record<string, unknown>
  }
  if (Array.isArray(value.content)) {
    const text = value.content.find(block =>
      Boolean(block) && typeof block === 'object' && (block as { type?: string }).type === 'text',
    ) as { text?: unknown } | undefined
    if (typeof text?.text === 'string') {
      try { return JSON.parse(text.text) as Record<string, unknown> } catch { return {} }
    }
  }
  return {}
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

export function shouldModifyExistingScene(nodeCount: number): boolean {
  return nodeCount > 4
}

export function isSceneQuestion(message: string): boolean {
  const value = message.trim()
  return /[?？]$/.test(value) || /(?:是不是|是否|有没有|好像|多少|多长|多高|多宽|是什么|为什么|吗|呢)[?？]?$/.test(value)
}

function isSceneIntent(value: unknown): value is SceneIntent {
  return value === 'query' || value === 'create' || value === 'update' ||
    value === 'delete' || value === 'ambiguous'
}

export function classifySceneIntentFallback(message: string): SceneIntent {
  const value = message.trim()
  if (/(?:删除|删掉|移除|去掉|拆除)/.test(value)) return 'delete'
  if (/(?:新增|添加|加一个|创建|放置|摆放|增加)/.test(value)) return 'create'
  if (/(?:修改|改成|改为|调整|移动|缩短|延长|扩大|缩小|重命名|替换)/.test(value)) return 'update'
  if (
    isSceneQuestion(value) ||
    /(?:查看|查询|检查|核对|测量|告诉我|显示)/.test(value)
  ) return 'query'
  return 'ambiguous'
}

function isCollision(value: unknown): value is { aId: string; bId: string; kind: string } {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.aId === 'string' && typeof record.bId === 'string' && typeof record.kind === 'string'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
