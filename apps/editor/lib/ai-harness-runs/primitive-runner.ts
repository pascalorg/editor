import {
  applyDeviceProfileToPartInput,
  type DeviceProfileDefinition,
  evaluateDeviceProfileQuality,
  inferDeviceProfileDefinition,
} from '@pascal-app/core/lib/device-profile-registry'
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
import { persistDeviceProfileCandidateFromArtifact } from '../device-profile-candidates'
import { loadDeviceProfiles } from '../device-profiles'
import { type IndustryPackRef, resolveIndustryPackDir } from './industry-factory-knowledge'
import {
  applyProfileEditablePatchToArgs,
  resolveProfileEditablePatch,
} from './profile-editable-patches'
import { resolveProfileResourceCandidates } from './resource-profile-resolver'
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
  deviceProfileDraft?: Record<string, unknown>
}

type PrimitiveRouteMetrics = {
  route: 'profile' | 'deterministic' | 'stage2_fallback'
  stage1HasBlueprint: boolean
  selectedProfile?: string
  profileSource?: string
  profilePackId?: string
  layoutTemplate?: string
  overrodeBuiltin?: boolean
  profileOverrides?: unknown[]
  profileQualityScore?: number
  deterministicIntent: boolean
  deterministicAttempted: boolean
  deterministicSucceeded: boolean
  stage2Called: boolean
  fallbackReason?:
    | 'no_blueprint'
    | 'no_deterministic_intent'
    | 'planner_issues'
    | 'direct_execution_no_artifact'
    | 'profile_no_artifact'
  family?: string
  component?: string
  deterministicTool?: string
  plannerIssues?: string[]
  stage3QualityScore?: number
  stage3Passed?: boolean
  stage3Issues?: string[]
  stage3Warnings?: string[]
  stage3RepairApplied?: boolean
  stage2ToolCallCount: number
  repairCallCount: number
}

const runningRuns = new Set<string>()
const activeControllers = new Map<string, AbortController>()

const GEOMETRY_TOOL_NAMES = new Set([
  'compose_recipe',
  'compose_assembly',
  'compose_parts',
  'compose_robot_arm',
  'compose_primitive',
  'revise_geometry',
])

