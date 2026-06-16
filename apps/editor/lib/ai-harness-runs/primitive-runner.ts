import { callConfiguredAi } from '@/lib/ai-provider'
import {
  type AiChatHarnessMessage,
  buildGeometryAnalysisContext,
  buildGeometryContextResolverPrompt,
  buildGeometryHarnessContext,
  buildPrimitiveRepairRetryMessages,
  DEFAULT_PRIMITIVE_REPAIR_STAGNATION_LIMIT,
  type GeometryContextDecision,
  INITIAL_PRIMITIVE_REPAIR_STAGNATION_STATE,
  inferCreateIntentFromBlueprint,
  isLikelyGeometryRevisionRequest,
  nextPrimitiveRepairStagnationState,
  PRIMITIVE_STAGE1_ANALYST_PROMPT,
  PRIMITIVE_STAGE2_GENERATOR_PROMPT,
  type PrimitiveRepairRetryMessage,
  planGeometryIntent,
  primitiveRepairCallBudget,
} from '../../../../packages/editor/src/lib/ai-chat-harness'
import type { GeneratedGeometryArtifact } from '../../../../packages/editor/src/lib/ai-generated-geometry-core'
import {
  executeGeometryToolCall,
  type GeometryToolExecutionResult,
} from '../../../../packages/editor/src/lib/ai-geometry-tool-executor'
import { appendRunEvent, isTerminalStatus, loadRun, updateRun } from './run-store'

type ApiMessage = {
  role: string
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>
  tool_call_id?: string
  tool_calls?: unknown
}

type TextApiMessage = ApiMessage & PrimitiveRepairRetryMessage

type ToolCall = {
  id: string
  function: { name: string; arguments: string }
}

type ApiResponseMessage = {
  role: string
  content?: string
  tool_calls?: ToolCall[]
}

type ComposeTool = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

type PartBlueprintItem = {
  id: string
  kind: string
  semanticRole?: string
  count?: number
  alignAbove?: string
  alignBeside?: string
  side?: 'left' | 'right' | 'front' | 'back'
  centeredOn?: string
  connectTo?: string
  connectPoint?: string
  around?: string
  aroundCount?: number
  array?: { count: number; axis: 'x' | 'y' | 'z'; spacing: number }
  warningStripes?: boolean
  stripeCount?: number
  dimensions?: Record<string, unknown>
}

type PartBlueprint = {
  route:
    | 'compose_parts'
    | 'compose_assembly'
    | 'compose_recipe'
    | 'compose_primitive'
    | 'revise_geometry'
  category?: string
  constraints?: Record<string, unknown>
  parts?: PartBlueprintItem[]
  requiredRoles?: string[]
}

type PrimitiveRouteMetrics = {
  route: 'deterministic' | 'stage2_fallback'
  stage1HasBlueprint: boolean
  deterministicIntent: boolean
  deterministicAttempted: boolean
  deterministicSucceeded: boolean
  stage2Called: boolean
  fallbackReason?:
    | 'no_blueprint'
    | 'no_deterministic_intent'
    | 'planner_issues'
    | 'direct_execution_no_artifact'
  family?: string
  component?: string
  deterministicTool?: string
  plannerIssues?: string[]
  stage2ToolCallCount: number
  repairCallCount: number
}

const runningRuns = new Set<string>()
const activeControllers = new Map<string, AbortController>()

const GEOMETRY_TOOL_NAMES = new Set([
  'compose_object',
  'compose_recipe',
  'compose_assembly',
  'compose_parts',
  'compose_robot_arm',
  'compose_primitive',
  'revise_geometry',
])

