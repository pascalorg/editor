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
    'Create one editable object from the reusable building-block library. Prefer this when explicitly selecting parts or when compose_assembly does not support the requested family. Use generic kernels such as chimney_stack, aircraft_fuselage, wheel/wheel_set, window_panel/window_strip, body_shell, tube_frame, fork, light_pair, bar_pair, streamlined_body, lofted_panel, airfoil_blade, pyramid, pipe/flange/bolt parts, and assign semanticRole for context-specific meaning. For complete fans, prefer fan_blade with count:3-6 so each blade is independently editable; radial_blades is kept only as a compatibility composite. For a complete bicycle, use exactly wheel_set semanticRole:"bicycle_tire" count:2 + tube_frame semanticRole:"bicycle_frame" + fork semanticRole:"bicycle_fork" + handlebar + saddle + chain_loop; do not invent bicycle_crank/chainring/pedals part kinds. For complete aircraft/airplanes/airliners, use parts:[{kind:"aircraft_fuselage", id:"aircraft_fuselage"}] with top-level length/primaryColor and let defaults add wings, engines, T-tail, windows, and landing gear; do not hand-place generic airfoil_blade/streamlined_body/wheel_set parts for complete aircraft. For industrial chimneys/smokestacks, use parts:[{kind:"chimney_stack", semanticRole:"chimney_body", height, radius, warningStripes:true}] and do not use vertical_pole/circular_base/cylinder. Use pyramid for square/rectangular pyramids, Egyptian-style pyramids, pointed rooftops, and cone-like shapes with a square base; set truncated:true or topScale to make a flat-top truncated pyramid. Prefer relationship fields over raw coordinates: alignAbove, alignBeside with side, centeredOn, connectTo with connectPoint/childPoint, around with aroundCount/aroundRadius, and array:{count,axis,spacing} for repeated linear parts.',
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

function extraDeviceProfilePackDirsFromContext(context: Record<string, unknown>) {
  const ref = industryPackRefFromContext(context)
  const dir = ref ? resolveIndustryPackDir(ref) : undefined
  return dir ? [dir] : []
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
  const text = userPrompt.toLowerCase()
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

  const fanIntent =
    /(\u5de5\u4e1a\u98ce\u6247|\u843d\u5730\u6247|\u7535\u98ce\u6247|\u98ce\u6247|industrial[_\s-]?(pedestal[_\s-]?)?fan|standing[_\s-]?fan|pedestal[_\s-]?fan)/i.test(
      text,
    ) && !/(fanuc)/i.test(text)
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

function fanPrimaryColorFromPrompt(text: string): string {
  if (/(\u84dd|blue)/i.test(text)) return '#3b82f6'
  if (/(\u7ea2|red)/i.test(text)) return '#ef4444'
  if (/(\u9ed1|black)/i.test(text)) return '#111827'
  if (/(\u767d|white)/i.test(text)) return '#f8fafc'
  if (/(\u9ec4|yellow)/i.test(text)) return '#facc15'
  return '#ef4444'
}

type Stage3RepairPlan = {
  label: string
  tool: 'compose_parts'
  args: Record<string, unknown>
}

type Stage3QualityReview = {
  passed: boolean
  score: number
  issues: string[]
  warnings: string[]
  repairPlan?: Stage3RepairPlan
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
}): Promise<{ artifact: GeneratedGeometryArtifact; content?: string }> {
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

  if (review.passed || !review.repairPlan) return { artifact: input.artifact }

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
  if (!repaired.artifact) return { artifact: input.artifact, content: repaired.content }

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
  return {
    artifact: repaired.artifact,
    content: [`Stage3 repaired geometry using ${review.repairPlan.label}.`, repaired.content].join(
      '\n',
    ),
  }
}

function shouldUseDeterministicProfileRoute(input: {
  profile: DeviceProfileDefinition | undefined
  userPrompt: string
  revisionTarget: GeneratedGeometryArtifact | null
}) {
  if (!input.profile) return false
  if (input.revisionTarget) return false
  if (isLikelyGeometryRevisionRequest(input.userPrompt, input.revisionTarget)) return false
  return input.profile.status === 'stable'
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
    const extraPackDirs = extraDeviceProfilePackDirsFromContext(context)
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

    const selectedProfile = inferDeviceProfileDefinition(
      { prompt: userPrompt, name: userPrompt, object: userPrompt },
      loadedDeviceProfiles.profiles,
    )
    if (
      shouldUseDeterministicProfileRoute({
        profile: selectedProfile,
        userPrompt,
        revisionTarget,
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
            artifact = stage3.artifact
            if (stage3.content) results.push(stage3.content)
          }
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
    const candidatePersist = await persistDeviceProfileCandidateFromArtifact(userPrompt, artifact)
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
