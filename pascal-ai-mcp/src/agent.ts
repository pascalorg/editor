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
  ConstructionPlan,
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
    try {
      session.executionSteps = []
      session.constructionPlan = await this.createConstructionPlan(session)
      session.executionSteps.push({ phase: 'planning', status: 'completed', label: '生成户型施工计划' })
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
      await this.applyConstructionPlan(
        session,
        nullableString(created.defaultLevelId),
      )
      const { diagnostics, repairRounds, toolNamesUsed } = await this.constructSceneInPhases(session)
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
        repairRounds,
        remainingIssueCount: countDiagnosticIssues(diagnostics),
      }
      session.sceneResult = sceneResult
      const remaining = sceneResult.remainingIssueCount
      session.phase = remaining === 0 ? 'completed' : 'completed_with_issues'
      const reply = (remaining === 0
        ? `户型已生成并通过自动检查。${sceneResult.editorUrl ? `\n打开场景：${sceneResult.editorUrl}` : ''}`
        : `户型已生成，自动修正已达上限（${repairRounds} 轮），仍有 ${remaining} 个问题需要人工确认：${describeRemainingIssues(diagnostics)}`
      ) + furnitureCaveat(toolNamesUsed)
      session.messages.push({ role: 'assistant', content: reply })
      return { session, reply, next: 'finish' }
    } catch (error) {
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
    const { diagnostics, repairRounds, toolNamesUsed } = await this.refineAndDiagnose(
      session,
      '在当前已有户型的基础上实现已确认需求。现有墙体、房间和开口是源数据；只做满足需求所必需的增量修改，禁止用模板替换整个场景，禁止删除无关结构。',
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
      repairRounds,
      remainingIssueCount,
    }
    session.phase = remainingIssueCount === 0 ? 'completed' : 'completed_with_issues'
    const reply = (remainingIssueCount === 0
      ? '已在现有户型基础上完成修改，并通过自动检查。'
      : `已在现有户型基础上完成修改，自动修正已达上限（${repairRounds} 轮），仍有 ${remainingIssueCount} 个问题需要人工确认：${describeRemainingIssues(diagnostics)}`
    ) + furnitureCaveat(toolNamesUsed)
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
      const { diagnostics, repairRounds, toolNamesUsed } = await this.refineAndDiagnose(
        session,
        `用户已确认对当前场景执行${operation}操作：${feedback}`,
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
        repairRounds,
        remainingIssueCount,
      }
      session.phase = remainingIssueCount === 0 ? 'completed' : 'completed_with_issues'
      delete session.pendingModification
      delete session.pendingOperation
      const reply = (remainingIssueCount === 0
        ? '已按你的要求修改当前户型，并通过自动检查。'
        : `已完成修改，自动修正已达上限（${repairRounds} 轮），仍有 ${remainingIssueCount} 个问题需要人工确认：${describeRemainingIssues(diagnostics)}`
      ) + furnitureCaveat(toolNamesUsed)
      session.messages.push({ role: 'assistant', content: reply })
      return { session, reply, next: 'finish' }
    } catch (error) {
      session.phase = session.sceneResult ? 'completed_with_issues' : 'failed'
      const reply = `场景修改失败：${errorMessage(error)}。原场景和修改要求都已保留，可以稍后重试。`
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

    // Retry once on malformed JSON, same pattern as createConstructionPlan —
    // this call is exactly the kind of strict-JSON-mode request that
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

  private async runSceneAgent(
    session: WorkflowSession,
    purpose: string,
    conversation?: ChatMessage[],
    toolNamesUsed: Set<string> = new Set(),
  ): Promise<{ messages: ChatMessage[]; converged: boolean; toolNamesUsed: Set<string> }> {
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
        content:
          'You are the Pascal scene generation and repair agent. Work only on the active Pascal scene. For user feedback, make the minimum change requested and never alter unrelated geometry. Prefer semantic room tools and atomic apply_patch. Preserve confirmed requirements, avoid destructive broad changes, inspect before mutation, and validate before finishing. When calling add_door or add_window, only set `position` (0..1 along the wall); the `t` field is a legacy alias for the same value — never set both, and never set `t` alone.\n\nImportant limitation of the automated checks: `check_collisions` only compares unrotated axis-aligned bounding boxes between pairs of items — it ignores each item\'s `rotation`, and it never checks an item against walls or against its room/zone polygon. `verify_scene` and `validate_scene` do not inspect item placement at all. Passing all three does NOT mean furniture is placed sensibly. So whenever you place or move an item (place_item, furnish_room, or an apply_patch that touches an item node), you must reason about placement yourself: call get_zones and find_nodes (or get_level_summary) for the target room first to see the room polygon and existing items, account for the item\'s own rotated footprint, keep it inside the room polygon, keep clearance from doors/walkways, and avoid visually overlapping other furniture even if check_collisions would not flag it.',
      },
    ]
    // Only inject conversation history when this call starts a fresh thread
    // (repair rounds and later phases already carry it forward in `messages`
    // itself, so repeating it every round would just waste tokens).
    const historyBlock = isNewThread ? recentConversationBlock(session.messages) : ''
    messages.push({
      role: 'user',
      content: `${purpose}\n${historyBlock}Confirmed brief:\n${session.summary || formatSummary(session.brief)}\nConstruction plan (coordinates and hard dimensions are authoritative):\n${JSON.stringify(session.constructionPlan ?? null)}`,
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
      if (!assistant.tool_calls?.length) return { messages, converged: true, toolNamesUsed }
      for (const toolCall of assistant.tool_calls) {
        toolNamesUsed.add(toolCall.function.name)
        messages.push(await this.executeToolCall(toolCall))
      }
    }
    return { messages, converged: false, toolNamesUsed }
  }

  private async applyConstructionPlan(
    session: WorkflowSession,
    levelId: string | null,
  ): Promise<void> {
    const plan = session.constructionPlan
    if (!plan || !levelId) throw new Error('Construction plan or target level is missing')
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
      for (const room of plan.rooms) {
        await this.mcp.callTool('create_room', {
          levelId,
          name: room.name,
          polygon: room.polygon,
          wallHeight: 2.8,
          wallThickness: 0.16,
        })
      }
      session.executionSteps?.push({
        phase: 'structure',
        status: 'completed',
        label: `按施工计划创建 ${plan.rooms.length} 个房间`,
      })
    } catch (error) {
      session.executionSteps?.push({ phase: 'structure', status: 'failed', label: '创建结构与房间' })
      throw error
    }
  }

  private async createConstructionPlan(session: WorkflowSession): Promise<ConstructionPlan> {
    const deterministic = buildDeterministicSingleRoomPlan(session.brief)
    if (deterministic) return deterministic
    let lastError: unknown
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await this.withModelFallback(model =>
          model.json<ConstructionPlan>(
            [
              {
                role: 'system',
                content:
                  'Create a buildable rectangular architectural floor-plan JSON. Return only: {footprint:{widthM,depthM,polygon:[[x,z],...]},rooms:[{name,type,polygon:[[x,z],...],furniture:[...]}],openings:[{type:"door|window",roomName,wall:"north|east|south|west|shared"}]}. Use meters, center the footprint at origin, keep every room inside it, avoid overlaps, cover the usable footprint, preserve all hard dimensions, and include realistic circulation.',
              },
              {
                role: 'user',
                content: `${session.summary || formatSummary(session.brief)}${attempt > 0 ? '\nPrevious plan was geometrically invalid. Recalculate all room polygons.' : ''}`,
              },
            ],
            `${session.sessionId}:construction-plan:${attempt}`,
          ),
        )
        return normalizeConstructionPlan(result)
      } catch (error) {
        lastError = error
      }
    }
    throw lastError
  }

  private async constructSceneInPhases(session: WorkflowSession): Promise<{
    diagnostics: Awaited<ReturnType<PascalAiAgent['collectDiagnostics']>>
    repairRounds: number
    toolNamesUsed: Set<string>
  }> {
    session.executionSteps ??= []
    let conversation: ChatMessage[] | undefined
    let toolNamesUsed = new Set<string>()
    try {
      const opening = await this.runSceneAgent(
        session,
        '完成阶段：先用 get_walls/get_zones 核对房间，严格按施工计划用 add_door/add_window 完成连通和采光；然后按每个房间的 furniture 清单使用 search_assets 与 place_item，或 furnish_room。保留通行空间，不得改变硬性尺寸。',
      )
      conversation = opening.messages
      toolNamesUsed = opening.toolNamesUsed
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
      { skipInitialAgent: true, conversation, toolNamesUsed },
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
    } = {},
  ): Promise<{
    diagnostics: Awaited<ReturnType<PascalAiAgent['collectDiagnostics']>>
    repairRounds: number
    toolNamesUsed: Set<string>
  }> {
    let conversation = options.conversation
    let toolNamesUsed = options.toolNamesUsed ?? new Set<string>()
    if (!options.skipInitialAgent) {
      const result = await this.runSceneAgent(session, purpose, conversation, toolNamesUsed)
      conversation = result.messages
      toolNamesUsed = result.toolNamesUsed
    }
    let diagnostics = await this.collectDiagnostics()
    diagnostics = await this.repairKnownOpeningBounds(diagnostics)
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
      )
      conversation = result.messages
      toolNamesUsed = result.toolNamesUsed
      diagnostics = await this.collectDiagnostics()
      diagnostics = await this.repairKnownOpeningBounds(diagnostics)
    }
    return { diagnostics, repairRounds, toolNamesUsed }
  }

  private async repairKnownOpeningBounds(
    diagnostics: Awaited<ReturnType<PascalAiAgent['collectDiagnostics']>>,
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
    return this.collectDiagnostics()
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

  private async executeToolCall(toolCall: ToolCall): Promise<ChatMessage> {
    try {
      const args = parseToolArgs(toolCall.function.arguments)
      const result = await this.mcp.callTool(toolCall.function.name, args)
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

  private async collectDiagnostics(): Promise<{
    validation: { valid: boolean; errors: string[] }
    verificationIssues: string[]
    collisions: Array<{ aId: string; bId: string; kind: string }>
  }> {
    const [validationRaw, verificationRaw, collisionsRaw] = await Promise.all([
      this.mcp.callTool('validate_scene', {}),
      this.mcp.callTool('verify_scene', {}),
      this.mcp.callTool('check_collisions', {}),
    ])
    const validationPayload = toolPayload(validationRaw)
    const verificationPayload = toolPayload(verificationRaw)
    const collisionPayload = toolPayload(collisionsRaw)
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
    return {
      validation: {
        valid: validationPayload.valid === true,
        errors: validationErrors,
      },
      verificationIssues,
      collisions,
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

export function countDiagnosticIssues(diagnostics: {
  validation: { errors: string[] }
  verificationIssues: string[]
  collisions: unknown[]
}): number {
  return diagnostics.validation.errors.length +
    diagnostics.verificationIssues.length + diagnostics.collisions.length
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
  },
  limit = 5,
): string {
  const items = [
    ...diagnostics.validation.errors,
    ...diagnostics.verificationIssues,
    ...diagnostics.collisions.map(c => `${c.aId} 与 ${c.bId} 存在 ${c.kind} 碰撞`),
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

// Tools that create/move item (furniture) nodes. check_collisions only
// compares unrotated bounding boxes between items and never checks items
// against walls or room bounds, and verify_scene/validate_scene don't look
// at item placement at all — so "passed automatic checks" does not cover
// furniture placement quality. apply_patch is included because it can touch
// an item node just as easily as any other node type.
const FURNITURE_TOOLS = new Set(['place_item', 'furnish_room', 'apply_patch'])

function furnitureCaveat(toolNamesUsed: Set<string>): string {
  const touchedFurniture = [...toolNamesUsed].some(name => FURNITURE_TOOLS.has(name))
  if (!touchedFurniture) return ''
  return '\n\n提示：家具的具体摆放位置未做自动检测（现有检查只覆盖结构、门窗和家具间的粗略重叠，不检查家具是否越界或贴墙贴门），建议在编辑器里确认一下位置。'
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

export function buildDeterministicSingleRoomPlan(brief: DesignBrief): ConstructionPlan | null {
  const widthM = numberFact(brief, ['width_m', 'room_width_m', 'width'])
  const depthM = numberFact(brief, [
    'depth_m', 'length_m', 'room_depth_m', 'room_length_m', 'depth', 'length',
  ])
  if (!widthM || !depthM || widthM <= 0 || depthM <= 0) return null
  const requestedRooms = arrayFact(brief, ['rooms', 'required_rooms', 'function_spaces'])
  const bedroomCount = numberFact(brief, ['bedroom_count', 'bedrooms'])
  if (requestedRooms.length > 1 || (bedroomCount ?? 1) > 1) return null
  const name = requestedRooms[0] ?? ((bedroomCount ?? 0) === 1 ? '卧室' : '房间')
  const halfWidth = widthM / 2
  const halfDepth = depthM / 2
  const polygon: Array<[number, number]> = [
    [-halfWidth, -halfDepth],
    [halfWidth, -halfDepth],
    [halfWidth, halfDepth],
    [-halfWidth, halfDepth],
  ]
  return {
    footprint: { widthM, depthM, polygon },
    rooms: [{
      name,
      type: /卧室|bedroom/i.test(name) ? 'bedroom' : 'room',
      polygon,
      furniture: /卧室|bedroom/i.test(name) ? ['bed', 'wardrobe', 'nightstand'] : [],
    }],
    openings: [
      { type: 'door', roomName: name, wall: 'south' },
      { type: 'window', roomName: name, wall: 'north' },
    ],
  }
}

export function normalizeConstructionPlan(value: ConstructionPlan): ConstructionPlan {
  if (
    !value || !value.footprint ||
    !Number.isFinite(value.footprint.widthM) || value.footprint.widthM <= 0 ||
    !Number.isFinite(value.footprint.depthM) || value.footprint.depthM <= 0 ||
    !isPolygon(value.footprint.polygon) || !Array.isArray(value.rooms) || value.rooms.length === 0
  ) throw new Error('Model returned an invalid construction plan')
  const rooms = value.rooms.filter(room =>
    Boolean(room) && typeof room.name === 'string' && typeof room.type === 'string' &&
    isPolygon(room.polygon),
  ).map(room => ({
    name: room.name,
    type: room.type,
    polygon: room.polygon,
    furniture: Array.isArray(room.furniture)
      ? room.furniture.filter(item => typeof item === 'string')
      : [],
  }))
  if (rooms.length === 0) throw new Error('Construction plan contains no valid rooms')
  const footprintBounds = polygonBounds(value.footprint.polygon)
  const roomBounds = rooms.map(room => polygonBounds(room.polygon))
  for (const bounds of roomBounds) {
    if (
      bounds.minX < footprintBounds.minX || bounds.maxX > footprintBounds.maxX ||
      bounds.minZ < footprintBounds.minZ || bounds.maxZ > footprintBounds.maxZ
    ) throw new Error('Construction plan contains a room outside the footprint')
  }
  for (let left = 0; left < roomBounds.length; left++) {
    for (let right = left + 1; right < roomBounds.length; right++) {
      const a = roomBounds[left]!
      const b = roomBounds[right]!
      if (Math.min(a.maxX, b.maxX) > Math.max(a.minX, b.minX) &&
        Math.min(a.maxZ, b.maxZ) > Math.max(a.minZ, b.minZ)) {
        throw new Error('Construction plan contains overlapping rooms')
      }
    }
  }
  const openings = Array.isArray(value.openings)
    ? value.openings.filter(opening =>
        Boolean(opening) && (opening.type === 'door' || opening.type === 'window') &&
        typeof opening.roomName === 'string' &&
        ['north', 'east', 'south', 'west', 'shared'].includes(opening.wall),
      )
    : []
  return { footprint: value.footprint, rooms, openings }
}

function polygonBounds(polygon: Array<[number, number]>): {
  minX: number; maxX: number; minZ: number; maxZ: number
} {
  const xs = polygon.map(point => point[0])
  const zs = polygon.map(point => point[1])
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) }
}

function isPolygon(value: unknown): value is Array<[number, number]> {
  return Array.isArray(value) && value.length >= 3 && value.every(point =>
    Array.isArray(point) && point.length === 2 && point.every(Number.isFinite),
  )
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

function toolPayload(result: unknown): Record<string, unknown> {
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