const PRIMITIVE_TOOLS: ComposeTool[] = [
  tool(
    'compose_object',
    'Create a supported editable object template such as chair, sofa, table, shelf, cabinet, monitor, keyboard, or outdoor AC unit.',
  ),
  tool(
    'compose_recipe',
    'Create one editable object from a deterministic instruction sheet. Recipes stay small and reference generic parts with semantic roles; use only for closed-form professional standard parts such as gear.spur, sprocket.chain, pipe.flange, pipe.elbow90, fastener.hexBolt, bearing.pillowBlock, coupling.flexible, plate.perforated, valve.gate/ball, robotArm.threeAxis, mixer.impeller, and motor.servo. Do not use this for open-ended complete equipment such as vehicles, outdoor AC units, machine tools, industrial robot arms, pumps, conveyors, fans, tanks, towers, reactors, compressors, grate coolers, aircraft, or broad industrial archetypes.',
  ),
  tool(
    'compose_assembly',
    'Create one editable object through the constraint-first automatic instruction-sheet generator. Prefer this only for supported open-ended families: vehicles, outdoor AC units, machine tools (lathe/milling/grinder/planer/drill/CNC), industrial robot arms, pumps, belt conveyors, fans, tanks, distillation/chemical towers or columns, reactors, compressors, grate coolers, electrical cabinets, and factory equipment. Plain chimneys/smokestacks are not assembly towers; use compose_parts with chimney_stack. If the requested family is unsupported, do not retry assembly; switch to compose_parts and choose generic building blocks. Pass family/object/style plus hard constraints such as length, width/diameter, height, primaryColor.',
  ),
  tool(
    'compose_parts',
    'Create one editable object from the reusable building-block library. Prefer this when explicitly selecting parts or when compose_assembly does not support the requested family. Use generic kernels such as chimney_stack, aircraft_fuselage, wheel/wheel_set, window_panel/window_strip, body_shell, tube_frame, fork, light_pair, bar_pair, streamlined_body, lofted_panel, airfoil_blade, pyramid, pipe/flange/bolt parts, and assign semanticRole for context-specific meaning. For a complete bicycle, use exactly wheel_set semanticRole:"bicycle_tire" count:2 + tube_frame semanticRole:"bicycle_frame" + fork semanticRole:"bicycle_fork" + handlebar + saddle + chain_loop; do not invent bicycle_crank/chainring/pedals part kinds. For complete aircraft/airplanes/airliners, use parts:[{kind:"aircraft_fuselage", id:"aircraft_fuselage"}] with top-level length/primaryColor and let defaults add wings, engines, T-tail, windows, and landing gear; do not hand-place generic airfoil_blade/streamlined_body/wheel_set parts for complete aircraft. For industrial chimneys/smokestacks, use parts:[{kind:"chimney_stack", semanticRole:"chimney_body", height, radius, warningStripes:true}] and do not use vertical_pole/circular_base/cylinder. Use pyramid for square/rectangular pyramids, Egyptian-style pyramids, pointed rooftops, and cone-like shapes with a square base; set truncated:true or topScale to make a flat-top truncated pyramid. Prefer relationship fields over raw coordinates: alignAbove, alignBeside with side, centeredOn, connectTo with connectPoint/childPoint, around with aroundCount/aroundRadius, and array:{count,axis,spacing} for repeated linear parts.',
  ),
  tool(
    'compose_robot_arm',
    'Create an editable industrial robot arm draft for robot arm requests not covered by robotArm.threeAxis.',
  ),
  tool(
    'compose_primitive',
    'Create one editable primitive object from custom primitive shapes. Use only when templates, recipes, and reusable parts do not cover the requested structure. Pass shapes:[{kind:"torus"|"cylinder"|"box"|"capsule"|...}] and semanticRole on critical shapes; do not use primitives:[...] or kind:"primitive". For car steering wheel / 汽车方向盘 use torus wheel_rim, cylinder center_hub, and 3 spoke shapes.',
  ),
  tool(
    'revise_geometry',
    'Patch the previous generated geometry artifact for follow-up user feedback. For color edits, use operations:[{op:"setMaterial", selector:{semanticRole:"belt_surface"}, color:"#f5c842"}]. For semantic size edits, use operations:[{op:"scaleSemantic", selector:{semanticRole:"fan_blade"}, dimension:"primary", factor:1.25}] or select a semanticGroup/sourcePartKind. It preserves existing shapes unless operations remove/replace them; do not use replace for recoloring.',
    {
      type: 'object',
      additionalProperties: true,
      properties: {
        targetArtifactId: { type: 'string' },
        feedback: { type: 'string' },
        intent: { type: 'string' },
        operations: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
            properties: {
              op: {
                type: 'string',
                enum: [
                  'add',
                  'remove',
                  'replace',
                  'transform',
                  'resize',
                  'scaleSemantic',
                  'materialFrom',
                  'setMaterial',
                  'align',
                ],
              },
              selector: {
                type: 'object',
                properties: {
                  index: { type: 'number' },
                  semanticRole: { type: 'string' },
                  semanticGroup: { type: 'string' },
                  sourcePartKind: { type: 'string' },
                  sourcePartId: { type: 'string' },
                  kind: { type: 'string' },
                  nameIncludes: { type: 'string' },
                },
              },
              dimension: {
                type: 'string',
                enum: [
                  'primary',
                  'uniform',
                  'length',
                  'width',
                  'height',
                  'depth',
                  'thickness',
                  'radius',
                  'diameter',
                  'majorRadius',
                  'tubeRadius',
                  'axisLength',
                  'profileX',
                  'profileY',
                ],
              },
              factor: { type: 'number' },
              color: { type: 'string' },
              materialPreset: { type: 'string' },
              material: { type: 'object' },
            },
            required: ['op'],
          },
        },
      },
      required: ['feedback', 'intent', 'operations'],
    },
  ),
]

