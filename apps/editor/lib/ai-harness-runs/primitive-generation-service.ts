import type {
  AiChatHarnessMessage,
  GeometryContextDecision,
} from '../../../../packages/editor/src/lib/ai-chat-harness'
import type { GeneratedGeometryArtifact } from '../../../../packages/editor/src/lib/ai-generated-geometry-core'
import { runPrimitiveRunToCompletion } from './primitive-runner'
import { createRun } from './run-store'
import type { AiHarnessRun, AiHarnessRunStatus } from './types'

export type PrimitiveGeometryPlacementIntent = {
  requestedRole?: string
  desiredFootprint?: [number, number]
  lineRole?: string
}

export type PrimitiveGeometryGenerationRequest = {
  prompt: string
  conversationId?: string
  recentMessages?: AiChatHarnessMessage[]
  latestArtifactCandidate?: GeneratedGeometryArtifact | null
  context?: Record<string, unknown>
  params?: Record<string, unknown>
  source?: string
  placementIntent?: PrimitiveGeometryPlacementIntent
}

export type PrimitiveGeometryGenerationRunInput = {
  conversationId: string
  mode: 'primitive'
  prompt: string
  context: Record<string, unknown>
  params: Record<string, unknown>
}

export type PrimitiveGeometryGenerationPayload = {
  contextDecision?: GeometryContextDecision
  analysis?: string
  results: string[]
  lastContent?: string
  artifact?: GeneratedGeometryArtifact
  deviceProfileCandidate?: unknown
  metrics: Record<string, unknown>
  profileSources?: unknown
  sourceTool?: string
  sourceArgs?: Record<string, unknown>
  shapeCount?: number
}

export type PrimitiveGeometryGenerationResult = {
  runId: string
  conversationId: string
  status: AiHarnessRunStatus
  artifact?: GeneratedGeometryArtifact
  payload?: PrimitiveGeometryGenerationPayload
  error?: string
  run?: AiHarnessRun | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export function isGeneratedGeometryArtifact(value: unknown): value is GeneratedGeometryArtifact {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.sourceTool === 'string' &&
    typeof value.userPrompt === 'string' &&
    Array.isArray(value.shapes) &&
    Array.isArray(value.transforms) &&
    Array.isArray(value.assemblyPosition) &&
    Array.isArray(value.createdNames)
  )
}

export function extractPrimitiveGeometryGenerationPayload(
  value: unknown,
): PrimitiveGeometryGenerationPayload | undefined {
  if (!isRecord(value)) return undefined
  const artifact = isGeneratedGeometryArtifact(value.artifact) ? value.artifact : undefined
  const metrics = isRecord(value.metrics) ? value.metrics : {}
  const sourceArgs = isRecord(value.sourceArgs) ? value.sourceArgs : undefined
  return {
    contextDecision: isRecord(value.contextDecision)
      ? (value.contextDecision as unknown as GeometryContextDecision)
      : undefined,
    analysis: typeof value.analysis === 'string' ? value.analysis : undefined,
    results: asStringArray(value.results),
    lastContent: typeof value.lastContent === 'string' ? value.lastContent : undefined,
    artifact,
    deviceProfileCandidate: value.deviceProfileCandidate,
    metrics,
    profileSources: value.profileSources,
    sourceTool: typeof value.sourceTool === 'string' ? value.sourceTool : artifact?.sourceTool,
    sourceArgs,
    shapeCount: typeof value.shapeCount === 'number' ? value.shapeCount : artifact?.shapes.length,
  }
}

export function buildPrimitiveGeometryGenerationRunInput(
  input: PrimitiveGeometryGenerationRequest,
): PrimitiveGeometryGenerationRunInput {
  const prompt = input.prompt.trim()
  const context: Record<string, unknown> = isRecord(input.context) ? { ...input.context } : {}
  if (input.recentMessages) context.recentMessages = input.recentMessages
  if ('latestArtifactCandidate' in input) {
    context.latestArtifactCandidate = input.latestArtifactCandidate ?? null
  }

  return {
    conversationId: input.conversationId ?? 'factory-agent',
    mode: 'primitive',
    prompt,
    context,
    params: {
      ...input.params,
      source: input.source ?? 'factory-agent',
      placement: 'deferred',
      ...(input.placementIntent ? { placementIntent: input.placementIntent } : {}),
    },
  }
}

export async function generatePrimitiveGeometryDraft(
  input: PrimitiveGeometryGenerationRequest,
): Promise<PrimitiveGeometryGenerationResult> {
  const runInput = buildPrimitiveGeometryGenerationRunInput(input)
  if (!runInput.prompt) {
    throw new Error('prompt is required')
  }

  const run = await createRun(runInput)
  const completedRun = await runPrimitiveRunToCompletion(run.id)
  const payload = extractPrimitiveGeometryGenerationPayload(completedRun?.result)
  return {
    runId: run.id,
    conversationId: run.conversationId,
    status: completedRun?.status ?? run.status,
    artifact: payload?.artifact,
    payload,
    error: completedRun?.error,
    run: completedRun,
  }
}
