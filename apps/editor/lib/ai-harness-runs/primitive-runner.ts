import { callConfiguredAi } from '@/lib/ai-provider'
import {
  buildPrimitiveRepairRetryMessages,
  DEFAULT_PRIMITIVE_REPAIR_STAGNATION_LIMIT,
  INITIAL_PRIMITIVE_REPAIR_STAGNATION_STATE,
  nextPrimitiveRepairStagnationState,
  PRIMITIVE_STAGE1_ANALYST_PROMPT,
  PRIMITIVE_STAGE2_GENERATOR_PROMPT,
  type PrimitiveRepairRetryMessage,
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
  dimensions?: { length?: number; width?: number; height?: number; radius?: number }
}

type PartBlueprint = {
  route: 'compose_parts' | 'compose_assembly' | 'compose_recipe' | 'revise_geometry'
  category?: string
  constraints?: { length?: number; width?: number; height?: number; primaryColor?: string }
  parts?: PartBlueprintItem[]
  requiredRoles?: string[]
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
    'Create one editable object from the reusable building-block library. Prefer this when explicitly selecting parts or when compose_assembly does not support the requested family. Use generic kernels such as chimney_stack, aircraft_fuselage, wheel/wheel_set, window_panel/window_strip, body_shell, tube_frame, fork, light_pair, bar_pair, streamlined_body, lofted_panel, airfoil_blade, pyramid, pipe/flange/bolt parts, and assign semanticRole for context-specific meaning. For complete aircraft/airplanes/airliners, use parts:[{kind:"aircraft_fuselage", id:"aircraft_fuselage"}] with top-level length/primaryColor and let defaults add wings, engines, T-tail, windows, and landing gear; do not hand-place generic airfoil_blade/streamlined_body/wheel_set parts for complete aircraft. For industrial chimneys/smokestacks, use parts:[{kind:"chimney_stack", semanticRole:"chimney_body", height, radius, warningStripes:true}] and do not use vertical_pole/circular_base/cylinder. Use pyramid for square/rectangular pyramids, Egyptian-style pyramids, pointed rooftops, and cone-like shapes with a square base; set truncated:true or topScale to make a flat-top truncated pyramid. Prefer relationship fields over raw coordinates: alignAbove, alignBeside with side, centeredOn, connectTo with connectPoint/childPoint, around with aroundCount/aroundRadius, and array:{count,axis,spacing} for repeated linear parts.',
  ),
  tool(
    'compose_robot_arm',
    'Create an editable industrial robot arm draft for robot arm requests not covered by robotArm.threeAxis.',
  ),
  tool(
    'compose_primitive',
    'Create one editable primitive object from custom primitive shapes. Use only when templates, recipes, and reusable parts do not cover the requested structure.',
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

function extractBlueprintFromAnalysis(analysis: string): PartBlueprint | null {
  const match = analysis.match(/```json\s*([\s\S]*?)\s*```/i)
  if (!match?.[1]) return null
  try {
    const parsed = JSON.parse(match[1])
    if (!isRecord(parsed) || typeof parsed.route !== 'string') return null
    if (parsed.route !== 'revise_geometry' && !Array.isArray(parsed.parts)) return null
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

function latestArtifactFromContext(context: Record<string, unknown>) {
  const value = context.latestArtifact
  return isRecord(value) ? (value as unknown as GeneratedGeometryArtifact) : null
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
    const harnessContext = stringFromContext(context, 'harnessContext') ?? run.prompt
    const analysisContext = stringFromContext(context, 'analysisContext') ?? harnessContext
    const revisionTarget = latestArtifactFromContext(context)
    const userPrompt = run.prompt

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
    let lastContent = response.content ?? ''
    const results: string[] = []
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
    const result = { analysis, results, lastContent, artifact }
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