function tool(
  name: string,
  description: string,
  parameters?: Record<string, unknown>,
): ComposeTool {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: parameters ?? {
        type: 'object',
        additionalProperties: true,
        properties: {},
      },
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeToolArgumentsSource(raw: string) {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenced?.[1]?.trim() ?? trimmed
}

function extractFirstBalancedJsonObject(source: string) {
  const start = source.indexOf('{')
  if (start < 0) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  return null
}

function parseToolArguments(raw: string): Record<string, unknown> {
  const source = normalizeToolArgumentsSource(raw || '{}') || '{}'
  try {
    const parsed = JSON.parse(source)
    if (isRecord(parsed)) return parsed
    throw new Error('Tool arguments must be a JSON object.')
  } catch (strictError) {
    const firstObject = extractFirstBalancedJsonObject(source)
    if (!firstObject || firstObject === source) throw strictError
    const parsed = JSON.parse(firstObject)
    if (isRecord(parsed)) return parsed
    throw strictError
  }
}

const CONTEXT_RESOLVER_SYSTEM_PROMPT = [
  'You are a context intent resolver for a 3D geometry tool harness.',
  'Classify whether the current request should edit/regenerate the latest generated artifact, merely keep it as summary context, or ignore it.',
  'Return strict JSON only. Do not call tools. Do not include markdown.',
].join('\n')

const CONTEXT_RELATIONSHIPS = new Set([
  'modify_previous',
  'regenerate_previous',
  'different_object',
  'new_unrelated_object',
  'ambiguous',
])

const CONTEXT_POLICIES = new Set(['none', 'summary_only', 'include_full_artifact'])

const CONTEXT_ROUTES = new Set([
  'revise_geometry',
  'fresh_replacement',
  'new_geometry',
  'model_decide',
])

function stringMember<T extends string>(value: unknown, allowed: Set<string>, fallback: T): T {
  return typeof value === 'string' && allowed.has(value) ? (value as T) : fallback
}

function numberConfidence(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5
}

function normalizeContextDecision(value: unknown): GeometryContextDecision {
  const record = isRecord(value) ? value : {}
  const editIntent = isRecord(record.editIntent)
    ? {
        type: typeof record.editIntent.type === 'string' ? record.editIntent.type : undefined,
        target: typeof record.editIntent.target === 'string' ? record.editIntent.target : undefined,
        dimension:
          typeof record.editIntent.dimension === 'string' ? record.editIntent.dimension : undefined,
        strength:
          typeof record.editIntent.strength === 'string' ? record.editIntent.strength : undefined,
      }
    : undefined

  return {
    relationshipToLatestArtifact: stringMember(
      record.relationshipToLatestArtifact,
      CONTEXT_RELATIONSHIPS,
      'ambiguous',
    ),
    contextPolicy: stringMember(record.contextPolicy, CONTEXT_POLICIES, 'summary_only'),
    recommendedRoute: stringMember(record.recommendedRoute, CONTEXT_ROUTES, 'model_decide'),
    confidence: numberConfidence(record.confidence),
    reason: typeof record.reason === 'string' ? record.reason.slice(0, 600) : 'Model decision.',
    ...(editIntent ? { editIntent } : {}),
  }
}

function parseContextDecision(content: string): GeometryContextDecision {
  const source = normalizeToolArgumentsSource(content || '{}') || '{}'
  try {
    return normalizeContextDecision(JSON.parse(source))
  } catch {
    const firstObject = extractFirstBalancedJsonObject(source)
    return normalizeContextDecision(firstObject ? JSON.parse(firstObject) : {})
  }
}

function fallbackContextDecision(
  userPrompt: string,
  latestArtifact: GeneratedGeometryArtifact | null,
): GeometryContextDecision {
  const revision = isLikelyGeometryRevisionRequest(userPrompt, latestArtifact)
  return {
    relationshipToLatestArtifact: revision ? 'modify_previous' : 'ambiguous',
    contextPolicy: revision ? 'include_full_artifact' : latestArtifact ? 'summary_only' : 'none',
    recommendedRoute: revision ? 'revise_geometry' : 'model_decide',
    confidence: revision ? 0.65 : 0.35,
    reason: 'Fallback decision used because context resolver did not return usable JSON.',
  }
}

function extractBlueprintFromAnalysis(analysis: string): PartBlueprint | null {
  const match = analysis.match(/```json\s*([\s\S]*?)\s*```/i)
  const source =
    match?.[1] ?? extractFirstBalancedJsonObject(normalizeToolArgumentsSource(analysis))
  if (!source) return null
  try {
    const parsed = JSON.parse(source)
    if (!isRecord(parsed) || typeof parsed.route !== 'string') return null
    if (
      parsed.route !== 'revise_geometry' &&
      !Array.isArray(parsed.parts) &&
      typeof parsed.category !== 'string'
    ) {
      return null
    }
    return parsed as PartBlueprint
  } catch {
    return null
  }
}

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Primitive generation cancelled', 'AbortError')
}