const PRIMITIVE_TOOLS: ComposeTool[] = [
  tool(
    'compose_recipe',
    'Create one editable object from a deterministic instruction sheet. Recipes stay small and reference generic parts with semantic roles; use only for closed-form professional standard parts such as gear.spur, sprocket.chain, pipe.flange, pipe.elbow90, fastener.hexBolt, bearing.pillowBlock, coupling.flexible, plate.perforated, valve.gate/ball, robotArm.threeAxis, mixer.impeller, motor.servo, process.vesselShell, structure.platformLadder, and enclosure.roundedBox. Do not use this for open-ended complete equipment such as vehicles, outdoor AC units, machine tools, industrial robot arms, pumps, conveyors, fans, tanks, towers, reactors, compressors, grate coolers, aircraft, or broad industrial archetypes.',
  ),
  tool(
    'compose_assembly',
    'Create one editable object through the constraint-first automatic instruction-sheet generator. Prefer this only for supported open-ended families: vehicles, outdoor AC units, machine tools (lathe/milling/grinder/planer/drill/CNC), industrial robot arms, pumps, belt conveyors, fans, tanks, distillation/chemical towers or columns, reactors, compressors, grate coolers, electrical cabinets, and factory equipment. Plain chimneys/smokestacks are not assembly towers; use compose_parts with chimney_stack. If the requested family is unsupported, do not retry assembly; switch to compose_parts and choose generic building blocks. Pass family/object/style plus hard constraints such as length, width/diameter, height, primaryColor.',
  ),
  tool(
    'compose_parts',
    'Create one editable object from the reusable building-block library. Prefer this when explicitly selecting parts or when compose_assembly does not support the requested family. Use generic kernels such as chimney_stack, aircraft_fuselage, wheel/wheel_set, window_panel/window_strip, body_shell, tube_frame, fork, light_pair, bar_pair, streamlined_body, lofted_panel, airfoil_blade, pyramid, pipe/flange/bolt parts, and assign semanticRole for context-specific meaning. generic_body is a rectangular box/enclosure, not an arbitrary round body; for bottles, flasks, thermoses, cups, cans, jars, tubes, handles, or any cylindrical/oval main body, use compose_primitive with cylinder, hollow-cylinder, capsule, torus, sphere/ellipsoid, lathe, or sweep shapes instead. For complete fans, prefer fan_blade with count:3-6 so each blade is independently editable; radial_blades is kept only as a compatibility composite. For a complete bicycle, use exactly wheel_set semanticRole:"bicycle_tire" count:2 + tube_frame semanticRole:"bicycle_frame" + fork semanticRole:"bicycle_fork" + handlebar + saddle + chain_loop; do not invent bicycle_crank/chainring/pedals part kinds. For complete aircraft/airplanes/airliners, use parts:[{kind:"aircraft_fuselage", id:"aircraft_fuselage"}] with top-level length/primaryColor and let defaults add wings, engines, T-tail, windows, and landing gear; do not hand-place generic airfoil_blade/streamlined_body/wheel_set parts for complete aircraft. For industrial chimneys/smokestacks, use parts:[{kind:"chimney_stack", semanticRole:"chimney_body", height, radius, warningStripes:true}] and do not use vertical_pole/circular_base/cylinder. Use pyramid for square/rectangular pyramids, Egyptian-style pyramids, pointed rooftops, and cone-like shapes with a square base; set truncated:true or topScale to make a flat-top truncated pyramid. Prefer relationship fields over raw coordinates: alignAbove, alignBeside with side, centeredOn, connectTo with connectPoint/childPoint, around with aroundCount/aroundRadius, and array:{count,axis,spacing} for repeated linear parts.',
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

export function ensurePromptInPrimitiveContext(userPrompt: string, contextText: string): string {
  const prompt = userPrompt.trim()
  const text = contextText.trim()
  if (!prompt || !text) return text || prompt
  if (text.toLowerCase().includes(prompt.toLowerCase())) return text
  return [`User request: ${prompt}`, '', 'Additional context:', text].join('\n')
}

const NEGATED_TARGET_CLAUSE_PATTERNS = [
  /\b(?:do\s+not|don't|dont|never|avoid|not)\s+(?:generate|create|make|build|model|use)?\s*([^.!?;\n]+)/gi,
  /(?:不要生成|不要|别生成|不是|避免生成|禁止生成)\s*([^。！？；\n]+)/g,
]

export function stripNegatedTargetClauses(userPrompt: string): string {
  let text = userPrompt
  for (const pattern of NEGATED_TARGET_CLAUSE_PATTERNS) {
    text = text.replace(pattern, ' ')
  }
  return text
}

function industryPackRefFromContext(context: Record<string, unknown>): IndustryPackRef | undefined {
  const value = context.industrySourcePack
  if (!isRecord(value)) return undefined
  const id = typeof value.id === 'string' && value.id.trim() ? value.id.trim() : undefined
  const version =
    typeof value.version === 'string' && value.version.trim() ? value.version.trim() : undefined
  const industry =
    typeof value.industry === 'string' && value.industry.trim() ? value.industry.trim() : undefined
  if (!id || !version) return undefined
  return { id, version, ...(industry ? { industry } : {}) }
}

function inferredIndustryPackRefsFromPrompt(prompt: string): IndustryPackRef[] {
  if (
    /(\u56de\u8f6c\u7a91|\u6c34\u6ce5\u56de\u8f6c\u7a91|\u6c34\u6ce5\u7a91|rotary[_\s-]?kiln|cement[_\s-]?kiln)/i.test(
      prompt,
    )
  ) {
    return [{ id: 'industry.cement.basic', version: '0.1.0', industry: 'cement' }]
  }
  return []
}

function uniqueDeviceProfilePackDirs(refs: readonly IndustryPackRef[]) {
  const dirs: string[] = []
  const seen = new Set<string>()
  for (const ref of refs) {
    const dir = resolveIndustryPackDir(ref)
    if (!dir || seen.has(dir)) continue
    seen.add(dir)
    dirs.push(dir)
  }
  return dirs
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
  deviceProfiles?: Awaited<ReturnType<typeof loadDeviceProfiles>>,
): GeometryToolExecutionResult {
  const isRevisionTool = name === 'revise_geometry'
  if (blueprint?.deviceProfileDraft && args.deviceProfileDraft == null) {
    args.deviceProfileDraft = blueprint.deviceProfileDraft
  }
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
      deviceProfiles: deviceProfiles?.profiles,
    },
    {
      messages: {
        unknownTool: (toolName) => `Unknown tool: ${toolName}`,
        noShapes: 'No geometry could be created.',
      },
    },
  )
}

export function precisionPartDeterministicRoute(
  userPrompt: string,
  revisionTarget: GeneratedGeometryArtifact | null,
):
  | {
      label: string
      family: string
      args: Record<string, unknown>
    }
  | undefined {
  if (revisionTarget) return undefined
  const text = stripNegatedTargetClauses(userPrompt).toLowerCase()
  const robotArmIntent =
    /(\u673a\u5668\u81c2|\u673a\u68b0\u81c2|\u516d\u8f74|\u4e03\u8f74|\u56db\u8f74|robot[_\s-]?arm|industrial[_\s-]?robot|six[_\s-]?axis|6[_\s-]?axis|seven[_\s-]?axis|7[_\s-]?axis|four[_\s-]?axis|4[_\s-]?axis|fanuc|kuka|abb)/i.test(
      text,
    )
  if (robotArmIntent) {
    const axisCount = robotArmAxisCountFromPrompt(text)
    return {
      label: `${axisCount}-axis industrial robot arm`,
      family: 'robot_arm',
      args: {
        name: `${axisCount}-axis industrial robot arm`,
        family: 'robot_arm',
        axisCount,
        includeWorkcell: false,
        height: 2.2,
        endEffector: 'tool-flange',
      },
    }
  }

  const pumpIntent =
    /(\u6c34\u6cf5|\u79bb\u5fc3\u6cf5|pump|centrifugal[_\s-]?pump|water[_\s-]?pump)/i.test(text) &&
    !/(\u53f6\u8f6e|impeller|blade|flange|port|inlet|outlet)/i.test(text)
  if (pumpIntent) {
    const primaryColor = machinePrimaryColorFromPrompt(text, '#64748b')
    return {
      label: 'centrifugal water pump',
      family: 'pump',
      args: {
        name: 'centrifugal water pump',
        family: 'pump',
        category: 'industrial pump',
        primaryColor,
        metalColor: '#cbd5e1',
        requiredRoles: [
          'support_base',
          'drive_motor',
          'volute_casing',
          'inlet_port',
          'outlet_port',
        ],
        parts: [
          {
            id: 'base',
            kind: 'skid_base',
            semanticRole: 'support_base',
          },
          {
            id: 'motor',
            kind: 'ribbed_motor_body',
            semanticRole: 'drive_motor',
            position: [-0.28, 0.42, 0],
            length: 0.55,
            primaryColor,
            metalColor: '#cbd5e1',
          },
          {
            id: 'volute',
            kind: 'volute_casing',
            semanticRole: 'volute_casing',
            position: [0.24, 0.42, 0.04],
            radius: 0.22,
            depth: 0.16,
            primaryColor,
            metalColor: '#cbd5e1',
          },
          {
            id: 'inlet',
            kind: 'inlet_port',
            semanticRole: 'inlet_port',
            position: [0.24, 0.42, 0.28],
            axis: 'z',
            radius: 0.07,
            metalColor: '#cbd5e1',
          },
          {
            id: 'outlet',
            kind: 'outlet_port',
            semanticRole: 'outlet_port',
            position: [0.49, 0.5, 0.04],
            axis: 'x',
            radius: 0.06,
            metalColor: '#cbd5e1',
          },
          {
            id: 'flange_in',
            kind: 'flange_ring',
            semanticRole: 'inlet_flange',
            connectTo: 'inlet',
            connectPoint: 'open',
            metalColor: '#cbd5e1',
          },
          {
            id: 'flange_out',
            kind: 'flange_ring',
            semanticRole: 'outlet_flange',
            connectTo: 'outlet',
            connectPoint: 'open',
            metalColor: '#cbd5e1',
          },
          {
            id: 'control',
            kind: 'control_box',
            semanticRole: 'control_box',
            position: [-0.28, 0.62, 0.2],
          },
        ],
      },
    }
  }

  const mixerImpellerIntent =
    /(\u6405\u62cc|\u6df7\u5408|\u6868\u53f6|\u53f6\u7247|\u53f6\u8f6e|mixer|stirrer|agitator|impeller|paddle)/i.test(
      text,
    ) &&
    /(\u6746|\u8f74|shaft|rod|pole)/i.test(text) &&
    !/(\u98ce\u6247|\u7535\u98ce\u6247|\u843d\u5730\u6247|fan|pedestal[_\s-]?fan)/i.test(text)
  if (mixerImpellerIntent) {
    const bladeCount = mixerBladeCountFromPrompt(text)
    const metalColor = machinePrimaryColorFromPrompt(text, '#c0c0c0')
    return {
      label: 'vertical shaft mixer impeller',
      family: 'generic',
      args: {
        name: 'vertical shaft mixer impeller',
        family: 'generic',
        category: 'mixer impeller component',
        geometryBrief:
          'vertical mixer shaft with a bottom hub and pitched three-blade mixing impeller; not a fan, no pedestal, no motor housing, no protective grille',
        requiredRoles: ['mixer_shaft', 'mixer_hub', 'mixer_blade'],
        detail: 'high',
        parts: [
          {
            id: 'mixer_hub',
            kind: 'circular_base',
            semanticRole: 'mixer_hub',
            radius: 0.055,
            height: 0.055,
            primaryColor: metalColor,
            position: [0, 0.06, 0],
          },
          {
            id: 'mixer_shaft',
            kind: 'vertical_pole',
            semanticRole: 'mixer_shaft',
            radius: 0.022,
            height: 0.82,
            metalColor,
            position: [0, 0.49, 0],
          },
          {
            id: 'mixer_blades',
            kind: 'mixer_blades',
            semanticRole: 'mixer_blade',
            count: bladeCount,
            length: 0.34,
            width: 0.17,
            depth: 0.018,
            bladePitch: 0.22,
            curvature: 0.08,
            bladeShape: 'taiji_half',
            hubRadius: 0.055,
            primaryColor: metalColor,
            position: [0, 0.06, 0],
          },
        ],
      },
    }
  }

  const towerCraneIntent =
    /(\u5854\u540a|tower[_\s-]?crane|hammerhead[_\s-]?crane|construction[_\s-]?crane)/i.test(
      text,
    ) &&
    !/(\u9f99\u95e8\u540a|\u5929\u8f66|\u884c\u8f66|gantry|overhead|bridge[_\s-]?crane)/i.test(text)
  if (towerCraneIntent) {
    const primaryColor = machinePrimaryColorFromPrompt(text, '#facc15')
    const darkColor = '#111827'
    const metalColor = '#475569'
    return {
      label: 'hammerhead tower crane',
      family: 'generic',
      args: {
        name: 'hammerhead tower crane',
        family: 'generic',
        category: 'lifting equipment',
        __precisionPartRoute: 'tower_crane',
        __directPartComposer: true,
        geometryBrief:
          'construction-site hammerhead tower crane with lattice mast, slewing unit, operator cab, tower peak, long main jib, shorter counter jib, counterweight, trolley, vertical wire rope, hook block, and pendant cables',
        requiredRoles: [
          'tower_mast',
          'slewing_unit',
          'operator_cab',
          'tower_peak',
          'main_jib',
          'counter_jib',
          'counterweight',
          'trolley',
          'wire_rope',
          'hook_block',
          'pendant_cable',
        ],
        detail: 'high',
        primaryColor,
        metalColor,
        darkColor,
        parts: [
          {
            id: 'tower_mast',
            kind: 'structural_tower_frame',
            semanticRole: 'tower_mast',
            name: 'lattice tower mast',
            position: [0, 2.9, 0],
            length: 0.72,
            width: 0.72,
            height: 5.8,
            levelCount: 4,
            bayCount: 1,
            thickness: 0.045,
            externalStairs: false,
            includeDiagonalBraces: true,
            primaryColor,
            metalColor: primaryColor,
            darkColor: primaryColor,
            accentColor: primaryColor,
          },
          {
            id: 'slewing_unit',
            kind: 'generic_base',
            semanticRole: 'slewing_unit',
            name: 'slewing ring turntable',
            position: [0, 5.98, 0],
            length: 1.0,
            width: 0.82,
            height: 0.18,
            primaryColor,
            darkColor,
          },
          {
            id: 'operator_cab',
            kind: 'generic_body',
            semanticRole: 'operator_cab',
            name: 'operator cab',
            position: [0.55, 6.18, 0.36],
            length: 0.55,
            width: 0.42,
            height: 0.42,
            primaryColor: '#fef3c7',
            cornerRadius: 0.035,
          },
          {
            id: 'tower_peak',
            kind: 'pyramid',
            semanticRole: 'tower_peak',
            name: 'tower peak apex',
            position: [0, 6.68, 0],
            length: 0.42,
            width: 0.42,
            height: 0.85,
            primaryColor,
          },
          {
            id: 'main_jib',
            kind: 'generic_body',
            semanticRole: 'main_jib',
            name: 'long main lifting jib',
            position: [3.45, 6.35, 0],
            length: 6.9,
            width: 0.14,
            height: 0.14,
            primaryColor,
          },
          {
            id: 'counter_jib',
            kind: 'generic_body',
            semanticRole: 'counter_jib',
            name: 'short counter jib',
            position: [-1.55, 6.35, 0],
            length: 3.1,
            width: 0.16,
            height: 0.14,
            primaryColor,
          },
          {
            id: 'counterweight',
            kind: 'generic_body',
            semanticRole: 'counterweight',
            name: 'counterweight block stack',
            position: [-2.95, 6.22, 0],
            length: 0.52,
            width: 0.62,
            height: 0.55,
            primaryColor: '#6b7280',
            cornerRadius: 0.025,
          },
          {
            id: 'trolley',
            kind: 'generic_body',
            semanticRole: 'trolley',
            name: 'jib trolley carriage',
            position: [4.75, 6.17, 0],
            length: 0.42,
            width: 0.28,
            height: 0.18,
            primaryColor: darkColor,
            cornerRadius: 0.02,
          },
          {
            id: 'wire_rope',
            kind: 'vertical_pole',
            semanticRole: 'wire_rope',
            name: 'vertical hoist wire rope',
            position: [4.75, 4.88, 0],
            radius: 0.014,
            height: 2.42,
            metalColor: darkColor,
          },
          {
            id: 'hook_block',
            kind: 'generic_body',
            semanticRole: 'hook_block',
            name: 'hanging hook block',
            position: [4.75, 3.55, 0],
            length: 0.25,
            width: 0.18,
            height: 0.38,
            primaryColor: darkColor,
            cornerRadius: 0.02,
          },
          {
            id: 'main_pendant',
            kind: 'generic_body',
            semanticRole: 'pendant_cable',
            name: 'main jib pendant cable',
            position: [2.05, 6.62, 0],
            rotation: [0, 0, -0.12],
            length: 4.15,
            width: 0.035,
            height: 0.035,
            primaryColor: darkColor,
          },
          {
            id: 'counter_pendant',
            kind: 'generic_body',
            semanticRole: 'pendant_cable',
            name: 'counter jib pendant cable',
            position: [-0.95, 6.62, 0],
            rotation: [0, 0, 0.32],
            length: 1.95,
            width: 0.035,
            height: 0.035,
            primaryColor: darkColor,
          },
        ],
      },
    }
  }

  const fanIntent =
    /(\u5de5\u4e1a\u98ce\u6247|\u843d\u5730\u6247|\u7535\u98ce\u6247|\u98ce\u6247|industrial[_\s-]?(pedestal[_\s-]?)?fan|standing[_\s-]?fan|pedestal[_\s-]?fan)/i.test(
      text,
    ) &&
    !/(fanuc|\u7a7a\u8c03|\u5916\u673a|\u5ba4\u5916\u673a|air[_\s-]?condition|ac[_\s-]?(outdoor|condenser)|outdoor[_\s-]?unit|condenser[_\s-]?unit)/i.test(
      text,
    )
  if (fanIntent) {
    const primaryColor = fanPrimaryColorFromPrompt(text)
    const bladeCount = fanBladeCountFromPrompt(text)
    return {
      label: 'industrial pedestal fan',
      family: 'fan',
      args: {
        name: 'industrial pedestal fan',
        family: 'fan',
        primaryColor,
        metalColor: '#cbd5e1',
        parts: [
          {
            id: 'base',
            kind: 'circular_base',
            semanticRole: 'fan_base',
            radius: 0.28,
            height: 0.06,
            primaryColor: '#111827',
          },
          {
            id: 'pole',
            kind: 'vertical_pole',
            semanticRole: 'fan_pole',
            alignAbove: 'base',
            radius: 0.024,
            height: 1.05,
            metalColor: '#111827',
          },
          {
            id: 'yoke',
            kind: 'support_bracket',
            semanticRole: 'fan_yoke',
            alignAbove: 'pole',
            width: 0.18,
            height: 0.14,
            depth: 0.14,
            metalColor: '#111827',
          },
          {
            id: 'motor',
            kind: 'motor_housing',
            semanticRole: 'motor_housing',
            alignAbove: 'yoke',
            radius: 0.13,
            depth: 0.18,
            primaryColor,
          },
          {
            id: 'blades',
            kind: 'fan_blade',
            semanticRole: 'fan_blade',
            centeredOn: 'motor',
            count: bladeCount,
            length: 0.32,
            width: 0.1,
            thickness: 0.012,
            pitch: 0.28,
            primaryColor,
            includeHub: true,
          },
          {
            id: 'grill',
            kind: 'protective_grill',
            semanticRole: 'protective_grill',
            centeredOn: 'motor',
            side: 'front',
            radius: 0.37,
            depth: 0.08,
            detailLevel: 'low',
          },
        ],
      },
    }
  }

  const tankIntent =
    /(\u5367\u5f0f|\u50a8\u7f50|\u538b\u529b\u7f50|\u538b\u529b\u5bb9\u5668|storage[_\s-]?tank|pressure[_\s-]?(tank|vessel)|horizontal[_\s-]?(tank|vessel))/i.test(
      text,
    ) && !/(\u53cd\u5e94\u91dc|\u53cd\u5e94\u5668|reactor|agitator|stirred)/i.test(text)
  if (tankIntent) {
    return {
      label: 'horizontal pressure tank',
      family: 'tank',
      args: {
        name: 'horizontal pressure storage tank',
        family: 'generic',
        parts: [
          {
            kind: 'cylindrical_tank',
            semanticRole: 'vessel_shell',
            axis: 'x',
            length: 2.2,
            radius: 0.34,
          },
        ],
      },
    }
  }

  const platformIntent =
    !robotArmIntent &&
    /(\u68c0\u4fee\u5e73\u53f0|\u5de5\u4e1a\u5e73\u53f0|\u722c\u68af|access[_\s-]?platform|inspection[_\s-]?platform|platform[_\s-]?ladder)/i.test(
      text,
    ) &&
    !/(\u50a8\u7f50|\u538b\u529b\u7f50|\u538b\u529b\u5bb9\u5668|\u53cd\u5e94\u91dc|\u53cd\u5e94\u5668|storage[_\s-]?tank|pressure[_\s-]?(tank|vessel)|reactor|agitator|stirred)/i.test(
      text,
    )
  if (platformIntent) {
    return {
      label: 'industrial platform ladder',
      family: 'generic',
      args: {
        name: 'industrial inspection platform ladder',
        family: 'generic',
        parts: [
          {
            kind: 'platform_ladder',
            semanticRole: 'access_platform',
            length: 1.2,
            width: 0.7,
            height: 1.6,
            count: 7,
          },
        ],
      },
    }
  }

  return undefined
}

function robotArmAxisCountFromPrompt(text: string): number {
  if (/(seven[_\s-]?axis|7[_\s-]?axis|\u4e03\u8f74)/i.test(text)) return 7
  if (/(six[_\s-]?axis|6[_\s-]?axis|\u516d\u8f74|fanuc|kuka|abb)/i.test(text)) return 6
  if (/(five[_\s-]?axis|5[_\s-]?axis|\u4e94\u8f74)/i.test(text)) return 5
  if (/(four[_\s-]?axis|4[_\s-]?axis|\u56db\u8f74|scara)/i.test(text)) return 4
  if (/(three[_\s-]?axis|3[_\s-]?axis|\u4e09\u8f74)/i.test(text)) return 3
  return 6
}

function fanBladeCountFromPrompt(text: string): number {
  if (/(\u516d\u7247|\u516d\u53f6|six|6)/i.test(text)) return 6
  if (/(\u4e94\u7247|\u4e94\u53f6|five|5)/i.test(text)) return 5
  if (/(\u56db\u7247|\u56db\u53f6|four|4)/i.test(text)) return 4
  if (/(\u4e09\u7247|\u4e09\u53f6|three|3)/i.test(text)) return 3
  return 5
}

function machinePrimaryColorFromPrompt(text: string, fallback: string): string {
  if (/(\u84dd|blue)/i.test(text)) return '#3b82f6'
  if (/(\u7ea2|red)/i.test(text)) return '#ef4444'
  if (/(\u9ed1|black)/i.test(text)) return '#111827'
  if (/(\u767d|white)/i.test(text)) return '#f8fafc'
  if (/(\u9ec4|yellow)/i.test(text)) return '#facc15'
  return fallback
}

function fanPrimaryColorFromPrompt(text: string): string {
  return machinePrimaryColorFromPrompt(text, '#ef4444')
}

function mixerBladeCountFromPrompt(text: string): number {
  if (/(\u516d\u7247|\u516d\u53f6|six|6)/i.test(text)) return 6
  if (/(\u4e94\u7247|\u4e94\u53f6|five|5)/i.test(text)) return 5
  if (/(\u56db\u7247|\u56db\u53f6|four|4)/i.test(text)) return 4
  if (/(\u4e09\u7247|\u4e09\u53f6|three|3)/i.test(text)) return 3
  return 3
}

type Stage3RepairPlan = {
  label: string
  tool: 'compose_parts' | 'compose_primitive'
  args: Record<string, unknown>
}

type Stage3QualityReview = {
  passed: boolean
  score: number
  issues: string[]
  warnings: string[]
  repairPlan?: Stage3RepairPlan
  requiresModelRepair?: boolean
}

function normalizeStage3Role(value: unknown): string {
  return typeof value === 'string'
    ? value
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_')
    : ''
}

type Stage3LiftingKind = 'tower' | 'gantry' | 'overhead' | 'generic'

const STAGE3_LIFTING_INTENT_PATTERN =
  /crane|gantry|overhead|bridge_crane|tower_crane|jib|hook|trolley|hoist|\u9f99\u95e8\u540a|\u5854\u540a|\u5929\u8f66|\u884c\u8f66|\u8d77\u91cd|\u540a\u8f66/

function inferStage3LiftingKind(text: string): Stage3LiftingKind | undefined {
  if (!STAGE3_LIFTING_INTENT_PATTERN.test(text)) return undefined
  if (/tower[_\s-]?crane|\u5854\u540a/.test(text)) return 'tower'
  if (/gantry|portal[_\s-]?crane|\u9f99\u95e8\u540a/.test(text)) return 'gantry'
  if (/overhead|bridge[_\s-]?crane|\u5929\u8f66|\u884c\u8f66/.test(text)) return 'overhead'
  return 'generic'
}

function stage3LiftingRequiredRoles(kind: Stage3LiftingKind): string[] {
  if (kind === 'tower') {
    return [
      'tower_mast',
      'slewing_unit',
      'operator_cab',
      'tower_peak',
      'main_jib',
      'counter_jib',
      'counterweight',
      'trolley',
      'wire_rope',
      'hook_block',
      'pendant_cable',
    ]
  }
  if (kind === 'gantry') {
    return ['support_leg', 'main_girder', 'trolley', 'wire_rope', 'hook_block', 'runway_rail']
  }
  if (kind === 'overhead') {
    return ['runway_rail', 'main_girder', 'trolley', 'wire_rope', 'hook_block']
  }
  return ['support', 'main_girder', 'trolley', 'wire_rope', 'hook_block']
}

function stage3ShapeText(shape: Record<string, unknown>): string {
  return [
    shape.name,
    shape.semanticRole,
    shape.sourcePartKind,
    shape.sourcePartId,
    shape.semanticGroup,
    shape.kind,
  ]
    .map(normalizeStage3Role)
    .filter(Boolean)
    .join(' ')
}

function stage3RequiredRoles(artifact: GeneratedGeometryArtifact): string[] {
  const brief = artifact.geometryBrief as
    | { requiredRoles?: unknown; semanticRoles?: unknown }
    | undefined
  const values = [
    ...(Array.isArray(brief?.requiredRoles) ? brief.requiredRoles : []),
    ...(Array.isArray(brief?.semanticRoles) ? brief.semanticRoles : []),
  ]
  return Array.from(new Set(values.map(normalizeStage3Role).filter(Boolean)))
}

function stage3RolePresent(
  shapes: readonly Record<string, unknown>[],
  requiredRole: string,
): boolean {
  return shapes.some((shape) => {
    const text = stage3ShapeText(shape)
    const semanticRole = normalizeStage3Role(shape.semanticRole)
    return (
      text.includes(requiredRole) ||
      (semanticRole.length > 0 && requiredRole.includes(semanticRole))
    )
  })
}

function stage3RoleFamilyPattern(requiredRole: string): RegExp {
  if (/tower.*mast|mast|support|support_leg/.test(requiredRole)) {
    return /tower_mast|tower_body|tower_column|mast|support_column|support_leg|leg|column/
  }
  if (/slew|slewing|turntable/.test(requiredRole)) return /slew|slewing|turntable|rotating_platform/
  if (/tower.*peak|apex|peak/.test(requiredRole)) return /tower_peak|apex|peak|tower_cap/
  if (/pendant/.test(requiredRole)) return /pendant_cable|tie_rod|stay_cable|guy_cable/
  if (/operator|cabin|(^|_)cab($|_)/.test(requiredRole)) {
    return /operator_cab|driver_cab|cabin|(^|_)cab($|_)/
  }
  if (/counter.*jib|balance.*arm/.test(requiredRole)) return /counter_jib|counter_boom|balance_arm/
  if (/main.*jib|jib|boom|girder|beam|arm/.test(requiredRole)) {
    return /main_jib|jib_arm|jib_boom|boom|main_girder|bridge_girder|girder|beam/
  }
  if (/counter.*weight|ballast|weight/.test(requiredRole)) {
    return /counterweight|counter_weight|ballast/
  }
  if (/trolley|carriage/.test(requiredRole)) return /trolley|carriage/
  if (/wire.*rope|rope|cable/.test(requiredRole)) return /wire_rope|rope|hoist_cable|cable/
  if (/hook/.test(requiredRole)) return /hook_block|hook|load_hook/
  if (/rail|runway/.test(requiredRole)) return /runway_rail|rail|track/
  return new RegExp(requiredRole.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
}

function stage3RoleFamilyPresent(
  shapes: readonly Record<string, unknown>[],
  requiredRole: string,
): boolean {
  const pattern = stage3RoleFamilyPattern(requiredRole)
  return shapes.some((shape) => pattern.test(stage3ShapeText(shape)))
}

function numberAt(value: unknown, index: 0 | 1 | 2): number | undefined {
  if (Array.isArray(value) && typeof value[index] === 'number' && Number.isFinite(value[index])) {
    return value[index]
  }
  if (typeof value === 'object' && value !== null) {
    const key = index === 0 ? 'x' : index === 1 ? 'y' : 'z'
    const next = (value as Record<string, unknown>)[key]
    if (typeof next === 'number' && Number.isFinite(next)) return next
  }
  return undefined
}

function shapeCenterY(shape: Record<string, unknown>): number | undefined {
  return numberAt(shape.position, 1)
}

function shapeSpan(shape: Record<string, unknown>, axis: 0 | 1 | 2): number {
  const keys =
    axis === 1
      ? ['height', 'length']
      : axis === 2
        ? ['width', 'depth', 'radius']
        : ['length', 'width', 'radius']
  for (const key of keys) {
    const value = shape[key]
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return key === 'radius' ? value * 2 : value
    }
  }
  return 0
}

function findStage3Shape(
  shapes: readonly Record<string, unknown>[],
  pattern: RegExp,
): Record<string, unknown> | undefined {
  return findStage3ShapeMatching(shapes, pattern)
}

function findStage3ShapeMatching(
  shapes: readonly Record<string, unknown>[],
  include: RegExp,
  exclude?: RegExp,
): Record<string, unknown> | undefined {
  return shapes.find((shape) => {
    const text = stage3ShapeText(shape)
    return include.test(text) && !(exclude?.test(text) ?? false)
  })
}

function addLiftingEquipmentSpatialIssues(
  artifact: GeneratedGeometryArtifact,
  text: string,
  issues: string[],
) {
  const shapes = artifact.shapes as unknown as Record<string, unknown>[]
  const combinedText = [
    text,
    artifact.geometryBrief?.category,
    artifact.geometryBrief?.requiredRoles?.join(' '),
    artifact.shapeDetails,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  const liftingKind = inferStage3LiftingKind(combinedText)
  if (!liftingKind) return

  const unrelatedAircraft = shapes.find((shape) =>
    /aircraft|fuselage|(?:^|[\s_])wing(?:[\s_]|$)|wing_panel|stabilizer|nacelle|landing_gear|cockpit|cabin_window/.test(
      stage3ShapeText(shape),
    ),
  )
  if (unrelatedAircraft) {
    issues.push('Stage3 lifting equipment contains unrelated aircraft geometry.')
  }

  const support = findStage3Shape(shapes, /leg|column|mast|tower_body|tower_column|support/)
  const span = findStage3Shape(shapes, /girder|main_girder|bridge_girder|jib|counter_jib|boom/)
  const trolley = findStage3ShapeMatching(shapes, /trolley|carriage/, /hook|load|suspended/)
  const hook = findStage3Shape(shapes, /hook|suspended|load/)
  const wheelOrRail = findStage3Shape(shapes, /wheel|rail|runway/)

  for (const role of stage3LiftingRequiredRoles(liftingKind)) {
    if (!stage3RoleFamilyPresent(shapes, role)) {
      issues.push(`Stage3 lifting equipment missing structural role "${role}".`)
    }
  }

  if (support && span) {
    const supportY = shapeCenterY(support)
    const spanY = shapeCenterY(span)
    if (supportY != null && spanY != null && spanY <= supportY + 0.05) {
      issues.push('Stage3 lifting structure span/beam must be above its support/mast.')
    }
    const supportWidth = Math.max(shapeSpan(support, 0), shapeSpan(support, 2), 0.001)
    const spanLength = Math.max(shapeSpan(span, 0), shapeSpan(span, 2))
    if (spanLength < supportWidth * 1.8) {
      issues.push('Stage3 lifting structure span/beam is too short relative to its support.')
    }
  }

  if (trolley && hook) {
    const trolleyY = shapeCenterY(trolley)
    const hookY = shapeCenterY(hook)
    if (trolleyY != null && hookY != null && hookY >= trolleyY - 0.05) {
      issues.push('Stage3 lifting hook must hang below the trolley/carriage.')
    }
  }

  if (liftingKind === 'gantry' || liftingKind === 'overhead') {
    if (!span) issues.push('Stage3 bridge/gantry crane requires a spanning beam/girder.')
    if (!hook) issues.push('Stage3 bridge/gantry crane requires a hook or suspended load.')
    if (!wheelOrRail)
      issues.push('Stage3 bridge/gantry crane requires bottom wheels or runway rails.')
  }
}

function addBoxEnclosureEquipmentIssues(
  artifact: GeneratedGeometryArtifact,
  text: string,
  issues: string[],
) {
  const shapes = artifact.shapes as unknown as Record<string, unknown>[]
  const combinedText = [
    text,
    artifact.geometryBrief?.category,
    artifact.geometryBrief?.requiredRoles?.join(' '),
    artifact.geometryBrief?.semanticRoles?.join(' '),
    artifact.semanticSummary,
    artifact.visualQualitySummary,
    artifact.shapeDetails,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  const outdoorAcIntent =
    /outdoor[_\s-]?ac|ac[_\s-]?outdoor|air[_\s-]?condition|condenser|hvac|\u7a7a\u8c03|\u5916\u673a/.test(
      combinedText,
    )
  if (!outdoorAcIntent) return

  const pedestalPart = shapes.find((shape) =>
    /vertical_pole|circular_base|fan_base|fan_pole|pedestal|support_bracket|fan_yoke/.test(
      stage3ShapeText(shape),
    ),
  )
  if (pedestalPart) {
    issues.push('Stage3 outdoor enclosure must not include pedestal fan stand parts.')
  }

  const bodyEntry = shapes
    .map((shape, index) => ({ shape, index }))
    .find(({ shape }) =>
      /condenser_body|main_body|machine_body|body|housing|casing|enclosure|shell/.test(
        stage3ShapeText(shape),
      ),
    )
  const body = bodyEntry?.shape
  const foot = findStage3Shape(shapes, /support_feet|support_foot|feet|foot|base_leg|leg/)
  if (body && foot) {
    const bodyY = shapeCenterY(body)
    const footY = shapeCenterY(foot)
    const bodyHeight = shapeSpan(body, 1)
    if (bodyY != null && footY != null) {
      const expectedBelow = bodyHeight > 0 ? bodyY - bodyHeight * 0.25 : bodyY - 0.05
      if (footY >= expectedBelow) {
        issues.push('Stage3 enclosure support feet must be below the main body.')
      }
    }
  }
  if (bodyEntry) {
    const bodyTop = stage3ShapeTopY(artifact, bodyEntry.shape, bodyEntry.index)
    const floatingFanPart = shapes.find((shape, index) => {
      const shapeText = stage3ShapeText(shape)
      if (!/motor_housing|protective_grill/.test(shapeText)) return false
      if (/front_grille|fan_guard|fan_grill/.test(shapeText)) return false
      return stage3ShapeBottomY(artifact, shape, index) > bodyTop + 0.05
    })
    if (floatingFanPart) {
      issues.push(
        'Stage3 outdoor enclosure must not include floating standalone fan parts above the body.',
      )
    }
  }
}

type Stage3SemanticRepairResult = {
  artifact: GeneratedGeometryArtifact
  label: string
}

function stage3CombinedIntentText(userPrompt: string, artifact: GeneratedGeometryArtifact): string {
  return [
    userPrompt,
    artifact.geometryBrief?.category,
    artifact.geometryBrief?.requiredRoles?.join(' '),
    artifact.geometryBrief?.semanticRoles?.join(' '),
    artifact.semanticSummary,
    artifact.visualQualitySummary,
    artifact.shapeDetails,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function isStage3LiftingIntent(text: string): boolean {
  return STAGE3_LIFTING_INTENT_PATTERN.test(text)
}

function isStage3OutdoorAcIntent(text: string): boolean {
  return /outdoor[_\s-]?ac|ac[_\s-]?outdoor|air[_\s-]?condition|condenser|hvac|\u7a7a\u8c03|\u5916\u673a/.test(
    text,
  )
}

function stage3ShapePosition(
  artifact: GeneratedGeometryArtifact,
  shape: Record<string, unknown>,
  index: number,
): [number, number, number] {
  const transformPosition = artifact.transforms[index]?.position
  return [
    numberAt(transformPosition, 0) ?? numberAt(shape.position, 0) ?? 0,
    numberAt(transformPosition, 1) ?? numberAt(shape.position, 1) ?? 0,
    numberAt(transformPosition, 2) ?? numberAt(shape.position, 2) ?? 0,
  ]
}

function setStage3ShapePosition(
  artifact: GeneratedGeometryArtifact,
  shape: Record<string, unknown>,
  index: number,
  position: [number, number, number],
) {
  shape.position = position
  const transform = artifact.transforms[index]
  if (transform) {
    artifact.transforms[index] = { ...transform, position }
  }
}

function stage3ShapeHalfHeight(shape: Record<string, unknown>): number {
  return Math.max(shapeSpan(shape, 1) / 2, 0.05)
}

function stage3ShapeTopY(
  artifact: GeneratedGeometryArtifact,
  shape: Record<string, unknown>,
  index: number,
): number {
  return stage3ShapePosition(artifact, shape, index)[1] + stage3ShapeHalfHeight(shape)
}

function stage3ShapeBottomY(
  artifact: GeneratedGeometryArtifact,
  shape: Record<string, unknown>,
  index: number,
): number {
  return stage3ShapePosition(artifact, shape, index)[1] - stage3ShapeHalfHeight(shape)
}

function stage3MoveAbove(
  artifact: GeneratedGeometryArtifact,
  child: Record<string, unknown>,
  childIndex: number,
  parent: Record<string, unknown>,
  parentIndex: number,
  clearance = 0.08,
): boolean {
  const childPosition = stage3ShapePosition(artifact, child, childIndex)
  const parentPosition = stage3ShapePosition(artifact, parent, parentIndex)
  const targetY =
    parentPosition[1] + stage3ShapeHalfHeight(parent) + stage3ShapeHalfHeight(child) + clearance
  if (childPosition[1] >= targetY - 0.01) return false
  setStage3ShapePosition(artifact, child, childIndex, [childPosition[0], targetY, childPosition[2]])
  return true
}

function stage3MoveBelow(
  artifact: GeneratedGeometryArtifact,
  child: Record<string, unknown>,
  childIndex: number,
  parent: Record<string, unknown>,
  parentIndex: number,
  clearance = 0.08,
): boolean {
  const childPosition = stage3ShapePosition(artifact, child, childIndex)
  const parentPosition = stage3ShapePosition(artifact, parent, parentIndex)
  const targetY =
    parentPosition[1] - stage3ShapeHalfHeight(parent) - stage3ShapeHalfHeight(child) - clearance
  if (childPosition[1] <= targetY + 0.01) return false
  setStage3ShapePosition(artifact, child, childIndex, [childPosition[0], targetY, childPosition[2]])
  return true
}

function findStage3ShapeWithIndex(
  artifact: GeneratedGeometryArtifact,
  include: RegExp,
  exclude?: RegExp,
): { shape: Record<string, unknown>; index: number } | undefined {
  const shapes = artifact.shapes as unknown as Record<string, unknown>[]
  for (const [index, shape] of shapes.entries()) {
    const text = stage3ShapeText(shape)
    if (include.test(text) && !(exclude?.test(text) ?? false)) return { shape, index }
  }
  return undefined
}

function compactStage3ArtifactDetails(artifact: GeneratedGeometryArtifact): string {
  return artifact.shapes
    .map((shape, index) => {
      const position = artifact.transforms[index]?.position ?? shape.position
      return `  - ${shape.name ?? shape.kind}: ${shape.kind} pos=[${(position as number[] | undefined)?.join(',') ?? '0,0,0'}] role=${shape.semanticRole ?? ''} source=${shape.sourcePartKind ?? ''}`
    })
    .join('\n')
}

function addStage3Shape(
  artifact: GeneratedGeometryArtifact,
  shape: Record<string, unknown>,
  position: [number, number, number],
) {
  const nextShape = {
    kind: 'box',
    name: shape.semanticRole ?? shape.name ?? 'semantic scaffold',
    position,
    rotation: [0, 0, 0],
    length: 1,
    width: 1,
    height: 1,
    sourcePartKind: 'semantic_scaffold',
    ...shape,
  }
  artifact.shapes.push(nextShape as GeneratedGeometryArtifact['shapes'][number])
  artifact.transforms.push({ position, rotation: [0, 0, 0] })
  artifact.createdNames.push(String(nextShape.name ?? nextShape.kind))
  return { shape: nextShape, index: artifact.shapes.length - 1 }
}

function removeDuplicateStage3RoleFamilies(
  artifact: GeneratedGeometryArtifact,
  requiredRoles: readonly string[],
): boolean {
  const keep = new Set<number>()
  const remove = new Set<number>()
  const shapes = artifact.shapes as unknown as Record<string, unknown>[]
  for (const role of requiredRoles) {
    const pattern = stage3RoleFamilyPattern(role)
    const matching = shapes
      .map((shape, index) => ({ shape, index }))
      .filter(({ shape }) => pattern.test(stage3ShapeText(shape)))
    if (matching.length <= 1) continue
    keep.add(matching[0]!.index)
    for (const duplicate of matching.slice(1)) remove.add(duplicate.index)
  }
  if (remove.size === 0) return false
  const entries = artifact.shapes
    .map((shape, index) => ({ shape, transform: artifact.transforms[index], index }))
    .filter(({ index }) => keep.has(index) || !remove.has(index))
  artifact.shapes = entries.map(({ shape }) => shape)
  artifact.transforms = entries.map(({ shape, transform }) => ({
    position: transform?.position ?? shape.position ?? [0, 0, 0],
    rotation: transform?.rotation ?? shape.rotation ?? [0, 0, 0],
  }))
  artifact.createdNames = entries.map(({ shape }) => shape.name ?? shape.kind)
  return true
}

function stage3SupportTop(
  artifact: GeneratedGeometryArtifact,
  support: { shape: Record<string, unknown>; index: number } | undefined,
): number {
  if (!support) return 1
  const position = stage3ShapePosition(artifact, support.shape, support.index)
  return position[1] + stage3ShapeHalfHeight(support.shape)
}

function findStage3MainSpan(artifact: GeneratedGeometryArtifact) {
  return (
    findStage3ShapeWithIndex(artifact, /main_jib|jib_arm|jib_boom|boom/, /counter/) ??
    findStage3ShapeWithIndex(artifact, /main_girder|bridge_girder|girder|beam/, /counter/)
  )
}

function stage3LiftingAnchorFrame(artifact: GeneratedGeometryArtifact, kind: Stage3LiftingKind) {
  const support = findStage3ShapeWithIndex(
    artifact,
    /tower_mast|tower_body|tower_column|mast|support_column|support_leg|support|leg|column/,
    /guard|rail|stair/,
  )
  const mainSpan = findStage3MainSpan(artifact)
  const counterSpan = findStage3ShapeWithIndex(artifact, /counter_jib|counter_boom|balance_arm/)
  const supportPosition: [number, number, number] = support
    ? stage3ShapePosition(artifact, support.shape, support.index)
    : [0, 0, 0]
  const supportTop = stage3SupportTop(artifact, support)
  const mainPosition: [number, number, number] = mainSpan
    ? stage3ShapePosition(artifact, mainSpan.shape, mainSpan.index)
    : [supportPosition[0] + 2.8, supportTop + 0.75, supportPosition[2]]
  const mainLength = mainSpan
    ? Math.max(shapeSpan(mainSpan.shape, 0), shapeSpan(mainSpan.shape, 2), 1)
    : 7.5
  const direction = mainPosition[0] >= supportPosition[0] ? 1 : -1
  const jibY = Math.max(mainPosition[1], supportTop + (kind === 'tower' ? 0.65 : 0.35))
  const trolleyX = mainPosition[0] + direction * mainLength * 0.22
  const trolleyZ = mainPosition[2]
  return {
    kind,
    support,
    mainSpan,
    counterSpan,
    supportPosition: supportPosition as [number, number, number],
    supportTop,
    mainPosition: mainPosition as [number, number, number],
    mainLength,
    direction,
    jibY,
    trolleyPosition: [trolleyX, jibY - 0.18, trolleyZ] as [number, number, number],
  }
}

function setStage3ShapeHeight(shape: Record<string, unknown>, height: number) {
  shape.height = Math.max(0.01, height)
}

function addLiftingRequiredRoleScaffold(
  artifact: GeneratedGeometryArtifact,
  requiredRole: string,
  kind: Stage3LiftingKind = 'generic',
): boolean {
  const shapes = artifact.shapes as unknown as Record<string, unknown>[]
  const roleAlreadyPresent = /pendant/.test(requiredRole)
    ? stage3RoleFamilyPresent(shapes, requiredRole)
    : stage3RolePresent(shapes, requiredRole) || stage3RoleFamilyPresent(shapes, requiredRole)
  if (roleAlreadyPresent) {
    return false
  }
  const frame = stage3LiftingAnchorFrame(artifact, kind)
  const top = frame.supportTop
  const spanY = frame.jibY
  const [trolleyX, trolleyY, trolleyZ] = frame.trolleyPosition

  if (/slew|slewing|platform|turntable/.test(requiredRole)) {
    addStage3Shape(
      artifact,
      {
        semanticRole: requiredRole,
        length: 1.8,
        width: 1.6,
        height: 0.3,
        color: '#d97706',
      },
      [frame.supportPosition[0], top + 0.2, frame.supportPosition[2]],
    )
    return true
  }
  if (/tower.*peak|apex|peak/.test(requiredRole)) {
    addStage3Shape(
      artifact,
      {
        semanticRole: requiredRole,
        length: 0.28,
        width: 0.28,
        height: 0.9,
        color: '#facc15',
      },
      [frame.supportPosition[0], spanY + 0.55, frame.supportPosition[2]],
    )
    return true
  }
  if (/cabin|cab|operator|driver/.test(requiredRole)) {
    addStage3Shape(
      artifact,
      {
        semanticRole: requiredRole,
        length: 0.9,
        width: 0.8,
        height: 0.65,
        color: '#facc15',
      },
      [frame.supportPosition[0] + 0.65, top + 0.55, frame.supportPosition[2] + 0.35],
    )
    return true
  }
  if (/counter.*(jib|arm)|balance.*(jib|arm)/.test(requiredRole)) {
    addStage3Shape(
      artifact,
      {
        semanticRole: requiredRole,
        length: 3.2,
        width: 0.28,
        height: 0.28,
        color: '#facc15',
      },
      [frame.supportPosition[0] - frame.direction * 1.9, top + 0.75, frame.supportPosition[2]],
    )
    return true
  }
  if (/counter.*weight|ballast|weight/.test(requiredRole)) {
    addStage3Shape(
      artifact,
      {
        semanticRole: requiredRole,
        length: 0.9,
        width: 0.9,
        height: 0.7,
        color: '#6b7280',
      },
      [frame.supportPosition[0] - frame.direction * 3.4, top + 0.45, frame.supportPosition[2]],
    )
    return true
  }
  if (/pendant/.test(requiredRole)) {
    addStage3Shape(
      artifact,
      {
        kind: 'cylinder',
        axis: 'y',
        semanticRole: requiredRole,
        name: 'semantic tower crane pendant cable',
        radius: 0.025,
        height: Math.max(frame.mainLength * 0.55, 1.2),
        rotation: [0, 0, -0.72 * frame.direction],
        color: '#111827',
      },
      [
        frame.supportPosition[0] + frame.direction * frame.mainLength * 0.28,
        spanY + 0.28,
        frame.supportPosition[2],
      ],
    )
    return true
  }
  if (/jib|boom|girder|beam|arm/.test(requiredRole)) {
    addStage3Shape(
      artifact,
      {
        semanticRole: requiredRole,
        length: 7.5,
        width: 0.26,
        height: 0.26,
        color: '#facc15',
      },
      [frame.supportPosition[0] + frame.direction * 2.8, top + 0.75, frame.supportPosition[2]],
    )
    return true
  }
  if (/trolley|carriage/.test(requiredRole)) {
    addStage3Shape(
      artifact,
      {
        semanticRole: requiredRole,
        length: 0.75,
        width: 0.5,
        height: 0.35,
        color: '#374151',
      },
      [trolleyX, trolleyY, trolleyZ],
    )
    return true
  }
  if (/wire.*rope|rope|cable/.test(requiredRole)) {
    addStage3Shape(
      artifact,
      {
        kind: 'cylinder',
        axis: 'y',
        semanticRole: requiredRole,
        name: 'semantic vertical wire rope',
        radius: 0.025,
        height: 1.05,
        color: '#111827',
      },
      [trolleyX, trolleyY - 0.65, trolleyZ],
    )
    return true
  }
  if (/hook|load|suspended/.test(requiredRole)) {
    addStage3Shape(
      artifact,
      {
        semanticRole: requiredRole,
        length: 0.3,
        width: 0.18,
        height: 0.45,
        color: '#111827',
      },
      [trolleyX, trolleyY - 1.3, trolleyZ],
    )
    return true
  }
  return false
}

function normalizeStage3LiftingTopology(
  artifact: GeneratedGeometryArtifact,
  kind: Stage3LiftingKind,
): boolean {
  let changed = false
  const frame = stage3LiftingAnchorFrame(artifact, kind)
  const mainSpan = frame.mainSpan
  if (mainSpan) {
    const current = stage3ShapePosition(artifact, mainSpan.shape, mainSpan.index)
    const targetY = Math.max(current[1], frame.supportTop + (kind === 'tower' ? 0.65 : 0.35))
    if (Math.abs(current[1] - targetY) > 0.01) {
      setStage3ShapePosition(artifact, mainSpan.shape, mainSpan.index, [
        current[0],
        targetY,
        current[2],
      ])
      changed = true
    }
  }

  const peak = findStage3ShapeWithIndex(artifact, /tower_peak|apex|peak|tower_cap/)
  if (kind === 'tower' && peak) {
    const target: [number, number, number] = [
      frame.supportPosition[0],
      frame.jibY + Math.max(stage3ShapeHalfHeight(peak.shape), 0.35) + 0.12,
      frame.supportPosition[2],
    ]
    const current = stage3ShapePosition(artifact, peak.shape, peak.index)
    if (
      Math.abs(current[0] - target[0]) > 0.01 ||
      Math.abs(current[1] - target[1]) > 0.01 ||
      Math.abs(current[2] - target[2]) > 0.01
    ) {
      setStage3ShapePosition(artifact, peak.shape, peak.index, target)
      changed = true
    }
  }

  const trolley = findStage3ShapeWithIndex(artifact, /trolley|carriage/, /hook|load|suspended/)
  if (trolley) {
    const current = stage3ShapePosition(artifact, trolley.shape, trolley.index)
    const target = frame.trolleyPosition
    if (
      Math.abs(current[0] - target[0]) > 0.01 ||
      Math.abs(current[1] - target[1]) > 0.01 ||
      Math.abs(current[2] - target[2]) > 0.01
    ) {
      setStage3ShapePosition(artifact, trolley.shape, trolley.index, target)
      changed = true
    }
  }

  const nextTrolley =
    trolley ?? findStage3ShapeWithIndex(artifact, /trolley|carriage/, /hook|load|suspended/)
  const rope = findStage3ShapeWithIndex(artifact, /wire_rope|rope|hoist_cable|cable/, /pendant/)
  const hook = findStage3ShapeWithIndex(artifact, /hook_block|hook|suspended|load/)
  const anchor = nextTrolley
    ? stage3ShapePosition(artifact, nextTrolley.shape, nextTrolley.index)
    : frame.trolleyPosition
  if (hook) {
    const hookHalf = stage3ShapeHalfHeight(hook.shape)
    const target: [number, number, number] = [
      anchor[0],
      anchor[1] - Math.max(0.9, hookHalf + 0.55),
      anchor[2],
    ]
    const current = stage3ShapePosition(artifact, hook.shape, hook.index)
    if (
      Math.abs(current[0] - target[0]) > 0.01 ||
      Math.abs(current[1] - target[1]) > 0.01 ||
      Math.abs(current[2] - target[2]) > 0.01
    ) {
      setStage3ShapePosition(artifact, hook.shape, hook.index, target)
      changed = true
    }
  }
  if (rope && hook) {
    const hookPosition = stage3ShapePosition(artifact, hook.shape, hook.index)
    const ropeHeight = Math.max(
      anchor[1] - hookPosition[1] - stage3ShapeHalfHeight(hook.shape),
      0.35,
    )
    setStage3ShapeHeight(rope.shape, ropeHeight)
    setStage3ShapePosition(artifact, rope.shape, rope.index, [
      anchor[0],
      hookPosition[1] + stage3ShapeHalfHeight(hook.shape) + ropeHeight / 2,
      anchor[2],
    ])
    changed = true
  }

  const counterweight = findStage3ShapeWithIndex(artifact, /counterweight|counter_weight|ballast/)
  const counterSpan = frame.counterSpan
  if (counterweight && counterSpan) {
    const counterPosition = stage3ShapePosition(artifact, counterSpan.shape, counterSpan.index)
    const counterLength = Math.max(
      shapeSpan(counterSpan.shape, 0),
      shapeSpan(counterSpan.shape, 2),
      1,
    )
    const target: [number, number, number] = [
      counterPosition[0] - frame.direction * counterLength * 0.38,
      counterPosition[1] +
        stage3ShapeHalfHeight(counterSpan.shape) +
        stage3ShapeHalfHeight(counterweight.shape) +
        0.06,
      counterPosition[2],
    ]
    setStage3ShapePosition(artifact, counterweight.shape, counterweight.index, target)
    changed = true
  }
  return changed
}

function ensureStage3TowerPendantCable(artifact: GeneratedGeometryArtifact): boolean {
  if (
    stage3RoleFamilyPresent(
      artifact.shapes as unknown as Record<string, unknown>[],
      'pendant_cable',
    )
  ) {
    return false
  }
  const frame = stage3LiftingAnchorFrame(artifact, 'tower')
  addStage3Shape(
    artifact,
    {
      kind: 'cylinder',
      axis: 'y',
      semanticRole: 'pendant_cable',
      name: 'semantic tower crane pendant cable',
      radius: 0.025,
      height: Math.max(frame.mainLength * 0.55, 1.2),
      rotation: [0, 0, -0.72 * frame.direction],
      color: '#111827',
    },
    [
      frame.supportPosition[0] + frame.direction * frame.mainLength * 0.28,
      frame.jibY + 0.28,
      frame.supportPosition[2],
    ],
  )
  return true
}

export function repairStage3SemanticArtifact(
  userPrompt: string,
  artifact: GeneratedGeometryArtifact,
): Stage3SemanticRepairResult | undefined {
  const intentText = stage3CombinedIntentText(userPrompt, artifact)
  const liftingIntent = isStage3LiftingIntent(intentText)
  const outdoorAcIntent = isStage3OutdoorAcIntent(intentText)
  if (!liftingIntent && !outdoorAcIntent) return undefined

  let changed = false
  const unrelatedPattern = liftingIntent
    ? /aircraft|fuselage|(?:^|[\s_])wing(?:[\s_]|$)|wing_panel|stabilizer|nacelle|landing_gear|cockpit|cabin_window/
    : outdoorAcIntent
      ? /vertical_pole|circular_base|fan_base|fan_pole|pedestal|support_bracket|fan_yoke/
      : undefined
  const acBody = outdoorAcIntent
    ? findStage3ShapeWithIndex(
        artifact,
        /condenser_body|main_body|machine_body|body|housing|casing|enclosure|shell/,
      )
    : undefined
  const acBodyTop = acBody ? stage3ShapeTopY(artifact, acBody.shape, acBody.index) : undefined
  const isFloatingAcFanPart = (shape: Record<string, unknown>, index: number) => {
    if (acBodyTop == null) return false
    const shapeText = stage3ShapeText(shape)
    if (!/motor_housing|protective_grill/.test(shapeText)) return false
    if (/front_grille|fan_guard|fan_grill/.test(shapeText)) return false
    return stage3ShapeBottomY(artifact, shape, index) > acBodyTop + 0.05
  }
  const keptShapeEntries = artifact.shapes
    .map((shape, index) => ({ shape, transform: artifact.transforms[index], index }))
    .filter(({ shape, index }) => {
      const shapeText = stage3ShapeText(shape as unknown as Record<string, unknown>)
      if (unrelatedPattern?.test(shapeText) ?? false) return false
      return !isFloatingAcFanPart(shape as unknown as Record<string, unknown>, index)
    })
  if (keptShapeEntries.length !== artifact.shapes.length && keptShapeEntries.length >= 2) {
    changed = true
  }

  const repaired: GeneratedGeometryArtifact = {
    ...artifact,
    shapes: keptShapeEntries.map(({ shape }) => ({ ...shape })),
    transforms: keptShapeEntries.map(({ shape, transform }) => ({
      position: transform?.position ?? shape.position,
      rotation: transform?.rotation ?? shape.rotation ?? [0, 0, 0],
    })),
    createdNames: keptShapeEntries.map(({ shape }) => shape.name ?? shape.kind),
  }

  if (liftingIntent) {
    const liftingKind = inferStage3LiftingKind(intentText) ?? 'generic'
    const requiredRoles = Array.from(
      new Set([...stage3RequiredRoles(repaired), ...stage3LiftingRequiredRoles(liftingKind)]),
    )
    changed = removeDuplicateStage3RoleFamilies(repaired, requiredRoles) || changed
    for (const requiredRole of requiredRoles) {
      changed = addLiftingRequiredRoleScaffold(repaired, requiredRole, liftingKind) || changed
    }
    changed = normalizeStage3LiftingTopology(repaired, liftingKind) || changed
    if (liftingKind === 'tower') {
      changed = ensureStage3TowerPendantCable(repaired) || changed
    }
  }

  if (outdoorAcIntent) {
    const body = findStage3ShapeWithIndex(
      repaired,
      /condenser_body|main_body|machine_body|body|housing|casing|enclosure|shell/,
    )
    const foot = findStage3ShapeWithIndex(
      repaired,
      /support_feet|support_foot|feet|foot|base_leg|leg/,
    )
    if (body && foot) {
      changed =
        stage3MoveBelow(repaired, foot.shape, foot.index, body.shape, body.index, 0.02) || changed
    }
  }

  if (!changed) return undefined
  repaired.shapeDetails = compactStage3ArtifactDetails(repaired)
  repaired.visualQualitySummary = [
    repaired.visualQualitySummary,
    'Stage3 semantic repair normalized unrelated-family drift and vertical topology.',
  ]
    .filter(Boolean)
    .join('\n')
  return { artifact: repaired, label: 'generic semantic topology repair' }
}

function cloneStage3Artifact(artifact: GeneratedGeometryArtifact): GeneratedGeometryArtifact {
  return {
    ...artifact,
    shapes: artifact.shapes.map((shape) => ({ ...shape })),
    transforms: artifact.shapes.map((shape, index) => ({
      position: artifact.transforms[index]?.position ?? shape.position ?? [0, 0, 0],
      rotation: artifact.transforms[index]?.rotation ?? shape.rotation ?? [0, 0, 0],
    })),
    createdNames: [...artifact.createdNames],
  }
}

function stage3ColorOf(shape: Record<string, unknown>, fallback: string): string {
  const material = shape.material
  if (typeof shape.color === 'string') return shape.color
  if (typeof shape.primaryColor === 'string') return shape.primaryColor
  if (typeof shape.metalColor === 'string') return shape.metalColor
  if (
    typeof material === 'object' &&
    material !== null &&
    'properties' in material &&
    typeof (material as { properties?: unknown }).properties === 'object' &&
    (material as { properties?: { color?: unknown } }).properties?.color
  ) {
    const color = (material as { properties?: { color?: unknown } }).properties?.color
    if (typeof color === 'string') return color
  }
  return fallback
}

function markStage3ShapeTransparent(shape: Record<string, unknown>, opacity: number) {
  const color = stage3ColorOf(shape, '#facc15')
  shape.material = {
    properties: {
      color,
      roughness: 0.62,
      metalness: 0.08,
      opacity,
      transparent: true,
    },
  }
}

function hasStage3RoleLike(artifact: GeneratedGeometryArtifact, pattern: RegExp): boolean {
  return (artifact.shapes as unknown as Record<string, unknown>[]).some((shape) =>
    pattern.test(stage3ShapeText(shape)),
  )
}

function addStage3TowerFramePolish(
  artifact: GeneratedGeometryArtifact,
  support: { shape: Record<string, unknown>; index: number },
): boolean {
  if (hasStage3RoleLike(artifact, /lattice_column|lattice_rung|tower_column/)) return false
  const position = stage3ShapePosition(artifact, support.shape, support.index)
  const height = Math.max(shapeSpan(support.shape, 1), 1)
  const xSpan = Math.max(shapeSpan(support.shape, 0), 0.7)
  const zSpan = Math.max(shapeSpan(support.shape, 2), 0.7)
  if (height < Math.max(xSpan, zSpan) * 1.8) return false

  markStage3ShapeTransparent(support.shape, 0.18)
  const color = stage3ColorOf(support.shape, '#d4a017')
  const columnSize = Math.min(Math.max(Math.min(xSpan, zSpan) * 0.08, 0.045), 0.12)
  for (const xSign of [-1, 1]) {
    for (const zSign of [-1, 1]) {
      addStage3Shape(
        artifact,
        {
          semanticRole: 'lattice_column',
          name: 'semantic lattice tower column',
          length: columnSize,
          width: columnSize,
          height,
          color,
        },
        [position[0] + (xSign * xSpan) / 2, position[1], position[2] + (zSign * zSpan) / 2],
      )
    }
  }

  const levels = 4
  for (let level = 1; level < levels; level += 1) {
    const y = position[1] - height / 2 + (height * level) / levels
    for (const zSign of [-1, 1]) {
      addStage3Shape(
        artifact,
        {
          semanticRole: 'lattice_rung',
          name: 'semantic lattice horizontal rung',
          length: xSpan,
          width: columnSize * 0.65,
          height: columnSize * 0.65,
          color,
        },
        [position[0], y, position[2] + (zSign * zSpan) / 2],
      )
    }
    for (const xSign of [-1, 1]) {
      addStage3Shape(
        artifact,
        {
          semanticRole: 'lattice_rung',
          name: 'semantic lattice transverse rung',
          length: columnSize * 0.65,
          width: zSpan,
          height: columnSize * 0.65,
          color,
        },
        [position[0] + (xSign * xSpan) / 2, y, position[2]],
      )
    }
  }
  return true
}

function addStage3SpanTrussPolish(
  artifact: GeneratedGeometryArtifact,
  span: { shape: Record<string, unknown>; index: number },
): boolean {
  const text = stage3ShapeText(span.shape)
  if (!/girder|main_girder|bridge_girder|jib|counter_jib|boom/.test(text)) return false
  const position = stage3ShapePosition(artifact, span.shape, span.index)
  const length = Math.max(shapeSpan(span.shape, 0), shapeSpan(span.shape, 2))
  if (
    length < 2.2 ||
    hasStage3RoleLike(artifact, new RegExp(`${text.split(' ')[0]}.*truss_chord`))
  ) {
    return false
  }

  const color = stage3ColorOf(span.shape, '#facc15')
  span.shape.height = Math.min(Math.max(shapeSpan(span.shape, 1) * 0.45, 0.08), 0.18)
  span.shape.width = Math.min(Math.max(shapeSpan(span.shape, 2) * 0.55, 0.08), 0.22)
  const chordRole = `${normalizeStage3Role(span.shape.semanticRole) || 'span'}_truss_chord`
  const chordHeight = 0.055
  const verticalGap = Math.max(shapeSpan(span.shape, 1), 0.24)
  addStage3Shape(
    artifact,
    {
      semanticRole: chordRole,
      name: 'semantic truss upper chord',
      length,
      width: 0.06,
      height: chordHeight,
      color,
    },
    [position[0], position[1] + verticalGap / 2, position[2]],
  )
  addStage3Shape(
    artifact,
    {
      semanticRole: chordRole,
      name: 'semantic truss lower chord',
      length,
      width: 0.06,
      height: chordHeight,
      color,
    },
    [position[0], position[1] - verticalGap / 2, position[2]],
  )
  for (const offset of [-0.35, 0, 0.35]) {
    addStage3Shape(
      artifact,
      {
        semanticRole: `${normalizeStage3Role(span.shape.semanticRole) || 'span'}_truss_web`,
        name: 'semantic truss web post',
        length: 0.05,
        width: 0.05,
        height: verticalGap,
        color,
      },
      [position[0] + offset * length, position[1], position[2]],
    )
  }
  return true
}

function polishStage3LiftingArtifact(artifact: GeneratedGeometryArtifact): boolean {
  if (artifact.shapes.length > 70) return false
  let changed = false
  const support = findStage3ShapeWithIndex(
    artifact,
    /tower_mast|tower_body|tower_column|mast|support_column|support|leg|column/,
    /guard|rail|stair/,
  )
  if (support) changed = addStage3TowerFramePolish(artifact, support) || changed

  const spanEntries = (artifact.shapes as unknown as Record<string, unknown>[])
    .map((shape, index) => ({ shape, index }))
    .filter(({ shape }) =>
      /girder|main_girder|bridge_girder|jib|counter_jib|boom/.test(stage3ShapeText(shape)),
    )
    .slice(0, 3)
  for (const span of spanEntries) {
    changed = addStage3SpanTrussPolish(artifact, span) || changed
  }

  const trolley = findStage3ShapeWithIndex(artifact, /trolley|carriage/, /hook|load|suspended/)
  const hook = findStage3ShapeWithIndex(artifact, /hook|suspended|load/)
  const rope = findStage3ShapeWithIndex(artifact, /wire_rope|rope|cable/)
  if ((trolley || hook) && hook && !rope) {
    const parent = trolley ?? findStage3ShapeWithIndex(artifact, /girder|jib|boom|bridge_girder/)
    if (parent) {
      const parentPosition = stage3ShapePosition(artifact, parent.shape, parent.index)
      const hookPosition = stage3ShapePosition(artifact, hook.shape, hook.index)
      const ropeHeight = Math.max(
        parentPosition[1] - hookPosition[1] - stage3ShapeHalfHeight(hook.shape),
        0.4,
      )
      addStage3Shape(
        artifact,
        {
          kind: 'cylinder',
          axis: 'y',
          semanticRole: 'wire_rope',
          name: 'semantic vertical wire rope',
          radius: 0.025,
          height: ropeHeight,
          color: '#111827',
        },
        [
          hookPosition[0],
          hookPosition[1] + ropeHeight / 2 + stage3ShapeHalfHeight(hook.shape),
          hookPosition[2],
        ],
      )
      changed = true
    }
  }
  return changed
}

function polishStage3OutdoorEnclosureArtifact(artifact: GeneratedGeometryArtifact): boolean {
  const body = findStage3ShapeWithIndex(
    artifact,
    /condenser_body|main_body|machine_body|body|housing|casing|enclosure|shell/,
  )
  if (!body) return false
  let changed = false
  const bodyPosition = stage3ShapePosition(artifact, body.shape, body.index)
  const bodyHalfDepth = Math.max(shapeSpan(body.shape, 2) / 2, 0.16)
  const bodyHalfLength = Math.max(shapeSpan(body.shape, 0) / 2, 0.24)
  const bodyBottom = stage3ShapeBottomY(artifact, body.shape, body.index)
  const entriesBeforeCull = artifact.shapes.map((shape, index) => ({
    shape,
    index,
    text: stage3ShapeText(shape as unknown as Record<string, unknown>),
  }))
  const hasSpecificFaceFanOrVent = entriesBeforeCull.some(
    ({ text }) =>
      /front.*(grille|vent|fan)|fan_guard|fan_grill|fan_impeller|radial_blades|cooling_fan|front_vent/.test(
        text,
      ) && !/^protective_grill$/.test(normalizeStage3Role(text)),
  )
  if (hasSpecificFaceFanOrVent) {
    const keptShapeEntries = entriesBeforeCull
      .map(({ shape, index, text }) => ({ shape, transform: artifact.transforms[index], text }))
      .filter(({ text }) => {
        const genericProtectiveGrill =
          /protective_grill/.test(text) &&
          !/front.*(grille|fan)|fan_guard|fan_grill|fan_impeller|cooling_fan/.test(text)
        return !genericProtectiveGrill
      })
    if (keptShapeEntries.length !== artifact.shapes.length) {
      artifact.shapes = keptShapeEntries.map(({ shape }) => shape)
      artifact.transforms = keptShapeEntries.map(
        ({ transform, shape }) =>
          transform ?? {
            position: stage3ShapePosition(artifact, shape as unknown as Record<string, unknown>, 0),
            rotation: [0, 0, 0],
          },
      )
      changed = true
    }
  }
  const entries = (artifact.shapes as unknown as Record<string, unknown>[]).map((shape, index) => ({
    shape,
    index,
    text: stage3ShapeText(shape),
  }))
  const faceMountedEntries = entries.filter(({ text }) =>
    /front.*(grille|vent|fan)|fan_guard|fan_grill|fan_impeller|radial_blades|protective_grill/.test(
      text,
    ),
  )
  if (faceMountedEntries.length > 0) {
    const centers = faceMountedEntries.map(({ shape, index }) =>
      stage3ShapePosition(artifact, shape, index),
    )
    const centerX = centers.reduce((sum, position) => sum + position[0], 0) / centers.length
    const centerY = centers.reduce((sum, position) => sum + position[1], 0) / centers.length
    for (const { shape, index } of faceMountedEntries) {
      const current = stage3ShapePosition(artifact, shape, index)
      const next: [number, number, number] = [
        bodyPosition[0] + (current[0] - centerX),
        bodyPosition[1] + (current[1] - centerY),
        bodyPosition[2] + bodyHalfDepth + 0.04,
      ]
      setStage3ShapePosition(artifact, shape, index, next)
      changed = true
    }
  }

  for (const { shape, index, text } of entries) {
    if (/side.*(vent|radiator|heat|louver|grille)/.test(text)) {
      const current = stage3ShapePosition(artifact, shape, index)
      const next: [number, number, number] = [
        bodyPosition[0] - bodyHalfLength - 0.035,
        current[1],
        bodyPosition[2],
      ]
      setStage3ShapePosition(artifact, shape, index, next)
      changed = true
    } else if (/support_feet|support_foot|feet|foot|base_leg/.test(text)) {
      const current = stage3ShapePosition(artifact, shape, index)
      const next: [number, number, number] = [
        current[0],
        bodyBottom - stage3ShapeHalfHeight(shape) - 0.025,
        current[2],
      ]
      setStage3ShapePosition(artifact, shape, index, next)
      changed = true
    }
  }
  return changed
}

export function polishStage3SemanticArtifact(
  userPrompt: string,
  artifact: GeneratedGeometryArtifact,
): Stage3SemanticRepairResult | undefined {
  const intentText = stage3CombinedIntentText(userPrompt, artifact)
  const liftingIntent = isStage3LiftingIntent(intentText)
  const outdoorAcIntent = isStage3OutdoorAcIntent(intentText)
  if (!liftingIntent && !outdoorAcIntent) return undefined

  const polished = cloneStage3Artifact(artifact)
  let changed = false
  if (liftingIntent) changed = polishStage3LiftingArtifact(polished) || changed
  if (outdoorAcIntent) changed = polishStage3OutdoorEnclosureArtifact(polished) || changed
  if (!changed) return undefined

  polished.shapeDetails = compactStage3ArtifactDetails(polished)
  polished.visualQualitySummary = [
    polished.visualQualitySummary,
    'Stage3 semantic polish added frame/truss or face-anchored visual structure.',
  ]
    .filter(Boolean)
    .join('\n')
  return { artifact: polished, label: 'generic semantic visual polish' }
}

export function stage3QualityReview(
  userPrompt: string,
  artifact: GeneratedGeometryArtifact,
): Stage3QualityReview {
  const text = userPrompt.toLowerCase()
  const roles = new Set(artifact.shapes.map((shape) => shape.semanticRole).filter(Boolean))
  const sourceKinds = new Set(artifact.shapes.map((shape) => shape.sourcePartKind).filter(Boolean))
  const issues: string[] = []
  const warnings: string[] = []
  let repairPlan: Stage3RepairPlan | undefined
  let requiresModelRepair = false

  const hasAllRoles = (requiredRoles: string[]) => {
    const missing = requiredRoles.filter((role) => !roles.has(role))
    for (const role of missing) issues.push(`Stage3 missing required role "${role}".`)
    return missing.length === 0
  }
  const hasForbiddenRole = (forbiddenRoles: string[]) => {
    const found = forbiddenRoles.filter((role) => roles.has(role))
    for (const role of found) issues.push(`Stage3 found unrelated role "${role}".`)
    return found.length > 0
  }

  const explicitRequiredRoles = stage3RequiredRoles(artifact)
  const missingExplicitRoles = explicitRequiredRoles.filter(
    (role) => !stage3RolePresent(artifact.shapes as unknown as Record<string, unknown>[], role),
  )
  for (const role of missingExplicitRoles) {
    issues.push(`Stage3 missing declared required role "${role}".`)
  }
  if (missingExplicitRoles.length > 0) requiresModelRepair = true

  const promptAndArtifactText = [
    text,
    artifact.geometryBrief?.category,
    artifact.geometryBrief?.semanticRoles?.join(' '),
    artifact.geometryBrief?.requiredRoles?.join(' '),
    artifact.semanticSummary,
    artifact.visualQualitySummary,
    artifact.shapeDetails,
    artifact.shapes
      .map((shape) => [shape.name, shape.semanticRole, shape.sourcePartKind, shape.kind].join(' '))
      .join(' '),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  const roundContainerIntentText = [text, artifact.geometryBrief?.category]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  const roundContainerIntent =
    /(\u6696\u6c34\u74f6|\u5f00\u6c34\u74f6|\u70ed\u6c34\u74f6|\u4fdd\u6e29\u74f6|\u74f6|\u5706\u7b52|\u676f\u5b50|\u6c34\u676f|\u676f|bottle|flask|thermos|vacuum[_\s-]?flask|hot[_\s-]?water[_\s-]?bottle|cup|mug|(?:tin|soda|beverage)[_\s-]?can|canister|jar|round[_\s-]?container)/i.test(
      roundContainerIntentText,
    ) &&
    !/(\u50a8\u7f50|\u538b\u529b\u7f50|\u538b\u529b\u5bb9\u5668|storage[_\s-]?tank|pressure[_\s-]?(tank|vessel)|reactor|agitator|stirred)/i.test(
      text,
    ) &&
    !/(\u9f99\u95e8\u540a|\u5854\u540a|\u8d77\u91cd|\u540a\u8f66|\u884c\u8f66|gantry[_\s-]?crane|tower[_\s-]?crane|portal[_\s-]?crane|overhead[_\s-]?crane|crane|hoist)/i.test(
      text,
    )
  if (roundContainerIntent) {
    const hasRoundMainBody = artifact.shapes.some(
      (shape) =>
        /body|shell|vessel|container|bottle|flask|cup|(?:tin|soda|beverage)[_\s-]?can|canister|jar|main/i.test(
          `${shape.semanticRole ?? ''} ${shape.sourcePartKind ?? ''} ${shape.name ?? ''}`,
        ) && /^(cylinder|hollow-cylinder|capsule|lathe|sphere|ellipsoid|sweep)$/.test(shape.kind),
    )
    const hasBoxMainBody = artifact.shapes.some(
      (shape) =>
        shape.kind === 'box' &&
        /generic_body|body|shell|container|bottle|flask|cup|(?:tin|soda|beverage)[_\s-]?can|canister|jar|main/i.test(
          `${shape.semanticRole ?? ''} ${shape.sourcePartKind ?? ''} ${shape.name ?? ''}`,
        ),
    )
    if (!hasRoundMainBody || hasBoxMainBody) {
      issues.push(
        'Stage3 round container main body must use round primitive geometry, not generic_body box.',
      )
      repairPlan = {
        label: 'canonical round container primitive',
        tool: 'compose_primitive',
        args: {
          name: 'round container',
          geometryBrief:
            'round container with cylindrical body, neck/rim, cap, and optional side handle',
          shapes: [
            {
              kind: 'cylinder',
              name: 'round cylindrical body',
              semanticRole: 'bottle_body',
              position: [0, 0.15, 0],
              axis: 'y',
              radius: 0.065,
              height: 0.26,
              material: {
                properties: { color: '#c0c0c0', roughness: 0.32, metalness: 0.7 },
              },
            },
            {
              kind: 'cylinder',
              name: 'narrow neck',
              semanticRole: 'neck_rim',
              position: [0, 0.292, 0],
              axis: 'y',
              radius: 0.032,
              height: 0.024,
              material: {
                properties: { color: '#d4d4d4', roughness: 0.28, metalness: 0.75 },
              },
            },
            {
              kind: 'cylinder',
              name: 'top cap',
              semanticRole: 'bottle_cap',
              position: [0, 0.325, 0],
              axis: 'y',
              radius: 0.04,
              height: 0.035,
              material: {
                properties: { color: '#ef4444', roughness: 0.55, metalness: 0.05 },
              },
            },
            {
              kind: 'capsule',
              name: 'side handle',
              semanticRole: 'side_handle',
              position: [0.085, 0.18, 0],
              axis: 'y',
              radius: 0.012,
              height: 0.16,
              material: {
                properties: { color: '#111827', roughness: 0.6, metalness: 0.1 },
              },
            },
          ],
        },
      }
    }
  }

  const tankIntent =
    /(\u5367\u5f0f|\u50a8\u7f50|\u538b\u529b\u7f50|\u538b\u529b\u5bb9\u5668|storage[_\s-]?tank|pressure[_\s-]?(tank|vessel)|horizontal[_\s-]?(tank|vessel))/i.test(
      text,
    ) && !/(\u53cd\u5e94\u91dc|\u53cd\u5e94\u5668|reactor|agitator|stirred)/i.test(text)
  if (tankIntent) {
    const required = [
      'vessel_shell',
      'vessel_head',
      'top_nozzle',
      'manway_flange',
      'saddle_support',
    ]
    const complete = hasAllRoles(required)
    const unrelated = hasForbiddenRole([
      'fan_blades',
      'protective_grill',
      'machine_body',
      'machine_enclosure',
      'auger_screw',
      'bicycle_tire',
    ])
    if (!sourceKinds.has('cylindrical_tank')) {
      issues.push('Stage3 pressure tank must be backed by cylindrical_tank.')
    }
    if (!complete || unrelated || !sourceKinds.has('cylindrical_tank')) {
      repairPlan = {
        label: 'canonical horizontal pressure tank',
        tool: 'compose_parts',
        args: {
          name: 'horizontal pressure storage tank',
          family: 'generic',
          parts: [
            {
              kind: 'cylindrical_tank',
              semanticRole: 'vessel_shell',
              axis: 'x',
              length: 2.2,
              radius: 0.34,
            },
          ],
        },
      }
    }
  }

  const platformIntent =
    !/(\u673a\u5668\u81c2|\u673a\u68b0\u81c2|\u516d\u8f74|\u4e03\u8f74|\u56db\u8f74|robot[_\s-]?arm|industrial[_\s-]?robot|six[_\s-]?axis|6[_\s-]?axis|seven[_\s-]?axis|7[_\s-]?axis|four[_\s-]?axis|4[_\s-]?axis|fanuc|kuka|abb)/i.test(
      text,
    ) &&
    /(\u68c0\u4fee\u5e73\u53f0|\u5de5\u4e1a\u5e73\u53f0|\u722c\u68af|access[_\s-]?platform|inspection[_\s-]?platform|platform[_\s-]?ladder)/i.test(
      text,
    ) &&
    !/(\u50a8\u7f50|\u538b\u529b\u7f50|\u538b\u529b\u5bb9\u5668|\u53cd\u5e94\u91dc|\u53cd\u5e94\u5668|storage[_\s-]?tank|pressure[_\s-]?(tank|vessel)|reactor|agitator|stirred)/i.test(
      text,
    )
  if (platformIntent) {
    const complete = hasAllRoles([
      'access_platform',
      'platform_post',
      'guard_rail',
      'ladder_side_rail',
      'ladder_rung',
    ])
    const unrelated = hasForbiddenRole([
      'bicycle_tire',
      'vehicle_tire',
      'vessel_shell',
      'machine_body',
      'fan_blades',
    ])
    if (!sourceKinds.has('platform_ladder')) {
      issues.push('Stage3 inspection platform must be backed by platform_ladder.')
    }
    if (!complete || unrelated || !sourceKinds.has('platform_ladder')) {
      repairPlan = {
        label: 'canonical industrial platform ladder',
        tool: 'compose_parts',
        args: {
          name: 'industrial inspection platform ladder',
          family: 'generic',
          parts: [
            {
              kind: 'platform_ladder',
              semanticRole: 'access_platform',
              length: 1.2,
              width: 0.7,
              height: 1.6,
              count: 7,
            },
          ],
        },
      }
    }
  }

  const beforeSpatialIssueCount = issues.length
  addLiftingEquipmentSpatialIssues(artifact, text, issues)
  addBoxEnclosureEquipmentIssues(artifact, text, issues)
  if (issues.length > beforeSpatialIssueCount) requiresModelRepair = true

  if (artifact.shapes.length > 70) {
    warnings.push(`Stage3 high shape count (${artifact.shapes.length}); prefer reusable parts.`)
  }
  const score = Math.max(0, Math.min(1, 1 - issues.length * 0.18 - warnings.length * 0.05))
  return {
    passed: issues.length === 0 && score >= 0.75,
    score,
    issues,
    warnings,
    repairPlan,
    requiresModelRepair,
  }
}

async function applyStage3QualityGate(input: {
  runId: string
  userPrompt: string
  artifact: GeneratedGeometryArtifact
  revisionTarget: GeneratedGeometryArtifact | null
  loadedDeviceProfiles: Awaited<ReturnType<typeof loadDeviceProfiles>>
  routeMetrics: PrimitiveRouteMetrics
  signal: AbortSignal
}): Promise<{ artifact?: GeneratedGeometryArtifact; content?: string; accepted: boolean }> {
  const review = stage3QualityReview(input.userPrompt, input.artifact)
  input.routeMetrics.stage3QualityScore = review.score
  input.routeMetrics.stage3Passed = review.passed
  input.routeMetrics.stage3Issues = review.issues
  input.routeMetrics.stage3Warnings = review.warnings
  await appendRunEvent(input.runId, {
    type: 'message',
    message: review.passed ? 'Stage3 quality gate passed' : 'Stage3 quality gate flagged issues',
    data: { stage: 'stage3-quality', review },
  })

  const acceptWithPolish = async (
    candidate: GeneratedGeometryArtifact,
    content?: string,
  ): Promise<{ artifact: GeneratedGeometryArtifact; content?: string; accepted: true }> => {
    const polish = polishStage3SemanticArtifact(input.userPrompt, candidate)
    if (!polish) return { artifact: candidate, content, accepted: true }

    const polishedReview = stage3QualityReview(input.userPrompt, polish.artifact)
    await appendRunEvent(input.runId, {
      type: 'message',
      message: polishedReview.passed
        ? 'Stage3 semantic polish passed'
        : 'Stage3 semantic polish skipped',
      data: {
        stage: 'stage3-quality',
        repairLabel: polish.label,
        review: polishedReview,
        artifact: polish.artifact,
      },
    })
    if (!polishedReview.passed) return { artifact: candidate, content, accepted: true }

    input.routeMetrics.stage3QualityScore = polishedReview.score
    input.routeMetrics.stage3Passed = polishedReview.passed
    input.routeMetrics.stage3Issues = polishedReview.issues
    input.routeMetrics.stage3Warnings = polishedReview.warnings
    return { artifact: polish.artifact, content, accepted: true }
  }

  if (review.passed) return acceptWithPolish(input.artifact)

  const semanticRepair = repairStage3SemanticArtifact(input.userPrompt, input.artifact)
  if (semanticRepair) {
    const repairedReview = stage3QualityReview(input.userPrompt, semanticRepair.artifact)
    input.routeMetrics.stage3RepairApplied = true
    input.routeMetrics.stage3QualityScore = repairedReview.score
    input.routeMetrics.stage3Passed = repairedReview.passed
    input.routeMetrics.stage3Issues = repairedReview.issues
    input.routeMetrics.stage3Warnings = repairedReview.warnings
    await appendRunEvent(input.runId, {
      type: 'message',
      message: repairedReview.passed
        ? 'Stage3 semantic repair passed'
        : 'Stage3 semantic repair still has issues',
      data: {
        stage: 'stage3-quality',
        repairLabel: semanticRepair.label,
        review: repairedReview,
        artifact: semanticRepair.artifact,
      },
    })
    if (repairedReview.passed) {
      return acceptWithPolish(semanticRepair.artifact)
    }
  }

  if (!review.repairPlan) {
    const content = [
      'Stage3 semantic quality gate failed. Nothing was accepted yet.',
      ...review.issues.map((issue) => `- ${issue}`),
      ...review.warnings.map((warning) => `- Warning: ${warning}`),
      review.requiresModelRepair
        ? 'Call one replacement geometry tool. Preserve all declared required semantic roles and repair the listed spatial relationships.'
        : 'Call one replacement geometry tool that satisfies the quality gate.',
    ].join('\n')
    return { content, accepted: false }
  }

  input.routeMetrics.stage3RepairApplied = true
  await appendRunEvent(input.runId, {
    type: 'tool-call',
    message: review.repairPlan.tool,
    data: {
      stage: 'stage3-repair',
      name: review.repairPlan.tool,
      arguments: review.repairPlan.args,
      repairLabel: review.repairPlan.label,
    },
  })
  throwIfAborted(input.signal)
  const repaired = executeTool(
    review.repairPlan.tool,
    review.repairPlan.args,
    input.userPrompt,
    input.revisionTarget,
    null,
    input.loadedDeviceProfiles,
  )
  await appendRunEvent(input.runId, {
    type: 'tool-result',
    message: repaired.content,
    data: {
      stage: 'stage3-repair',
      name: review.repairPlan.tool,
      artifact: repaired.artifact,
      repairLabel: review.repairPlan.label,
    },
  })
  if (!repaired.artifact)
    return { artifact: input.artifact, content: repaired.content, accepted: true }

  const repairedReview = stage3QualityReview(input.userPrompt, repaired.artifact)
  input.routeMetrics.stage3QualityScore = repairedReview.score
  input.routeMetrics.stage3Passed = repairedReview.passed
  input.routeMetrics.stage3Issues = repairedReview.issues
  input.routeMetrics.stage3Warnings = repairedReview.warnings
  await appendRunEvent(input.runId, {
    type: 'message',
    message: repairedReview.passed
      ? 'Stage3 deterministic repair passed'
      : 'Stage3 deterministic repair still has issues',
    data: { stage: 'stage3-quality', review: repairedReview },
  })
  const content = [`Stage3 repaired geometry using ${review.repairPlan.label}.`, repaired.content]
  if (!repairedReview.passed) {
    content.push(
      'Stage3 deterministic repair still failed; call one replacement geometry tool.',
      ...repairedReview.issues.map((issue) => `- ${issue}`),
      ...repairedReview.warnings.map((warning) => `- Warning: ${warning}`),
    )
    return { content: content.join('\n'), accepted: false }
  }
  return acceptWithPolish(repaired.artifact, content.join('\n'))
}

function shouldUseDeterministicProfileRoute(input: {
  profile: DeviceProfileDefinition | undefined
  userPrompt: string
  revisionTarget: GeneratedGeometryArtifact | null
  resourceResolved?: boolean
}) {
  if (!input.profile) return false
  if (input.revisionTarget) return false
  if (isLikelyGeometryRevisionRequest(input.userPrompt, input.revisionTarget)) return false
  if (!input.resourceResolved && !isSafeDeterministicProfileMatch(input.profile, input.userPrompt))
    return false
  return input.profile.status === 'stable'
}

function normalizeProfileMatchText(value: unknown): string {
  return typeof value === 'string'
    ? value
        .toLowerCase()
        .replace(/[_-]+/g, ' ')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : ''
}

function profileMatchLabels(profile: DeviceProfileDefinition): string[] {
  const labels = [profile.id, profile.name, ...profile.aliases]
    .map(normalizeProfileMatchText)
    .filter(Boolean)
  return Array.from(new Set(labels))
}

function deniedProfileTargetSpans(userPrompt: string): string[] {
  const spans: string[] = []
  for (const pattern of NEGATED_TARGET_CLAUSE_PATTERNS) {
    for (const match of userPrompt.matchAll(pattern)) {
      const span = normalizeProfileMatchText(match[1])
      if (span) spans.push(span)
    }
  }
  return spans
}

export function isSafeDeterministicProfileMatch(
  profile: DeviceProfileDefinition,
  userPrompt: string,
): boolean {
  const prompt = normalizeProfileMatchText(userPrompt)
  if (!prompt) return false
  const labels = profileMatchLabels(profile)
  const deniedSpans = deniedProfileTargetSpans(userPrompt)
  if (labels.some((label) => deniedSpans.some((span) => span.includes(label)))) return false

  const id = normalizeProfileMatchText(profile.id)
  const name = normalizeProfileMatchText(profile.name)
  return labels.some((label) => {
    if (!prompt.includes(label)) return false
    const tokenCount = label.split(/\s+/).filter(Boolean).length
    return label === id || label === name || tokenCount >= 2
  })
}

function buildProfileRouteArgs(
  profile: DeviceProfileDefinition,
  userPrompt: string,
): Record<string, unknown> {
  const rawProfile = profile as DeviceProfileDefinition & {
    visualCues?: readonly string[]
    layoutHints?: Record<string, unknown>
  }
  const geometryBrief = [
    `Device profile ${profile.id} (${profile.name}) from ${profile.source}.`,
    profile.sourcePack
      ? `Source pack: ${profile.sourcePack.id}@${profile.sourcePack.version}.`
      : undefined,
    profile.layoutTemplate ? `Layout template: ${profile.layoutTemplate}.` : undefined,
    profile.description,
    rawProfile.visualCues?.length ? `Visual cues: ${rawProfile.visualCues.join('; ')}.` : undefined,
    rawProfile.layoutHints ? `Layout hints: ${JSON.stringify(rawProfile.layoutHints)}.` : undefined,
    `User request: ${userPrompt}`,
  ]
    .filter(Boolean)
    .join('\n')
  return applyDeviceProfileToPartInput(profile, {
    prompt: userPrompt,
    name: profile.name,
    object: profile.name,
    category: profile.id,
    deviceProfile: profile.id,
    profile: profile.id,
    geometryBrief,
    ...(rawProfile.layoutHints ? { layoutHints: rawProfile.layoutHints } : {}),
    forceProfile: true,
  })
}

function profileForArtifact(
  artifact: GeneratedGeometryArtifact | null,
  profiles: readonly DeviceProfileDefinition[],
): DeviceProfileDefinition | undefined {
  if (!artifact || !isRecord(artifact.sourceArgs)) return undefined
  return inferDeviceProfileDefinition(
    {
      deviceProfile: artifact.sourceArgs.deviceProfile,
      profile: artifact.sourceArgs.profile,
      deviceType: artifact.sourceArgs.deviceType,
      prompt: artifact.userPrompt,
      name: artifact.sourceArgs.name,
      object: artifact.sourceArgs.object,
    },
    profiles,
  )
}

function profileForEditableRevision(
  userPrompt: string,
  revisionTarget: GeneratedGeometryArtifact | null,
  profiles: readonly DeviceProfileDefinition[],
): DeviceProfileDefinition | undefined {
  const promptProfile = inferDeviceProfileDefinition(
    { prompt: userPrompt, name: userPrompt, object: userPrompt },
    profiles,
  )
  if (promptProfile?.family === 'robot_arm') return promptProfile
  return profileForArtifact(revisionTarget, profiles)
}

function artifactShapesForProfileQuality(artifact: GeneratedGeometryArtifact) {
  return artifact.shapes.map((shape, index) => ({
    ...shape,
    position: artifact.transforms[index]?.position ?? shape.position,
  }))
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

function shouldPersistDeviceProfileCandidate(params: Record<string, unknown> | undefined) {
  return params?.allowDeviceProfileCandidatePersist === true
}

function resourceCandidateUsageHint(candidate: {
  profileId: string
  matchedLabel: string
  description?: string
}) {
  const compactIdentity = `${candidate.profileId} ${candidate.matchedLabel}`
    .toLowerCase()
    .replace(/\s+/g, '')
  if (compactIdentity.includes('减压') || compactIdentity.includes('vacuum')) {
    return '适合明确要减压塔、真空蒸馏或处理常压渣油的场景。'
  }
  if (compactIdentity.includes('常压') || compactIdentity.includes('atmospheric')) {
    return '默认推荐：常规炼油/原油蒸馏入口，用户只说“蒸馏塔”时通常先选这个。'
  }
  return candidate.description || '适合该行业包中同名或近义设备场景。'
}

function recommendedResourceCandidateId(
  prompt: string,
  candidates: readonly { profileId: string; matchedLabel: string; description?: string }[],
) {
  const compactPrompt = prompt.toLowerCase().replace(/\s+/g, '')
  if (compactPrompt.includes('减压') || compactPrompt.includes('vacuum')) {
    return candidates.find((candidate) =>
      `${candidate.profileId} ${candidate.matchedLabel}`.toLowerCase().includes('vacuum') ||
      candidate.matchedLabel.includes('减压'),
    )?.profileId
  }
  if (compactPrompt.includes('常压') || compactPrompt.includes('atmospheric')) {
    return candidates.find((candidate) =>
      `${candidate.profileId} ${candidate.matchedLabel}`.toLowerCase().includes('atmospheric') ||
      candidate.matchedLabel.includes('常压'),
    )?.profileId
  }
  return (
    candidates.find((candidate) =>
      `${candidate.profileId} ${candidate.matchedLabel}`.toLowerCase().includes('atmospheric') ||
      candidate.matchedLabel.includes('常压'),
    )?.profileId ?? candidates[0]?.profileId
  )
}

export function ensurePrimitiveRunRunning(runId: string) {
  if (runningRuns.has(runId)) {
    return
  }
  void runPrimitiveRunToCompletion(runId)
}

export async function runPrimitiveRunToCompletion(runId: string) {
  if (runningRuns.has(runId)) {
    throw new Error(`Primitive run is already running: ${runId}`)
  }
  runningRuns.add(runId)
  try {
    await runPrimitiveRun(runId)
    return await loadRun(runId)
  } finally {
    runningRuns.delete(runId)
  }
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
        : ensurePromptInPrimitiveContext(
            userPrompt,
            stringFromContext(context, 'harnessContext') ?? run.prompt,
          )
    const analysisContext =
      latestArtifactCandidate || recentMessages.length
        ? buildGeometryAnalysisContext({
            messages: recentMessages,
            latestArtifact: latestArtifactCandidate,
            userRequest: userPrompt,
            contextDecision,
          })
        : ensurePromptInPrimitiveContext(
            userPrompt,
            stringFromContext(context, 'analysisContext') ?? harnessContext,
          )
    const contextPackRef = industryPackRefFromContext(context)
    const extraPackDirs = uniqueDeviceProfilePackDirs([
      ...(contextPackRef ? [contextPackRef] : []),
      ...inferredIndustryPackRefsFromPrompt(userPrompt),
    ])
    const loadedDeviceProfiles = await loadDeviceProfiles({ extraPackDirs })

    await appendRunEvent(runId, {
      type: 'message',
      message: JSON.stringify(contextDecision),
      data: { stage: 'context-resolver', contextDecision },
    })
    if (loadedDeviceProfiles.warnings.length > 0) {
      await appendRunEvent(runId, {
        type: 'message',
        message: 'Device profile source warnings',
        data: {
          stage: 'device-profiles',
          warnings: loadedDeviceProfiles.warnings,
          profileCount: loadedDeviceProfiles.profiles.length,
          extraPackCount: extraPackDirs.length,
        },
      })
    }

    const editableRevisionProfile = profileForEditableRevision(
      userPrompt,
      latestArtifactCandidate,
      loadedDeviceProfiles.profiles,
    )
    const editablePatch = resolveProfileEditablePatch(
      userPrompt,
      latestArtifactCandidate,
      editableRevisionProfile,
    )
    if (latestArtifactCandidate && editableRevisionProfile && editablePatch) {
      const previousProfile = profileForArtifact(
        latestArtifactCandidate,
        loadedDeviceProfiles.profiles,
      )
      const sourceArgs = isRecord(latestArtifactCandidate.sourceArgs)
        ? latestArtifactCandidate.sourceArgs
        : {}
      const baseArgs =
        previousProfile?.id === editableRevisionProfile.id && Object.keys(sourceArgs).length > 0
          ? { ...sourceArgs }
          : buildProfileRouteArgs(editableRevisionProfile, userPrompt)
      const revisionArgs = applyProfileEditablePatchToArgs(
        {
          ...baseArgs,
          deviceProfile: editableRevisionProfile.id,
          profile: editableRevisionProfile.id,
          profileSource: editableRevisionProfile.source,
          profileSourcePack: editableRevisionProfile.sourcePack,
          profilePackId: editableRevisionProfile.sourcePack?.id,
          profilePackVersion: editableRevisionProfile.sourcePack?.version,
          editableSchemaRef: editableRevisionProfile.editableSchemaRef,
          resolvedEditableSchema: editableRevisionProfile.resolvedEditableSchema,
        },
        editablePatch,
      )
      const routeMetrics: PrimitiveRouteMetrics = {
        route: 'deterministic',
        stage1HasBlueprint: false,
        selectedProfile: editableRevisionProfile.id,
        profileSource: editableRevisionProfile.source,
        ...(editableRevisionProfile.sourcePack
          ? { profilePackId: editableRevisionProfile.sourcePack.id }
          : {}),
        ...(editableRevisionProfile.layoutTemplate
          ? { layoutTemplate: editableRevisionProfile.layoutTemplate }
          : {}),
        overrodeBuiltin:
          editableRevisionProfile.overrides?.some((entry) => entry.source === 'builtin') === true,
        deterministicIntent: true,
        deterministicAttempted: true,
        deterministicSucceeded: false,
        stage2Called: false,
        family: editableRevisionProfile.family,
        deterministicTool: 'compose_parts',
        stage2ToolCallCount: 0,
        repairCallCount: 0,
      }
      const profileAnalysis = [
        `Resolved editable profile patch for "${editableRevisionProfile.id}".`,
        `Patch: ${editablePatch.reason}.`,
        'Using deterministic compose_parts revision route before LLM Stage2.',
      ].join('\n')
      await appendRunEvent(runId, {
        type: 'message',
        message: profileAnalysis,
        data: {
          stage: 'profile-editable-revision',
          selectedProfile: editableRevisionProfile.id,
          patch: editablePatch,
        },
      })
      await appendRunEvent(runId, {
        type: 'tool-call',
        message: 'compose_parts',
        data: {
          name: 'compose_parts',
          arguments: revisionArgs,
          deterministic: true,
          editablePatch,
        },
      })
      throwIfAborted(signal)
      const directResult = executeTool(
        'compose_parts',
        revisionArgs,
        userPrompt,
        latestArtifactCandidate,
        null,
        loadedDeviceProfiles,
      )
      await appendRunEvent(runId, {
        type: 'tool-result',
        message: directResult.content,
        data: { name: 'compose_parts', artifact: directResult.artifact, deterministic: true },
      })
      await appendRunEvent(runId, {
        type: 'progress',
        message: directResult.content,
        data: {
          stage: 'generate',
          route: 'profile-editable-revision',
          results: [directResult.content],
          artifact: directResult.artifact,
        },
      })

      if (directResult.artifact) {
        routeMetrics.deterministicSucceeded = true
        const profileQuality = evaluateDeviceProfileQuality(
          editableRevisionProfile,
          artifactShapesForProfileQuality(directResult.artifact),
          { visualScore: 0.82 },
        )
        routeMetrics.profileQualityScore = profileQuality.overallScore
        if (await shouldStopRun(runId, signal)) return
        const result = {
          contextDecision,
          analysis: profileAnalysis,
          results: [directResult.content],
          lastContent: 'Deterministic editable profile revision completed.',
          artifact: directResult.artifact,
          sourceTool: directResult.artifact.sourceTool,
          sourceArgs: directResult.artifact.sourceArgs,
          geometryBrief: directResult.artifact.geometryBrief,
          shapes: directResult.artifact.shapes,
          transforms: directResult.artifact.transforms,
          shapeCount: directResult.artifact.shapes.length,
          selectedProfile: {
            id: editableRevisionProfile.id,
            name: editableRevisionProfile.name,
            source: editableRevisionProfile.source,
            sourcePack: editableRevisionProfile.sourcePack,
            industry: editableRevisionProfile.industry,
            family: editableRevisionProfile.family,
            layoutFamily: editableRevisionProfile.layoutFamily,
            layoutTemplate: editableRevisionProfile.layoutTemplate,
            editableSchemaRef: editableRevisionProfile.editableSchemaRef,
            primarySemanticRole: editableRevisionProfile.primarySemanticRole,
          },
          editablePatch,
          profileQuality,
          metrics: {
            primitiveRoute: routeMetrics,
            deviceProfiles: {
              count: loadedDeviceProfiles.profiles.length,
              warnings: loadedDeviceProfiles.warnings,
            },
          },
          profileSources: {
            count: loadedDeviceProfiles.profiles.length,
            warnings: loadedDeviceProfiles.warnings,
          },
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
    }

    const resourceResolution = resolveProfileResourceCandidates(
      userPrompt,
      loadedDeviceProfiles.profiles,
    )
    if (resourceResolution.candidates.length > 0) {
      const rawResourceCandidates = resourceResolution.candidates.map((candidate) => ({
        profileId: candidate.profile.id,
        name: candidate.profile.name,
        aliases: candidate.profile.aliases,
        score: candidate.score,
        matchedLabel: candidate.matchedLabel,
        matchKind: candidate.matchKind,
        reason: candidate.reason,
        source: candidate.profile.source,
        sourcePack: candidate.profile.sourcePack,
        industry: candidate.profile.industry,
        family: candidate.profile.family,
        layoutFamily: candidate.profile.layoutFamily,
        description: candidate.profile.description,
      }))
      const recommendedCandidateId = recommendedResourceCandidateId(userPrompt, rawResourceCandidates)
      const resourceCandidates = rawResourceCandidates.map((candidate) => ({
        ...candidate,
        usageHint: resourceCandidateUsageHint(candidate),
        recommended: candidate.profileId === recommendedCandidateId,
      }))
      await appendRunEvent(runId, {
        type: 'message',
        message: resourceResolution.selectedCandidate
          ? `Resource resolver selected "${resourceResolution.selectedCandidate.profile.id}".`
          : 'Resource resolver found multiple candidates but no high-confidence auto-selection.',
        data: {
          stage: 'resource-resolver',
          selectedProfile: resourceResolution.selectedProfile?.id,
          candidates: resourceCandidates,
        },
      })

      if (!resourceResolution.selectedProfile && resourceResolution.candidates.length > 1) {
        const recommendedCandidate = resourceCandidates.find((candidate) => candidate.recommended)
        const optionLines = resourceCandidates.map((candidate, index) => {
          const sourceLabel = candidate.sourcePack
            ? `${candidate.sourcePack.id}@${candidate.sourcePack.version}`
            : candidate.source
          return [
            `${index + 1}. ${candidate.recommended ? '推荐：' : ''}${candidate.matchedLabel || candidate.name} (${candidate.profileId})`,
            `   适用：${candidate.usageHint}`,
            `   来源：${sourceLabel}`,
          ].join('\n')
        })
        const selectionMessage = [
          '找到了多个可能的行业资源，需要先选设备类型再生成。',
          recommendedCandidate
            ? `建议默认选择：${recommendedCandidate.matchedLabel || recommendedCandidate.name}。${recommendedCandidate.usageHint}`
            : undefined,
          '如果你只是说“蒸馏塔”，通常选常压蒸馏塔；如果你要减压/真空/渣油处理，再选减压蒸馏塔。',
          '',
          ...optionLines,
        ]
          .filter(Boolean)
          .join('\n')
        const analysis = [
          'Resource resolver found multiple matching device profiles.',
          'No geometry was created because the request is ambiguous at the resource-selection step.',
        ].join('\n')
        const result = {
          contextDecision,
          analysis,
          results: [selectionMessage],
          lastContent: selectionMessage,
          needsResourceSelection: true,
          resourceSelection: {
            status: 'needs_selection',
            prompt: userPrompt,
            recommendedProfileId: recommendedCandidateId,
            candidates: resourceCandidates,
          },
          shapeCount: 0,
          metrics: {
            primitiveRoute: {
              route: 'resource-selection',
              deterministicIntent: false,
              deterministicAttempted: false,
              deterministicSucceeded: false,
              stage2Called: false,
              stage2ToolCallCount: 0,
              repairCallCount: 0,
            },
            deviceProfiles: {
              count: loadedDeviceProfiles.profiles.length,
              warnings: loadedDeviceProfiles.warnings,
            },
          },
          profileSources: {
            count: loadedDeviceProfiles.profiles.length,
            warnings: loadedDeviceProfiles.warnings,
          },
        }
        await appendRunEvent(runId, {
          type: 'message',
          message: selectionMessage,
          data: { stage: 'resource-selection', candidates: resourceCandidates },
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
    }

    const inferredProfile = inferDeviceProfileDefinition(
      { prompt: userPrompt, name: userPrompt, object: userPrompt },
      loadedDeviceProfiles.profiles,
    )
    const selectedProfile = resourceResolution.selectedProfile ?? inferredProfile
    const safeSelectedProfile =
      resourceResolution.selectedProfile ??
      (selectedProfile && isSafeDeterministicProfileMatch(selectedProfile, userPrompt)
        ? selectedProfile
        : undefined)
    if (selectedProfile && !safeSelectedProfile) {
      await appendRunEvent(runId, {
        type: 'message',
        message: `Skipped low-confidence device profile "${selectedProfile.id}"; falling back to LLM analysis.`,
        data: {
          stage: 'profile-router',
          selectedProfile: selectedProfile.id,
          profileSource: selectedProfile.source,
          reason: 'profile alias was absent, weak, or only appeared in a negated target span',
        },
      })
    }
    if (
      shouldUseDeterministicProfileRoute({
        profile: safeSelectedProfile,
        userPrompt,
        revisionTarget,
        resourceResolved: resourceResolution.selectedProfile?.id === safeSelectedProfile?.id,
      })
    ) {
      const profile = selectedProfile!
      const routeMetrics: PrimitiveRouteMetrics = {
        route: 'profile',
        stage1HasBlueprint: false,
        selectedProfile: profile.id,
        profileSource: profile.source,
        ...(profile.sourcePack ? { profilePackId: profile.sourcePack.id } : {}),
        ...(profile.layoutTemplate ? { layoutTemplate: profile.layoutTemplate } : {}),
        overrodeBuiltin: profile.overrides?.some((entry) => entry.source === 'builtin') === true,
        ...(profile.overrides?.length ? { profileOverrides: [...profile.overrides] } : {}),
        deterministicIntent: true,
        deterministicAttempted: true,
        deterministicSucceeded: false,
        stage2Called: false,
        family: profile.family,
        deterministicTool: 'compose_parts',
        stage2ToolCallCount: 0,
        repairCallCount: 0,
      }
      const profileArgs = buildProfileRouteArgs(profile, userPrompt)
      const profileAnalysis = [
        `Matched device profile "${profile.id}" from ${profile.source}.`,
        profile.sourcePack
          ? `Using resource pack ${profile.sourcePack.id}@${profile.sourcePack.version}.`
          : undefined,
        profile.overrides?.some((entry) => entry.source === 'builtin')
          ? 'This profile overrides a builtin fallback profile.'
          : undefined,
        'Using deterministic compose_parts route before LLM Stage2.',
      ]
        .filter(Boolean)
        .join('\n')

      await appendRunEvent(runId, {
        type: 'message',
        message: profileAnalysis,
        data: {
          stage: 'profile-router',
          selectedProfile: profile.id,
          profileSource: profile.source,
          profilePackId: profile.sourcePack?.id,
          overrodeBuiltin: profile.overrides?.some((entry) => entry.source === 'builtin') === true,
        },
      })
      await appendRunEvent(runId, {
        type: 'tool-call',
        message: 'compose_parts',
        data: { name: 'compose_parts', arguments: profileArgs, deterministic: true },
      })
      throwIfAborted(signal)
      const directResult = executeTool(
        'compose_parts',
        profileArgs,
        userPrompt,
        revisionTarget,
        null,
        loadedDeviceProfiles,
      )
      await appendRunEvent(runId, {
        type: 'tool-result',
        message: directResult.content,
        data: { name: 'compose_parts', artifact: directResult.artifact, deterministic: true },
      })
      await appendRunEvent(runId, {
        type: 'progress',
        message: directResult.content,
        data: {
          stage: 'generate',
          route: 'profile',
          results: [directResult.content],
          artifact: directResult.artifact,
        },
      })

      if (directResult.artifact) {
        routeMetrics.deterministicSucceeded = true
        const profileQuality = evaluateDeviceProfileQuality(
          profile,
          artifactShapesForProfileQuality(directResult.artifact),
          { visualScore: 0.82 },
        )
        routeMetrics.profileQualityScore = profileQuality.overallScore
        if (await shouldStopRun(runId, signal)) return
        const result = {
          contextDecision,
          analysis: profileAnalysis,
          results: [directResult.content],
          lastContent: 'Deterministic device profile route completed.',
          artifact: directResult.artifact,
          sourceTool: directResult.artifact.sourceTool,
          sourceArgs: directResult.artifact.sourceArgs,
          geometryBrief: directResult.artifact.geometryBrief,
          shapes: directResult.artifact.shapes,
          transforms: directResult.artifact.transforms,
          shapeCount: directResult.artifact.shapes.length,
          selectedProfile: {
            id: profile.id,
            name: profile.name,
            source: profile.source,
            sourcePack: profile.sourcePack,
            industry: profile.industry,
            overrodeBuiltin:
              profile.overrides?.some((entry) => entry.source === 'builtin') === true,
            overrides: profile.overrides,
            family: profile.family,
            layoutFamily: profile.layoutFamily,
            layoutTemplate: profile.layoutTemplate,
            partPresets: profile.partPresets,
            proportionRules: profile.proportionRules,
            qualityRules: profile.qualityRules,
            primarySemanticRole: profile.primarySemanticRole,
          },
          profileQuality,
          metrics: {
            primitiveRoute: routeMetrics,
            deviceProfiles: {
              count: loadedDeviceProfiles.profiles.length,
              warnings: loadedDeviceProfiles.warnings,
            },
          },
          profileSources: {
            count: loadedDeviceProfiles.profiles.length,
            warnings: loadedDeviceProfiles.warnings,
          },
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

      routeMetrics.fallbackReason = 'profile_no_artifact'
      await appendRunEvent(runId, {
        type: 'message',
        message: 'Profile route produced no artifact; falling back to Stage1/Stage2.',
        data: { stage: 'profile-router', primitiveRoute: routeMetrics },
      })
    }

    const preflightPrecisionRoute = precisionPartDeterministicRoute(userPrompt, revisionTarget)
    if (preflightPrecisionRoute) {
      const routeMetrics: PrimitiveRouteMetrics = {
        route: 'deterministic',
        stage1HasBlueprint: false,
        deterministicIntent: true,
        deterministicAttempted: true,
        deterministicSucceeded: false,
        stage2Called: false,
        family: preflightPrecisionRoute.family,
        deterministicTool: 'compose_parts',
        stage2ToolCallCount: 0,
        repairCallCount: 0,
      }
      const routeAnalysis = `Matched deterministic precision route "${preflightPrecisionRoute.label}" before LLM Stage1.`
      await appendRunEvent(runId, {
        type: 'message',
        message: routeAnalysis,
        data: {
          stage: 'deterministic-preflight',
          intent: preflightPrecisionRoute.label,
          tool: 'compose_parts',
        },
      })
      await appendRunEvent(runId, {
        type: 'tool-call',
        message: 'compose_parts',
        data: {
          name: 'compose_parts',
          arguments: preflightPrecisionRoute.args,
          deterministic: true,
        },
      })
      throwIfAborted(signal)
      const directResult = executeTool(
        'compose_parts',
        preflightPrecisionRoute.args,
        userPrompt,
        revisionTarget,
        null,
        loadedDeviceProfiles,
      )
      await appendRunEvent(runId, {
        type: 'tool-result',
        message: directResult.content,
        data: {
          name: 'compose_parts',
          artifact: directResult.artifact,
          deterministic: true,
        },
      })
      await appendRunEvent(runId, {
        type: 'progress',
        message: directResult.content,
        data: {
          stage: 'generate',
          route: 'deterministic-precision-preflight',
          results: [directResult.content],
          artifact: directResult.artifact,
        },
      })

      if (directResult.artifact) {
        routeMetrics.deterministicSucceeded = true
        const stage3Review = stage3QualityReview(userPrompt, directResult.artifact)
        routeMetrics.stage3QualityScore = stage3Review.score
        routeMetrics.stage3Passed = stage3Review.passed
        routeMetrics.stage3Issues = stage3Review.issues
        routeMetrics.stage3Warnings = stage3Review.warnings
        if (await shouldStopRun(runId, signal)) return
        const result = {
          contextDecision,
          analysis: routeAnalysis,
          results: [directResult.content],
          lastContent: routeAnalysis,
          artifact: directResult.artifact,
          sourceTool: directResult.artifact.sourceTool,
          sourceArgs: directResult.artifact.sourceArgs,
          geometryBrief: directResult.artifact.geometryBrief,
          shapes: directResult.artifact.shapes,
          transforms: directResult.artifact.transforms,
          shapeCount: directResult.artifact.shapes.length,
          metrics: {
            primitiveRoute: routeMetrics,
            deviceProfiles: {
              count: loadedDeviceProfiles.profiles.length,
              warnings: loadedDeviceProfiles.warnings,
            },
          },
          profileSources: {
            count: loadedDeviceProfiles.profiles.length,
            warnings: loadedDeviceProfiles.warnings,
          },
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
      await appendRunEvent(runId, {
        type: 'message',
        message:
          'Deterministic precision route produced no artifact; falling back to Stage1/Stage2.',
        data: { stage: 'deterministic-preflight', primitiveRoute: routeMetrics },
      })
    }

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
    const precisionPartRoute = precisionPartDeterministicRoute(userPrompt, revisionTarget)
    if (precisionPartRoute) {
      routeMetrics.deterministicIntent = true
      routeMetrics.fallbackReason = undefined
      routeMetrics.family = precisionPartRoute.family
      routeMetrics.deterministicTool = 'compose_parts'
      deterministicLastContent = `Deterministic precision part route planned ${precisionPartRoute.label}.`
      await appendRunEvent(runId, {
        type: 'message',
        message: deterministicLastContent,
        data: {
          stage: 'deterministic-plan',
          intent: precisionPartRoute.label,
          tool: 'compose_parts',
          issues: [],
        },
      })

      routeMetrics.deterministicAttempted = true
      await appendRunEvent(runId, {
        type: 'tool-call',
        message: 'compose_parts',
        data: {
          name: 'compose_parts',
          arguments: precisionPartRoute.args,
          deterministic: true,
        },
      })
      throwIfAborted(signal)
      const directResult = executeTool(
        'compose_parts',
        precisionPartRoute.args,
        userPrompt,
        revisionTarget,
        null,
        loadedDeviceProfiles,
      )
      deterministicResults.push(directResult.content)
      await appendRunEvent(runId, {
        type: 'tool-result',
        message: directResult.content,
        data: {
          name: 'compose_parts',
          artifact: directResult.artifact,
          deterministic: true,
        },
      })
      await appendRunEvent(runId, {
        type: 'progress',
        message: directResult.content,
        data: {
          stage: 'generate',
          route: 'deterministic-precision-part',
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
          metrics: {
            primitiveRoute: routeMetrics,
            deviceProfiles: {
              count: loadedDeviceProfiles.profiles.length,
              warnings: loadedDeviceProfiles.warnings,
            },
          },
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
    }
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
          loadedDeviceProfiles,
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
          const candidatePersist = await persistDeviceProfileCandidateFromArtifact(
            userPrompt,
            directResult.artifact,
            { enabled: shouldPersistDeviceProfileCandidate(run.params) },
          )
          await appendRunEvent(runId, {
            type: 'message',
            message: candidatePersist.saved
              ? 'Device profile candidate saved'
              : 'Device profile candidate not saved',
            data: { stage: 'device-profile-candidate', candidatePersist },
          })
          if (await shouldStopRun(runId, signal)) return
          const result = {
            contextDecision,
            analysis,
            results: deterministicResults,
            lastContent: deterministicLastContent,
            artifact: directResult.artifact,
            deviceProfileCandidate: candidatePersist,
            metrics: {
              primitiveRoute: routeMetrics,
              deviceProfiles: {
                count: loadedDeviceProfiles.profiles.length,
                warnings: loadedDeviceProfiles.warnings,
              },
            },
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
            loadedDeviceProfiles,
          )
          toolResultMessages.push({ role: 'tool', tool_call_id: call.id, content: result.content })
          results.push(result.content)
          await appendRunEvent(runId, {
            type: 'tool-result',
            message: result.content,
            data: { name: call.function.name, artifact: result.artifact },
          })
          if (result.artifact) {
            const stage3 = await applyStage3QualityGate({
              runId,
              userPrompt,
              artifact: result.artifact,
              revisionTarget,
              loadedDeviceProfiles,
              routeMetrics,
              signal,
            })
            if (stage3.content) results.push(stage3.content)
            if (stage3.accepted) {
              artifact = stage3.artifact
            } else {
              toolResultMessages.push({
                role: 'tool',
                tool_call_id: call.id,
                content:
                  stage3.content ??
                  'Stage3 semantic quality gate failed. Call one replacement geometry tool.',
              })
            }
          }
        }
      }

      await appendRunEvent(runId, {
        type: 'progress',
        message: results.at(-1) ?? 'Geometry tool executed.',
        data: { stage: 'generate', results, artifact },
      })

      if (artifact) {
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
    const candidatePersist = await persistDeviceProfileCandidateFromArtifact(userPrompt, artifact, {
      enabled: shouldPersistDeviceProfileCandidate(run.params),
    })
    await appendRunEvent(runId, {
      type: 'message',
      message: candidatePersist.saved
        ? 'Device profile candidate saved'
        : 'Device profile candidate not saved',
      data: { stage: 'device-profile-candidate', candidatePersist },
    })
    const result = {
      contextDecision,
      analysis,
      results,
      lastContent,
      artifact,
      deviceProfileCandidate: candidatePersist,
      ...(artifact
        ? {
            sourceTool: artifact.sourceTool,
            sourceArgs: artifact.sourceArgs,
            geometryBrief: artifact.geometryBrief,
            shapes: artifact.shapes,
            transforms: artifact.transforms,
            shapeCount: artifact.shapes.length,
          }
        : {}),
      metrics: { primitiveRoute: routeMetrics },
      profileSources: {
        count: loadedDeviceProfiles.profiles.length,
        warnings: loadedDeviceProfiles.warnings,
      },
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
