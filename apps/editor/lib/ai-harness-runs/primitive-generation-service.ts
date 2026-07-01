import type {
  AiChatHarnessMessage,
  GeometryContextDecision,
} from '../../../../packages/editor/src/lib/ai-chat-harness'
import type { GeneratedGeometryArtifact } from '../../../../packages/editor/src/lib/ai-generated-geometry-core'
import type { Vec3 } from '@pascal-app/core/lib/primitive-compose'
import type { ProcessEquipmentContract, ProcessEquipmentPort } from './process-line-types'
import { runPrimitiveRunToCompletion } from './primitive-runner'
import { createRun } from './run-store'
import type { AiHarnessRun, AiHarnessRunStatus } from './types'

export type PrimitiveGeometryPlacementIntent = {
  requestedRole?: string
  desiredFootprint?: [number, number]
  desiredEnvelope?: [number, number, number]
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
  factoryEquipmentContract?: ProcessEquipmentContract
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
  needsResourceSelection?: boolean
  resourceSelection?: unknown
  selectedProfile?: unknown
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
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function titleCase(value: string) {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function portMarkerPosition(
  port: ProcessEquipmentPort,
  envelope: ProcessEquipmentContract['envelope'],
): Vec3 {
  const halfLength = envelope.length / 2
  const halfWidth = envelope.width / 2
  const offset = port.offset ?? 0
  const height = Math.max(0.08, Math.min(envelope.height - 0.08, port.height))
  switch (port.side) {
    case 'left':
      return [-halfLength + 0.08, height, offset]
    case 'right':
      return [halfLength - 0.08, height, offset]
    case 'front':
      return [offset, height, halfWidth - 0.08]
    case 'back':
      return [offset, height, -halfWidth + 0.08]
    case 'top':
      return [offset, envelope.height - 0.08, 0]
  }
}

function mediumColor(medium: ProcessEquipmentPort['medium']) {
  switch (medium) {
    case 'water':
    case 'cooling':
      return '#38bdf8'
    case 'hydrogen':
      return '#facc15'
    case 'oxygen':
      return '#60a5fa'
    case 'power':
      return '#f97316'
    default:
      return '#a3a3a3'
  }
}

function createFactoryE2eSmokeResult(
  input: PrimitiveGeometryGenerationRequest,
): PrimitiveGeometryGenerationResult | null {
  const smokeEnabled = process.env.FACTORY_E2E_SMOKE === '1' || input.params?.e2eSmoke === true
  if (!smokeEnabled || input.source !== 'factory-agent') return null

  const role =
    input.placementIntent?.requestedRole ?? input.placementIntent?.lineRole ?? 'equipment'
  const roleLabel =
    role === 'electrolyzer' ? 'Electrolyzer stack array' : `${titleCase(role)} module`
  const contract = input.factoryEquipmentContract
  const envelope = contract?.envelope
  const contractPorts = contract?.ports ?? []
  const portRoleIds = new Set(contractPorts.map((port) => port.id))
  const requiredRoleMarkers =
    contract?.requiredRoles?.filter((role) => !portRoleIds.has(role)) ?? []
  const length = envelope?.length ?? 2.65
  const width = envelope?.width ?? 1.2
  const height = envelope?.height ?? 1.35
  const housingLength = Math.max(0.6, length * 0.82)
  const housingWidth = Math.max(0.35, width * 0.74)
  const housingHeight = Math.max(0.45, height * 0.58)
  const runId = `run_factory_e2e_${Date.now().toString(36)}`
  const artifact: GeneratedGeometryArtifact = {
    id: `ai_geometry_factory_e2e_${role.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
    title: roleLabel,
    sourceTool: 'factory_e2e_smoke',
    sourceArgs: { role, smoke: true, factoryEquipmentContract: contract },
    userPrompt: input.prompt,
    version: 1,
    createdAt: new Date().toISOString(),
    shapes: [
      {
        kind: 'box',
        name: `${roleLabel} housing`,
        position: [0, 0.28 + housingHeight / 2, 0],
        rotation: [0, 0, 0],
        length: housingLength,
        width: housingWidth,
        height: housingHeight,
        cornerRadius: 0.06,
        material: {
          preset: 'custom',
          properties: { color: '#60a5fa', roughness: 0.55, metalness: 0.18 },
        },
      },
      {
        kind: 'box',
        name: `${roleLabel} skid`,
        position: [0, 0.12, 0],
        rotation: [0, 0, 0],
        length,
        width,
        height: 0.24,
        cornerRadius: 0.03,
        material: {
          preset: 'custom',
          properties: { color: '#475569', roughness: 0.62, metalness: 0.24 },
        },
      },
      {
        kind: 'cylinder',
        name: `${roleLabel} manifold`,
        position: [0, Math.min(height - 0.12, 0.28 + housingHeight + 0.16), width / 2 - 0.12],
        rotation: [0, 0, Math.PI / 2],
        axis: 'x',
        radius: 0.08,
        height: Math.max(0.6, housingLength * 0.92),
        radialSegments: 24,
        material: {
          preset: 'custom',
          properties: { color: '#e2e8f0', roughness: 0.36, metalness: 0.35 },
        },
      },
      ...contractPorts.map((port) => ({
        kind: 'box' as const,
        name: `${roleLabel} ${port.id} port`,
        semanticRole: port.id,
        sourcePartKind: 'connection_port',
        position: portMarkerPosition(
          port,
          envelope ?? { length, width, height, origin: 'station_profile' },
        ),
        rotation: [0, 0, 0] as Vec3,
        length: 0.16,
        width: 0.16,
        height: 0.16,
        cornerRadius: 0.02,
        material: {
          preset: 'custom' as const,
          properties: { color: mediumColor(port.medium), roughness: 0.42, metalness: 0.2 },
        },
      })),
      ...requiredRoleMarkers.map((semanticRole, index) => {
        const markerCount = Math.max(1, requiredRoleMarkers.length)
        const x =
          markerCount === 1
            ? 0
            : -housingLength * 0.38 + (housingLength * 0.76 * index) / (markerCount - 1)
        const z = -housingWidth * 0.38 + (index % 3) * Math.min(0.18, housingWidth * 0.26)
        return {
          kind: 'box' as const,
          name: `${roleLabel} ${semanticRole} marker`,
          semanticRole,
          sourcePartKind: 'required_role_marker',
          position: [x, Math.min(height - 0.08, 0.34 + housingHeight), z] as Vec3,
          rotation: [0, 0, 0] as Vec3,
          length: Math.max(0.12, Math.min(0.28, housingLength * 0.08)),
          width: Math.max(0.1, Math.min(0.18, housingWidth * 0.18)),
          height: 0.12,
          cornerRadius: 0.015,
          material: {
            preset: 'custom' as const,
            properties: { color: '#cbd5e1', roughness: 0.46, metalness: 0.18 },
          },
        }
      }),
    ],
    transforms: [
      { position: [0, 0.28 + housingHeight / 2, 0], rotation: [0, 0, 0] },
      { position: [0, 0.12, 0], rotation: [0, 0, 0] },
      {
        position: [0, Math.min(height - 0.12, 0.28 + housingHeight + 0.16), width / 2 - 0.12],
        rotation: [0, 0, Math.PI / 2],
      },
      ...contractPorts.map((port) => ({
        position: portMarkerPosition(
          port,
          envelope ?? { length, width, height, origin: 'station_profile' },
        ),
        rotation: [0, 0, 0] as Vec3,
      })),
      ...requiredRoleMarkers.map((_, index) => {
        const markerCount = Math.max(1, requiredRoleMarkers.length)
        const x =
          markerCount === 1
            ? 0
            : -housingLength * 0.38 + (housingLength * 0.76 * index) / (markerCount - 1)
        const z = -housingWidth * 0.38 + (index % 3) * Math.min(0.18, housingWidth * 0.26)
        return {
          position: [x, Math.min(height - 0.08, 0.34 + housingHeight), z] as Vec3,
          rotation: [0, 0, 0] as Vec3,
        }
      }),
    ],
    assemblyName: roleLabel,
    assemblyPosition: [0, height / 2, 0],
    createdNames: [
      `${roleLabel} housing`,
      `${roleLabel} skid`,
      `${roleLabel} manifold`,
      ...contractPorts.map((port) => `${roleLabel} ${port.id} port`),
      ...requiredRoleMarkers.map((semanticRole) => `${roleLabel} ${semanticRole} marker`),
    ],
    shapeDetails: `Factory e2e smoke artifact for ${roleLabel}`,
  }

  return {
    runId,
    conversationId: input.conversationId ?? 'factory-agent',
    status: 'succeeded',
    artifact,
    payload: {
      analysis: 'Factory e2e smoke mode returned a deterministic primitive artifact.',
      results: [`Created ${roleLabel} smoke artifact with ${artifact.shapes.length} shapes.`],
      artifact,
      metrics: { smoke: true, role, factoryEquipmentContract: contract },
      sourceTool: artifact.sourceTool,
      sourceArgs: artifact.sourceArgs,
      shapeCount: artifact.shapes.length,
    },
  }
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
    needsResourceSelection: value.needsResourceSelection === true,
    resourceSelection: value.resourceSelection,
    selectedProfile: value.selectedProfile,
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
  if (input.factoryEquipmentContract) {
    context.factoryEquipmentContract = input.factoryEquipmentContract
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
      ...(input.factoryEquipmentContract
        ? {
            factoryEquipmentContract: input.factoryEquipmentContract,
            equipmentFamily: input.factoryEquipmentContract.equipmentFamily,
            equipmentProfileId: input.factoryEquipmentContract.profileId,
            equipmentEnvelope: input.factoryEquipmentContract.envelope,
            equipmentPorts: input.factoryEquipmentContract.ports,
            preferredTool: input.factoryEquipmentContract.preferredTool,
          }
        : {}),
    },
  }
}

export async function generatePrimitiveGeometryDraft(
  input: PrimitiveGeometryGenerationRequest,
): Promise<PrimitiveGeometryGenerationResult> {
  const smokeResult = createFactoryE2eSmokeResult(input)
  if (smokeResult) return smokeResult

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