async function markRunCancelled(runId: string, message = 'cancelled') {
  const run = await loadRun(runId)
  if (!run || isTerminalStatus(run.status)) return
  await updateRun(runId, {
    status: 'cancelled',
    completedAt: new Date().toISOString(),
    error: message,
  })
  await appendRunEvent(runId, {
    type: 'status',
    message,
    data: { status: 'cancelled' },
  })
}

async function shouldStopRun(runId: string, signal: AbortSignal) {
  if (signal.aborted) return true
  const run = await loadRun(runId)
  return !run || run.status === 'cancelled'
}

async function callAi(
  apiMessages: ApiMessage[],
  tools: ComposeTool[] | undefined,
  signal: AbortSignal,
) {
  throwIfAborted(signal)
  const body = {
    messages: apiMessages,
    ...(tools?.length ? { tools, tool_choice: 'auto' as const } : {}),
    max_tokens: 4096,
  }
  const { res, text } = await callConfiguredAi(body, signal)
  throwIfAborted(signal)
  if (!res.ok) {
    const preview = text.replace(/\s+/g, ' ').trim().slice(0, 300)
    const isHtml = /^\s*</.test(text)
    throw new Error(
      `${res.status} ${res.statusText}${
        isHtml
          ? ': AI upstream returned an HTML error page. Check ANTHROPIC_BASE_URL / ANTHROPIC_MESSAGES_URL and provider availability.'
          : preview
            ? `: ${preview}`
            : ''
      }`,
    )
  }
  const data = JSON.parse(text)
  const message = data.choices?.[0]?.message
  if (!message) throw new Error('Empty response from AI.')
  return message as ApiResponseMessage
}

function contextRecord(value: unknown) {
  return isRecord(value) ? value : {}
}

function stringFromContext(context: Record<string, unknown>, key: string) {
  const value = context[key]
  return typeof value === 'string' ? value : undefined
}

function latestArtifactFromContext(context: Record<string, unknown>, key = 'latestArtifact') {
  const value = context[key]
  return isRecord(value) ? (value as unknown as GeneratedGeometryArtifact) : null
}

function harnessMessagesFromContext(context: Record<string, unknown>): AiChatHarnessMessage[] {
  const value = context.recentMessages
  if (!Array.isArray(value)) return []
  return value.flatMap((message) => {
    if (!isRecord(message)) return []
    const role = typeof message.role === 'string' ? message.role : undefined
    const content = typeof message.content === 'string' ? message.content : undefined
    if (!role || content == null) return []
    return [
      {
        role,
        content,
        isToolResult: message.isToolResult === true,
        geometryArtifact: isRecord(message.geometryArtifact)
          ? (message.geometryArtifact as unknown as GeneratedGeometryArtifact)
          : undefined,
      },
    ]
  })
}

async function resolveGeometryContextDecision({
  messages,
  latestArtifact,
  userPrompt,
  signal,
}: {
  messages: readonly AiChatHarnessMessage[]
  latestArtifact: GeneratedGeometryArtifact | null
  userPrompt: string
  signal: AbortSignal
}): Promise<GeometryContextDecision> {
  if (!latestArtifact) return fallbackContextDecision(userPrompt, latestArtifact)
  try {
    const response = await callAi(
      [
        { role: 'system', content: CONTEXT_RESOLVER_SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildGeometryContextResolverPrompt({
            messages,
            latestArtifact,
            userRequest: userPrompt,
          }),
        },
      ],
      undefined,
      signal,
    )
    return parseContextDecision(response.content ?? '')
  } catch {
    return fallbackContextDecision(userPrompt, latestArtifact)
  }
}

function executeTool(
  name: string,
  args: Record<string, unknown>,
  prompt: string,
  revisionTarget: GeneratedGeometryArtifact | null,
  blueprint: PartBlueprint | null,
): GeometryToolExecutionResult {
  const isRevisionTool = name === 'revise_geometry'
  return executeGeometryToolCall(
    name,
    args,
    {
      prompt,
      revisionOf: isRevisionTool ? revisionTarget?.id : undefined,
      revisionVersion: isRevisionTool ? revisionTarget?.version : undefined,
      replaceNodeIds: isRevisionTool ? revisionTarget?.placedNodeIds : undefined,
      revisionTarget,
      blueprintRequiredRoles: blueprint?.requiredRoles,
      blueprintCategory: blueprint?.category,
    },
    {
      messages: {
        unknownTool: (toolName) => `Unknown tool: ${toolName}`,
        noShapes: 'No geometry could be created.',
      },
    },
  )
}

function chooseGeometryToolCall(toolCalls: ToolCall[]) {
  return toolCalls.find((call) => GEOMETRY_TOOL_NAMES.has(call.function.name))
}

function summarizeToolCalls(toolCalls: ToolCall[]) {
  return toolCalls
    .map((call) =>
      [
        `tool=${call.function.name}`,
        `args=${call.function.arguments.replace(/\s+/g, ' ').trim().slice(0, 1200)}`,
      ].join('\n'),
    )
    .join('\n\n')
}

export function ensurePrimitiveRunRunning(runId: string) {
  if (runningRuns.has(runId)) {
    return
  }
  runningRuns.add(runId)
  void runPrimitiveRun(runId).finally(() => {
    runningRuns.delete(runId)
  })
}

export async function cancelPrimitiveRun(runId: string) {
  activeControllers.get(runId)?.abort()
  await markRunCancelled(runId, 'Geometry generation cancelled')
}

async function runPrimitiveRun(runId: string) {
  const run = await loadRun(runId)
  if (!run || run.mode !== 'primitive' || isTerminalStatus(run.status)) {
    return
  }
  const controller = new AbortController()
  activeControllers.set(runId, controller)

  const startedRun = await updateRun(runId, {
    status: 'running',
    startedAt: run.startedAt ?? new Date().toISOString(),
  })
  if (isTerminalStatus(startedRun.status)) {
    activeControllers.delete(runId)
    return
  }
  await appendRunEvent(runId, { type: 'status', message: 'running', data: { status: 'running' } })

  try {
    const { signal } = controller
    const context = contextRecord(run.context)
    const userPrompt = run.prompt
    const recentMessages = harnessMessagesFromContext(context)
    const latestArtifactCandidate =
      latestArtifactFromContext(context, 'latestArtifactCandidate') ??
      latestArtifactFromContext(context)
    const contextDecision = await resolveGeometryContextDecision({
      messages: recentMessages,
      latestArtifact: latestArtifactCandidate,
      userPrompt,
      signal,
    })
    const revisionTarget =
      contextDecision.contextPolicy === 'include_full_artifact' ? latestArtifactCandidate : null
    const harnessContext =
      latestArtifactCandidate || recentMessages.length
        ? buildGeometryHarnessContext({
            messages: recentMessages,
            latestArtifact: latestArtifactCandidate,
            userRequest: userPrompt,
            contextDecision,
          })
        : (stringFromContext(context, 'harnessContext') ?? run.prompt)
    const analysisContext =
      latestArtifactCandidate || recentMessages.length
        ? buildGeometryAnalysisContext({
            messages: recentMessages,
            latestArtifact: latestArtifactCandidate,
            userRequest: userPrompt,
            contextDecision,
          })
        : (stringFromContext(context, 'analysisContext') ?? harnessContext)

    await appendRunEvent(runId, {
      type: 'message',
      message: JSON.stringify(contextDecision),
      data: { stage: 'context-resolver', contextDecision },
    })

    await appendRunEvent(runId, { type: 'progress', message: 'Analyzing geometry request...' })
    const analysisResponse = await callAi(
      [
        { role: 'system', content: PRIMITIVE_STAGE1_ANALYST_PROMPT },
        { role: 'user', content: analysisContext },
      ],
      undefined,
      signal,
    )
    const analysis = analysisResponse.content ?? ''
    const blueprint = extractBlueprintFromAnalysis(analysis)
    throwIfAborted(signal)
    await appendRunEvent(runId, { type: 'message', message: analysis, data: { stage: 'analysis' } })

    const routeMetrics: PrimitiveRouteMetrics = {
      route: 'stage2_fallback',
      stage1HasBlueprint: Boolean(blueprint),
      deterministicIntent: false,
      deterministicAttempted: false,
      deterministicSucceeded: false,
      stage2Called: false,
      fallbackReason: blueprint ? 'no_deterministic_intent' : 'no_blueprint',
      stage2ToolCallCount: 0,
      repairCallCount: 0,
    }
    const deterministicResults: string[] = []
    let deterministicLastContent = ''
    const deterministicCreateIntent = blueprint
      ? inferCreateIntentFromBlueprint('compose_parts', {}, blueprint, userPrompt)
      : undefined
    if (deterministicCreateIntent) {
      routeMetrics.deterministicIntent = true
      routeMetrics.fallbackReason = undefined
      routeMetrics.family = deterministicCreateIntent.family
      routeMetrics.component = deterministicCreateIntent.component
      const plan = planGeometryIntent(deterministicCreateIntent, { revisionTarget })
      routeMetrics.deterministicTool = plan.tool
      routeMetrics.plannerIssues = plan.issues
      deterministicLastContent = `Deterministic geometry intent planned ${plan.tool}.`
      await appendRunEvent(runId, {
        type: 'message',
        message: deterministicLastContent,
        data: {
          stage: 'deterministic-plan',
          intent: deterministicCreateIntent,
          tool: plan.tool,
          issues: plan.issues,
          metadata: plan.action === 'create' ? plan.metadata : undefined,
        },
      })

      if (plan.issues.length === 0) {
        routeMetrics.deterministicAttempted = true
        const plannedArgs = {
          ...plan.args,
          geometryIntent: deterministicCreateIntent,
        }
        await appendRunEvent(runId, {
          type: 'tool-call',
          message: plan.tool,
          data: {
            name: plan.tool,
            arguments: plannedArgs,
            deterministic: true,
          },
        })
        throwIfAborted(signal)
        const directResult = executeTool(
          plan.tool,
          plannedArgs,
          userPrompt,
          revisionTarget,
          blueprint,
        )
        deterministicResults.push(directResult.content)
        await appendRunEvent(runId, {
          type: 'tool-result',
          message: directResult.content,
          data: {
            name: plan.tool,
            artifact: directResult.artifact,
            deterministic: true,
          },
        })
        await appendRunEvent(runId, {
          type: 'progress',
          message: directResult.content,
          data: {
            stage: 'generate',
            route: 'deterministic-intent',
            results: deterministicResults,
            artifact: directResult.artifact,
          },
        })

        if (directResult.artifact) {
          routeMetrics.route = 'deterministic'
          routeMetrics.deterministicSucceeded = true
          if (await shouldStopRun(runId, signal)) return
          const result = {
            contextDecision,
            analysis,
            results: deterministicResults,
            lastContent: deterministicLastContent,
            artifact: directResult.artifact,
            metrics: { primitiveRoute: routeMetrics },
          }
          await appendRunEvent(runId, {
            type: 'message',
            message: 'Primitive route metrics',
            data: { stage: 'route-metrics', primitiveRoute: routeMetrics },
          })
          await appendRunEvent(runId, { type: 'result', data: result })
          await updateRun(runId, {
            status: 'succeeded',
            completedAt: new Date().toISOString(),
            result,
          })
          await appendRunEvent(runId, {
            type: 'status',
            message: 'succeeded',
            data: { status: 'succeeded' },
          })
          return
        }
        routeMetrics.fallbackReason = 'direct_execution_no_artifact'
      } else {
        routeMetrics.fallbackReason = 'planner_issues'
        deterministicResults.push(
          [
            'Deterministic geometry intent could not be planned; falling back to Stage2 generator.',
            ...plan.issues.map((issue) => `- ${issue}`),
          ].join('\n'),
        )
      }
    }

    routeMetrics.stage2Called = true
    await appendRunEvent(runId, {
      type: 'message',
      message: 'Primitive route metrics',
      data: { stage: 'route-metrics', primitiveRoute: routeMetrics },
    })
    await appendRunEvent(runId, { type: 'progress', message: 'Generating editable geometry...' })
    const baseGenMessages: TextApiMessage[] = [
      { role: 'system', content: PRIMITIVE_STAGE2_GENERATOR_PROMPT },
      {
        role: 'user',
        content: blueprint
          ? [
              `User request: ${harnessContext}`,
              '',
              blueprint.route === 'revise_geometry'
                ? [
                    'Analysis determined this is a revision. Call revise_geometry based on the context above.',
                    `Blueprint: ${JSON.stringify(blueprint)}`,
                  ].join('\n')
                : [
                    `Part blueprint from analysis (route: ${blueprint.route}):`,
                    JSON.stringify(blueprint, null, 2),
                    '',
                    blueprint.route === 'compose_assembly'
                      ? 'Call compose_assembly with family, object, constraints from blueprint.constraints, and category. Do not use the parts array for compose_assembly.'
                      : blueprint.route === 'compose_recipe'
                        ? 'Call compose_recipe with the appropriate recipeId derived from blueprint.category and blueprint.constraints.'
                        : [
                            'Translate the blueprint parts array into compose_parts arguments.',
                            'Keep relationship fields such as alignAbove, alignBeside, centeredOn, connectTo, around, and array as-is.',
                            'Do not invent raw position coordinates; let relationship fields drive layout.',
                            'Add dimensions and colors from blueprint.constraints and put category/requiredRoles into geometryBrief.',
                          ].join('\n'),
                  ].join('\n'),
              '',
              'Output exactly one tool call.',
            ].join('\n')
          : [
              `User request: ${harnessContext}`,
              '',
              `Analysis:`,
              analysis,
              '',
              'Now call the best available tool based on this analysis. Output exactly one tool call.',
            ].join('\n'),
      },
    ]
    let genMessages = baseGenMessages
    // Fallback messages without blueprint, used if blueprint-driven repairs stagnate
    const fallbackGenMessages: TextApiMessage[] = blueprint
      ? [
          { role: 'system', content: PRIMITIVE_STAGE2_GENERATOR_PROMPT },
          {
            role: 'user',
            content: [
              `User request: ${harnessContext}`,
              '',
              `Analysis:`,
              analysis,
              '',
              'Now call the best available tool based on this analysis. Output exactly one tool call.',
            ].join('\n'),
          },
        ]
      : baseGenMessages

    let response = await callAi(genMessages, PRIMITIVE_TOOLS, signal)
    let artifact: GeneratedGeometryArtifact | undefined
    let lastContent = response.content ?? deterministicLastContent
    const results: string[] = [...deterministicResults]
    const repairCallBudget = primitiveRepairCallBudget({
      userPrompt,
      harnessContext,
      hasRevisionTarget: Boolean(revisionTarget),
    })
    const maxToolExecutionAttempts = 1 + repairCallBudget
    let stagnationState = INITIAL_PRIMITIVE_REPAIR_STAGNATION_STATE

    for (let attempt = 1; attempt <= maxToolExecutionAttempts; attempt += 1) {
      throwIfAborted(signal)
      const toolCalls = response.tool_calls ?? []
      if (toolCalls.length === 0) break
      routeMetrics.stage2ToolCallCount += toolCalls.length

      const toolResultMessages: ApiMessage[] = []
      const selectedGeometryCall = chooseGeometryToolCall(toolCalls)

      if (!selectedGeometryCall) {
        const result = [
          'Invalid generation plan. Nothing was created.',
          'Call exactly ONE geometry tool for the complete object.',
        ].join('\n')
        for (const call of toolCalls) {
          toolResultMessages.push({ role: 'tool', tool_call_id: call.id, content: result })
        }
        results.push(result)
      } else {
        for (const call of toolCalls) {
          if (call.id !== selectedGeometryCall.id) {
            const result = `Ignored extra tool call "${call.function.name}" because one complete geometry tool call was already selected.`
            toolResultMessages.push({ role: 'tool', tool_call_id: call.id, content: result })
            continue
          }
          let args: Record<string, unknown>
          try {
            args = parseToolArguments(call.function.arguments)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            const result = `Invalid tool arguments JSON. Nothing was created.\n${message}`
            toolResultMessages.push({ role: 'tool', tool_call_id: call.id, content: result })
            results.push(result)
            continue
          }
          const geometryIntent = inferCreateIntentFromBlueprint(
            call.function.name,
            args,
            blueprint,
            userPrompt,
          )
          if (geometryIntent) args.geometryIntent = geometryIntent
          await appendRunEvent(runId, {
            type: 'tool-call',
            message: call.function.name,
            data: { name: call.function.name, arguments: args },
          })
          throwIfAborted(signal)
          const result = executeTool(
            call.function.name,
            args,
            userPrompt,
            revisionTarget,
            blueprint,
          )
          toolResultMessages.push({ role: 'tool', tool_call_id: call.id, content: result.content })
          results.push(result.content)
          await appendRunEvent(runId, {
            type: 'tool-result',
            message: result.content,
            data: { name: call.function.name, artifact: result.artifact },
          })
          if (result.artifact) artifact = result.artifact
        }
      }

      await appendRunEvent(runId, {
        type: 'progress',
        message: results.at(-1) ?? 'Geometry tool executed.',
        data: { stage: 'generate', results, artifact },
      })

      if (
        artifact ||
        toolResultMessages.some((message) => String(message.content).startsWith('Created '))
      ) {
        break
      }

      const repairCallNumber = attempt
      if (repairCallNumber > repairCallBudget) {
        results.push(
          `Stopped after ${repairCallBudget} repair call${
            repairCallBudget === 1 ? '' : 's'
          } without creating valid geometry.`,
        )
        break
      }
      routeMetrics.repairCallCount = repairCallNumber

      const failureResults = toolResultMessages.map((message) => String(message.content))
      stagnationState = nextPrimitiveRepairStagnationState(stagnationState, failureResults)
      if (stagnationState.stagnantAttempts >= DEFAULT_PRIMITIVE_REPAIR_STAGNATION_LIMIT) {
        results.push(
          [
            'Stopped geometry repair early because repeated attempts returned the same failure signature.',
            `Repeated stagnant failures: ${stagnationState.stagnantAttempts}.`,
            'Ask the model/user for a different construction strategy instead of repeating the same invalid tool call.',
          ].join('\n'),
        )
        break
      }

      genMessages = buildPrimitiveRepairRetryMessages({
        // After first repair failure with a blueprint, fall back to harnessContext + analysis
        // so subsequent repairs aren't constrained by a potentially invalid blueprint
        baseMessages: blueprint && repairCallNumber > 1 ? fallbackGenMessages : baseGenMessages,
        repairCallNumber,
        repairCallBudget,
        failedToolSummary: summarizeToolCalls(toolCalls),
        failureResults,
      })
      response = await callAi(genMessages, PRIMITIVE_TOOLS, signal)
      if (response.content) lastContent = response.content
    }

    if (await shouldStopRun(runId, signal)) return
    const result = {
      contextDecision,
      analysis,
      results,
      lastContent,
      artifact,
      metrics: { primitiveRoute: routeMetrics },
    }
    await appendRunEvent(runId, {
      type: 'message',
      message: 'Primitive route metrics',
      data: { stage: 'route-metrics', primitiveRoute: routeMetrics },
    })
    await appendRunEvent(runId, { type: 'result', data: result })
    if (!artifact) {
      const message =
        results.at(-1) ??
        'Geometry generation completed without creating an editable geometry artifact.'
      await updateRun(runId, {
        status: 'failed',
        completedAt: new Date().toISOString(),
        error: message,
        result,
      })
      await appendRunEvent(runId, {
        type: 'status',
        message: 'failed',
        data: { status: 'failed' },
      })
      return
    }
    await updateRun(runId, {
      status: 'succeeded',
      completedAt: new Date().toISOString(),
      result,
    })
    await appendRunEvent(runId, {
      type: 'status',
      message: 'succeeded',
      data: { status: 'succeeded' },
    })
  } catch (error) {
    if (isAbortError(error) || controller.signal.aborted) {
      await markRunCancelled(runId, 'Geometry generation cancelled')
      return
    }
    const message = error instanceof Error ? error.message : String(error)
    await appendRunEvent(runId, { type: 'error', message })
    await updateRun(runId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      error: message,
    })
    await appendRunEvent(runId, { type: 'status', message: 'failed', data: { status: 'failed' } })
  } finally {
    activeControllers.delete(runId)
  }
}
